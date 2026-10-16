import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { chromium, type Page, type BrowserContext } from 'playwright';
import { BOARD, slotPosition, trackPosition, type DefenseState, type Defender } from '../shared/defense.js';
import type { RoomSnapshot } from '../shared/protocol.js';

interface Inspection { room: RoomSnapshot | null; playerId: string }
interface ReviewWindow extends Window {
  __review: { snapshot(): Inspection; caption(number: string, title: string, text: string): void };
}
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
async function recruit(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const value = await inspect(page);
    const own = value.game.players.find(p => p.id === value.playerId)!;
    if (own.gold < 40 || value.game.defenders.filter(d => d.ownerId === value.playerId).length >= 10) return;
    await button(page, '#summon');
  }
}
async function mergePair(page: Page): Promise<boolean> {
  const value = await inspect(page);
  const own = value.game.defenders.filter(d => d.ownerId === value.playerId && d.rank < 3);
  let pair: Defender | undefined;
  const unit = own.find(a => { pair = own.find(b => a.id !== b.id && a.family === b.family && a.rank === b.rank); return !!pair; });
  if (!unit || !pair) return false;
  await selectSlot(page, unit.slot);
  await button(page, '[data-merge]:not(:disabled)');
  return true;
}
async function burst(page: Page): Promise<void> {
  const value = await inspect(page);
  const own = value.game.players.find(p => p.id === value.playerId)!;
  if (own.burstReadyAt > value.game.time || !value.game.enemies.length || value.game.phase !== 'battle') return;
  const boss = value.game.enemies.find(e => e.kind === 'boss');
  const target = trackPosition((boss ?? value.game.enemies[0]).progress);
  await button(page, '#burst');
  const p = await fieldPoint(page, target.x, target.y);
  await page.mouse.move(p.x, p.y, { steps: 24 });
  await page.waitForTimeout(600);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(700);
}
function remember(page: Page): void {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
}
try {
  const mainContext = await browser.newContext({
    viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1,
    recordVideo: { dir: resolve(directory, 'raw'), size: { width: 1440, height: 1080 } },
  });
  contexts.push(mainContext);
  const main = await mainContext.newPage(); remember(main);
  const video = main.video(); assert.ok(video);
  await main.goto(base + '/?record=1');
  await main.waitForSelector('.connection.connected');
  await main.evaluate(() => document.fonts.ready);
  await main.locator('#nickname').fill('숲지기');
  await caption(main, '01', '친구들과 같은 방으로', '닉네임과 방 코드로 모여요. 설치 없이 함께할 준비.');
  await main.waitForTimeout(1200);
  await button(main, '#create-room');
  const first = await inspect(main);
  const code = first.room!.code;
  const originalId = first.playerId;

  const friendContext = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  contexts.push(friendContext);
  const friend = await friendContext.newPage(); remember(friend);
  await friend.goto(base + '/?record=1&room=' + code);
  await friend.waitForSelector('.connection.connected');
  await friend.locator('#nickname').fill('달팽이');
  await button(friend, '#join-room');
  assert.equal((await inspect(friend)).room!.code, code);
  await main.waitForFunction(() => (window as unknown as ReviewWindow).__review.snapshot().room?.players.length === 2);
  checks.push({ name: '서로 다른 브라우저의 방 코드 입장', passed: true });
  await main.waitForTimeout(1100);
  await button(friend, '#start-game');
  await button(main, '#start-game');
  await main.waitForSelector('#battlefield');
  await friend.waitForSelector('#battlefield');
  assert.equal((await inspect(main)).room!.phase, 'playing');
  assert.equal((await inspect(friend)).room!.phase, 'playing');
  checks.push({ name: '준비 상태와 방장 시작 동기화', passed: true });

  await caption(main, '02', '선택하면 사거리가 보여요', '내 수호자를 클릭해 역할과 공격 범위를 확인합니다.');
  const ownUnit = (await inspect(main)).game.defenders.find(d => d.ownerId === originalId)!;
  await selectSlot(main, ownUnit.slot);
  await main.waitForTimeout(1500);
  await caption(main, '03', '끌어서 빈틈을 메우기', '드래그로 재배치. 친구의 수호자는 친구가 지휘해요.');
  const from = slotPosition(ownUnit.slot), to = slotPosition(9);
  const a = await fieldPoint(main, from.x, from.y), b = await fieldPoint(main, to.x, to.y);
  await main.mouse.move(a.x, a.y, { steps: 12 });
  await main.mouse.down();
  await main.mouse.move(b.x, b.y, { steps: 35 });
  await main.waitForTimeout(300);
  await main.mouse.up();
  await untilGame(main, state => state.defenders.find(d => d.id === ownUnit.id)?.slot === 9);
  await untilGame(friend, state => state.defenders.find(d => d.id === ownUnit.id)?.slot === 9);
  checks.push({ name: '실제 드래그 명령과 상대 브라우저의 배치 동기화', passed: true });
  await main.waitForTimeout(1200);

  await caption(main, '04', '둘을 모아 더 강한 하나로', '같은 종류와 등급의 수호자 2명을 합성합니다.');
  const countBefore = (await inspect(main)).game.defenders.length;
  await button(main, '[data-merge]:not(:disabled)');
  await untilGame(main, state => state.defenders.length === countBefore - 1);
  await untilGame(friend, state => state.defenders.find(d => d.id === ownUnit.id)?.rank === 1);
  checks.push({ name: '합성의 실제 소비·등급 상승과 상태 동기화', passed: true });
  await main.waitForTimeout(1700);

  await caption(main, '05', '이번에는 누가 나올까?', '각자의 별조각으로 소환. 네 가지 역할이 함께 숲을 지켜요.');
  await recruit(main, 5);
  await mergePair(friend);
  await recruit(friend, 4);
  await main.waitForTimeout(1600);
  await untilGame(main, state => state.totalKills > 0, 15_000);
  checks.push({ name: '서버 전투·처치·자원 보상 진행', passed: true });

  await caption(main, '06', '운에 성장을 더하기', '내 수호자 전체를 강화하고, 전투 중에도 배치를 바꿉니다.');
  await untilGame(main, state => state.players.find(p => p.id === originalId)!.gold >= 80, 15_000);
  await button(main, '#upgrade');
  await untilGame(friend, state => state.players.find(p => p.id === originalId)!.upgrade === 1);
  checks.push({ name: '강화 비용과 공격력 단계 동기화', passed: true });
  await main.waitForTimeout(1700);

  await caption(main, '07', '위급할 땐, 별비 한 번', '범위를 확인하고 클릭. ESC로 조준을 취소할 수도 있어요.');
  await untilGame(main, state => state.enemies.length > 0, 10_000);
  await button(main, '#burst');
  await main.keyboard.press('Escape');
  assert.equal(await main.locator('.aim-banner').isVisible(), false);
  await burst(main);
  await untilGame(friend, state => state.players.find(p => p.id === originalId)!.burstReadyAt > state.time);
  checks.push({ name: '스킬 조준·취소·실제 발동·재사용 대기시간', passed: true });
  await main.waitForTimeout(1400);

  const isolatedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(isolatedContext);
  const isolated = await isolatedContext.newPage(); remember(isolated);
  await isolated.goto(base + '/?record=1');
  await isolated.waitForSelector('.connection.connected');
  const size = await isolated.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(size.width <= size.viewport + 1, 'Mobile entry should not overflow horizontally');
  await isolated.locator('#nickname').fill('다른 원정대');
  await button(isolated, '#create-room');
  const separate = await inspect(isolated);
  assert.notEqual(separate.room!.code, code);
  assert.equal(separate.room!.players.length, 1);
  assert.equal((await inspect(main)).room!.players.length, 2);
  checks.push({ name: '방 격리와 좁은 화면의 대기실 배치', passed: true });
  await isolatedContext.close();

  while ((await inspect(main)).game.time < 65.5) {
    const current = await inspect(main);
    assert.equal(current.room!.phase, 'playing');
    if (current.game.players.find(p => p.id === originalId)!.gold >= 40) {
      await mergePair(main);
      await recruit(main, 1);
    }
    const buddy = await inspect(friend);
    if (buddy.game.players.find(p => p.id === buddy.playerId)!.gold >= 40) {
      await mergePair(friend);
      await recruit(friend, 1);
    }
    await main.waitForTimeout(1700);
  }
  await caption(main, '08', '큰 녀석은 함께 막아요', '같은 전장, 각자의 수호자. 보스가 오면 지원 스킬을 모으세요.');
  await untilGame(main, state => state.enemies.some(e => e.kind === 'boss'), 10_000);
  await burst(main);
  await burst(friend);
  await main.waitForTimeout(5000);
  await main.evaluate(() => (window as unknown as ReviewWindow).__review.caption('', '', ''));
  const active = await inspect(main);
  const guardian = active.game.defenders.find(d => d.ownerId === originalId)!;
  await selectSlot(main, guardian.slot);
  await main.screenshot({ path: resolve(directory, 'poster.png') });
  assert.equal(await main.locator('#summon').isVisible(), true);
  const commands = await main.locator('.command-bar').boundingBox();
  assert.ok(commands && commands.y + commands.height <= 1080, 'All primary commands should fit the recorded viewport');
  checks.push({ name: '전장·선택 정보·주요 명령이 한 화면에 표시', passed: true });

  await caption(main, '09', '다시 연결해도, 원정은 계속', '새로고침 후 같은 플레이어와 수호자로 복귀합니다.');
  const defendersBefore = active.game.defenders.filter(d => d.ownerId === originalId).map(d => d.id).sort();
  await main.reload();
  await main.waitForSelector('#battlefield');
  const resumed = await inspect(main);
  assert.equal(resumed.playerId, originalId);
  assert.deepEqual(resumed.game.defenders.filter(d => d.ownerId === originalId).map(d => d.id).sort(), defendersBefore);
  assert.equal(resumed.room!.code, code);
  await untilGame(friend, state => state.players.some(p => p.id === originalId));
  checks.push({ name: '새로고침 재접속 시 플레이어·수호자·방 유지', passed: true });
  await main.evaluate(() => (window as unknown as ReviewWindow).__review.caption('09', '다시 연결해도, 원정은 계속', '재접속 완료. 내 수호자와 진행 상태가 그대로 남아 있어요.'));
  await main.waitForTimeout(3200);
  const final = await inspect(main);
  summary = { wave: final.game.wave, kills: final.game.totalKills, defenders: final.game.defenders.length, seconds: final.game.time };
  assert.deepEqual(errors, [], 'No browser runtime or console errors');
  checks.push({ name: '두 클라이언트의 브라우저 실행 오류 없음', passed: true });
  await mainContext.close();
  videoPath = await video.path();
} finally {
  for (const context of contexts.reverse()) await context.close().catch(() => {});
  await browser.close();
}
await copyFile(videoPath, resolve(directory, 'starwood-preview.webm'));
assert.ok(ffmpegPath, 'FFmpeg must be available in the cloud runner');
const output = resolve(directory, 'starwood-preview.mp4');
const result = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath,
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '24', '-pix_fmt', 'yuv420p',
  '-r', '30', '-movflags', '+faststart', output], { encoding: 'utf8', timeout: 180_000 });
assert.equal(result.status, 0, result.stderr);
const decoded = spawnSync(ffmpegPath, ['-v', 'error', '-i', output, '-f', 'null', '-'], { encoding: 'utf8', timeout: 120_000 });
assert.equal(decoded.status, 0, decoded.stderr);
checks.push({ name: 'MP4 인코딩과 전체 영상 디코딩 확인', passed: true });
await writeFile(resolve(directory, 'verification.json'), JSON.stringify({
  sourceCommit: process.env.GITHUB_SHA ?? null,
  repository: process.env.GITHUB_REPOSITORY ?? null,
  recordedAt: new Date().toISOString(), browser: 'Playwright Chromium',
  automatedPlayers: 2, playback: '실제 서버와 클라이언트의 자동 조작 녹화',
  limitation: '동일 클라우드 실행 환경에서의 검증이며 실제 인터넷 지연이나 손 조작감을 대신하지 않습니다.',
  summary, checks, chapters,
}, null, 2));
console.log(JSON.stringify({ passed: checks.length, summary, output }));
