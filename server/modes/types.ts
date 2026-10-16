import type { ModeInfo, PlayerInfo } from '../../shared/protocol.js';

export interface CommandResult { ok: boolean; error?: string }
export interface ModeSession {
  command(playerId: string, action: unknown): CommandResult;
  tick(dt: number): void;
  snapshot(): unknown;
  finished(): boolean;
  playerLeft?(playerId: string): void;
}
export interface GameMode extends ModeInfo {
  create(players: PlayerInfo[], seed: number): ModeSession;
}
