import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer } from 'ws';
import { RoomHub } from './rooms.js';
import { modes } from './modes/registry.js';

const production = process.env.NODE_ENV === 'production' || import.meta.url.includes('dist-server');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const dist = resolve('dist');
const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webm': 'video/webm', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary', '.json': 'application/json; charset=utf-8', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const hub = new RoomHub(modes);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: hub.roomCount, version: '1.0.0' })); return; }
    if (url.pathname === '/api/modes') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(hub.modeList())); return; }
    if (!production) { vite!.middlewares(req, res); return; }
    let filename = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (filename !== dist && !filename.startsWith(dist + sep)) { res.writeHead(403); res.end(); return; }
    if (url.pathname === '/') filename = resolve(dist, 'index.html');
    try { if (!(await stat(filename)).isFile()) throw new Error('Not a file'); }
    catch { res.writeHead(404); res.end('Not found'); return; }
    const file = await readFile(filename);
    res.writeHead(200, { 'Content-Type': contentTypes[extname(filename)] ?? 'application/octet-stream',
      'Cache-Control': filename.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff' });
    res.end(file);
  } catch { res.writeHead(500); res.end('Server error'); }
});
const vite = production ? null : await (await import('vite')).createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192 });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') {
    if (production) socket.destroy();
    return;
  }
  if (req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return; } }
    catch { socket.destroy(); return; }
  }
  sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
});
const alive = new WeakSet<WebSocket>();
sockets.on('connection', ws => {
  const id = randomUUID();
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  hub.connect({ id, send: message => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1024 * 1024) ws.send(JSON.stringify(message));
    else if (ws.bufferedAmount >= 1024 * 1024) ws.terminate();
  }, close: () => ws.close(4001, 'Session resumed elsewhere') });
  ws.on('message', data => {
    try { hub.receive(id, JSON.parse(data.toString())); }
    catch { ws.send(JSON.stringify({ type: 'error', message: '메시지를 읽을 수 없어요.' })); }
  });
  ws.on('close', () => hub.disconnect(id));
  ws.on('error', () => hub.disconnect(id));
});
let previous = performance.now();
let accumulator = 0;
let broadcastAccumulator = 0;
const loop = setInterval(() => {
  const now = performance.now();
  accumulator += Math.min((now - previous) / 1000, 0.2);
  previous = now;
  while (accumulator >= 1 / 30) { hub.tick(1 / 30); accumulator -= 1 / 30; broadcastAccumulator += 1 / 30; }
  if (broadcastAccumulator >= 1 / 15) { hub.broadcastAll(); broadcastAccumulator = 0; }
}, 1000 / 60);
const heartbeat = setInterval(() => {
  for (const ws of sockets.clients) { if (!alive.has(ws)) { ws.terminate(); continue; } alive.delete(ws); ws.ping(); }
}, 15_000);
server.listen(port, host, () => console.log(`집째로 도망 · http://localhost:${port} (${production ? 'production' : 'development'})`));
function shutdown(): void {
  clearInterval(loop); clearInterval(heartbeat);
  for (const ws of sockets.clients) ws.close(1001, 'Server shutting down');
  sockets.close(); server.close(); void vite?.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
