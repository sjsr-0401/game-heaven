import { DEFENSE_ID } from '../../shared/defense.js';
import { StarwoodView } from './starwood/view.js';
import type { ModeFactory } from './types.js';

export const clientModes = new Map<string, ModeFactory>([
  [DEFENSE_ID, context => new StarwoodView(context)],
]);
