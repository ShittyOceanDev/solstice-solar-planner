import {ShapeUtils,Vector2} from './vendor/three.core.js';

// Surface polygons are triangulated in their own plane, including holes. The
// resulting normalized mesh is shared by the view and solar ray calculations.
export function surfaceMesh(surfaces,fit,origin,ground,height){
  const angle=fit.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),roof=[],other=[];
  const vertex=([lon,lat,y])=>{
    const x=(lon-origin.lon)*111320*Math.cos(origin.lat*Math.PI/180)-fit.x,z=-(lat-origin.lat)*111320-fit.z;
    return [(c*x-s*z)/fit.width,(y-ground)/height,(s*x+c*z)/fit.depth].map(v=>+v.toFixed(7));
  };
  for(const surface of surfaces){
    const rings=surface.rings.map(ring=>{const points=ring.map(vertex);if(points.length>3&&points[0].every((v,i)=>Math.abs(v-points.at(-1)[i])<1e-8))points.pop();return points;});if(!rings[0]||rings[0].length<3)continue;
    const ring=rings[0],normal=[0,0,0];
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];
      normal[0]+=(a[1]-b[1])*(a[2]+b[2]);normal[1]+=(a[2]-b[2])*(a[0]+b[0]);normal[2]+=(a[0]-b[0])*(a[1]+b[1]);
    }
    const axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),axes=[0,1,2].filter(i=>i!==axis);
    const project=r=>r.map(p=>new Vector2(p[axes[0]],p[axes[1]]));
    const triangles=ShapeUtils.triangulateShape(project(rings[0]),rings.slice(1).map(project)),vertices=rings.flat(),target=surface.kind==='RoofSurface'?roof:other;
    for(const indices of triangles)for(const index of indices)target.push(...vertices[index]);
  }
  return cleanMesh({triangles:[...roof,...other],roofCount:roof.length/9});
}

export function cleanMesh(value){
  if(!value||!Array.isArray(value.triangles)||!value.triangles.length||value.triangles.length%9||value.triangles.length>72000)return null;
  if(!value.triangles.every((v,i)=>Number.isFinite(v)&&(i%3===1?v>=-.001&&v<=1.001:Math.abs(v)<=.502)))return null;
  return {triangles:value.triangles.slice(),roofCount:Math.max(0,Math.min(value.triangles.length/9,Math.floor(+value.roofCount||0)))};
}

const cache=new WeakMap();
function bounds(triangles,indices){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const index of indices)for(let vertex=0;vertex<3;vertex++)for(let axis=0;axis<3;axis++){
    const value=triangles[index*9+vertex*3+axis];min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);
  }
  return {min,max};
}
function bvh(mesh){
  if(cache.has(mesh))return cache.get(mesh);
  const t=mesh.triangles;
  const build=indices=>{
    const node=bounds(t,indices);if(indices.length<=8){node.indices=indices;return node;}
    const axis=node.max.map((v,i)=>v-node.min[i]).indexOf(Math.max(...node.max.map((v,i)=>v-node.min[i])));
    indices.sort((a,b)=>(t[a*9+axis]+t[a*9+3+axis]+t[a*9+6+axis])-(t[b*9+axis]+t[b*9+3+axis]+t[b*9+6+axis]));
    const middle=Math.floor(indices.length/2);node.left=build(indices.slice(0,middle));node.right=build(indices.slice(middle));return node;
  };
  const result=build(Array.from({length:t.length/9},(_,i)=>i));cache.set(mesh,result);return result;
}
function slab(o,d,node){
  let near=.001,far=Infinity;
  for(let i=0;i<3;i++){
    if(Math.abs(d[i])<1e-12){if(o[i]<node.min[i]-1e-8||o[i]>node.max[i]+1e-8)return false;}
    else{const a=(node.min[i]-o[i])/d[i],b=(node.max[i]-o[i])/d[i];near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));if(near>far+1e-8)return false;}
  }
  return far>.001;
}
function triangle(o,d,t,index){
  const a=t.slice(index*9,index*9+3),b=t.slice(index*9+3,index*9+6),c=t.slice(index*9+6,index*9+9),u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
  const p=cross(d,v),det=dot(u,p);if(Math.abs(det)<1e-12)return null;
  const s=o.map((x,i)=>x-a[i]),beta=dot(s,p)/det;if(beta<-1e-8||beta>1+1e-8)return null;
  const q=cross(s,u),gamma=dot(d,q)/det;if(gamma<-1e-8||beta+gamma>1+1e-8)return null;
  const hit=dot(v,q)/det;return hit>.001?hit:null;
}
export function meshHits(origin,direction,box,first=true){
  const angle=-(box.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),x=origin.x-(box.x||0),z=origin.z-(box.z||0),height=box.height-(box.base||0);
  const o=[(c*x+s*z)/box.width,(origin.y-(box.base||0))/height,(-s*x+c*z)/box.depth];
  const d=[(c*direction.x+s*direction.z)/box.width,direction.y/height,(-s*direction.x+c*direction.z)/box.depth],hits=[];
  const visit=node=>{
    if(!slab(o,d,node))return false;
    if(node.indices){for(const index of node.indices){const hit=triangle(o,d,box.mesh.triangles,index);if(hit!==null){hits.push(hit);if(first)return true;}}return false;}
    return visit(node.left)&&first||visit(node.right)&&first;
  };
  visit(bvh(box.mesh));return hits;
}
export function meshRoofHeight(house,point){
  const origin={...point,y:house.height+1},hits=meshHits(origin,{x:0,y:-1,z:0},{...house,x:0,z:0},false);
  return hits.length?origin.y-Math.min(...hits):house.height;
}
