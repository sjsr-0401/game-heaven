export const DEFENSE_ID = 'starwood';
export const GRID = { x: 268, y: 236, cols: 8, rows: 5, step: 64 };
export const TRACK = { left: 131, right: 853, top: 124, bottom: 604 };
export const PATH_LENGTH = 2 * (TRACK.right - TRACK.left + TRACK.bottom - TRACK.top);
export const BOARD = { width: 984, height: 716 };
export const SUMMON_COST = 40;
export const LAST_WAVE = 8;
export const WAVE_SECONDS = 20;
export const MAX_ENEMIES = 65;
export const PITY_COUNT = 10;

export const FAMILIES = ['ranger', 'ember', 'frost', 'volt'] as const;
export type Family = typeof FAMILIES[number];
export const FAMILIES_INFO = {
  ranger: { name: '이끼 궁수', short: '궁수', color: '#b6e67c', role: '빠른 단일 공격', damage: 17, interval: 0.62, range: 255 },
  ember: { name: '불씨 마법사', short: '불씨', color: '#ffae83', role: '범위 폭발', damage: 27, interval: 1.35, range: 265 },
  frost: { name: '서리 정령', short: '서리', color: '#91d9ef', role: '이동 속도 감소', damage: 12, interval: 1.0, range: 275 },
  volt: { name: '별빛 주술사', short: '별빛', color: '#d8b2ff', role: '연쇄 번개', damage: 21, interval: 1.05, range: 270 },
} as const;
export const RARITIES = [
  { name: '일반', color: '#b8d2be', multiplier: 1, chance: 0.76 },
  { name: '희귀', color: '#8dcefa', multiplier: 2.6, chance: 0.20 },
  { name: '영웅', color: '#d4a5fc', multiplier: 7, chance: 0.035 },
  { name: '전설', color: '#ffda80', multiplier: 19, chance: 0.005 },
] as const;

export interface Defender {
  id: number;
  ownerId: string;
  family: Family;
  rank: number;
  slot: number;
  cooldown: number;
  kills: number;
}
export interface Enemy {
  id: number;
  progress: number;
  hp: number;
  maxHp: number;
  speed: number;
  kind: 'sprout' | 'beetle' | 'boss';
  slowUntil: number;
}
export interface DefensePlayer {
  id: string;
  gold: number;
  upgrade: number;
  pity: number;
  kills: number;
  summons: number;
  merges: number;
  burstReadyAt: number;
}
export interface CombatEvent {
  id: number;
  type: 'shot' | 'summon' | 'merge' | 'burst' | 'kill' | 'wave' | 'upgrade';
  at: number;
  x: number;
  y: number;
  tx?: number;
  ty?: number;
  family?: Family;
  rank?: number;
  amount?: number;
  text?: string;
}
export interface DefenseState {
  mode: typeof DEFENSE_ID;
  time: number;
  phase: 'preparing' | 'battle' | 'victory' | 'defeat';
  wave: number;
  waveEndsAt: number;
  spawned: number;
  players: DefensePlayer[];
  defenders: Defender[];
  enemies: Enemy[];
  events: CombatEvent[];
  bossDeadline: number;
  totalKills: number;
}
export type DefenseAction =
  | { kind: 'summon'; slot?: number }
  | { kind: 'move'; defenderId: number; slot: number }
  | { kind: 'merge'; defenderId: number; targetId: number }
  | { kind: 'upgrade' }
  | { kind: 'burst'; x: number; y: number };

export function slotPosition(slot: number): { x: number; y: number } {
  return { x: GRID.x + (slot % GRID.cols) * GRID.step, y: GRID.y + Math.floor(slot / GRID.cols) * GRID.step };
}
export function trackPosition(progress: number): { x: number; y: number; angle: number } {
  const w = TRACK.right - TRACK.left;
  const h = TRACK.bottom - TRACK.top;
  let p = ((progress % PATH_LENGTH) + PATH_LENGTH) % PATH_LENGTH;
  if (p < w) return { x: TRACK.left + p, y: TRACK.top, angle: 0 };
  p -= w;
  if (p < h) return { x: TRACK.right, y: TRACK.top + p, angle: Math.PI / 2 };
  p -= h;
  if (p < w) return { x: TRACK.right - p, y: TRACK.bottom, angle: Math.PI };
  return { x: TRACK.left, y: TRACK.bottom - (p - w), angle: -Math.PI / 2 };
}
export function upgradeCost(level: number): number { return 80 + level * 50; }
export function defenderDamage(defender: Defender, upgrade: number): number {
  return Math.round(FAMILIES_INFO[defender.family].damage * RARITIES[defender.rank].multiplier * (1 + upgrade * 0.15));
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
