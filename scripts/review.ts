import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromium, type Page, type BrowserContext } from 'playwright';
import { BOARD, slotPosition, trackPosition, type DefenseState } from '../shared/defense.js';
import type { RoomSnapshot } from '../shared/protocol.js';

interface Inspection { room: RoomSnapshot | null; playerId: string }
interface ReviewWindow extends Window {
  __review: { snapshot(): Inspection; caption(number: string, title: string, text: string): void };
}
const ffmpegPath: unknown = process.env.FFMPEG_PATH ?? createRequire(import.meta.url)('ffmpeg-static');
const base = process.env.REVIEW_BASE_URL ?? 'http://127.0.0.1:3000';
const directory = resolve('artifacts');
await mkdir(resolve(directory, 'raw'), { recursive: true });
const started = Date.now();
const chapters: { seconds: number; title: string; description: string }[] = [];
const errors: string[] = [];
const checks: { name: string; passed: boolean }[] = [];
const browser = await chromium.launch({ headless: true });
const contexts: BrowserContext[] = [];
let videoPath = '';
let summary = { wave: 0, kills: 0, defenders: 0, seconds: 0 };

async function inspect(page: Page): Promise<Inspection & { game: DefenseState }> {
  const value = await page.evaluate(() => (window as unknown as ReviewWindow).__review.snapshot());
  assert.ok(value.room, 'Expected a joined room');
  return { ...value, game: value.room.game as DefenseState };
}
async function caption(page: Page, number: string, title: string, text: string): Promise<void> {
  chapters.push({ seconds: Math.max(0, (Date.now() - started) / 1000), title, description: text });
  await page.evaluate(({ number, title, text }) => (window as unknown as ReviewWindow).__review.caption(number, title, text), { number, title, text });
}
async function button(page: Page, selector: string): Promise<void> {
  const locator = page.locator(selector);
  await locator.waitFor({ state: 'visible' });
  const box = await locator.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 15 });
  await page.waitForTimeout(170);
  await locator.click();
  await page.waitForTimeout(430);
}
async function fieldPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('#battlefield').boundingBox(); assert.ok(box);
  return { x: box.x + x / BOARD.width * box.width, y: box.y + y / BOARD.height * box.height };
}
async function selectSlot(page: Page, slot: number): Promise<void> {
  const point = slotPosition(slot), target = await fieldPoint(page, point.x, point.y-32);
  await page.mouse.move(target.x, target.y, { steps: 18 });
  await page.waitForTimeout(150);
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(500);
}
async function untilGame(page: Page, predicate: (game: DefenseState) => boolean, timeout = 10_000): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate((await inspect(page)).game)) return;
    await page.waitForTimeout(120);
  }
  throw new Error('Game state condition timed out');
}


