import {ESCAPE_ID} from '../../shared/escape.js';
import {EscapeView} from './escape/view.js';
import type {ModeFactory} from './types.js';
export const clientModes = new Map<string,ModeFactory>([[ESCAPE_ID,context=>new EscapeView(context)]]);
