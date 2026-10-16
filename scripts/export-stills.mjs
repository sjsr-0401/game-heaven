import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const token=process.env.GITHUB_TOKEN,repo=process.env.GITHUB_REPOSITORY;
if(!token||!repo)throw Error('Publish stills only inside the authorized Actions job');
const verification=JSON.parse(await readFile('artifacts/verification.json','utf8'));
if(verification.sourceCommit!==process.env.GITHUB_SHA||verification.summary.phase!=='won'||!verification.reviewHtml?.playbackVerified)throw Error('Only export a verified, completed review');
const selected=[['menu.png','menu.png'],['poster.png','play.png'],['canal.png','canal.png'],['boss.png','boss.png'],['four-player.png','four-player.png'],['four-player-high.png','four-player-high.png'],['action-strip.jpg','action-strip.jpg']];
const entries=[];
for(const [source,name]of selected){
 const bytes=await readFile('artifacts/'+source);
 const response=await fetch('https://api.github.com/repos/'+repo+'/git/blobs',{method:'POST',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({content:bytes.toString('base64'),encoding:'base64'})});
 if(!response.ok)throw Error('Still upload failed: '+source+' HTTP '+response.status);
 const data=await response.json();entries.push({path:'docs/screenshots/'+name,mode:'100644',type:'blob',sha:data.sha,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const manifest={sourceCommit:verification.sourceCommit,entries};
await writeFile('artifacts/still-blobs.json',JSON.stringify(manifest,null,2));
console.log('STILL_BLOBS '+JSON.stringify(manifest));
