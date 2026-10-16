import { randomInt } from 'node:crypto';
import {
  DEFENSE_ID, FAMILIES, FAMILIES_INFO, GRID, LAST_WAVE, MAX_ENEMIES, PITY_COUNT,
  RARITIES, SUMMON_COST, WAVE_SECONDS, createRandom, defenderDamage,
  slotPosition, trackPosition, upgradeCost,
  type CombatEvent, type Defender, type DefenseState, type Enemy,
} from '../../shared/defense.js';
import { isRecord, type PlayerInfo } from '../../shared/protocol.js';
import type { CommandResult, GameMode, ModeSession } from './types.js';

const fail = (error: string): CommandResult => ({ ok: false, error });
const ok: CommandResult = { ok: true };

export class StarwoodSession implements ModeSession {
  readonly state: DefenseState;
  private nextId = 1;
  private eventId = 1;
  private nextSpawn = 0;
  private lastIncome = 0;
  private readonly random: () => number;

  constructor(players: PlayerInfo[], seed = randomInt(0, 2147483647)) {
    this.random = createRandom(seed);
    this.state = {
      mode: DEFENSE_ID, time: 0, phase: 'preparing', wave: 0, waveEndsAt: 5,
      spawned: 0, bossDeadline: 0, totalKills: 0,
      players: players.map(p => ({ id: p.id, gold: 240, upgrade: 0, pity: 0,
        kills: 0, summons: 0, merges: 0, burstReadyAt: 0 })),
      defenders: [], enemies: [], events: [],
    };
    players.forEach((player, index) => {
      const base = index * 2;
      this.addDefender(player.id, 'ranger', 0, base);
      this.addDefender(player.id, 'ranger', 0, base + 1);
      this.addDefender(player.id, 'frost', 0, 24 + base);
    });
    this.state.events = [];
  }

  private event(event: Omit<CombatEvent, 'id' | 'at'>): void {
    this.state.events.push({ ...event, id: this.eventId++, at: this.state.time });
  }

  private addDefender(ownerId: string, family: Defender['family'], rank: number, slot: number): Defender {
    const unit: Defender = { id: this.nextId++, ownerId, family, rank, slot, cooldown: 0.2, kills: 0 };
    this.state.defenders.push(unit);
    this.event({ type: 'summon', ...slotPosition(slot), family, rank });
    return unit;
  }

