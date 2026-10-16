import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { PROTOCOL_VERSION, PLAYER_COLORS, isRecord, type ModeInfo, type PlayerInfo, type RoomSnapshot, type ServerMessage } from '../shared/protocol.js';
import type { GameMode, ModeSession } from './modes/types.js';

export interface Peer { id: string; send(message: ServerMessage): void; close(): void }
interface Member extends PlayerInfo { token: string; peer: Peer | null; disconnectedAt: number; lastRequestId: number }
interface Room {
  code: string; modeId: string; hostId: string; phase: RoomSnapshot['phase'];
  members: Map<string, Member>; game: ModeSession | null; sequence: number;
}
interface PeerState { peer: Peer; roomCode?: string; playerId?: string; windowStart: number; messages: number }

export class RoomHub {
  private readonly rooms = new Map<string, Room>();
  private readonly peers = new Map<string, PeerState>();
  constructor(private readonly modes: Map<string, GameMode>, private readonly now = () => Date.now()) {}

  get roomCount(): number { return this.rooms.size; }
  modeList(): ModeInfo[] {
    return [...this.modes.values()].map(({ id, title, subtitle, minPlayers, maxPlayers }) => ({ id, title, subtitle, minPlayers, maxPlayers }));
  }
  connect(peer: Peer): void {
    this.peers.set(peer.id, { peer, windowStart: this.now(), messages: 0 });
    peer.send({ type: 'welcome', version: PROTOCOL_VERSION, modes: this.modeList() });
  }
  private error(peer: Peer, message: string): void { peer.send({ type: 'error', message }); }
  receive(peerId: string, raw: unknown): void {
    const connection = this.peers.get(peerId);
    if (!connection) return;
    const { peer } = connection;
    if (this.now() - connection.windowStart > 1000) { connection.windowStart = this.now(); connection.messages = 0; }
    if (++connection.messages > 70) { if (connection.messages === 71) this.error(peer, '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.'); return; }
    if (!isRecord(raw) || typeof raw.type !== 'string') return this.error(peer, '올바르지 않은 메시지입니다.');
    if (raw.type === 'hello') {
      if (raw.version !== PROTOCOL_VERSION) this.error(peer, '게임이 업데이트됐습니다. 새로고침해 주세요.');
      return;
    }
    if (raw.type === 'ping' && typeof raw.at === 'number' && Number.isFinite(raw.at)) { peer.send({ type: 'pong', at: raw.at }); return; }
    if (raw.type === 'resume') { this.resume(connection, raw); return; }
    if (raw.type === 'create' || raw.type === 'join') {
      if (connection.roomCode) return this.error(peer, '현재 방에서 먼저 나와 주세요.');
      const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 12) : '';
      if (!name) return this.error(peer, '닉네임을 입력해 주세요.');
      if (raw.type === 'create') {
        const mode = typeof raw.modeId === 'string' ? this.modes.get(raw.modeId) : undefined;
        if (!mode) return this.error(peer, '사용할 수 없는 모드입니다.');
        if (this.rooms.size >= 100) return this.error(peer, '서버의 방이 가득 찼습니다.');
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code: string;
        do { code = Array.from({ length: 5 }, () => alphabet[randomInt(0, alphabet.length)]).join(''); } while (this.rooms.has(code));
        const room: Room = { code, modeId: mode.id, hostId: '', phase: 'lobby', members: new Map(), game: null, sequence: 0 };
        this.rooms.set(code, room);
        this.addMember(room, connection, name);
      } else {
        const code = typeof raw.code === 'string' ? raw.code.toUpperCase().trim() : '';
        const room = this.rooms.get(code);
        if (!room) return this.error(peer, '방 코드를 다시 확인해 주세요.');
        if (room.phase !== 'lobby') return this.error(peer, '이미 시작된 방입니다. 다음 판에 함께해 주세요.');
        if (room.members.size >= this.modes.get(room.modeId)!.maxPlayers) return this.error(peer, '방이 가득 찼어요.');
        this.addMember(room, connection, name);
      }
      return;
    }
    const room = connection.roomCode ? this.rooms.get(connection.roomCode) : undefined;
    const member = room && connection.playerId ? room.members.get(connection.playerId) : undefined;
    if (!room || !member) return this.error(peer, '먼저 방에 입장해 주세요.');
    if (raw.type === 'leave') { this.removeMember(room, member.id); delete connection.roomCode; delete connection.playerId; peer.send({ type: 'left' }); return; }
    if (raw.type === 'ready') {
      if (room.phase !== 'lobby' || typeof raw.ready !== 'boolean') return;
      member.ready = raw.ready;
      this.broadcast(room); return;
    }
    if (raw.type === 'start') {
      if (room.hostId !== member.id) return this.error(peer, '방장만 시작할 수 있어요.');
      if (room.phase !== 'lobby') return this.error(peer, '이미 게임이 진행 중이에요.');
      const mode = this.modes.get(room.modeId)!;
      const members = [...room.members.values()];
      if (members.filter(p => p.connected).length < mode.minPlayers) return this.error(peer, '참가 인원이 부족해요.');
      if (members.some(p => !p.connected || (p.id !== room.hostId && !p.ready))) return this.error(peer, '친구들이 준비되면 시작해 주세요.');
      room.game = mode.create(members.map(p => this.publicPlayer(p)), randomInt(0, 2147483647));
      room.phase = 'playing';
      members.forEach(p => { p.lastRequestId = -1; });
      this.broadcast(room); return;
    }
    if (raw.type === 'lobby') {
      if (room.hostId !== member.id) return this.error(peer, '방장만 다음 판을 준비할 수 있어요.');
      if (room.phase !== 'finished') return this.error(peer, '게임이 끝나면 대기실로 돌아갈 수 있어요.');
      room.phase = 'lobby'; room.game = null;
      room.members.forEach(p => { p.ready = false; });
      this.broadcast(room); return;
    }
    if (raw.type === 'command') {
      if (typeof raw.requestId !== 'number' || !Number.isSafeInteger(raw.requestId) || raw.requestId < 0) return this.error(peer, '잘못된 명령 번호입니다.');
      if (room.phase !== 'playing' || !room.game) { peer.send({ type: 'ack', requestId: raw.requestId, ok: false, error: '진행 중인 게임이 없어요.' }); return; }
      if (raw.requestId <= member.lastRequestId) { peer.send({ type: 'ack', requestId: raw.requestId, ok: false, error: '이미 처리한 명령입니다.' }); return; }
      member.lastRequestId = raw.requestId;
      const result = room.game.command(member.id, raw.action);
      peer.send({ type: 'ack', requestId: raw.requestId, ...result });
      if (result.ok && result.broadcast !== false) this.broadcast(room);
      return;
    }
    this.error(peer, '지원하지 않는 메시지입니다.');
  }
  private publicPlayer(member: Member): PlayerInfo {
    return { id: member.id, name: member.name, color: member.color, connected: member.connected, ready: member.ready };
  }
  private addMember(room: Room, connection: PeerState, name: string): void {
    const usedColors = new Set([...room.members.values()].map(m => m.color));
    const member: Member = { id: randomUUID(), name, color: PLAYER_COLORS.find(c => !usedColors.has(c))!,
      token: randomBytes(32).toString('hex'), connected: true, ready: false, peer: connection.peer, disconnectedAt: 0, lastRequestId: -1 };
    room.members.set(member.id, member);
    room.hostId ||= member.id;
    connection.playerId = member.id; connection.roomCode = room.code;
    connection.peer.send({ type: 'joined', playerId: member.id, token: member.token, room: this.snapshot(room) });
    this.broadcast(room);
  }
  private resume(connection: PeerState, raw: Record<string, unknown>): void {
    if (connection.roomCode) return this.error(connection.peer, '이미 방에 접속 중입니다.');
    if (typeof raw.token !== 'string' || typeof raw.code !== 'string' || !/^[a-f0-9]{64}$/.test(raw.token)) return this.error(connection.peer, '재접속 정보를 확인할 수 없어요.');
    const room = this.rooms.get(raw.code);
    const candidate = Buffer.from(raw.token);
    const member = room && [...room.members.values()].find(p => timingSafeEqual(Buffer.from(p.token), candidate));
    if (!room || !member || (!member.connected && this.now() - member.disconnectedAt > 60_000)) return this.error(connection.peer, '재접속 시간이 지났어요. 새 방에 입장해 주세요.');
    const oldPeer = member.peer;
    if (oldPeer && oldPeer.id !== connection.peer.id) {
      const oldConnection = this.peers.get(oldPeer.id);
      if (oldConnection) { delete oldConnection.roomCode; delete oldConnection.playerId; }
      oldPeer.close();
    }
    member.peer = connection.peer; member.connected = true; member.disconnectedAt = 0;
    member.token = randomBytes(32).toString('hex');
    connection.roomCode = room.code; connection.playerId = member.id;
    connection.peer.send({ type: 'joined', playerId: member.id, token: member.token, room: this.snapshot(room) });
    this.broadcast(room);
  }
  disconnect(peerId: string): void {
    const connection = this.peers.get(peerId);
    if (!connection) return;
    const room = connection.roomCode ? this.rooms.get(connection.roomCode) : undefined;
    const member = room && connection.playerId ? room.members.get(connection.playerId) : undefined;
    if (member?.peer?.id === peerId) { member.peer = null; member.connected = false; member.disconnectedAt = this.now(); member.ready = false; if (room) { this.electHost(room); this.broadcast(room); } }
    this.peers.delete(peerId);
  }
  private electHost(room: Room): void {
    if (!room.members.get(room.hostId)?.connected) room.hostId = [...room.members.values()].find(m => m.connected)?.id ?? room.hostId;
  }
  private removeMember(room: Room, playerId: string): void {
    room.game?.playerLeft?.(playerId);
    room.members.delete(playerId);
    if (!room.members.size) { this.rooms.delete(room.code); return; }
    this.electHost(room); this.broadcast(room);
  }
  tick(dt: number): void {
    for (const room of this.rooms.values()) {
      for (const member of room.members.values()) {
        if (!member.connected && this.now() - member.disconnectedAt >= 60_000) this.removeMember(room, member.id);
      }
      if (!this.rooms.has(room.code)) continue;
      if (room.phase === 'playing' && [...room.members.values()].some(p => p.connected)) {
        room.game!.tick(dt);
        if (room.game!.finished()) { room.phase = 'finished'; this.broadcast(room); }
      }
    }
  }
  snapshot(room: Room): RoomSnapshot {
    return { code: room.code, modeId: room.modeId, hostId: room.hostId, phase: room.phase,
      players: [...room.members.values()].map(p => this.publicPlayer(p)), game: room.game?.snapshot() ?? null, sequence: room.sequence };
  }
  private broadcast(room: Room): void {
    room.sequence++;
    const message: ServerMessage = { type: 'state', room: this.snapshot(room) };
    room.members.forEach(p => p.peer?.send(message));
  }
  broadcastAll(): void { for (const room of this.rooms.values()) if (room.phase === 'playing') this.broadcast(room); }
}
