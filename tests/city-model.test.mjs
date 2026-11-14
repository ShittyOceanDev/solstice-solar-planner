import test from 'node:test';
import assert from 'node:assert/strict';
import {surfaceMesh,cleanMesh,meshHits} from '../web/city-model.js';
import {insideBuilding} from '../web/geometry.js';
import {defaults,clone,transmission,prepareScene} from '../web/model.js';
import {prepareMapFeatures,generateScene} from '../web/maps.js';

const origin={lat:52.5,lon:13.4};
const geo=([x,y,z])=>[origin.lon+x/(111320*Math.cos(origin.lat*Math.PI/180)),origin.lat-z/111320,y];
const polygon=(kind,points)=>({kind,rings:[points.map(geo)]});
const surfaces=[
 polygon('GroundSurface',[[-5,0,-5],[-5,0,5],[5,0,5],[5,0,-5]]),
 polygon('WallSurface',[[-5,0,-5],[5,0,-5],[5,6,-5],[0,10,-5],[-5,6,-5]]),
 polygon('WallSurface',[[-5,0,5],[-5,6,5],[0,10,5],[5,6,5],[5,0,5]]),
 polygon('WallSurface',[[-5,0,-5],[-5,6,-5],[-5,6,5],[-5,0,5]]),
 polygon('WallSurface',[[5,0,-5],[5,0,5],[5,6,5],[5,6,-5]]),
 polygon('RoofSurface',[[-5,6,-5],[0,10,-5],[0,10,5],[-5,6,5]]),
 polygon('RoofSurface',[[0,10,-5],[5,6,-5],[5,6,5],[0,10,5]])
];
const fit={x:0,z:0,rotation:0,width:10,depth:10};
const mesh=surfaceMesh(surfaces,fit,origin,0,10);
test('official roof geometry leaves clear sky above a low eave instead of blocking its bounding box',()=>{
  const box={type:'building',x:0,z:0,width:10,depth:10,height:10,base:0,rotation:0,mesh};
  assert.ok(mesh.roofCount>0);
  assert.equal(transmission({x:4,y:8,z:0},{x:0,y:1,z:0},[box],6,52),1);
  assert.equal(transmission({x:0,y:8,z:0},{x:0,y:1,z:0},[box],6,52),0);
  assert.equal(insideBuilding({x:4,y:8,z:0},box),false);
  assert.equal(insideBuilding({x:0,y:8,z:0},box),true);
  assert.equal(transmission({x:4,y:8,z:0},{x:0,y:1,z:0},[{...box,width:20}],6,52),0);
});
test('mesh transforms retain consistent rays under rotation, position and base edits',()=>{
  const box={type:'building',x:13,z:20,width:10,depth:10,height:13,base:3,rotation:90,mesh};
  assert.equal(meshHits({x:13,y:11,z:16},{x:0,y:1,z:0},box).length,0);
  assert.ok(meshHits({x:13,y:11,z:20},{x:0,y:1,z:0},box).length);
  assert.equal(cleanMesh({triangles:[100,0,0]}),null);
});
test('official features generate editable surfaces with provenance and relative ground elevations',()=>{
  const features=prepareMapFeatures({features:[{id:'de-bb-lod2/public-fixture',type:'building',tags:{height:10},rings:[surfaces[0].rings[0].map(p=>p.slice(0,2))],ground:0,surfaces,sourceId:'de-bb-lod2'}]},origin,150);
  assert.equal(features.length,1);assert.equal(features[0].heightSource,'official');assert.ok(features[0].mesh);
  const generated=generateScene(features,features[0].id,clone(defaults),{source_id:'de-bb-lod2',bounds:[52.49,13.39,52.51,13.41],downloaded_at:'2026-10-30'},150);
  assert.equal(generated.mapScene.sourceId,'de-bb-lod2');assert.equal(generated.house.source.provider,'Official3D');assert.ok(generated.house.mesh);
  const settings={...clone(defaults),...generated};settings.panel.side='roof';
  const scene=prepareScene(settings);assert.ok(scene.geometry.center.y>10);assert.ok(scene.objects[0].mesh);
  assert.ok(!JSON.stringify(generated).includes(origin.lat.toFixed(7)));
});
