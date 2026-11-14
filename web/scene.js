import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {panelGeometry,solarPosition,zonedTimestamp,RAD,buildingHeight} from './model.js';

export class SolarScene {
  constructor(container,onSelect) {
    this.container=container;this.onSelect=onSelect;
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0xe9eddf,0);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.4;
    container.prepend(this.renderer.domElement);
    this.scene=new THREE.Scene();this.scene.fog=new THREE.Fog(0xe9eddf,95,180);
    this.camera=new THREE.PerspectiveCamera(36,1,0.1,1000);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=true;this.controls.dampingFactor=.08;
    this.controls.maxPolarAngle=Math.PI/2-.02;this.controls.minDistance=14;this.controls.maxDistance=900;
    this.scene.add(new THREE.HemisphereLight(0xfffdf2,0xb6c1a1,1.6));
    this.light=new THREE.DirectionalLight(0xffeccc,3.2);this.light.castShadow=true;
    this.light.shadow.mapSize.set(1024,1024);this.light.shadow.camera.left=-42;this.light.shadow.camera.right=42;
    this.light.shadow.camera.top=42;this.light.shadow.camera.bottom=-42;this.light.shadow.camera.near=1;this.light.shadow.camera.far=140;
    this.light.shadow.normalBias=.06;this.light.shadow.bias=-.0001;this.scene.add(this.light,this.light.target);
    this.environment=new THREE.Group();this.scene.add(this.environment);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(650,650),new THREE.MeshStandardMaterial({color:0xdfe5d2,roughness:1}));
    ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;this.environment.add(ground);
    const platform=new THREE.Mesh(new THREE.BoxGeometry(63,.24,56),new THREE.MeshStandardMaterial({color:0xe8e8da,roughness:.9}));
    platform.position.y=-.08;platform.receiveShadow=true;this.environment.add(platform);
    this.platform=platform;
    const grid=new THREE.GridHelper(60,30,0xd3dac5,0xdde2cf);grid.position.y=.055;grid.material.transparent=true;grid.material.opacity=.33;this.environment.add(grid);
    // A low-key north marker is fixed to world coordinates.
    this.label('N',0,0.12,-24,0x75876a,1.7);
    this.content=new THREE.Group();this.scene.add(this.content);
    this.pathGroup=new THREE.Group();this.scene.add(this.pathGroup);
    this.sun=new THREE.Mesh(new THREE.SphereGeometry(.62,20,20),new THREE.MeshBasicMaterial({color:0xe7b95c}));this.scene.add(this.sun);
    this.raycaster=new THREE.Raycaster();
    let down;
    container.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
    container.addEventListener('pointerup',e=>{
      if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
      if(e.target!==this.renderer.domElement)return;
      const r=container.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),this.camera);
      const hit=this.raycaster.intersectObjects(this.content.children,true).find(h=>h.object.userData.objectId);
      if(hit)this.onSelect(hit.object.userData.objectId);
    });
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);
    this.needsRender=true;
    this.controls.addEventListener('change',()=>{this.needsRender=true;});
    this.reset();this.resize();
    this.renderer.setAnimationLoop(()=>{
      const moved=this.controls.update();
      if(!this.needsRender&&!moved)return;
      this.needsRender=false;this.renderer.render(this.scene,this.camera);
      const dir=this.camera.position.clone().sub(this.controls.target);
      container.querySelector('.compass svg').style.transform=`rotate(${Math.atan2(dir.x,dir.z)/RAD}deg)`;
    });
  }
  mat(color,extra={}){return new THREE.MeshStandardMaterial({color,roughness:.85,...extra});}
  box(w,h,d,x,y,z,color,parent=this.content,cast=true){
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),typeof color==='object'?color:this.mat(color));
    mesh.position.set(x,y,z);mesh.castShadow=cast;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  label(text,x,y,z,color=0x637c56,scale=2,parent=this.environment) {
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=80;
    const ctx=canvas.getContext('2d');ctx.font='500 30px sans-serif';ctx.textAlign='center';ctx.fillStyle=`#${color.toString(16).padStart(6,'0')}`;ctx.fillText(text,128,48);
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false}));sprite.position.set(x,y,z);sprite.scale.set(scale*3.2,scale,1);parent.add(sprite);return sprite;
  }
  building(o,own=false){
    if(o.mesh)return this.meshBuilding(o,own);
    if(o.footprint)return this.footprintBuilding(o,own);
    const g=new THREE.Group();g.position.set(o.x||0,o.base||0,o.z||0);g.rotation.y=(o.rotation||0)*RAD;this.content.add(g);
    const w=o.width,d=o.depth,h=o.height-(o.base||0);
    const body=this.box(w,h,d,0,h/2,0,own?0xe9e5d4:0xd9daca,g);body.userData.objectId=o.id;
    this.box(w+.22,.22,d+.22,0,h+.08,0,own?0xb7bca9:0xbfc5b1,g);
    this.box(w-.6,.07,d-.6,0,h+.23,0,own?0xd8d8c6:0xccd0be,g);
    this.box(w+.3,.22,d+.3,0,.14,0,0xc7ceba,g);
    const floors=Math.max(1,Math.round(h/3));
    const glass=this.mat(own?0x809a91:0x9cae9e,{roughness:.4,metalness:.1});
    for(let f=0;f<floors;f++) {
      const y=(f+.58)*h/floors;
      for(const side of [-1,1]) {
        const count=Math.max(1,Math.floor(w/2.7));
        for(let j=0;j<count;j++) {
          const x=(j-(count-1)/2)*2.7;
          const frame=this.box(1.25,1.45,.1,x,y,side*(d/2+.03),0xf0efe4,g,false);
          const win=this.box(1.04,1.22,.12,x,y,side*(d/2+.05),glass,g,false);win.userData.objectId=o.id;
          this.box(.045,1.24,.02,x,y,side*(d/2+.12),0xd3d9c9,g,false);
        }
      }
      for(const side of [-1,1]) for(let j=0;j<Math.floor(d/3);j++) {
        const z=(j-(Math.floor(d/3)-1)/2)*2.9;
        this.box(.1,1.45,1.25,side*(w/2+.03),y,z,0xf0efe4,g,false);
        this.box(.12,1.22,1.04,side*(w/2+.05),y,z,glass,g,false).userData.objectId=o.id;
      }
    }
    if(own){
      this.box(1.25,2.1,.12,0,1.08,d/2+.06,0x7c8d77,g,false);
      this.label('YOUR BUILDING',0,h+1.6,0,0x6b7e5b,1.4,this.content);
    }
    return g;
  }
  meshBuilding(o,own=false){
    const g=new THREE.Group(),height=o.height-(o.base||0),positions=o.mesh.triangles.map((v,i)=>v*[o.width,height,o.depth][i%3]);
    g.position.set(o.x||0,o.base||0,o.z||0);g.rotation.y=(o.rotation||0)*RAD;this.content.add(g);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
    const roof=o.mesh.roofCount*3;geometry.addGroup(0,roof,0);geometry.addGroup(roof,positions.length/3-roof,1);
    const mesh=new THREE.Mesh(geometry,[this.mat(own?0xaec298:0xb5c0a6,{side:THREE.DoubleSide}),this.mat(own?0xe6e4d0:0xd4d8c9,{side:THREE.DoubleSide})]);
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.objectId=o.id;g.add(mesh);
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:0xa5b09b,transparent:true,opacity:.5})));
    if(own)this.label('YOUR BUILDING',0,o.height+2,0,0x4b6a3e,1.7,this.content);
    return g;
  }
  footprintBuilding(o,own=false){
    const g=new THREE.Group(),base=o.base||0,h=o.height-base;
    g.position.set(o.x||0,base,o.z||0);g.rotation.y=(o.rotation||0)*RAD;this.content.add(g);
    const shape=new THREE.Shape();
    const trace=(path,ring)=>{ring.forEach(([x,z],i)=>path[i?'lineTo':'moveTo'](x*o.width,-z*o.depth));path.closePath();};
    trace(shape,o.footprint.outer);
    for(const ring of o.footprint.holes||[]){const hole=new THREE.Path();trace(hole,ring);shape.holes.push(hole);}
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,steps:1});geometry.rotateX(-Math.PI/2);
    const body=new THREE.Mesh(geometry,this.mat(own?0xe6e4d0:0xd4d8c9));body.castShadow=true;body.receiveShadow=true;body.userData.objectId=o.id;g.add(body);
    const roofGeometry=new THREE.ShapeGeometry(shape);roofGeometry.rotateX(-Math.PI/2);
    const roof=new THREE.Mesh(roofGeometry,this.mat(own?0xb9c9a5:o.source?.heightSource==='assumed'?0xc9bea4:0xbec5b2));roof.position.y=h+.025;roof.receiveShadow=true;roof.userData.objectId=o.id;g.add(roof);
    const outline=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:0xaeb8a1,transparent:true,opacity:.6}));g.add(outline);
    // Surrounding map buildings use a few draw calls each. Decorative per-window
    // meshes on an entire city block made orbiting and browser capture sluggish.
    if(!own)return g;
    const ring=o.footprint.outer,area=ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0),sign=area>0?1:-1;
    const floors=Math.max(1,Math.round(h/3)),glass=this.mat(own?0x7b978c:0x99ab9a,{roughness:.5});
    for(let i=0;i<ring.length;i++){
      const a=[ring[i][0]*o.width,ring[i][1]*o.depth],b=[ring[(i+1)%ring.length][0]*o.width,ring[(i+1)%ring.length][1]*o.depth];
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),count=Math.min(18,Math.floor(length/2.8));
      if(!count||length<2)continue;
      const nx=sign*dz/length,nz=-sign*dx/length;
      for(let f=0;f<floors;f+=Math.max(1,Math.ceil(floors/8)))for(let j=0;j<count;j++){
        const t=(j+.5)/count;
        const win=this.box(Math.min(1,length/count*.5),Math.min(1.25,h/floors*.5),.035,a[0]+dx*t+nx*.03,(f+.58)*h/floors,a[1]+dz*t+nz*.03,glass,g,false);
        win.rotation.y=Math.atan2(nx,nz);win.userData.objectId=o.id;
      }
    }
    if(own)this.label('YOUR BUILDING',0,o.height+2,0,0x4b6a3e,1.7,this.content);
    return g;
  }
  tree(o,month,latitude){
    const g=new THREE.Group();g.position.set(o.x,0,o.z);this.content.add(g);
    const crownHeight=o.crown||o.height*.6,cy=o.height-crownHeight/2;
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.17,.3,Math.max(.5,cy),8),this.mat(0x9a9376));
    trunk.position.y=cy/2;trunk.castShadow=true;trunk.userData.objectId=o.id;g.add(trunk);
    const m=latitude<0?(month+5)%12+1:month;
    const on=o.leafStart<=o.leafEnd?m>=o.leafStart&&m<=o.leafEnd:m>=o.leafStart||m<=o.leafEnd;
    const leafed=!o.deciduous||on;
    const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1,2),this.mat(leafed?0x91a66d:0xb5b39a,{flatShading:true,transparent:!leafed,opacity:leafed?1:.45}));
    crown.scale.set(o.radius,crownHeight/2,o.radius);crown.position.y=cy;crown.castShadow=leafed;crown.userData.objectId=o.id;g.add(crown);
  }
  panels(s){
    const p=s.panel,geometry=panelGeometry(s);
    const texture=document.createElement('canvas');texture.width=256;texture.height=384;
    const ctx=texture.getContext('2d');ctx.fillStyle='#234851';ctx.fillRect(0,0,256,384);
    ctx.strokeStyle='#698481';ctx.lineWidth=1;
    for(let x=0;x<=6;x++){ctx.beginPath();ctx.moveTo(x*256/6,0);ctx.lineTo(x*256/6,384);ctx.stroke();}
    for(let y=0;y<=12;y++){ctx.beginPath();ctx.moveTo(0,y*32);ctx.lineTo(256,y*32);ctx.stroke();}
    ctx.strokeStyle='#b1c3ad';ctx.lineWidth=6;ctx.strokeRect(2,2,252,380);
    const map=new THREE.CanvasTexture(texture);map.colorSpace=THREE.SRGBColorSpace;
    const basis=new THREE.Matrix4().makeBasis(new THREE.Vector3(...Object.values(geometry.u)),new THREE.Vector3(...Object.values(geometry.v)),new THREE.Vector3(...Object.values(geometry.normal)));
    for(const module of geometry.modules){
      const panel=new THREE.Mesh(new THREE.BoxGeometry(p.width,p.length,.055),[
        this.mat(0x81958b),this.mat(0x81958b),this.mat(0x81958b),this.mat(0x81958b),
        this.mat(0xffffff,{map,roughness:.3,metalness:.2}),this.mat(0x69796c)]);
      panel.setRotationFromMatrix(basis);panel.position.set(module.center.x,module.center.y,module.center.z);
      panel.castShadow=false;panel.receiveShadow=true;panel.userData.objectId='own';this.content.add(panel);
      const outline=new THREE.LineSegments(new THREE.EdgesGeometry(panel.geometry),new THREE.LineBasicMaterial({color:0x91ab82}));panel.add(outline);
    }
    this.label(`${p.count} × ${p.watts} W`,geometry.center.x,geometry.center.y+2,geometry.center.z,0x34563b,1.4,this.content);
  }
  clear(group){
    group.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}});
    group.clear();
  }
  update(s){
    const firstUpdate=!this.settings;
    this.settings=s;
    this.scene.fog.near=s.mapScene?(this.topView?800:220):95;this.scene.fog.far=s.mapScene?(this.topView?1400:550):180;
    const shadowExtent=s.mapScene?Math.max(80,s.mapScene.radius):42;
    this.light.shadow.camera.left=-shadowExtent;this.light.shadow.camera.right=shadowExtent;this.light.shadow.camera.top=shadowExtent;this.light.shadow.camera.bottom=-shadowExtent;
    this.platform.scale.set(s.mapScene?(s.mapScene.radius*2+70)/63:1,1,s.mapScene?(s.mapScene.radius*2+70)/56:1);
    const key=JSON.stringify([s.house,s.panel,s.obstacles,s.date.slice(5,7)]);
    if(this.key!==key){
      this.key=key;this.clear(this.content);
      this.building({...s.house,id:'own',height:buildingHeight(s.house)},true);
      for(const o of s.obstacles)if(o.type==='tree')this.tree(o,+s.date.slice(5,7),s.location.lat);else this.building(o);
      this.panels(s);
    }
    const origin=panelGeometry(s).center,pathRadius=s.mapScene?Math.max(40,s.house.width+s.house.depth):30;
    const pathKey=JSON.stringify([s.date,s.location,origin,pathRadius]);
    if(this.pathKey!==pathKey){
      this.pathKey=pathKey;this.clear(this.pathGroup);const points=[];
      for(let hour=0;hour<=24;hour+=.15){const sun=solarPosition(zonedTimestamp(s.date,hour,s.location.timezone),s.location.lat,s.location.lon);if(sun.altitude>0)points.push(new THREE.Vector3(origin.x+sun.vector.x*pathRadius,origin.y+sun.vector.y*pathRadius,origin.z+sun.vector.z*pathRadius));}
      if(points.length>1){const path=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xd1b66e,transparent:true,opacity:.7}));this.pathGroup.add(path);}
    }
    const sun=solarPosition(zonedTimestamp(s.date,s.hour,s.location.timezone),s.location.lat,s.location.lon);
    this.sun.position.set(origin.x+sun.vector.x*pathRadius,origin.y+sun.vector.y*pathRadius,origin.z+sun.vector.z*pathRadius);this.sun.visible=sun.altitude>0;
    this.light.target.position.set(origin.x,origin.y,origin.z);
    this.light.position.set(origin.x+sun.vector.x*200,origin.y+Math.max(1,sun.vector.y*200),origin.z+sun.vector.z*200);
    this.light.shadow.camera.far=600;this.light.shadow.camera.updateProjectionMatrix();
    this.light.intensity=sun.altitude>0?2.2:0;this.light.castShadow=sun.altitude>0;
    this.renderer.toneMappingExposure=sun.altitude>0?1.05:.65;
    this.renderer.domElement.style.opacity=sun.altitude>0?'1':'.75';
    this.needsRender=true;
    if(firstUpdate&&s.mapScene)this.reset();
  }
  resize(){const w=this.container.clientWidth,h=this.container.clientHeight;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);this.needsRender=true;}
  reset(top=false){
    const s=this.settings,r=s?.mapScene?Math.max(95,s.house.width*1.7,s.house.depth*1.7,buildingHeight(s.house)*2.1):50;
    const y=s?.mapScene?buildingHeight(s.house)*.4:4;this.topView=top;
    const topHeight=s?.mapScene?(s.mapScene.radius*2+50)/(2*Math.tan(18*RAD)):r*1.4;
    this.controls.target.set(0,y,3);this.camera.position.set(top?.01:-r*.36,top?topHeight:y+r*(s?.mapScene?.85:.55),top?.01:r*.9);
    if(s?.mapScene){this.scene.fog.near=top?800:220;this.scene.fog.far=top?1400:550;}
    this.controls.update();this.needsRender=true;
  }
}
