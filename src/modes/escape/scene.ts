import * as T from 'three';
import {crewIndex} from './ui-art.js';
import {loadWorldArt,scenery,streetSign,artStatus} from './world-art.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {crewSpeed,constrainCrew,onDeck,clamp,PROP_INFO,type EscapeState,type PropKind,type CrewActor,type Enemy,type EscapeEvent,type Vec} from '../../../shared/escape.js';

export type GraphicsQuality='high'|'standard'|'economy';
const requestedGraphics=new URLSearchParams(location.search).get('graphics');
if(requestedGraphics&&['high','standard','economy'].includes(requestedGraphics))localStorage.setItem('houseflight.graphics',requestedGraphics);
const materials=new Map<string,T.MeshLambertMaterial>();
function mat(color:string,emission=0):T.MeshLambertMaterial {
  const key=color+':'+emission;
  if(!materials.has(key))materials.set(key,new T.MeshLambertMaterial({color,flatShading:true,emissive:emission?color:'#000000',emissiveIntensity:emission}));
  return materials.get(key)!;
}
const geos=new Map<string,T.BufferGeometry>();
function geometry(key:string,make:()=>T.BufferGeometry):T.BufferGeometry {if(!geos.has(key))geos.set(key,make());return geos.get(key)!;}
function box(g:T.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:string,rx=0,ry=0,rz=0,glow=0):T.Mesh {
  const m=new T.Mesh(geometry('box',()=>new T.BoxGeometry(1,1,1)),mat(color,glow));m.position.set(x,y,z);m.scale.set(w,h,d);m.rotation.set(rx,ry,rz);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;
}
function cylinder(g:T.Object3D,x:number,y:number,z:number,top:number,bottom:number,height:number,color:string,segments=10,rx=0,rz=0,glow=0):T.Mesh {
  const key='c'+top+','+bottom+','+height+','+segments;
  const m=new T.Mesh(geometry(key,()=>new T.CylinderGeometry(top,bottom,height,segments)),mat(color,glow));m.position.set(x,y,z);m.rotation.set(rx,0,rz);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;
}
function ball(g:T.Object3D,x:number,y:number,z:number,r:number,color:string,detail=1):T.Mesh {
  const m=new T.Mesh(geometry('ico'+detail,()=>new T.IcosahedronGeometry(1,detail)),mat(color));m.position.set(x,y,z);m.scale.setScalar(r);m.castShadow=true;g.add(m);return m;
}
// Static pieces share vertex colors, while lamps retain their emissive materials.
const solidMaterial=new T.MeshLambertMaterial({color:'#ffffff',vertexColors:true,flatShading:true});
materials.set('vertex-colors',solidMaterial);
function batch(group:T.Group,direct=false):T.Group {
  group.updateMatrixWorld(true);const buckets=new Map<T.Material,T.BufferGeometry[]>(),meshes:T.Mesh[]=[];
  const collect=(o:T.Object3D)=>{if(o instanceof T.Mesh&&o.material instanceof T.MeshLambertMaterial)meshes.push(o);};
  if(direct)group.children.forEach(collect);else group.traverse(collect);
  for(const mesh of meshes){
    const material=mesh.material as T.MeshLambertMaterial,target=material.emissiveIntensity>0&&material.emissive.getHex()!==0?material:solidMaterial;
    const list=buckets.get(target)??[],original=mesh.geometry.clone(),geo=original.index?original.toNonIndexed():original;
    geo.deleteAttribute('uv');
    if(target===solidMaterial){
      const count=geo.getAttribute('position').count,existing=geo.getAttribute('color'),colors=new Float32Array(count*3);
      for(let i=0;i<count;i++){colors[i*3]=material.color.r*(existing?.getX(i)??1);colors[i*3+1]=material.color.g*(existing?.getY(i)??1);colors[i*3+2]=material.color.b*(existing?.getZ(i)??1);}
      geo.setAttribute('color',new T.BufferAttribute(colors,3));
    }
    mesh.updateMatrix();geo.applyMatrix4(direct?mesh.matrix:mesh.matrixWorld);list.push(geo);if(geo!==original)original.dispose();buckets.set(target,list);
  }
  const merged=new T.Group();
  for(const [material,list] of buckets){const geo=mergeGeometries(list,false);if(geo){const m=new T.Mesh(geo,material);m.castShadow=true;m.receiveShadow=true;merged.add(m);}list.forEach(g=>g.dispose());}
  if(direct){meshes.forEach(m=>group.remove(m));group.add(...merged.children.slice());return group;}
  return merged;
}
function seeded(seed:number):()=>number {return()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};}
function ring(radius:number,color:string,opacity=.8):T.Mesh {
  const m=new T.Mesh(geometry('ring'+radius,()=>new T.RingGeometry(radius-.06,radius,48)),new T.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:T.DoubleSide}));
  m.rotation.x=-Math.PI/2;return m;
}
interface WorkerRig {root:T.Group;body:T.Group;arms:T.Group[];legs:T.Group[];head:T.Group;lamp:T.Mesh;shadow:T.Mesh}
function worker(color:string,index:number):WorkerRig {
  const root=new T.Group(),body=new T.Group();root.add(body);root.scale.setScalar(1.08);
  const skin=['#d8a57d','#bf825f','#edc7a1','#b67c5c'][index%4],dark='#303c43';
  cylinder(body,0,.96,0,.31,.4,.73,color,8);box(body,0,1.05,.285,.4,.4,.1,'#e7dbc1');box(body,0,.68,0,.76,.12,.52,dark);
  const head=new T.Group();head.position.set(0,1.52,0);body.add(head);
  ball(head,0,.03,0,.32,skin,2);box(head,0,-.07,.26,.32,.17,.12,skin);
  for(const side of [-1,1]){box(head,side*.12,.065,.296,.095,.1,.045,'#fff1d4');box(head,side*.12,.06,.326,.045,.065,.02,dark);}
  box(head,0,-.09,.323,.13,.025,.02,'#724b3e');
  const hair=['#634634','#303641','#704934','#3a302c'][index%4];
  ball(head,0,.12,-.035,.33,hair,1);box(head,0,-.02,.27,.35,.25,.12,skin);
  for(const side of [-1,1]){box(head,side*.12,.065,.32,.095,.1,.045,'#fff1d4');box(head,side*.12,.06,.35,.045,.065,.02,dark);}
  ball(head,0,-.025,.37,.055,skin,1);box(head,0,-.125,.351,.14,.025,.025,'#754c3e');
  if(index%4===0){
    cylinder(head,0,.26,0,.27,.35,.21,color,12);box(head,0,.17,.21,.75,.07,.37,color);box(head,0,.3,.27,.25,.16,.1,dark);
  }else if(index%4===1){
    cylinder(head,0,.26,-.03,.29,.33,.18,color,10);box(head,0,.21,.3,.64,.06,.42,color);box(head,0,.31,.1,.56,.05,.45,'#e6d5b1');
    for(const side of [-1,1])cylinder(head,side*.13,.05,.35,.105,.105,.05,dark,10,Math.PI/2);
  }else if(index%4===2){
    ball(head,0,.27,-.03,.32,color,1);cylinder(head,0,.19,0,.33,.33,.13,'#d6c8ab',10);
    ball(head,.28,-.03,-.25,.2,hair,1);box(body,0,1.36,.25,.67,.13,.18,'#dcaa70');box(body,-.18,1.1,.35,.18,.45,.08,'#dcaa70',0,0,-.13);
  }else{
    for(const side of [-1,1]){ball(head,side*.34,.05,-.02,.16,color,1);box(head,side*.33,.11,-.03,.15,.31,.23,color);}
    box(head,0,.36,-.04,.65,.09,.26,color);ball(head,.07,.29,.06,.24,hair,1);
    box(body,.43,.65,0,.34,.34,.3,'#d6aa6e');
  }
  const lamp=box(head,0,.3,.34,.12,.085,.035,'#ffe6ac',0,0,0,index%4===0?.8:0);
  box(body,0,1,-.37,.54,.58,.3,'#614c3e');box(body,0,1.08,-.55,.44,.12,.08,'#d8c3a0');
  cylinder(body,-.26,1,-.4,.07,.07,.55,'#b7cec5',8);cylinder(body,.26,1,-.4,.07,.07,.55,'#b7cec5',8);
  const arms:T.Group[]=[],legs:T.Group[]=[];
  for(const side of [-1,1]){
    const arm=new T.Group();arm.position.set(side*.4,1.2,0);body.add(arm);arms.push(arm);
    cylinder(arm,0,-.18,0,.13,.12,.36,color,8);ball(arm,0,-.36,0,.13,dark);cylinder(arm,0,-.48,.04,.11,.1,.25,color,8);
    ball(arm,0,-.65,.06,.13,'#483d34');if(side===1){box(arm,0,-.6,.23,.2,.18,.38,'#626f6a');cylinder(arm,0,-.6,.46,.08,.1,.12,'#f4ce7a',8,Math.PI/2);}
    const leg=new T.Group();leg.position.set(side*.19,.66,0);root.add(leg);legs.push(leg);
    cylinder(leg,0,-.2,0,.14,.125,.43,dark,8);box(leg,0,-.48,.06,.28,.18,.43,'#453c35');
  }
  const shadow=new T.Mesh(geometry('disc',()=>new T.CircleGeometry(.65,24)),new T.MeshBasicMaterial({color:'#122b30',transparent:true,opacity:.22,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2;shadow.position.y=.015;root.add(shadow);
  for(const part of [body,head,...arms,...legs])batch(part,true);
  const xray=new T.MeshBasicMaterial({color,transparent:true,opacity:.42,depthFunc:T.GreaterDepth,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  root.traverse(o=>{if(o instanceof T.Mesh&&o.material instanceof T.MeshLambertMaterial){const silhouette=new T.Mesh(o.geometry,xray);silhouette.renderOrder=4;o.add(silhouette);}});
  return{root,body,arms,legs,head,lamp,shadow};
}
function propModel(kind:PropKind,pad=false):T.Group {
  const g=new T.Group(),c=PROP_INFO[kind].color,dark='#39464b';
  if(kind==='barrel'){
    cylinder(g,0,.56,0,.39,.39,1.05,'#bd583f',12);for(const y of [.17,.84])cylinder(g,0,y,0,.415,.415,.1,dark,12);
    cylinder(g,0,1.1,0,.13,.13,.08,'#e3b488',8);box(g,0,.55,.397,.32,.36,.04,'#f5ce89');box(g,0,.58,.425,.06,.21,.02,'#79392c',0,0,.5);
  }else if(kind==='battery'){
    box(g,0,.48,0,.64,.8,.6,dark);box(g,0,.52,.315,.42,.55,.035,c,0,0,0,.7);
    box(g,0,.98,0,.27,.13,.22,'#d5c398');for(const side of [-1,1])box(g,side*.36,.48,0,.09,.62,.4,'#8ba398');
    box(g,0,.55,.345,.08,.28,.02,'#e6ffe3',0,0,-.3);
  }else if(kind==='repair'){
    box(g,0,.36,0,.9,.58,.58,'#859e68');box(g,0,.67,0,.4,.08,.1,dark);box(g,0,.36,.31,.15,.33,.03,'#f1e4bf');box(g,0,.36,.31,.35,.12,.03,'#f1e4bf');
    box(g,0,.08,0,.96,.1,.62,dark);
  }else if(kind==='spring'){
    box(g,0,.1,0,1.05,.2,1.05,dark);cylinder(g,0,.38,0,.26,.26,.4,'#c2accb',10);
    box(g,0,pad?.35:.65,0,1.15,.16,1.15,c);box(g,0,pad?.44:.74,0,.65,.025,.65,'#e6d9bd',0,Math.PI/4);
  }else{
    box(g,0,.38,0,.98,.7,.7,'#ae9b80');box(g,0,.4,0,1.02,.09,.76,dark);box(g,0,.4,0,.11,.76,.76,dark);
    cylinder(g,.25,.8,.1,.18,.18,.28,'#8caca5',8,0,Math.PI/2);box(g,-.28,.78,-.1,.2,.26,.3,'#d8c9a9',0,.3,.3);
  }
  return batch(g);
}
function monster(e:Enemy):T.Group {
  const g=new T.Group();
  if(e.kind==='devourer'){
    box(g,0,1.5,0,5,2.2,3.6,'#5c6867');box(g,0,2.7,.2,3.8,.6,2.9,'#a46245');
    for(const x of [-2.6,2.6]){box(g,x,.55,0,.9,1,4,'#303a3e');for(const z of [-1.3,0,1.3])cylinder(g,x,.58,z,.5,.5,1,'#525d5c',10,0,Math.PI/2);}
    cylinder(g,0,1.6,-1.92,1.15,1.15,.3,'#263e42',14,Math.PI/2);
    cylinder(g,0,1.6,-2.12,.77,.77,.14,'#ee8c57',14,Math.PI/2,0,.65);
    for(let i=0;i<8;i++){const a=i*Math.PI/4;box(g,Math.cos(a)*.92,1.6+Math.sin(a)*.92,-2.2,.23,.44,.24,'#e3c6a0',0,0,-a);}
    for(const x of [-1.7,1.7])box(g,x,2.4,-1.7,.5,.2,.12,'#ffe197',0,0,0,1.3);
    for(const x of [-2,2])cylinder(g,x,3.1,.8,.18,.22,1.4,'#383d3a',8);
  }else{
    const steel='#3e4b55',rust='#a26b51',rubber='#293741',eye='#f2ae63';
    if(e.kind==='scrapper'){
      box(g,0,.58,0,1.12,.66,.95,'#8c9b91');box(g,0,1.08,.03,.88,.48,.78,'#697d7a');
      box(g,0,1.08,-.39,.67,.17,.08,eye,0,0,0,.8);box(g,0,.45,-.6,.76,.2,.36,steel);
      for(const x of [-.6,.6]){cylinder(g,x,.3,0,.3,.3,.2,rubber,10,0,Math.PI/2);cylinder(g,x*1.05,.3,0,.13,.13,.24,rust,8,0,Math.PI/2);}
      for(const x of [-.39,.39])box(g,x,.45,-.81,.12,.1,.36,rust,.1,0,0);
      cylinder(g,.26,1.45,.1,.035,.035,.37,steel,6);ball(g,.26,1.65,.1,.08,eye,0);
    }else if(e.kind==='rammer'){
      box(g,0,.5,0,1.65,.9,1.5,rust);box(g,0,1.2,.24,1.14,.8,1.05,'#6f7d78');
      box(g,0,1.25,-.31,.85,.16,.08,eye,0,0,0,.8);
      for(const x of [-.95,.95]){box(g,x,.38,0,.42,.66,1.95,rubber);for(const z of [-.62,0,.62])cylinder(g,x,.38,z,.27,.27,.45,'#4b5c60',9,0,Math.PI/2);}
      for(const x of [-.5,.5]){box(g,x,.3,-1.15,.18,.18,1.05,'#d0b88e');box(g,x,.54,-.64,.18,.6,.2,steel);}
      cylinder(g,.47,1.8,.57,.08,.1,.65,steel,8);
    }else{
      box(g,0,1.1,0,.7,.85,.65,'#8d8c9b');box(g,0,1.55,-.05,.9,.4,.7,steel);
      box(g,0,1.55,-.42,.62,.14,.06,eye,0,0,0,.9);
      cylinder(g,0,.39,0,.36,.36,.38,rubber,12,Math.PI/2);cylinder(g,0,.39,-.22,.15,.15,.08,rust,8,Math.PI/2);
      for(const x of [-.65,.65]){box(g,x,1.1,-.17,.5,.17,.2,steel,0,0,x*.2);box(g,x*1.25,.95,-.42,.14,.16,.65,'#c1ad91',0,x*.4);box(g,x*1.35,.94,-.76,.18,.3,.12,steel);}
      cylinder(g,0,1.95,.1,.025,.025,.48,steel,6);ball(g,0,2.2,.1,.06,eye,0);
    }
  }
  const result=batch(g);
  if(e.kind==='rammer'){
    const shield=new T.Group();box(shield,0,.85,-.8,1.72,1.18,.28,'#797967',0,0,.03);
    for(const x of [-.55,.55])box(shield,x,.83,-.965,.18,.95,.018,'#d5b471',0,0,-.45);
    for(const x of [-.7,.7])for(const y of [.4,1.3])cylinder(shield,x,y,-.99,.055,.055,.035,'#d5d0b4',7,Math.PI/2);
    const armor=batch(shield);result.add(armor);result.userData.armor=armor;
  }
  if(e.kind==='devourer'){const material=new T.MeshLambertMaterial({color:'#87efd5',emissive:'#77ffe0',emissiveIntensity:1.1,});const core=new T.Mesh(new T.CylinderGeometry(.78,.78,.18,10).rotateX(Math.PI/2),material);core.position.set(0,1.6,-2.25);result.add(core);result.userData.core=core;
    const jaw=new T.Group();jaw.position.set(0,.85,-2.05);box(jaw,0,0,-.15,2.45,.28,.52,'#9f785c');
    for(const x of [-.85,-.28,.28,.85])box(jaw,x,.25,-.23,.25,.32,.22,'#d4bf98',.1);
    const plate=batch(jaw);plate.position.set(0,0,0);result.add(plate);result.userData.jaw=plate;}
  return result;
}
interface HouseRig{root:T.Group;cabin:T.Group;wheels:T.Group[];engine:T.Group;chimney:T.Vector3}
function houseModel():HouseRig {
  const root=new T.Group(),g=new T.Group(),wheels:T.Group[]=[];root.position.y=.85;
  box(g,0,.35,0,8.3,.45,10.2,'#364749');box(g,0,.64,0,8.1,.16,9.9,'#927356');
  for(let i=0;i<15;i++)box(g,0,.74,-4.75+i*.65,7.95,.06,.06,'#5e5345');
  box(g,0,.89,0,4.4,.4,5.1,'#4e6057');
  for(const x of [-2.08,2.08]){
    box(g,x,2.08,0,.22,2.55,4.9,'#b58b61');
    for(let y=1.05;y<3.35;y+=.3)box(g,x,y,0,.26,.035,4.9,'#936d4d');
    for(const z of [-2.35,2.35])box(g,x,2.1,z,.32,2.7,.3,'#506358');
    for(const z of [-1.35,1.15]){
      box(g,x*1.02,2.25,z,.13,1.18,1.12,'#414c43');
      box(g,x*1.06,2.25,z,.07,.94,.91,'#ffcd7b',0,0,0,.75);
      box(g,x*1.08,2.25,z,.08,1.08,.08,'#72593c');box(g,x*1.08,2.25,z,.08,.08,1.04,'#72593c');
      box(g,x*1.08,1.59,z,.4,.12,1.4,'#4d6251');
    }
  }
  for(const z of [-2.45,2.45]){
    box(g,0,2.05,z,4.15,2.5,.2,'#ba9269');box(g,0,1.9,z*1.01,1.14,2.1,.16,'#526e67');
    box(g,0,2.3,z*1.05,.78,.85,.08,'#f1c681',0,0,0,.65);
    box(g,.36,1.6,z*1.07,.08,.08,.1,'#ecd499');
    box(g,0,3.36,z,4.6,.2,.3,'#465d58');
    const triangle=new T.Shape();triangle.moveTo(-2.15,0);triangle.lineTo(0,1.5);triangle.lineTo(2.15,0);triangle.closePath();
    const m=new T.Mesh(new T.ShapeGeometry(triangle),mat('#819184'));m.position.set(0,3.4,z);if(z<0)m.rotation.y=Math.PI;g.add(m);
  }
  for(const side of [-1,1]){
    box(g,side*1.18,4.16,0,3.02,.2,5.8,'#4b6c8b',0,0,-side*.61);
    for(let z=-2.7;z<2.9;z+=.4)box(g,side*1.18,4.29,z,3.03,.055,.065,'#7894a0',0,0,-side*.61);
    box(g,side*2.38,3.42,0,.16,.2,6,'#334858');
  }
  box(g,0,4.98,0,.2,.16,5.9,'#b0b79c');
  box(g,1.17,4.32,1.6,1.15,.045,1.4,'#b57c59',0,0,-.61);box(g,-1.35,4.22,-1.5,.8,.055,1.05,'#a0afa7',0,0,.61);
  cylinder(g,-.65,5.25,1.9,.04,.04,1.4,'#394b52',6);box(g,-.65,5.8,1.9,1.3,.035,.035,'#394b52',0,.2,.08);
  // Porch: striped canvas, planters, rails, toolbox, navigation lamp.
  for(const x of [-3.9,3.9]){for(const z of [-4.8,0,4.8])box(g,x,1.18,z,.16,.95,.16,'#667264');box(g,x,1.6,0,.13,.13,9.8,'#c3b28c');}
  for(const z of [-4.85,4.85])box(g,0,1.6,z,7.8,.14,.14,'#c3b28c');
  for(const x of [-1.5,1.5])box(g,x,1.85,-4.2,.14,2.4,.14,'#5a6250');
  for(let i=0;i<8;i++)box(g,-1.38+i*.4,3.05,-3.4,.4,.09,1.8,i%2?'#e9c78e':'#a7583e',-.12);
  box(g,2.95,.98,-3.3,1.2,.48,1.2,'#896348');box(g,2.95,1.26,-3.3,1.13,.05,1.13,'#4f5b43');
  for(let i=0;i<5;i++)ball(g,2.65+(i%3)*.3,1.5+Math.sin(i)*.15,-3.55+Math.floor(i/3)*.4,.3,i%2?'#88a475':'#617e65');
  box(g,-2.95,1,-3.4,1.2,.5,.8,'#b98953');box(g,-2.95,1.3,-3.4,1.28,.12,.9,'#b4bb9e');
  cylinder(g,1.2,4.75,1.35,.22,.24,2,'#54605a',10);box(g,1.2,5.8,1.35,.8,.14,.8,'#9f9b7d');
  for(const x of [-3.55,3.55]){cylinder(g,x,1.4,4.3,.13,.13,1.15,'#586258',8);box(g,x,2.05,4.3,.38,.48,.38,'#e3ae64',0,0,0,1.2);}
  const cabin=batch(g);root.add(cabin);
  for(const x of [-4.05,4.05])for(const z of [-3.1,0,3.1]){
    const wheel=new T.Group();wheel.position.set(x,.05,z);root.add(wheel);wheels.push(wheel);
    cylinder(wheel,0,0,0,.87,.87,.66,'#303c3d',14,0,Math.PI/2);
    cylinder(wheel,x<0?-.36:.36,0,0,.6,.6,.09,'#9f8864',12,0,Math.PI/2);
    cylinder(wheel,x<0?-.43:.43,0,0,.2,.2,.14,'#d0b58a',10,0,Math.PI/2);
    for(let i=0;i<6;i++){const a=i*Math.PI/3;box(wheel,x<0?-.42:.42,Math.sin(a)*.37,Math.cos(a)*.37,.1,.13,.5,'#697768',a);}
  }
  const engine=new T.Group();engine.position.set(0,1.2,4);root.add(engine);
  cylinder(engine,0,0,0,.63,.63,1.7,'#4f736d',12,Math.PI/2);cylinder(engine,0,0,.9,.42,.42,.1,'#83e6ce',12,Math.PI/2,0,.8);
  box(engine,0,.65,0,1.2,.25,1.5,'#b89661');for(const x of [-.8,.8])cylinder(engine,x,0,0,.13,.13,1.5,'#beac81',8);
  for(const wheel of wheels)batch(wheel,true);batch(engine,true);
  return{root,cabin,wheels,engine,chimney:new T.Vector3(1.2,5.9,1.35)};
}
function chunkModel(index:number,biome:string):T.Group {
  const g=new T.Group(),details=new T.Group(),rand=seeded(index*9137+133),foundry=biome==='foundry',canal=biome==='canal';
  const ground=foundry?'#86776c':canal?'#9dafa1':'#b7ab91';
  box(g,0,-.75,0,canal?56:48,1.2,30,ground);box(g,0,-.08,0,11,.18,30,foundry?'#56535a':'#59636c');
  for(const side of [-1,1]){
    box(g,side*7.65,.005,0,4,.14,30,canal?'#a8b6ae':'#b6af9b');
    box(g,side*5.73,.09,0,.23,.27,30,'#e0d5b9');
    for(let z=-14;z<15;z+=2.5)box(g,side*7.65,.081,z,3.8,.018,.025,'#7b827b');
    if(canal){
      box(g,side*14.2,-.02,0,3.4,.1,30,'#467d8d');box(g,side*12.35,.25,0,.3,.65,30,'#768b91');box(g,side*16.1,.25,0,.3,.65,30,'#768b91');
      box(g,side*10.9,.045,0,2.6,.08,30,'#938978');for(let z=-14;z<15;z+=.7)box(g,side*10.9,.091,z,2.6,.012,.035,'#5c6664');
      for(const z of [-13,-6,1,8,14])box(g,side*12.25,.9,z,.12,1.4,.12,'#536c74');box(g,side*12.25,1.55,0,.12,.12,30,'#71898b');
      for(let i=0;i<9;i++)box(g,side*(12.8+rand()*2.8),.05,rand()*29-14,.5+rand(),.015,.05,'#8fc0c2',0,rand()*.5);
    }else{
      for(let i=0;i<8;i++){const x=side*(10+rand()*2),z=-14+i*3.7;box(g,x,.045,z,.45+rand()*.8,.035,.12,'#858b78',0,rand()*3);}
    }
  }
  for(let z=-12;z<15;z+=6){box(g,-.12,.025,z,.08,.025,2.5,'#d9ccb0');box(g,.12,.025,z,.08,.025,2.5,'#d9ccb0');}
  for(let i=0;i<8;i++){
    const x=(rand()-.5)*8,z=(rand()-.5)*29;box(g,x,.025,z,1+rand()*1.7,.013,.7+rand(),'#4e5963',0,rand()*.5);
    box(g,x,.041,z,.7+rand(),.014,.035,'#82908f',0,rand()*2);
  }
  for(const side of [-1,1]){
    for(let i=0;i<3;i++){
      const block=(Math.abs(index)+i+Number(side>0)*2)%4;
      const x=side*((canal?20.7:17)+(block===2?1.8:0)+rand()*.7),z=-11+i*11+(side>0?1.4:0)+rand(),size=block===1?6.8:block===3?8.6:7.5;
      const pack=foundry?'industrial':'commercial',name=foundry?['building-d','building-h','building-a','building-m'][block]:['building-c','building-a','building-f','building-h'][block];
      const model=scenery(pack+'/'+name,x,z,size,side<0?Math.PI/2:-Math.PI/2,['#f1dfc6','#d4ddd2','#e5cec0','#cbd3db'][(i+Math.abs(index)+Number(side>0))%4]);
      if(model)g.add(model);else box(g,x,1.8,z,size,3.6,size*.8,foundry?'#9b8777':'#a9aca5');
      // Ground shadows remain readable on integrated GPUs with dynamic shadows disabled.
      box(g,x+1.2,-.002,z+1.3,size+1,.02,size*.9,'#818c84',0,.05);
      if(i===1){
        const words=foundry?['대성공업사','고철 집하장','동양철물']:canal?['강변창고','수문 관리소','선착장']:['중앙상회','태양전파사','우리정비소'];
        const sign=streetSign(words[Math.abs(index)%words.length],foundry?'기계 · 용접 · 수리':canal?'운하구역  |  통행주의':'철거 구역  |  우회 통행',4.5,foundry?'#da8b5e':canal?'#91bcc0':'#e2bd64');
        sign.position.set(x,1.8,z-size*.45);sign.rotation.y=Math.PI;details.add(sign);
      }
    }
    if(foundry){
      const tower=scenery(Math.abs(index)%2?'industrial/detail-tank':'industrial/water-tower',side*13.8,8,4.1);if(tower)g.add(tower);
      const container=scenery('industrial/shipping-container-a',side*14,-9,4.5,side*.2);if(container)g.add(container);
    }
    // Road furniture breaks up the repeating grid without obstructing the playable shoulder.
    for(const z of [-10,7]){
      cylinder(g,side*6.25,1.8,z,.07,.1,3.6,'#394957',8);box(g,side*6.25,3.65,z,.8,.13,.3,'#394957');box(g,side*6.25,3.57,z,.65,.08,.22,'#f3d69c');
      box(g,side*9.1,.35,z+2,1.1,.7,.7,'#536b6b');box(g,side*9.1,.74,z+2,1.18,.1,.8,'#314453');
      for(const y of [.2,.35,.5])box(g,side*9.1,y,z+2.36,.85,.035,.03,'#83968b');
    }
    for(let i=0;i<5;i++){
      const x=side*((canal?17.8:13.5)+rand()*7),z=rand()*29-14;
      if(foundry){
        if(i%2===0){for(let p=0;p<3;p++)cylinder(g,x,.23+p*.32,z,.19,.19,1.5+p*.15,'#746e65',8,Math.PI/2);box(g,x,.05,z,1.8,.1,1.9,'#635e54');}
        else{box(g,x,.5,z,1.1,1,1.15,'#8d7e66');for(const y of [.25,.75])box(g,x,y,z,1.15,.08,1.2,'#4e5a60');}
      }else if(i%2===0){cylinder(g,x,.7,z,.13,.22,1.4,'#6e6557',7);const crown=ball(g,x,2,z,1.1,canal?'#638e82':'#748b71',0);crown.scale.set(1,1.35,.85);ball(g,x+.5,1.9,z+.1,.8,'#8f9e79',0);}
      else{const rock=ball(g,x,.12,z,.3+rand()*.35,'#9b9b8e',0);rock.scale.y=.55;}
    }
    const notice=streetSign(foundry?'작업 중':canal?'수문 구역':'철거 예정',foundry?'중장비 접근 주의':canal?'미끄럼 주의':'우회로를 이용하세요',2.3,foundry?'#db8654':'#d6bf76');
    notice.position.set(side*10.8,1.45,-4);notice.rotation.y=Math.PI-side*.12;details.add(notice);
    for(const dx of [-.75,.75])box(g,side*10.8+dx,.65,-4,.1,1.3,.1,'#46535a');
  }
  const root=batch(g);root.add(details);return root;
}
interface Effect {root:T.Object3D;event:EscapeEvent;life:number;max:number;kind:'beam'|'burst'|'ring'}
export class EscapeScene {
  readonly canvas:HTMLCanvasElement;
  private helper=new URLSearchParams(location.search).has('review')&&new URLSearchParams(location.search).has('review-helper');private quality:GraphicsQuality=(localStorage.getItem('houseflight.graphics') as GraphicsQuality)||'standard';private artRevision=0;private renderer:T.WebGLRenderer;private scene=new T.Scene();private camera:T.OrthographicCamera;
  private biome='';private light:T.DirectionalLight;private house=houseModel();private crew=new Map<string,WorkerRig>();private objects=new Map<string,T.Group>();private monsters=new Map<string,T.Group>();
  private hazards=new Map<string,T.Group>();private chunks=new Map<string,T.Group>();private effects:Effect[]=[];private gate=new T.Group();private exit=new T.Group();private storm=new T.Group();
  private aim:Vec={x:0,z:8};private hovered:{type:string;label:string;color:string}|null=null;private aimRing=ring(.7,'#fff0b2',.8);private trajectory=new T.Line(new T.BufferGeometry(),new T.LineDashedMaterial({color:'#f2e2b4',dashSize:.35,gapSize:.25,transparent:true,opacity:.6}));
  private state:EscapeState|null=null;private received=0;private input={x:0,z:0};private ownId='';private seen=0;private lastHouse=0;
  private last=performance.now();private raf=0;private disposed=false;private observer:ResizeObserver;private viewZ=0;private shake=0;private elapsed=0;
  private eventListener:(e:EscapeEvent)=>void=()=>{};private nextShadow=0;private frameCount=0;private totalFrameMs=0;
  private raycaster=new T.Raycaster();private plane=new T.Plane(new T.Vector3(0,1,0),-.4);private vector=new T.Vector3();
  private ash:T.InstancedMesh;private dummy=new T.Object3D();private width=1;private height=1;
  constructor(private container:HTMLElement,private showcase=false) {
    this.renderer=new T.WebGLRenderer({antialias:false,alpha:false,powerPreference:'high-performance'});
    this.canvas=this.renderer.domElement;this.canvas.setAttribute('aria-label','집째로 도망 3D 전장');this.canvas.tabIndex=0;container.append(this.canvas);
    this.renderer.setPixelRatio(this.quality==='economy'?.6:Math.min(devicePixelRatio,this.quality==='high'?1.5:1));this.renderer.shadowMap.enabled=this.quality==='high';this.renderer.shadowMap.type=T.PCFShadowMap;this.renderer.shadowMap.autoUpdate=false;
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.02;
    this.scene.background=new T.Color('#b4b9b1');this.scene.fog=new T.FogExp2('#b4b9b1',.008);
    this.camera=new T.OrthographicCamera(-25,25,17,-17,.1,150);
    this.scene.add(new T.HemisphereLight('#e9eff0','#596b7a',1.55));
    this.light=new T.DirectionalLight('#ffe0ad',2.2);this.light.castShadow=true;this.light.shadow.mapSize.set(512,512);
    Object.assign(this.light.shadow.camera,{left:-27,right:27,top:30,bottom:-24,near:1,far:90});this.light.shadow.bias=-.0007;this.light.shadow.normalBias=.045;
    this.scene.add(this.light,this.light.target);this.scene.add(this.house.root);this.scene.add(this.aimRing,this.trajectory);
    const fill=new T.DirectionalLight('#8ad6da',.7);fill.position.set(-15,8,-20);fill.name='sky-fill';this.scene.add(fill);
    this.ash=new T.InstancedMesh(geometry('ash',()=>new T.IcosahedronGeometry(.035,0)),mat('#ead9b4'),65);this.ash.instanceMatrix.setUsage(T.DynamicDrawUsage);this.scene.add(this.ash);
    box(this.gate,-4,1.3,0,.7,2.6,.8,'#695b47');box(this.gate,4,1.3,0,.7,2.6,.8,'#695b47');
    for(let i=0;i<6;i++)box(this.gate,-3.4+i*1.36,1.3,0,1.1,.5,.55,i%2?'#d7bd78':'#75644f',0,0,.15);
    box(this.gate,0,2.1,0,3,.6,.22,'#8c533c');batch(this.gate,true);this.scene.add(this.gate);
    const goal=new T.Group();
    for(const x of [-6.4,6.4]){
      box(goal,x,3.2,140,1.4,6.4,1.6,'#9b9c82');box(goal,x,6.55,140,1.8,.35,1.9,'#5b7d69');
      cylinder(goal,x,7.3,140,.45,.65,1.3,'#5c8672',8);ball(goal,x,7.9,140,.21,'#edcf8e');
      box(goal,x*.85,4.5,139,1.1,1.8,.1,'#d6b073');box(goal,x*.85,4.5,138.93,.15,1.2,.03,'#eadbb5');
      box(goal,x*.85,3.2,139,.5,.65,.5,'#edc689',0,0,0,.85);
    }
    box(goal,0,6.1,140,13,1,1.5,'#466e60');box(goal,0,6.15,139.18,4.6,.65,.1,'#d4c091');
    for(let i=0;i<5;i++)box(goal,-1.2+i*.6,6.15,139.08,.14,.32,.04,'#57745e',0,0,i%2?.4:-.4);
    this.exit=batch(goal);this.scene.add(this.exit);
    const curtain=new T.Mesh(new T.PlaneGeometry(70,15),new T.MeshBasicMaterial({color:'#355861',transparent:true,opacity:.38,side:T.DoubleSide,depthWrite:false}));curtain.position.y=6;this.storm.add(curtain);
    for(let i=0;i<16;i++){const m=new T.Mesh(geometry('storm',()=>new T.IcosahedronGeometry(1,1)),new T.MeshBasicMaterial({color:i%2?'#55747a':'#45636b',transparent:true,opacity:.25,depthWrite:false}));m.position.set(i*4-30,2+i%3,Math.sin(i)*2);m.scale.set(4,3+i%2,2.2);this.storm.add(m);}this.scene.add(this.storm);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);this.resize();this.render();
    void Promise.all([loadWorldArt(),document.fonts.load('24px "Do Hyeon"')]).then(()=>{if(!this.disposed)this.artRevision++;}).catch(error=>console.error('World art: '+String(error)));
  }
  setQuality(value:GraphicsQuality):void{this.quality=value;this.renderer.setPixelRatio(value==='economy'?.6:Math.min(devicePixelRatio,value==='high'?1.5:1));this.renderer.shadowMap.enabled=value==='high';this.resize();}
  setOwnId(id:string):void{this.ownId=id;}
  setInput(x:number,z:number):void{this.input={x,z};}
  setAim(p:Vec):void{this.aim=p;}
  onEvent(handler:(e:EscapeEvent)=>void):void{this.eventListener=handler;}
  update(s:EscapeState):void{
    this.state=s;this.received=performance.now();
    if(s.clock<.1&&this.seen>5)this.seen=0;
    for(const event of s.events)if(event.id>this.seen){if(s.clock-event.at<.65){this.fx(event);this.eventListener(event);}this.seen=Math.max(this.seen,event.id);}
  }
  project(x:number,z:number,y=1):{x:number;y:number;visible:boolean}{
    const v=new T.Vector3(x,y,z).project(this.camera);
    return{x:(v.x*.5+.5)*this.width,y:(-v.y*.5+.5)*this.height,visible:Math.abs(v.x)<1&&Math.abs(v.y)<1&&v.z<1};
  }
  projectCrew(id:string,height=2.35):{x:number;y:number;visible:boolean}|null{const rig=this.crew.get(id);return rig?this.project(rig.root.position.x,rig.root.position.z,rig.root.position.y+height):null;}
  aimHint():{type:string;label:string;color:string}|null{return this.hovered;}
  world(clientX:number,clientY:number):Vec {
    this.hovered=null;
    const rect=this.canvas.getBoundingClientRect(),point=new T.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(point,this.camera);
    const candidates=[...(this.gate.visible?[this.gate]:[]),...[...this.objects.values()].filter(g=>!g.userData.owner&&!g.userData.flight&&!g.userData.pad),...this.monsters.values(),...[...this.crew.entries()].filter(([id])=>id!==this.ownId&&this.state?.crew.some(p=>p.id===id&&p.downUntil>this.state!.clock)).map(([,rig])=>rig.root)];
    const hits=this.raycaster.intersectObjects(candidates,true);if(hits.length){let root:T.Object3D|null=hits[0].object;while(root){if(root.userData.pick){this.hovered=root.userData.hint??null;return{...root.userData.pick};}root=root.parent;}}
    this.raycaster.ray.intersectPlane(this.plane,this.vector);
    return{x:this.vector.x,z:this.vector.z};
  }
  metrics():{fps:number;drawCalls:number;triangles:number;quality:GraphicsQuality;art:{loaded:number;total:number};frames:number;frameMs:number}{return{fps:this.frameCount?Math.round(1000/(this.totalFrameMs/this.frameCount)):0,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,quality:this.quality,art:artStatus(),frames:this.frameCount,frameMs:this.totalFrameMs};}
  private resize():void{
    this.width=Math.max(1,this.container.clientWidth);this.height=Math.max(1,this.container.clientHeight);
    this.renderer.setSize(this.width,this.height,false);const aspect=this.width/this.height,half=aspect<1.2?20:14.8;
    this.camera.left=-half*aspect;this.camera.right=half*aspect;this.camera.top=half;this.camera.bottom=-half;this.camera.updateProjectionMatrix();
  }
  private fx(e:EscapeEvent):void {
    const atY=this.state&&onDeck(e,this.state.house)?1.8:.35;
    if(e.type==='hit'&&e.text==='crew'&&e.by){const rig=this.crew.get(e.by);if(rig)rig.root.userData.hitUntil=this.elapsed+.22;if(e.by===this.ownId)this.shake=Math.max(this.shake,.065);}
    if(e.type==='hook'){
      const points=[new T.Vector3(e.x,atY+1.1,e.z),new T.Vector3(e.toX??e.x,atY+.7,e.toZ??e.z)];
      const line=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:'#f4db9a',transparent:true,opacity:1,depthTest:false}));
      this.scene.add(line);this.effects.push({root:line,event:e,life:.16,max:.16,kind:'beam'});
    }
    const wood=e.text==='gate',dust=e.type==='dodge',friendly=e.type==='repair'||e.type==='rescue';
    const color=friendly?'#a3d3a0':e.type==='ping'?this.state?.crew.find(p=>p.id===e.by)?.color??'#e6bf72':e.prop==='battery'?'#8fcdd0':dust?'#b8b1a0':wood?'#b89b73':e.type==='hit'&&e.text==='crew'?'#da8a70':'#e5bb7c';
    if(['hit','explode','kill','repair','rescue','dodge','pad'].includes(e.type)){
      const count=e.type==='explode'?18:e.type==='hit'?6:dust?4:8,duration=e.type==='hit'?.26:dust?.24:.48,attacker=this.state?.crew.find(p=>p.id===e.by),away=attacker?Math.atan2(e.z-attacker.z,e.x-attacker.x):e.id*.73;
      const burst=new T.InstancedMesh(wood?geometry('splinter',()=>new T.BoxGeometry(1,.35,2.8)):geometry('burst',()=>new T.IcosahedronGeometry(1,0)),mat(color),count);burst.position.set(e.x,atY+(dust?-.25:.45),e.z);burst.instanceMatrix.setUsage(T.DynamicDrawUsage);
      burst.userData.particles=Array.from({length:count},(_,i)=>{const angle=e.type==='hit'?away+(i%3-1)*.65+i*.13:i*2.399+e.id*.73,speed=(dust?.65:1.3)+(i*1.31)%2;return{position:new T.Vector3(Math.cos(angle)*.08,Math.sin(i*3)*.06,Math.sin(angle)*.08),velocity:new T.Vector3(Math.cos(angle)*speed,dust?.25:.8+i%3*.35,Math.sin(angle)*speed),radius:e.type==='explode'?.13:dust?.07:.065};});
      this.scene.add(burst);this.effects.push({root:burst,event:e,life:duration,max:duration,kind:'burst'});
    }
    if(['explode','repair','rescue','pad','ping'].includes(e.type)){
      const duration=e.type==='ping'?.85:.35,r=ring(e.type==='explode'?1.3:e.type==='ping'?1:.65,color);r.position.set(e.x,atY,e.z);this.scene.add(r);this.effects.push({root:r,event:e,life:duration,max:duration,kind:'ring'});
    }
    if(e.type==='explode')this.shake=Math.max(this.shake,.2);if(e.type==='hit'&&e.text==='house')this.shake=.08;
  }
  private remove(root:T.Object3D):void {
    this.scene.remove(root);root.traverse(o=>{
      if(o instanceof T.Mesh||o instanceof T.Line){
        if(!o.geometry.userData.shared&&![...geos.values()].includes(o.geometry))o.geometry.dispose();
        const list=Array.isArray(o.material)?o.material:[o.material];for(const m of list)if(!m.userData.shared&&![...materials.values()].includes(m as T.MeshLambertMaterial))m.dispose();
      }
    });
  }
  private render=():void=>{
    if(this.disposed)return;
    if(performance.now()-this.last<1000/(this.helper?1:this.quality==='economy'?(this.state?20:8):this.state?(document.hasFocus()||new URLSearchParams(location.search).has('record')?60:12):15)){this.raf=requestAnimationFrame(this.render);return;}
    const now=performance.now(),rawMs=now-this.last,dt=Math.min(rawMs/1000,.25);this.last=now;this.elapsed+=dt;
    if(this.state){this.frameCount++;this.totalFrameMs+=rawMs;}
    const s=this.state,z=s?.house.z??0,clock=s?.clock??this.elapsed;
    this.viewZ+=(z-this.viewZ)*Math.min(1,dt*8);
    this.house.root.position.z=this.viewZ;this.house.root.rotation.z=Math.sin(clock*4)*.006*(s?.house.speed??.3);
    this.house.cabin.position.y=Math.sin(clock*6)*.018;
    for(const w of this.house.wheels)w.rotation.x=-z/0.87;
    this.house.engine.scale.setScalar(1+Math.sin(clock*18)*.015);
    const boost=!!s&&s.house.boostUntil>s.clock;
    this.house.engine.rotation.z=Math.sin(clock*12)*.018;
    this.storm.visible=!!s;this.storm.position.z=s?.stormZ??-40;for(let i=1;i<this.storm.children.length;i++)this.storm.children[i].position.y=3+Math.sin(clock*.7+i)*1.2;this.exit.visible=!!s&&s.stage===3;
    const biome=s?.biome??'quarry',index=Math.floor(z/30);
    if(this.biome!==biome){this.biome=biome;const palette=biome==='canal'?{sky:'#a6bcc4',sun:'#dce9e4',fill:'#98bed0'}:biome==='foundry'?{sky:'#bca18c',sun:'#ffd0a0',fill:'#ada4ac'}:{sky:'#b4b9b1',sun:'#ffe0ad',fill:'#8ad6da'};
      (this.scene.background as T.Color).set(palette.sky);(this.scene.fog as T.FogExp2).color.set(palette.sky);this.light.color.set(palette.sun);(this.scene.getObjectByName('sky-fill') as T.DirectionalLight).color.set(palette.fill);
    }
    const wanted=new Set<string>();
    for(let i=index-1;i<=index+2;i++){
      const key=i+biome+this.artRevision;wanted.add(key);if(!this.chunks.has(key)){const chunk=chunkModel(i,biome);chunk.position.z=i*30;this.scene.add(chunk);this.chunks.set(key,chunk);}
    }
    for(const[key,g]of this.chunks)if(!wanted.has(key)){this.remove(g);this.chunks.delete(key);}
    if(s){
      this.gate.visible=!s.gate.open&&s.stage<3;this.gate.position.z=s.gate.z;this.gate.userData.pick={x:0,z:s.gate.z};this.gate.userData.hint={type:'gate',label:'장애물 · 좌클릭 공격',color:'#edc36b'};
      const alive=new Set(s.crew.filter(p=>!p.left).map(p=>p.id));
      for(const p of s.crew.filter(p=>!p.left)){
        let rig=this.crew.get(p.id);if(!rig){rig=worker(p.color,crewIndex(p.color));this.crew.set(p.id,rig);rig.root.position.set(p.x,0,p.z);this.scene.add(rig.root);}
        const own=p.id===this.ownId,lag=own?Math.min((now-this.received)/1000,.16):0;
        const velocity=crewSpeed(s,p),predicted=constrainCrew({x:p.x+(own?this.input.x*velocity*lag:0),z:p.z+(own?this.input.z*velocity*lag:0)},s.house);
        const tx=predicted.x,tz=predicted.z;
        rig.root.position.x+=(tx-rig.root.position.x)*Math.min(1,dt*(own?22:13));
        rig.root.position.z+=(tz-rig.root.position.z)*Math.min(1,dt*(own?22:13));
        const deck=onDeck(p,s.house),ground=deck?1.61:0,down=p.downUntil>s.clock;
        const targetY=ground+(p.dodgeUntil>s.clock?Math.sin(clamp((p.dodgeUntil-s.clock)/.23,0,1)*Math.PI)*.35:0);rig.root.position.y+=(targetY-rig.root.position.y)*Math.min(1,dt*17);
        const angle=own?Math.atan2(this.aim.x-rig.root.position.x,this.aim.z-rig.root.position.z):Math.atan2(p.aimX,p.aimZ);rig.root.rotation.y=angle;
        if(Math.abs(p.walk-(rig.root.userData.walk??p.walk))>.001)rig.root.userData.movingUntil=now+160;
        const moving=!down&&(own?Math.hypot(this.input.x,this.input.z)>.05:now<(rig.root.userData.movingUntil??0));
        const weight=T.MathUtils.lerp(rig.root.userData.gaitWeight??0,moving?1:0,1-Math.exp(-dt*15));rig.root.userData.gaitWeight=weight;
        const movement=(rig.root.userData.gait??0)+dt*velocity*3.6*weight;rig.root.userData.gait=movement;
        rig.body.rotation.z=down?Math.PI/2:Math.sin(movement*.8)*.04*weight+((rig.root.userData.hitUntil??0)>this.elapsed?Math.sin(clock*48)*.14:0);
        rig.body.position.y=down?-.45:Math.abs(Math.sin(movement))*.035*weight;
        for(let i=0;i<2;i++){rig.legs[i].rotation.x=down?1.2:Math.sin(movement+i*Math.PI)*.65*weight;rig.arms[i].rotation.x=p.carry?-1.55:Math.sin(movement+i*Math.PI)*.4*weight;}
        if(s.clock-p.hookReady>-.48&&s.clock-p.hookReady<-.26)rig.arms[1].rotation.x=-1.6;
        rig.root.userData.walk=p.walk;rig.root.userData.pick={x:p.x,z:p.z};rig.root.userData.hint={type:'crew',label:'동료 구조 · 좌클릭',color:'#9cddaa'};
        rig.root.visible=p.invulnerableUntil<=s.clock||Math.floor(clock*12)%2===0||down;
      }
      for(const[id,rig]of this.crew)if(!alive.has(id)){this.remove(rig.root);this.crew.delete(id);}
      const props=new Set(s.props.map(p=>p.id+(p.pad?'pad':'')));
      for(const p of s.props){const key=p.id+(p.pad?'pad':'');let g=this.objects.get(key);if(!g){g=propModel(p.kind,p.pad);this.objects.set(key,g);this.scene.add(g);g.position.set(p.x,0,p.z);}
        const owner=s.crew.find(c=>c.id===p.owner),rig=owner?this.crew.get(owner.id):null;
        if(owner&&rig){
          if(g.userData.owner!==p.owner){g.userData.grabAt=now;g.userData.grabFrom=g.position.clone();}
          const t=clamp((now-g.userData.grabAt)/220,0,1),ease=t*t*(3-2*t),from=g.userData.grabFrom as T.Vector3;
          const tx=rig.root.position.x+Math.sin(rig.root.rotation.y)*.94,tz=rig.root.position.z+Math.cos(rig.root.rotation.y)*.94,ty=rig.root.position.y+.95;
          g.position.set(T.MathUtils.lerp(from.x,tx,ease),T.MathUtils.lerp(from.y,ty,ease)+Math.sin(t*Math.PI)*.45,T.MathUtils.lerp(from.z,tz,ease));
          g.rotation.y=rig.root.rotation.y;g.rotation.z=0;
        }else if(p.flight){
          if(!g.userData.inFlight){const thrower=this.crew.get(p.by??'');g.userData.launchHeight=g.userData.owner?g.position.y:(thrower?.root.position.y??0)+.95;}
          const t=1-p.flight/p.flightMax,launch=g.userData.launchHeight as number;
          g.position.x+=(p.x-g.position.x)*(1-Math.exp(-dt*40));g.position.z+=(p.z-g.position.z)*(1-Math.exp(-dt*40));
          g.position.y=launch*(1-t)+.12*t+Math.sin(t*Math.PI)*2.2;g.rotation.y+=dt*11;g.rotation.z=Math.sin(clock*15)*.25;
        }else{
          g.position.x+=(p.x-g.position.x)*(1-Math.exp(-dt*15));g.position.z+=(p.z-g.position.z)*(1-Math.exp(-dt*15));
          g.position.y+=( (onDeck(p,s.house)?1.61:.03)-g.position.y)*Math.min(1,dt*18);g.rotation.y=2.55+(Number(p.id.slice(1))%3-1)*.17;g.rotation.z=0;
        }
        g.userData.owner=p.owner;g.userData.inFlight=!!p.flight;g.userData.flight=p.flight;g.userData.pad=p.pad;g.userData.pick={x:p.x,z:p.z};g.userData.hint={type:'prop',label:PROP_INFO[p.kind].name+' · 좌클릭 회수',color:PROP_INFO[p.kind].color};

      }
      for(const[key,g]of this.objects)if(!props.has(key)){this.remove(g);this.objects.delete(key);}
      const enemies=new Set(s.enemies.map(e=>e.id));
      for(const e of s.enemies){let g=this.monsters.get(e.id);if(!g){g=monster(e);g.position.set(e.x,0,e.z);this.scene.add(g);this.monsters.set(e.id,g);}
        g.position.x+=(e.x-g.position.x)*Math.min(1,dt*12);g.position.z+=(e.z-g.position.z)*Math.min(1,dt*12);
        g.position.y=e.kind==='devourer'?Math.sin(clock*12)*.035:Math.abs(Math.sin(clock*7+e.born))*.1;
        if(e.kind!=='devourer')g.rotation.y=Math.atan2(-e.x,s.house.z-e.z)+Math.PI;else g.rotation.y=0;
        g.rotation.z=e.stunnedUntil>s.clock?Math.sin(clock*35)*.09:Math.sin(clock*6+e.born)*.015;
        g.scale.setScalar(e.kind==='devourer'&&e.exposedUntil>s.clock?1.02:1);g.userData.pick={x:e.x,z:e.z};g.userData.hint={type:'enemy',label:(e.kind==='devourer'?'고철 포식자':e.kind==='rammer'?'돌진 수거기':e.kind==='snatcher'?'흡착 줍개':'고철 수거기')+' · 좌클릭 공격',color:'#ed916b'};if(g.userData.armor)g.userData.armor.visible=e.armor>0;if(g.userData.core){g.userData.core.visible=e.exposedUntil>s.clock;g.userData.core.rotation.z=clock*4;}if(g.userData.jaw){const open=e.exposedUntil>s.clock?1:0;g.userData.jaw.position.y+=(-open*.48-g.userData.jaw.position.y)*Math.min(1,dt*12);}
      }
      for(const[key,g]of this.monsters)if(!enemies.has(key)){this.remove(g);this.monsters.delete(key);}
      const hazards=new Set(s.hazards.map(h=>h.id));
      for(const h of s.hazards){let g=this.hazards.get(h.id);if(!g){g=new T.Group();
        const r=ring(h.radius,'#ff7659',.9);(r.material as T.Material).depthTest=false;r.renderOrder=3;g.add(r);
        const disc=new T.Mesh(geometry('disc',()=>new T.CircleGeometry(1,48)),new T.MeshBasicMaterial({color:'#f67650',transparent:true,opacity:.13,depthWrite:false,depthTest:false,side:T.DoubleSide}));disc.rotation.x=-Math.PI/2;disc.scale.setScalar(h.radius);disc.renderOrder=2;g.add(disc);
        if(h.kind==='charge'){
          const dx=h.toX-h.x,dz=h.toZ-h.z,length=Math.hypot(dx,dz),path=new T.Group();path.rotation.y=Math.atan2(dx,dz);path.position.set(dx/2,.006,dz/2);
          const strip=new T.Mesh(new T.PlaneGeometry(h.radius*2,length),new T.MeshBasicMaterial({color:'#f67650',transparent:true,opacity:.18,depthWrite:false,depthTest:false,side:T.DoubleSide}));strip.rotation.x=-Math.PI/2;strip.renderOrder=2;path.add(strip);g.add(path);
          const end=ring(h.radius,'#ffb27c',.8);end.position.set(dx,.01,dz);(end.material as T.Material).depthTest=false;end.renderOrder=3;g.add(end);
          const line=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0,.02,0),new T.Vector3(dx,.02,dz)]),new T.LineDashedMaterial({color:'#ffe0a2',dashSize:.45,gapSize:.35,depthTest:false}));line.computeLineDistances();line.renderOrder=3;g.add(line);
        }
        const timer=new T.Mesh(geometry('disc',()=>new T.CircleGeometry(1,48)),new T.MeshBasicMaterial({color:'#ffab70',transparent:true,opacity:.22,depthWrite:false,depthTest:false,side:T.DoubleSide}));timer.rotation.x=-Math.PI/2;timer.position.y=.015;timer.renderOrder=3;g.add(timer);g.userData.timer=timer;g.userData.duration=Math.max(.01,h.at-clock);
        this.scene.add(g);this.hazards.set(h.id,g);
      }g.position.set(h.x,onDeck(h,s.house)?1.69:.1,h.z);const progress=clamp(1-(h.at-clock)/g.userData.duration,0,1);(g.userData.timer as T.Mesh).scale.setScalar(h.radius*(.12+progress*.85));}
      for(const[key,g]of this.hazards)if(!hazards.has(key)){this.remove(g);this.hazards.delete(key);}
    }else{
      this.gate.visible=false;
      if(this.showcase){
        const colors=['#f5bd62','#65d5cc','#ae9bfa','#f08d9c'];
        for(let i=0;i<4;i++){
          const id='menu-'+i;let rig=this.crew.get(id);if(!rig){rig=worker(colors[i],i);this.crew.set(id,rig);this.scene.add(rig.root);}
          rig.root.position.set(i%2?-3.2:3.15,1.61,i<2?-3.6:3.2);rig.root.rotation.y=i%2?-.45:2.5;
          rig.body.rotation.z=Math.sin(clock*1.7+i)*.025;rig.body.position.y=Math.sin(clock*2+i)*.025;
          rig.arms[1].rotation.x=i===0?-.9+Math.sin(clock*2)*.25:Math.sin(clock*2+i)*.05;
        }
      }
    }
    for(const fx of this.effects){
      fx.life-=Math.min(rawMs/1000,.35);const t=clamp(1-fx.life/fx.max,0,1);
      if(fx.kind==='burst'){
        const burst=fx.root as T.InstancedMesh;
        (burst.userData.particles as {position:T.Vector3;velocity:T.Vector3;radius:number}[]).forEach((p,i)=>{p.position.addScaledVector(p.velocity,dt);p.velocity.y-=8*dt;this.dummy.position.copy(p.position);this.dummy.scale.setScalar(p.radius*Math.max(.01,1-t));this.dummy.updateMatrix();burst.setMatrixAt(i,this.dummy.matrix);});burst.instanceMatrix.needsUpdate=true;
      }
      if(fx.kind==='ring'){fx.root.scale.setScalar(1+t*2);((fx.root as T.Mesh).material as T.MeshBasicMaterial).opacity=(1-t)*.8;}
      if(fx.kind==='beam')((fx.root as T.Line).material as T.LineBasicMaterial).opacity=1-t;
    }
    this.effects=this.effects.filter(fx=>{if(fx.life<=0){this.remove(fx.root);return false;}return true;});
    this.ash.visible=biome!=='canal';(this.ash.material as T.MeshLambertMaterial).color.set(biome==='foundry'?'#d5a782':'#b8b29e');
    for(let i=0;i<65;i++){
      const q=(clock*.3+i*.618)%1;this.dummy.position.set(Math.sin(i*34.1)*20+(q-.5)*3,1+(i*.37)%7,this.viewZ+((i*1.713+clock*.8)%50)-20);
      this.dummy.scale.setScalar(boost&&i%3===0?2:1);this.dummy.updateMatrix();this.ash.setMatrixAt(i,this.dummy.matrix);
    }this.ash.instanceMatrix.needsUpdate=true;
    this.shake=Math.max(0,this.shake-dt*.9);const jitter=Math.sin(clock*65)*this.shake;
    const own=s?.crew.find(p=>p.id===this.ownId),focusX=own?clamp(own.x*.12,-1.5,1.5):0;
    this.camera.position.set(19+focusX+jitter,25,this.viewZ-25+jitter);this.camera.lookAt(focusX,.4,this.viewZ+4);
    this.light.position.set(-14,30,this.viewZ-12);this.light.target.position.set(0,0,this.viewZ+3);
    this.aimRing.visible=!!own&&s?.phase==='travel';this.aimRing.position.set(this.aim.x,s&&this.hovered?.type!=='enemy'&&this.hovered?.type!=='gate'&&onDeck(this.aim,s.house)?1.69:.09,this.aim.z);(this.aimRing.material as T.MeshBasicMaterial).color.set(this.hovered?.color??'#fff0b2');
    this.trajectory.visible=!!own?.carry&&s?.phase==='travel';if(this.trajectory.visible&&own){
      const points:T.Vector3[]=[],rig=this.crew.get(own.id),dx=this.aim.x-own.x,dz=this.aim.z-own.z,d=Math.hypot(dx,dz),length=clamp(d,3,18),ux=d>.01?dx/d:own.aimX,uz=d>.01?dz/d:own.aimZ,launch=(rig?.root.position.y??0)+1.45;
      for(let i=0;i<=20;i++){const t=i/20;points.push(new T.Vector3(own.x+ux*length*t,launch*(1-t)+.62*t+Math.sin(t*Math.PI)*2.2,own.z+uz*length*t));}
      this.trajectory.geometry.dispose();this.trajectory.geometry=new T.BufferGeometry().setFromPoints(points);this.trajectory.computeLineDistances();
    }
    if(now>this.nextShadow){this.renderer.shadowMap.needsUpdate=true;this.nextShadow=now+100;}
    this.renderer.render(this.scene,this.camera);this.lastHouse=z;this.raf=requestAnimationFrame(this.render);
  };
  destroy():void {
    this.disposed=true;cancelAnimationFrame(this.raf);this.observer.disconnect();
    this.scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line){if(![...geos.values()].includes(o.geometry))o.geometry.dispose();}});
    this.renderer.dispose();this.renderer.forceContextLoss();this.canvas.remove();
  }
}
