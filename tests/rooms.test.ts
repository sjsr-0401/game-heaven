import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomHub, type Peer } from '../server/rooms.js';
import { starwoodMode } from '../server/modes/starwood.js';
import type { GameMode } from '../server/modes/types.js';
import type { ServerMessage, RoomSnapshot } from '../shared/protocol.js';

class FakePeer implements Peer {
  messages: ServerMessage[] = []; closed = false;
  constructor(readonly id: string) {}
  send(message: ServerMessage): void { this.messages.push(structuredClone(message)); }
  close(): void { this.closed = true; }
  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> { return [...this.messages].reverse().find(m => m.type === type) as Extract<ServerMessage, { type: T }>; }
  state(): RoomSnapshot { return this.last('state').room; }
}
function setup() {
  let now = 1000; const hub = new RoomHub(new Map([[starwoodMode.id, starwoodMode]]), () => now);
  const a = new FakePeer('socket-a'), b = new FakePeer('socket-b'); hub.connect(a); hub.connect(b);
  hub.receive(a.id, { type: 'create', name: '친구 A', modeId: 'nightwatch' });
  const joined = a.last('joined');
  return { hub, a, b, joined, advance: (ms: number) => { now += ms; } };
}
test('private credentials are not included in public room snapshots', () => {
  const { a, joined } = setup(); const serialized = JSON.stringify(a.state());
  assert.ok(!serialized.includes(joined.token)); assert.ok(!serialized.includes('token'));
});
test('joining, readiness and host-only start are room-level rules', () => {
  const { hub, a, b, joined } = setup();
  hub.receive(b.id, { type: 'join', name: '친구 B', code: joined.room.code.toLowerCase() });
  assert.equal(a.state().players.length, 2);
  hub.receive(b.id, { type: 'start' }); assert.equal(a.state().phase, 'lobby');
  hub.receive(a.id, { type: 'start' }); assert.equal(a.state().phase, 'lobby');
  hub.receive(b.id, { type: 'ready', ready: true }); hub.receive(a.id, { type: 'start' });
  assert.equal(a.state().phase, 'playing'); assert.equal(b.state().phase, 'playing');
});
test('duplicate command ids do not spend currency twice', () => {
  const { hub, a } = setup(); hub.receive(a.id, { type: 'start' });
  const command = { type: 'command', action: { kind: 'summon', slot: 8 }, requestId: 1 };
  hub.receive(a.id, command); const first = JSON.stringify(a.state().game);
  hub.receive(a.id, command); assert.equal(a.last('ack').ok, false); assert.equal(JSON.stringify(a.state().game), first);
});
test('reconnection restores the same player and rotates the private token', () => {
  const { hub, a, joined, advance } = setup();
  hub.receive(a.id, { type: 'start' }); hub.disconnect(a.id); advance(5000);
  const next = new FakePeer('next'); hub.connect(next);
  hub.receive(next.id, { type: 'resume', code: joined.room.code, token: joined.token });
  const result = next.last('joined'); assert.equal(result.playerId, joined.playerId); assert.notEqual(result.token, joined.token);
  const attack = new FakePeer('attack'); hub.connect(attack);
  hub.receive(attack.id, { type: 'resume', code: joined.room.code, token: joined.token });
  assert.ok(attack.last('error')); assert.equal(next.state().players[0].connected, true);
});
test('host transfers on disconnect and abandoned rooms expire after 60 seconds', () => {
  const { hub, a, b, joined, advance } = setup(); hub.receive(b.id, { type: 'join', name: 'B', code: joined.room.code });
  hub.disconnect(a.id); assert.equal(b.state().hostId, b.last('joined').playerId);
  hub.disconnect(b.id); advance(60_001); hub.tick(1 / 30); assert.equal(hub.roomCount, 0);
});
test('invalid rooms and malformed reconnect tokens fail without crashing the hub', () => {
  const { hub, b } = setup();
  hub.receive(b.id, { type: 'join', name: 'B', code: 'XXXXX' }); assert.ok(b.last('error'));
  assert.doesNotThrow(() => hub.receive(b.id, { type: 'resume', code: 'XXXXX', token: '한'.repeat(64) }));
  assert.doesNotThrow(() => hub.receive(b.id, null));
  hub.receive(b.id, { type: 'create', name: 'B', modeId: 'removed-mode' }); assert.ok(b.last('error'));
});
test('room isolation prevents commands and state from leaking to other rooms', () => {
  const { hub, a, b } = setup(); hub.receive(b.id, { type: 'create', name: 'B', modeId: 'nightwatch' });
  const before = b.messages.length;
  hub.receive(a.id, { type: 'start' }); hub.receive(a.id, { type: 'command', requestId: 1, action: { kind: 'summon' } });
  assert.equal(b.messages.length, before); assert.notEqual(a.state().code, b.state().code);
});
test('a different registered mode runs, finishes and returns to lobby without transport changes', () => {
  let ticks = 0;
  const fixture: GameMode = { id: 'test-fixture', title: '격리 검증용', subtitle: '', minPlayers: 1, maxPlayers: 2,
    create: () => ({ command: () => ({ ok: true }), tick: () => { ticks++; }, snapshot: () => ({ ticks }), finished: () => ticks > 1 }) };
  const hub = new RoomHub(new Map([[fixture.id, fixture]])), peer = new FakePeer('fixture-peer'); hub.connect(peer);
  hub.receive(peer.id, { type: 'create', name: '검증', modeId: fixture.id }); hub.receive(peer.id, { type: 'start' });
  hub.tick(1 / 30); hub.tick(1 / 30);
  assert.equal(peer.state().phase, 'finished'); assert.deepEqual(peer.state().game, { ticks: 2 });
  hub.receive(peer.id, { type: 'lobby' }); assert.equal(peer.state().phase, 'lobby'); assert.equal(peer.state().game, null);
});
