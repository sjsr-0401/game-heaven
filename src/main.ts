import './style.css';
import { DEFENSE_ID, FAMILIES, FAMILIES_INFO, RARITIES } from '../shared/defense.js';
import type { ModeInfo, RoomSnapshot, ServerMessage } from '../shared/protocol.js';
import { Transport } from './core/transport.js';
import { clientModes } from './modes/registry.js';
import type { ClientMode } from './modes/types.js';
import { drawGuardian, mapArt, portrait } from './modes/starwood/art.js';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar"><div class="topbar-inner"><a class="brand" href="/" aria-label="게임천국 홈"><span class="brand-mark">✦</span><span>게임천국<small>GAME HEAVEN</small></span></a><nav aria-label="메인 메뉴"><button class="nav-link current" id="play-nav">게임하기</button><button class="nav-link" id="catalog-nav">수호자 도감</button></nav><div class="topbar-right"><span class="connection" id="connection"><i></i><span>서버 연결 중</span></span><span class="header-divider"></span><button class="icon-button" id="sound-toggle" aria-label="효과음 켜기" title="효과음 켜기">♫<span class="sound-off">/</span></button><button class="icon-button" id="help" aria-label="도움말">?</button><span class="profile-icon">나</span></div></div></header>
  <main class="workspace"><div class="page-heading"><div><div class="breadcrumb">게임천국 <span>/</span> 협동 디펜스</div><div class="title-line"><h1>별숲 수호대</h1><span class="alpha-badge">FIRST EXPEDITION</span></div><p>작은 행운을 모아, 친구들과 숲을 지키는 밤.</p></div><div class="room-tools" id="room-tools" hidden><button class="room-code-button" id="copy-room"><span class="live-dot"></span>ROOM <b id="room-code"></b><span>⧉</span></button><button class="text-button" id="leave-room">나가기 ↗</button></div><span class="mode-badge" id="mode-badge"><span>◈</span> 1–4인 협동 <i>·</i> 랜덤 디펜스</span></div><div id="screen"></div></main>
  <div class="toast" id="toast" role="status" hidden></div>
  <div class="reconnect-overlay" hidden><span class="spinner"></span><h2>친구들이 기다리고 있어요</h2><p>연결을 복구하는 중입니다. 내 수호자는 자리를 지켜요.</p></div>
  <dialog id="info-dialog"><button class="dialog-close" aria-label="닫기">×</button><div id="dialog-content"></div></dialog>
  <div class="demo-cursor" hidden></div><div class="demo-caption" hidden><span class="caption-number"></span><div><b></b><p></p></div></div>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const screen = $('screen');
const net = new Transport();
let room: RoomSnapshot | null = null;
let playerId = '';
let mode: ClientMode | null = null;
let screenKind = '';
let modes: ModeInfo[] = [];
let toastTimer: ReturnType<typeof setTimeout>;
let sound = false;
let audio: AudioContext | null = null;
let lastSound = 0;
const dialog = $<HTMLDialogElement>('info-dialog');

