import { FAMILIES_INFO, RARITIES, createRandom, type Family } from '../../../shared/defense.js';

export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color; ctx.beginPath();
  for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i * Math.PI / 4; const size = i % 2 ? r * 0.3 : r; ctx.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size); }
  ctx.closePath(); ctx.fill();
}
export function drawGuardian(ctx: CanvasRenderingContext2D, x: number, y: number, family: Family, rank: number, scale = 2.5, time = 0): void {
  ctx.save(); ctx.translate(Math.round(x), Math.round(y - Math.sin(time * 2.5 + x) * 1.8)); ctx.scale(scale, scale);
  const c = FAMILIES_INFO[family].color;
  ctx.fillStyle = '#102c2c'; ctx.fillRect(-7, -12, 13, 13); ctx.fillRect(-5, -15, 9, 3);
  ctx.fillStyle = '#254845'; ctx.fillRect(-5, 0, 10, 5); ctx.fillRect(-6, 5, 4, 3); ctx.fillRect(2, 5, 4, 3);
  ctx.fillStyle = c; ctx.fillRect(-5, -11, 9, 10); ctx.fillRect(-3, -14, 5, 3);
  ctx.fillStyle = '#ffe2b8'; ctx.fillRect(-3, -8, 6, 6);
  ctx.fillStyle = '#253d38'; ctx.fillRect(-2, -6, 1, 2); ctx.fillRect(2, -6, 1, 2);
  ctx.fillStyle = '#b27562'; ctx.fillRect(0, -3, 2, 1);
  ctx.fillStyle = c; ctx.fillRect(-6, 0, 12, 4);
  ctx.fillStyle = '#ffffff55'; ctx.fillRect(-4, -11, 2, 3); ctx.fillRect(-4, 0, 2, 3);
  ctx.fillStyle = '#1c4542'; ctx.fillRect(-1, 0, 2, 5);
  ctx.fillStyle = '#d9b782'; ctx.fillRect(8, -8, 2, 15);
  if (family === 'ranger') {
    ctx.fillStyle = '#d9b782'; ctx.fillRect(10, -8, 2, 2); ctx.fillRect(12, -6, 2, 9); ctx.fillRect(10, 3, 2, 2);
    ctx.fillStyle = '#dcf1c4'; ctx.fillRect(9, -6, 1, 10); ctx.fillRect(6, -2, 9, 1);
    ctx.fillStyle = '#e9efbb'; ctx.fillRect(-3, -17, 2, 6); ctx.fillRect(-1, -18, 4, 3);
  } else if (family === 'ember') {
    ctx.fillStyle = '#b96d68'; ctx.fillRect(-7, -13, 14, 3); ctx.fillRect(-5, -17, 9, 4); ctx.fillRect(-3, -21, 5, 4);
    ctx.fillStyle = '#ffe5a2'; ctx.fillRect(6, -15, 6, 6); ctx.fillRect(8, -18, 3, 6);
    ctx.fillStyle = '#ffad79'; ctx.fillRect(8, -14, 3, 4);
  } else if (family === 'frost') {
    ctx.fillStyle = '#e0f8fa'; ctx.fillRect(-6, -13, 3, 5); ctx.fillRect(2, -13, 3, 5);
    ctx.fillStyle = '#bce8f2'; ctx.fillRect(6, -16, 7, 7); ctx.fillRect(8, -19, 3, 13); ctx.fillRect(3, -13, 13, 2);
  } else {
    ctx.fillStyle = '#9d8ad1'; ctx.fillRect(-7, -13, 14, 3); ctx.fillRect(-4, -18, 8, 5); ctx.fillRect(0, -22, 4, 5);
    star(ctx, 9, -14, 5, '#f6e3ab');
  }
  if (rank > 0) {
    ctx.fillStyle = RARITIES[rank].color;
    for (let i = 0; i < rank; i++) star(ctx, (i - (rank - 1) / 2) * 5, 13, 2.4, RARITIES[rank].color);
    if (rank >= 2) { ctx.fillRect(-6, -23, 2, 4); ctx.fillRect(4, -23, 2, 4); ctx.fillRect(-4, -20, 8, 2); }
  }
  ctx.restore();
}

