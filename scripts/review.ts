import {chromium,type Page,type BrowserContext} from 'playwright';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {decide} from './crew-agent.js';
import {onDeck,type EscapeState} from '../shared/escape.js';
import type {RoomSnapshot} from '../shared/protocol.js';
const base=process.env.REVIEW_BASE_URL??'http://127.0.0.1:3000',slice=process.env.REVIEW_SLICE_ONLY==='1';
const ffmpeg=process.env.FFMPEG_PATH??'ffmpeg',checks:{name:string;passed:boolean}[]=[],chapters:{title:string;description:string;seconds:number}[]=[];
const segments:{start:number;end:number;title:string;description:string}[]=[];
const sourceCommit=process.env.GITHUB_SHA??'uncommitted';
await mkdir('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true,args:['--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--autoplay-policy=no-user-gesture-required']});
const contexts:BrowserContext[]=[],pages:Page[]=[],errors:string[]=[],keys=new Map<Page,Set<string>>(),lastActions=new Map<string,number>(),debugActions=new Map<string,number>();
let main:Page,videoStart=0,mainContext:BrowserContext,audio:{base64:string;startedAt:number}|null=null;
const now=()=> (Date.now()-videoStart)/1000;
function check(name:string,passed=true):void{checks.push({name,passed});assert.ok(passed,name);console.log('CHECK '+name);}
async function quick(page:Page,selector:string):Promise<boolean>{const el=page.locator(selector).first();if(!await el.isVisible()||!await el.isEnabled())return false;const box=await el.boundingBox();if(!box)return false;await page.mouse.click(box.x+box.width/2,box.y+box.height/2);return true;}
async function snapshot(page:Page):Promise<{room:RoomSnapshot|null;playerId:string}>{return await page.evaluate(()=>window.__review!.snapshot());}
async function newPage(name:string,record=false):Promise<Page>{
  const context=await browser.newContext({viewport:record?{width:1440,height:900}:{width:960,height:700},deviceScaleFactor:record?1:.65,...(record?{recordVideo:{dir:'artifacts/raw',size:{width:1440,height:900}}}:{})});
  contexts.push(context);const page=await context.newPage();pages.push(page);keys.set(page,new Set());
  // Every crew member represents a separate computer, not competing tabs on one desktop.
  const focus=await context.newCDPSession(page);await focus.send('Emulation.setFocusEmulationEnabled',{enabled:true});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('favicon'))errors.push(message.text());});
  if(record)videoStart=Date.now();
  await page.goto(base+'/?review=1'+(record?'&record=1&graphics=standard':'&graphics=economy&review-helper=1'),{waitUntil:'domcontentloaded',timeout:60000});await page.locator('#connection.online').waitFor({timeout:30000});await page.locator('#nickname').fill(name);
  return page;
}
async function caption(title:string,description:string):Promise<void>{await main.evaluate(({title,description})=>window.__review!.caption(title,description),{title,description});}
async function section(title:string,description:string,duration=18):Promise<void>{const time=now();segments.push({start:Math.max(0,time-.5),end:time+duration,title,description});await caption(title,description);}
async function release(page:Page):Promise<void>{for(const key of keys.get(page)??[])await page.keyboard.up(key);keys.set(page,new Set());await page.mouse.up();}
async function agent(page:Page,index:number):Promise<void>{
  const data=await snapshot(page);if(!data.room?.game)return;const s=data.room.game as EscapeState,p=s.crew.find(p=>p.id===data.playerId);if(!p)return;
  const d=decide(s,p.id,index);
  const dx=d.move.x*.836+d.move.z*.548,up=-d.move.x*.548+d.move.z*.836;
  const desired=new Set<string>();if(dx>.3)desired.add('d');if(dx<-.3)desired.add('a');if(up>.3)desired.add('w');if(up<-.3)desired.add('s');
  const held=keys.get(page)??new Set<string>();
  for(const key of held)if(!desired.has(key))await page.keyboard.up(key);
  for(const key of desired)if(!held.has(key))await page.keyboard.down(key);for(const key of desired)if(held.has(key))await page.keyboard.down(key);keys.set(page,desired);
  if(d.dodge&&Date.now()>(lastActions.get(p.id+'extra-dodge')??0)){await page.keyboard.press('Space');lastActions.set(p.id+'extra-dodge',Date.now()+1500);}
  if(s.phase==='camp'){
    if(d.upgrade&&Date.now()>(lastActions.get(p.id+'upgrade')??0)){await quick(page,'[data-upgrade="'+d.upgrade+'"]');lastActions.set(p.id+'upgrade',Date.now()+700);}
    if(d.route&&!s.votes[p.id])await quick(page,'[data-route="'+d.route+'"]');return;
  }
  if(!d.action||Date.now()<(lastActions.get(p.id+d.action)??0))return;
  if(d.action==='hook'||d.action==='throw'){
    const targetId=(d.aim as {id?:string}).id,enemy=s.enemies.find(e=>e.id===targetId),crew=s.crew.find(c=>c.id===targetId),prop=s.props.find(o=>o.id===targetId);
    const y=enemy?(enemy.kind==='devourer'?1.6:1):crew?(onDeck(crew,s.house)?1.61:0)+(crew.downUntil>s.clock?.45:1):prop?(onDeck(prop,s.house)?1.61:0)+.5:1.3;
    const point=await page.evaluate(v=>window.__review!.project(v.x,v.z,v.y),{...d.aim,y}),size=page.viewportSize()!;
    if((debugActions.get(p.id)??0)<3){debugActions.set(p.id,(debugActions.get(p.id)??0)+1);const hit=point?await page.evaluate(v=>{const el=document.elementFromPoint(v.x,v.y);return{tag:el?.tagName,class:el?.className,focus:document.hasFocus(),scrollX,scrollY,viewport:{w:innerWidth,h:innerHeight}};},point):null;console.log('AGENT_POINTER '+JSON.stringify({index,action:d.action,from:{x:p.x,z:p.z},aim:{x:d.aim.x,z:d.aim.z,y},point,size,hit}));}
    if(point?.visible&&point.y>70&&point.y<size.height-105&&point.x>8&&point.x<size.width-8){await page.mouse.move(point.x,point.y);await page.mouse.click(point.x,point.y,{button:d.action==='throw'?'right':'left'});}
  }else await page.keyboard.press(d.action==='dodge'?'Space':d.action==='install'?'e':'q');
  lastActions.set(p.id+d.action,Date.now()+(d.action==='hook'?550:d.action==='dodge'?1450:480));
}
try{
  main=await newPage('노랑 우비',true);mainContext=contexts[0];await main.waitForTimeout(1300);await main.screenshot({path:'artifacts/menu.png'});
  await main.locator('#sound-toggle').click();await main.locator('#create-room').click();await main.locator('#lobby-copy').waitFor();
  check('혼자서는 출발할 수 없음',!await main.locator('#ready-start').isEnabled());
  const data=await snapshot(main),code=data.room!.code;
  const friend=await newPage('민트 우비');await friend.locator('#join-code').fill(code.toLowerCase());await friend.locator('#join-room').click();await friend.locator('#ready-start').waitFor();
  await main.screenshot({path:'artifacts/lobby.png'});check('두 브라우저가 같은 방에 합류',(await snapshot(friend)).room!.code===code);
  await friend.locator('#ready-start').click();await main.waitForFunction(()=>document.querySelector<HTMLButtonElement>('#ready-start')?.disabled===false);
  await section('한 집, 두 명의 도주 팀','실제 두 브라우저가 같은 서버의 방에 합류하고 출발합니다.',22);
  await main.locator('#ready-start').click();await main.locator('.world canvas').waitFor();await main.waitForTimeout(1000);
  check('실제 2인 원정 시작',(await snapshot(main)).room!.phase==='playing');
  const aimStart=(await snapshot(main)).room!.game as EscapeState;
  const fixedCursor=await main.evaluate(v=>window.__review!.project(-14,v-.5,.4),aimStart.house.z);
  assert.ok(fixedCursor?.visible);await main.mouse.move(fixedCursor.x,fixedCursor.y);await main.waitForTimeout(450);
  const aimBefore=((await snapshot(main)).room!.game as EscapeState).crew.find(p=>p.id===(aimStart.crew[0].id))!;
  await main.waitForTimeout(3000);
  const aimAfterState=(await snapshot(main)).room!.game as EscapeState,aimAfter=aimAfterState.crew.find(p=>p.id===aimBefore.id)!;
  check('집이 움직여도 고정된 마우스 위치로 계속 조준',aimAfterState.house.z-aimStart.house.z>.9&&aimBefore.aimX*aimAfter.aimX+aimBefore.aimZ*aimAfter.aimZ>.997);
  const movementBefore=(await snapshot(main)).room!.game as EscapeState;
  await main.keyboard.down('a');keys.set(main,new Set(['a']));await friend.keyboard.down('d');keys.set(friend,new Set(['d']));
  await main.waitForTimeout(2200);const movementAfter=(await snapshot(main)).room!.game as EscapeState;
  await release(main);await release(friend);
  check('두 창의 이동 입력이 동시에 유지됨',movementAfter.crew.every(p=>{const before=movementBefore.crew.find(c=>c.id===p.id)!;return Math.hypot(p.x-before.x,p.z-before.z)>4;}));


  const start=Date.now();let twoPlayerMetrics:{fps:number;drawCalls:number;triangles:number}|null=null;let loggedAt=0;let sawCarry=false,sawThrow=false,sawGate=false,sawCamp=false,sawSecond=false,sawBoss=false,reloaded=false,savedPoster=false;
  const maxSeconds=slice?85:650;
  while((Date.now()-start)/1000<maxSeconds){
    await Promise.all([agent(main,0),agent(friend,1)]);
    const state=(await snapshot(main)).room!,s=state.game as EscapeState;
    if(s.clock-loggedAt>20){loggedAt=s.clock;console.log('PLAY_PROGRESS '+JSON.stringify({clock:Math.round(s.clock),stage:s.stage,phase:s.phase,distance:Math.round(s.house.z),hull:Math.round(s.house.hp),crew:s.crew.map(p=>({name:p.name,...p.stats})),metrics:await main.evaluate(()=>window.__review!.metrics())}));}
    if(!savedPoster&&s.clock>12){savedPoster=true;await main.screenshot({path:'artifacts/poster.png'});await main.screenshot({path:'artifacts/combat.png'});}
    if(!sawCarry&&s.crew.some(p=>p.carry)){sawCarry=true;await section('끌어오고, 던지고','갈고리로 회수한 물체를 실제 투사체로 던집니다. 피해는 서버에서 판정합니다.',22);}
    if(!sawThrow&&s.crew.some(p=>p.stats.throws>0)){sawThrow=true;check('실제 물체 회수와 투척',true);}
    if(!sawGate&&!s.gate.open&&s.gate.z-s.house.z<12){sawGate=true;await section('길을 여는 방법도 함께 고른다','갈고리로 장애물을 뜯고, 화약통으로 길을 뚫습니다.',22);await main.screenshot({path:'artifacts/gate.png'});}
    if(!sawCamp&&s.phase==='camp'){sawCamp=true;await section('숨 돌림과 공동 개조','실제 회수한 부품을 함께 쓰고, 다음 경로에 투표합니다.',17);await main.screenshot({path:'artifacts/camp.png'});check('장애물 돌파 후 정비와 경로 투표',true);}
    if(!sawSecond&&s.stage===2){sawSecond=true;await section('이번에는 물안개 운하','투표 결과가 다음 구역의 분위기와 진행에 반영됩니다.',20);await main.screenshot({path:'artifacts/canal.png'});}
    if(!sawBoss&&s.enemies.some(e=>e.kind==='devourer')){sawBoss=true;await section('마지막 추격자, 고철 포식자','위험 예고를 피하고, 열린 흡입구에 물체를 던집니다.',35);await main.screenshot({path:'artifacts/boss.png'});}
    if(state.phase==='finished'){
      await release(main);await release(friend);await section(s.phase==='won'?'함께 도착한 집':'실패도 다음 원정의 경험','실제 서버 판정으로 끝난 한 판의 결과입니다.',9);
      await main.waitForTimeout(1800);await main.screenshot({path:'artifacts/results.png'});check('한 판이 실제 결과 화면까지 진행',true);break;
    }
    await main.waitForTimeout(120);
  }
  twoPlayerMetrics=await main.evaluate(()=>window.__review!.metrics());
  await release(main);await release(friend);
  const beforeReload=await snapshot(friend);await friend.reload({waitUntil:'domcontentloaded',timeout:60000});await friend.waitForFunction(()=>window.__review?.snapshot().room?.game!=null,{},{timeout:60000});const restored=await snapshot(friend);check('재접속으로 같은 캐릭터와 원정 상태 복원',beforeReload.playerId===restored.playerId&&restored.room!.code===beforeReload.room!.code);
  let final=(await snapshot(main)).room!,finalGame=final.game as EscapeState;
  if(!slice){check('2인 원정이 실제 탈출 성공까지 종료됨',final.phase==='finished'&&finalGame.phase==='won'&&finalGame.bossDefeated);check('정비와 경로 변경을 실제 플레이',sawCamp&&sawSecond);check('마지막 추격자와 실제 교전',sawBoss);}
  // The four-player check uses a separate real room and real UI; no game state is injected.
  if(final.phase==='finished'){await quick(main,'[data-lobby]');await main.locator('#ready-start').waitFor();}
  else{await main.locator('#leave-room').click();await main.locator('#nickname').waitFor();await main.locator('#create-room').click();await main.locator('#lobby-copy').waitFor();}
  const fourCode=(await snapshot(main)).room!.code;
  if((await snapshot(friend)).room?.code!==fourCode){await friend.locator('#leave-room').click();await friend.locator('#nickname').waitFor();await friend.locator('#join-code').fill(fourCode);await friend.locator('#join-room').click();}
  const third=await newPage('보라 우비'),fourth=await newPage('분홍 우비');
  for(const page of [third,fourth]){await page.locator('#join-code').fill(fourCode);await page.locator('#join-room').click();await page.locator('#ready-start').waitFor();}
  check('실제 4인 방 입장',(await snapshot(main)).room!.players.length===4);
  const extra=await newPage('다섯 번째');await extra.locator('#join-code').fill(fourCode);await extra.locator('#join-room').click();await extra.waitForTimeout(500);check('다섯 번째 참가자 차단',(await snapshot(extra)).room===null);await extra.context().close();
  for(const page of [friend,third,fourth])await page.locator('#ready-start').click();
  await main.waitForFunction(()=>document.querySelector<HTMLButtonElement>('#ready-start')?.disabled===false);
  await section('이번에는 네 명이 함께','네 개의 독립 브라우저가 같은 집과 물체를 공유하는 실제 4인 플레이입니다.',30);
  await main.locator('#ready-start').click();await main.locator('.world canvas').waitFor();
  const fourStart=Date.now();while(Date.now()-fourStart<32000){await Promise.all([main,friend,third,fourth].map((p,i)=>agent(p,i)));await main.waitForTimeout(140);}
  await Promise.all([main,friend,third,fourth].map(release));await main.screenshot({path:'artifacts/four-player.png'});
  const fourStates=await Promise.all([main,friend,third,fourth].map(snapshot));
  check('4인 위치·집·아이템이 같은 서버 상태로 동기화',fourStates.every(p=>(p.room!.game as EscapeState).crew.length===4&&Math.abs((p.room!.game as EscapeState).house.z-(fourStates[0].room!.game as EscapeState).house.z)<1));
  const metrics=await main.evaluate(()=>window.__review!.metrics());
  await caption('같이 돌아갈 집이 있으니까.','2–4인 협동 액션 · 실제 실행과 조작으로 녹화한 영상');await main.waitForTimeout(2500);
  audio=await main.evaluate(()=>window.__review!.audio());check('마이크 없이 실제 게임 효과음 출력 녹음',!!audio?.base64);
  const fourPlayerIds=(fourStates[0].room!.game as EscapeState).crew.map(p=>p.id);
  await main.reload();await main.locator('.world canvas').waitFor();check('4인 원정 재접속 유지',(await snapshot(main)).playerId===fourStates[0].playerId&&((await snapshot(main)).room!.game as EscapeState).crew.map(p=>p.id).join()===fourPlayerIds.join());
  check('브라우저 런타임 오류 없음',errors.length===0);
  const video=main.video()!;for(const context of contexts)await context.close().catch(()=>{});await browser.close();
  const raw=await video.path();await copyFile(raw,'artifacts/source.webm');
  if(audio)await writeFile('artifacts/audio.webm',Buffer.from(audio.base64,'base64'));
  const full='artifacts/full-playthrough.mp4',target='artifacts/houseflight-preview.mp4';
  const offset=audio?Math.max(0,Math.round(audio.startedAt-videoStart)):0;
  execFileSync(ffmpeg,['-y','-i','artifacts/source.webm',...(audio?['-i','artifacts/audio.webm','-filter_complex','[1:a]adelay='+offset+'|'+offset+',apad[a]','-map','0:v:0','-map','[a]']:[]),'-c:v','libx264','-preset','ultrafast','-crf','25','-r','25','-pix_fmt','yuv420p',...(audio?['-c:a','aac','-b:a','96k','-shortest']:[]),'-movflags','+faststart',full],{stdio:'pipe',timeout:300000});
  const fullDuration=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',full],{encoding:'utf8'}));
  const sorted=segments.map(s=>({...s,start:Math.max(0,s.start),end:Math.min(s.end,fullDuration-.5)})).filter(s=>s.end>s.start).sort((a,b)=>a.start-b.start);
  const merged:typeof sorted=[];for(const segment of sorted){const previous=merged.at(-1);if(previous&&segment.start<previous.end){previous.end=Math.max(previous.end,segment.end);}else merged.push({...segment});}
  let outTime=0;const filters:string[]=[];merged.forEach((segment,i)=>{
    chapters.push({title:segment.title,description:segment.description,seconds:outTime});outTime+=segment.end-segment.start;
    filters.push('[0:v]trim=start='+segment.start+':end='+segment.end+',setpts=PTS-STARTPTS[v'+i+']');
    if(audio)filters.push('[0:a]atrim=start='+segment.start+':end='+segment.end+',asetpts=PTS-STARTPTS[a'+i+']');
  });
  filters.push(merged.map((_,i)=>'[v'+i+']'+(audio?'[a'+i+']':'')).join('')+'concat=n='+merged.length+':v=1:a='+(audio?1:0)+'[v]'+(audio?'[a]':''));
  execFileSync(ffmpeg,['-y','-i',full,'-filter_complex',filters.join(';'),'-map','[v]',...(audio?['-map','[a]']:[]),'-c:v','libx264','-preset','fast','-crf','23','-pix_fmt','yuv420p',...(audio?['-c:a','aac','-b:a','96k']:[]),'-movflags','+faststart',target],{stdio:'pipe',timeout:300000});
  execFileSync(ffmpeg,['-v','error','-i',target,'-f','null','-'],{stdio:'pipe',timeout:180000});check('최종 영상 전체 디코딩',true);
  if(audio){execFileSync(ffmpeg,['-v','error','-i',target,'-map','0:a:0','-f','null','-'],{stdio:'pipe',timeout:60000});check('실제 게임 음성 트랙 디코딩',true);}
  execFileSync(ffmpeg,['-y','-i',target,'-vf','fps=1/20,scale=480:-1,tile=3x3','-frames:v','1','artifacts/combat-sheet.jpg'],{stdio:'pipe',timeout:60000});
  const metadata={title:'집째로 도망',version:'1.0.0',sourceCommit,repository:'sjsr-0401/game-heaven',fullRun:final.phase==='finished',realGameAudio:!!audio,sourceDurationSeconds:fullDuration,checks,chapters,segments:merged,metrics,twoPlayerMetrics,summary:{phase:finalGame.phase,seconds:finalGame.clock,distance:finalGame.distance,bossDefeated:finalGame.bossDefeated,players:finalGame.crew.length,contributions:finalGame.crew.map(p=>({name:p.name,...p.stats}))},limitations:['클라우드 브라우저의 실제 키보드·마우스 조작입니다. 사람의 재미 평가와 실제 가정용 인터넷 지연 검증은 별도입니다.','하이라이트는 실제 속도이며 구간 사이를 편집했습니다. 원본 전체 영상도 같은 클라우드 산출물에 포함합니다.']};
  await writeFile('artifacts/verification.json',JSON.stringify(metadata,null,2));console.log('FINAL_REVIEW '+JSON.stringify(metadata));
}catch(error){
  for(let i=0;i<Math.min(pages.length,4);i++)try{await pages[i].screenshot({path:'artifacts/failure-'+i+'.png'});}catch{}
  await writeFile('artifacts/failure-details.json',JSON.stringify({error:String(error),stack:error instanceof Error?error.stack:'',errors,checks,metrics:await Promise.all(pages.slice(0,4).map(async p=>{try{return await p.evaluate(()=>window.__review?.metrics());}catch{return null;}})),dom:await Promise.all(pages.slice(0,4).map(async p=>{try{return await p.evaluate(()=>({url:location.href,canvases:[...document.querySelectorAll('canvas')].map(c=>({rect:c.getBoundingClientRect().toJSON(),parent:c.parentElement?.className,display:getComputedStyle(c).display,visibility:getComputedStyle(c).visibility})),body:document.body.className}));}catch{return null;}})),snapshots:await Promise.all(pages.slice(0,4).map(async p=>{try{return await snapshot(p);}catch{return null;}}))},null,2));
  await browser.close();throw error;
}
