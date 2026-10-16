import { randomInt } from 'node:crypto';
import {
  BOARD, DEFENSE_ID, FAMILIES, FAMILIES_INFO, GRID, LAST_WAVE, MAX_ENEMIES, MAX_DEFENDERS,
  RARITIES, SUMMON_COST, WAGER_COST, WAVE_SECONDS, createRandom, defenderDamage,
  dismissValue, rollRank, slotPosition, trackPosition, upgradeCost,
  type CombatEvent, type Defender, type DefensePlayer, type DefenseState, type Enemy,
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
      mode: DEFENSE_ID, time: 0, phase: 'preparing', wave: 0, waveEndsAt: 6,
      spawned: 0, bossDeadlines: {},
      players: players.map(p => ({ id: p.id, gold: 520, upgrade: 0,
        kills: 0, summons: 0, wagers: 0, bestRank: 0, burstReadyAt: 0,
        status: 'active', endedAt: 0, reason: '' })),
      defenders: [], enemies: [], events: [],
    };
    for (const player of players) {
      FAMILIES.forEach((family, i) => this.addDefender(player.id, family, 0, [1, 6, 32, 38][i]));
    }
    this.state.events = [];
  }

  private event(event: Omit<CombatEvent, 'id' | 'at'>): void {
    this.state.events.push({ ...event, id: this.eventId++, at: this.state.time });
  }
  private addDefender(ownerId: string, family: Defender['family'], rank: number, slot: number): Defender {
    const unit: Defender = { id: this.nextId++, ownerId, family, rank, slot, cooldown: 0.1, kills: 0 };
    this.state.defenders.push(unit);
    this.event({ type: 'summon', ownerId, ...slotPosition(slot), family, rank,
      text: RARITIES[rank].name + ' · ' + FAMILIES_INFO[family].name });
    return unit;
  }
  command(playerId: string, action: unknown): CommandResult {
    const player = this.state.players.find(p => p.id === playerId);
    if (!player) return fail('참가 중인 플레이어가 아닙니다.');
    if (this.finished() || player.status !== 'active') return fail('내 전투가 종료됐어요. 친구 전장을 관전해 보세요.');
    if (!isRecord(action)) return fail('올바르지 않은 명령입니다.');
    if (action.kind === 'summon') {
      if (action.wager !== undefined && typeof action.wager !== 'boolean') return fail('올바르지 않은 소환 방식입니다.');
      const wager = action.wager === true, cost = wager ? WAGER_COST : SUMMON_COST;
      if (player.gold < cost) return fail('골드가 부족해요.');
      const army = this.state.defenders.filter(d => d.ownerId === playerId);
      if (army.length >= MAX_DEFENDERS) return fail('용병은 최대 16명입니다. 해고하면 자리를 만들 수 있어요.');
      const occupied = new Set(army.map(d => d.slot));
      let slot = -1;
      if (action.slot !== undefined) {
        if (!this.validSlot(action.slot) || occupied.has(action.slot)) return fail('빈 배치 칸을 선택해 주세요.');
        slot = action.slot;
      } else {
        // Spread automatic recruits around the track before filling the centre.
        const preferred = [0, 7, 8, 15, 24, 31, 39, 33, 2, 5, 34, 37, 16, 23, 3, 4];
        slot = preferred.find(i => !occupied.has(i)) ?? Array.from({ length: 40 }, (_, i) => i).find(i => !occupied.has(i)) ?? -1;
      }
      if (slot < 0) return fail('소환할 빈자리가 없어요.');
      const rank = rollRank(this.random(), wager);
      const family = FAMILIES[Math.floor(this.random() * FAMILIES.length)];
      player.gold -= cost; player.summons++; if (wager) player.wagers++;
      player.bestRank = Math.max(player.bestRank, rank);
      this.addDefender(playerId, family, rank, slot);
      return ok;
    }
    if (action.kind === 'upgrade') {
      if (player.upgrade >= 8) return fail('최대 강화에 도달했어요.');
      const cost = upgradeCost(player.upgrade);
      if (player.gold < cost) return fail('강화할 골드가 부족해요.');
      player.gold -= cost; player.upgrade++;
      this.event({ type: 'upgrade', ownerId: playerId, x: 492, y: 350, text: '전원 공격력 +' + player.upgrade * 18 + '%' });
      return ok;
    }
    if (action.kind === 'burst') {
      if (this.state.phase !== 'battle') return fail('전투가 시작되면 사용할 수 있어요.');
      if (this.state.time < player.burstReadyAt) return fail('포격을 준비하고 있어요.');
      if (typeof action.x !== 'number' || typeof action.y !== 'number'
        || !Number.isFinite(action.x) || !Number.isFinite(action.y)
        || action.x < 0 || action.x > BOARD.width || action.y < 0 || action.y > BOARD.height) return fail('전장 안을 선택해 주세요.');
      player.burstReadyAt = this.state.time + 28;
      this.event({ type: 'burst', ownerId: playerId, x: action.x, y: action.y });
      for (const enemy of this.state.enemies.filter(e => e.ownerId === playerId && e.hp > 0)) {
        const p = trackPosition(enemy.progress);
        if (Math.hypot(p.x - action.x, p.y - action.y) <= 165) this.damage(enemy, 180 + 35 * this.state.wave, undefined, false, 'ember');
      }
      return ok;
    }
    if (action.kind === 'move' || action.kind === 'dismiss') {
      const unit = this.state.defenders.find(d => d.id === action.defenderId && d.ownerId === playerId);
      if (!unit) return fail('내 용병만 지휘할 수 있어요.');
      if (action.kind === 'dismiss') {
        player.gold += dismissValue(unit.rank);
        this.state.defenders.splice(this.state.defenders.indexOf(unit), 1);
        return ok;
      }
      if (!this.validSlot(action.slot)) return fail('배치 가능한 칸을 선택해 주세요.');
      const other = this.state.defenders.find(d => d.ownerId === playerId && d.slot === action.slot);
      const old = unit.slot; unit.slot = action.slot; if (other) other.slot = old;
      return ok;
    }
    return fail('지원하지 않는 명령입니다.');
  }
  private validSlot(slot: unknown): slot is number {
    return typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < GRID.cols * GRID.rows;
  }
  private active(): DefensePlayer[] { return this.state.players.filter(p => p.status === 'active'); }
  private end(player: DefensePlayer, status: 'victory' | 'defeat', reason: string): void {
    player.status = status; player.endedAt = this.state.time; player.reason = reason;
  }
  private beginWave(): void {
    this.state.wave++; this.state.phase = 'battle';
    this.state.waveEndsAt = this.state.time + WAVE_SECONDS; this.state.spawned = 0;
    this.nextSpawn = this.state.time + 0.5;
    for (const player of this.active()) {
      player.gold += 70;
      this.event({ type: 'wave', ownerId: player.id, x: 492, y: 354,
        text: this.state.wave % 5 === 0 ? 'WAVE ' + this.state.wave + ' · 철갑 사령관' : 'WAVE ' + this.state.wave });
    }
  }
  private spawnCount(): number { return 10 + this.state.wave * 2; }
  private spawnEnemy(): void {
    const boss = this.state.wave % 5 === 0 && this.state.spawned === 0;
    const hp = Math.round((boss ? 2100 : 100) * 1.38 ** (this.state.wave - 1));
    for (const player of this.active()) {
      this.state.enemies.push({ id: this.nextId++, ownerId: player.id, progress: 0, hp, maxHp: hp,
        speed: boss ? 42 : 77 + this.state.wave * 3, kind: boss ? 'boss' : this.state.wave % 2 === 0 ? 'brute' : 'raider', slowUntil: 0 });
      if (boss) this.state.bossDeadlines[player.id] = this.state.time + 34;
    }
    this.state.spawned++;
  }
  private damage(enemy: Enemy, amount: number, unit?: Defender, critical = false, family?: Defender['family']): void {
    if (enemy.hp <= 0) return;
    enemy.hp = Math.max(0, enemy.hp - amount);
    this.event({ type: 'hit', ownerId: enemy.ownerId, ...trackPosition(enemy.progress),
      targetId: enemy.id, family, amount, critical });
    if (enemy.hp === 0) {
      const player = this.state.players.find(p => p.id === enemy.ownerId)!;
      player.kills++; player.gold += enemy.kind === 'boss' ? 100 : 5;
      if (unit) unit.kills++;
      this.event({ type: 'kill', ownerId: enemy.ownerId, ...trackPosition(enemy.progress), targetId: enemy.id });
    }
  }
  tick(dt: number): void {
    if (this.finished() || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1); this.state.time += dt;
    this.state.events = this.state.events.filter(e => this.state.time - e.at < 2);
    if (this.state.time - this.lastIncome >= 5) {
      this.active().forEach(p => { p.gold += 8; }); this.lastIncome = this.state.time;
    }
    if (this.state.time >= this.state.waveEndsAt && this.state.wave < LAST_WAVE) this.beginWave();
    if (this.state.phase === 'preparing') return;
    if (this.state.time >= this.nextSpawn && this.state.spawned < this.spawnCount()) { this.spawnEnemy(); this.nextSpawn += 0.55; }
    const activeIds = new Set(this.active().map(p => p.id));
    for (const enemy of this.state.enemies) if (activeIds.has(enemy.ownerId)) enemy.progress += enemy.speed * dt * (enemy.slowUntil > this.state.time ? 0.55 : 1);
    for (const unit of this.state.defenders) {
      if (!activeIds.has(unit.ownerId)) continue;
      unit.cooldown -= dt; if (unit.cooldown > 0) continue;
      const origin = slotPosition(unit.slot), info = FAMILIES_INFO[unit.family];
      const targets = this.state.enemies.filter(e => e.ownerId === unit.ownerId && e.hp > 0
        && Math.hypot(trackPosition(e.progress).x - origin.x, trackPosition(e.progress).y - origin.y) <= info.range)
        .sort((a, b) => b.progress - a.progress);
      const target = targets[0]; if (!target) continue;
      const point = trackPosition(target.progress), owner = this.state.players.find(p => p.id === unit.ownerId)!;
      const critical = this.random() < 0.12;
      const damage = Math.round(defenderDamage(unit, owner.upgrade) * (critical ? 1.8 : 1));
      unit.cooldown = info.interval / (1 + unit.rank * 0.06);
      this.event({ type: 'shot', ownerId: unit.ownerId, unitId: unit.id, targetId: target.id,
        ...origin, tx: point.x, ty: point.y, family: unit.family, rank: unit.rank, critical });
      if (unit.family === 'ember') {
        for (const enemy of targets) {
          const p = trackPosition(enemy.progress);
          if (Math.hypot(p.x - point.x, p.y - point.y) <= 80) this.damage(enemy, damage, unit, critical, unit.family);
        }
      } else if (unit.family === 'volt') {
        targets.slice(0, 3).forEach((enemy, index) => {
          const dest = trackPosition(enemy.progress);
          if (index) this.event({ type: 'shot', ownerId: unit.ownerId, x: point.x, y: point.y,
            tx: dest.x, ty: dest.y, family: unit.family, rank: unit.rank, critical });
          this.damage(enemy, Math.round(damage * (index ? 0.65 : 1)), unit, critical, unit.family);
        });
      } else {
        this.damage(target, damage, unit, critical, unit.family);
        if (unit.family === 'frost') target.slowUntil = this.state.time + 1.7;
        if (unit.family === 'ranger' && targets[1]) {
          const p = trackPosition(targets[1].progress);
          if (Math.hypot(p.x - point.x, p.y - point.y) < 50) this.damage(targets[1], Math.round(damage * 0.35), unit, false, unit.family);
        }
      }
    }
    this.state.enemies = this.state.enemies.filter(e => e.hp > 0);
    for (const player of this.active()) {
      const enemies = this.state.enemies.filter(e => e.ownerId === player.id);
      const boss = enemies.some(e => e.kind === 'boss');
      if (!boss) delete this.state.bossDeadlines[player.id];
      if (enemies.length >= MAX_ENEMIES) this.end(player, 'defeat', '몬스터 누적 55마리');
      else if (boss && this.state.time >= this.state.bossDeadlines[player.id]) this.end(player, 'defeat', '보스 제한 시간 초과');
      else if (this.state.wave === LAST_WAVE && this.state.spawned >= this.spawnCount() && enemies.length === 0) this.end(player, 'victory', '10웨이브 방어 성공');
    }
    if (!this.active().length) this.state.phase = 'finished';
  }
  playerLeft(playerId: string): void {
    const player = this.state.players.find(p => p.id === playerId);
    if (player?.status === 'active') { player.status = 'left'; player.endedAt = this.state.time; player.reason = '전장 이탈'; }
    this.state.defenders = this.state.defenders.filter(d => d.ownerId !== playerId);
    this.state.enemies = this.state.enemies.filter(e => e.ownerId !== playerId);
    delete this.state.bossDeadlines[playerId];
    if (!this.active().length) this.state.phase = 'finished';
  }
  snapshot(): DefenseState { return this.state; }
  finished(): boolean { return this.state.phase === 'finished'; }
}
export const starwoodMode: GameMode = {
  id: DEFENSE_ID, title: '밤의 용병단', subtitle: '각자의 전장, 한 번의 대박 · 개인 운빨 디펜스', minPlayers: 1, maxPlayers: 4,
  create: (players, seed) => new StarwoodSession(players, seed),
};