export function portrait(family: Family, rank = 0, size = 72): string {
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  drawGuardian(canvas.getContext('2d')!, size / 2 - 3, size * 0.69, family, rank, size / 31);
  return canvas.toDataURL();
}

export function tree(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, hue: number): void {
  ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.scale(scale, scale);
  ctx.fillStyle = '#061f24aa'; ctx.beginPath(); ctx.ellipse(3, 6, 23, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#654d3b'; ctx.fillRect(-4, -13, 9, 19); ctx.fillStyle = '#92704b'; ctx.fillRect(0, -10, 3, 15);
  const tones = hue > 0.5 ? ['#173e38', '#245341', '#336b4b', '#527f52'] : ['#153c39', '#235344', '#32694d', '#487b52'];
  const polygon = (w: number, top: number, bottom: number, color: string) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-w, bottom); ctx.lineTo(-w, bottom - 6); ctx.lineTo(-w / 2, top + 10); ctx.lineTo(-6, top + 10); ctx.lineTo(-6, top); ctx.lineTo(4, top); ctx.lineTo(w / 2, top + 15); ctx.lineTo(w, bottom - 6); ctx.lineTo(w, bottom); ctx.closePath(); ctx.fill();
  };
  polygon(30, -48, -10, tones[0]); polygon(26, -58, -23, tones[1]); polygon(21, -69, -37, tones[2]); polygon(13, -74, -51, tones[3]);
  ctx.fillStyle = '#84aa6255'; ctx.fillRect(-9, -64, 6, 4); ctx.fillRect(-16, -45, 8, 4); ctx.fillRect(-21, -29, 8, 4);
  ctx.restore();
}