function notice(message: string): void {
  const element = $('toast'); element.textContent = message; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 3200);
}
function send(message: Parameters<Transport['send']>[0]): void { if (!net.send(message)) notice('서버에 다시 연결하고 있어요. 잠시 기다려 주세요.'); }
function nickname(): string {
  const input = $<HTMLInputElement>('nickname'); const name = input?.value.trim() ?? localStorage.getItem('heaven.name') ?? '숲지기';
  if (!name) { notice('닉네임을 입력해 주세요.'); input?.focus(); return ''; }
  localStorage.setItem('heaven.name', name); return name;
}
function drawWaiting(canvas: HTMLCanvasElement, members = 0): void {
  canvas.width = 984; canvas.height = 716;
  const ctx = canvas.getContext('2d')!; ctx.drawImage(mapArt(), 0, 0);
  const positions = [[396, 360], [492, 360], [588, 360], [492, 456]];
  for (let i = 0; i < Math.max(3, members); i++) drawGuardian(ctx, positions[i][0], positions[i][1], FAMILIES[i], i === 1 ? 1 : 0, 3.3);
}
function populateModes(): void {
  const select = document.getElementById('mode-choice') as HTMLSelectElement | null;
  if (!select) return;
  const previous = select.value;
  const available = modes.length ? modes : [{ id: DEFENSE_ID, title: '별숲 수호대', subtitle: '', minPlayers: 1, maxPlayers: 4 }];
  select.replaceChildren(...available.map(info => {
    const option = document.createElement('option');
    option.value = info.id; option.textContent = info.title + ' · ' + info.minPlayers + '–' + info.maxPlayers + '인';
    return option;
  }));
  if (available.some(info => info.id === previous)) select.value = previous;
}
function showEntry(): void {
  if (screenKind === 'entry') return;
  mode?.destroy(); mode = null; screenKind = 'entry';
  screen.innerHTML = `<div class="entry-layout"><section class="entry-forest"><canvas aria-label="반딧불 숲과 수호자들"></canvas><div class="entry-story"><span class="eyebrow">A LITTLE LUCK. A LITTLE TEAMWORK.</span><h2>우리, 오늘은<br>이 숲을 지켜볼까?</h2><p>소환하고, 합성하고, 빈틈을 메우세요.<br>이번 행운은 친구들과 함께.</p><span class="forest-tag">✦ &nbsp; 첫 번째 모드 · 별숲 수호대</span></div></section><section class="entry-card panel"><div class="section-label"><span>함께할 준비 됐나요?</span><span>✧</span></div><h2>숲으로 모여요.</h2><p>닉네임만 정하면 준비 끝.<br>방 코드를 나누고 같은 전장에 모이세요.</p><label for="mode-choice">플레이할 모드</label><select id="mode-choice" aria-label="플레이할 모드"></select><label for="nickname">친구들이 부를 이름</label><input id="nickname" maxlength="12" placeholder="숲지기" autocomplete="nickname" /><button class="primary" id="create-room">새로운 방 만들기 <span>↗</span></button><div class="or-divider"><span>초대받았다면</span></div><label for="join-code">방 코드</label><div class="join-row"><input id="join-code" maxlength="5" placeholder="ABCDE" aria-label="방 코드" autocomplete="off" /><button class="secondary" id="join-room">입장</button></div><div class="entry-note"><span>◈</span><p>혼자서도 시작할 수 있어요.<br>최대 4명이 같은 숲을 지켜요.</p></div><div class="build-label">GAME HEAVEN <span>·</span> PROTOTYPE 0.1</div></section></div><p class="entry-footer">같은 방, 새로운 놀이. <span>우리가 만드는 작은 게임천국.</span></p>`;
  drawWaiting(screen.querySelector('canvas')!);
  $<HTMLInputElement>('nickname').value = localStorage.getItem('heaven.name') ?? '숲지기';
  populateModes();
  const code = new URLSearchParams(location.search).get('room'); if (code) $<HTMLInputElement>('join-code').value = code.slice(0, 5).toUpperCase();
  $('create-room').addEventListener('click', () => { const name = nickname(); if (name) send({ type: 'create', name, modeId: $<HTMLSelectElement>('mode-choice').value || modes[0]?.id || DEFENSE_ID }); });
  const join = () => { const name = nickname(); if (!name) return; const code = $<HTMLInputElement>('join-code').value.toUpperCase().trim(); if (code.length !== 5) { notice('다섯 자리 방 코드를 입력해 주세요.'); return; } send({ type: 'join', name, code }); };
  $('join-room').addEventListener('click', join);
  $('join-code').addEventListener('keydown', event => { if (event.key === 'Enter') join(); });
}
function showLobby(): void {
  if (!room) return;
  const host = room.hostId === playerId;
  if (screenKind !== 'lobby') {
    mode?.destroy(); mode = null; screenKind = 'lobby';
    screen.innerHTML = `<div class="entry-layout lobby-layout"><section class="entry-forest lobby-forest"><canvas></canvas><div class="lobby-center"><span class="eyebrow">BEFORE THE FIRST STAR</span><h2>친구를 기다리는 시간도<br>게임의 일부니까.</h2><p>방 코드를 나누고, 함께 출발하세요.</p></div><div class="lobby-map-tag"><i class="live-dot"></i> 반딧불 숲 · 8 웨이브 원정</div></section><section class="entry-card panel lobby-card"><div class="section-label"><span>원정대 대기실</span><span id="lobby-capacity"></span></div><h2>별숲 수호대</h2><p>각자의 수호자, 하나의 전장.<br>65마리가 쌓이기 전에 함께 막아주세요.</p><div id="lobby-players"></div><div class="lobby-rule"><span>✦</span><div><b>이번 원정의 준비물</b><p>소환할 행운, 배치할 센스,<br>그리고 친구를 도울 한 번의 별비.</p></div></div><button class="primary" id="start-game"></button><small class="lobby-start-tip" id="start-tip"></small></section></div>`;
    $('start-game').addEventListener('click', () => {
      if (!room) return;
      if (room.hostId === playerId) send({ type: 'start' });
      else send({ type: 'ready', ready: !room.players.find(p => p.id === playerId)?.ready });
    });
  }
  drawWaiting(screen.querySelector('canvas')!, room.players.length);
  $('lobby-capacity').textContent = `${room.players.length} / 4`;
  $('lobby-players').replaceChildren(...room.players.map(player => {
    const row = document.createElement('div'); row.className = 'lobby-player';
    row.innerHTML = `<div class="avatar" style="--player-color:${player.color}"></div><div class="member-name"><strong></strong><small></small></div><span class="ready-status"></span>`;
    row.querySelector('strong')!.textContent = player.name;
    row.querySelector('small')!.textContent = player.id === playerId ? '나' : '함께할 친구';
    row.querySelector('.ready-status')!.textContent = !player.connected ? '재접속 중' : player.id === room!.hostId ? '방장' : player.ready ? '준비 완료' : '준비 중';
    return row;
  }));
  const self = room.players.find(p => p.id === playerId);
  $('start-game').textContent = host ? room.players.length === 1 ? '혼자 먼저 출발하기 ↗' : '함께 숲으로 출발 ↗' : self?.ready ? '준비 취소' : '준비 완료 ↗';
  $<HTMLButtonElement>('start-game').disabled = host && room.players.some(p => !p.connected || (p.id !== playerId && !p.ready));
  $('start-tip').textContent = host ? '모두 준비되면 방장이 출발할 수 있어요.' : '방장이 출발하면 함께 시작해요.';
}
function render(): void {
  $('room-tools').hidden = !room; $('mode-badge').hidden = !!room;
  if (!room) { showEntry(); return; }
  $('room-code').textContent = room.code;
  document.querySelector('h1')!.textContent = modes.find(info => info.id === room!.modeId)?.title ?? room.modeId;
  if (room.phase === 'lobby') { showLobby(); return; }
  if (screenKind !== `mode:${room.modeId}`) {
    mode?.destroy(); mode = null; screenKind = `mode:${room.modeId}`;
    const factory = clientModes.get(room.modeId);
    if (!factory) { screen.textContent = '이 모드를 표시할 수 없습니다. 게임을 새로고침해 주세요.'; return; }
    mode = factory({ element: screen, playerId, players: room.players, command: action => {
      if (!net.command(action)) notice('다시 연결하고 있어요. 연결 후 조작해 주세요.');
    }, notice });
    $('return-lobby')?.addEventListener('click', () => send({ type: 'lobby' }));
  }
  mode?.update(room);
}
function tone(ok: boolean): void {
  if (!sound || performance.now() - lastSound < 100) return;
  lastSound = performance.now(); audio ??= new AudioContext(); void audio.resume();
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(ok ? 660 : 170, audio.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(ok ? 990 : 120, audio.currentTime + 0.1);
  gain.gain.setValueAtTime(0.04, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.14);
  oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + 0.15);
}
net.addEventListener('message', event => {
  const message = (event as CustomEvent<ServerMessage>).detail;
  if (message.type === 'welcome') { modes = message.modes; populateModes(); }
  if (message.type === 'joined') { room = message.room; playerId = message.playerId; render(); }
  if (message.type === 'state') { room = message.room; render(); }
  if (message.type === 'error') notice(message.message);
  if (message.type === 'ack') { tone(message.ok); if (!message.ok) notice(message.error ?? '명령을 처리하지 못했어요.'); }
  if (message.type === 'left') { room = null; playerId = ''; render(); }
});
function connectionState(): void {
  $('connection').classList.toggle('connected', net.connected);
  $('connection').querySelector('span')!.textContent = net.connected ? `연결됨${net.latency ? ` · ${net.latency}ms` : ''}` : '다시 연결 중';
  document.querySelector<HTMLElement>('.reconnect-overlay')!.hidden = net.connected || !room;
}
net.addEventListener('connection', connectionState); net.addEventListener('latency', connectionState);
net.addEventListener('sessionExpired', () => { room = null; playerId = ''; render(); connectionState(); });
net.addEventListener('replaced', () => { room = null; playerId = ''; render(); notice('다른 창에서 이 원정대에 접속했어요.'); });
$('copy-room').addEventListener('click', async () => {
  if (!room) return;
  try { await navigator.clipboard.writeText(`${location.origin}/?room=${room.code}`); notice(`초대 링크를 복사했어요. 방 코드 ${room.code}`); }
  catch { notice(`친구에게 방 코드 ${room.code}를 알려주세요.`); }
});
$('leave-room').addEventListener('click', () => {
  $('dialog-content').innerHTML = '<p class="eyebrow">LEAVE EXPEDITION</p><h2>원정대에서 나갈까요?</h2><p>진행 중인 내 수호자는 전장에서 철수해요.</p><div class="dialog-actions"><button class="secondary" id="stay">계속 함께하기</button><button class="primary" id="confirm-leave">나가기</button></div>';
  dialog.showModal(); $('stay').onclick = () => dialog.close(); $('confirm-leave').onclick = () => { send({ type: 'leave' }); dialog.close(); };
});
$('sound-toggle').addEventListener('click', () => {
  sound = !sound; $('sound-toggle').classList.toggle('sound-on', sound);
  $('sound-toggle').setAttribute('aria-label', sound ? '효과음 끄기' : '효과음 켜기');
  $('sound-toggle').setAttribute('title', sound ? '효과음 끄기' : '효과음 켜기'); tone(true);
});
$('play-nav').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
$('catalog-nav').addEventListener('click', () => {
  $('dialog-content').innerHTML = `<p class="eyebrow">GUARDIAN FIELD GUIDE</p><h2>숲을 지키는 작은 친구들.</h2><p>같은 종류·등급의 내 수호자 2명을 합성하면 다음 등급이 됩니다.</p><div class="catalog-grid">${FAMILIES.map(family => `<article><img src="${portrait(family)}" alt="${FAMILIES_INFO[family].name}" /><h3>${FAMILIES_INFO[family].name}</h3><p>${FAMILIES_INFO[family].role}</p><small>공격 ${FAMILIES_INFO[family].damage} · 주기 ${FAMILIES_INFO[family].interval}초</small></article>`).join('')}</div><div class="rarity-guide">${RARITIES.map(rank => `<span style="color:${rank.color}">✦ ${rank.name} ${rank.chance * 100}%</span>`).join('')}</div><p class="dialog-note">일반이 9회 연속 나오면 다음 소환은 희귀 이상이 보장됩니다. 합성 결과의 종류는 유지됩니다.</p>`;
  dialog.showModal();
});
$('help').addEventListener('click', () => {
  $('dialog-content').innerHTML = '<p class="eyebrow">HOW TO PROTECT THE WOODS</p><h2>행운에 배치를 더하세요.</h2><ol class="help-list"><li><b>소환</b><p><kbd>Q</kbd> 또는 소환 버튼. 마우스가 가리키는 빈 칸에 소환합니다.</p></li><li><b>배치와 합성</b><p>수호자를 클릭하면 사거리가 보입니다. 드래그하거나 선택 후 우클릭해서 이동하세요. 같은 내 수호자에게 드래그하면 합성됩니다.</p></li><li><b>함께 막기</b><p>수호자는 자동으로 공격합니다. <kbd>W</kbd>로 내 수호자 전체 강화, <kbd>E</kbd>로 별비를 선택한 뒤 전장을 클릭하세요. <kbd>ESC</kbd>로 취소합니다.</p></li><li><b>승리와 패배</b><p>8웨이브의 모든 적을 막으면 승리. 몬스터 65마리가 쌓이거나 보스 제한 시간이 끝나면 패배합니다.</p></li></ol>';
  dialog.showModal();
});
dialog.querySelector('.dialog-close')!.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
showEntry();
window.addEventListener('beforeunload', () => { net.destroy(); });

// Read-only inspection and captions for reproducible recordings, enabled only with ?record=1.
if (new URLSearchParams(location.search).get('record') === '1') {
  Object.assign(window, { __review: {
    snapshot: () => structuredClone({ room, playerId }),
    caption: (number: string, title: string, text: string) => {
      const box = document.querySelector<HTMLElement>('.demo-caption')!; box.hidden = !title;
      box.querySelector('.caption-number')!.textContent = number; box.querySelector('b')!.textContent = title; box.querySelector('p')!.textContent = text;
    },
  } });
  const cursor = document.querySelector<HTMLElement>('.demo-cursor')!; cursor.hidden = false;
  window.addEventListener('pointermove', event => { cursor.style.left = `${event.clientX}px`; cursor.style.top = `${event.clientY}px`; });
  window.addEventListener('pointerdown', () => { cursor.classList.add('click'); setTimeout(() => cursor.classList.remove('click'), 240); });
}
