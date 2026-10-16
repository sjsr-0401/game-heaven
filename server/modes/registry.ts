import type { GameMode } from './types.js';
import { escapeMode } from './escape.js';
export const modes = new Map<string, GameMode>([[escapeMode.id, escapeMode]]);