  command(playerId: string, action: unknown): CommandResult {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return fail('참가 중인 플레이어가 아닙니다.');
    if (this.finished()) return fail('이미 종료된 게임입니다.');
    if (!isRecord(action)) return fail('올바르지 않은 명령입니다.');
    if (action.kind === 'summon') {
      if (player.gold < SUMMON_COST) return fail('별조각이 부족해요.');
      if (this.state.defenders.filter(d => d.ownerId === playerId).length >= 10) return fail('내 수호자는 최대 10명입니다. 합성해 자리를 만들어 주세요.');
      const occupied = new Set(this.state.defenders.map(d => d.slot));
      let slot = -1;
      if (action.slot !== undefined) {
        if (!this.validSlot(action.slot) || occupied.has(action.slot)) return fail('빈 소환 자리를 선택해 주세요.');
        slot = action.slot;
      } else {
        for (let i = 0; i < GRID.cols * GRID.rows; i++) if (!occupied.has(i)) { slot = i; break; }
      }
      if (slot < 0) return fail('소환할 빈자리가 없어요.');
      let rank = 0;
      const roll = this.random();
      let cumulative = 0;
      for (let i = 0; i < RARITIES.length; i++) {
        cumulative += RARITIES[i].chance;
        if (roll < cumulative) { rank = i; break; }
      }
      if (player.pity >= PITY_COUNT - 1 && rank < 1) rank = 1;
      player.pity = rank >= 1 ? 0 : player.pity + 1;
      player.gold -= SUMMON_COST;
      player.summons++;
      this.addDefender(playerId, FAMILIES[Math.floor(this.random() * FAMILIES.length)], rank, slot);
      return ok;
    }
    if (action.kind === 'upgrade') {
      if (player.upgrade >= 10) return fail('최대 강화에 도달했어요.');
      const price = upgradeCost(player.upgrade);
      if (player.gold < price) return fail('강화할 별조각이 부족해요.');
      player.gold -= price;
      player.upgrade++;
      this.event({ type: 'upgrade', x: 492, y: 350, text: `공격력 +${player.upgrade * 15}%` });
      return ok;
    }
    if (action.kind === 'burst') {
      if (this.state.phase !== 'battle') return fail('전투가 시작되면 사용할 수 있어요.');
      if (this.state.time < player.burstReadyAt) return fail('별비를 충전하고 있어요.');
      if (typeof action.x !== 'number' || typeof action.y !== 'number'
        || !Number.isFinite(action.x) || !Number.isFinite(action.y)
        || action.x < 0 || action.x > 984 || action.y < 0 || action.y > 716) return fail('전장 안을 선택해 주세요.');
      player.burstReadyAt = this.state.time + 25;
      this.event({ type: 'burst', x: action.x, y: action.y });
      for (const enemy of [...this.state.enemies]) {
        const p = trackPosition(enemy.progress);
        if (Math.hypot(p.x - action.x, p.y - action.y) < 170) this.damage(enemy, 110 + 22 * this.state.wave, playerId);
      }
      return ok;
    }
    if (action.kind === 'move' || action.kind === 'merge') {
      const unit = this.state.defenders.find(d => d.id === action.defenderId);
      if (!unit || unit.ownerId !== playerId) return fail('내 수호자만 조작할 수 있어요.');
      if (action.kind === 'move') {
        if (!this.validSlot(action.slot)) return fail('배치 가능한 칸을 선택해 주세요.');
        const other = this.state.defenders.find(d => d.slot === action.slot);
        if (other && other.ownerId !== playerId) return fail('친구가 사용 중인 자리예요.');
        const oldSlot = unit.slot;
        unit.slot = action.slot;
        if (other) other.slot = oldSlot;
        return ok;
      }
      const target = this.state.defenders.find(d => d.id === action.targetId);
      if (!target || target.id === unit.id || target.ownerId !== playerId
        || target.family !== unit.family || target.rank !== unit.rank) return fail('같은 종류·등급의 내 수호자 두 명이 필요해요.');
      if (unit.rank >= RARITIES.length - 1) return fail('전설은 더 합성할 수 없어요.');
      unit.rank++;
      unit.kills += target.kills;
      unit.cooldown = 0;
      this.state.defenders.splice(this.state.defenders.indexOf(target), 1);
      player.merges++;
      this.event({ type: 'merge', ...slotPosition(unit.slot), family: unit.family, rank: unit.rank,
        text: `${RARITIES[unit.rank].name} · ${FAMILIES_INFO[unit.family].name}` });
      return ok;
    }
    return fail('지원하지 않는 명령입니다.');
  }

  private validSlot(slot: unknown): slot is number {
    return typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < GRID.cols * GRID.rows;
  }

  private beginWave(): void {
    this.state.wave++;
    this.state.phase = 'battle';
    this.state.waveEndsAt = this.state.time + WAVE_SECONDS;
    this.state.spawned = 0;
    this.nextSpawn = this.state.time + 0.5;
    this.state.players.forEach(p => { p.gold += 45; });
    this.event({ type: 'wave', x: 492, y: 354,
      text: this.state.wave % 4 === 0 ? `WAVE ${this.state.wave} · 숲의 파수꾼` : `WAVE ${this.state.wave}` });
  }

  private spawnCount(): number { return 8 + this.state.wave * 2 + (this.state.players.length - 1) * 4; }

  private spawnEnemy(): void {
    const boss = this.state.wave % 4 === 0 && this.state.spawned === 0;
    const hp = Math.round((boss ? 1500 : 70) * 1.3 ** (this.state.wave - 1) * (1 + (this.state.players.length - 1) * 0.48));
    this.state.enemies.push({ id: this.nextId++, progress: 0, hp, maxHp: hp,
      speed: boss ? 37 : 59 + this.state.wave * 3,
      kind: boss ? 'boss' : this.state.wave % 2 === 0 ? 'beetle' : 'sprout', slowUntil: 0 });
    if (boss) this.state.bossDeadline = this.state.time + 38;
    this.state.spawned++;
  }

