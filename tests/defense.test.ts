import test from 'node:test';
import assert from 'node:assert/strict';
import { StarwoodSession } from '../server/modes/starwood.js';
import { createRandom, LAST_WAVE, MAX_ENEMIES, PITY_COUNT, trackPosition, PATH_LENGTH } from '../shared/defense.js';
import type { PlayerInfo } from '../shared/protocol.js';

const players: PlayerInfo[] = [{ id: 'one', name: '하나', color: '#c9f38e', connected: true, ready: true },
  { id: 'two', name: '둘', color: '#a6c8ff', connected: true, ready: true }];
const make = (count = 1) => new StarwoodSession(players.slice(0, count), 12345);

test('seeded random source is repeatable and track wraps without teleporting off map', () => {
  const a = createRandom(27), b = createRandom(27);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
  assert.deepEqual(trackPosition(0), trackPosition(PATH_LENGTH));
  assert.equal(trackPosition(-10).x, trackPosition(PATH_LENGTH - 10).x);
});
test('summoning spends resources and cannot occupy a used cell or exceed player capacity', () => {
  const session = make(); const state = session.state; const player = state.players[0];
  const original = player.gold;
  assert.equal(session.command('one', { kind: 'summon', slot: 8 }).ok, true);
  assert.equal(player.gold, original - 40);
  assert.equal(session.command('one', { kind: 'summon', slot: 8 }).ok, false);
  assert.equal(player.gold, original - 40);
  player.gold = 10000;
  while (state.defenders.length < 10) assert.equal(session.command('one', { kind: 'summon' }).ok, true);
  assert.equal(session.command('one', { kind: 'summon' }).ok, false);
});
test('ownership, numeric validation and merge requirements are enforced by the server', () => {
  const session = make(2), own = session.state.defenders[0], ally = session.state.defenders[3];
  assert.equal(session.command('one', { kind: 'move', defenderId: ally.id, slot: 8 }).ok, false);
  assert.equal(session.command('one', { kind: 'move', defenderId: own.id, slot: ally.slot }).ok, false);
  for (const slot of [NaN, Infinity, -1, 40, 0.5, '8']) assert.equal(session.command('one', { kind: 'move', defenderId: own.id, slot }).ok, false);
  assert.equal(session.command('one', { kind: 'merge', defenderId: own.id, targetId: ally.id }).ok, false);
  assert.equal(session.command('one', { kind: 'merge', defenderId: own.id, targetId: own.id }).ok, false);
  const partner = session.state.defenders[1];
  assert.equal(session.command('one', { kind: 'merge', defenderId: own.id, targetId: partner.id }).ok, true);
  assert.equal(own.rank, 1); assert.equal(session.state.defenders.length, 5);
  assert.equal(session.command('one', { kind: 'merge', defenderId: own.id, targetId: partner.id }).ok, false);
});
test('moving onto an owned unit swaps positions atomically', () => {
  const session = make(), [a, b] = session.state.defenders;
  const [first, second] = [a.slot, b.slot];
  assert.equal(session.command('one', { kind: 'move', defenderId: a.id, slot: b.slot }).ok, true);
  assert.equal(a.slot, second); assert.equal(b.slot, first);
});
test('pity guarantees rare or better after nine ordinary summons', () => {
  const session = make(); session.state.players[0].pity = PITY_COUNT - 1;
  session.command('one', { kind: 'summon', slot: 8 });
  assert.ok(session.state.defenders.at(-1)!.rank >= 1);
  assert.equal(session.state.players[0].pity, 0);
});
test('area skill validates coordinates and cannot bypass its cooldown', () => {
  const session = make(); session.state.phase = 'battle'; session.state.wave = 1; session.state.waveEndsAt = 20;
  assert.equal(session.command('one', { kind: 'burst', x: NaN, y: 3 }).ok, false);
  assert.equal(session.command('one', { kind: 'burst', x: -1, y: 3 }).ok, false);
  assert.equal(session.command('one', { kind: 'burst', x: 131, y: 124 }).ok, true);
  assert.equal(session.command('one', { kind: 'burst', x: 131, y: 124 }).ok, false);
});
test('real attacks kill enemies and rewards go to the team', () => {
  const session = make(2); session.state.phase = 'battle'; session.state.wave = 1; session.state.waveEndsAt = 20;
  session.state.enemies.push({ id: 900, hp: 1, maxHp: 1, progress: 100, speed: 0, kind: 'sprout', slowUntil: 0 });
  session.state.defenders[0].cooldown = 0;
  const oldGold = session.state.players.map(p => p.gold);
  session.tick(1 / 30);
  assert.equal(session.state.totalKills, 1);
  session.state.players.forEach((p, i) => assert.equal(p.gold, oldGold[i] + 3));
});
test('monster limit and boss deadline produce defeat; terminal states reject commands', () => {
  const session = make(); session.state.phase = 'battle'; session.state.wave = 1; session.state.waveEndsAt = 20; session.state.defenders = [];
  session.state.enemies = Array.from({ length: MAX_ENEMIES }, (_, i) => ({ id: 900 + i, hp: 100, maxHp: 100, progress: i, speed: 0, kind: 'sprout' as const, slowUntil: 0 }));
  session.tick(1 / 30); assert.equal(session.state.phase, 'defeat');
  assert.equal(session.command('one', { kind: 'summon' }).ok, false);
  const boss = make(); boss.state.phase = 'battle'; boss.state.wave = 4; boss.state.waveEndsAt = 20; boss.state.bossDeadline = 0.01;
  boss.state.spawned = 100;
  boss.state.enemies.push({ id: 900, hp: 99999, maxHp: 99999, progress: 0, speed: 0, kind: 'boss', slowUntil: 0 });
  boss.tick(1 / 30); assert.equal(boss.state.phase, 'defeat');
});
test('final wave requires all scheduled enemies to be cleared before victory', () => {
  const session = make(); session.state.phase = 'battle'; session.state.wave = LAST_WAVE; session.state.waveEndsAt = 20;
  session.state.spawned = 8 + LAST_WAVE * 2;
  session.state.enemies = [];
  session.tick(1 / 30);
  assert.equal(session.state.phase, 'victory'); assert.equal(session.finished(), true);
  const time = session.state.time; session.tick(1); assert.equal(session.state.time, time);
});
test('fixed-step simulation runs a full unattended match without invalid state', () => {
  const session = make(2);
  for (let i = 0; i < 30 * 300 && !session.finished(); i++) session.tick(1 / 30);
  assert.equal(session.finished(), true);
  for (const enemy of session.state.enemies) assert.ok(Number.isFinite(enemy.progress) && Number.isFinite(enemy.hp));
  assert.ok(['victory', 'defeat'].includes(session.state.phase));
});
