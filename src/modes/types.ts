import type { PlayerInfo, RoomSnapshot } from '../../shared/protocol.js';
export interface ModeContext {
  element: HTMLElement;
  playerId: string;
  players: PlayerInfo[];
  command(action: unknown): void;
  notice(message: string): void;
}
export interface ClientMode {
  update(room: RoomSnapshot): void;
  destroy(): void;
}
export type ModeFactory = (context: ModeContext) => ClientMode;
