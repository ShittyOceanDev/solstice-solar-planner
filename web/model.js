// All geometry is in metres: x=east, y=up, z=south. Azimuth: north=0°, east=90°.
import {rayPrism,facadeDistance,roofMountPoint} from './geometry.js';
import {meshHits,meshRoofHeight} from './city-model.js';
export const RAD = Math.PI / 180;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const LAST_YEAR = new Date().getFullYear() - 1;
export const defaults = {
  location: { name: 'Berlin region', lat: 52.5, lon: 13.4, grid: 0.1, timezone: 'Europe/Berlin' },
  panel: { preset:'custom', count: 2, watts: 440, width: 1.134, length: 1.722, tilt: 65, azimuth: 180,
    floor: 2, mountHeight: 1.2, offset:0, side: 'south', inverter: 800, efficiency: 96, losses: 8,
    tempCoefficient: -0.35, cooling: 'open', wiring: 'micro', albedo: 0.2, snowLoss: 0 },
  house: { width: 10, depth: 8, floors: 3, floorHeight: 3, height:9, rotation: 0, footprint:null, mesh:null, source:null },
  mapScene:null,
  obstacles: [
    { id: 'building-1', type: 'building', name: 'Neighbouring house', x: -11, z: 13, width: 9, depth: 9, height: 8, rotation: 15 },
    { id: 'tree-1', type: 'tree', name: 'Deciduous tree', x: 8, z: 10, height: 10, radius: 3, crown: 6, leafOn: 8, leafOff: 55, deciduous: true, leafStart: 4, leafEnd: 10 },
    { id: 'building-2', type: 'building', name: 'East apartment', x: 17, z: -5, width: 7, depth: 11, height: 12, rotation: 0 }
  ],
  consumption: { annual: 2800, base: 120, profile: 'evening', monthly: [280,250,245,220,210,190,190,195,210,240,270,300] },
  costs: { hardware: 650, installation: 200, subsidy: 0, importRate: 0.32, exportRate: 0,
    maintenance: 10, escalation: 2, degradation: 0.5, discount: 3, lifetime: 25,
    replacementYear: 12, replacementCost: 180, currency: 'EUR', uncertainty: 20 },
  date: `${new Date().getFullYear()}-06-21`, hour: 13, dayMode: 'typical', weatherYears:5
};
export const clone = v => JSON.parse(JSON.stringify(v));
export const buildingHeight = house => Number.isFinite(house.height)&&house.height>0 ? house.height : house.floors*house.floorHeight;
export function roundedLocation(location) {
  const grid = [0.1, 0.25, 0.5, 1].includes(+location.grid) ? +location.grid : 0.1;
  return { ...location, grid, lat: +clamp(Math.round(+location.lat / grid) * grid, -89.9, 89.9).toFixed(3),
    lon: +clamp(Math.round(+location.lon / grid) * grid, -180, 180).toFixed(3) };
}
const dot = (a,b) => a.x*b.x + a.y*b.y + a.z*b.z;
const rotate = (v, angle) => ({x: v.x*Math.cos(angle)+v.z*Math.sin(angle), y:v.y, z:-v.x*Math.sin(angle)+v.z*Math.cos(angle)});
export function solarPosition(timestamp, lat, lon) {
  const d = new Date(timestamp), year = d.getUTCFullYear();
  const doy = (Date.UTC(year,d.getUTCMonth(),d.getUTCDate()) - Date.UTC(year,0,0))/86400000;
  const hour = d.getUTCHours() + d.getUTCMinutes()/60 + d.getUTCSeconds()/3600;
  const days = new Date(Date.UTC(year,1,29)).getUTCMonth() === 1 ? 366 : 365;
  const g = 2*Math.PI/days*(doy-1+(hour-12)/24);
  const eq = 229.18*(0.000075+0.001868*Math.cos(g)-0.032077*Math.sin(g)-0.014615*Math.cos(2*g)-0.040849*Math.sin(2*g));
  const dec = 0.006918-0.399912*Math.cos(g)+0.070257*Math.sin(g)-0.006758*Math.cos(2*g)+0.000907*Math.sin(2*g)-0.002697*Math.cos(3*g)+0.00148*Math.sin(3*g);
  const ha = (hour*60+eq+4*lon)/4*RAD-Math.PI, phi=lat*RAD;
  const altitude = Math.asin(clamp(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(ha),-1,1));
  const azimuth = (Math.atan2(Math.sin(ha),Math.cos(ha)*Math.sin(phi)-Math.tan(dec)*Math.cos(phi))+Math.PI+2*Math.PI)%(2*Math.PI);
  return { altitude:altitude/RAD, azimuth:azimuth/RAD, vector:{ x:Math.sin(azimuth)*Math.cos(altitude), y:Math.sin(altitude), z:-Math.cos(azimuth)*Math.cos(altitude) }, doy };
}
// Convert a wall clock in a named time zone to UTC, including daylight saving.
export function zonedTimestamp(date, hour, timezone) {
  const target = Date.parse(`${date}T00:00:00Z`) + hour*3600000;
  const fmt = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let value=target;
  for(let i=0;i<3;i++) {
    const p=Object.fromEntries(fmt.formatToParts(new Date(value)).map(p=>[p.type,p.value]));
    const displayed=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    value+=target-displayed;
  }
  return value;
}
export function panelGeometry(s) {
  const p=s.panel,h=s.house, beta=p.tilt*RAD, az=p.azimuth*RAD;
  const side={north:0,east:90,south:180,west:270}[p.side]??180;
  // Building rotation follows Three.js +Y geometry; compass azimuth increases
  // in the opposite direction in our x=east, z=south coordinate system.
  const sa=(side-h.rotation)*RAD;
  const half = facadeDistance(h,side-h.rotation,p.offset||0),offset=p.offset||0;
  const roofPoint=p.side==='roof'?roofMountPoint(h):null;
  const center = p.side==='roof' ? {...roofPoint,y:(h.mesh?meshRoofHeight(h,roofPoint):buildingHeight(h))+0.5+p.length*Math.sin(beta)/2} : {
    x:Math.sin(sa)*(half+0.35+p.length*Math.cos(beta)/2)+Math.cos(sa)*offset,
    y:p.floor*h.floorHeight+p.mountHeight, z:-Math.cos(sa)*(half+0.35+p.length*Math.cos(beta)/2)+Math.sin(sa)*offset };
  const normal={x:Math.sin(beta)*Math.sin(az),y:Math.cos(beta),z:-Math.sin(beta)*Math.cos(az)};
  const u={x:Math.cos(az),y:0,z:Math.sin(az)};
  const v={x:Math.sin(az)*Math.cos(beta),y:-Math.sin(beta),z:-Math.cos(az)*Math.cos(beta)};
  const modules=[];
  for(let i=0;i<p.count;i++) {
    const offset=(i-(p.count-1)/2)*(p.width+0.06), points=[];
    const c={x:center.x+u.x*offset,y:center.y,z:center.z+u.z*offset};
    for(const a of [-0.4,0,0.4]) for(const b of [-0.4,0,0.4]) points.push({x:c.x+u.x*a*p.width+v.x*b*p.length,y:c.y+v.y*b*p.length,z:c.z+u.z*a*p.width+v.z*b*p.length});
    modules.push({center:c,points});
  }
  return {center,normal,u,v,modules};
}
export function rayBox(origin, dir, box) {
  const a=-(box.rotation||0)*RAD;
  const o=rotate({x:origin.x-box.x,y:origin.y-(box.base||0),z:origin.z-box.z},a), d=rotate(dir,a);
  let near=0.001,far=Infinity;
  for(const [axis,min,max] of [['x',-box.width/2,box.width/2],['y',0,box.height-(box.base||0)],['z',-box.depth/2,box.depth/2]]) {
    if(Math.abs(d[axis])<1e-9) { if(o[axis]<min||o[axis]>max) return false; }
    else { const t1=(min-o[axis])/d[axis],t2=(max-o[axis])/d[axis]; near=Math.max(near,Math.min(t1,t2)); far=Math.min(far,Math.max(t1,t2)); if(near>far) return false; }
  }
  return far>0.001;
}
export function rayTree(o,d,tree) {
  const ry=(tree.crown||tree.height*0.6)/2, cy=tree.height-ry, r=tree.radius;
  const q={x:(o.x-tree.x)/r,y:(o.y-cy)/ry,z:(o.z-tree.z)/r};
  const v={x:d.x/r,y:d.y/ry,z:d.z/r};
  const a=dot(v,v),b=2*dot(q,v),c=dot(q,q)-1,disc=b*b-4*a*c;
  return disc>=0 && (-b+Math.sqrt(disc))/(2*a)>0.001;
}
export function transmission(origin, direction, obstacles, month, lat) {
  let t=1;
  for(const o of obstacles) {
    if(o.type==='tree') {
      if(rayTree(origin,direction,o)) {
        const m=lat<0 ? (month+5)%12+1 : month;
        const on=o.leafStart<=o.leafEnd ? m>=o.leafStart&&m<=o.leafEnd : m>=o.leafStart||m<=o.leafEnd;
        t*=(!o.deciduous||on ? o.leafOn : o.leafOff)/100;
      }
    } else if(rayBox(origin,direction,o)&&(o.mesh?meshHits(origin,direction,o).length:!o.footprint||rayPrism(origin,direction,o))) return 0;
  }
  return t;
}
export function prepareScene(s) {
  const geometry=panelGeometry(s);
  const objects=[{type:'building',x:0,z:0,width:s.house.width,depth:s.house.depth,height:buildingHeight(s.house),rotation:s.house.rotation,footprint:s.house.footprint,mesh:s.house.mesh},...s.obstacles];
  // Integrate projected visible sky and ground separately on a hemisphere.
  const sky=Array(12).fill(0),ground=Array(12).fill(0);
  let skyDen=0,groundDen=0;
  const samples=[];
  for(let i=0;i<8;i++) for(let j=0;j<24;j++) {
    const y=(i+0.5)/8,az=(j+0.5)*Math.PI/12;
    for(const sign of [1,-1]) {
      const dir={x:Math.sin(az)*Math.sqrt(1-y*y),y:sign*y,z:-Math.cos(az)*Math.sqrt(1-y*y)};
      const weight=Math.max(0,dot(geometry.normal,dir));
      if(sign>0) skyDen+=weight; else groundDen+=weight;
      if(weight) samples.push({dir,weight,sign});
    }
  }
  for(let m=1;m<=12;m++) for(const {dir,weight,sign} of samples) {
    let tr=0;
    for(const module of geometry.modules) tr+=transmission(module.center,dir,objects,m,s.location.lat);
    (sign>0?sky:ground)[m-1]+=weight*tr/geometry.modules.length;
  }
  return {geometry,objects,sky:sky.map(v=>v/(skyDen||1)),ground:ground.map(v=>v/(groundDen||1))};
}
export function generationAt(s, weather, scene, shade=true, degradation=1) {
  const sun=weather.sun||solarPosition(weather.time,s.location.lat,s.location.lon);
  if(sun.altitude<=0) return {power:0,unshaded:0,transmission:1,poa:0,temperature:weather.temp};
  const p=s.panel,beta=p.tilt*RAD, cosi=Math.max(0,dot(scene.geometry.normal,sun.vector));
  const month=new Date(weather.time).getUTCMonth()+1;
  const extra=1367*(1+0.033*Math.cos(2*Math.PI*sun.doy/365));
  const anisotropy=clamp(weather.dni/extra,0,1);
  const rb=Math.min(12,cosi/Math.max(0.087,sun.vector.y));
  const iam=cosi>0 ? clamp(1-0.05*(1/cosi-1),0,1) : 0;
  const direct=(weather.dni*cosi*iam+weather.dhi*anisotropy*rb*iam);
  const diffuse=weather.dhi*(1-anisotropy)*(1+Math.cos(beta))/2*0.96;
  const reflected=weather.ghi*p.albedo*(1-Math.cos(beta))/2*0.96;
  let moduleTr=scene.geometry.modules.map(module=>shade ? module.points.reduce((sum,point)=>sum+transmission(point,sun.vector,scene.objects,month,s.location.lat),0)/module.points.length : 1);
  if(p.wiring==='string') moduleTr=moduleTr.map(()=>Math.min(...moduleTr));
  const sky=shade?scene.sky[month-1]:1,ground=shade?scene.ground[month-1]:1;
  let dc=0,poaMean=0,tempMean=0;
  for(const tr of moduleTr) {
    const poa=Math.max(0,direct*tr+diffuse*sky+reflected*ground);
    const [u0,u1]=p.cooling==='open'?[26.9,6.2]:[20,3.2];
    const temp=weather.temp+poa/(u0+u1*Math.max(0,weather.wind)*0.7);
    const thermal=Math.max(0,1+p.tempCoefficient/100*(temp-25));
    const lowLight=poa>0?clamp(1+0.02*Math.log(Math.max(poa,1)/1000),0.75,1.02):0;
    const winter=s.location.lat<0 ? month>=6&&month<=8 : month<=2||month===12;
    const snow=winter ? 1-p.snowLoss/100 : 1;
    dc+=p.watts*poa/1000*thermal*lowLight*(1-p.losses/100)*snow*degradation;
    poaMean+=poa/moduleTr.length; tempMean+=temp/moduleTr.length;
  }
  const power=Math.min(p.inverter,dc*p.efficiency/100);
  return {power,poa:poaMean,temperature:tempMean,transmission:moduleTr.reduce((a,b)=>a+b,0)/moduleTr.length};
}
const profileWeights = {
  evening:[0.12,0.09,0.08,0.08,0.09,0.18,0.6,1.3,1.1,0.45,0.35,0.4,0.7,0.5,0.4,0.45,0.65,1.3,1.8,1.9,1.7,1.2,0.6,0.25],
  home:[0.12,0.09,0.08,0.08,0.1,0.2,0.5,0.9,1,1.1,1.1,1.2,1.4,1.2,1,1,1.2,1.3,1.5,1.5,1.2,0.8,0.4,0.2],
  flat:Array(24).fill(1)
};
export function consumptionPlan(s,year) {
  const c=s.consumption;
  const yearHours=(zonedTimestamp(`${year+1}-01-01`,0,s.location.timezone)-zonedTimestamp(`${year}-01-01`,0,s.location.timezone))/3600000;
  const floor=c.base/1000*yearHours;
  const total=Math.max(c.annual,floor),remaining=total-floor;
  const sum=c.monthly.reduce((a,b)=>a+b,0);
  const weights=profileWeights[c.profile]||profileWeights.evening,ws=weights.reduce((a,b)=>a+b,0);
  const baseline=c.monthly.map((v,m)=>{
    const next=new Date(Date.UTC(year,m+1,1)).toISOString().slice(0,10),start=`${year}-${String(m+1).padStart(2,'0')}-01`;
    return c.base/1000*(zonedTimestamp(next,0,s.location.timezone)-zonedTimestamp(start,0,s.location.timezone))/3600000;
  });
  const excess=c.monthly.map((v,m)=>Math.max(0,(sum?v/sum:1/12)*total-baseline[m]));
  const excessSum=excess.reduce((a,b)=>a+b,0);
  const monthly=baseline.map((v,m)=>v+remaining*(excessSum?excess[m]/excessSum:1/12));
  return {total,floor,monthly,weights,ws};
}
export function consumptionAt(s,plan,month,hour,year) {
  const base=s.consumption.base/1000;
  const days=new Date(Date.UTC(year,month,0)).getUTCDate();
  const extra=Math.max(0,plan.monthly[month-1]-base*24*days);
  return base+extra/days*plan.weights[hour]/plan.ws;
}
export function demoWeather(s,year) {
  const start=Date.UTC(year,0,1),end=Date.UTC(year+1,0,1),records=[];
  for(let t=start;t<end;t+=3600000) {
    const time=t+1800000,sun=solarPosition(time,s.location.lat,s.location.lon);
    const season=Math.cos((sun.doy-172-(s.location.lat<0?182:0))*2*Math.PI/365);
    const clouds=clamp(0.48+0.16*season+0.18*Math.sin(sun.doy*0.77)+0.1*Math.sin(sun.doy*0.17),0.15,0.87);
    const sy=Math.max(0,sun.vector.y),airmass=1/Math.max(0.1,sy);
    const dni=sy>0?Math.min(1000,1000*Math.pow(0.75,Math.pow(airmass,0.65))*clouds):0;
    const dhi=sy>0?95*Math.sqrt(sy)*(1.2-clouds):0;
    records.push({time,ghi:dni*sy+dhi,dni,dhi,temp:11+11*season+3*Math.sin((time/3600000%24-9)*Math.PI/12),wind:2.5,sun});
  }
  return records;
}
export function recordsFromArchive(data) {
  const h=data.hourly,keys=['temperature_2m','wind_speed_10m','shortwave_radiation','direct_normal_irradiance','diffuse_radiation'];
  if(!h||!h.time?.length||keys.some(k=>!Array.isArray(h[k])||h[k].length!==h.time.length)) throw Error('Incomplete weather file: hourly radiation, temperature and wind are required.');
  const records=[];let missing=0;
  for(let i=0;i<h.time.length;i++) {
    if(keys.some(k=>h[k][i]===null||!Number.isFinite(h[k][i]))) {missing++;continue;}
    const stamp=typeof h.time[i]==='number'?h.time[i]*1000:Date.parse(h.time[i]+'Z');
    records.push({time:stamp-1800000,temp:h.temperature_2m[i],wind:h.wind_speed_10m[i],ghi:h.shortwave_radiation[i],dni:h.direct_normal_irradiance[i],dhi:h.diffuse_radiation[i]});
  }
  if(missing) throw Error(`${missing} weather hours are missing. This dataset cannot support a complete annual calculation.`);
  return records;
}
function localParts(time,fmt) {
  const p=Object.fromEntries(fmt.formatToParts(new Date(time)).map(p=>[p.type,p.value]));
  return {year:+p.year,month:+p.month,day:+p.day,hour:+p.hour};
}
export function simulateYear(s,records,year,scene,degradation=1) {
  const plan=consumptionPlan(s,year),monthly=Array.from({length:12},()=>({generation:0,self:0,export:0,load:0,unshaded:0}));
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:s.location.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
  let annual=0,self=0,exported=0,unshaded=0;
  const hours=[],seen=new Set();
  for(const w of records) {
    const local=localParts(w.time,fmt);
    if(local.year!==year) continue;
    const {month,hour}=local;
    const g=generationAt(s,w,scene,true,degradation).power/1000;
    const un=generationAt(s,w,scene,false,degradation).power/1000;
    const load=consumptionAt(s,plan,month,hour,year);
    annual+=g;unshaded+=un;
    const m=monthly[month-1];m.generation+=g;m.load+=load;m.unshaded+=un;
    hours.push({time:w.time,generation:g,load,month});seen.add(w.time);
  }
  const expected=(zonedTimestamp(`${year+1}-01-01`,0,s.location.timezone)-zonedTimestamp(`${year}-01-01`,0,s.location.timezone))/3600000;
  if(seen.size!==expected)throw Error(`${year} has ${seen.size} of ${expected} required local-calendar hours. No incomplete annual total was used.`);
  // Normalize flexible demand in each local month to preserve exact monthly totals across DST.
  const base=s.consumption.base/1000;
  const counts=Array(12).fill(0);hours.forEach(h=>counts[h.month-1]++);
  const flexible=monthly.map((m,i)=>Math.max(0,m.load-counts[i]*base));
  const adjustedTargets=plan.monthly.map((target,i)=>Math.max(target,counts[i]*base));
  for(const h of hours){
    const i=h.month-1,ratio=flexible[i]>0?Math.max(0,adjustedTargets[i]-counts[i]*base)/flexible[i]:0;
    h.load=base+Math.max(0,h.load-base)*ratio;h.self=Math.min(h.generation,h.load);h.export=h.generation-h.self;
    self+=h.self;exported+=h.export;monthly[i].self+=h.self;monthly[i].export+=h.export;
  }
  monthly.forEach((m,i)=>m.load=adjustedTargets[i]);
  return {year,annual,self,exported,unshaded,monthly,hours,load:plan.total,coverage:seen.size};
}
export function financials(s,hours,generationScale=1) {
  const c=s.costs,capital=Math.max(0,c.hardware+c.installation-c.subsidy),years=[];
  let cumulative=-capital,npv=-capital,payback=null,discountedPayback=null;
  const yearly=[];
  for(let year=1;year<=c.lifetime;year++) {
    const deg=Math.pow(1-c.degradation/100,year-1),rate=Math.pow(1+c.escalation/100,year-1);
    let self=0,exp=0,energy=0;
    for(const h of hours) {const g=h.generation*deg*generationScale;self+=Math.min(g,h.load);exp+=Math.max(0,g-h.load);energy+=g;}
    const gross=(self*c.importRate+exp*c.exportRate)*rate;
    const net=gross-c.maintenance-(year===c.replacementYear?c.replacementCost:0);
    const old=cumulative;cumulative+=net;const discounted=net/Math.pow(1+c.discount/100,year);const oldNpv=npv;npv+=discounted;
    if(payback===null&&cumulative>=0) payback=capital===0?0:year-1+(-old)/(net||1);
    if(discountedPayback===null&&npv>=0) discountedPayback=capital===0?0:year-1+(-oldNpv)/(discounted||1);
    years.push({year,cumulative,npv,net});yearly.push({self,exported:exp,energy,gross,net});
  }
  return {capital,payback,discountedPayback,npv,cumulative,years,yearly,first:yearly[0]};
}
export function calculate(s,datasets) {
  const scene=prepareScene(s),years=[];
  if(datasets?.length) for(const data of datasets) years.push(simulateYear(s,recordsFromArchive(data),data.meta.year,scene));
  else {
    const y=LAST_YEAR;
    // Extra endpoint hours ensure complete local-calendar years in all time zones.
    const records=[...demoWeather(s,y-1).slice(-24),...demoWeather(s,y),...demoWeather(s,y+1).slice(0,24)];
    years.push(simulateYear(s,records,y,scene));
  }
  const n=years.length,monthly=Array.from({length:12},(_,m)=>Object.fromEntries(['generation','self','export','load','unshaded'].map(key=>[key,years.reduce((a,y)=>a+y.monthly[m][key],0)/n])));
  // Retain every weather year for nonlinear self-consumption and degradation calculations.
  const financeByYear=years.map(y=>financials(s,y.hours));
  const finance=averageFinances(financeByYear);
  const low=averageFinances(years.map(y=>financials(s,y.hours,1-s.costs.uncertainty/100)));
  const high=averageFinances(years.map(y=>financials(s,y.hours,1+s.costs.uncertainty/100)));
  return {annual:years.reduce((a,y)=>a+y.annual,0)/n,self:years.reduce((a,y)=>a+y.self,0)/n,
    exported:years.reduce((a,y)=>a+y.exported,0)/n,unshaded:years.reduce((a,y)=>a+y.unshaded,0)/n,
    load:years.reduce((a,y)=>a+y.load,0)/n,monthly,years:years.map(({hours,...rest})=>rest),finance,low,high,
    sky:scene.sky.reduce((a,b)=>a+b,0)/12,source:datasets?.length?'archive':'demo'};
}
function averageFinances(all) {
  const a=all[0],mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
  const years=a.years.map((y,i)=>({year:y.year,...Object.fromEntries(['cumulative','npv','net'].map(k=>[k,mean(all.map(v=>v.years[i][k]))]))}));
  function crossing(key) {if(a.capital===0)return 0;let old=-a.capital;for(const y of years){if(y[key]>=0)return y.year-1+(-old)/(y[key]-old);old=y[key];}return null;}
  return {...a,years,payback:crossing('cumulative'),discountedPayback:crossing('npv'),npv:mean(all.map(v=>v.npv)),cumulative:mean(all.map(v=>v.cumulative)),
    first:Object.fromEntries(Object.keys(a.first).map(k=>[k,mean(all.map(v=>v.first[k]))]))};
}
export function dayEstimate(s,datasets,date,preparedScene) {
  const scene=preparedScene||prepareScene(s),fmt=new Intl.DateTimeFormat('en-CA',{timeZone:s.location.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
  const target=date.slice(5),year=+date.slice(0,4),records=[];let samples=0;
  if(datasets?.length) {
    for(const data of datasets) {
      if(s.dayMode==='historical'&&data.meta.year!==year) continue;
      const all=recordsFromArchive(data),selected=all.filter(w=>{
        const p=localParts(w.time,fmt);
        return `${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`===target && (s.dayMode!=='historical'||p.year===year);
      });
      if(selected.length){samples++;records.push(...selected);}
    }
  } else if(s.dayMode!=='historical') {samples=1;records.push(...demoWeather(s,year).filter(w=>{const p=localParts(w.time,fmt);return `${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`===target;}));}
  if(!samples)return {available:false};
  const hourly=Array(24).fill(0);let energy=0,unshaded=0;
  for(const w of records) {
    const p=localParts(w.time,fmt), g=generationAt(s,w,scene).power;
    energy+=g/1000/samples;unshaded+=generationAt(s,w,scene,false).power/1000/samples;hourly[p.hour]+=g/samples;
  }
  return {available:true,energy,unshaded,hourly,samples};
}
