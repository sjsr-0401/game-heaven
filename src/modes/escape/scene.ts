import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {onDeck,clamp,PROP_INFO,type EscapeState,type PropKind,type CrewActor,type Enemy,type EscapeEvent,type Vec} from '../../../shared/escape.js';

const materials=new Map<string,T.MeshStandardMaterial>();
function mat(color:string,emission=0):T.MeshStandardMaterial {
  const key=color+':'+emission;
  if(!materials.has(key))materials.set(key,new T.MeshStandardMaterial({color,roughness:.85,metalness:.08,flatShading:true,emissive:emission?color:'#000000',emissiveIntensity:emission}));
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
const solidMaterial=new T.MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:.85,metalness:.08,flatShading:true});
materials.set('vertex-colors',solidMaterial);
function batch(group:T.Group,direct=false):T.Group {
  group.updateMatrixWorld(true);const buckets=new Map<T.Material,T.BufferGeometry[]>(),meshes:T.Mesh[]=[];
  const collect=(o:T.Object3D)=>{if(o instanceof T.Mesh&&o.material instanceof T.MeshStandardMaterial)meshes.push(o);};
  if(direct)group.children.forEach(collect);else group.traverse(collect);
  for(const mesh of meshes){
    const material=mesh.material as T.MeshStandardMaterial,target=material.emissiveIntensity>0?material:solidMaterial;
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
  const root=new T.Group(),body=new T.Group();root.add(body);
  const skin=['#d8a57d','#bf825f','#edc7a1','#b67c5c'][index%4],dark='#303c43';
  cylinder(body,0,.96,0,.31,.4,.73,color,8);box(body,0,1.05,.285,.4,.4,.1,'#e7dbc1');box(body,0,.68,0,.76,.12,.52,dark);
  const head=new T.Group();head.position.set(0,1.52,0);body.add(head);
  ball(head,0,.03,0,.32,skin,2);box(head,0,-.07,.26,.32,.17,.12,skin);
  for(const side of [-1,1]){box(head,side*.12,.065,.296,.095,.1,.045,'#fff1d4');box(head,side*.12,.06,.326,.045,.065,.02,dark);}
  box(head,0,-.09,.323,.13,.025,.02,'#724b3e');
  cylinder(head,0,.26,0,.27,.34,.2,color,12);box(head,0,.17,.21,.72,.06,.34,color);box(head,0,.3,.27,.24,.16,.1,dark);
  const lamp=box(head,0,.3,.34,.13,.09,.035,'#ffe6ac',0,0,0,1.4);
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
    const c=e.kind==='rammer'?'#bb7758':e.kind==='snatcher'?'#8785b8':'#8d9c78';
    cylinder(g,0,.7,0,.42,.65,1.1,c,7);ball(g,0,1.4,0,.46,'#343e40');
    box(g,0,1.38,-.39,.65,.18,.13,'#f2b56c',0,0,0,1);
    for(const x of [-.42,.42]){cylinder(g,x,.25,0,.18,.18,.5,'#343e40',7);box(g,x,.06,-.12,.4,.18,.5,'#343e40');}
    if(e.kind==='rammer'){for(const x of [-.5,.5])box(g,x,1.4,-.65,.18,.35,.6,'#d5c0a0',-.3);}
    if(e.kind==='snatcher'){for(const x of [-.65,.65])box(g,x,.8,-.25,.18,.15,.95,'#b1a6b7',0,x*.6);box(g,0,1.88,0,.15,.4,.12,'#cbbb8f');}
    if(e.kind==='scrapper'){for(const x of [-.55,.55])box(g,x,.7,-.13,.18,.6,.18,'#c3b59b',.5);}
  }
  const result=batch(g);
  if(e.kind==='rammer'){const armor=box(result,0,1,-.4,1.2,1.1,.3,'#74665a');result.userData.armor=armor;}
  if(e.kind==='devourer'){const material=new T.MeshStandardMaterial({color:'#87efd5',emissive:'#77ffe0',emissiveIntensity:1.1,roughness:.4});const core=new T.Mesh(new T.CylinderGeometry(.78,.78,.18,10),material);core.rotation.x=Math.PI/2;core.position.set(0,1.6,-2.25);result.add(core);result.userData.core=core;}
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
    box(g,side*1.18,4.16,0,3.02,.2,5.8,'#3f7771',0,0,-side*.61);
    for(let z=-2.7;z<2.9;z+=.4)box(g,side*1.18,4.29,z,3.03,.055,.065,'#5e9386',0,0,-side*.61);
    box(g,side*2.38,3.42,0,.16,.2,6,'#314f4c');
  }
  box(g,0,4.98,0,.2,.16,5.9,'#b0b79c');
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
  for(const x of [-3.3,3.3])for(const z of [-3.1,0,3.1]){
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
  const g=new T.Group(),rand=seeded(index*9137+133),foundry=biome==='foundry',canal=biome==='canal';
  const ground=foundry?'#6c7267':canal?'#657d72':'#7e8a77';
  box(g,0,-.75,0,45,1.2,30,ground);box(g,0,-.08,0,11,.18,30,foundry?'#655c50':'#5b6e68');
  for(const x of [-6.05,6.05]){box(g,x,.01,0,.65,.2,30,'#a8a58b');box(g,x*1.12,-.02,0,.32,.05,30,'#3f5f59');}
  for(let z=-13;z<=13;z+=4)box(g,0,.025,z,.12,.025,1.5,'#b9b494');
  for(let i=0;i<24;i++){
    const x=(rand()-.5)*10,z=(rand()-.5)*29;
    box(g,x,.035,z,.12+rand()*.7,.025,.06+rand()*.12,'#78877b',0,rand()*3);
  }
  for(const side of [-1,1]){
    if(canal){box(g,side*10,-.3,0,4,.15,30,'#386b70');for(let i=0;i<12;i++)box(g,side*(8.4+rand()*3),-.2,rand()*29-14,.12,.025,.8+rand()*2,'#76a49b',0,.15);}
    for(let i=0;i<4;i++){
      const x=side*(canal?15:10.5+rand()*5),z=-12+i*8+rand()*2,w=3+rand()*2,h=2+rand()*6,d=4+rand()*2;
      const color=foundry?['#7e695c','#8b7562','#626b64'][i%3]:['#9a9c85','#a4a48c','#788c7f','#b0a187'][i%4];
      box(g,x,h/2-.1,z,w,h,d,color);box(g,x,h+.1,z,w+.3,.25,d+.3,'#52675d');
      if(rand()<.6)box(g,x+side*w*.1,h+.45,z,1.3,.6,1.7,'#6b7d71');
      for(let floor=1;floor<h-.5;floor+=1.5)for(let win=-1;win<=1;win++){
        box(g,x-side*(w/2+.025),floor,z+win*1.1,.04,.7,.55,rand()<.35?'#dfc38c':'#4e6b66',0,0,0,.08);
      }
      box(g,x-side*(w/2+.15),.8,z,.35,1.7,.9,'#414f48');
      if(i%2===0){const poleX=side*6.9;cylinder(g,poleX,1.8,z,.06,.09,3.6,'#586b5b',8);box(g,poleX-side*.25,3.6,z,.6,.13,.2,'#586b5b');ball(g,poleX-side*.45,3.4,z,.17,'#f3d596');}
    }
    for(let i=0;i<9;i++){const x=side*(7.5+rand()*10),z=rand()*29-14;if(canal&&Math.abs(x)<12)continue;
      if(i%3===0){cylinder(g,x,.6,z,.18,.24,1.2,'#665f46',7);const m=ball(g,x,1.8,z,1.3,foundry?'#71806b':'#78946d',0);m.scale.y=1.25;}
      else{const m=ball(g,x,.1,z,.3+rand()*.5,'#a4a28b',0);m.scale.y=.5;box(g,x+.4,.04,z,.4,.05,.2,'#526f5b',0,rand()*5);}
    }
  }
  return batch(g);
}
interface Effect {root:T.Object3D;event:EscapeEvent;life:number;max:number;kind:'beam'|'burst'|'ring'}
export class EscapeScene {
  readonly canvas:HTMLCanvasElement;
  private helper=new URLSearchParams(location.search).has('review')&&new URLSearchParams(location.search).has('review-helper');private economy=new URLSearchParams(location.search).get('graphics')==='economy'||localStorage.getItem('houseflight.graphics')==='economy';private renderer:T.WebGLRenderer;private scene=new T.Scene();private camera:T.OrthographicCamera;
  private light:T.DirectionalLight;private house=houseModel();private crew=new Map<string,WorkerRig>();private objects=new Map<string,T.Group>();private monsters=new Map<string,T.Group>();
  private hazards=new Map<string,T.Group>();private chunks=new Map<string,T.Group>();private effects:Effect[]=[];private gate=new T.Group();private exit=new T.Group();private storm=new T.Group();
  private aim:Vec={x:0,z:8};private aimRing=ring(.7,'#fff0b2',.8);private trajectory=new T.Line(new T.BufferGeometry(),new T.LineDashedMaterial({color:'#f2e2b4',dashSize:.35,gapSize:.25,transparent:true,opacity:.6}));
  private state:EscapeState|null=null;private received=0;private input={x:0,z:0};private ownId='';private seen=0;private lastHouse=0;
  private last=performance.now();private raf=0;private disposed=false;private observer:ResizeObserver;private viewZ=0;private shake=0;private elapsed=0;
  private eventListener:(e:EscapeEvent)=>void=()=>{};private nextShadow=0;private frameCount=0;private totalFrameMs=0;
  private raycaster=new T.Raycaster();private plane=new T.Plane(new T.Vector3(0,1,0),-.4);private vector=new T.Vector3();
  private ash:T.InstancedMesh;private dummy=new T.Object3D();private width=1;private height=1;
  constructor(private container:HTMLElement) {
    this.renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.canvas=this.renderer.domElement;this.canvas.setAttribute('aria-label','집째로 도망 3D 전장');this.canvas.tabIndex=0;container.append(this.canvas);
    this.renderer.setPixelRatio(this.economy?.6:Math.min(devicePixelRatio,1.5));this.renderer.shadowMap.enabled=!this.economy;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.06;
    this.scene.background=new T.Color('#879e91');this.scene.fog=new T.FogExp2('#879e91',.011);
    this.camera=new T.OrthographicCamera(-25,25,17,-17,.1,150);
    this.scene.add(new T.HemisphereLight('#ffedd0','#456b6c',1.6));
    this.light=new T.DirectionalLight('#ffdb9e',2.7);this.light.castShadow=true;this.light.shadow.mapSize.set(768,768);
    Object.assign(this.light.shadow.camera,{left:-27,right:27,top:30,bottom:-24,near:1,far:90});this.light.shadow.bias=-.0007;this.light.shadow.normalBias=.045;
    this.scene.add(this.light,this.light.target);this.scene.add(this.house.root);this.scene.add(this.aimRing,this.trajectory);
    const fill=new T.DirectionalLight('#8ad6da',.7);fill.position.set(-15,8,-20);this.scene.add(fill);
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
  }
  setEconomy(value:boolean):void{this.economy=value;this.renderer.setPixelRatio(value?.6:Math.min(devicePixelRatio,1.5));this.renderer.shadowMap.enabled=!value;this.resize();}
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
  world(clientX:number,clientY:number):Vec {
    const rect=this.canvas.getBoundingClientRect(),point=new T.Vector2((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(point,this.camera);
    const candidates=[...this.objects.values(),...this.monsters.values(),...[...this.crew.entries()].filter(([id])=>id!==this.ownId).map(([,rig])=>rig.root)];
    const hits=this.raycaster.intersectObjects(candidates,true);if(hits.length){let root:T.Object3D|null=hits[0].object;while(root){if(root.userData.pick)return{...root.userData.pick};root=root.parent;}}
    this.raycaster.ray.intersectPlane(this.plane,this.vector);
    return{x:this.vector.x,z:this.vector.z};
  }
  metrics():{fps:number;drawCalls:number;triangles:number}{return{fps:this.frameCount?Math.round(1000/(this.totalFrameMs/this.frameCount)):0,drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles};}
  private resize():void{
    this.width=Math.max(1,this.container.clientWidth);this.height=Math.max(1,this.container.clientHeight);
    this.renderer.setSize(this.width,this.height,false);const aspect=this.width/this.height,half=aspect<1.2?23:17;
    this.camera.left=-half*aspect;this.camera.right=half*aspect;this.camera.top=half;this.camera.bottom=-half;this.camera.updateProjectionMatrix();
  }
  private fx(e:EscapeEvent):void {
    const atY=this.state&&onDeck(e,this.state.house)?1.8:.35;
    if(e.type==='hook'){
      const points=[new T.Vector3(e.x,atY+1.1,e.z),new T.Vector3(e.toX??e.x,atY+.7,e.toZ??e.z)];
      const line=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:'#fff0b5',transparent:true,opacity:1,depthTest:false}));
      this.scene.add(line);this.effects.push({root:line,event:e,life:.2,max:.2,kind:'beam'});
    }
    if(['hit','explode','kill','repair','rescue','install','upgrade','dodge','pad','ping'].includes(e.type)){
      const count=e.type==='explode'?20:e.type==='hit'?7:12;
      const color=e.type==='repair'||e.type==='rescue'?'#a3ebae':e.prop==='battery'?'#7bfff0':e.type==='hit'&&e.text==='crew'?'#ec8b70':'#ffcf85';
      const burst=new T.InstancedMesh(geometry('burst',()=>new T.IcosahedronGeometry(1,0)),mat(color),count);burst.position.set(e.x,atY+.5,e.z);burst.instanceMatrix.setUsage(T.DynamicDrawUsage);
      burst.userData.particles=Array.from({length:count},(_,i)=>{const a=i/count*Math.PI*2;return{position:new T.Vector3(Math.cos(a)*.12,Math.sin(i*3)*.1,Math.sin(a)*.12),velocity:new T.Vector3(Math.cos(a)*(2+i%3),1.5+i%4*.6,Math.sin(a)*(2+i%3)),radius:e.type==='explode'?.14:.08};});
      this.scene.add(burst);this.effects.push({root:burst,event:e,life:.5,max:.5,kind:'burst'});
      const r=ring(e.type==='explode'?1.3:.65,color);r.position.set(e.x,atY,e.z);this.scene.add(r);this.effects.push({root:r,event:e,life:.38,max:.38,kind:'ring'});
      if(e.type==='explode')this.shake=Math.max(this.shake,.2);if(e.type==='hit'&&e.text==='house')this.shake=.08;
    }
  }
  private remove(root:T.Object3D):void {
    this.scene.remove(root);root.traverse(o=>{
      if(o instanceof T.Mesh||o instanceof T.Line){
        if(![...geos.values()].includes(o.geometry))o.geometry.dispose();
        const list=Array.isArray(o.material)?o.material:[o.material];for(const m of list)if(![...materials.values()].includes(m as T.MeshStandardMaterial))m.dispose();
      }
    });
  }
  private render=():void=>{
    if(this.disposed)return;
    if(performance.now()-this.last<1000/(this.helper?4:this.economy?(this.state?20:8):this.state?(document.hasFocus()||new URLSearchParams(location.search).has('record')?60:12):15)){this.raf=requestAnimationFrame(this.render);return;}
    const now=performance.now(),rawMs=now-this.last,dt=Math.min(rawMs/1000,.06);this.last=now;this.elapsed+=dt;
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
    const wanted=new Set<string>();
    for(let i=index-1;i<=index+2;i++){
      const key=i+biome;wanted.add(key);if(!this.chunks.has(key)){const chunk=chunkModel(i,biome);chunk.position.z=i*30;this.scene.add(chunk);this.chunks.set(key,chunk);}
    }
    for(const[key,g]of this.chunks)if(!wanted.has(key)){this.remove(g);this.chunks.delete(key);}
    if(s){
      this.gate.visible=!s.gate.open&&s.stage<3;this.gate.position.z=s.gate.z;
      const alive=new Set(s.crew.filter(p=>!p.left).map(p=>p.id));
      for(const p of s.crew.filter(p=>!p.left)){
        let rig=this.crew.get(p.id);if(!rig){rig=worker(p.color,s.crew.indexOf(p));this.crew.set(p.id,rig);rig.root.position.set(p.x,0,p.z);this.scene.add(rig.root);}
        const own=p.id===this.ownId,lag=own?Math.min((now-this.received)/1000,.16):0;
        const velocity=p.dodgeUntil>s.clock?12:p.carry?3.6:4.5;
        const tx=p.x+(own?this.input.x*velocity*lag:0),tz=p.z+(own?this.input.z*velocity*lag:0);
        rig.root.position.x+=(tx-rig.root.position.x)*Math.min(1,dt*(own?22:13));
        rig.root.position.z+=(tz-rig.root.position.z)*Math.min(1,dt*(own?22:13));
        const deck=onDeck(p,s.house),ground=deck?1.61:0,down=p.downUntil>s.clock;
        rig.root.position.y=ground+(p.dodgeUntil>s.clock?Math.sin(clamp((p.dodgeUntil-s.clock)/.23,0,1)*Math.PI)*.35:0);
        const angle=Math.atan2(p.aimX,p.aimZ);rig.root.rotation.y=angle;rig.body.rotation.z=down?Math.PI/2:Math.sin(p.walk*3)*.04;
        rig.body.position.y=down?-.45:Math.abs(Math.sin(p.walk*3))*.035;
        const movement=own&&Math.hypot(this.input.x,this.input.z)>.05?clock*15:p.walk*3.6;
        const moving=own?Math.hypot(this.input.x,this.input.z)>.05:Math.abs(p.walk-(rig.root.userData.walk??p.walk))>.001;
        for(let i=0;i<2;i++){rig.legs[i].rotation.x=down?1.2:moving?Math.sin(movement+i*Math.PI)*.65:0;rig.arms[i].rotation.x=p.carry?-1.1:moving?Math.sin(movement+i*Math.PI)*.4:0;}
        if(s.clock-p.hookReady>-.48&&s.clock-p.hookReady<-.26)rig.arms[1].rotation.x=-1.6;
        rig.root.userData.walk=p.walk;rig.root.userData.pick={x:p.x,z:p.z};
        rig.root.visible=p.invulnerableUntil<=s.clock||Math.floor(clock*12)%2===0||down;
      }
      for(const[id,rig]of this.crew)if(!alive.has(id)){this.remove(rig.root);this.crew.delete(id);}
      const props=new Set(s.props.map(p=>p.id+(p.pad?'pad':'')));
      for(const p of s.props){const key=p.id+(p.pad?'pad':'');let g=this.objects.get(key);if(!g){g=propModel(p.kind,p.pad);this.objects.set(key,g);this.scene.add(g);g.position.set(p.x,0,p.z);}
        const owner=s.crew.find(c=>c.id===p.owner),rig=owner?this.crew.get(owner.id):null;
        const targetX=rig?rig.root.position.x+owner!.aimX*.9:p.x,targetZ=rig?rig.root.position.z+owner!.aimZ*.9:p.z;
        g.position.x+=(targetX-g.position.x)*Math.min(1,dt*(p.flight?35:18));g.position.z+=(targetZ-g.position.z)*Math.min(1,dt*(p.flight?35:18));
        g.position.y=p.owner?(onDeck(owner!,s.house)?2.9:1.3):p.flight?.7+Math.sin((1-p.flight/p.flightMax)*Math.PI)*2.2:onDeck(p,s.house)?1.61:.03;
        g.rotation.y+=p.flight?dt*11:p.owner?dt*.15:dt*.06;
        g.rotation.z=p.flight?Math.sin(clock*15)*.25:0;g.userData.pick={x:p.x,z:p.z};
      }
      for(const[key,g]of this.objects)if(!props.has(key)){this.remove(g);this.objects.delete(key);}
      const enemies=new Set(s.enemies.map(e=>e.id));
      for(const e of s.enemies){let g=this.monsters.get(e.id);if(!g){g=monster(e);g.position.set(e.x,0,e.z);this.scene.add(g);this.monsters.set(e.id,g);}
        g.position.x+=(e.x-g.position.x)*Math.min(1,dt*12);g.position.z+=(e.z-g.position.z)*Math.min(1,dt*12);
        g.position.y=e.kind==='devourer'?Math.sin(clock*12)*.035:Math.abs(Math.sin(clock*7+e.born))*.1;
        if(e.kind!=='devourer')g.rotation.y=Math.atan2(-e.x,s.house.z-e.z)+Math.PI;else g.rotation.y=0;
        g.rotation.z=e.stunnedUntil>s.clock?Math.sin(clock*35)*.09:Math.sin(clock*6+e.born)*.015;
        g.scale.setScalar(e.kind==='devourer'&&e.exposedUntil>s.clock?1.02:1);g.userData.pick={x:e.x,z:e.z};if(g.userData.armor)g.userData.armor.visible=e.armor>0;if(g.userData.core){g.userData.core.visible=e.exposedUntil>s.clock;g.userData.core.rotation.z=clock*4;}
      }
      for(const[key,g]of this.monsters)if(!enemies.has(key)){this.remove(g);this.monsters.delete(key);}
      const hazards=new Set(s.hazards.map(h=>h.id));
      for(const h of s.hazards){let g=this.hazards.get(h.id);if(!g){g=new T.Group();
        const r=ring(h.radius,'#ff7659',.9);g.add(r);
        const disc=new T.Mesh(geometry('disc',()=>new T.CircleGeometry(1,48)),new T.MeshBasicMaterial({color:'#f67650',transparent:true,opacity:.17,depthWrite:false,side:T.DoubleSide}));disc.rotation.x=-Math.PI/2;disc.scale.setScalar(h.radius);g.add(disc);
        if(h.kind==='charge'){const line=new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0,0,0),new T.Vector3(h.toX-h.x,0,h.toZ-h.z)]),new T.LineBasicMaterial({color:'#ffb27c'}));g.add(line);}
        this.scene.add(g);this.hazards.set(h.id,g);
      }g.position.set(h.x,.1,h.z);g.scale.setScalar(1+Math.sin(clock*18)*.025);}
      for(const[key,g]of this.hazards)if(!hazards.has(key)){this.remove(g);this.hazards.delete(key);}
    }else this.gate.visible=false;
    for(const fx of this.effects){
      fx.life-=dt;const t=1-fx.life/fx.max;
      if(fx.kind==='burst'){
        const burst=fx.root as T.InstancedMesh;
        (burst.userData.particles as {position:T.Vector3;velocity:T.Vector3;radius:number}[]).forEach((p,i)=>{p.position.addScaledVector(p.velocity,dt);p.velocity.y-=8*dt;this.dummy.position.copy(p.position);this.dummy.scale.setScalar(p.radius*Math.max(.01,1-t));this.dummy.updateMatrix();burst.setMatrixAt(i,this.dummy.matrix);});burst.instanceMatrix.needsUpdate=true;
      }
      if(fx.kind==='ring'){fx.root.scale.setScalar(1+t*2);((fx.root as T.Mesh).material as T.MeshBasicMaterial).opacity=(1-t)*.8;}
      if(fx.kind==='beam')((fx.root as T.Line).material as T.LineBasicMaterial).opacity=1-t;
    }
    this.effects=this.effects.filter(fx=>{if(fx.life<=0){this.remove(fx.root);return false;}return true;});
    for(let i=0;i<65;i++){
      const q=(clock*.3+i*.618)%1;this.dummy.position.set(Math.sin(i*34.1)*20+(q-.5)*3,1+(i*.37)%7,this.viewZ+((i*1.713+clock*.8)%50)-20);
      this.dummy.scale.setScalar(boost&&i%3===0?2:1);this.dummy.updateMatrix();this.ash.setMatrixAt(i,this.dummy.matrix);
    }this.ash.instanceMatrix.needsUpdate=true;
    this.shake=Math.max(0,this.shake-dt*.9);const jitter=Math.sin(clock*65)*this.shake;
    const own=s?.crew.find(p=>p.id===this.ownId),focusX=own?clamp(own.x*.12,-1.5,1.5):0;
    this.camera.position.set(19+focusX+jitter,25,this.viewZ-25+jitter);this.camera.lookAt(focusX,.4,this.viewZ+4);
    this.light.position.set(-14,30,this.viewZ-12);this.light.target.position.set(0,0,this.viewZ+3);
    this.aimRing.visible=!!own&&s?.phase==='travel';this.aimRing.position.set(this.aim.x,.09,this.aim.z);
    this.trajectory.visible=!!own?.carry&&s?.phase==='travel';if(this.trajectory.visible&&own){const points=[];const d=Math.hypot(this.aim.x-own.x,this.aim.z-own.z),ratio=Math.min(1,18/Math.max(.1,d));for(let i=0;i<=20;i++){const t=i/20;points.push(new T.Vector3(own.x+(this.aim.x-own.x)*ratio*t,1.1+Math.sin(t*Math.PI)*2,own.z+(this.aim.z-own.z)*ratio*t));}this.trajectory.geometry.dispose();this.trajectory.geometry=new T.BufferGeometry().setFromPoints(points);this.trajectory.computeLineDistances();}
    if(now>this.nextShadow){this.renderer.shadowMap.needsUpdate=true;this.nextShadow=now+100;}
    this.renderer.render(this.scene,this.camera);this.lastHouse=z;this.raf=requestAnimationFrame(this.render);
  };
  destroy():void {
    this.disposed=true;cancelAnimationFrame(this.raf);this.observer.disconnect();
    this.scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line){if(![...geos.values()].includes(o.geometry))o.geometry.dispose();}});
    this.renderer.dispose();this.renderer.forceContextLoss();this.canvas.remove();
  }
}
