import { FAMILIES_INFO, RARITIES, createRandom, type Family } from '../../../shared/defense.js';

export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color; ctx.beginPath();
  for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i * Math.PI / 4; const size = i % 2 ? r * 0.25 : r; ctx.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size); }
  ctx.closePath(); ctx.fill();
}

// Original human pixel figures. Coordinates are whole pixels; every pose shares the same skeleton.
export function drawGuardian(ctx: CanvasRenderingContext2D, x: number, y: number, family: Family, rank: number, scale = 2, time = 0, attack = 0, facing = 1): void {
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y)); ctx.scale(scale * facing, scale);
  const pixel = (color: string, a: number, b: number, w: number, h: number) => { ctx.fillStyle = color; ctx.fillRect(Math.round(a), Math.round(b), w, h); };
  const info = FAMILIES_INFO[family], accent = rank >= 2 ? RARITIES[rank].color : info.color;
  const dark = '#111725', skin = family === 'volt' ? '#b98568' : '#edbc92', skinLight = family === 'volt' ? '#e4b08c' : '#ffe0b1';
  const hair = { ranger: '#70503d', ember: '#bc6250', frost: '#b9c8d6', volt: '#202b43' }[family];
  const coat = { ranger: '#736454', ember: '#a7473d', frost: '#557a9a', volt: '#625084' }[family];
  const light = { ranger: '#ac9370', ember: '#db7960', frost: '#9cbdc9', volt: '#9983b7' }[family];
  const breathe = Math.floor(Math.sin(time * 3 + x) * 0.65);
  // Cloak silhouette, separate boots, knees and belt keep the figure recognisably human.
  pixel(dark, -8, -22 + breathe, 15, 19);
  pixel(coat, -9, -20 + breathe, 5, 17); pixel(coat, 4, -20 + breathe, 5, 17);
  pixel(light, -9, -19 + breathe, 2, 10); pixel('#292536', -7, -6, 15, 3);
  pixel(dark, -6, -7, 6, 9); pixel(dark, 2, -7, 6, 9);
  pixel('#3d4558', -5, -7, 4, 6); pixel('#596071', 3, -7, 3, 5);
  pixel('#1a1e2b', -7, 0, 7, 4); pixel('#1a1e2b', 2, 0, 8, 4);
  pixel('#8e795c', -6, 0, 5, 1); pixel('#8e795c', 3, 0, 5, 1);
  pixel(coat, -6, -23 + breathe, 13, 15); pixel(light, -4, -22 + breathe, 4, 10);
  pixel('#e4c28d', -5, -10, 12, 2); pixel('#483b3c', -1, -11, 3, 4);
  // Neck, jaw, ears, nose, eyes, highlights and individual hair clumps.
  pixel(dark, -6, -34 + breathe, 13, 13); pixel(hair, -5, -35 + breathe, 11, 6);
  pixel(skin, -4, -29 + breathe, 10, 7); pixel(skinLight, 0, -29 + breathe, 6, 5);
  pixel(skin, -6, -28 + breathe, 2, 4); pixel('#ad765e', -4, -23 + breathe, 8, 2);
  pixel('#111c2d', -1, -28 + breathe, 2, 2); pixel('#111c2d', 4, -28 + breathe, 2, 2);
  pixel('#fff0d0', 0, -28 + breathe, 1, 1); pixel(skinLight, 5, -26 + breathe, 3, 2);
  pixel('#9b6553', 3, -23 + breathe, 3, 1); pixel(skin, -1, -22 + breathe, 5, 3);
  pixel(hair, -6, -33 + breathe, 3, 7); pixel(hair, -3, -35 + breathe, 8, 5);
  pixel(family === 'frost' ? '#edf0df' : '#d99e68', -3, -34 + breathe, 4, 1);
  // Distinct headwear and armour, without hiding the human face.
  if (family === 'ranger') {
    pixel('#3e3840', -8, -32 + breathe, 16, 2); pixel('#7c6651', -5, -37 + breathe, 11, 5);
    pixel('#c5aa78', -5, -33 + breathe, 11, 1); pixel(accent, -7, -23, 5, 4);
    pixel('#2f3541', 3, -20, 5, 9); pixel('#d9c794', 4, -19, 3, 1);
  } else if (family === 'ember') {
    pixel('#57373d', -6, -32 + breathe, 13, 3); pixel('#d2ad7a', -5, -31 + breathe, 4, 2);
    pixel('#c5d6bf', -4, -31 + breathe, 2, 1); pixel('#d2ad7a', 2, -31 + breathe, 4, 2);
    pixel('#784331', -7, -20, 3, 10); pixel('#ffa86c', -7, -17, 3, 4);
    pixel('#9bdcd6', -8, -16, 3, 3); pixel('#e3d5ab', -8, -17, 3, 1);
  } else if (family === 'frost') {
    pixel('#cbd6d4', -8, -23, 6, 5); pixel('#7394a3', -8, -18, 5, 2);
    pixel('#d9e5df', 4, -23, 6, 5); pixel('#30455f', -2, -21, 7, 10);
    pixel(accent, 0, -21, 2, 8); pixel('#d3e3db', -7, -12, 3, 5);
    pixel(hair, -6, -32, 3, 13);
  } else {
    pixel('#322a4c', -7, -37 + breathe, 14, 7); pixel('#aa8bc3', -8, -32 + breathe, 16, 2);
    pixel(accent, -2, -37 + breathe, 4, 3); pixel('#d2bb86', -4, -21, 9, 2);
    pixel('#382e55', -1, -18, 5, 10); pixel(accent, 0, -17, 2, 3);
  }
  // Forearm follows a compact attack/recoil pose.
  const recoil = attack > 0 ? -Math.round(Math.sin(attack * Math.PI) * 3) : 0;
  pixel(dark, 5 + recoil, -21, 6, 8); pixel(coat, 5 + recoil, -20, 5, 6);
  pixel(skin, 7 + recoil, -16, 5, 3); pixel(skinLight, 8 + recoil, -16, 3, 1);
  if (family === 'ranger') {
    pixel('#19202c', 7 + recoil, -19, 19, 5); pixel('#7f8589', 11 + recoil, -19, 15, 2);
    pixel('#c6beb1', 19 + recoil, -19, 7, 1); pixel('#a57b51', 7 + recoil, -17, 8, 3);
    pixel('#212436', 15 + recoil, -22, 5, 3); pixel('#d2b476', 15 + recoil, -22, 4, 1);
    if (attack > 0.5) star(ctx, 29 + recoil, -18, 8 * attack, '#ffe2a4');
  } else if (family === 'ember') {
    pixel('#242638', 10 + recoil, -17, 12, 7); pixel('#af7c55', 12 + recoil, -16, 11, 4);
    pixel('#e1b788', 15 + recoil, -17, 6, 2); pixel('#492e35', 22 + recoil, -15, 3, 3);
    pixel('#b3c7bb', 13 + recoil, -23, 6, 6); pixel('#ed8a52', 14 + recoil, -21, 4, 4);
  } else if (family === 'frost') {
    ctx.save(); ctx.translate(10, -15); ctx.rotate(-0.8 + attack * 1.8);
    pixel('#e3c28a', -2, -3, 4, 11); pixel('#4a5770', -6, -4, 12, 3);
    pixel('#9ec8df', -2, -25, 4, 21); pixel('#ebf6ea', -1, -26, 2, 21); pixel('#537d9c', 2, -22, 1, 16); ctx.restore();
  } else {
    pixel('#2c263e', 12, -29, 4, 32); pixel('#b39463', 13, -27, 2, 28);
    pixel('#e7d6a9', 10, -30, 8, 3); star(ctx, 14, -32, 6 + Math.sin(time * 5), accent);
  }
  if (rank > 0) {
    pixel(accent, -9, -21, 2, 4); pixel(accent, 7, -21, 2, 4);
    for (let i = 0; i < rank; i++) pixel(accent, -rank * 2 + i * 4, 7, 3, 2);
  }
  ctx.restore();
}
export function portrait(family: Family, rank = 0, size = 88): string {
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  drawGuardian(canvas.getContext('2d')!, size * 0.39, size * 0.85, family, rank, size / 47);
  return canvas.toDataURL();
}

