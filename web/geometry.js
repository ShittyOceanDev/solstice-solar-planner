// Normalized footprints stay in the building's own coordinate system. Editing
// width, depth, position or rotation transforms both the view and the ray model.
import {meshHits} from './city-model.js';
const EPS=1e-8;
export function cleanFootprint(value){
  if(!value||!Array.isArray(value.outer))return null;
  const ring=points=>{
    if(!Array.isArray(points)||points.length<3||points.length>400)return null;
    const result=[];
    for(const point of points){
      if(!Array.isArray(point)||point.length!==2||!point.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=.501))return null;
      if(!result.length||Math.hypot(point[0]-result.at(-1)[0],point[1]-result.at(-1)[1])>EPS)result.push([...point]);
    }
    if(result.length>3&&Math.hypot(result[0][0]-result.at(-1)[0],result[0][1]-result.at(-1)[1])<EPS)result.pop();
    const area=result.reduce((a,p,i)=>{const q=result[(i+1)%result.length];return a+p[0]*q[1]-q[0]*p[1];},0);
    return result.length>=3&&Math.abs(area)>EPS?result:null;
  };
  const outer=ring(value.outer);if(!outer)return null;
  const holes=(Array.isArray(value.holes)?value.holes:[]).slice(0,12).map(ring).filter(Boolean);
  return {outer,holes};
}
export function pointInRing(x,z,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [ax,az]=ring[j],[bx,bz]=ring[i];
    const cross=(x-ax)*(bz-az)-(z-az)*(bx-ax);
    if(Math.abs(cross)<EPS&&x>=Math.min(ax,bx)-EPS&&x<=Math.max(ax,bx)+EPS&&z>=Math.min(az,bz)-EPS&&z<=Math.max(az,bz)+EPS)return true;
    if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside;
  }
  return inside;
}
export function footprintContains(x,z,footprint){
  return pointInRing(x,z,footprint.outer)&&!(footprint.holes||[]).some(ring=>pointInRing(x,z,ring));
}
export function rayPrism(origin,direction,box){
  const angle=-(box.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const ox=origin.x-box.x,oz=origin.z-box.z;
  const o={x:(c*ox+s*oz)/box.width,y:origin.y-(box.base||0),z:(-s*ox+c*oz)/box.depth};
  const d={x:(c*direction.x+s*direction.z)/box.width,y:direction.y,z:(-s*direction.x+c*direction.z)/box.depth};
  const fp=box.footprint;
  const height=box.height-(box.base||0);
  if(o.y>EPS&&o.y<height-EPS&&footprintContains(o.x,o.z,fp))return true;
  if(Math.abs(d.y)>EPS)for(const y of [0,height]){
    const t=(y-o.y)/d.y;
    if(t>.001&&footprintContains(o.x+t*d.x,o.z+t*d.z,fp))return true;
  }
  for(const ring of [fp.outer,...(fp.holes||[])])for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],ex=b[0]-a[0],ez=b[1]-a[1];
    const det=d.x*ez-d.z*ex;if(Math.abs(det)<EPS)continue;
    const ax=a[0]-o.x,az=a[1]-o.z;
    const t=(ax*ez-az*ex)/det,u=(ax*d.z-az*d.x)/det,y=o.y+t*d.y;
    if(t>.001&&u>=-EPS&&u<=1+EPS&&y>=0&&y<=height)return true;
  }
  return false;
}
export function insideBuilding(point,building){
  if(point.y<=(building.base||0)||point.y>=building.height)return false;
  const a=-(building.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),dx=point.x-building.x,dz=point.z-building.z;
  const x=(c*dx+s*dz)/building.width,z=(-s*dx+c*dz)/building.depth;
  if(Math.abs(x)>.5||Math.abs(z)>.5)return false;
  if(building.mesh){
    const hits=meshHits(point,{x:0,y:1,z:0},building,false).sort((a,b)=>a-b),unique=hits.filter((v,i)=>!i||Math.abs(v-hits[i-1])>1e-5);
    return unique.length%2===1;
  }
  return !building.footprint||footprintContains(x,z,building.footprint);
}
export function facadeDistance(house,azimuth,offset=0){
  const a=(azimuth+house.rotation)*Math.PI/180,dx=Math.sin(a),dz=-Math.cos(a);
  const tx=Math.cos(a)*offset,tz=Math.sin(a)*offset;
  const ring=house.footprint?.outer||[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
  let distance=-Infinity;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];
    const ax=a[0]*house.width-tx,az=a[1]*house.depth-tz;
    const ex=(b[0]-a[0])*house.width,ez=(b[1]-a[1])*house.depth;
    const det=dx*ez-dz*ex;if(Math.abs(det)<EPS)continue;
    const t=(ax*ez-az*ex)/det,u=(ax*dz-az*dx)/det;
    if(u>=-EPS&&u<=1+EPS)distance=Math.max(distance,t);
  }
  return Number.isFinite(distance)?distance:Math.abs(dx)>Math.abs(dz)?house.width/2:house.depth/2;
}
export function roofMountPoint(house){
  const fp=house.footprint;
  if(!fp||footprintContains(0,0,fp))return {x:0,z:0};
  let best={x:0,z:0,clearance:-Infinity};
  for(let i=0;i<=20;i++)for(let j=0;j<=20;j++){
    const x=-.475+i*.0475,z=-.475+j*.0475;if(!footprintContains(x,z,fp))continue;
    let clearance=Infinity;
    for(const ring of [fp.outer,...(fp.holes||[])])for(let k=0;k<ring.length;k++){
      const a=ring[k],b=ring[(k+1)%ring.length],ax=a[0]*house.width,az=a[1]*house.depth,dx=(b[0]-a[0])*house.width,dz=(b[1]-a[1])*house.depth;
      const t=Math.max(0,Math.min(1,((x*house.width-ax)*dx+(z*house.depth-az)*dz)/(dx*dx+dz*dz||1)));
      clearance=Math.min(clearance,Math.hypot(x*house.width-ax-t*dx,z*house.depth-az-t*dz));
    }
    if(clearance>best.clearance)best={x:x*house.width,z:z*house.depth,clearance};
  }
  const a=house.rotation*Math.PI/180;
  return {x:best.x*Math.cos(a)+best.z*Math.sin(a),z:-best.x*Math.sin(a)+best.z*Math.cos(a)};
}
