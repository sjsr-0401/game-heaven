import './style.css';
import { setSoundEnabled, playUiSound } from './core/audio.js';
import { DEFENSE_ID, FAMILIES, FAMILIES_INFO, RARITIES } from '../shared/defense.js';
import type { ModeInfo, RoomSnapshot, ServerMessage } from '../shared/protocol.js';
import { Transport } from './core/transport.js';
import { clientModes } from './modes/registry.js';
import type { ClientMode } from './modes/types.js';
import { drawGuardian, mapArt, portrait } from './modes/starwood/art.js';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="topbar"><div class="topbar-inner"><a class="brand" href="/" aria-label="게임천국 홈"><span class="brand-mark">✦</span><span>게임천국<small>GAME HEAVEN</small></span></a><nav aria-label="메인 메뉴"><button class="nav-link current" id="play-nav">게임하기</button><button class="nav-link" id="catalog-nav">용병 도감</button></nav><div class="topbar-right"><span class="connection" id="connection"><i></i><span>서버 연결 중</span></span><span class="header-divider"></span><button class="icon-button" id="sound-toggle" aria-label="효과음 켜기" title="효과음 켜기">♫<span class="sound-off">/</span></button><button class="icon-button" id="help" aria-label="도움말">?</button><span class="profile-icon">나</span></div></div></header>
  <main class="workspace"><div class="page-heading"><div><div class="breadcrumb">게임천국 <span>/</span> 개인 운빨 디펜스</div><div class="title-line"><h1>밤의 용병단</h1><span class="alpha-badge">NIGHTWATCH / 0.2</span></div><p>각자의 전장. 끝까지 버티게 할 한 번의 행운.</p></div><div class="room-tools" id="room-tools" hidden><button class="room-code-button" id="copy-room"><span class="live-dot"></span>ROOM <b id="room-code"></b><span>⧉</span></button><button class="text-button" id="leave-room">나가기 ↗</button></div><span class="mode-badge" id="mode-badge"><span>◈</span> 1–4인 개인전 <i>·</i> 랜덤 디펜스</span></div><div id="screen"></div></main>
  <div class="toast" id="toast" role="status" hidden></div>
  <div class="reconnect-overlay" hidden><span class="spinner"></span><h2>친구들이 기다리고 있어요</h2><p>연결을 복구하는 중입니다. 내 용병는 자리를 지켜요.</p></div>
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
const dialog = $<HTMLDialogElement>('info-dialog');