async function own(page:Page){
  const value=await inspect(page);return{...value,self:value.game.players.find(p=>p.id===value.playerId)!,army:value.game.defenders.filter(d=>d.ownerId===value.playerId)};
}
async function quickButton(page:Page,selector:string):Promise<void>{
  const locator=page.locator(selector);if(await locator.isEnabled())await locator.click();await page.waitForTimeout(100);
}
async function recruit(page:Page,wager=false):Promise<void>{
  const value=await own(page),cost=wager?(value.self.relics.includes('coin')?90:120):40;
  if(value.self.status!=='active'||(wager&&value.self.contracts>0?false:value.self.gold<cost)||value.army.length>=16)return;
  await button(page,wager?'#wager':'#summon');
}
async function cast(page:Page):Promise<void>{
  const value=await own(page),p=value.self;if(p.status!=='active'||p.burstReadyAt>value.game.time||value.game.phase!=='battle')return;
  const enemies=value.game.enemies.filter(e=>e.ownerId===value.playerId),target=enemies.find(e=>e.kind==='boss')??enemies[0];
  const point=trackPosition(target?.progress??35);await quickButton(page,'#burst');const q=await fieldPoint(page,point.x,point.y);
  await page.mouse.move(q.x,q.y,{steps:8});await page.mouse.click(q.x,q.y);await page.waitForTimeout(120);
}
async function chooseRelic(page:Page):Promise<boolean>{
  const value=await own(page);if(!value.self.relicChoices.length||value.self.status!=='active')return false;
  const preferred=['hunter','clock','banner','emberglass','scope','powder','coin','ledger','blood'];
  const relic=[...value.self.relicChoices].sort((a,b)=>preferred.indexOf(a)-preferred.indexOf(b))[0];
  await quickButton(page,'#open-relics');await page.waitForTimeout(180);await quickButton(page,'[data-relic="'+relic+'"]');
  return true;
}
async function dodge(page:Page):Promise<boolean>{
  const value=await own(page);if(value.self.status!=='active')return false;
  for(const hazard of value.game.hazards.filter(h=>h.ownerId===value.playerId&&h.resolveAt-value.game.time>.5)){
    const threatened=value.army.find(u=>{const p=slotPosition(u.slot);return Math.hypot(p.x-hazard.x,p.y-hazard.y)<hazard.radius;});
    if(!threatened)continue;
    const occupied=new Set(value.army.map(u=>u.slot));
    const slot=Array.from({length:40},(_,i)=>i).find(i=>{const p=slotPosition(i);return !occupied.has(i)&&Math.hypot(p.x-hazard.x,p.y-hazard.y)>135;});
    if(slot===undefined)continue;
    const from=slotPosition(threatened.slot),target=slotPosition(slot),a=await fieldPoint(page,from.x,from.y),b=await fieldPoint(page,target.x,target.y);
    await page.mouse.click(a.x,a.y-18);await page.mouse.click(b.x,b.y,{button:'right'});await page.waitForTimeout(120);
    return true;
  }
  return false;
}
async function play(page:Page):Promise<void>{
  let v=await own(page);if(v.self.status!=='active')return;
  if(await dodge(page))return;
  if(v.self.relicChoices.length){await chooseRelic(page);return;}
  const enemies=v.game.enemies.filter(e=>e.ownerId===v.playerId),boss=enemies.find(e=>e.kind==='boss');
  if(v.self.burstReadyAt<=v.game.time&&(boss||enemies.length>10)){await cast(page);return;}
  if(v.army.length<11&&v.self.gold>=40){await recruit(page,v.self.gold>=(v.self.relics.includes('coin')?180:240));return;}
  if(v.self.upgrade<6&&v.self.gold>=100+v.self.upgrade*70){await quickButton(page,'#upgrade');return;}
  if(v.army.length<14&&(v.self.contracts>0||v.self.gold>=120)){await recruit(page,true);return;}
  if(v.self.contracts>0||v.self.gold>=240){
    const common=v.army.find(u=>u.rank===0);
    if(common){await selectSlot(page,common.slot);await quickButton(page,'[data-dismiss]');await recruit(page,true);}
  }
}
function remember(page:Page):void{
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
}
try{
  const mainContext=await browser.newContext({viewport:{width:1440,height:1080},deviceScaleFactor:1,recordVideo:{dir:resolve(directory,'raw'),size:{width:1440,height:1080}}});
  contexts.push(mainContext);const main=await mainContext.newPage();remember(main);const video=main.video();assert.ok(video);
  await main.goto(base+'/?record=1');await main.waitForSelector('.connection.connected',{state:'attached'});await main.evaluate(()=>document.fonts.ready);
  await main.locator('#nickname').fill('까마귀');
  await caption(main,'01','운명으로 모인 여섯 직업','개인 운빨 디펜스 · 직접 만든 사람형 도트 · 3막 12웨이브.');
  await main.waitForTimeout(1600);await button(main,'#create-room');
  const first=await inspect(main),code=first.room!.code,originalId=first.playerId;
  const friendContext=await browser.newContext({viewport:{width:1440,height:1080}});contexts.push(friendContext);
  const friend=await friendContext.newPage();remember(friend);await friend.goto(base+'/?record=1&room='+code);
  await friend.waitForSelector('.connection.connected',{state:'attached'});await friend.locator('#nickname').fill('밤손님');await button(friend,'#join-room');
  const friendId=(await inspect(friend)).playerId;
  await button(friend,'#start-game');await button(main,'#start-game');await main.waitForSelector('#battlefield');await friend.waitForSelector('#battlefield');
  checks.push({name:'서로 다른 두 브라우저의 방 코드·준비·시작 동기화',passed:true});
  await button(main,'#sound-toggle');assert.equal(await main.locator('#sound-toggle').getAttribute('aria-label'),'효과음 끄기');
  const initial=await own(main),unit=initial.army[0],other=(await own(friend)).army[0];
  const p=slotPosition(unit.slot),body=await fieldPoint(main,p.x,p.y-48);await main.mouse.click(body.x,body.y);
  await main.waitForTimeout(200);assert.equal(await main.locator('.guardian-heading h3').innerText(),'유랑 사수');
  checks.push({name:'사람형 몸통 클릭 선택과 효과음 활성화',passed:true});
  await caption(main,'02','선두, 강한 적, 약한 적','용병마다 공격 우선순위를 바꿉니다. 강한 적 우선으로 보스에 화력을 집중.');
  await button(main,'[data-priority="strong"]');
  await untilGame(friend,s=>s.defenders.find(d=>d.id===unit.id)?.priority==='strong');
  const from=await fieldPoint(main,p.x,p.y),to=slotPosition(9),q=await fieldPoint(main,to.x,to.y);
  await main.mouse.move(from.x,from.y);await main.mouse.down();await main.mouse.move(q.x,q.y,{steps:24});await main.mouse.up();
  await untilGame(friend,s=>s.defenders.find(d=>d.id===unit.id)?.slot===9);
  assert.equal((await inspect(friend)).game.defenders.find(d=>d.id===other.id)!.slot,other.slot);
  await main.mouse.click(from.x,from.y,{button:'right'});await untilGame(main,s=>s.defenders.find(d=>d.id===unit.id)?.slot===unit.slot);
  checks.push({name:'공격 우선순위·드래그 배치 동기화와 개인 전장 격리',passed:true});
  await caption(main,'03','계약 인장을 열어 이번 운을 확인','일반 40 G · 승부 120 G. 등급·직업 모두 실제 서버 추첨 결과입니다.');
  await recruit(main,true);await main.waitForTimeout(1500);await recruit(main,false);await main.waitForTimeout(1200);
  await recruit(friend,true);await recruit(friend,false);
  const mySummons=(await own(main)).self.summons;assert.equal(mySummons,2);
  await button(main,'#show-odds');assert.ok((await main.locator('.odds-table').innerText()).includes('4.5%'));
  await main.waitForTimeout(1600);await main.keyboard.press('Escape');
  checks.push({name:'실제 소환 결과·공개 확률표·개인별 자원 사용',passed:true});
  await caption(main,'04','같은 직업 세 명이면 전투가 달라진다','화상, 추가 연쇄, 공격 속도. 뽑힌 직업에 맞춰 길드 시너지를 만듭니다.');
  await play(main);await play(friend);await main.waitForTimeout(1300);
  await caption(main,'05','내 성채, 친구의 성채','클릭으로 친구 전장을 관전합니다. 관전 중에는 명령이 차단됩니다.');
  await button(main,'[data-watch="'+friendId+'"]');assert.equal(await main.locator('#summon').isDisabled(),true);
  const before=(await own(main)).self.summons;await main.keyboard.press('KeyQ');await main.waitForTimeout(600);
  assert.equal((await own(main)).self.summons,before);await button(main,'[data-watch="'+originalId+'"]');
  checks.push({name:'관전·관전 중 명령 차단·내 전장 복귀',passed:true});
  await caption(main,'06','이번 밤을 바꿀 한 가지','2·5·8웨이브에는 서로 다른 유물 세 개 중 하나를 무료로 선택합니다.');
  await untilGame(main,s=>s.players.find(p=>p.id===originalId)!.relicChoices.length>0,22000);
  const offers=(await own(main)).self.relicChoices;assert.equal(new Set(offers).size,3);
  await button(main,'#open-relics');assert.equal(await main.locator('.relic-choices [data-relic]').count(),3);
  await main.waitForTimeout(1800);await button(main,'[data-relic="'+offers[0]+'"]');
  await untilGame(friend,s=>s.players.find(p=>p.id===originalId)!.relics.includes(offers[0]));
  checks.push({name:'서버 유물 제안·실제 카드 선택·다른 브라우저 동기화',passed:true});
  await caption(main,'07','갑옷에는 충격파, 질주에는 서리','장갑병·질주병·망령을 상대하며 포격과 강화에 골드를 투자합니다.');
  await button(main,'#burst');await main.keyboard.press('Escape');assert.equal(await main.locator('.aim-banner').isVisible(),false);
  await cast(main);await untilGame(friend,s=>s.players.find(p=>p.id===originalId)!.burstReadyAt>s.time);
  checks.push({name:'포격 범위 조준·취소·발동·재사용 시간 동기화',passed:true});

  const isolatedContext=await browser.newContext({viewport:{width:390,height:844}});contexts.push(isolatedContext);
  const isolated=await isolatedContext.newPage();remember(isolated);await isolated.goto(base+'/?record=1');
  await isolated.waitForSelector('.connection.connected',{state:'attached'});assert.ok(await isolated.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await button(isolated,'#create-room');assert.notEqual((await inspect(isolated)).room!.code,code);
  await button(isolated,'#start-game');await isolated.waitForSelector('#battlefield');
  assert.ok(await isolated.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await isolatedContext.close();checks.push({name:'별도 방 1인 시작과 모바일 가로 넘침 없음',passed:true});
  let sawHazard=false,dodged=false,sawGuild=false,sawBoss=false,sawContract=false;
  let lastChapter=0,posterCaptured=false;
  const end=Date.now()+310_000;
  while(Date.now()<end){
    const value=await own(main),buddy=await own(friend);
    for(const p of value.game.players)if(p.contracts>0||p.bosses>0)sawContract=true;
    if(value.game.hazards.some(h=>h.ownerId===originalId)){
      sawHazard=true;
      if(!dodged){
        await caption(main,'08','강타 예고 · 붉은 원 밖으로','실제 보스의 공격 예고를 보고 용병을 재배치합니다.');
        dodged=await dodge(main);
      }
    }
    if(value.game.enemies.some(e=>e.kind==='boss'&&e.ownerId===originalId))sawBoss=true;
    const counts=new Map<string,number>();for(const u of value.army)counts.set(u.family,(counts.get(u.family)??0)+1);
    if([...counts.values()].some(n=>n>=3))sawGuild=true;
    if(value.game.wave>=5&&lastChapter<5){
      lastChapter=5;await caption(main,'09','보스 전리품으로 다시 한 번 승부','보스를 잡으면 골드와 무료 승부 계약서를 얻습니다. 추첨 확률은 그대로입니다.');
    }
    if(value.game.wave>=8&&lastChapter<8){
      lastChapter=8;await caption(main,'10','종탑의 마녀 · 그림자 증원','두 번째 보스는 하수인을 부릅니다. 유물과 조합이 후반 화력을 결정합니다.');
    }
    if(value.game.wave>=9&&!posterCaptured){
      await main.evaluate(()=>(window as unknown as ReviewWindow).__review.caption('','',''));
      const selected=value.army.find(d=>d.rank===Math.max(...value.army.map(u=>u.rank)))??value.army[0];
      if(selected)await selectSlot(main,selected.slot);
      await main.screenshot({path:resolve(directory,'poster.png')});posterCaptured=true;
    }
    if(value.game.wave>=12&&lastChapter<12){
      lastChapter=12;await caption(main,'11','새벽을 삼킨 자 · 마지막 습격','광폭화하는 최종 보스. 남은 포격과 화력을 모두 사용합니다.');
    }
    if(value.room!.phase==='finished')break;
    await play(main);await play(friend);
    if(value.self.status!=='active'&&buddy.self.status==='active'){
      await quickButton(main,'[data-watch="'+friendId+'"]');await play(friend);
    }
    await main.waitForTimeout(500);
  }
  const final=await own(main);assert.equal(final.room!.phase,'finished','The full real game should reach a result');
  checks.push({name:'두 플레이어의 실제 게임을 끝까지 진행하고 결과 단계 도달',passed:true});
  assert.ok(sawBoss);
  checks.push({name:'실제 개인 보스 출현과 전투 녹화',passed:true});
  if(sawHazard)checks.push({name:'실제 보스 강타 예고 표시',passed:true});
  if(dodged)checks.push({name:'보스 강타의 붉은 원에서 실제 용병 재배치',passed:true});
  if(sawGuild)checks.push({name:'실제 추첨으로 모인 직업 3명의 시너지 활성',passed:true});
  if(sawContract)checks.push({name:'실제 보스 처치와 개인 전리품 획득',passed:true});
  if(!posterCaptured){
    await main.evaluate(()=>(window as unknown as ReviewWindow).__review.caption('','',''));await main.screenshot({path:resolve(directory,'poster.png')});
  }
  const commands=await main.locator('.command-bar').boundingBox();assert.ok(commands&&commands.y+commands.height<=1080);
  checks.push({name:'PC 주요 명령과 전장·정보가 녹화 화면 안에 표시',passed:true});
  const ids=final.army.map(d=>d.id).sort();
  await main.reload();await main.waitForSelector('#battlefield');const resumed=await own(main);
  assert.equal(resumed.playerId,originalId);assert.equal(resumed.room!.code,code);assert.deepEqual(resumed.army.map(d=>d.id).sort(),ids);
  checks.push({name:'결과 화면 새로고침 시 플레이어·부대·결과 재접속 유지',passed:true});
  await caption(main,'12','다음 밤에는 또 다른 조합','한 판을 마쳤습니다. 같은 방에서 대기실로 돌아가 다시 시작할 수 있습니다.');
  await main.waitForTimeout(2400);
  await button(resumed.room!.hostId===originalId?main:friend,'#return-lobby');await main.waitForSelector('#start-game');
  assert.equal((await inspect(friend)).room!.phase,'lobby');
  checks.push({name:'한 판 종료 후 방장 대기실 복귀와 친구 화면 동기화',passed:true});
  summary={wave:final.game.wave,kills:final.self.kills,defenders:final.army.length,seconds:final.game.time};
  assert.deepEqual(errors,[]);checks.push({name:'녹화 중 두 클라이언트의 실행·콘솔 오류 없음',passed:true});
  await mainContext.close();videoPath=await video.path();
}catch(error){
  const page=contexts[0]?.pages()[0];if(page)await page.screenshot({path:resolve(directory,'failure.png')}).catch(()=>{});
  throw error;
}finally{for(const context of contexts.reverse())await context.close().catch(()=>{});await browser.close();}
await copyFile(videoPath, resolve(directory, 'nightwatch-preview.webm'));
assert.ok(typeof ffmpegPath === 'string' && ffmpegPath.length > 0, 'FFmpeg must be available in the cloud runner');
const output = resolve(directory, 'nightwatch-preview.mp4');
const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath,
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '24', '-pix_fmt', 'yuv420p',
  '-r', '30', '-movflags', '+faststart', output], { encoding: 'utf8', timeout: 180_000 });
