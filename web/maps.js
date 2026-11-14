import {cleanFootprint,pointInRing} from './geometry.js';
import {surfaceMesh} from './city-model.js';
import {sourceInfo} from './sources.js';
export const MAX_SCENE_OBJECTS=120;
const RAD=Math.PI/180;
export function mapTile(lat,lon){
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>=85||Math.abs(lon)>180)throw Error('Enter coordinates between 85° south and 85° north, and −180° to 180° longitude.');
  const row=Math.min(8749,Math.max(250,Math.floor((lat+90)/.02)));
  const cos=Math.max(.1,Math.cos((row*.02-90+.01)*RAD)),step=.02/cos;
  const col=Math.min(Math.ceil(360/step)-1,Math.max(0,Math.floor((lon+180)/step)));
  const bounds=mapTileBounds(row,col);
  return {row,col,bounds,widthKm:(bounds[3]-bounds[1])*111.32*cos,heightKm:(bounds[2]-bounds[0])*111.32};
}
export function mapTileBounds(row, col) {
  if (!Number.isInteger(row) || row < 250 || row >= 8750) throw Error('Invalid map area row.');
  const south = row * .02 - 90;
  const cos = Math.max(.1, Math.cos((south + .01) * RAD));
  const step = .02 / cos;
  if (!Number.isInteger(col) || col < 0 || col >= Math.ceil(360 / step)) throw Error('Invalid map area column.');
  const west = col * step - 180;
  return [Math.max(-85, south - .003), Math.max(-180, west - .003 / cos),
    Math.min(85, south + .023), Math.min(180, west + step + .003 / cos)].map(value => +value.toFixed(7));
}
export function parseMapLocation(value){
  const text=String(value).trim();
  let pair=text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(!pair){
    let url;try{url=new URL(text);}catch{throw Error('Enter latitude, longitude or an OpenStreetMap coordinate link.');}
    if(!['openstreetmap.org','www.openstreetmap.org'].includes(url.hostname))throw Error('Enter coordinates or an OpenStreetMap link. Other map services are not used.');
    const fragment=url.hash.match(/map=\d+(?:\.\d+)?\/(-?[\d.]+)\/(-?[\d.]+)/);
    pair=fragment||(url.searchParams.has('mlat')&&url.searchParams.has('mlon')?[null,url.searchParams.get('mlat'),url.searchParams.get('mlon')]:null);
    if(!pair)throw Error('This OpenStreetMap link has no usable coordinates. Paste latitude, longitude directly.');
  }
  const lat=+pair[1],lon=+pair[2];mapTile(lat,lon);return {lat,lon};
}
export function metricHeight(value){
  if(typeof value==='number')return Number.isFinite(value)&&value>0?value:null;
  if(typeof value!=='string')return null;
  const text=value.trim().replace(',','.');
  const feet=text.match(/^(\d+(?:\.\d+)?)\s*'\s*(\d+(?:\.\d+)?)?\s*(?:"|in)?$/);
  if(feet)return (+feet[1]+(+feet[2]||0)/12)*.3048;
  const match=text.match(/^(\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet)?$/i);
  if(!match)return null;
  const n=+match[1]*(/^(ft|feet)$/i.test(match[2]||'')?.3048:1);
  return n>0&&n<=500?n:null;
}
const validPoint=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
const toRing=points=>Array.isArray(points)?points.filter(validPoint).map(p=>[p.lon,p.lat]):[];
const same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8;
function joinRings(segments){
  const remaining=segments.filter(s=>s.length>=2).map(s=>s.slice()),rings=[];
  while(remaining.length){
    let ring=remaining.pop(),changed=true;
    while(!same(ring[0],ring.at(-1))&&changed){
      changed=false;
      for(let i=0;i<remaining.length;i++){
        let next=remaining[i];
        if(same(ring.at(-1),next.at(-1)))next=next.slice().reverse();
        if(same(ring.at(-1),next[0])){ring.push(...next.slice(1));remaining.splice(i,1);changed=true;break;}
        if(same(ring[0],next[0]))next=next.slice().reverse();
        if(same(ring[0],next.at(-1))){ring=[...next.slice(0,-1),...ring];remaining.splice(i,1);changed=true;break;}
      }
    }
    if(ring.length>=4&&same(ring[0],ring.at(-1)))rings.push(ring);
  }
  return rings;
}
export function osmFeatures(data){
  if(!Array.isArray(data?.elements))throw Error('The map response has no features.');
  const features=[],memberIds=new Set();
  const relations=data.elements.filter(e=>e.type==='relation'&&e.tags?.building&&e.tags.building!=='no');
  for(const r of relations){
    const members=(r.members||[]).filter(m=>m.type==='way'&&m.geometry?.length>=2);
    const outer=joinRings(members.filter(m=>m.role!=='inner').map(m=>toRing(m.geometry)));
    const inner=joinRings(members.filter(m=>m.role==='inner').map(m=>toRing(m.geometry)));
    if(!outer.length)continue;
    members.forEach(m=>memberIds.add(m.ref));
    for(const [i,ring] of outer.entries())features.push({id:`relation/${r.id}/${i}`,type:'building',tags:r.tags,rings:[ring,...inner.filter(h=>pointInRing(h[0][0],h[0][1],ring))]});
  }
  for(const e of data.elements){
    if(e.type==='way'&&e.tags?.building&&e.tags.building!=='no'&&!memberIds.has(e.id)){
      const ring=toRing(e.geometry);if(ring.length>=4&&same(ring[0],ring.at(-1)))features.push({id:`way/${e.id}`,type:'building',tags:e.tags,rings:[ring]});
    }else if(e.type==='node'&&e.tags?.natural==='tree'&&validPoint(e))features.push({id:`node/${e.id}`,type:'tree',tags:e.tags,point:[e.lon,e.lat]});
  }
  return features;
}
export function projectPoint(point,origin){return [(point[0]-origin.lon)*111320*Math.cos(origin.lat*RAD),-(point[1]-origin.lat)*111320];}
function sampleRing(ring){
  if(ring.length<=200)return ring;
  return ring.filter((p,i)=>i%Math.ceil(ring.length/180)===0||i===ring.length-1);
}
export function fitFootprint(rings,boundary=rings[0]){
  const outer=sampleRing(boundary);
  let best=null;
  for(let i=1;i<outer.length;i++){
    const dx=outer[i][0]-outer[i-1][0],dz=outer[i][1]-outer[i-1][1];if(Math.hypot(dx,dz)<.05)continue;
    let angle=Math.atan2(-dz,dx);angle=((angle%(Math.PI/2))+Math.PI/2)%(Math.PI/2);
    const c=Math.cos(angle),s=Math.sin(angle),local=outer.map(([x,z])=>[c*x-s*z,s*x+c*z]);
    const xs=local.map(p=>p[0]),zs=local.map(p=>p[1]),minx=Math.min(...xs),maxx=Math.max(...xs),minz=Math.min(...zs),maxz=Math.max(...zs);
    const area=(maxx-minx)*(maxz-minz);
    if(!best||area<best.area-.001)best={angle,c,s,minx,maxx,minz,maxz,area};
  }
  if(!best||best.area<.25)return null;
  const {c,s,minx,maxx,minz,maxz,angle}=best,width=maxx-minx,depth=maxz-minz,cx=(minx+maxx)/2,cz=(minz+maxz)/2;
  if(width>300||depth>300)return null;
  const normalized=rings.map(sampleRing).map(r=>r.map(([x,z])=>[+((c*x-s*z-cx)/width).toFixed(7),+((s*x+c*z-cz)/depth).toFixed(7)]));
  const footprint=cleanFootprint({outer:normalized[0],holes:normalized.slice(1)});if(!footprint)return null;
  return {x:c*cx+s*cz,z:-s*cx+c*cz,width,depth,rotation:angle/RAD,footprint};
}
function heightInfo(f){
  const height=metricHeight(f.tags.height),levels=metricHeight(f.tags['building:levels']);
  if(height)return {height,heightSource:'mapped',levels:levels?Math.round(levels):Math.max(1,Math.round(height/3))};
  if(levels)return {height:levels*3+(metricHeight(f.tags['roof:height'])||0),heightSource:'levels',levels:Math.round(levels)};
  return {height:f.type==='tree'?8:9,heightSource:'assumed',levels:3};
}
function ringDistance(ring){
  if(pointInRing(0,0,ring))return 0;let distance=Infinity;
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dz)/(dx*dx+dz*dz||1)));distance=Math.min(distance,Math.hypot(a[0]+t*dx,a[1]+t*dz));}
  return distance;
}
export function prepareMapFeatures(data,origin,radius=150){
  const features=[...(Array.isArray(data.features)?data.features:[]),...osmFeatures({elements:data.elements||[]})];
  return features.flatMap(f=>{
    const info=heightInfo(f);
    if(f.type==='tree'){
      const [x,z]=projectPoint(f.point,origin);if(Math.hypot(x,z)>radius)return [];
      const canopyRadius=metricHeight(f.tags.diameter_crown)/2||2.5;
      return [{id:f.id,type:'tree',name:f.tags.name||'Mapped tree',x,z,...info,radius:canopyRadius,crown:info.height*.65,
        deciduous:!['evergreen','needleleaved'].includes(f.tags.leaf_cycle||f.tags.leaf_type),leafOn:8,leafOff:55,leafStart:4,leafEnd:10,distance:Math.hypot(x,z)}];
    }
    const rings=f.rings.map(r=>r.map(p=>projectPoint(p,origin))),distance=ringDistance(rings[0]);
    if(distance>radius)return [];
    const surfacePoints=f.surfaces?.flatMap(surface=>surface.rings.flat().map(p=>projectPoint(p,origin)));
    // Roof overhangs must fit inside the same broad-phase bounds as the mesh.
    const boundary=surfacePoints?.length?convexHull(surfacePoints):rings[0];
    const fit=fitFootprint(rings,boundary);if(!fit)return [];
    const mesh=f.surfaces?surfaceMesh(f.surfaces,fit,origin,f.ground,info.height):null;
    if(f.surfaces&&!mesh)throw Error('An official building surface could not be represented safely. Your current scene is unchanged.');
    const contains=pointInRing(0,0,rings[0])&&!rings.slice(1).some(r=>pointInRing(0,0,r));
    return [{id:f.id,type:'building',name:f.tags.name||`Building ${f.id.split('/')[1]}`,rings,...fit,...info,heightSource:mesh?'official':info.heightSource,mesh,ground:f.ground||0,sourceId:f.sourceId||'osm',footprintApproximate:!!f.footprintApproximate,contains,distance,
      base:Math.min(info.height-.1,metricHeight(f.tags.min_height)||0)}];
  }).sort((a,b)=>a.distance-b.distance);
}
export function generateScene(features,ownId,settings,meta,radius=150){
  const own=features.find(f=>f.id===ownId&&f.type==='building');
  if(!own)throw Error('Select your building on the local map preview first.');
  const source=f=>({provider:sourceInfo({sourceId:f.sourceId}).provider,sourceId:f.sourceId||'osm',id:f.id,heightSource:f.heightSource,footprintApproximate:!!f.footprintApproximate});
  const floors=Math.max(1,Math.min(60,own.levels||Math.round(own.height/3)));
  const house={...settings.house,width:own.width,depth:own.depth,height:own.height,rotation:own.rotation,footprint:own.footprint,mesh:own.mesh||null,
    floors,floorHeight:Math.max(2,Math.min(6,own.height/floors)),source:source(own)};
  let panel={...settings.panel,offset:0};
  if(panel.side!=='roof'){
    const difference=a=>Math.abs(((a-panel.azimuth+540)%360)-180);
    const faces=[['north',0],['east',90],['south',180],['west',270]].map(([side,angle])=>({side,azimuth:(angle-own.rotation+360)%360}));
    const face=faces.sort((a,b)=>difference(a.azimuth)-difference(b.azimuth))[0];
    panel.side=face.side;panel.azimuth=face.azimuth;
  }
  const nearby=features.filter(f=>f.id!==ownId).sort((a,b)=>Math.hypot(a.x-own.x,a.z-own.z)-Math.hypot(b.x-own.x,b.z-own.z));
  // Preserve buildings when dense individual-tree mapping would otherwise fill
  // the entire scene cap before an important neighbouring building is included.
  const buildings=nearby.filter(f=>f.type==='building'),trees=nearby.filter(f=>f.type==='tree');
  const selected=[...buildings.slice(0,100),...trees.slice(0,MAX_SCENE_OBJECTS-Math.min(100,buildings.length))];
  if(selected.length<MAX_SCENE_OBJECTS)selected.push(...buildings.slice(100,100+MAX_SCENE_OBJECTS-selected.length));
  const obstacles=selected.map((f,i)=>{
    const elevation=f.type==='building'?(f.ground||0)-(own.ground||0):0;
    const common={id:`map-${i}`,type:f.type,name:f.name,x:f.x-own.x,z:f.z-own.z,height:f.height+elevation,source:source(f)};
    return f.type==='tree'?{...common,radius:f.radius,crown:f.crown,deciduous:f.deciduous,leafOn:f.leafOn,leafOff:f.leafOff,leafStart:4,leafEnd:10}:
      {...common,width:f.width,depth:f.depth,rotation:f.rotation,footprint:f.footprint,mesh:f.mesh||null,base:f.base+elevation};
  });
  return {house,panel,obstacles,mapScene:{provider:sourceInfo({sourceId:meta.source_id}).provider,sourceId:meta.source_id||'osm',warnings:meta.warnings||[],bounds:meta.bounds,downloadedAt:meta.downloaded_at,radius,
    buildingCount:selected.filter(f=>f.type==='building').length+1,treeCount:selected.filter(f=>f.type==='tree').length,
    assumedHeights:[own,...selected].filter(f=>f.heightSource==='assumed').length,
    levelsHeights:[own,...selected].filter(f=>f.heightSource==='levels').length,omitted:Math.max(0,nearby.length-MAX_SCENE_OBJECTS)}};
}

function convexHull(values){
  const points=values.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const half=points=>{const out=[];for(const p of points){while(out.length>1){const a=out.at(-2),b=out.at(-1);if((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])>1e-8)break;out.pop();}out.push(p);}return out;};
  return [...half(points).slice(0,-1),...half(points.slice().reverse()).slice(0,-1)];
}
