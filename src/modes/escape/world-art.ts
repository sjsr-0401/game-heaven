import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const models=new Map<string,T.BufferGeometry>();
const material=new T.MeshLambertMaterial({vertexColors:true,flatShading:true});
material.userData.shared=true;
const names={
 industrial:['building-a','building-d','building-h','building-i','building-m','shipping-container-a','water-tower','detail-tank','chimney-small'],
 commercial:['building-a','building-c','building-f','building-h','detail-awning']
};
let loading:Promise<void>|null=null;
let loaded=0;
export function artStatus():{loaded:number;total:number}{return{loaded,total:14};}
export function loadWorldArt():Promise<void>{
 if(loading)return loading;
 const loader=new GLTFLoader();
 loading=Promise.all(Object.entries(names).flatMap(([pack,files])=>files.map(async name=>{
  const gltf=await loader.loadAsync('/art/kenney-'+pack+'/'+name+'.glb');gltf.scene.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(gltf.scene),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3()),scale=1/Math.max(size.x,size.z);
  const pieces:T.BufferGeometry[]=[],sourceGeometries=new Set<T.BufferGeometry>(),sourceMaterials=new Set<T.Material>();
  gltf.scene.traverse(object=>{
   if(!(object instanceof T.Mesh))return;
   const source=object.material as T.MeshStandardMaterial,original=object.geometry.clone(),geo=original.index?original.toNonIndexed():original;
   if(geo!==original)original.dispose();geo.applyMatrix4(object.matrixWorld);
   const pos=geo.getAttribute('position'),uv=geo.getAttribute('uv'),colors=new Float32Array(pos.count*3),color=new T.Color();
   const texture=source.map;
   let pixels:ImageData|null=null;
   if(texture&&texture.image){const image=texture.image as HTMLImageElement;const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0);pixels=ctx.getImageData(0,0,canvas.width,canvas.height);texture.updateMatrix();}
   for(let i=0;i<pos.count;i++){
    pos.setXYZ(i,(pos.getX(i)-center.x)*scale,(pos.getY(i)-bounds.min.y)*scale,(pos.getZ(i)-center.z)*scale);
    color.copy(source.color);
    if(pixels&&texture&&uv){const point=texture.transformUv(new T.Vector2(uv.getX(i),uv.getY(i))),x=T.MathUtils.clamp(Math.floor(point.x*pixels.width),0,pixels.width-1),y=T.MathUtils.clamp(Math.floor(point.y*pixels.height),0,pixels.height-1),at=(y*pixels.width+x)*4;
     color.multiply(new T.Color().setRGB(pixels.data[at]/255,pixels.data[at+1]/255,pixels.data[at+2]/255,T.SRGBColorSpace));
    }
    colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b;
   }
   for(const key of Object.keys(geo.attributes))if(!['position','normal'].includes(key))geo.deleteAttribute(key);
   geo.setAttribute('color',new T.BufferAttribute(colors,3));pieces.push(geo);sourceGeometries.add(object.geometry);sourceMaterials.add(source);
  });
  const merged=mergeGeometries(pieces,false);if(!merged)throw Error('Could not prepare '+pack+'/'+name);
  pieces.forEach(g=>g.dispose());sourceGeometries.forEach(g=>g.dispose());sourceMaterials.forEach(m=>{(m as T.MeshStandardMaterial).map?.dispose();m.dispose();});
  merged.computeBoundingSphere();merged.userData.shared=true;models.set(pack+'/'+name,merged);loaded++;
 }))).then(()=>{});
 return loading;
}
export function scenery(name:string,x:number,z:number,size:number,rotation=0,tint='#ffffff'):T.Mesh|null{
 const geo=models.get(name);if(!geo)return null;
 const paint=material.clone();paint.color.set(tint);const mesh=new T.Mesh(geo,paint);mesh.position.set(x,.02,z);mesh.scale.setScalar(size);mesh.rotation.y=rotation;mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
}
const signs=new Map<string,T.MeshBasicMaterial>(),signPlane=new T.PlaneGeometry(1,1);
signPlane.userData.shared=true;
export function streetSign(text:string,subtitle:string,width:number,color='#e5b84e'):T.Mesh{
 const key=text+subtitle+color;let paint=signs.get(key);
 if(!paint){
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=200;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#273545';ctx.fillRect(0,0,640,200);ctx.fillStyle=color;ctx.fillRect(7,7,626,186);
  ctx.fillStyle='#263442';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='84px "Do Hyeon", sans-serif';ctx.fillText(text,320,79,580);
  ctx.font='24px "Do Hyeon", sans-serif';ctx.fillText(subtitle,320,155,560);
  for(const x of [20,620])for(const y of [20,180]){ctx.fillStyle='#e5deca';ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#5e635d';ctx.fillRect(x-3,y-1,6,2);}
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;paint=new T.MeshBasicMaterial({map:texture,side:T.DoubleSide});paint.userData.shared=true;signs.set(key,paint);
 }
 const mesh=new T.Mesh(signPlane,paint);mesh.scale.set(width,width*200/640,1);return mesh;
}
