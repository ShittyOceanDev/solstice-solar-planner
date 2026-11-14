import {clone,roundedLocation,LAST_YEAR,consumptionPlan} from './model.js';
import {PANEL_PRESETS,applyPanelPreset,normalizePanelPreset} from './panels.js';
import {parseMapLocation} from './maps.js';
import {MapGenerator} from './map-ui.js';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const steps=['Location','Panels','Energy use','Pricing','Review'];
const get=(s,path)=>path.split('.').reduce((v,k)=>v[k],s);
const put=(s,path,value)=>{const keys=path.split('.'),last=keys.pop();keys.reduce((v,k)=>v[k],s)[last]=value;};

export function setupDraft(settings,isNew=false) {
  const draft=clone(settings);
  if(isNew){draft.obstacles=[];draft.mapScene=null;draft.house.footprint=null;draft.house.mesh=null;draft.house.source=null;}
  return draft;
}
export function setupLocation(draft,input,timezone,grid) {
  const point=parseMapLocation(input);
  new Intl.DateTimeFormat('en',{timeZone:timezone}).format();
  return roundedLocation({...draft.location,...point,timezone,grid,name:'Your region'});
}
export function setupAnnualConsumption(draft,annual) {
  const total=draft.consumption.monthly.reduce((a,b)=>a+b,0);
  draft.consumption.annual=annual;
  draft.consumption.monthly=draft.consumption.monthly.map(v=>total>0?v/total*annual:annual/12);
}

