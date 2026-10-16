import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const packs=[
 {folder:'industrial',url:'https://kenney.nl/media/pages/assets/city-kit-industrial/0ec35b139d-1788171848/kenney_city-kit-industrial_2.0.zip',sha256:'5b381164e5760f3830a2dbee43b972deee38b2a695d091b56e238ab2910c96d2',names:['building-a','building-d','building-h','building-i','building-m','shipping-container-a','water-tower','detail-tank','chimney-small']},
 {folder:'commercial',url:'https://kenney.nl/media/pages/assets/city-kit-commercial/a742d900eb-1753115042/kenney_city-kit-commercial_2.1.zip',sha256:'f8b09b081c2bb88bcc126e2dec1cb40fd0dad7e7e591b6c26aaefe96fb35276b',names:['building-a','building-c','building-f','building-h','detail-awning']}
];
const token=process.env.GITHUB_TOKEN,repo=process.env.GITHUB_REPOSITORY;
if(!token||!repo)throw Error('Run this vendor step in GitHub Actions');
const blobs=[],provenance=[];
async function get(url){const r=await fetch(url);if(!r.ok)throw Error('Download '+r.status+' '+url);return Buffer.from(await r.arrayBuffer());}
async function blob(path,bytes,source){
 const r=await fetch('https://api.github.com/repos/'+repo+'/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({content:bytes.toString('base64'),encoding:'base64'})});
 if(!r.ok)throw Error('Blob upload '+path+' '+r.status);const data=await r.json();blobs.push({path,sha:data.sha,mode:'100644',type:'blob'});provenance.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),source});
}
for(const pack of packs){
 const archive=await get(pack.url);if(createHash('sha256').update(archive).digest('hex')!==pack.sha256)throw Error('Source archive digest changed');
 const names=['License.txt','Models/GLB format/Textures/colormap.png',...pack.names.map(n=>'Models/GLB format/'+n+'.glb')];
 const python='import sys,zipfile,io,json,base64\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nnames=json.loads(sys.argv[1])\nprint(json.dumps([{\"name\":n,\"data\":base64.b64encode(z.read(n)).decode()} for n in names]))';
 const extracted=spawnSync('python3',['-c',python,JSON.stringify(names)],{input:archive,maxBuffer:16*1024*1024,encoding:'utf8'});if(extracted.status!==0)throw Error(extracted.stderr);
 for(const file of JSON.parse(extracted.stdout)){const path='public/art/kenney-'+pack.folder+'/'+file.name.replace('Models/GLB format/','');await blob(path,Buffer.from(file.data,'base64'),pack.url);}
}
const fontRoot='https://raw.githubusercontent.com/google/fonts/c6f97839901e4707d3792b1c50f3f92eb66b3d2f/ofl/dohyeon/';
for(const name of ['DoHyeon-Regular.ttf','OFL.txt'])await blob('public/art/fonts/'+name,await get(fontRoot+name),fontRoot+name);
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/art-blobs.json',JSON.stringify({blobs,provenance},null,2));
console.log('ART_BLOBS '+JSON.stringify(blobs));console.log('ART_PROVENANCE '+JSON.stringify(provenance));
