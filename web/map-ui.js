import {mapTile,parseMapLocation,prepareMapFeatures,generateScene} from './maps.js';
import {loadMapArea} from './api.js';
import {SOURCES,sourceInfo} from './sources.js';
import {diagnosticsHtml,installDiagnostics} from './diagnostics-ui.js';
import {BROWSER_DOWNLOADS,HOSTED} from './runtime.js';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const heightLabel=s=>({mapped:'height recorded in OSM',official:'official height and roof surfaces',levels:'height estimated from floors',assumed:'height assumed — please check',edited:'height edited by you'}[s]||s);
export class MapGenerator {
  constructor(getSettings,onApply){
    this.getSettings=getSettings;this.onApply=onApply;this.requestId=0;
    this.dialog=document.createElement('dialog');this.dialog.className='map-dialog';document.body.append(this.dialog);
    this.dialog.addEventListener('close',()=>{this.requestId++;this.controller?.abort();this.data=null;this.features=[];this.point=null;this.dialog.innerHTML='';});
    this.dialog.addEventListener('click',e=>{if(e.target===this.dialog)this.dialog.close();});
  }
  open({location}={}){
    const s=this.getSettings();
    this.dialog.innerHTML=`<div class="dialog-heading"><div><div class="eyebrow">YOUR REAL SURROUNDINGS</div><h2>Generate your neighbourhood.</h2></div><button id="close-map" aria-label="Close map generation">×</button></div>
      <p class="map-intro">Enter coordinates or an OpenStreetMap link. OpenStreetMap generates nearby buildings and mapped trees; adjust missing or inaccurate details in the 3D editor.</p>
      <div class="field"><label for="map-location">Your installation location · stays in this browser</label><input id="map-location" type="text" spellcheck="false" autocomplete="off" value="${esc(location??`${s.location.lat}, ${s.location.lon}`)}" placeholder="52.5208, 13.4095 or an OpenStreetMap link"></div>
      <p class="help">The prefilled point is your approximate weather location. Replace it with your building’s coordinates for a site-specific scene. OpenStreetMap links are parsed locally.</p>
      <div class="form-row"><div class="field"><label for="map-radius">Surroundings to model</label><select id="map-radius"><option value="100">Within 100 m</option><option value="150" selected>Within 150 m</option><option value="200">Within 200 m</option></select></div><div class="field"><label for="map-timezone">Site time zone (IANA)</label><input id="map-timezone" type="text" value="${esc(s.location.timezone)}"></div></div>
      <div class="privacy-note map-privacy" id="map-privacy"></div>
      <div class="map-lookup-actions"><button id="fetch-map" class="button full">↓ Load map area</button><button id="map-example" class="small-button">Use Berlin public example</button></div>
      <p id="map-status" class="loading-state" role="status" aria-live="polite"></p>
      ${diagnosticsHtml('map-diagnostics')}
      <section id="map-results" hidden><div class="map-preview-heading"><h3>Confirm your building</h3><span>Click a footprint to select it</span></div><div id="map-preview" class="map-preview"></div><div class="map-preview-legend"><span><i class="map-own"></i> Your building</span><span><i class="map-estimated"></i> Assumed height</span><span><i class="map-tree"></i> Mapped tree</span><span>＋ Entered point</span></div><p id="map-building-info" class="map-building-info"></p><p id="map-coverage" class="help"></p><button id="apply-map" class="button full" disabled>Generate editable 3D scene ↗</button></section>
      <p class="help map-attribution" id="map-attribution">© OpenStreetMap contributors · ODbL. Buildings use editable extruded footprints. Missing heights are labelled as estimates; missing vegetation must be added manually. Generation replaces your main building and surroundings, with one local undo copy.</p>`;
    const q=id=>this.dialog.querySelector(id);
    q('#close-map').onclick=()=>this.dialog.close();
    q('#map-example').onclick=()=>{q('#map-location').value='52.52255, 13.38525';q('#map-timezone').value='Europe/Berlin';this.invalidate();this.areaPreview();};
    q('#map-location').oninput=()=>{this.invalidate();this.areaPreview();};
    q('#map-radius').onchange=()=>{this.invalidate();this.areaPreview();};
    q('#fetch-map').onclick=()=>this.load();q('#apply-map').onclick=()=>this.apply();
    installDiagnostics(q('#map-diagnostics'));this.areaPreview();this.dialog.showModal();
  }
  q(id){return this.dialog.querySelector(id);}
  invalidate(){this.data=null;this.features=[];this.ownId=null;this.q('#map-results').hidden=true;this.q('#map-status').textContent='';}
  areaPreview(){
    const target=this.q('#map-privacy');
    try{
      const p=parseMapLocation(this.q('#map-location').value),tile=mapTile(p.lat,p.lon),b=tile.bounds;
      const providers=BROWSER_DOWNLOADS&&HOSTED?'Private.coffee and overpass-api.de.':'Private.coffee / overpass-api.de; OpenStreetMap’s official read API is the final fallback.';
      const delivery=BROWSER_DOWNLOADS?'Your browser sends this area directly to the map provider, which sees your connection’s IP.':HOSTED?'The website host receives your IP and coarse area indices. Map providers receive the broader area and the server’s IP.':'Only coarse area indices go to the local server. Map providers receive the broader area and your connection’s IP.';
      target.innerHTML=`<strong>◎ Exact point stays in your browser</strong>A broader ${tile.heightKm.toFixed(1)} × ${tile.widthKm.toFixed(1)} km area is requested (latitude ${b[0].toFixed(4)}…${b[2].toFixed(4)}°, longitude ${b[1].toFixed(4)}…${b[3].toFixed(4)}°). ${delivery} Your precise point, selected building and solar settings are not sent. Providers include ${esc(providers)}`;
      this.q('#fetch-map').disabled=false;
    }catch(e){target.innerHTML=`<strong>◎ No external request has been made</strong>${esc(e.message)}`;this.q('#fetch-map').disabled=true;}
  }
  async load(){
    const status=this.q('#map-status'),button=this.q('#fetch-map'),requestId=++this.requestId;
    try{
      const point=parseMapLocation(this.q('#map-location').value),tile=mapTile(point.lat,point.lon);
      const timezone=this.q('#map-timezone').value.trim();new Intl.DateTimeFormat('en',{timeZone:timezone}).format();
      const radius=+this.q('#map-radius').value;
      button.disabled=true;this.q('#map-example').disabled=true;this.q('#map-location').disabled=true;this.q('#map-radius').disabled=true;
      status.textContent='Loading public building and tree data for the displayed area. Busy providers can take a few minutes; your existing scene stays available.';
      this.controller=new AbortController();
      const data=await loadMapArea({row:tile.row,col:tile.col},{signal:this.controller.signal,onProgress:message=>{if(this.dialog.open&&requestId===this.requestId)status.textContent=message;}});
      if(!this.dialog.open||requestId!==this.requestId)return;
      const features=prepareMapFeatures(data,point,radius);
      if(!features.some(f=>f.type==='building'))throw Error('No buildings were found near this point. Check the coordinates, radius or source. Your current scene is unchanged.');
      this.point=point;this.data=data;this.features=features;this.radius=radius;this.timezone=timezone;
      const containing=features.find(f=>f.type==='building'&&f.contains),near=features.find(f=>f.type==='building'&&f.distance<40);
      this.ownId=(containing||near)?.id;
      status.textContent=`${data.meta.cached?'Loaded cached':'Downloaded'} ${sourceInfo(data.meta).label} area. ${containing?'The footprint containing your point is selected.':near?'The nearest building is selected; confirm it is yours.':'Select your building in the local preview.'} ${(data.meta.warnings||[]).join(' ')}`;
      this.q('#map-results').hidden=false;this.renderPreview();
    }catch(error){if(this.dialog.open&&requestId===this.requestId)status.textContent=error.name==='AbortError'?'Map lookup stopped. Your current scene is unchanged.':error.message;}
    finally{if(this.dialog.open&&requestId===this.requestId){button.disabled=false;this.q('#map-example').disabled=false;this.q('#map-location').disabled=false;this.q('#map-radius').disabled=false;installDiagnostics(this.q('#map-diagnostics'));}}
  }
  renderPreview(){
    const r=this.radius,points=ring=>ring.map(([x,z])=>`${x},${z}`).join(' ');
    const paths=this.features.filter(f=>f.type==='building').map(f=>{
      const path=f.rings.map(r=>`M${points(r)}Z`).join(' ');
      return `<path d="${path}" fill-rule="evenodd" class="${f.id===this.ownId?'selected':f.heightSource==='assumed'?'assumed':'mapped'}" data-map-building="${esc(f.id)}" role="button" tabindex="0" aria-label="Select ${esc(f.name)}"><title>${esc(f.name)} · ${f.height.toFixed(1)} m · ${heightLabel(f.heightSource)}</title></path>`;
    }).join('');
    const trees=this.features.filter(f=>f.type==='tree').map(f=>`<circle cx="${f.x}" cy="${f.z}" r="${f.radius}" class="tree"/>`).join('');
    this.q('#map-preview').innerHTML=`<svg viewBox="${-r} ${-r} ${r*2} ${r*2}" role="group" aria-label="Local building selection"><circle cx="0" cy="0" r="${r-1}" fill="none" stroke="#d7dfca" stroke-dasharray="3 3"/>${paths}${trees}<path d="M-3,0H3 M0,-3V3" class="map-point"/><text x="${r-14}" y="${-r+16}" font-size="9" fill="#6e825f">N ↑</text></svg>`;
    this.q('#map-preview').querySelectorAll('[data-map-building]').forEach(el=>{
      el.onclick=()=>{this.ownId=el.dataset.mapBuilding;this.renderPreview();};
      el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.ownId=el.dataset.mapBuilding;this.renderPreview();}};
    });
    const own=this.features.find(f=>f.id===this.ownId),buildings=this.features.filter(f=>f.type==='building'),treesCount=this.features.length-buildings.length;
    this.q('#map-building-info').textContent=own?`${own.name} · ${own.height.toFixed(1)} m · ${heightLabel(own.heightSource)}. This building becomes the installation building.`:'Select your installation building; all other nearby footprints become adjustable surroundings.';
    this.q('#map-coverage').textContent=`Found ${buildings.length} buildings and ${treesCount} mapped trees. ${this.features.filter(f=>f.heightSource==='assumed').length} heights are assumptions; floor-derived heights also need checking. Only mapped individual trees are included; missing vegetation must be added locally. Up to 120 nearby objects are used. Panels initially align with the façade closest to their current compass direction; check the façade, floor and position after generating.`;
    this.q('#apply-map').disabled=!own;
  }
  apply(){
    try{
      if(!this.data||!this.point)throw Error('Load a map area first.');
      const timezone=this.q('#map-timezone').value.trim();new Intl.DateTimeFormat('en',{timeZone:timezone}).format();
      const generated=generateScene(this.features,this.ownId,this.getSettings(),this.data.meta,this.radius);
      this.onApply(generated,{...this.point,timezone});this.dialog.close();
    }catch(error){this.q('#map-status').textContent=error.message;}
  }
}
