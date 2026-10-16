import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const metadata = JSON.parse(await readFile('artifacts/verification.json', 'utf8'));
const mp4 = await readFile('artifacts/houseflight-preview.mp4');
const poster = await readFile('artifacts/poster.png');
const font = await readFile('public/art/fonts/DoHyeon-Regular.ttf');
const fontLicense = await readFile('public/art/fonts/OFL.txt','utf8');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const template = await readFile('scripts/review-template.html', 'utf8');
const commit = metadata.sourceCommit ?? 'local';
const repo = metadata.repository ?? 'sjsr-0401/game-heaven';
const chapters = metadata.chapters.map((chapter, index) =>
  '<button class="chapter" data-time="' + chapter.seconds.toFixed(2) + '"><span>' + String(index + 1).padStart(2, '0')
  + '</span><div><b>' + escape(chapter.title) + '</b><p>' + escape(chapter.description) + '</p></div><small>'
  + Math.floor(chapter.seconds / 60) + ':' + String(Math.floor(chapter.seconds % 60)).padStart(2, '0') + '</small></button>').join('');
const checks = metadata.checks.map(check => '<li><span>' + (check.passed ? '✓' : '×') + '</span>' + escape(check.name) + '</li>').join('');
const recorded = metadata.twoPlayerMetrics ?? metadata.metrics;
const quality = {standard:'표준',high:'고화질',economy:'절전'}[recorded?.quality] ?? '기본';
const seconds = metadata.summary?.seconds ?? 0;
const won = metadata.fullRun && metadata.summary?.phase === 'won';
const html = template.replaceAll('__FONT__','data:font/ttf;base64,'+font.toString('base64')).replaceAll('__FONT_LICENSE__',escape(fontLicense))
  .replaceAll('__STATUS__',won?'2인 탈출 성공':'실행 검토본')
  .replaceAll('__RUN_DESCRIPTION__',won?'2인 원정의 시작부터 보스 처치·탈출, 그리고 4인 동시 플레이를 녹화했습니다.':'실제 서버와 브라우저로 조작한 2인·4인 플레이 장면입니다.')
  .replaceAll('__MATCH_STATS__','검토한 원정 '+Math.floor(seconds/60)+'분 '+Math.floor(seconds%60)+'초 · '+Math.round(metadata.summary?.distance ?? 0)+'m 주행')
  .replaceAll('__RECORDING_NOTE__','클라우드 녹화 · '+quality+' · 전장 평균 약 '+(recorded?.fps ?? '?')+'fps · 속도 1배')
  .replaceAll('__VIDEO__', 'data:video/mp4;base64,' + mp4.toString('base64'))
  .replaceAll('__POSTER__', 'data:image/png;base64,' + poster.toString('base64'))
  .replaceAll('__CHAPTERS__', chapters).replaceAll('__CHECKS__', checks)
  .replaceAll('__COMMIT__', escape(commit.slice(0, 7)))
  .replaceAll('__COMMIT_URL__', 'https://github.com/' + escape(repo) + '/commit/' + escape(commit))
  .replaceAll('__COUNT__', String(metadata.checks.length));
const output = resolve('artifacts/review.html');
await writeFile(output, html);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(output).href);
  const video = page.locator('video');
  assert.ok((await page.locator('#download-video').getAttribute('href'))?.startsWith('data:video/mp4;base64,'), 'Download must use the embedded video');
  await video.evaluate(video => new Promise((resolve, reject) => {
    if (video.readyState >= 1) { resolve(true); return; }
    video.addEventListener('loadedmetadata', () => resolve(true), { once: true });
    video.addEventListener('error', () => reject(new Error('Embedded video failed to load')), { once: true });
  }));
  const duration = await video.evaluate(video => video.duration);
  assert.ok(Number.isFinite(duration) && duration > 60);
  await video.evaluate(async video => { video.muted = true; await video.play(); });
  await page.waitForTimeout(600);
  const current = await video.evaluate(video => video.currentTime);
  assert.ok(current > 0, 'Standalone HTML must play the embedded MP4 without a server');
  await video.evaluate(video => video.pause());
  await page.locator('.chapter').last().click();
  await page.waitForTimeout(300);
  assert.ok(await video.evaluate(video => video.currentTime > 5), 'Chapter buttons should seek');
  await page.screenshot({ path: 'artifacts/review-page.png', fullPage: true });
  assert.deepEqual(errors, []);
  metadata.reviewHtml = { standalone: true, embeddedVideo: true, durationSeconds: duration, playbackVerified: true, chapterSeekVerified: true };
  await writeFile('artifacts/verification.json', JSON.stringify(metadata, null, 2));
  console.log(JSON.stringify({ html: output, megabytes: +(Buffer.byteLength(html) / 1024 / 1024).toFixed(2), durationSeconds: duration }));
} finally {
  await browser.close();
}
