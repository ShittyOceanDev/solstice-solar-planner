import {defaults,clone,roundedLocation,LAST_YEAR,clamp,solarPosition,zonedTimestamp,prepareScene,transmission,panelGeometry,dayEstimate,consumptionPlan} from './model.js';
import {SolarScene} from './scene.js';
import {PANEL_PRESETS,applyPanelPreset,normalizePanelPreset} from './panels.js';
import {cleanFootprint,insideBuilding} from './geometry.js';
import {MAX_SCENE_OBJECTS,fitFootprint} from './maps.js';
import {MapGenerator} from './map-ui.js';
import {SetupWizard} from './onboarding.js';
import {loadWeatherYear} from './api.js';
import {cleanMesh} from './city-model.js';
import {SOURCES,sourceInfo} from './sources.js';
import {diagnosticsHtml,installDiagnostics} from './diagnostics-ui.js';
import {BROWSER_DOWNLOADS,HOSTED} from './runtime.js';

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const regions=[['Berlin region',52.5,13.4,'Europe/Berlin'],['Hamburg region',53.6,10,'Europe/Berlin'],['Munich region',48.1,11.6,'Europe/Berlin'],['Freiburg region',48,7.9,'Europe/Berlin'],['London region',51.5,-.1,'Europe/London'],['Paris region',48.9,2.3,'Europe/Paris'],['Madrid region',40.4,-3.7,'Europe/Madrid'],['Rome region',41.9,12.5,'Europe/Rome'],['New York region',40.7,-74,'America/New_York'],['Sydney region',-33.9,151.2,'Australia/Sydney']];
const limits={
  'location.lat':[-89.9,89.9],'location.lon':[-180,180],
  'panel.count':[1,12],'panel.watts':[1,1000],'panel.width':[.2,3],'panel.length':[.2,4],
  'panel.tilt':[0,90],'panel.azimuth':[0,359.9],'panel.floor':[0,59],'panel.mountHeight':[.1,10],'panel.offset':[-150,150],
  'panel.inverter':[1,30000],'panel.efficiency':[50,100],'panel.losses':[0,80],
  'panel.tempCoefficient':[-1,0],'panel.albedo':[0,.95],'panel.snowLoss':[0,100],
  'house.width':[.5,300],'house.depth':[.5,300],'house.floors':[1,60],'house.floorHeight':[2,8],'house.height':[.5,500],'house.rotation':[0,359.9],
  'consumption.annual':[0,1000000],'consumption.base':[0,100000],
  'costs.hardware':[0,1000000],'costs.installation':[0,1000000],'costs.subsidy':[0,1000000],
  'costs.importRate':[0,10],'costs.exportRate':[0,10],'costs.maintenance':[0,100000],
  'costs.escalation':[-10,20],'costs.degradation':[0,10],'costs.discount':[0,30],
  'costs.lifetime':[1,50],'costs.replacementYear':[0,50],'costs.replacementCost':[0,100000],'costs.uncertainty':[0,75]
};
const integers=['panel.count','panel.floor','house.floors','costs.lifetime','costs.replacementYear'];
const get=(s,path)=>path.split('.').reduce((v,k)=>v?.[k],s);
function put(s,path,v){const p=path.split('.'),k=p.pop();p.reduce((v,k)=>v[k],s)[k]=v;}
function cleanSource(value){
  const sourceId=value?.sourceId||(value?.provider==='OpenStreetMap'?'osm':null);if(!SOURCES[sourceId])return null;
  return {provider:SOURCES[sourceId].provider,sourceId,id:String(value.id||'').slice(0,100),heightSource:['mapped','official','levels','assumed','edited'].includes(value.heightSource)?value.heightSource:'assumed',footprintApproximate:!!value.footprintApproximate,edited:!!value.edited};
}
function cleanMapScene(value){
  const sourceId=value?.sourceId||(value?.provider==='OpenStreetMap'?'osm':null);
  if(!SOURCES[sourceId]||!Array.isArray(value.bounds)||value.bounds.length!==4||!value.bounds.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=180))return null;
  const out={provider:SOURCES[sourceId].provider,sourceId,warnings:Array.isArray(value.warnings)?value.warnings.slice(0,4).map(v=>String(v).slice(0,240)):[],bounds:value.bounds.slice(),downloadedAt:String(value.downloadedAt||'').slice(0,50),radius:[100,150,200].includes(value.radius)?value.radius:150};
  for(const key of ['buildingCount','treeCount','assumedHeights','levelsHeights','omitted'])out[key]=clamp(Math.round(+value[key]||0),0,10000);
  out.region=Array.isArray(value.region)&&value.region.length===2&&value.region.every(Number.isFinite)?value.region.slice():null;
  return out;
}
function sanitize(raw){
  const s=clone(defaults);
  for(const [key,value] of Object.entries(s)) {
    if(['location','panel','house','consumption','costs'].includes(key))for(const k of Object.keys(value)){const v=raw?.[key]?.[k];if(typeof v===typeof value[k]&&!Array.isArray(v))s[key][k]=v;}
  }
  for(const [path,[min,max]] of Object.entries(limits)){let v=+get(s,path);if(!Number.isFinite(v))v=get(defaults,path);put(s,path,clamp(integers.includes(path)?Math.round(v):v,min,max));}
  s.location=roundedLocation(s.location);s.location.name=s.location.name.slice(0,80);
  try{new Intl.DateTimeFormat('en',{timeZone:s.location.timezone}).format();}catch{s.location.timezone='UTC';}
  for(const [path,allowed] of Object.entries({'panel.side':['south','north','east','west','roof'],'panel.cooling':['open','roof'],'panel.wiring':['micro','string'],'consumption.profile':['evening','home','flat'],'costs.currency':['EUR','GBP','USD','AUD']}))if(!allowed.includes(get(s,path)))put(s,path,get(defaults,path));
  s.panel.floor=Math.min(s.panel.floor,s.house.floors-1);
  if(!Number.isFinite(raw?.house?.height))s.house.height=s.house.floors*s.house.floorHeight;
  s.panel=normalizePanelPreset(s.panel);
  s.house.footprint=cleanFootprint(raw?.house?.footprint);s.house.mesh=cleanMesh(raw?.house?.mesh);s.house.source=cleanSource(raw?.house?.source);s.mapScene=cleanMapScene(raw?.mapScene);
  if(Array.isArray(raw?.consumption?.monthly)&&raw.consumption.monthly.length===12)s.consumption.monthly=raw.consumption.monthly.map(v=>clamp(Number.isFinite(+v)?+v:0,0,1000000));
  if(Array.isArray(raw?.obstacles))s.obstacles=raw.obstacles.slice(0,MAX_SCENE_OBJECTS).map((o,i)=>{
    const type=o.type==='tree'?'tree':'building';
    const b=type==='tree'?{height:10,radius:3,crown:6,leafOn:8,leafOff:55,deciduous:true,leafStart:4,leafEnd:10}:{width:8,depth:8,height:9,rotation:0};
    const v={id:`object-${i}`,type,name:String(o.name||`Object ${i+1}`).slice(0,60),x:0,z:0,...b};
    for(const key of Object.keys(v))if(typeof v[key]==='number')v[key]=Number.isFinite(+o[key])?+o[key]:v[key];
    v.x=clamp(v.x,-500,500);v.z=clamp(v.z,-500,500);v.height=clamp(v.height,type==='building'?-100:.5,500);v.source=cleanSource(o.source);
    if(type==='tree'){v.radius=clamp(v.radius,.2,30);v.crown=clamp(v.crown,.5,v.height);v.leafOn=clamp(v.leafOn,0,100);v.leafOff=clamp(v.leafOff,0,100);v.deciduous=o.deciduous!==false;v.leafStart=clamp(Math.round(v.leafStart),1,12);v.leafEnd=clamp(Math.round(v.leafEnd),1,12);}
    else{v.width=clamp(v.width,.5,300);v.depth=clamp(v.depth,.5,300);v.rotation=((v.rotation%360)+360)%360;v.footprint=cleanFootprint(o.footprint);v.mesh=cleanMesh(o.mesh);v.base=clamp(Number.isFinite(o.base)?o.base:0,-150,v.height-.1);}
    return v;
  });
  if(typeof raw?.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.date)&&Number.isFinite(Date.parse(raw.date)))s.date=raw.date;
  s.hour=clamp(Number.isFinite(raw?.hour)?raw.hour:13,0,23.75);s.dayMode=raw?.dayMode==='historical'?'historical':'typical';
  s.weatherYears=[1,5,10].includes(raw?.weatherYears)?raw.weatherYears:5;
  return s;
}
let settings,hasSavedProject=false,setupSeen=false;try{const stored=JSON.parse(localStorage.getItem('solstice-project-v1'));hasSavedProject=!!stored&&typeof stored==='object';settings=sanitize(stored);setupSeen=!!localStorage.getItem('solstice-onboarding-v1');}catch{settings=clone(defaults);}
let sceneUndo;try{sceneUndo=JSON.parse(localStorage.getItem('solstice-scene-undo-v1'));}catch{sceneUndo=null;}
let datasets=[],result=null,tab='site',selected=settings.obstacles[0]?.id,revision=0,workerRevision=0,loading=false,progress='',timer,animation,scene,dayCache='',dayResult,dayPrepared,dayPreparedKey='';
function createCalculationWorker(){
  const embedded=document.getElementById('portable-worker');
  if(!embedded)return new Worker('/worker.js',{type:'module'});
  const url=URL.createObjectURL(new Blob([embedded.textContent],{type:'text/javascript'}));
  const worker=new Worker(url);
  // A reply confirms the worker has loaded its source.
  const release=()=>URL.revokeObjectURL(url);
  worker.addEventListener('message',release,{once:true});
  worker.addEventListener('error',release,{once:true});
  return worker;
}
const worker=createCalculationWorker();
const number=(n,d=0)=>new Intl.NumberFormat('en-GB',{maximumFractionDigits:d,minimumFractionDigits:d}).format(n);
const money=(n,d=0)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:settings.costs.currency,maximumFractionDigits:d,minimumFractionDigits:d}).format(n);
const symbol=()=>new Intl.NumberFormat('en-GB',{style:'currency',currency:settings.costs.currency}).formatToParts(0).find(p=>p.type==='currency').value;
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('show');clearTimeout(timer);timer=setTimeout(()=>$('#toast').classList.remove('show'),5500);}
function save(){try{localStorage.setItem('solstice-project-v1',JSON.stringify(settings));hasSavedProject=true;$('#save-status').textContent='Saved locally';}catch{$('#save-status').textContent='Storage unavailable';}}
function field(label,path,unit='',options={}){
  const value=get(settings,path)??0,[min,max]=limits[path]||[options.min??0,options.max??100000];
  const type=options.type||'number';
  return `<div class="field"><label for="f-${path}">${escape(label)}${type==='range'?`<output>${number(value,options.digits||0)}${escape(unit)}</output>`:''}</label>${type==='range'?`<input id="f-${path}" data-path="${path}" type="range" min="${min}" max="${max}" step="${options.step??1}" value="${value}">`:`<div class="input-unit"><input id="f-${path}" data-path="${path}" type="${type}" ${type==='number'?`min="${min}" max="${max}" step="${options.step??'any'}"`:''} value="${escape(value)}">${unit?`<span>${escape(unit)}</span>`:''}</div>`}</div>`;
}
function select(label,path,choices){return `<div class="field"><label for="f-${path}">${escape(label)}</label><select id="f-${path}" data-path="${path}">${choices.map(([v,l])=>`<option value="${escape(v)}" ${get(settings,path)==v?'selected':''}>${escape(l)}</option>`).join('')}</select></div>`;}
const row=(...fields)=>`<div class="form-row">${fields.join('')}</div>`;
const heading=(title,text)=>`<h3>${title}</h3><p class="inspector-intro">${text}</p>`;
const divider=()=>'<hr class="divider">';
function panelPresetDetails(){
  const p=PANEL_PRESETS.find(p=>p.id===settings.panel.preset);
  return p?`<strong>${escape(p.technology)}</strong><span>${escape(p.model)}</span><span>${p.watts} W · ${number(p.length*1000)} × ${number(p.width*1000)} mm · ${number(p.tempCoefficient,2)}%/°C</span><a href="${escape(p.source)}" target="_blank" rel="noreferrer">Manufacturer datasheet ↗</a><small>Fills power, size and temperature coefficient. You can edit every value; then the selection becomes Custom. Enter your own purchase price.</small>`:'<small>Choose a module to fill in its specifications, or enter your own below. Existing project values are preserved.</small>';
}
function mapStatusCard(){
  const m=settings.mapScene;
  const counts=settings.obstacles.filter(o=>o.source),all=[settings.house,...counts];
  const assumed=all.filter(o=>o.source?.heightSource==='assumed').length,levels=all.filter(o=>o.source?.heightSource==='levels').length;
  const stale=m?.region&&(m.region[0]!==settings.location.lat||m.region[1]!==settings.location.lon);
  return `<div class="map-setup-card"><strong>${m?escape(sourceInfo(m).label)+' surroundings':'Start with your actual surroundings'}</strong><p>${m?`${counts.filter(o=>o.type==='building').length+1} mapped buildings · ${counts.filter(o=>o.type==='tree').length} mapped trees. ${all.some(o=>o.source?.heightSource==='official')?all.filter(o=>o.source?.heightSource==='official').length+' imported model heights; ':''}${assumed} assumed; ${levels} estimated from floors; ${all.filter(o=>o.source?.heightSource==='edited').length} edited.${stale?' Weather region changed — regenerate the scene for this location.':''}`:'Generate nearby buildings and mapped trees from a location, then adjust the result.'}</p><button class="button full" data-open-map>${m?'Regenerate from location ↗':'Generate from location ↗'}</button>${sceneUndo?'<button class="map-undo" data-undo-map>Undo last map generation</button>':''}${m?.omitted?`<p>Scene limit: ${m.omitted} additional objects were omitted; use a smaller radius for a denser scene.</p>`:''}${m?.warnings?.map(v=>`<p>${escape(v)}</p>`).join('')||''}</div>`;
}
function objectSourceNote(o){
  if(!o?.source)return '';
  const description={mapped:'height recorded in the map',official:'height from the official model',levels:'height estimated from mapped floor count',assumed:'height assumed — please check',edited:'height edited by you'}[o.source.heightSource];
  return `<p class="help object-source">${escape(sourceInfo(o.source).label)} · ${escape(o.source.id)}<br>${description}${o.source.edited?' · geometry edited':''}. ${o.mesh?'Walls and roofs scale and rotate with these controls. Ground offsets use your building as the reference.':o.footprint?'Original footprint scales and rotates with these controls.':''}${o.source.footprintApproximate?' Selection outline combines several ground polygons; the 3D surfaces are retained.':''}</p>`;
}
function renderInspector(){
  $$('.setup-nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  let html='';
  if(tab==='site'){
    html=heading('A place for your panels','Start with a region and your installation. Every setting updates your outlook.')+
    `<div class="field"><label for="region">Approximate location</label><select id="region">${regions.map((r,i)=>`<option value="${i}" ${settings.location.name===r[0]?'selected':''}>${r[0]}</option>`).join('')}<option value="custom" ${!regions.some(r=>r[0]===settings.location.name)?'selected':''}>Custom region</option></select></div>`+
    `<div class="privacy-note"><strong>◎ Your location stays approximate</strong>Only ${settings.location.lat.toFixed(2)}°, ${settings.location.lon.toFixed(2)}° is sent for weather, when you choose to load it. Your scene stays here.</div>`+
    mapStatusCard()+
    `<details><summary>Coordinates & privacy</summary>${row(field('Latitude','location.lat','°'),field('Longitude','location.lon','°'))}${select('Round to a grid','location.grid',[[.1,'0.1° · about 11 km north–south'],[.25,'0.25° · about 28 km'],[.5,'0.5° · about 56 km'],[1,'1° · about 111 km']])}${field('Time zone (IANA)','location.timezone','',{type:'text'})}<p class="help">No GPS, address lookup or remote map tiles. Coordinates are rounded before saving or requesting weather. Grid width varies with latitude.</p></details>`+
    divider()+`<div class="section-title">Your solar system</div>`+
    `<div class="field"><label for="panel-preset">Panel type / model</label><select id="panel-preset"><option value="custom" ${settings.panel.preset==='custom'?'selected':''}>Custom / manual specifications</option>${PANEL_PRESETS.map(p=>`<option value="${p.id}" ${settings.panel.preset===p.id?'selected':''}>${escape(p.label)}</option>`).join('')}</select></div><div class="preset-details" id="panel-preset-details">${panelPresetDetails()}</div>`+
    row(field('Number of panels','panel.count','',{step:1}),field('Power per panel','panel.watts','W'))+
    field('Inverter AC limit','panel.inverter','W')+
    select('Install on','panel.side',[['south','South façade'],['east','East façade'],['west','West façade'],['north','North façade'],['roof','Flat roof']])+
    row(field('Floor · ground = 0','panel.floor','',{step:1}),field('Height above floor','panel.mountHeight','m'))+
    field('Horizontal position on façade','panel.offset','m')+
    field('Panel tilt · 0° = flat','panel.tilt','°',{type:'range'})+field('Panel direction · 180° = south','panel.azimuth','°',{type:'range'})+
    `<details><summary>Building dimensions</summary>${objectSourceNote(settings.house)}${row(field('Building width','house.width','m'),field('Building depth','house.depth','m'))}${row(field('Number of floors','house.floors','',{step:1}),field('Floor height','house.floorHeight','m'))}${field('Total building height','house.height','m')}${field('Building rotation','house.rotation','°',{type:'range'})}<p class="help">Total height includes the roof. Editing floor count or floor height resets total height to their product; adjust total height afterward for the roof. Façade sides rotate with the building. Panel direction uses true north.</p></details>`+
    `<details><summary>Panel & electrical model</summary>${row(field('Panel width','panel.width','m'),field('Panel length','panel.length','m'))}${select('Electrical arrangement','panel.wiring',[['micro','Independent module MPPT'],['string','Series string · conservative shade']])}${select('Mounting ventilation','panel.cooling',[['open','Open rack / ventilated balcony'],['roof','Roof / poorly ventilated']])}${row(field('Inverter efficiency','panel.efficiency','%'),field('Other system losses','panel.losses','%'))}${field('Temperature coefficient','panel.tempCoefficient','%/°C')}${row(field('Ground reflectance','panel.albedo'),field('Winter snow loss','panel.snowLoss','%'))}<p class="help">Other losses combine soiling, cabling, availability and mismatch. Snow loss is a user assumption for Dec–Feb (Jun–Aug in the southern hemisphere).</p></details>`;
  }else if(tab==='scene'){
    const o=settings.obstacles.find(o=>o.id===selected);if(!o&&settings.obstacles.length)selected=settings.obstacles[0].id;
    html=heading('Give your sun some context','Generate a local scene, then correct or add objects. Positions are metres east and south of your building.')+mapStatusCard()+
      `<div class="object-actions"><button class="small-button" id="add-building">＋ Building</button><button class="small-button" id="add-tree">＋ Tree</button></div>`+
      `<div class="obstacle-list">${settings.obstacles.map(o=>`<button class="obstacle-item ${selected===o.id?'active':''}" data-object="${escape(o.id)}">${o.type==='tree'?'♧':'▧'} ${escape(o.name)}<span>${number(o.height,1)} m</span></button>`).join('')||'<p class="help">A clear horizon. Add an object to model local shading.</p>'}</div>`;
    const object=settings.obstacles.find(o=>o.id===selected);
    if(object){const base=`obstacles.${settings.obstacles.indexOf(object)}`;
      html+=divider()+objectSourceNote(object)+field('Object name',`${base}.name`,'',{type:'text'})+row(field('East / west (−)',''+base+'.x','m',{min:-500,max:500}),field('South / north (−)',base+'.z','m',{min:-500,max:500}))+field(object.mesh?'Top above your ground':'Height',base+'.height','m',{min:object.mesh?-100:.5,max:500});
      if(object.type==='building')html+=row(field('Width',base+'.width','m',{min:.5,max:300}),field('Depth',base+'.depth','m',{min:.5,max:300}))+field('Orientation',base+'.rotation','°',{type:'range',max:359})+field('Base above your ground',base+'.base','m',{min:-150,max:499})+(object.footprint?'<button class="small-button" id="simplify-footprint">Replace this building with a box</button>':'');
      else html+=row(field('Canopy radius',base+'.radius','m',{min:.2,max:30}),field('Canopy height',base+'.crown','m',{min:.5,max:150}))+select('Foliage type',base+'.deciduous',[[true,'Deciduous · seasonal leaves'],[false,'Evergreen · year round']])+row(field('Light through leaves',base+'.leafOn','%',{max:100}),field('Light through bare tree',base+'.leafOff','%',{max:100}))+row(field('Leaf-on start month',base+'.leafStart','',{min:1,max:12,step:1}),field('Leaf-on end month',base+'.leafEnd','',{min:1,max:12,step:1}))+`<p class="help">Leaf months use northern seasons; the model shifts them six months in the southern hemisphere. Tree crowns are porous ellipsoids. Visual shadows are illustrative; calculations use your transmission values.</p>`;
      html+='<button class="delete-button" id="delete-object">Remove this object</button>';
    }
    html+=divider()+`<details><summary>Import local map geometry</summary><p class="help">Import a GeoJSON FeatureCollection of building polygons or tree points. Enter your installation’s origin locally; these exact coordinates are discarded after conversion. No map provider is contacted.</p><div class="form-row"><div class="field"><label for="origin-lat">Local origin latitude</label><input id="origin-lat" type="number" step="any" placeholder="Latitude"></div><div class="field"><label for="origin-lon">Local origin longitude</label><input id="origin-lon" type="number" step="any" placeholder="Longitude"></div></div><button id="import-map" class="small-button">Import GeoJSON</button><input id="map-file" type="file" accept=".geojson,.json,application/geo+json" hidden><p class="help">Properties: height, building:levels, name, natural=tree, diameter_crown. Missing heights default to 9 m (buildings) or 8 m (trees). Footprints within 200 m are retained with their courtyards; tree points become canopy shapes. Inspect and correct the result.</p></details>`;
  }else if(tab==='energy'){
    const plan=consumptionPlan(settings,LAST_YEAR),floor=plan.floor;
    html=heading('When do you use energy?','Electricity used while the panels generate avoids your retail electricity price.')+
      field('Annual household consumption','consumption.annual','kWh')+field('Always-on baseline','consumption.base','W')+
      `<div class="privacy-note" id="baseline-note"><strong>${number(floor)} kWh / year always on</strong>Your baseline is included in the annual total. The remaining energy follows the profile below.</div>`+
      `<div id="baseline-warning">${settings.consumption.annual<floor?`<div class="warning">The baseline exceeds your annual target. The model uses ${number(floor)} kWh so that hourly demand stays physically consistent.</div>`:''}</div>`+
      select('Daily usage profile','consumption.profile',[['evening','Away by day · morning & evening peaks'],['home','Home by day · more daytime use'],['flat','Evenly spread over 24 hours']])+
      divider()+`<div class="section-title">Monthly household consumption</div><p class="help">Enter monthly kWh. These are normalized to your annual target after keeping the baseline in every hour. Each value acts as a seasonal weight; the effective total is shown below.</p><div class="month-inputs">${months.map((m,i)=>field(m,`consumption.monthly.${i}`,'',{min:0,max:1000000})).join('')}</div><button class="button full secondary" id="monthly-total">Use monthly sum as annual total</button><p class="help" id="monthly-note">Entered sum: ${number(settings.consumption.monthly.reduce((a,b)=>a+b,0))} kWh. Modelled total: ${number(plan.total)} kWh.</p><p class="help">Hourly matching estimates self-consumption. Appliance spikes within the hour, batteries and demand shifting are not simulated. No battery is assumed.</p>`;
  }else if(tab==='costs'){
    html=heading('Make the investment add up','Payback reflects what you use, what you export, and the costs over the system’s life.')+
      select('Currency','costs.currency',[['EUR','Euro · EUR'],['GBP','Pound sterling · GBP'],['USD','US dollar · USD'],['AUD','Australian dollar · AUD']])+
      row(field('Buying costs','costs.hardware',symbol()),field('Installation','costs.installation',symbol()))+
      field('Upfront subsidy / rebate','costs.subsidy',symbol())+
      row(field('Electricity import price','costs.importRate',`${symbol()}/kWh`,{step:.01}),field('Export payment','costs.exportRate',`${symbol()}/kWh`,{step:.01}))+
      field('Annual maintenance','costs.maintenance',symbol())+
      divider()+row(field('Electricity price growth','costs.escalation','%/yr'),field('Panel degradation','costs.degradation','%/yr'))+
      row(field('System lifetime','costs.lifetime','yrs',{step:1}),field('Discount rate','costs.discount','%'))+
      row(field('Inverter replacement year','costs.replacementYear','',{step:1}),field('Replacement cost','costs.replacementCost',symbol()))+
      `<p class="help">Replacement year 0 disables replacement. All amounts use your chosen currency; no currency conversion. Enter your own tariff, costs, rebates and taxes.</p>`+
      field('Generation sensitivity','costs.uncertainty','±%',{type:'range'})+
      `<div class="privacy-note"><strong>A range, not a promise</strong>The range reruns cash flows at ±${settings.costs.uncertainty}% generation and recalculates hourly self-consumption. It is not a confidence interval. Future tariffs are assumptions.</div>`;
  }else{
    html=heading('Real weather. Honest estimates.','Use hourly reanalysis to reconstruct production, or average multiple complete years for a longer-term outlook.')+
      `<div class="privacy-note"><strong>◎ What leaves your device</strong>Rounded coordinates (${settings.location.lat.toFixed(2)}, ${settings.location.lon.toFixed(2)})${BROWSER_DOWNLOADS?' and the requested year go to Open-Meteo directly, which sees your connection’s IP.':`, the privacy grid and requested year go to ${HOSTED?'the website server, then Open-Meteo. The host receives your IP; Open-Meteo sees the server’s IP.':'your local server, then Open-Meteo, which sees your connection’s IP.'}`} Panel, building, tree, usage and cost data stay in your browser.</div>`+
      `<div class="field"><label for="weather-span">Weather sample</label><select id="weather-span"><option value="1" ${settings.weatherYears===1?'selected':''}>Last year only · ${LAST_YEAR}</option><option value="5" ${settings.weatherYears===5?'selected':''}>5-year average · ${LAST_YEAR-4}–${LAST_YEAR}</option><option value="10" ${settings.weatherYears===10?'selected':''}>10-year average · ${LAST_YEAR-9}–${LAST_YEAR}</option></select></div><button class="button full" id="load-weather" ${loading?'disabled':''}>${loading?'Loading hourly weather…':'↓ Load historical weather'}</button>`+
      `<div id="weather-progress" class="loading-state">${escape(progress)}</div>`+diagnosticsHtml('weather-diagnostics')+
      `<div class="data-years">${datasets.slice().sort((a,b)=>b.meta.year-a.meta.year).map(d=>`<div class="data-year"><span>${d.meta.year} · ERA5 hourly</span><strong>${d.meta.cached?'Cached locally':'Loaded'}</strong></div>`).join('')||'<p class="help">No downloaded weather for this region. The dashboard uses clearly labelled synthetic sample weather.</p>'}</div>`+
      `<p class="help">Open-Meteo / Copernicus ERA5 · roughly 25 km weather grid · hourly means · CC BY 4.0. Several years can take a minute or more. Cached years do not need another external download.</p>`+
      `<button class="button full secondary" id="export-weather" ${!datasets.length?'disabled':''}>Export loaded weather</button><button class="button full secondary" id="export-hourly" ${!datasets.some(d=>d.meta.year===LAST_YEAR)?'disabled':''}>Export ${LAST_YEAR} hourly generation CSV</button><button class="button full secondary" id="import-weather">Import offline weather</button><input id="weather-file" type="file" accept=".json,application/json" hidden>`+
      `<p class="help">Offline weather exports include source metadata and coarse coordinates. A project file contains settings and relative geometry, not hourly weather.</p>`+
      divider()+`<button class="button full secondary" id="explain-model">Read model & limitations ↗</button><p class="help"><a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noreferrer">Weather documentation</a> · <a href="https://open-meteo.com/en/terms" target="_blank" rel="noreferrer">Provider terms & privacy</a><br>The free API is for non-commercial use. No API key or map account is required.</p>`;
  }
  $('#inspector').innerHTML=html;bindInspector();
}
function chooseTab(value){tab=value;renderInspector();if(innerWidth<741)window.scrollTo({top:0,behavior:'smooth'});}
function bindMapCards(){
  $$('[data-open-map]').forEach(button=>button.onclick=()=>mapGenerator.open());
  $$('[data-undo-map]').forEach(button=>button.onclick=undoMapGeneration);
}
function bindInspector(){
  installDiagnostics($('#weather-diagnostics'));
  bindMapCards();
  $('#simplify-footprint')?.addEventListener('click',()=>{const o=settings.obstacles.find(o=>o.id===selected);o.footprint=null;o.mesh=null;if(o.source)o.source.edited=true;save();renderInspector();updateAll();});
  $('#panel-preset')?.addEventListener('change',e=>{
    settings.panel=applyPanelPreset(settings.panel,e.target.value);
    save();refreshInspectorValues();updateAll();
  });
  $$('[data-path]').forEach(el=>{
    if(el.type==='range')el.addEventListener('input',()=>{
      put(settings,el.dataset.path,+el.value);el.closest('.field').querySelector('output').textContent=`${number(+el.value)}°`;
      if(el.dataset.path==='costs.uncertainty')el.closest('.field').querySelector('output').textContent=`±${el.value}%`;
      scene?.update(settings);dayCache='';updateDay();
    });
    el.addEventListener('change',()=>{
      const path=el.dataset.path,oldLoc=locationKey();
      let value=el.tagName==='SELECT'?el.value:el.type==='number'||el.type==='range'?+el.value:el.value;
      if(typeof get(settings,path)==='boolean')value=value==='true';
      else if(typeof get(settings,path)==='number')value=+value;
      put(settings,path,value);
      if(path==='house.floors'||path==='house.floorHeight')settings.house.height=settings.house.floors*settings.house.floorHeight;
      if(path.startsWith('obstacles.')){const object=settings.obstacles[+path.split('.')[1]];if(object?.source){object.source.edited=true;if(path.endsWith('.height'))object.source.heightSource='edited';}}
      if(path.startsWith('house.')&&settings.house.source){settings.house.source.edited=true;if(['house.floors','house.floorHeight','house.height'].includes(path))settings.house.source.heightSource='edited';}
      if(path.startsWith('location.lat')||path.startsWith('location.lon'))settings.location.name='Custom region';
      settings=sanitize(settings);selected=settings.obstacles.find(o=>o.id===selected)?.id||settings.obstacles[0]?.id;
      if(oldLoc!==locationKey()){datasets=[];restoreWeather();}
      save();if(path==='costs.currency')renderInspector();else refreshInspectorValues();updateAll();
    });
  });
  $('#region')?.addEventListener('change',e=>{
    if(e.target.value==='custom'){settings.location.name='Custom region';save();renderInspector();return;}
    const [name,lat,lon,timezone]=regions[+e.target.value];settings.location=roundedLocation({...settings.location,name,lat,lon,timezone});datasets=[];save();renderInspector();updateAll();restoreWeather();
  });
  $$('[data-object]').forEach(b=>b.onclick=()=>{selected=b.dataset.object;renderInspector();});
  $('#add-building')?.addEventListener('click',()=>addObject('building'));
  $('#add-tree')?.addEventListener('click',()=>addObject('tree'));
  $('#delete-object')?.addEventListener('click',()=>{settings.obstacles=settings.obstacles.filter(o=>o.id!==selected);settings=sanitize(settings);selected=settings.obstacles[0]?.id;save();renderInspector();updateAll();});
  $('#monthly-total')?.addEventListener('click',()=>{settings.consumption.annual=settings.consumption.monthly.reduce((a,b)=>a+b,0);save();renderInspector();updateAll();});
  $('#load-weather')?.addEventListener('click',()=>loadWeather(+$('#weather-span').value));
  $('#explain-model')?.addEventListener('click',showModel);
  $('#export-weather')?.addEventListener('click',()=>download('solstice-weather.json',JSON.stringify({format:'solstice-weather-v1',datasets}), 'application/json'));
  $('#export-hourly')?.addEventListener('click',exportHourly);
  $('#import-weather')?.addEventListener('click',()=>$('#weather-file').click());
  $('#weather-file')?.addEventListener('change',importWeather);
  $('#import-map')?.addEventListener('click',()=>{
    if(!$('#origin-lat').value||!$('#origin-lon').value){toast('Enter the installation origin locally before importing geographic map data.');return;}
    $('#map-file').click();
  });
  $('#map-file')?.addEventListener('change',importMap);
}
function refreshInspectorValues(){
  const card=$('#inspector .map-setup-card');if(card){card.outerHTML=mapStatusCard();bindMapCards();}
  $$('[data-path]').forEach(el=>{
    el.value=String(get(settings,el.dataset.path));
    if(el.type==='range'){
      const path=el.dataset.path;
      el.closest('.field').querySelector('output').textContent=path==='costs.uncertainty'?`±${el.value}%`:`${number(+el.value)}°`;
    }
  });
  $$('[data-object]').forEach(el=>{
    const o=settings.obstacles.find(o=>o.id===el.dataset.object);
    if(o)el.innerHTML=`${o.type==='tree'?'♧':'▧'} ${escape(o.name)}<span>${number(o.height,1)} m</span>`;
  });
  const sourceNote=$('#inspector .object-source');
  if(sourceNote)sourceNote.outerHTML=objectSourceNote(tab==='site'?settings.house:settings.obstacles.find(o=>o.id===selected));
  if(tab==='site'){
    $('#panel-preset').value=settings.panel.preset;
    $('#panel-preset-details').innerHTML=panelPresetDetails();
    const regionIndex=regions.findIndex(r=>r[0]===settings.location.name);$('#region').value=regionIndex<0?'custom':String(regionIndex);
    $('#inspector .privacy-note').innerHTML=`<strong>◎ Your location stays approximate</strong>Only ${settings.location.lat.toFixed(2)}°, ${settings.location.lon.toFixed(2)}° is sent for weather, when you choose to load it. Your scene stays here.`;
  }
  if(tab==='energy'){
    const plan=consumptionPlan(settings,LAST_YEAR);
    $('#baseline-note strong').textContent=`${number(plan.floor)} kWh / year always on`;
    $('#baseline-warning').innerHTML=settings.consumption.annual<plan.floor?`<div class="warning">The baseline exceeds your annual target. The model uses ${number(plan.floor)} kWh so that hourly demand stays physically consistent.</div>`:'';
    $('#monthly-note').textContent=`Entered sum: ${number(settings.consumption.monthly.reduce((a,b)=>a+b,0))} kWh. Modelled total: ${number(plan.total)} kWh.`;
  }
}
function addObject(type){
  if(settings.obstacles.length>=MAX_SCENE_OBJECTS)return toast(`The scene supports up to ${MAX_SCENE_OBJECTS} surrounding objects.`);
  const o=type==='tree'?{type,name:'New tree',x:6,z:14,height:8,radius:2.5,crown:5,leafOn:8,leafOff:55,deciduous:true,leafStart:4,leafEnd:10}:{type,name:'New building',x:-12,z:5,width:7,depth:7,height:9,rotation:0};
  settings.obstacles.push(o);settings=sanitize(settings);selected=settings.obstacles.at(-1).id;save();renderInspector();updateAll();
}
function updateAll(){
  revision++;dayCache='';scene?.update(settings);updateLocation();updateDay();
  clearTimeout(window.computeTimer);$('#save-status').textContent='Calculating…';
  window.computeTimer=setTimeout(()=>{workerRevision=revision;worker.postMessage({id:workerRevision,settings,datasets});},180);
}
worker.onmessage=({data})=>{if(data.id!==revision)return;if(data.error){toast(data.error);$('#save-status').textContent='Calculation failed';return;}result=data.result;renderResults();$('#save-status').textContent='Saved locally';};
worker.onerror=e=>{toast(`Calculation worker error: ${e.message}`);$('#save-status').textContent='Calculation failed';};
function updateLocation(){
  $('#location-label').innerHTML=`${escape(settings.location.name)}<small>Approximate location · ${settings.location.grid}° grid</small>`;
  const b=$('#data-banner');b.classList.toggle('success',datasets.length>0);
  if(datasets.length){const yrs=datasets.map(d=>d.meta.year).sort();b.querySelector('strong').textContent=`Historical weather · ${yrs.length>1?`${yrs[0]}–${yrs.at(-1)}`:yrs[0]}`;b.querySelector(':scope > div > span').textContent=`${yrs.length}-year sample · Open-Meteo / ERA5 · modelled production`;b.querySelector('button').innerHTML='Manage data <span>↗</span>';}
  else{b.querySelector('strong').textContent='Illustrative weather is active';b.querySelector(':scope > div > span').textContent='Load real historical weather to calculate your regional outlook.';b.querySelector('button').innerHTML='Load weather <span>↗</span>';}
  $('.scene-source').textContent=settings.mapScene?sourceInfo(settings.mapScene).label+' surroundings':'Manual / imported scene';
  const summary=$('#scene-map-summary');
  if(settings.mapScene){
    const stale=settings.mapScene.region&&(settings.mapScene.region[0]!==settings.location.lat||settings.mapScene.region[1]!==settings.location.lon);
    const info=sourceInfo(settings.mapScene),hasTrees=settings.obstacles.some(o=>o.type==='tree'&&o.source?.sourceId==='osm');
    summary.innerHTML=`<a href="${info.url}" target="_blank" rel="noreferrer">${escape(info.attribution)}</a>${hasTrees&&settings.mapScene.sourceId!=='osm'?'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Trees: © OpenStreetMap contributors · ODbL</a>':''}<span>${stale?'Region changed — regenerate surroundings.':settings.house.mesh?'Official roof and wall surfaces · check foliage and recent changes.':'Editable footprints · check estimated heights and unmapped foliage.'}</span>`;
  }else summary.innerHTML='<span>Example geometry · generate a scene for your location</span>';
}
function applyGeneratedScene(generated,point){
  sceneUndo=clone(settings);try{localStorage.setItem('solstice-scene-undo-v1',JSON.stringify(sceneUndo));}catch{toast('Undo is available for this session; browser storage is full.');}
  const oldLocation=locationKey();
  const newLocation=roundedLocation({...settings.location,lat:point.lat,lon:point.lon,timezone:point.timezone});
  if(Math.abs(newLocation.lat-settings.location.lat)>.3||Math.abs(newLocation.lon-settings.location.lon)>.3)newLocation.name='Selected map region';
  generated.mapScene.region=[newLocation.lat,newLocation.lon];
  settings=sanitize({...settings,...generated,location:newLocation});selected=settings.obstacles[0]?.id;
  if(oldLocation!==locationKey()){datasets=[];restoreWeather();}
  save();tab='scene';renderInspector();updateAll();scene?.reset();toast('Your map surroundings are ready. Select any object to adjust it.');
}
function undoMapGeneration(){
  if(!sceneUndo)return;
  const oldLocation=locationKey();settings=sanitize({...settings,house:sceneUndo.house,obstacles:sceneUndo.obstacles,mapScene:sceneUndo.mapScene,location:sceneUndo.location,panel:{...settings.panel,side:sceneUndo.panel.side,azimuth:sceneUndo.panel.azimuth,offset:sceneUndo.panel.offset||0,floor:sceneUndo.panel.floor}});sceneUndo=null;try{localStorage.removeItem('solstice-scene-undo-v1');}catch{}
  if(oldLocation!==locationKey()){datasets=[];restoreWeather();}
  selected=settings.obstacles[0]?.id;save();renderInspector();updateAll();scene?.reset();toast('Restored the scene from before map generation.');
}
function updateDay(){
  $('#scene-date').value=settings.date;$('#scene-time').value=settings.hour;
  $('#time-label').textContent=`${String(Math.floor(settings.hour)).padStart(2,'0')}:${String(Math.round(settings.hour%1*60)).padStart(2,'0')}`;
  $('#time-label').title=settings.location.timezone;
  const zoneName=new Intl.DateTimeFormat('en-GB',{timeZone:settings.location.timezone,timeZoneName:'short'}).formatToParts(new Date(zonedTimestamp(settings.date,settings.hour,settings.location.timezone))).find(p=>p.type==='timeZoneName')?.value||settings.location.timezone;
  $('.time-control label').textContent=`Time of day · ${zoneName}`;
  $('#day-heading').textContent=new Date(settings.date+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'long'});
  $$('.day-mode button').forEach(b=>b.classList.toggle('active',b.dataset.mode===settings.dayMode));
  const time=zonedTimestamp(settings.date,settings.hour,settings.location.timezone),sun=solarPosition(time,settings.location.lat,settings.location.lon);
  $('#sun-elevation').textContent=`${number(sun.altitude,1)}°`;
  const geometryKey=JSON.stringify([settings.house,settings.panel,settings.obstacles,settings.location.lat]);
  if(geometryKey!==dayPreparedKey){dayPrepared=prepareScene(settings);dayPreparedKey=geometryKey;}
  const prepared=dayPrepared,points=prepared.geometry.modules.flatMap(m=>m.points);
  $('#placement-warning').hidden=!points.some(p=>prepared.objects.some(o=>o.type==='building'&&insideBuilding(p,o)));
  const tr=sun.altitude<=0?0:points.reduce((n,p)=>n+transmission(p,sun.vector,prepared.objects,+settings.date.slice(5,7),settings.location.lat),0)/points.length;
  $('#sun-exposure').textContent=sun.altitude<=0?'Below horizon':`${number(tr*100)}%`;
  const key=JSON.stringify([settings.date,settings.dayMode,revision,datasets.map(d=>d.meta.year)]);
  if(key!==dayCache){dayResult=dayEstimate(settings,datasets,settings.date,prepared);dayCache=key;}
  const d=dayResult;
  $('#day-energy').innerHTML=d.available?`${number(d.energy,2)} <small>kWh</small>`:'— <small>kWh</small>';
  $('#day-caption').textContent=d.available?(settings.dayMode==='historical'?'Reconstructed from historical weather':'Estimated generation for this calendar day'):'No weather loaded for this date’s year';
  $('#day-note').textContent=settings.dayMode==='historical'?'Historical weather reconstruction, not measured panel output.':datasets.length?`Average of this calendar day in ${d.samples||0} loaded weather years. Not a forecast.`:'Synthetic sample weather. Load regional data for a useful estimate.';
  $('#daily-shade').textContent=d.available&&d.unshaded>0?`${number((1-d.energy/d.unshaded)*100,1)}%`:'—';
  const values=d.available?d.hourly:Array(24).fill(0),max=Math.max(1,...values),pts=values.map((v,i)=>`${i/23*200},${74-v/max*62}`);
  $('#day-chart').innerHTML=`<svg viewBox="0 0 200 78" preserveAspectRatio="none" aria-label="Hourly generation profile in watts"><defs><linearGradient id="day-fill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#c5d6a8" stop-opacity=".7"/><stop offset="1" stop-color="#e9eedf" stop-opacity=".15"/></linearGradient></defs><path d="M0,74 L${pts.join(' L')} L200,76 L0,76Z" fill="url(#day-fill)"/><polyline points="${pts.join(' ')}" fill="none" stroke="#8aab64" stroke-width="1.8"/><line x1="${settings.hour/24*200}" x2="${settings.hour/24*200}" y1="0" y2="78" stroke="#c8b179" stroke-width=".7" stroke-dasharray="3 3"/></svg>`;
}
function renderResults(){
  const r=result,f=r.finance;
  $('#payback').innerHTML=f.payback===null?`&gt;${settings.costs.lifetime} <small>years</small>`:`${number(f.payback,1)} <small>years</small>`;
  $('#payback-detail').textContent=r.low.payback!==null&&r.high.payback!==null?`${number(r.high.payback,1)}–${number(r.low.payback,1)} years with ±${settings.costs.uncertainty}% generation`:`Sensitivity includes no payback within ${settings.costs.lifetime} years`;
  $('#generation').innerHTML=`${number(r.annual)} <small>kWh / yr</small>`;
  $('#generation-detail').textContent=`${number(settings.panel.count*settings.panel.watts/1000,2)} kWp system · ${r.source==='demo'?'sample weather':'historical weather average'}`;
  $('#self-consumption').innerHTML=`${number(r.annual?r.self/r.annual*100:0)}<small>%</small>`;
  $('#self-detail').textContent=`${number(r.self)} kWh consumed · ${number(r.exported)} kWh exported`;
  $('#savings').textContent=money(f.first.net);
  $('#savings-detail').textContent=`${money(f.first.gross)} energy value before costs`;
  $('#investment').textContent=money(f.capital);$('#lifetime-savings').textContent=money(f.cumulative);$('#npv').textContent=money(f.npv);
  $('#lifetime-pill').textContent=`${settings.costs.lifetime} years`;
  const shade=r.unshaded>0?(1-r.annual/r.unshaded)*100:0;
  $('#shade-summary').textContent=`Scene shading loss: ${number(shade,1)}% · includes blocked diffuse sky`;
  const last=r.years.find(y=>y.year===LAST_YEAR);
  $('#historical-result').innerHTML=r.source==='archive'&&last?`${number(last.annual)} <small>kWh</small>`:'— <small>kWh</small>';
  $('#historical-label').textContent=r.source==='archive'&&last?`${LAST_YEAR} · ${number(last.coverage)} modelled hourly intervals · historical weather estimate`:`Load ${LAST_YEAR} weather to reconstruct last year’s generation.`;
  monthlyChart();paybackChart();
}
function monthlyChart(){
  const r=result,w=520,h=177,left=30,right=10,top=13,bottom=27,ph=h-top-bottom,pw=w-left-right;
  const max=Math.ceil(Math.max(10,...r.monthly.map(m=>Math.max(m.generation,m.load)))/100)*100;
  let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Monthly solar generation, self-consumption and household usage in kilowatt hours">`;
  for(let i=0;i<=3;i++){const y=top+ph*i/3;svg+=`<line x1="${left}" x2="${w-right}" y1="${y}" y2="${y}" stroke="#e8ecdf" stroke-dasharray="3 3"/><text x="${left-7}" y="${y+3}" text-anchor="end" fill="#9da98f" font-size="8">${number(max*(1-i/3))}</text>`;}
  r.monthly.forEach((m,i)=>{const x=left+(i+.5)*pw/12,bw=16,gh=m.generation/max*ph,sh=m.self/max*ph;
    svg+=`<g><title>${months[i]}: ${number(m.generation,1)} kWh solar; ${number(m.self,1)} kWh used at home; ${number(m.load,1)} kWh household</title><rect x="${x-bw/2}" y="${top+ph-gh}" width="${bw}" height="${Math.max(.4,gh)}" rx="2" fill="#376b51"/><rect x="${x-bw/2}" y="${top+ph-sh}" width="${bw}" height="${Math.max(.4,sh)}" rx="1" fill="#b5ca9b"/><text x="${x}" y="${h-9}" text-anchor="middle" fill="#94a285" font-size="8">${months[i]}</text></g>`;
  });
  const pts=r.monthly.map((m,i)=>`${left+(i+.5)*pw/12},${top+ph-m.load/max*ph}`).join(' ');
  svg+=`<polyline points="${pts}" stroke="#bda979" stroke-width="1.25" stroke-dasharray="4 3" fill="none"/></svg>`;
  $('#monthly-chart').innerHTML=svg;
}
function paybackChart(){
  const f=result.finance,w=450,h=170,left=40,right=10,top=10,bottom=25,pw=w-left-right,ph=h-top-bottom;
  const min=Math.min(-f.capital,...result.low.years.map(y=>y.cumulative)),max=Math.max(100,...result.high.years.map(y=>y.cumulative));
  const range=max-min||1,point=(i,v)=>`${left+i/settings.costs.lifetime*pw},${top+ph-(v-min)/range*ph}`;
  const all=[{year:0,cumulative:-f.capital},...f.years],line=all.map(y=>point(y.year,y.cumulative));
  const low=[{year:0,cumulative:-f.capital},...result.low.years].map(y=>point(y.year,y.cumulative));
  const high=[{year:0,cumulative:-f.capital},...result.high.years].reverse().map(y=>point(y.year,y.cumulative));
  let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Net cumulative cash flow with generation sensitivity range">`;
  for(let i=0;i<=3;i++){const y=top+ph*i/3;svg+=`<line x1="${left}" x2="${w-right}" y1="${y}" y2="${y}" stroke="#e8ecdf" stroke-dasharray="3 3"/><text x="${left-7}" y="${y+3}" text-anchor="end" fill="#9da98f" font-size="8">${number((max-range*i/3)/1000,1)}k</text>`;}
  const zero=top+ph-(0-min)/range*ph;svg+=`<line x1="${left}" x2="${w-right}" y1="${zero}" y2="${zero}" stroke="#b6c4a6" stroke-width=".8"/><path d="M${low.join(' L')} L${high.join(' L')} Z" fill="#d6e2be" opacity=".45"/><polyline points="${line.join(' ')}" stroke="#5c8050" stroke-width="2" fill="none"/>`;
  if(f.payback!==null){const x=left+f.payback/settings.costs.lifetime*pw;svg+=`<circle cx="${x}" cy="${zero}" r="3.5" fill="#6a8b53" stroke="#fcfdf9" stroke-width="1.5"/><text x="${Math.max(left+30,Math.min(w-70,x))}" y="${Math.max(13,zero-10)}" text-anchor="middle" font-size="8" fill="#6c865a">Break-even · ${number(f.payback,1)} yr</text>`;}
  for(let i=0;i<=5;i++){const year=Math.round(i/5*settings.costs.lifetime);svg+=`<text x="${left+year/settings.costs.lifetime*pw}" y="${h-6}" text-anchor="middle" fill="#9da98f" font-size="8">${year===0?'Now':year+' yr'}</text>`;}
  $('#payback-chart').innerHTML=svg+'</svg>';
}
function locationKey(){return `${settings.location.lat}:${settings.location.lon}:${settings.location.grid}`;}
function weatherKey(year){return `${locationKey()}:${year}`;}
let dbPromise;
function db(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open('solstice-weather-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('weather');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function cacheGet(key){try{const d=await db();return await new Promise((resolve,reject)=>{const r=d.transaction('weather').objectStore('weather').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}catch{return null;}}
async function cacheSet(key,value){try{const d=await db();await new Promise((resolve,reject)=>{const t=d.transaction('weather','readwrite');t.objectStore('weather').put(value,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}catch{toast('Browser weather cache unavailable; downloaded weather still works this session.');}}
async function restoreWeather(){
  const key=locationKey(),years=Array.from({length:settings.weatherYears},(_,i)=>LAST_YEAR-i);
  const cached=(await Promise.all(years.map(y=>cacheGet(`${key}:${y}`)))).filter(Boolean);
  if(key!==locationKey()||loading)return;
  if(cached.length){datasets=cached;progress=`Restored ${cached.length} weather years from this browser’s local cache.`;renderInspector();updateAll();}
}
async function loadWeather(span){
  if(loading)return;loading=true;settings.weatherYears=span;save();const key=locationKey(),loc=clone(settings.location),loaded=[];
  const years=Array.from({length:span},(_,i)=>LAST_YEAR-i);
  try{
    for(const [i,year] of years.entries()){
      progress=`${i+1} / ${span} · Loading ${year}. Only rounded coordinates are used.`;renderInspector();
      let data=await cacheGet(`${key}:${year}`);
      if(!data){data=await loadWeatherYear(loc,year,{onProgress:message=>{progress=`${i+1} / ${span} · ${year} · ${message}`;if(tab==='data'&&$('#weather-progress'))$('#weather-progress').textContent=progress;}});await cacheSet(`${key}:${year}`,data);}
      loaded.push(data);
      if(key!==locationKey())throw Error('Region changed. Downloaded years were cached for the previous region. Load the new region when ready.');
    }
    datasets=loaded;progress=`Loaded ${span} complete calendar ${span===1?'year':'years'}. Weather is cached on this computer.`;toast('Historical weather loaded. Recalculating your solar outlook.');
  }catch(error){progress=error.message;toast(error.message);}
  finally{loading=false;renderInspector();updateAll();}
}
function download(filename,text,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function exportHourly(){
  const data=datasets.find(d=>d.meta.year===LAST_YEAR);if(!data)return;
  try{
    const {simulateYear,recordsFromArchive}=await import('./model.js');
    const simulation=simulateYear(settings,recordsFromArchive(data),LAST_YEAR,prepareScene(settings));
    const rows=[['Solstice historical-weather reconstruction; not measured output'],['Source','Open-Meteo / Copernicus ERA5'],['Local calendar year',LAST_YEAR],['Time zone',settings.location.timezone],['Rounded latitude',settings.location.lat],['Rounded longitude',settings.location.lon],['Interval midpoint UTC','AC generation kWh','Self consumed kWh','Exported kWh','Household use kWh'],...simulation.hours.map(h=>[new Date(h.time).toISOString(),h.generation.toFixed(6),h.self.toFixed(6),h.export.toFixed(6),h.load.toFixed(6)])];
    download(`solstice-${LAST_YEAR}-hourly.csv`,rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n'),'text/csv');
  }catch(error){toast(error.message);}
}
async function importWeather(e){
  try{
    const file=e.target.files[0];if(!file)return;if(file.size>65_000_000)throw Error('Choose a weather export smaller than 65 MB.');
    const data=JSON.parse(await file.text());if(data.format!=='solstice-weather-v1'||!Array.isArray(data.datasets)||!data.datasets.length||data.datasets.length>10)throw Error('Choose a Solstice weather export.');
    const {recordsFromArchive}=await import('./model.js');
    const seen=new Set();
    for(const d of data.datasets){
      if(!d.meta||!Number.isInteger(d.meta.year)||seen.has(d.meta.year)||d.meta.year<LAST_YEAR-9||d.meta.year>LAST_YEAR||d.meta.requested_latitude!==settings.location.lat||d.meta.requested_longitude!==settings.location.lon)throw Error('Weather years must be unique and match this region’s rounded coordinates.');
      if(d.hourly?.time?.length>9000)throw Error('Unexpected weather file size.');
      const r=recordsFromArchive(d);if(r.length<8760||r.some((w,i)=>i&&w.time-r[i-1].time!==3600000))throw Error('Weather must contain a complete, contiguous hourly year.');
      if(d.hourly_units?.wind_speed_10m!=='m/s')throw Error('Weather wind speed units must be m/s.');seen.add(d.meta.year);
    }
    datasets=data.datasets;for(const d of datasets)await cacheSet(weatherKey(d.meta.year),d);progress='Imported weather from a local file. No network request was made.';renderInspector();updateAll();toast('Offline weather imported.');
  }catch(error){toast(error.message);}
}
async function importMap(e){
  try{
    const file=e.target.files[0];if(!file)return;if(file.size>10_000_000)throw Error('Choose a GeoJSON file smaller than 10 MB.');
    const lat=+$('#origin-lat').value,lon=+$('#origin-lon').value;
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>89.9||Math.abs(lon)>180)throw Error('Enter a valid local origin.');
    const doc=JSON.parse(await file.text());if(doc.type!=='FeatureCollection'||!Array.isArray(doc.features))throw Error('Choose a GeoJSON FeatureCollection.');
    const objects=[];
    for(const f of doc.features){
      const p=f.properties||{},g=f.geometry;if(!g)continue;
      if(g.type==='Point'&&(p.natural==='tree'||p.type==='tree')){
        const [x,z]=project(g.coordinates,lat,lon);if(Math.hypot(x,z)>200)continue;
        objects.push({type:'tree',name:p.name||'Imported tree',x,z,height:parseFloat(p.height)||8,radius:(parseFloat(p.diameter_crown)||5)/2,crown:5,leafOn:8,leafOff:55,deciduous:p.leaf_type!=='needleleaved',leafStart:4,leafEnd:10});
      }else if(g.type==='Polygon'||g.type==='MultiPolygon'){
        const polygons=g.type==='Polygon'?[g.coordinates]:g.coordinates;
        for(const polygon of polygons){
          const rings=polygon.map(ring=>ring.slice(0,1000).map(c=>project(c,lat,lon)));
          if(!rings[0]?.length||rings.some(r=>r.some(v=>!v.every(Number.isFinite))))continue;
          const fit=fitFootprint(rings);if(!fit||Math.hypot(fit.x,fit.z)>200||Math.hypot(fit.x,fit.z)<2)continue;
          objects.push({type:'building',name:p.name||'Imported building',...fit,height:parseFloat(p.height)||(parseFloat(p['building:levels'])||3)*3,base:parseFloat(p.min_height)||0});
          if(objects.length+settings.obstacles.length>=MAX_SCENE_OBJECTS)break;
        }
      }
      if(objects.length+settings.obstacles.length>=MAX_SCENE_OBJECTS)break;
    }
    if(!objects.length)throw Error('No suitable buildings or tree points found within 200 m of this origin.');
    settings.obstacles.push(...objects);settings=sanitize(settings);selected=settings.obstacles.at(-1).id;save();renderInspector();updateAll();toast(`Imported ${objects.length} objects locally. Check the simplified dimensions and heights.`);
  }catch(error){toast(error.message);}
}
function showModel(){
  $('#model-content').innerHTML=`<div class="model-body">
  <p>Solstice simulates an unbuffered, grid-connected PV system. Every output is a planning estimate. The current weather source is <strong>${datasets.length?'downloaded historical reanalysis':'synthetic demonstration data'}</strong>.</p>
  <h3>Sunlight and weather</h3><p>Solar geometry uses the <a href="https://www.gml.noaa.gov/grad/solcalc/solareqns.PDF" target="_blank" rel="noreferrer">NOAA fractional-year equations</a>. Downloaded <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noreferrer">Open-Meteo / Copernicus ERA5</a> includes hourly global, direct-normal and diffuse radiation, air temperature and wind. Radiation is a preceding-hour mean; sun angles are evaluated at that interval’s midpoint. Energy is integrated over complete local calendar years in your chosen time zone.</p>
  <h3>Panel output and occlusion</h3><p>A Hay–Davies sky transposition model adds direct, circumsolar, sky-diffuse and ground-reflected irradiance on your tilted panels. Nine rays per module sample direct shading. Manual buildings are rotated boxes; OSM and GeoJSON buildings use extruded polygon footprints including courtyards. Official regional models retain triangulated roof and wall surfaces, with the same geometry used for rendering and ray intersections. Both the view and ray calculations use these footprints and your edits. Tree crowns are ellipsoids with seasonal transmission. Sky and ground visibility are integrated over 384 directions from each module centre. <a href="https://pvpmc.sandia.gov/app/uploads/sites/243/2022/10/Report-IEA-PVPS-T13-06-2017_PV_Performance_Modeling_Methods_and_Practices_SAND2017-2570-R.pdf" target="_blank" rel="noreferrer">Sandia’s PV modelling guide</a> describes the irradiance methods.</p>
  <p>Beam reflection uses an ASHRAE-style incidence modifier (b₀ = 0.05). Faiman module temperature uses U₀/U₁ of 26.9/6.2 for open mounting or 20/3.2 for roof mounting; 10 m wind is reduced to 70% at the panel. Temperature derating, an approximate logarithmic low-light adjustment, user losses, inverter efficiency and AC clipping follow. Independent MPPT applies module-level shading; the series option uses the most shaded module as a conservative approximation. The model does not solve individual cell circuits or bypass diodes. See <a href="https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/general-information/data-sources-calculation-methods_en" target="_blank" rel="noreferrer">JRC PV calculation methods</a> for temperature-model context. Solstice is an independent implementation, not a PVGIS calculation.</p>
  <h3>Consumption and money</h3><p>Always-on demand is included in the annual total. The remaining demand follows monthly weights and your daily profile. Self-consumption is min(hourly AC generation, hourly load); surplus is exported. Imported electricity avoided and export payments create savings. Upfront buying and installation costs are reduced by the rebate, with capital floored at zero. Annual maintenance and an optional inverter replacement reduce cash flow. Degradation reduces production every year; self-consumption is then recalculated. The price-growth assumption applies to import and export rates. Future costs stay fixed in nominal currency.</p>
  <p>Payback is the first cumulative nominal cash-flow crossing, interpolated within that year. It does not guarantee that later replacement costs cannot temporarily make cash flow negative again. NPV discounts end-of-year net cash flows. The shaded chart band and payback range rerun output at ±${settings.costs.uncertainty}%; they are sensitivity scenarios, not probabilities. Multi-year results average complete independent year simulations, including their nonlinear consumption matching. No financing, tax calculation, battery, dynamic tariff or sub-hourly appliance model is included.</p>
  <h3>What last year means</h3><p>Historical mode reconstructs what this configured system might have produced under last year’s regional weather. It is not meter data. Weather-grid errors, a rounded location, simplified geometry, vegetation growth, snow, dirty panels, inverter behaviour and short-lived shadows can cause substantial differences. Regional weather is roughly 25 km resolution. Terrain and distant horizon obstructions are not automatically imported; add important obstructions manually. Multi-year averages describe the loaded years, not a guaranteed future climate.</p>
  <h3>Generated surroundings</h3><p>Generate from location uses OpenStreetMap building footprints and individual mapped trees. Heights are recorded directly, estimated from floor counts at 3 m per floor, or assumed to be 9 m for buildings and 8 m for trees. Buildings are extruded footprints, so roof shapes and floor spacing can need correction. Up to 120 nearby buildings/trees are retained; omissions and source assumptions are shown. Missing foliage must be added manually, and no terrain surface is imported. Attribution is displayed below the view and included in project exports.</p>
  <h3>Privacy and data</h3><p>${BROWSER_DOWNLOADS?(HOSTED?'The sharing server delivers the calculator to your browser.':'This portable file runs directly in your browser.')+' The browser requests maps and weather directly.':HOSTED?'This website stores your project and runs calculations in your browser. The hosting provider receives your IP, ordinary page requests, coarse map area indices, and rounded weather requests; it may keep its own access logs.':'This copy runs on your computer at 127.0.0.1.'} The app includes no trackers, remote fonts or GPS access. Map providers receive a broader area, normally at least 2.9 × 2.9 km, and ${HOSTED&&!BROWSER_DOWNLOADS?'the server’s IP':'your connection’s IP'}. Your precise point and chosen building remain in the browser. Exact input coordinates and OpenStreetMap links are cleared from the dialog after use. Relative geometry and public source IDs can identify a building if you share a project; location rounding does not anonymize exported geometry.</p>
  <p>Projects, undo data and downloaded weather are saved in this browser. Use Save project to keep a separate copy; browser data can be cleared and does not synchronize across devices. ${BROWSER_DOWNLOADS?'The browser also holds recent map results while the tab is open.':'The server also caches public map areas for up to seven days and weather for up to 30 days in hosted mode, without the exact selected point. Hosted caches have size limits and may disappear when a free service sleeps or restarts. Hosted connection reports stay in your browser; the local version can send metadata-only empty-response evidence to its loopback server.'} An offline GeoJSON import does not contact a map provider.</p>
  <p>Weather downloads send rounded coordinates to Open-Meteo, which also sees ${BROWSER_DOWNLOADS?'your connection’s IP':'the server connection’s IP'}. Rounding reduces location specificity; it does not provide anonymity. Open-Meteo’s <a href="https://open-meteo.com/en/terms" target="_blank" rel="noreferrer">terms and privacy notice</a> describe request logging and free non-commercial use. Weather attribution: Open-Meteo, Copernicus Climate Change Service / ECMWF; CC BY 4.0. Three.js: MIT licence, included locally.</p></div>`;
  $('#model-dialog').showModal();
}

$$('.setup-nav button').forEach(b=>b.onclick=()=>chooseTab(b.dataset.tab));
$('#banner-weather').onclick=()=>chooseTab('data');$('#history-button').onclick=()=>chooseTab('data');
$('#model-button').onclick=showModel;$('#close-model').onclick=()=>$('#model-dialog').close();
$('#model-dialog').addEventListener('click',e=>{if(e.target===$('#model-dialog'))$('#model-dialog').close();});
$('#scene-date').onchange=e=>{if(!e.target.value)return;settings.date=e.target.value;save();scene?.update(settings);dayCache='';updateDay();};
$('#scene-time').oninput=e=>{settings.hour=+e.target.value;scene?.update(settings);updateDay();};
$('#scene-time').onchange=save;
$$('.day-mode button').forEach(b=>b.onclick=()=>{settings.dayMode=b.dataset.mode;save();dayCache='';updateDay();});
$('#reset-camera').onclick=()=>scene?.reset();
$('#view-3d').onclick=()=>{scene?.reset();$('#view-3d').classList.add('active');$('#view-top').classList.remove('active');};
$('#view-top').onclick=()=>{scene?.reset(true);$('#view-top').classList.add('active');$('#view-3d').classList.remove('active');};
$('#animate-sun').onclick=()=>{
  if(animation){clearInterval(animation);animation=null;$('#animate-sun').textContent='▷';save();return;}
  $('#animate-sun').textContent='Ⅱ';animation=setInterval(()=>{settings.hour=(settings.hour+.1)%24;scene?.update(settings);updateDay();},100);
};
$('#save-project').onclick=()=>download('solstice-project.json',JSON.stringify({format:'solstice-project-v1',version:1,settings,attribution:settings.mapScene?[sourceInfo(settings.mapScene),...(settings.mapScene.sourceId!=='osm'&&settings.obstacles.some(o=>o.source?.sourceId==='osm')?[SOURCES.osm]:[])]:undefined},null,2),'application/json');
$('#open-project').onclick=()=>$('#project-file').click();
$('#project-file').onchange=async e=>{
  try{const file=e.target.files[0];if(!file)return;if(file.size>5_000_000)throw Error('Choose a project file smaller than 5 MB.');const data=JSON.parse(await file.text());if(data.format!=='solstice-project-v1'||!data.settings)throw Error('Choose a Solstice project file.');settings=sanitize(data.settings);datasets=[];save();renderInspector();updateAll();restoreWeather();toast('Project opened locally.');}catch(error){toast(error.message);}e.target.value='';
};
$('#reset-project').onclick=()=>{if(!window.confirm('Replace the current settings with the example project? Save a project first if you want to keep your changes.'))return;settings=clone(defaults);datasets=[];save();renderInspector();updateAll();};
$('#export-csv').onclick=()=>{
  if(!result)return;
  const lines=[['Solstice modelled generation - not measured production'],['Source',result.source==='demo'?'SYNTHETIC DEMO':'Open-Meteo / Copernicus ERA5'],['Weather years',datasets.map(d=>d.meta.year).join(';')||'Synthetic'],['Rounded latitude',settings.location.lat],['Rounded longitude',settings.location.lon],['Time zone',settings.location.timezone],['Month','Generation kWh','Self consumed kWh','Exported kWh','Household kWh'],...result.monthly.map((m,i)=>[months[i],m.generation.toFixed(3),m.self.toFixed(3),m.export.toFixed(3),m.load.toFixed(3)]),[],['Projection year',`Net cash flow ${settings.costs.currency}`,`Cumulative ${settings.costs.currency}`,`Discounted cumulative ${settings.costs.currency}`],...result.finance.years.map(y=>[y.year,y.net.toFixed(2),y.cumulative.toFixed(2),y.npv.toFixed(2)])];
  download('solstice-outlook.csv',lines.map(l=>l.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n'),'text/csv');
};
function project(x,lat,lon){return [(x[0]-lon)*111320*Math.cos(lat*Math.PI/180),-(x[1]-lat)*111320];}
const mapGenerator=new MapGenerator(()=>settings,applyGeneratedScene);
function markSetupSeen(){setupSeen=true;try{localStorage.setItem('solstice-onboarding-v1','complete');}catch{}}
const setupWizard=new SetupWizard({getSettings:()=>settings,regions,onExample:()=>{markSetupSeen();toast('Exploring the example. Open Setup whenever you are ready to enter your own details.');},onComplete:(draft,options)=>{
  const oldLocation=locationKey();
  if(JSON.stringify([settings.house,settings.obstacles])!==JSON.stringify([draft.house,draft.obstacles])){sceneUndo=clone(settings);try{localStorage.setItem('solstice-scene-undo-v1',JSON.stringify(sceneUndo));}catch{}}
  settings=sanitize(draft);markSetupSeen();selected=settings.obstacles[0]?.id;
  if(oldLocation!==locationKey())datasets=[];
  save();tab='site';renderInspector();updateAll();scene?.reset();
  if(options.loadWeather)queueMicrotask(()=>loadWeather(settings.weatherYears));else restoreWeather();
  toast('Your setup is ready. Review the 3D scene and refine anything you need.');
}});
$('#start-setup').onclick=()=>setupWizard.open({isNew:!hasSavedProject&&!setupSeen});
$('#generate-scene').onclick=()=>mapGenerator.open();
$('#edit-placement').onclick=()=>chooseTab('site');
renderInspector();updateLocation();
try{scene=new SolarScene($('#scene-view'),id=>{if(id==='own')chooseTab('site');else{selected=id;chooseTab('scene');}});}catch(error){const p=document.createElement('div');p.className='error-scene';p.textContent='The 3D view requires WebGL. Calculations and all scene controls are still available.';$('#scene-view').prepend(p);console.error(error);}
updateAll();restoreWeather();
if(!hasSavedProject&&!setupSeen)setupWizard.open({isNew:true});

async function prepareSharedCopy() {
  const status = $('#share-status');
  status.hidden = false;
  status.textContent = 'Saving the calculator in this browser. Keep the share link open for a moment.';
  try {
    const build = new URL(import.meta.url).search;
    const scriptUrl = new URL(`/offline.js${build}`, location.href).href;
    if (navigator.serviceWorker.controller?.scriptURL !== scriptUrl) {
      const registration = await navigator.serviceWorker.register(scriptUrl);
      const worker = registration.installing || registration.waiting || registration.active;
      if (!worker) throw Error('The browser did not install an offline copy.');
      await new Promise((resolve, reject) => {
        function checkState() {
          if (worker.state !== 'activated' && worker.state !== 'redundant') return;
          worker.removeEventListener('statechange', checkState);
          if (worker.state === 'activated') resolve();
          else reject(Error('The browser did not finish saving the calculator.'));
        }
        worker.addEventListener('statechange', checkState);
        checkState();
      });
    }
    status.textContent = 'Ready to use in this browser after the host closes the link.';
  } catch {
    status.textContent = 'This browser could not save the page for reopening. Keep this tab open to keep using the calculator.';
  }
}

if (HOSTED && BROWSER_DOWNLOADS) prepareSharedCopy();
