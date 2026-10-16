import type { GameMode } from './types.js';
import { starwoodMode } from './starwood.js';

// A new mode is registered here; rooms and WebSocket transport stay unchanged.
export const modes = new Map<string, GameMode>([
  [starwoodMode.id, starwoodMode],
]);
