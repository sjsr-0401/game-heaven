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
  const point = slotPosition(slot), target = await fieldPoint(page, point.x, point.y);
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

async function recruit(page:Page,wager=false):Promise<void>{
  const value=await inspect(page),own=value.game.players.find(p=>p.id===value.playerId)!;
  if(own.status!=='active'||own.gold<(wager?120:40)||value.game.defenders.filter(d=>d.ownerId===value.playerId).length>=16)return;
  await button(page,wager?'#wager':'#summon');
}
async function burst(page:Page):Promise<void>{
  const value=await inspect(page),own=value.game.players.find(p=>p.id===value.playerId)!;
  const enemies=value.game.enemies.filter(e=>e.ownerId===value.playerId);
  if(own.status!=='active'||own.burstReadyAt>value.game.time||!enemies.length||value.game.phase!=='battle')return;
  const target=trackPosition((enemies.find(e=>e.kind==='boss')??enemies[0]).progress);
  await button(page,'#burst');const p=await fieldPoint(page,target.x,target.y);
  await page.mouse.move(p.x,p.y,{steps:24});await page.waitForTimeout(350);await page.mouse.click(p.x,p.y);await page.waitForTimeout(650);
}
function remember(page:Page):void{
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
}
try{
  const mainContext=await browser.newContext({viewport:{width:1440,height:1080},deviceScaleFactor:1,recordVideo:{dir:resolve(directory,'raw'),size:{width:1440,height:1080}}});
  contexts.push(mainContext);const main=await mainContext.newPage();remember(main);
  const video=main.video();assert.ok(video);
  await main.goto(base+'/?record=1');await main.waitForSelector('.connection.connected',{state:'attached'});
  await main.evaluate(()=>document.fonts.ready);
  await main.locator('#nickname').fill('까마귀');
  await caption(main,'01','밤의 용병단 · 사람형 도트 개인전','각자의 전장과 골드. 친구들과 같은 방에서 운을 겨룹니다.');
  await main.waitForTimeout(1400);await button(main,'#create-room');
  const first=await inspect(main),code=first.room!.code,originalId=first.playerId;
  const friendContext=await browser.newContext({viewport:{width:1440,height:1080}});contexts.push(friendContext);
  const friend=await friendContext.newPage();remember(friend);
  await friend.goto(base+'/?record=1&room='+code);await friend.waitForSelector('.connection.connected',{state:'attached'});
  await friend.locator('#nickname').fill('밤손님');await button(friend,'#join-room');
  const friendId=(await inspect(friend)).playerId;assert.equal((await inspect(friend)).room!.code,code);
  await button(friend,'#start-game');await button(main,'#start-game');await main.waitForSelector('#battlefield');await friend.waitForSelector('#battlefield');
  checks.push({name:'독립 브라우저 2개가 방 코드로 입장하고 준비·시작 동기화',passed:true});
  let current=await inspect(main);
  const own=current.game.defenders.filter(d=>d.ownerId===originalId),other=current.game.defenders.filter(d=>d.ownerId===friendId);
  assert.equal(own.length,4);assert.equal(other.length,4);assert.deepEqual(own.map(d=>d.slot),other.map(d=>d.slot));
  checks.push({name:'동일한 배치 좌표를 사용하는 개인별 용병 부대',passed:true});
  await button(main,'#sound-toggle');
  assert.equal(await main.locator('#sound-toggle').getAttribute('aria-label'),'효과음 끄기');
  checks.push({name:'사용자 클릭으로 효과음 활성화 후 전투 실행 오류 없음',passed:true});

  await caption(main,'02','작은 도형 대신, 사람형 용병','사수·연금술사·검사·술사. 얼굴과 장비, 역할을 구분합니다.');
  await selectSlot(main,own[0].slot);await main.waitForTimeout(1800);
  await caption(main,'03','끌어서 배치하고, 전열 바꾸기','같은 칸의 친구 용병은 친구의 독립 전장에 남습니다.');
  const from=slotPosition(own[0].slot),to=slotPosition(9),a=await fieldPoint(main,from.x,from.y),b=await fieldPoint(main,to.x,to.y);
  await main.mouse.move(a.x,a.y,{steps:12});await main.mouse.down();await main.mouse.move(b.x,b.y,{steps:35});await main.waitForTimeout(250);await main.mouse.up();
  await untilGame(friend,state=>state.defenders.find(d=>d.id===own[0].id)?.slot===9);
  assert.equal((await inspect(friend)).game.defenders.find(d=>d.id===other[0].id)!.slot,other[0].slot);
  checks.push({name:'드래그 명령 동기화와 다른 플레이어 배치 보존',passed:true});
  // Put the rifleman back on the north approach through an actual right click.
  const back=await fieldPoint(main,from.x,from.y);await main.mouse.click(back.x,back.y,{button:'right'});
  await untilGame(main,state=>state.defenders.find(d=>d.id===own[0].id)?.slot===own[0].slot);

  await caption(main,'04','120 골드, 한 번의 승부','승부 소환도 일반이 나옵니다. 등급과 직업은 실제 서버 추첨 결과.');
  const before=(await inspect(main)).game.players.find(p=>p.id===originalId)!.summons;
  await recruit(main,true);await main.waitForTimeout(1200);await recruit(main,true);await main.waitForTimeout(1200);
  await recruit(main,false);await recruit(main,false);
  await recruit(friend,true);await recruit(friend,false);await recruit(friend,false);
  await untilGame(friend,state=>state.players.find(p=>p.id===originalId)!.summons>=before+4);
  checks.push({name:'일반·승부 소환의 서버 추첨과 개인별 부대 동기화',passed:true});
  await button(main,'#show-odds');
  assert.equal(await main.locator('.odds-dialog').isVisible(),true);
  assert.ok((await main.locator('.odds-table').innerText()).includes('0.1%'));
  await main.waitForTimeout(1700);await main.keyboard.press('Escape');
  checks.push({name:'일반·승부 5등급 확률표 열기와 닫기',passed:true});

  await caption(main,'05','총격, 화염, 검기, 번개','반동·피격 반응·치명타·파편이 공격마다 다르게 반응합니다.');
  await untilGame(main,state=>state.players.every(p=>p.kills>0),15000);
  const inBattle=(await inspect(main)).game;
  assert.ok(inBattle.enemies.every(e=>e.ownerId===originalId||e.ownerId===friendId));
  checks.push({name:'각자 전장에서 실제 몬스터·처치·보상 진행',passed:true});
  await selectSlot(main,6);await main.waitForTimeout(1800);

  await caption(main,'06','친구 전장은 클릭 한 번으로','관전 중에는 내 소환과 포격이 비활성화됩니다.');
  await button(main,'[data-watch="'+friendId+'"]');
  assert.ok((await main.locator('#board-name').innerText()).includes('밤손님'));
  assert.equal(await main.locator('#summon').isDisabled(),true);
  const countBefore=(await inspect(main)).game.players.find(p=>p.id===originalId)!.summons;
  await main.keyboard.press('KeyQ');await main.waitForTimeout(1200);
  assert.equal((await inspect(main)).game.players.find(p=>p.id===originalId)!.summons,countBefore);
  await button(main,'[data-watch="'+originalId+'"]');
  checks.push({name:'친구 전장 관전·명령 차단·내 전장 복귀',passed:true});

  await caption(main,'07','운을 뽑고, 화력을 키우기','전원 강화는 내 용병에게만 적용됩니다. 합성은 없습니다.');
  await untilGame(main,state=>state.players.find(p=>p.id===originalId)!.gold>=100,15000);
  const buddyUpgrade=(await inspect(main)).game.players.find(p=>p.id===friendId)!.upgrade;
  await button(main,'#upgrade');await untilGame(friend,state=>state.players.find(p=>p.id===originalId)!.upgrade===1);
  assert.equal((await inspect(friend)).game.players.find(p=>p.id===friendId)!.upgrade,buddyUpgrade);
  checks.push({name:'개인 강화 동기화와 친구 강화 단계 보존',passed:true});

  await caption(main,'08','위급한 순간, 지원 포격','범위를 확인하고 클릭. 폭발과 파편으로 타격을 표현합니다.');
  await untilGame(main,state=>state.enemies.some(e=>e.ownerId===originalId),10000);
  await button(main,'#burst');await main.keyboard.press('Escape');assert.equal(await main.locator('.aim-banner').isVisible(),false);
  await burst(main);await untilGame(friend,state=>state.players.find(p=>p.id===originalId)!.burstReadyAt>state.time);
  checks.push({name:'포격 조준·취소·발동·개인 재사용 대기시간',passed:true});

  const isolatedContext=await browser.newContext({viewport:{width:390,height:844}});contexts.push(isolatedContext);
  const isolated=await isolatedContext.newPage();remember(isolated);await isolated.goto(base+'/?record=1');
  await isolated.waitForSelector('.connection.connected',{state:'attached'});
  assert.ok(await isolated.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await button(isolated,'#create-room');assert.notEqual((await inspect(isolated)).room!.code,code);
  await button(isolated,'#start-game');await isolated.waitForSelector('#battlefield');
  assert.ok(await isolated.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.equal((await inspect(main)).room!.players.length,2);
  checks.push({name:'다른 방의 1인 시작과 모바일 대기실·전장 가로 넘침 없음',passed:true});
  await isolatedContext.close();

  await caption(main,'09','필요한 용병만 남기기','일반 용병을 해고하고 새로운 소환에 골드를 투자합니다.');
  let target=(await inspect(main)).game.defenders.find(d=>d.ownerId===originalId&&d.rank===0)!;
  await selectSlot(main,target.slot);await button(main,'[data-dismiss]');
  await untilGame(friend,state=>!state.defenders.some(d=>d.id===target.id));
  checks.push({name:'선택 용병 해고와 상대 브라우저의 상태 동기화',passed:true});
  await recruit(main,false);
  while((await inspect(main)).game.time<78){
    for(const page of [main,friend]){
      const value=await inspect(page),self=value.game.players.find(p=>p.id===value.playerId)!;
      if(self.status!=='active')continue;
      const count=value.game.defenders.filter(d=>d.ownerId===value.playerId).length;
      if(count<12)await recruit(page,self.gold>=200);
      else if(self.gold>=100+self.upgrade*70&&self.upgrade<3)await button(page,'#upgrade');
    }
    await main.waitForTimeout(1200);
  }
  await caption(main,'10','다섯 번째 습격 · 철갑 사령관','보스도 전장마다 따로 등장합니다. 내 화력으로 제한 시간 안에 처치.');
  await untilGame(main,state=>state.enemies.some(e=>e.kind==='boss'&&e.ownerId===originalId),12000);
  await burst(main);await burst(friend);await main.waitForTimeout(2200);
  checks.push({name:'5웨이브의 개인 보스 출현과 실제 전투 녹화',passed:true});
  await main.evaluate(()=>(window as unknown as ReviewWindow).__review.caption('','',''));
  const active=await inspect(main),guardian=active.game.defenders.find(d=>d.ownerId===originalId)!;
  await selectSlot(main,guardian.slot);await main.waitForTimeout(400);
  await main.screenshot({path:resolve(directory,'poster.png')});
  const commands=await main.locator('.command-bar').boundingBox();assert.ok(commands&&commands.y+commands.height<=1080);
  checks.push({name:'PC에서 전장·선택 정보·주요 명령이 한 화면에 표시',passed:true});

  await caption(main,'11','다시 연결해도 내 부대 그대로','새로고침 후 같은 플레이어와 개인 전장으로 복귀합니다.');
  const ids=active.game.defenders.filter(d=>d.ownerId===originalId).map(d=>d.id).sort();
  await main.reload();await main.waitForSelector('#battlefield');const resumed=await inspect(main);
  assert.equal(resumed.playerId,originalId);assert.equal(resumed.room!.code,code);
  assert.deepEqual(resumed.game.defenders.filter(d=>d.ownerId===originalId).map(d=>d.id).sort(),ids);
  checks.push({name:'새로고침 재접속 시 플레이어·방·개인 용병 유지',passed:true});
  await main.evaluate(()=>(window as unknown as ReviewWindow).__review.caption('11','내 전장으로 복귀 완료','게임 뼈대는 유지하고 모드와 그래픽을 교체한 실제 클라이언트입니다.'));
  await main.waitForTimeout(3500);
  const final=await inspect(main);
  summary={wave:final.game.wave,kills:final.game.players.find(p=>p.id===originalId)!.kills,defenders:final.game.defenders.filter(d=>d.ownerId===originalId).length,seconds:final.game.time};
  assert.deepEqual(errors,[]);checks.push({name:'두 브라우저의 클라이언트 실행 오류 없음',passed:true});
  await mainContext.close();videoPath=await video.path();
}catch(error){
  const failedPage=contexts[0]?.pages()[0];if(failedPage)await failedPage.screenshot({path:resolve(directory,'failure.png')}).catch(()=>{});
  throw error;
}finally{
  for(const context of contexts.reverse())await context.close().catch(()=>{});
  await browser.close();
}
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
  '-vf','fps=1/4,scale=480:-1,tile=3x3','-frames:v','1',resolve(directory,'combat-sheet.jpg')],{encoding:'utf8',timeout:60_000});
assert.equal(sheet.status,0,sheet.stderr);

await writeFile(resolve(directory, 'verification.json'), JSON.stringify({
  sourceCommit: process.env.GITHUB_SHA ?? null,
  repository: process.env.GITHUB_REPOSITORY ?? null,
  recordedAt: new Date().toISOString(), browser: 'Playwright Chromium',
  automatedPlayers: 2, mode: '개인 운빨 디펜스', humanPixelCharacters: true, playback: '실제 서버와 클라이언트의 자동 조작 녹화',
  limitation: '동일 클라우드 실행 환경에서의 검증이며 실제 인터넷 지연이나 손 조작감을 대신하지 않습니다.',
  summary, checks, chapters,
}, null, 2));
console.log(JSON.stringify({ passed: checks.length, summary, output }));
