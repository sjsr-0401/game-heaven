import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const metadata = JSON.parse(await readFile('artifacts/verification.json', 'utf8'));
const mp4 = await readFile('artifacts/houseflight-preview.mp4');
const poster = await readFile('artifacts/poster.png');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const template = await readFile('scripts/review-template.html', 'utf8');
const commit = metadata.sourceCommit ?? 'local';
const repo = metadata.repository ?? 'sjsr-0401/game-heaven';
const chapters = metadata.chapters.map((chapter, index) =>
  '<button class="chapter" data-time="' + chapter.seconds.toFixed(2) + '"><span>' + String(index + 1).padStart(2, '0')
  + '</span><div><b>' + escape(chapter.title) + '</b><p>' + escape(chapter.description) + '</p></div><small>'
  + Math.floor(chapter.seconds / 60) + ':' + String(Math.floor(chapter.seconds % 60)).padStart(2, '0') + '</small></button>').join('');
const checks = metadata.checks.map(check => '<li><span>' + (check.passed ? '✓' : '×') + '</span>' + escape(check.name) + '</li>').join('');
const html = template.replaceAll('__VIDEO__', 'data:video/mp4;base64,' + mp4.toString('base64'))
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
