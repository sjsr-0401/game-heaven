export const DEFENSE_ID = 'nightwatch';
export const GRID = { x: 268, y: 236, cols: 8, rows: 5, step: 64 };
export const TRACK = { left: 131, right: 853, top: 124, bottom: 604 };
export const PATH_LENGTH = 2 * (TRACK.right - TRACK.left + TRACK.bottom - TRACK.top);
export const BOARD = { width: 984, height: 716 };
export const SUMMON_COST = 40;
export const WAGER_COST = 120;
export const MAX_DEFENDERS = 16;
export const LAST_WAVE = 10;
export const WAVE_SECONDS = 18;
export const MAX_ENEMIES = 55;

export const FAMILIES = ['ranger', 'ember', 'frost', 'volt'] as const;
export type Family = typeof FAMILIES[number];
export const FAMILIES_INFO = {
  ranger: { name: '유랑 사수', short: '사수', color: '#f0c27c', role: '관통 탄환 · 빠른 사격', damage: 28, interval: 0.65, range: 310 },
  ember: { name: '화염 연금술사', short: '화염', color: '#ff875d', role: '폭발탄 · 범위 공격', damage: 40, interval: 1.65, range: 330 },
  frost: { name: '서리 검사', short: '검사', color: '#91d9ee', role: '검기 · 둔화', damage: 30, interval: 1.1, range: 315 },
  volt: { name: '뇌전 술사', short: '뇌전', color: '#c8acff', role: '번개 · 3연쇄 공격', damage: 26, interval: 1.35, range: 325 },
} as const;
export const RARITIES = [
  { name: '일반', color: '#aeb9c9', multiplier: 1, chance: 0.70, wagerChance: 0.56 },
  { name: '희귀', color: '#7bc6ff', multiplier: 2.5, chance: 0.24, wagerChance: 0.32 },
  { name: '영웅', color: '#c5a0ff', multiplier: 7, chance: 0.05, wagerChance: 0.10 },
  { name: '전설', color: '#ffcc70', multiplier: 20, chance: 0.009, wagerChance: 0.018 },
  { name: '신화', color: '#ff7da9', multiplier: 55, chance: 0.001, wagerChance: 0.002 },
] as const;

export interface Defender {
  id: number; ownerId: string; family: Family; rank: number; slot: number;
  cooldown: number; kills: number;
}
export interface Enemy {
  id: number; ownerId: string; progress: number; hp: number; maxHp: number;
  speed: number; kind: 'raider' | 'brute' | 'boss'; slowUntil: number;
}
export interface DefensePlayer {
  id: string; gold: number; upgrade: number; kills: number; summons: number;
  wagers: number; bestRank: number; burstReadyAt: number;
  status: 'active' | 'victory' | 'defeat' | 'left'; endedAt: number; reason: string;
}
export interface CombatEvent {
  id: number; ownerId: string; type: 'shot' | 'hit' | 'summon' | 'burst' | 'kill' | 'wave' | 'upgrade';
  at: number; x: number; y: number; tx?: number; ty?: number; family?: Family;
  rank?: number; amount?: number; text?: string; unitId?: number; targetId?: number;
  critical?: boolean;
}
export interface DefenseState {
  mode: typeof DEFENSE_ID; time: number; phase: 'preparing' | 'battle' | 'finished';
  wave: number; waveEndsAt: number; spawned: number;
  players: DefensePlayer[]; defenders: Defender[]; enemies: Enemy[]; events: CombatEvent[];
  bossDeadlines: Record<string, number>;
}
export type DefenseAction =
  | { kind: 'summon'; slot?: number; wager?: boolean }
  | { kind: 'move'; defenderId: number; slot: number }
  | { kind: 'dismiss'; defenderId: number }
  | { kind: 'upgrade' }
  | { kind: 'burst'; x: number; y: number };
export function slotPosition(slot: number): { x: number; y: number } {
  return { x: GRID.x + (slot % GRID.cols) * GRID.step, y: GRID.y + Math.floor(slot / GRID.cols) * GRID.step };
}
export function trackPosition(progress: number): { x: number; y: number; angle: number } {
  const w = TRACK.right - TRACK.left, h = TRACK.bottom - TRACK.top;
  let p = ((progress % PATH_LENGTH) + PATH_LENGTH) % PATH_LENGTH;
  if (p < w) return { x: TRACK.left + p, y: TRACK.top, angle: 0 };
  p -= w;
  if (p < h) return { x: TRACK.right, y: TRACK.top + p, angle: Math.PI / 2 };
  p -= h;
  if (p < w) return { x: TRACK.right - p, y: TRACK.bottom, angle: Math.PI };
  return { x: TRACK.left, y: TRACK.bottom - (p - w), angle: -Math.PI / 2 };
}
export function upgradeCost(level: number): number { return 100 + level * 70; }
export function dismissValue(rank: number): number { return [10, 20, 35, 60, 100][rank] ?? 0; }
export function defenderDamage(defender: Defender, upgrade: number): number {
  return Math.round(FAMILIES_INFO[defender.family].damage * RARITIES[defender.rank].multiplier * (1 + upgrade * 0.18));
}
export function rollRank(roll: number, wager = false): number {
  let total = 0;
  for (let i = 0; i < RARITIES.length; i++) {
    total += wager ? RARITIES[i].wagerChance : RARITIES[i].chance;
    if (roll < total) return i;
  }
  return RARITIES.length - 1;
}
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
