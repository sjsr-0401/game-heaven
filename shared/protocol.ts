export const PROTOCOL_VERSION = 1;
export const PLAYER_COLORS = ['#f5bd62', '#65d5cc', '#ae9bfa', '#f08d9c'];

export interface PlayerInfo {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  ready: boolean;
}

export interface ModeInfo {
  id: string;
  title: string;
  subtitle: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface RoomSnapshot {
  code: string;
  modeId: string;
  hostId: string;
  phase: 'lobby' | 'playing' | 'finished';
  players: PlayerInfo[];
  game: unknown;
  sequence: number;
}

export type ClientMessage =
  | { type: 'hello'; version: number }
  | { type: 'create'; name: string; modeId: string }
  | { type: 'join'; name: string; code: string }
  | { type: 'resume'; token: string; code: string }
  | { type: 'ready'; ready: boolean }
  | { type: 'start' }
  | { type: 'lobby' }
  | { type: 'leave' }
  | { type: 'command'; action: unknown; requestId: number }
  | { type: 'ping'; at: number };

export type ServerMessage =
  | { type: 'welcome'; version: number; modes: ModeInfo[] }
  | { type: 'joined'; playerId: string; token: string; room: RoomSnapshot }
  | { type: 'state'; room: RoomSnapshot }
  | { type: 'ack'; requestId: number; ok: boolean; error?: string }
  | { type: 'error'; message: string }
  | { type: 'left' }
  | { type: 'pong'; at: number };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
