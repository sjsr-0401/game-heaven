import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../shared/protocol.js';

interface SavedSession { code: string; token: string }
export class Transport extends EventTarget {
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private heartbeat: ReturnType<typeof setInterval>;
  private session: SavedSession | null = null;
  private resuming = false;
  private intentional = false;
  private requestId = Date.now();
  latency = 0;
  connected = false;

  constructor() {
    super();
    try { this.session = JSON.parse(sessionStorage.getItem('heaven.session') ?? 'null'); } catch { this.clearSession(); }
    this.connect();
    this.heartbeat = setInterval(() => this.send({ type: 'ping', at: Date.now() }), 4000);
  }
  private emit(type: string, detail: unknown): void { this.dispatchEvent(new CustomEvent(type, { detail })); }
  private connect(): void {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    this.socket = socket;
    socket.onopen = () => {
      this.connected = true; this.attempts = 0;
      this.emit('connection', { connected: true });
      this.send({ type: 'hello', version: PROTOCOL_VERSION });
      if (this.session) { this.resuming = true; this.send({ type: 'resume', ...this.session }); }
    };
    socket.onmessage = event => {
      let message: ServerMessage;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.type === 'joined') {
        this.session = { code: message.room.code, token: message.token };
        sessionStorage.setItem('heaven.session', JSON.stringify(this.session));
        this.resuming = false;
      }
      if (message.type === 'left') this.clearSession();
      if (message.type === 'error' && this.resuming) { this.resuming = false; this.clearSession(); this.emit('sessionExpired', null); }
      if (message.type === 'pong') { this.latency = Date.now() - message.at; this.emit('latency', this.latency); }
      this.emit('message', message);
    };
    socket.onclose = event => {
      this.connected = false; this.emit('connection', { connected: false });
      if (this.intentional) return;
      if (event.code === 4001) { this.clearSession(); this.emit('replaced', null); return; }
      this.retry = setTimeout(() => this.connect(), Math.min(500 * 2 ** this.attempts++, 5000));
    };
    socket.onerror = () => { /* onclose owns reconnection. */ };
  }
  private clearSession(): void { this.session = null; sessionStorage.removeItem('heaven.session'); }
  send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message)); return true;
  }
  command(action: unknown): boolean { return this.send({ type: 'command', action, requestId: ++this.requestId }); }
  destroy(): void {
    this.intentional = true;
    if (this.retry) clearTimeout(this.retry);
    clearInterval(this.heartbeat); this.socket?.close();
  }
}
