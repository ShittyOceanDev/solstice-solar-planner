import test from 'node:test';
import assert from 'node:assert/strict';
import {mapTile,parseMapLocation,metricHeight,osmFeatures,prepareMapFeatures,generateScene,fitFootprint} from '../web/maps.js';
import {rayPrism,cleanFootprint,facadeDistance,roofMountPoint,footprintContains} from '../web/geometry.js';
import {defaults,clone,transmission,prepareScene,buildingHeight,panelGeometry,rayBox} from '../web/model.js';
const ring=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
const geo=(lon,lat)=>({lon,lat});
const fixture={elements:[
  {type:'way',id:1,tags:{building:'apartments','building:levels':'4',name:'Main building'},geometry:[geo(13.4,52.5),geo(13.4002,52.5),geo(13.4002,52.5002),geo(13.4,52.5002),geo(13.4,52.5)]},
  {type:'way',id:2,tags:{building:'yes',height:'22 m'},geometry:[geo(13.4005,52.5),geo(13.4007,52.5),geo(13.4007,52.5002),geo(13.4005,52.5002),geo(13.4005,52.5)]},
  {type:'way',id:3,tags:{building:'yes'},geometry:[geo(13.3997,52.5),geo(13.3998,52.5),geo(13.3998,52.5001),geo(13.3997,52.5001),geo(13.3997,52.5)]},
  {type:'node',id:4,lat:52.5003,lon:13.4002,tags:{natural:'tree',height:'9',diameter_crown:'6'}}
]};
test('map requests identify a broad tile, not the precise point',()=>{
  const a=mapTile(52.5208,13.4095),b=mapTile(52.52081,13.40951);
  assert.deepEqual(a,b);assert.ok(a.widthKm>2.8&&a.heightKm>2.8);
  const request={row:a.row,col:a.col};assert.deepEqual(Object.keys(request),['row','col']);assert.ok(!JSON.stringify(request).includes('52.5208'));
  assert.throws(()=>mapTile(89,0));
});
test('coordinates and OpenStreetMap links are parsed locally; other map services are rejected',()=>{
  assert.deepEqual(parseMapLocation('52.5208, 13.4095'),{lat:52.5208,lon:13.4095});
  assert.deepEqual(parseMapLocation('https://www.openstreetmap.org/#map=18/52.5208/13.4095'),{lat:52.5208,lon:13.4095});
  assert.deepEqual(parseMapLocation('https://www.openstreetmap.org/?mlat=52.5208&mlon=13.4095'),{lat:52.5208,lon:13.4095});
  assert.throws(()=>parseMapLocation('https://example.com/map?ll=52.5208,13.4095'),/Other map services/);
});
test('heights parse metres, feet and inches, and unknown values stay unknown',()=>{
  assert.equal(metricHeight('12 m'),12);assert.equal(metricHeight('10 ft'),3.048);assert.ok(Math.abs(metricHeight('6\' 2"')-1.8796)<1e-8);
  assert.equal(metricHeight('unknown'),null);assert.equal(metricHeight('-2'),null);
});
test('OSM objects generate editable real footprints and flag height assumptions',()=>{
  const features=prepareMapFeatures(fixture,{lat:52.5001,lon:13.4001},150);
  const own=features.find(f=>f.contains);assert.equal(own.id,'way/1');assert.equal(own.height,12);assert.equal(own.heightSource,'levels');
  const s=clone(defaults),generated=generateScene(features,own.id,s,{bounds:[52.49,13.39,52.52,13.42],downloaded_at:'2026-10-29'},150);
  assert.equal(generated.house.height,12);assert.equal(generated.obstacles.length,3);assert.ok(generated.house.footprint);
  assert.equal(generated.mapScene.assumedHeights,1);assert.equal(generated.mapScene.treeCount,1);
  assert.equal(generated.obstacles.find(o=>o.source.id==='way/2').height,22);
  assert.equal(generated.obstacles.find(o=>o.source.id==='way/3').source.heightSource,'assumed');
  assert.ok(!JSON.stringify(generated).includes('52.5001'));assert.ok(!JSON.stringify(generated).includes('13.4001'));
  s.house=generated.house;s.obstacles=generated.obstacles;assert.equal(prepareScene(s).objects[0].height,12);assert.equal(buildingHeight(s.house),12);
});
test('multipolygons join reversed segments, preserve holes and avoid member-way duplicates',()=>{
  const geometry=[geo(0,0),geo(.001,0),geo(.001,.001),geo(0,.001),geo(0,0)];
  const data={elements:[{type:'relation',id:9,tags:{building:'yes'},members:[
    {type:'way',ref:8,role:'outer',geometry:geometry.slice(0,3)},
    {type:'way',ref:7,role:'outer',geometry:[geometry[0],geometry[3],geometry[2]]},
    {type:'way',ref:6,role:'inner',geometry:[geo(.0002,.0002),geo(.0004,.0002),geo(.0004,.0004),geo(.0002,.0004),geo(.0002,.0002)]}
  ]},{type:'way',id:8,tags:{building:'yes'},geometry}]};
  const result=osmFeatures(data);assert.equal(result.length,1);assert.equal(result[0].rings.length,2);
});
test('prism rays preserve courtyards and concave gaps instead of shadowing the bounding rectangle',()=>{
  const courtyard={outer:ring,holes:[[[-.2,-.2],[.2,-.2],[.2,.2],[-.2,.2]]]};
  const box={x:0,z:0,width:10,depth:10,height:10,rotation:0,footprint:courtyard};
  assert.equal(rayPrism({x:0,y:5,z:0},{x:0,y:1,z:0},box),false);
  assert.equal(rayPrism({x:3,y:12,z:0},{x:0,y:-1,z:0},box),true);
  assert.equal(rayPrism({x:0,y:5,z:0},{x:1,y:0,z:0},box),true);
  assert.equal(transmission({x:0,y:5,z:0},{x:0,y:1,z:0},[box],6,52),1);
  const concave={...box,footprint:{outer:[[-.5,-.5],[.5,-.5],[.5,-.1],[-.1,-.1],[-.1,.5],[-.5,.5]],holes:[]}};
  assert.equal(rayPrism({x:3,y:5,z:3},{x:0,y:1,z:0},concave),false);
  assert.equal(rayPrism({x:-3,y:5,z:3},{x:0,y:1,z:0},concave),true);
});
test('edits to dimensions, orientation and base affect footprint shading; facade offsets reach the footprint',()=>{
  const box={x:0,z:10,width:2,depth:8,height:10,base:3,rotation:0,footprint:{outer:ring,holes:[]}};
  assert.equal(transmission({x:0,y:1,z:0},{x:0,y:0,z:1},[box],6,52),1);
  assert.equal(transmission({x:3,y:5,z:0},{x:0,y:0,z:1},[box],6,52),1);
  assert.equal(transmission({x:3,y:5,z:0},{x:0,y:0,z:1},[{...box,rotation:90}],6,52),0);
  assert.equal(transmission({x:0,y:11,z:0},{x:0,y:0,z:1},[box],6,52),1);
  assert.equal(facadeDistance({width:10,depth:8,rotation:0},180),4);
  assert.equal(cleanFootprint({outer:[[100,0],[0,1],[1,0]]}),null);
});
test('rotated facade panels sit outside the same building geometry used for ray tracing',()=>{
  for(const rotation of [15,30,75,120,225,300]){
    const s=clone(defaults);s.house.rotation=rotation;s.panel.side='south';s.panel.azimuth=(180-rotation+360)%360;s.obstacles=[];
    const scene=prepareScene(s),geometry=panelGeometry(s);
    assert.equal(rayBox(geometry.center,{x:0,y:1,z:0},scene.objects[0]),false);
    for(const m of geometry.modules)for(const point of m.points)assert.equal(transmission(point,geometry.normal,scene.objects,6,52),1);
  }
});
test('roof mounting chooses solid roof rather than the courtyard centre',()=>{
  const house={width:10,depth:10,rotation:0,footprint:{outer:ring,holes:[[[-.3,-.3],[.3,-.3],[.3,.3],[-.3,.3]]]}};
  const point=roofMountPoint(house);assert.equal(footprintContains(point.x/10,point.z/10,house.footprint),true);
});