  private damage(enemy: Enemy, amount: number, ownerId: string): void {
    if (enemy.hp <= 0) return;
    enemy.hp = Math.max(0, enemy.hp - amount);
    if (enemy.hp === 0) {
      this.state.totalKills++;
      const killer = this.state.players.find(p => p.id === ownerId);
      if (killer) killer.kills++;
      this.state.players.forEach(p => { p.gold += enemy.kind === 'boss' ? 70 : 3; });
      this.event({ type: 'kill', ...trackPosition(enemy.progress), amount: enemy.kind === 'boss' ? 70 : 3 });
    }
  }

  tick(dt: number): void {
    if (this.finished() || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1);
    this.state.time += dt;
    this.state.events = this.state.events.filter(e => this.state.time - e.at < 1.8);
    if (this.state.time - this.lastIncome >= 5) {
      this.state.players.forEach(p => { p.gold += 5; });
      this.lastIncome = this.state.time;
    }
    if (this.state.time >= this.state.waveEndsAt && this.state.wave < LAST_WAVE) this.beginWave();
    if (this.state.phase === 'preparing') return;
    if (this.state.time >= this.nextSpawn && this.state.spawned < this.spawnCount()) {
      this.spawnEnemy();
      this.nextSpawn += 0.7;
    }
    for (const enemy of this.state.enemies) enemy.progress += enemy.speed * dt * (enemy.slowUntil > this.state.time ? 0.52 : 1);
    for (const unit of this.state.defenders) {
      unit.cooldown -= dt;
      if (unit.cooldown > 0) continue;
      const origin = slotPosition(unit.slot);
      const info = FAMILIES_INFO[unit.family];
      const targets = this.state.enemies.filter(e => e.hp > 0 && Math.hypot(trackPosition(e.progress).x - origin.x,
        trackPosition(e.progress).y - origin.y) <= info.range).sort((a, b) => b.progress - a.progress);
      const target = targets[0];
      if (!target) continue;
      const point = trackPosition(target.progress);
      const owner = this.state.players.find(p => p.id === unit.ownerId)!;
      const damage = defenderDamage(unit, owner.upgrade);
      unit.cooldown = info.interval;
      this.event({ type: 'shot', ...origin, tx: point.x, ty: point.y, family: unit.family, rank: unit.rank, amount: damage });
      if (unit.family === 'ember') {
        for (const enemy of targets) {
          const position = trackPosition(enemy.progress);
          if (Math.hypot(position.x - point.x, position.y - point.y) <= 75) this.damage(enemy, damage, unit.ownerId);
        }
      } else if (unit.family === 'volt') {
        targets.slice(0, 3).forEach((enemy, index) => {
          const destination = trackPosition(enemy.progress);
          if (index) this.event({ type: 'shot', x: point.x, y: point.y, tx: destination.x,
            ty: destination.y, family: unit.family, rank: unit.rank });
          this.damage(enemy, Math.round(damage * (index ? 0.55 : 1)), unit.ownerId);
        });
      } else {
        this.damage(target, damage, unit.ownerId);
        if (unit.family === 'frost') target.slowUntil = this.state.time + 1.4;
      }
    }
    this.state.enemies = this.state.enemies.filter(e => e.hp > 0);
    const boss = this.state.enemies.some(e => e.kind === 'boss');
    if (!boss) this.state.bossDeadline = 0;
    if (this.state.enemies.length >= MAX_ENEMIES || (boss && this.state.time >= this.state.bossDeadline)) this.state.phase = 'defeat';
    else if (this.state.wave === LAST_WAVE && this.state.spawned >= this.spawnCount() && this.state.enemies.length === 0) this.state.phase = 'victory';
  }

  playerLeft(playerId: string): void {
    // Explicit departure releases cells; a disconnected player keeps their army during the grace period.
    this.state.defenders = this.state.defenders.filter(d => d.ownerId !== playerId);
    this.state.players = this.state.players.filter(p => p.id !== playerId);
  }
  snapshot(): DefenseState { return this.state; }
  finished(): boolean { return this.state.phase === 'victory' || this.state.phase === 'defeat'; }
}

export const starwoodMode: GameMode = {
  id: DEFENSE_ID, title: '별숲 수호대', subtitle: '운을 모으고, 함께 숲을 지켜요', minPlayers: 1, maxPlayers: 4,
  create: (players, seed) => new StarwoodSession(players, seed),
};