export class SetupWizard {
  constructor({getSettings,onComplete,onExample,regions}) {
    Object.assign(this,{getSettings,onComplete,onExample,regions});
    this.dialog=document.createElement('dialog');this.dialog.className='setup-dialog';this.dialog.setAttribute('aria-labelledby','setup-title');document.body.append(this.dialog);
    this.dialog.addEventListener('close',()=>{this.draft=null;this.pointText='';this.dialog.innerHTML='';});
    this.map=new MapGenerator(()=>this.draft,(generated,point)=>{
      const location=roundedLocation({...this.draft.location,...point,name:'Your region'});
      generated.mapScene.region=[location.lat,location.lon];
      this.draft={...this.draft,...generated,location};this.timezone=point.timezone;
      this.pointText='';this.locationSet=true;this.needsScene=false;this.render();
    });
  }
  open({isNew=false}={}) {
    this.isNew=isNew;this.draft=setupDraft(this.getSettings(),isNew);this.step=0;
    this.pointText=isNew?'':`${this.draft.location.lat}, ${this.draft.location.lon}`;
    this.timezone=this.draft.location.timezone;this.locationSet=!isNew;this.weather=false;this.needsScene=false;
    this.render();this.dialog.showModal();
  }
  q(selector){return this.dialog.querySelector(selector);}
  field(label,path,unit='',{min=0,max=1000000,step='any'}={}) {
    return `<div class="field"><label for="setup-${path}">${esc(label)}</label><div class="input-unit"><input id="setup-${path}" data-setup="${path}" type="number" required min="${min}" max="${max}" step="${step}" value="${get(this.draft,path)}">${unit?`<span>${esc(unit)}</span>`:''}</div></div>`;
  }
  select(label,path,options) {
    return `<div class="field"><label for="setup-${path}">${esc(label)}</label><select id="setup-${path}" data-setup="${path}">${options.map(([value,label])=>`<option value="${value}" ${String(get(this.draft,path))===String(value)?'selected':''}>${esc(label)}</option>`).join('')}</select></div>`;
  }
  row(...fields){return `<div class="form-row">${fields.join('')}</div>`;}
  locationPage() {
    const s=this.draft,mapped=s.mapScene&&!this.needsScene;
    return `<h3>Where will your panels live?</h3><p class="setup-intro">Choose a region for weather, or enter your building’s coordinates to generate its surroundings. Your exact point stays in this browser.</p>
      <div class="field"><label for="setup-region">Start with a region</label><select id="setup-region"><option value="">Choose a region, or enter coordinates below</option>${this.regions.map(([name],i)=>`<option value="${i}">${esc(name)}</option>`).join('')}</select></div>
      <div class="field"><label for="setup-point">Coordinates or OpenStreetMap link</label><input id="setup-point" type="text" autocomplete="off" spellcheck="false" value="${esc(this.pointText)}" placeholder="Latitude, longitude or an OpenStreetMap link"><p class="help">OpenStreetMap links are read locally. A region alone gives an approximate weather point; use your building’s point for accurate scene placement.</p></div>
      <div class="form-row"><div class="field"><label for="setup-zone">Site time zone (IANA)</label><input id="setup-zone" type="text" required value="${esc(this.timezone)}" placeholder="Europe/Berlin"></div>${this.select('Weather privacy grid','location.grid',[[.1,'0.1° · about 11 km north–south'],[.25,'0.25° · about 28 km'],[.5,'0.5° · about 56 km'],[1,'1° · about 111 km']])}</div>
      <div class="privacy-note" id="setup-location-note"></div>
      <div class="setup-map-card"><div><strong>${mapped?'Your mapped scene is ready':'Build your surroundings automatically'}</strong><p>${mapped?`${s.obstacles.filter(o=>o.type==='building').length+1} building models and ${s.obstacles.filter(o=>o.type==='tree').length} trees. You can adjust every object after setup.`:'Generate buildings and mapped trees from OpenStreetMap, then confirm your installation building. Missing heights are labelled estimates.'}</p></div><button type="button" id="setup-generate" class="button secondary">${mapped?'Review / regenerate scene':'Generate surroundings ↗'}</button></div>`;
  }
  panelsPage() {
    const s=this.draft;
    return `<h3>A system that fits your space.</h3><p class="setup-intro">Choose a panel, then set its position and inverter. You can refine dimensions and electrical losses in the planner.</p>
      ${this.select('Panel type / model','panel.preset',[['custom','Custom / manual specifications'],...PANEL_PRESETS.map(p=>[p.id,p.label])])}
      ${this.row(this.field('Number of panels','panel.count','',{min:1,max:12,step:1}),this.field('Power per panel','panel.watts','W',{min:1,max:1000}))}
      ${this.row(this.field('Inverter AC limit','panel.inverter','W',{min:1,max:30000}),this.select('Install on','panel.side',[['south','South façade'],['east','East façade'],['west','West façade'],['north','North façade'],['roof','Flat roof']]))}
      ${this.row(this.field('Panel tilt · 0° = flat','panel.tilt','°',{max:90}),this.field('Direction · 180° = south','panel.azimuth','°',{max:359.9}))}
      ${this.row(this.field('Building floors','house.floors','',{min:1,max:60,step:1}),this.field('Your floor · ground = 0','panel.floor','',{max:s.house.floors-1,step:1}))}
      ${this.row(this.field('Height above your floor','panel.mountHeight','m',{min:.1,max:10}),this.field('Total building height','house.height','m',{min:.5,max:500}))}
      <p class="help">Floors use the configured ${s.house.floorHeight} m spacing. Check total height and the façade in 3D, particularly for a mapped building with an irregular footprint. Direction is clockwise from true north.</p>`;
  }
  energyPage() {
    return `<h3>How does your home use energy?</h3><p class="setup-intro">Use your electricity bill for the annual total. The always-on load is part of that total and helps estimate how much solar you can use at home.</p>
      ${this.row(this.field('Annual household consumption','consumption.annual','kWh'),this.field('Always-on baseline','consumption.base','W',{max:100000}))}
      ${this.select('Daily usage profile','consumption.profile',[['evening','Away by day · morning and evening peaks'],['home','Home by day · more daytime use'],['flat','Evenly spread over 24 hours']])}
      <div class="privacy-note" id="setup-baseline"></div><p class="help">Monthly consumption is scaled to your annual total. You can enter each month separately under Energy use after setup. No battery is assumed.</p>`;
  }
  costsPage() {
    const currency=this.draft.costs.currency,unit=new Intl.NumberFormat('en',{style:'currency',currency}).formatToParts(0).find(p=>p.type==='currency').value;
    return `<h3>What will it cost—and save?</h3><p class="setup-intro">Enter your tariff and quoted costs. These values determine payback; the starting values are examples.</p>
      ${this.select('Currency','costs.currency',[['EUR','Euro · EUR'],['GBP','Pound sterling · GBP'],['USD','US dollar · USD'],['AUD','Australian dollar · AUD']])}
      ${this.row(this.field('Buying costs','costs.hardware',unit),this.field('Installation costs','costs.installation',unit))}
      ${this.row(this.field('Electricity import price','costs.importRate',`${unit}/kWh`,{max:10,step:.001}),this.field('Export payment','costs.exportRate',`${unit}/kWh`,{max:10,step:.001}))}
      ${this.row(this.field('Upfront subsidy / rebate','costs.subsidy',unit),this.field('Annual maintenance','costs.maintenance',unit))}
      <p class="help">Use the price per kWh, excluding fixed charges you will still pay. Export payment can be zero. Lifetime, degradation, price growth and inverter replacement remain editable under Costs & payback.</p>`;
  }
  reviewPage() {
    const s=this.draft,mapped=s.mapScene&&!this.needsScene,money=n=>new Intl.NumberFormat('en-GB',{style:'currency',currency:s.costs.currency,maximumFractionDigits:2}).format(n);
    const rows=[['Weather region',`${s.location.lat.toFixed(2)}°, ${s.location.lon.toFixed(2)}° · ${s.location.timezone}`],['Your system',`${s.panel.count} × ${s.panel.watts} W · ${s.panel.inverter} W inverter`],['Household use',`${Math.round(s.consumption.annual).toLocaleString()} kWh/year · ${s.consumption.base} W baseline`],['Upfront investment',money(Math.max(0,s.costs.hardware+s.costs.installation-s.costs.subsidy))],['Electricity',`${money(s.costs.importRate)}/kWh import · ${money(s.costs.exportRate)}/kWh export`]];
    return `<h3>Your first solar outlook.</h3><p class="setup-intro">Review the essentials. Everything stays editable, and setup only replaces your current settings when you finish.</p><dl class="setup-review">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
      <div class="privacy-note ${mapped?'':'setup-caution'}"><strong>${mapped?'Mapped surroundings are included':'Surroundings still need checking'}</strong>${mapped?'Check estimated heights and add unmapped foliage in the 3D editor.':this.needsScene?'The location changed. Finishing removes the previous location’s surroundings. Generate a new scene from the Location step, or add obstructions in the planner.':'No automatic map scene has been generated. You can add or generate nearby obstructions in the planner; an unchecked scene cannot establish site shading.'}</div>
      ${this.select('Historical weather sample','weatherYears',[[1,`${LAST_YEAR} only`],[5,`5-year average · ${LAST_YEAR-4}–${LAST_YEAR}`],[10,`10-year average · ${LAST_YEAR-9}–${LAST_YEAR}`]])}
      <label class="setup-check"><input id="setup-weather" type="checkbox" ${this.weather?'checked':''}><span>Load historical weather when I finish<small>Open-Meteo receives only the rounded weather coordinates above and sees your connection’s IP. Without loaded weather, the dashboard uses labelled sample weather.</small></span></label>
      <p class="help">Generation and payback are planning estimates. Last-year output is a regional weather reconstruction, not a measured result.</p>`;
  }
  render() {
    this.dialog.innerHTML=`<div class="setup-shell"><div class="setup-header"><div><div class="eyebrow">${this.isNew?'WELCOME TO SOLSTICE':'YOUR SOLAR SETUP'}</div><h2 id="setup-title">A little setup. A clearer outlook.</h2></div><button type="button" class="setup-close" id="setup-close" aria-label="Close setup">×</button></div><ol class="setup-steps" aria-label="Setup progress">${steps.map((label,i)=>`<li class="${i===this.step?'current':i<this.step?'done':''}" ${i===this.step?'aria-current="step"':''}><span>${i<this.step?'✓':i+1}</span>${label}</li>`).join('')}</ol><form id="setup-form"><div class="setup-page">${[()=>this.locationPage(),()=>this.panelsPage(),()=>this.energyPage(),()=>this.costsPage(),()=>this.reviewPage()][this.step]()}<p id="setup-error" class="setup-error" role="alert"></p></div><div class="setup-footer"><button type="button" id="setup-back" class="button subtle">${this.step?'← Back':'Continue later'}</button>${this.step===0&&this.isNew?'<button type="button" id="setup-example" class="text-button">Explore the example</button>':'<span></span>'}<button type="submit" class="button setup-next">${this.step===4?'Create my outlook ↗':'Continue →'}</button></div></form></div>`;
    this.q('#setup-close').onclick=()=>this.dialog.close();
    this.q('#setup-back').onclick=()=>{if(this.step){this.step--;this.render();}else this.dialog.close();};
    this.q('#setup-example')?.addEventListener('click',()=>{this.onExample();this.dialog.close();});
    this.q('#setup-form').onsubmit=e=>{e.preventDefault();this.advance();};
    this.dialog.querySelectorAll('[data-setup]').forEach(el=>el.onchange=()=>{
      const path=el.dataset.setup,old=get(this.draft,path),value=typeof old==='number'?+el.value:el.value;
      if(path==='panel.preset'){this.draft.panel=applyPanelPreset(this.draft.panel,value);this.render();return;}
      if(path==='consumption.annual')setupAnnualConsumption(this.draft,value);else put(this.draft,path,value);
      if(path==='panel.watts')this.draft.panel=normalizePanelPreset(this.draft.panel);
      if(path==='house.floors')this.q('[data-setup="panel.floor"]').max=value-1;
      if(path==='costs.currency'){this.render();return;}
      if(this.step===0)this.locationNote();if(this.step===2)this.baselineNote();
    });
    if(this.step===0) {
      this.q('#setup-region').onchange=e=>{if(!e.target.value)return;const [name,lat,lon,zone]=this.regions[+e.target.value];this.pointText=`${lat}, ${lon}`;this.timezone=zone;this.draft.location.name=name;this.locationSet=false;this.needsScene=true;this.q('#setup-point').value=this.pointText;this.q('#setup-zone').value=zone;this.locationNote();};
      this.q('#setup-point').oninput=e=>{this.pointText=e.target.value;this.locationSet=false;this.needsScene=true;this.locationNote();};
      this.q('#setup-zone').oninput=e=>{this.timezone=e.target.value;this.locationNote();};
      this.q('#setup-generate').onclick=()=>{if(this.validateLocation())this.map.open({location:this.pointText||undefined});};
      this.locationNote();
    }
    if(this.step===2)this.baselineNote();
    this.q('#setup-weather')?.addEventListener('change',e=>this.weather=e.target.checked);
    this.dialog.scrollTop=0;
  }
  locationNote() {
    const note=this.q('#setup-location-note');
    try {
      const loc=this.pointText.trim()?setupLocation(this.draft,this.pointText,this.timezone,this.draft.location.grid):this.locationSet?roundedLocation(this.draft.location):null;
      if(!loc)throw Error('Choose a region or enter coordinates to begin.');
      note.textContent=`Weather requests use only ${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°. Map downloads use a separate broader area shown before loading. Nothing is downloaded automatically.`;this.q('#setup-generate').disabled=false;
    }catch(error){note.textContent=error.message;this.q('#setup-generate').disabled=true;}
  }
  validateLocation() {
    try {
      if(this.pointText.trim())this.draft.location=setupLocation(this.draft,this.pointText,this.timezone,this.draft.location.grid);
      else if(!this.locationSet)throw Error('Choose a region or enter coordinates to continue.');
      else this.draft.location=roundedLocation(this.draft.location);
      new Intl.DateTimeFormat('en',{timeZone:this.timezone}).format();this.draft.location.timezone=this.timezone;this.locationSet=true;return true;
    }catch(error){this.q('#setup-error').textContent=error.message;return false;}
  }
  baselineNote() {
    const floor=consumptionPlan(this.draft,LAST_YEAR).floor;
    this.q('#setup-baseline').textContent=`Your baseline uses about ${Math.round(floor).toLocaleString()} kWh/year, included in the annual total.${this.draft.consumption.annual<floor?' Reduce the baseline or increase the annual total before continuing.':''}`;
  }
  advance() {
    if(this.step===0&&!this.validateLocation())return;
    if(this.step===2&&this.draft.consumption.annual<consumptionPlan(this.draft,LAST_YEAR).floor){this.q('#setup-error').textContent='Annual consumption must cover the always-on baseline. Please adjust one of these values.';return;}
    if(this.step<4){this.step++;this.render();this.q('h3')?.setAttribute('tabindex','-1');this.q('h3')?.focus();return;}
    if(this.needsScene){this.draft.obstacles=[];this.draft.mapScene=null;this.draft.house.footprint=null;this.draft.house.mesh=null;this.draft.house.source=null;}
    this.onComplete(this.draft,{loadWeather:this.weather});this.dialog.close();
  }
}