function notice(message: string): void {
  const element = $('toast'); element.textContent = message; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 3200);
}
function send(message: Parameters<Transport['send']>[0]): void { if (!net.send(message)) notice('서버에 다시 연결하고 있어요. 잠시 기다려 주세요.'); }
function nickname(): string {
  const input = $<HTMLInputElement>('nickname'); const name = input?.value.trim() ?? localStorage.getItem('heaven.name') ?? '떠돌이';
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
  const available = modes.length ? modes : [{ id: DEFENSE_ID, title: '밤의 용병단', subtitle: '', minPlayers: 1, maxPlayers: 4 }];
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
  screen.innerHTML = `<div class="entry-layout"><section class="entry-forest"><canvas aria-label="잿빛 성채와 사람형 용병들"></canvas><div class="entry-story"><span class="eyebrow">YOUR FIELD. YOUR FORTUNE.</span><h2>오늘 밤의 운명을<br>뽑아볼까?</h2><p>사수, 연금술사, 검사, 술사.<br>어떤 용병이 내 성채를 지키게 될까.</p><span class="forest-tag">✦ &nbsp; 첫 번째 모드 · 밤의 용병단</span></div></section><section class="entry-card panel"><div class="section-label"><span>오늘의 운을 시험할까요?</span><span>✧</span></div><h2>용병단을 모집합니다.</h2><p>닉네임만 정하면 준비 끝.<br>방 코드를 나누고 각자의 전장에서 겨루세요.</p><label for="mode-choice">플레이할 모드</label><select id="mode-choice" aria-label="플레이할 모드"></select><label for="nickname">친구들이 부를 이름</label><input id="nickname" maxlength="12" placeholder="떠돌이" autocomplete="nickname" /><button class="primary" id="create-room">새로운 방 만들기 <span>↗</span></button><div class="or-divider"><span>초대받았다면</span></div><label for="join-code">방 코드</label><div class="join-row"><input id="join-code" maxlength="5" placeholder="ABCDE" aria-label="방 코드" autocomplete="off" /><button class="secondary" id="join-room">입장</button></div><div class="entry-note"><span>◈</span><p>혼자서도 시작할 수 있어요.<br>최대 4명 · 전장과 골드, 승패는 개인별.</p></div><div class="build-label">GAME HEAVEN <span>·</span> PROTOTYPE 0.2</div></section></div><p class="entry-footer">같은 방, 새로운 놀이. <span>우리가 만드는 작은 게임천국.</span></p>`;
  drawWaiting(screen.querySelector('canvas')!);
  $<HTMLInputElement>('nickname').value = localStorage.getItem('heaven.name') ?? '떠돌이';
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
    screen.innerHTML = `<div class="entry-layout lobby-layout"><section class="entry-forest lobby-forest"><canvas></canvas><div class="lobby-center"><span class="eyebrow">BEFORE THE FIRST RAID</span><h2>친구를 기다리는 시간도<br>게임의 일부니까.</h2><p>방 코드를 나누고, 각자의 운명을 시험하세요.</p></div><div class="lobby-map-tag"><i class="live-dot"></i> 잿빛 성채 · 10웨이브 개인전</div></section><section class="entry-card panel lobby-card"><div class="section-label"><span>개인전 대기실</span><span id="lobby-capacity"></span></div><h2>밤의 용병단</h2><p>각자의 용병, 각자의 전장.<br>내 몬스터 55마리 누적 또는 보스 시간 초과 시 패배.</p><div id="lobby-players"></div><div class="lobby-rule"><span>✦</span><div><b>내 성채를 지키는 방법</b><p>골드로 용병을 소환하고 배치하세요.<br>친구가 탈락해도 내 전투는 계속됩니다.</p></div></div><button class="primary" id="start-game"></button><small class="lobby-start-tip" id="start-tip"></small></section></div>`;
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
  $('start-game').textContent = host ? room.players.length === 1 ? '혼자 먼저 출발하기 ↗' : '개인전 시작하기 ↗' : self?.ready ? '준비 취소' : '준비 완료 ↗';
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
function tone(ok: boolean): void { if(!ok) playUiSound(); }
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
net.addEventListener('replaced', () => { room = null; playerId = ''; render(); notice('다른 창에서 이 방에 접속했어요.'); });
$('copy-room').addEventListener('click', async () => {
  if (!room) return;
  try { await navigator.clipboard.writeText(`${location.origin}/?room=${room.code}`); notice(`초대 링크를 복사했어요. 방 코드 ${room.code}`); }
  catch { notice(`친구에게 방 코드 ${room.code}를 알려주세요.`); }
});
$('leave-room').addEventListener('click', () => {
  $('dialog-content').innerHTML = '<p class="eyebrow">LEAVE ROOM</p><h2>방에서 나갈까요?</h2><p>진행 중인 내 용병는 전장에서 철수해요.</p><div class="dialog-actions"><button class="secondary" id="stay">계속하기</button><button class="primary" id="confirm-leave">나가기</button></div>';
  dialog.showModal(); $('stay').onclick = () => dialog.close(); $('confirm-leave').onclick = () => { send({ type: 'leave' }); dialog.close(); };
});
$('sound-toggle').addEventListener('click', () => {
  sound = !sound; setSoundEnabled(sound); $('sound-toggle').classList.toggle('sound-on', sound);
  $('sound-toggle').setAttribute('aria-label', sound ? '효과음 끄기' : '효과음 켜기');
  $('sound-toggle').setAttribute('title', sound ? '효과음 끄기' : '효과음 켜기'); tone(true);
});
$('play-nav').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
$('catalog-nav').addEventListener('click', () => {
  $('dialog-content').innerHTML = `<p class="eyebrow">MERCENARY FIELD GUIDE</p><h2>사람들이 지키는 마지막 밤.</h2><p>4개 직업과 5개 등급. 장비와 공격 방식이 다른 사람형 용병을 소환하세요.</p><div class="catalog-grid">${FAMILIES.map(family => `<article><img src="${portrait(family)}" alt="${FAMILIES_INFO[family].name}" /><h3>${FAMILIES_INFO[family].name}</h3><p>${FAMILIES_INFO[family].role}</p><small>공격 ${FAMILIES_INFO[family].damage} · 주기 ${FAMILIES_INFO[family].interval}초</small></article>`).join('')}</div><div class="rarity-guide">${RARITIES.map(rank => `<span style="color:${rank.color}">✦ ${rank.name} ${+(rank.chance * 100).toFixed(2)}%</span>`).join('')}</div><p class="dialog-note">표시는 일반 소환 확률입니다. 전투 화면의 ‘소환 확률 보기’에서 승부 소환의 확률도 확인할 수 있습니다. 보장 소환과 합성은 없습니다.</p>`;
  dialog.showModal();
});
$('help').addEventListener('click', () => {
  $('dialog-content').innerHTML = '<p class="eyebrow">HOW TO SURVIVE THE NIGHT</p><h2>내 전장, 내 운명.</h2><ol class="help-list"><li><b>용병 소환</b><p><kbd>Q</kbd> 일반 소환 40 G. <kbd>R</kbd> 승부 소환 120 G. 승부 소환도 일반이 나올 수 있으며 확률표를 공개합니다.</p></li><li><b>배치와 성장</b><p>용병을 클릭하면 사거리가 보입니다. 드래그 또는 선택 후 우클릭으로 재배치합니다. 최대 16명이며 해고하면 일부 골드를 돌려받습니다. <kbd>W</kbd> 전원 강화, <kbd>E</kbd> 포격 조준 후 클릭. <kbd>ESC</kbd> 조준 취소.</p></li><li><b>개인전과 관전</b><p>같은 방에 있어도 몬스터·용병·골드·승패는 각각입니다. 오른쪽 플레이어를 클릭해 전장을 관전하고, 나를 클릭하면 돌아옵니다. 관전 중에는 명령을 보낼 수 없습니다.</p></li><li><b>승리와 패배</b><p>10웨이브 방어 성공 시 개인 승리. 내 전장에 몬스터 55마리 누적 또는 보스 제한 시간 초과 시 개인 패배입니다. 모두 종료되면 방장이 대기실로 돌아갈 수 있습니다.</p></li></ol>';
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
