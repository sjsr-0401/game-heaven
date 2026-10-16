import {chromium,type Page,type WebSocketRoute} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import type {EscapeState} from '../shared/escape.js';
const base=process.env.REVIEW_BASE_URL??'http://127.0.0.1:3000';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const checks:string[]=[],roundTrips:number[]=[],cuts=new Map<Page,()=>Promise<void>>(),errors:string[]=[];
let resumeRequests=0;
async function delayed(page:Page):Promise<void>{
 await page.routeWebSocket('**/ws',ws=>{
  const server=ws.connectToServer();let closed=false,up=0,down=0,packet=0;
  const forward=(target:WebSocketRoute,message:string|Buffer,outgoing:boolean)=>{
   const at=Math.max(Date.now()+75+(packet++%5)*5,(outgoing?up:down)+1);
   if(outgoing)up=at;else down=at;
   setTimeout(()=>{if(closed)return;if(!outgoing&&typeof message==='string'){const data=JSON.parse(message);if(data.type==='pong')roundTrips.push(Date.now()-data.at);}target.send(message);},Math.max(0,at-Date.now()));
  };
  ws.onMessage(message=>{if(typeof message==='string'&&JSON.parse(message).type==='resume')resumeRequests++;forward(server,message,true);});
  server.onMessage(message=>forward(ws,message,false));
  ws.onClose((code,reason)=>{closed=true;void server.close({code,reason});});server.onClose((code,reason)=>{closed=true;void ws.close({code,reason});});
  cuts.set(page,async()=>{closed=true;await Promise.all([ws.close({code:1001,reason:'Network regression'}),server.close({code:1001,reason:'Network regression'})]);});
 });
}
async function open(name:string,helper=false):Promise<Page>{
 const context=await browser.newContext({viewport:{width:960,height:700}}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setFocusEmulationEnabled',{enabled:true});
 await delayed(page);await page.goto(base+'/?review=1&graphics=economy'+(helper?'&review-helper=1':''));await page.locator('#connection.online').waitFor({state:'attached'});await page.locator('#nickname').fill(name);return page;
}
async function state(page:Page){return await page.evaluate(()=>window.__review!.snapshot());}
function check(name:string,ok:boolean){assert.ok(ok,name);checks.push(name);console.log('NETWORK_CHECK '+name);}
await mkdir('artifacts/network',{recursive:true});
try{
 const main=await open('지연 검사 A'),friend=await open('지연 검사 B',true);
 await main.locator('#create-room').click();await main.locator('#lobby-copy').waitFor();const code=(await state(main)).room!.code;
 await friend.locator('#join-code').fill(code);await friend.locator('#join-room').click();await friend.locator('#ready-start').click();await main.waitForFunction(()=>document.querySelector<HTMLButtonElement>('#ready-start')?.disabled===false);await main.locator('#ready-start').click();
 await main.waitForFunction(()=>window.__review!.snapshot().room?.phase==='playing');await friend.waitForFunction(()=>window.__review!.snapshot().room?.phase==='playing');await main.waitForTimeout(1400);
 const before=(await state(main)).room!.game as EscapeState;
 await main.keyboard.down('a');await friend.keyboard.down('d');await main.waitForTimeout(1700);await main.keyboard.up('a');await friend.keyboard.up('d');await main.waitForTimeout(650);
 const moved=(await state(main)).room!.game as EscapeState;
 check('delayed WebSocket traffic moves both players',moved.crew.every(p=>Math.hypot(p.x-before.crew.find(c=>c.id===p.id)!.x,p.z-before.crew.find(c=>c.id===p.id)!.z)>4));
 const stopped=moved.crew.map(p=>({id:p.id,x:p.x,z:p.z}));await main.waitForTimeout(800);const still=(await state(main)).room!.game as EscapeState;
 check('released inputs stop despite delayed packets',still.crew.every(p=>Math.abs(p.x-stopped.find(c=>c.id===p.id)!.x)<.15));
 const identity=(await state(friend)).playerId,clock=still.clock;await cuts.get(friend)!();await friend.waitForFunction(()=>!document.querySelector('#connection')?.classList.contains('online'));await friend.locator('#connection.online').waitFor({state:'attached',timeout:15000});await friend.waitForTimeout(750);
 const restored=await state(friend),game=restored.room!.game as EscapeState;
 check('real connection loss resumes the same character',restored.playerId===identity&&restored.room!.code===code&&resumeRequests>0&&game.clock>clock);
 check('the other player stays in the expedition',(await state(main)).room!.code===code&&game.crew.every(p=>!p.left));
 check('measured application round trip includes the delay',roundTrips.some(ms=>ms>=140&&ms<1000));
 check('no browser runtime errors',errors.length===0);
 await main.screenshot({path:'artifacts/network/delayed-play.png'});
 await writeFile('artifacts/network/network-review.json',JSON.stringify({sourceCommit:process.env.GITHUB_SHA,oneWayDelayMs:[75,95],checks,roundTripsMs:roundTrips,resumeRequests,limitations:'Artificial application-message delay with preserved order; not a test of a real home ISP, packet loss or human input feel.'},null,2));
}finally{await browser.close();}
