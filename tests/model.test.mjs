import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,clone,solarPosition,zonedTimestamp,roundedLocation,rayBox,rayTree,transmission,prepareScene,generationAt,consumptionPlan,consumptionAt,financials,calculate,dayEstimate,recordsFromArchive,simulateYear,demoWeather} from '../web/model.js';
const near=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} should be within ${tolerance} of ${expected}`);

test('NOAA geometry has sensible equinox, solstice and night positions',()=>{
  assert.ok(solarPosition(Date.UTC(2025,2,20,12),0,0).altitude>87);
  const noon=solarPosition(Date.UTC(2025,5,21,11),52.5,13.4);
  assert.ok(noon.altitude>60&&noon.altitude<62);assert.ok(noon.azimuth>170&&noon.azimuth<190);
  assert.ok(solarPosition(Date.UTC(2025,5,21,0),52.5,13.4).altitude<0);
});
test('named-zone wall clocks correctly handle DST and fractional UTC offsets',()=>{
  assert.equal(new Date(zonedTimestamp('2025-06-21',13,'Europe/Berlin')).toISOString(),'2025-06-21T11:00:00.000Z');
  assert.equal(new Date(zonedTimestamp('2025-12-21',13,'Europe/Berlin')).toISOString(),'2025-12-21T12:00:00.000Z');
  assert.equal(new Date(zonedTimestamp('2025-06-21',13,'Asia/Kolkata')).toISOString(),'2025-06-21T07:30:00.000Z');
});
test('location coarsening has a hard minimum grid and supports negative coordinates',()=>{
  const a=roundedLocation({lat:52.512346,lon:13.412345,grid:.001});
  near(a.lat,52.5);near(a.lon,13.4);assert.equal(a.grid,.1);
  near(roundedLocation({lat:-33.891,lon:151.198,grid:.25}).lat,-34);
});
test('ray intersection respects rotated building geometry and height',()=>{
  const box={x:0,z:10,width:2,depth:8,height:10,rotation:0};
  assert.equal(rayBox({x:0,y:5,z:0},{x:0,y:0,z:1},box),true);
  assert.equal(rayBox({x:3,y:5,z:0},{x:0,y:0,z:1},box),false);
  assert.equal(rayBox({x:3,y:5,z:0},{x:0,y:0,z:1},{...box,rotation:90}),true);
  assert.equal(rayBox({x:0,y:12,z:0},{x:0,y:0,z:1},box),false);
});
test('tree ellipsoid and seasonal transmission affect only intersecting rays',()=>{
  const tree={type:'tree',x:0,z:10,height:10,radius:3,crown:6,deciduous:true,leafOn:10,leafOff:60,leafStart:4,leafEnd:10};
  const o={x:0,y:7,z:0},d={x:0,y:0,z:1};
  assert.ok(rayTree(o,d,tree));near(transmission(o,d,[tree],6,52),.1);near(transmission(o,d,[tree],1,52),.6);
  near(transmission(o,d,[tree],6,-34),.6);
  near(transmission({x:7,y:7,z:0},d,[tree],6,52),1);
});
test('inverter clipping, nighttime, zero irradiance and thermal derating',()=>{
  const s=clone(defaults);s.panel.side='roof';s.panel.tilt=30;s.panel.inverter=100;
  const scene=prepareScene(s),w={time:Date.UTC(2025,5,21,11),ghi:1000,dni:950,dhi:100,temp:25,wind:2};
  near(generationAt(s,w,scene,false).power,100);
  near(generationAt(s,{...w,time:Date.UTC(2025,5,21,0)},scene,false).power,0);
  near(generationAt(s,{...w,ghi:0,dni:0,dhi:0},scene,false).power,0);
  s.panel.inverter=5000;const cold=generationAt(s,{...w,temp:0},prepareScene(s),false).power;
  assert.ok(generationAt(s,{...w,temp:40},prepareScene(s),false).power<cold);
});
test('annual and monthly demand include baseline rather than adding it twice',()=>{
  const s=clone(defaults);s.consumption.annual=s.consumption.monthly.reduce((a,b)=>a+b,0);
  const p=consumptionPlan(s,2025);near(p.monthly.reduce((a,b)=>a+b,0),p.total);
  p.monthly.forEach((v,i)=>near(v,s.consumption.monthly[i]));
  const used=Array.from({length:24},(_,h)=>consumptionAt(s,p,1,h,2025)).reduce((a,b)=>a+b,0)*31;
  near(used,p.monthly[0]);
  s.consumption.base=500;s.consumption.annual=100;const q=consumptionPlan(s,2024);near(q.total,500/1000*8784);
});
test('cash flows have analytic payback, handle replacement and discounting',()=>{
  const s=clone(defaults);Object.assign(s.costs,{hardware:1000,installation:0,subsidy:0,importRate:1,exportRate:0,maintenance:0,escalation:0,degradation:0,discount:0,lifetime:10,replacementYear:0});
  const f=financials(s,[{generation:250,load:1000}]);near(f.payback,4);near(f.cumulative,1500);near(f.npv,1500);
  s.costs.replacementYear=3;s.costs.replacementCost=500;near(financials(s,[{generation:250,load:1000}]).payback,6);
  s.costs.importRate=0;assert.equal(financials(s,[{generation:250,load:1000}]).payback,null);
  s.costs.subsidy=2000;near(financials(s,[{generation:250,load:1000}]).payback,0);
});
test('degradation recalculates self-consumption rather than scaling the old proportion',()=>{
  const s=clone(defaults);Object.assign(s.costs,{degradation:10,importRate:1,exportRate:0,lifetime:2,escalation:0,maintenance:0});
  const f=financials(s,[{generation:2,load:1}]);near(f.yearly[0].self,1);near(f.yearly[1].self,1);near(f.yearly[1].exported,.8);
});
test('full-year conservation: generation=self+export, demand totals and leap years',()=>{
  const s=clone(defaults),r=calculate(s,[]);
  near(r.annual,r.self+r.exported);near(r.monthly.reduce((a,b)=>a+b.generation,0),r.annual);
  near(r.monthly.reduce((a,b)=>a+b.load,0),s.consumption.annual);
  assert.ok(r.annual<=r.unshaded+1e-6);assert.ok(r.low.payback>=r.finance.payback);assert.ok(r.high.payback<=r.finance.payback);
  const records=[...demoWeather(s,2023).slice(-24),...demoWeather(s,2024),...demoWeather(s,2025).slice(0,24)];
  const leap=simulateYear(s,records,2024,prepareScene(s));assert.equal(leap.coverage,8784);near(leap.hours.reduce((a,b)=>a+b.load,0),s.consumption.annual);
});
test('complete local years work west of UTC and in fractional offset zones',()=>{
  for(const timezone of ['America/New_York','Asia/Kolkata','Australia/Sydney']){
    const s=clone(defaults);s.location.timezone=timezone;
    const records=[...demoWeather(s,2024).slice(-24),...demoWeather(s,2025),...demoWeather(s,2026).slice(0,24)];
    const r=simulateYear(s,records,2025,prepareScene(s));assert.equal(r.coverage,8760);near(r.hours.reduce((a,b)=>a+b.load,0),s.consumption.annual,.001);
  }
});
test('an incomplete historical year is rejected rather than silently extrapolated',()=>{
  const s=clone(defaults),r=demoWeather(s,2025).slice(0,48);
  assert.throws(()=>simulateYear(s,r,2025,prepareScene(s)),/required local-calendar hours/);
});
test('historical mode never substitutes synthetic weather',()=>{
  const s=clone(defaults);s.dayMode='historical';assert.equal(dayEstimate(s,[],s.date).available,false);
  assert.throws(()=>recordsFromArchive({hourly:{time:[1]}}),/Incomplete/);
  const hourly={time:[100000]};for(const k of ['temperature_2m','wind_speed_10m','shortwave_radiation','direct_normal_irradiance','diffuse_radiation'])hourly[k]=[null];
  assert.throws(()=>recordsFromArchive({hourly}),/missing/);
});
test('a tall southern obstruction reduces annual generation',()=>{
  const s=clone(defaults);s.obstacles=[];const clear=calculate(s,[]);
  s.obstacles=[{type:'building',x:0,z:12,width:60,depth:5,height:40,rotation:0}];
  const shaded=calculate(s,[]);assert.ok(shaded.annual<clear.annual*.6);
});
