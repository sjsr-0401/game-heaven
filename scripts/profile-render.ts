import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.REVIEW_BASE_URL??'http://127.0.0.1:3000';
const common=['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-gpu-sandbox','--enable-unsafe-swiftshader'];
const trials:{name:string;width:number;height:number;record:boolean;headless:boolean;args:string[];channel?:string;quality?:string;capture?:'screencast'|'native';deviceScaleFactor?:number}[]=[
 {name:'shell-default1280',width:1280,height:800,record:true,headless:true,args:[]},
 {name:'shell-fallback1280',width:1280,height:800,record:true,headless:true,args:['--use-gl=angle','--use-angle=swiftshader-webgl']},
 {name:'full-default1280',width:1280,height:800,record:true,headless:true,channel:'chromium',args:[]},
 {name:'full-fallback1280',width:1280,height:800,record:true,headless:true,channel:'chromium',args:['--use-gl=angle','--use-angle=swiftshader-webgl']},
 {name:'full-default1440',width:1440,height:900,record:true,headless:true,channel:'chromium',args:[]},
 {name:'full-standard1280',width:1280,height:800,record:true,headless:true,channel:'chromium',quality:'standard',args:[]},
 {name:'full-cdp1280',width:1280,height:800,record:true,headless:true,channel:'chromium',capture:'screencast',args:['--use-gl=angle','--use-angle=swiftshader-webgl']},
 {name:'full-native1280',width:1280,height:800,record:true,headless:true,channel:'chromium',capture:'native',args:['--use-gl=angle','--use-angle=swiftshader-webgl']},
 {name:'full-high1280',width:1280,height:800,record:false,headless:true,channel:'chromium',quality:'high',deviceScaleFactor:1.5,args:['--use-gl=angle','--use-angle=swiftshader-webgl']},
 {name:'shell-live1280',width:1280,height:800,record:false,headless:true,args:[]}
];
await mkdir('artifacts/profile',{recursive:true});
const results:Record<string,unknown>[]=[];
for(const trial of trials){
 let browser:Awaited<ReturnType<typeof chromium.launch>>|null=null;
 try{
  browser=await chromium.launch({headless:trial.headless,channel:trial.channel,args:[...common,...trial.args],env:{...process.env,...(trial.name.startsWith('mesa')?{LIBGL_ALWAYS_SOFTWARE:'1'}:{})}});
  const context=await browser.newContext({viewport:{width:trial.width,height:trial.height},deviceScaleFactor:trial.deviceScaleFactor??1,...(trial.record&&!trial.capture?{recordVideo:{dir:'artifacts/profile-raw',size:{width:trial.width,height:trial.height}}}:{})});
  const main=await context.newPage(),friendContext=await browser.newContext({viewport:{width:800,height:600}}),friend=await friendContext.newPage();
  for(const [page,ctx] of [[main,context],[friend,friendContext]] as const){const focus=await ctx.newCDPSession(page);await focus.send('Emulation.setFocusEmulationEnabled',{enabled:true});await page.goto(base+'/?review=1&graphics='+(trial.quality??'economy')+(page===friend?'&review-helper=1':''),{waitUntil:'domcontentloaded',timeout:20000});await page.locator('#connection.online').waitFor({state:'attached',timeout:15000});await page.locator('#nickname').fill(page===main?'계측 A':'계측 B');}
  await main.locator('#create-room').click();await main.locator('#lobby-copy').waitFor();
  const code=await main.evaluate(()=>window.__review!.snapshot().room!.code);
  await friend.locator('#join-code').fill(code);await friend.locator('#join-room').click();await friend.locator('#ready-start').click();
  await main.waitForFunction(()=>document.querySelector<HTMLButtonElement>('#ready-start')?.disabled===false);await main.locator('#ready-start').click();
  await main.locator('.world canvas').waitFor({timeout:20000});await main.waitForFunction(()=>window.__review!.metrics()?.art.loaded===14,{},{timeout:20000});await main.waitForTimeout(2000);
  const rect=await main.locator('.world canvas').boundingBox();if(!rect||Math.abs(rect.height-trial.height)>1)throw Error('Incorrect playfield dimensions');
  const cdp=await context.newCDPSession(main),system=await browser.newBrowserCDPSession(),gpu=await system.send('SystemInfo.getInfo');
  await cdp.send('Performance.enable');await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
  const send=cdp.send.bind(cdp) as (method:string,params?:Record<string,unknown>)=>Promise<any>;
  const captured:{timestamp:number;data:Buffer}[]=[];
  if(trial.capture==='screencast'){
   cdp.on('Page.screencastFrame',frame=>{captured.push({timestamp:frame.metadata.timestamp??Date.now()/1000,data:Buffer.from(frame.data,'base64')});void cdp.send('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});});
   await cdp.send('Page.startScreencast',{format:'jpeg',quality:72,maxWidth:trial.width,maxHeight:trial.height,everyNthFrame:1});
  }
  if(trial.capture==='native')await send('Page.startScreenRecording',{audio:false,maxWidth:trial.width,maxHeight:trial.height,frameRate:25});
  const before=await main.evaluate(()=>window.__review!.metrics()!),perfBefore=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  await main.waitForTimeout(8000);
  const after=await main.evaluate(()=>window.__review!.metrics()!),perfAfter=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value])),cpu=await cdp.send('Profiler.stop');
  if(trial.capture==='screencast'){await cdp.send('Page.stopScreencast');for(const [i,frame]of captured.filter((_,i)=>i%Math.max(1,Math.floor(captured.length/3))===0).slice(0,3).entries())await writeFile('artifacts/profile/'+trial.name+'-'+i+'.jpg',frame.data);}
  if(trial.capture==='native'){const stopped=await send('Page.stopScreenRecording');const parts:Buffer[]=[];for(let i=0;i<200;i++){const chunk=await cdp.send('IO.read',{handle:stopped.stream,size:1024*1024});parts.push(Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8'));if(chunk.eof)break;}await cdp.send('IO.close',{handle:stopped.stream});const bytes=Buffer.concat(parts);await writeFile('artifacts/profile/'+trial.name+'.webm',bytes);console.log('NATIVE_CAPTURE_BYTES '+bytes.length);}
  const elapsed=(after.frameMs-before.frameMs)/1000,fps=elapsed>0?(after.frames-before.frames)/elapsed:0;
  const hot=cpu.profile.nodes.map(n=>({name:n.callFrame.functionName||'(anonymous)',url:n.callFrame.url.split('/').at(-1),samples:n.hitCount??0})).sort((a,b)=>b.samples-a.samples).slice(0,10);
  const result={trial:trial.name,status:'ok',size:[trial.width,trial.height],recording:trial.capture??trial.record,capturedFrames:captured.length,quality:trial.quality??'economy',fps:+fps.toFixed(1),drawCalls:after.drawCalls,triangles:after.triangles,scriptSeconds:perfAfter.ScriptDuration-perfBefore.ScriptDuration,taskSeconds:perfAfter.TaskDuration-perfBefore.TaskDuration,layoutSeconds:perfAfter.LayoutDuration-perfBefore.LayoutDuration,heapMB:+(perfAfter.JSHeapUsedSize/1024/1024).toFixed(1),gpu:gpu.gpu.devices.map(d=>d.deviceString),hot};
  results.push(result);console.log('RENDER_TRIAL '+JSON.stringify(result));await main.screenshot({path:'artifacts/profile/'+trial.name+'.png'});
  await context.close();await friendContext.close();
 }catch(error){const result={trial:trial.name,status:'unsupported-or-failed',error:String(error)};results.push(result);console.log('RENDER_TRIAL '+JSON.stringify(result));}
 finally{await browser?.close();}
}
await writeFile('artifacts/profile/render-profile.json',JSON.stringify({sourceCommit:process.env.GITHUB_SHA,results},null,2));

if(!results.some(r=>r.status==='ok'))throw Error('No renderer trial completed; do not treat an empty profile as a pass');