export function mapArt(): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = 984; canvas.height = 716;
  const ctx = canvas.getContext('2d')!; const random = createRandom(1634);
  ctx.fillStyle = '#264f43'; ctx.fillRect(0, 0, 984, 716);
  for (let i = 0; i < 3200; i++) {
    ctx.fillStyle = ['#315e46', '#376447', '#284d40', '#426d4c'][Math.floor(random() * 4)];
    ctx.fillRect(Math.floor(random() * 246) * 4, Math.floor(random() * 179) * 4, 4 + Math.floor(random() * 3) * 4, 4);
  }
  // A shallow creek at the bottom of the clearing.
  ctx.fillStyle = '#1d4143'; ctx.fillRect(0, 650, 984, 66);
  for (let i = 0; i < 120; i++) { ctx.fillStyle = i % 3 ? '#2d5b58' : '#47766a'; ctx.fillRect(random() * 984, 653 + random() * 63, 5 + random() * 22, 2); }
  ctx.strokeStyle = '#183c35'; ctx.lineWidth = 68; ctx.strokeRect(131, 124, 722, 480);
  ctx.strokeStyle = '#527151'; ctx.lineWidth = 58; ctx.strokeRect(131, 124, 722, 480);
  ctx.strokeStyle = '#9b956a'; ctx.lineWidth = 44; ctx.strokeRect(131, 124, 722, 480);
  ctx.strokeStyle = '#b0a87b'; ctx.lineWidth = 34; ctx.strokeRect(131, 124, 722, 480);
  for (let i = 0; i < 380; i++) {
    const p = random() * 2404; const jitter = random() * 30 - 15;
    let x: number, y: number;
    if (p < 722) { x = 131 + p; y = 124 + jitter; }
    else if (p < 1202) { x = 853 + jitter; y = 124 + p - 722; }
    else if (p < 1924) { x = 853 - p + 1202; y = 604 + jitter; }
    else { x = 131 + jitter; y = 604 - p + 1924; }
    ctx.fillStyle = i % 3 ? '#c5bb8d' : '#8d8c62'; ctx.fillRect(Math.floor(x / 3) * 3, Math.floor(y / 3) * 3, 3 + Math.floor(random() * 2) * 3, 3);
  }
  ctx.fillStyle = '#112f29aa'; ctx.fillRect(218, 185, 548, 348);
  ctx.fillStyle = '#4c714e'; ctx.fillRect(226, 188, 532, 340);
  ctx.fillStyle = '#557d55'; ctx.fillRect(230, 192, 524, 330);
  for (let row = 0; row < 5; row++) for (let col = 0; col < 8; col++) {
    const x = 236 + col * 64, y = 204 + row * 64;
    ctx.fillStyle = (row + col) % 2 ? '#64855a' : '#698b5c'; ctx.fillRect(x, y, 62, 62);
    ctx.fillStyle = '#89a26935'; ctx.fillRect(x, y, 62, 2); ctx.fillRect(x, y, 2, 62);
    ctx.fillStyle = '#466b493a'; ctx.fillRect(x + 60, y, 2, 62); ctx.fillRect(x, y + 60, 62, 2);
    for (let n = 0; n < 4; n++) { ctx.fillStyle = '#a0b77925'; ctx.fillRect(x + random() * 55, y + random() * 55, 3, 3); }
    ctx.fillStyle = '#a6c48b35'; ctx.fillRect(x + 29, y + 29, 3, 3);
  }
  // Clearing ornaments: stones, flowers, mushrooms and wooden lanterns.
  for (let i = 0; i < 190; i++) {
    const x = random() * 984, y = random() * 716;
    if (x > 96 && x < 890 && y > 80 && y < 640) continue;
    ctx.fillStyle = '#1c4037'; ctx.fillRect(x, y, 9, 4);
    ctx.fillStyle = i % 4 === 0 ? '#b1bba0' : '#638b56'; ctx.fillRect(x + 2, y - 2, 5, 4);
    if (i % 5 === 0) { ctx.fillStyle = '#e2c995'; ctx.fillRect(x + 3, y - 6, 3, 3); }
  }
  for (let i = 0; i < 18; i++) { tree(ctx, 20 + i * 57 + random() * 20, 92 + random() * 8, 1.1 + random() * 0.25, random()); }
  for (let i = 0; i < 8; i++) {
    tree(ctx, 38 + random() * 12, 170 + i * 68, 1.15, random());
    tree(ctx, 945 + random() * 15, 170 + i * 68, 1.15, random());
  }
  for (const x of [184, 800]) for (const y of [181, 550]) {
    ctx.fillStyle = '#1b3b32'; ctx.fillRect(x - 7, y - 6, 14, 16);
    ctx.fillStyle = '#b69b6e'; ctx.fillRect(x - 4, y - 9, 8, 15);
    ctx.fillStyle = '#ffe7a4'; ctx.fillRect(x - 3, y - 7, 6, 6);
    const glow = ctx.createRadialGradient(x, y - 5, 0, x, y - 5, 35); glow.addColorStop(0, '#ffeaa829'); glow.addColorStop(1, '#ffeaa800'); ctx.fillStyle = glow; ctx.fillRect(x - 35, y - 40, 70, 70);
  }
  // Entry gate and small direction markers keep the track legible.
  ctx.fillStyle = '#3b4940'; ctx.fillRect(101, 87, 9, 67); ctx.fillRect(151, 87, 9, 67);
  ctx.fillStyle = '#8b7958'; ctx.fillRect(97, 80, 67, 12); ctx.fillStyle = '#d6c28d'; ctx.fillRect(103, 81, 56, 3);
  for (const [x, y, angle] of [[490, 124, 0], [853, 355, Math.PI / 2], [492, 604, Math.PI], [131, 360, -Math.PI / 2]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.strokeStyle = '#716f4d80'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(1, 0); ctx.lineTo(-5, 5); ctx.stroke(); ctx.restore();
  }
  const vignette = ctx.createRadialGradient(492, 365, 220, 492, 365, 620); vignette.addColorStop(0, '#051b2000'); vignette.addColorStop(1, '#071c2c99'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, 984, 716);
  return canvas;
}