assert.equal(result.status, 0, result.stderr);
const decoded = spawnSync(ffmpegPath, ['-v', 'error', '-i', output, '-f', 'null', '-'], { encoding: 'utf8', timeout: 120_000 });
assert.equal(decoded.status, 0, decoded.stderr);
checks.push({ name: 'MP4 인코딩과 전체 영상 디코딩 확인', passed: true });
const sheet=spawnSync(ffmpegPath,['-hide_banner','-loglevel','error','-y','-ss','26','-i',output,
  '-vf','fps=1/20,scale=480:-1,tile=3x3','-frames:v','1',resolve(directory,'combat-sheet.jpg')],{encoding:'utf8',timeout:60_000});
assert.equal(sheet.status,0,sheet.stderr);

await writeFile(resolve(directory, 'verification.json'), JSON.stringify({
  sourceCommit: process.env.GITHUB_SHA ?? null,
  repository: process.env.GITHUB_REPOSITORY ?? null,
  recordedAt: new Date().toISOString(), browser: 'Playwright Chromium',
  automatedPlayers: 2, mode: '개인 운빨 디펜스', humanPixelCharacters: true, version: '0.3', fullRun: true, playback: '실제 서버와 클라이언트의 자동 조작 녹화',
  limitation: '동일 클라우드 실행 환경에서의 검증이며 실제 인터넷 지연이나 손 조작감을 대신하지 않습니다.',
  summary, checks, chapters,
}, null, 2));
console.log(JSON.stringify({ passed: checks.length, summary, output }));
