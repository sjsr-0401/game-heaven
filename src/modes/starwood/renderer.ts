import { BOARD, FAMILIES_INFO, GRID, RARITIES, slotPosition, trackPosition, type DefenseState, type CombatEvent } from '../../../shared/defense.js';
import type { PlayerInfo } from '../../../shared/protocol.js';
import { drawGuardian, mapArt, star } from './art.js';

export class ForestRenderer {
  selected: number | null = null;
  hoverSlot = -1;
  drag: { id: number; x: number; y: number } | null = null;
  aiming: { x: number; y: number } | null = null;
  state: DefenseState | null = null;
  players: PlayerInfo[] = [];
  private ctx: CanvasRenderingContext2D;
  private background = mapArt();
  private animation = 0;
  private lastFrame = performance.now();
  private receivedAt = performance.now();
  private seenEvents = new Set<number>();
  private effects: { event: CombatEvent; born: number }[] = [];
  private positions = new Map<number, { x: number; y: number }>();

  constructor(readonly canvas: HTMLCanvasElement, private readonly playerId: string) {
    canvas.width = BOARD.width; canvas.height = BOARD.height;
    this.ctx = canvas.getContext('2d')!;
    this.animation = requestAnimationFrame(this.frame);
  }
  update(state: DefenseState, players: PlayerInfo[]): void {
    this.state = state; this.players = players; this.receivedAt = performance.now();
    for (const event of state.events) if (!this.seenEvents.has(event.id)) {
      this.seenEvents.add(event.id); this.effects.push({ event, born: performance.now() });
    }
    if (this.seenEvents.size > 4000) this.seenEvents = new Set(state.events.map(e => e.id));
    const ids = new Set([...state.enemies, ...state.defenders].map(e => e.id));
    for (const id of this.positions.keys()) if (!ids.has(id)) this.positions.delete(id);
  }
  point(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * BOARD.width, y: (event.clientY - rect.top) / rect.height * BOARD.height };
  }
  slotAt(x: number, y: number): number {
    const col = Math.floor((x - GRID.x + 32) / GRID.step), row = Math.floor((y - GRID.y + 32) / GRID.step);
    return col >= 0 && col < GRID.cols && row >= 0 && row < GRID.rows ? row * GRID.cols + col : -1;
  }
  private smooth(id: number, target: { x: number; y: number }, dt: number): { x: number; y: number } {
    const position = this.positions.get(id) ?? { ...target };
    const mix = 1 - Math.exp(-24 * dt);
    position.x += (target.x - position.x) * mix; position.y += (target.y - position.y) * mix;
    this.positions.set(id, position); return position;
  }
  private frame = (now: number): void => {
    const dt = Math.max(0, Math.min((now - this.lastFrame) / 1000, 0.1)); this.lastFrame = now;
    const ctx = this.ctx, time = now / 1000;
    ctx.clearRect(0, 0, BOARD.width, BOARD.height); ctx.drawImage(this.background, 0, 0);
    for (let i = 0; i < 18; i++) {
      const x = (i * 157 + Math.sin(time * 0.25 + i) * 30) % 984;
      const y = 80 + ((i * 97 + time * 7) % 560);
      ctx.globalAlpha = 0.2 + (Math.sin(time * 1.6 + i) + 1) * 0.22;
      ctx.fillStyle = '#e8ffc1'; ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
    if (this.state) this.drawState(time, dt);
    this.effects = this.effects.filter(effect => now - effect.born < (effect.event.type === 'merge' ? 1700 : effect.event.type === 'wave' ? 2100 : 1100));
    for (const { event, born } of this.effects) this.drawEffect(event, Math.max(0, (now - born) / 1000), time);
    if (this.aiming) {
      ctx.fillStyle = '#d5c2ff22'; ctx.strokeStyle = '#dbc5ff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.aiming.x, this.aiming.y, 170, 0, Math.PI * 2); ctx.fill(); ctx.setLineDash([7, 7]); ctx.stroke(); ctx.setLineDash([]);
      star(ctx, this.aiming.x, this.aiming.y, 15, '#f5e8bf');
    }
    this.animation = requestAnimationFrame(this.frame);
  };
  private drawState(time: number, dt: number): void {
    const state = this.state!, ctx = this.ctx;
    const selected = state.defenders.find(d => d.id === this.selected);
    if (selected) {
      const pos = slotPosition(selected.slot), color = FAMILIES_INFO[selected.family].color;
      ctx.fillStyle = `${color}12`; ctx.strokeStyle = `${color}66`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, FAMILIES_INFO[selected.family].range, 0, Math.PI * 2); ctx.fill(); ctx.setLineDash([5, 7]); ctx.stroke(); ctx.setLineDash([]);
      for (const unit of state.defenders) if (unit.id !== selected.id && unit.ownerId === this.playerId && unit.family === selected.family && unit.rank === selected.rank && unit.rank < 3) {
        const point = slotPosition(unit.slot); ctx.strokeStyle = '#d2ef97'; ctx.lineWidth = 2;
        ctx.strokeRect(point.x - 27, point.y - 27, 54, 54); star(ctx, point.x + 23, point.y - 23, 7, '#d2ef97');
      }
    }
    if (this.hoverSlot >= 0) {
      const point = slotPosition(this.hoverSlot); ctx.fillStyle = '#ddf3c020'; ctx.fillRect(point.x - 30, point.y - 30, 60, 60);
      ctx.strokeStyle = '#d5edb84d'; ctx.lineWidth = 1; ctx.strokeRect(point.x - 30, point.y - 30, 60, 60);
    }
    const drawables: { y: number; draw(): void }[] = [];
    for (const enemy of state.enemies) {
      const delta = Math.min((performance.now() - this.receivedAt) / 1000, 0.1);
      const target = trackPosition(enemy.progress + enemy.speed * delta * (enemy.slowUntil > state.time ? 0.52 : 1));
      const point = this.smooth(enemy.id, target, dt);
      drawables.push({ y: point.y, draw: () => {
        const x = point.x, y = point.y, boss = enemy.kind === 'boss', scale = boss ? 2.4 : 1;
        ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.scale(scale, scale);
        ctx.fillStyle = '#142e2b66'; ctx.beginPath(); ctx.ellipse(0, 8, 15, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.translate(0, Math.sin(time * (boss ? 3 : 7) + enemy.id) * 1.4);
        if (boss) {
          ctx.fillStyle = '#263a33'; ctx.fillRect(-15, -21, 30, 26); ctx.fillRect(-10, -26, 20, 8);
          ctx.fillStyle = '#6d8056'; ctx.fillRect(-12, -21, 24, 24); ctx.fillStyle = '#a6a975'; ctx.fillRect(-9, -23, 18, 13);
          ctx.fillStyle = '#3f5742'; ctx.fillRect(-18, -10, 8, 17); ctx.fillRect(10, -10, 8, 17); ctx.fillRect(-9, 3, 7, 7); ctx.fillRect(3, 3, 7, 7);
          ctx.fillStyle = '#f2cc7c'; ctx.fillRect(-7, -17, 4, 4); ctx.fillRect(3, -17, 4, 4);
          ctx.fillStyle = '#759162'; ctx.fillRect(-14, -28, 4, 10); ctx.fillRect(-18, -32, 8, 4); ctx.fillRect(10, -28, 4, 10); ctx.fillRect(10, -32, 8, 4);
          ctx.fillStyle = '#bfd498'; ctx.fillRect(-4, -32, 8, 8); star(ctx, 0, -28, 4, '#f1df9a');
        } else if (enemy.kind === 'beetle') {
          ctx.fillStyle = '#273d36'; ctx.fillRect(-13, -13, 26, 18); ctx.fillStyle = '#ca9b71'; ctx.fillRect(-10, -14, 20, 16);
          ctx.fillStyle = '#e2ba81'; ctx.fillRect(-7, -15, 14, 6); ctx.fillStyle = '#715849'; ctx.fillRect(-1, -13, 2, 13);
          ctx.fillStyle = '#273b33'; ctx.fillRect(-15, -6, 5, 3); ctx.fillRect(10, -6, 5, 3); ctx.fillRect(-11, 3, 5, 4); ctx.fillRect(6, 3, 5, 4);
          ctx.fillStyle = '#fbdf99'; ctx.fillRect(-7, -8, 3, 3); ctx.fillRect(4, -8, 3, 3);
        } else {
          ctx.fillStyle = '#2b4b3e'; ctx.fillRect(-13, -12, 26, 17); ctx.fillRect(-9, -17, 18, 6);
          ctx.fillStyle = '#b6ca74'; ctx.fillRect(-10, -12, 20, 15); ctx.fillRect(-7, -16, 14, 6);
          ctx.fillStyle = '#d4df93'; ctx.fillRect(-7, -12, 5, 4); ctx.fillStyle = '#385440'; ctx.fillRect(-6, -5, 3, 3); ctx.fillRect(4, -5, 3, 3);
          ctx.fillStyle = '#64965c'; ctx.fillRect(0, -22, 3, 8); ctx.fillRect(3, -24, 6, 4);
        }
        if (enemy.slowUntil > state.time) { ctx.strokeStyle = '#acddf2aa'; ctx.lineWidth = 1.5; ctx.strokeRect(-15, -17, 30, 24); }
        ctx.restore();
        const width = boss ? 74 : 28, barY = y - (boss ? 87 : 28);
        if (enemy.hp < enemy.maxHp || boss) {
          ctx.fillStyle = '#152b2bd9'; ctx.fillRect(x - width / 2 - 1, barY - 1, width + 2, 5);
          ctx.fillStyle = boss ? '#e6a18b' : '#c5db86'; ctx.fillRect(x - width / 2, barY, width * enemy.hp / enemy.maxHp, 3);
        }
      } });
    }
    for (const unit of state.defenders) {
      if (this.drag?.id === unit.id) continue;
      const point = this.smooth(unit.id, slotPosition(unit.slot), dt);
      drawables.push({ y: point.y, draw: () => {
        const color = this.players.find(p => p.id === unit.ownerId)?.color ?? '#d8edba';
        ctx.fillStyle = '#1a3d3699'; ctx.beginPath(); ctx.ellipse(point.x, point.y + 12, 22, 9, 0, 0, Math.PI * 2); ctx.fill();
        if (unit.rank >= 1) {
          const glow = ctx.createRadialGradient(point.x, point.y, 5, point.x, point.y, 40);
          glow.addColorStop(0, `${RARITIES[unit.rank].color}44`); glow.addColorStop(1, `${RARITIES[unit.rank].color}00`); ctx.fillStyle = glow; ctx.fillRect(point.x - 40, point.y - 40, 80, 80);
        }
        ctx.strokeStyle = unit.id === this.selected ? '#e7f5b4' : `${color}99`; ctx.lineWidth = unit.id === this.selected ? 2.5 : 1.5;
        ctx.beginPath(); ctx.ellipse(point.x, point.y + 12, 22, 9, 0, 0, Math.PI * 2); ctx.stroke();
        drawGuardian(ctx, point.x, point.y - 1, unit.family, unit.rank, 2, time);
        ctx.fillStyle = color; ctx.fillRect(point.x - 3, point.y + 23, 6, 3);
      } });
    }
    drawables.sort((a, b) => a.y - b.y).forEach(drawable => drawable.draw());
    if (this.drag) {
      const unit = state.defenders.find(d => d.id === this.drag!.id);
      if (unit) { ctx.globalAlpha = 0.85; drawGuardian(ctx, this.drag.x, this.drag.y, unit.family, unit.rank, 2.2, time); ctx.globalAlpha = 1; }
    }
    if (state.phase === 'preparing') {
      ctx.fillStyle = '#142f2bda'; ctx.beginPath(); ctx.roundRect(350, 545, 284, 42, 10); ctx.fill();
      ctx.textAlign = 'center'; ctx.font = '600 14px "Malgun Gothic", sans-serif'; ctx.fillStyle = '#e0edc9';
      ctx.fillText(`숲의 문이 열립니다 · ${Math.max(1, Math.ceil(state.waveEndsAt - state.time))}`, 492, 572);
    }
  }
  private drawEffect(event: CombatEvent, age: number, time: number): void {
    const ctx = this.ctx;
    ctx.save();
    if (event.type === 'shot' && event.tx !== undefined && event.ty !== undefined) {
      const color = FAMILIES_INFO[event.family!].color;
      const travel = Math.min(age / 0.18, 1), x = event.x + (event.tx - event.x) * travel, y = event.y - 20 + (event.ty - event.y + 20) * travel;
      if (age < 0.18) {
        ctx.strokeStyle = `${color}88`; ctx.lineWidth = event.family === 'volt' ? 3 : 2; ctx.beginPath();
        const tail = Math.max(0, travel - 0.3); ctx.moveTo(event.x + (event.tx - event.x) * tail, event.y - 20 + (event.ty - event.y + 20) * tail);
        if (event.family === 'volt') ctx.lineTo((event.x + x) / 2 + 12, (event.y - 20 + y) / 2 - 8);
        ctx.lineTo(x, y); ctx.stroke(); ctx.fillStyle = color;
        ctx.fillRect(x - 3, y - 3, 6, 6); ctx.fillStyle = '#fff7d9'; ctx.fillRect(x - 1, y - 1, 2, 2);
      } else if (age < 0.55) {
        ctx.globalAlpha = 1 - (age - 0.18) / 0.37;
        const radius = event.family === 'ember' ? 12 + age * 50 : 7 + age * 15;
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(event.tx, event.ty, radius, 0, Math.PI * 2); ctx.stroke();
      }
      if (event.amount && age > 0.16 && age < 0.8) {
        ctx.globalAlpha = 1 - (age - 0.16) / 0.64; ctx.font = '700 13px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#ecedc8'; ctx.fillText(String(event.amount), event.tx, event.ty - 20 - age * 25);
      }
    } else if (event.type === 'summon' || event.type === 'merge') {
      const color = RARITIES[event.rank ?? 0].color, duration = event.type === 'merge' ? 1.5 : 0.8;
      if (age > duration) { ctx.restore(); return; }
      ctx.globalAlpha = 1 - age / duration;
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(event.x, event.y + 8, 16 + age * 35, 8 + age * 17, 0, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 10; i++) {
        const angle = i * Math.PI / 5 + time * 0.7, radius = 18 + age * 42;
        star(ctx, event.x + Math.cos(angle) * radius, event.y - 15 + Math.sin(angle) * radius * 0.7, event.type === 'merge' ? 5 : 3, color);
      }
      if (event.type === 'merge' && age < 1.5) {
        ctx.fillStyle = '#172e35ed'; ctx.beginPath(); ctx.roundRect(event.x - 105, event.y - 100 - age * 8, 210, 30, 7); ctx.fill();
        ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.font = '700 13px "Malgun Gothic", sans-serif'; ctx.fillText(event.text ?? '합성 성공!', event.x, event.y - 80 - age * 8);
      }
    } else if (event.type === 'burst') {
      const duration = 1.1; ctx.globalAlpha = Math.max(0, 1 - age / duration);
      const glow = ctx.createRadialGradient(event.x, event.y, 0, event.x, event.y, 170);
      glow.addColorStop(0, '#f1d8ff99'); glow.addColorStop(0.7, '#c5acff33'); glow.addColorStop(1, '#c5acff00'); ctx.fillStyle = glow; ctx.fillRect(event.x - 170, event.y - 170, 340, 340);
      ctx.strokeStyle = '#f8e3ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(event.x, event.y, 170 * Math.min(1, age * 3), 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 14; i++) {
        const x = event.x + Math.sin(i * 4.1) * 130, y = event.y + Math.cos(i * 2.9) * 120;
        const fall = Math.min(1, age * 3 + i * 0.01);
        ctx.strokeStyle = '#d8caff99'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 30, y - 220 * (1 - fall) - 40); ctx.lineTo(x, y - 220 * (1 - fall)); ctx.stroke(); star(ctx, x, y - 220 * (1 - fall), 7, '#fff0d5');
      }
    } else if (event.type === 'kill') {
      ctx.globalAlpha = Math.max(0, 1 - age / 0.7);
      for (let i = 0; i < 5; i++) {
        const a = i * 1.256; ctx.fillStyle = i % 2 ? '#d0db93' : '#b8e4ac'; ctx.fillRect(event.x + Math.cos(a) * age * 37, event.y + Math.sin(a) * age * 37, 4, 4);
      }
    } else if (event.type === 'wave' && age < 2) {
      ctx.globalAlpha = Math.min(1, age * 4, (2 - age) * 3);
      ctx.fillStyle = '#112d2cd9'; ctx.fillRect(300, 333, 384, 52);
      ctx.fillStyle = '#e4e8bd'; ctx.font = '700 22px "Malgun Gothic", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(event.text ?? '', 492, 367);
    } else if (event.type === 'upgrade') {
      ctx.globalAlpha = Math.max(0, 1 - age / 1.1); ctx.textAlign = 'center'; ctx.font = '700 22px "Malgun Gothic", sans-serif'; ctx.fillStyle = '#e1f6bd'; ctx.fillText(event.text ?? '', 492, 180 - age * 30);
    }
    ctx.restore();
  }
  destroy(): void { cancelAnimationFrame(this.animation); }
}