export function mapArt(): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = 984; canvas.height = 716;
  const ctx = canvas.getContext('2d')!, random = createRandom(2749);
  ctx.imageSmoothingEnabled = false;
  const rect = (c: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(x), Math.floor(y), w, h); };
  rect('#171d2a', 0, 0, 984, 716);
  // Broken slate, staggered masonry and moss. The combat route is a lighter worn road.
  for (let row = 0; row < 24; row++) for (let col = 0; col < 29; col++) {
    const x = col * 36 + row % 2 * 18 - 18, y = row * 30;
    rect(['#252c39','#29303d','#232a36','#303643'][Math.floor(random()*4)], x + 1, y + 1, 34, 28);
    rect('#3a404b', x + 2, y + 1, 31, 1); rect('#131b26', x + 2, y + 28, 32, 2);
    for(let n=0;n<3;n++) rect('#45505a44',x+random()*30,y+random()*24,3+Math.floor(random()*3),1);
  }
  ctx.strokeStyle='#0c1323';ctx.lineWidth=76;ctx.strokeRect(131,124,722,480);
  ctx.strokeStyle='#5a5460';ctx.lineWidth=64;ctx.strokeRect(131,124,722,480);
  ctx.strokeStyle='#77717a';ctx.lineWidth=56;ctx.strokeRect(131,124,722,480);
  ctx.strokeStyle='#565561';ctx.lineWidth=48;ctx.strokeRect(131,124,722,480);
  for(let i=0;i<600;i++){
    const p=random()*2404,j=random()*42-21;let x:number,y:number;
    if(p<722){x=131+p;y=124+j;}else if(p<1202){x=853+j;y=124+p-722;}else if(p<1924){x=853-p+1202;y=604+j;}else{x=131+j;y=604-p+1924;}
    rect(i%3?'#89818a55':'#373b4d99',Math.floor(x/3)*3,Math.floor(y/3)*3,3+Math.floor(random()*4)*3,2);
  }
  // Raised courtyard with chipped borders and sparse, subtle deployment marks.
  rect('#111825',220,181,548,355);rect('#454653',224,182,536,346);rect('#212a39',230,190,524,336);
  for(let r=0;r<5;r++)for(let c=0;c<8;c++){
    const x=236+c*64,y=204+r*64;
    rect((r+c)%2?'#2d3747':'#313b4a',x,y,62,62);rect('#435061',x,y,62,2);rect('#192332',x,y+60,62,2);
    rect('#596273',x+29,y+28,4,4);
    for(let n=0;n<7;n++)rect(n%3?'#64707b22':'#1d2937',x+random()*58,y+random()*57,2+Math.floor(random()*4),1);
  }
  // Perimeter walls have thickness, crenellations, buttresses and hanging banners.
  for(let x=0;x<984;x+=48){
    rect('#0c1220',x,42,46,36);rect('#3e4352',x+1,44,44,28);rect('#626170',x+2,44,42,3);
    rect('#232a3c',x+5,57,35,2);rect('#535364',x+7,28,30,18);rect('#747080',x+7,28,30,3);
  }
  for(const x of [32,900]){
    for(let y=166;y<630;y+=68){
      rect('#101624',x,y,45,61);rect('#454554',x+3,y,39,54);rect('#72707a',x+4,y,37,4);
      rect('#252e40',x+10,y+8,25,38);rect('#8c5355',x+16,y+13,13,23);rect('#c59470',x+21,y+15,3,16);
    }
  }
  // Gatehouse, stained banner, broken columns and discarded supplies.
  rect('#111625',93,75,77,80);rect('#615c67',94,73,17,80);rect('#615c67',153,73,17,80);
  rect('#8f8790',92,71,80,10);rect('#242435',114,83,38,30);
  for(let x=116;x<152;x+=7)rect('#98909a',x,84,3,30);
  rect('#8b4c52',454,55,74,44);rect('#c49c71',460,55,62,3);star(ctx,491,75,12,'#d4b67f');
  for(const [x,y] of [[190,250],[790,452],[275,660],[730,666]]){
    rect('#0d1523',x-13,y,29,9);rect('#6f6d76',x-10,y-23,23,25);rect('#9a9191',x-12,y-26,27,5);
    rect('#42475a',x-5,y-20,3,21);rect('#42475a',x+6,y-20,2,21);rect('#b3a197',x-10,y-25,20,2);
  }
  for(let i=0;i<90;i++){
    const x=random()*984,y=650+random()*55;
    rect(i%2?'#64616c':'#41485b',x,y,4+Math.floor(random()*6),3);
  }
  for(const x of [190,790])for(const y of [174,552]){
    rect('#101624',x-7,y-8,14,19);rect('#777079',x-5,y-12,10,17);rect('#b89b6d',x-4,y-10,8,5);
    rect('#ffce7e',x-3,y-17,6,9);rect('#fff0b4',x-1,y-19,2,10);
    const glow=ctx.createRadialGradient(x,y-12,1,x,y-12,75);glow.addColorStop(0,'#ffb35e40');glow.addColorStop(1,'#ffb35e00');ctx.fillStyle=glow;ctx.fillRect(x-75,y-87,150,150);
  }
  for(const [x,y,a] of [[490,124,0],[853,355,Math.PI/2],[492,604,Math.PI],[131,360,-Math.PI/2]]){
    ctx.save();ctx.translate(x,y);ctx.rotate(a);ctx.strokeStyle='#b2a29477';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-5,-5);ctx.lineTo(1,0);ctx.lineTo(-5,5);ctx.stroke();ctx.restore();
  }
  const vignette=ctx.createRadialGradient(492,350,240,492,350,620);
  vignette.addColorStop(0,'#07102500');vignette.addColorStop(1,'#040a18bb');ctx.fillStyle=vignette;ctx.fillRect(0,0,984,716);
  return canvas;
}
