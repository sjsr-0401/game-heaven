import './style.css';
import {Transport} from './core/transport.js';
import {setSoundEnabled,playUiSound,finishAudioRecording} from './core/audio.js';
import {EscapeScene} from './modes/escape/scene.js';
import {EscapeView} from './modes/escape/view.js';
import {ESCAPE_ID,type EscapeState} from '../shared/escape.js';
import type {RoomSnapshot,ServerMessage} from '../shared/protocol.js';

const app=document.querySelector<HTMLDivElement>('#app')!;
const houseIcon='<svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M6 20 20 8l14 12M10 18v14h20V18M17 32V21h7v11" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="m2 27 4-2m-2 9 5-2m22 3h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
app.innerHTML='<div id="menu-world"></div><div class="menu-shade"></div><header class="topbar"><a class="brand" href="/" aria-label="집째로 도망 홈">'+houseIcon+'<span>집째로 도망<small>HOUSEFLIGHT</small></span></a><div class="topbar-tools"><span class="connection" id="connection"><i></i><span>연결 중</span></span><button id="copy-room" class="room-pill" hidden>ROOM <b></b> ⧉</button><button id="sound-toggle" class="round-button" aria-label="효과음 켜기">♫<span class="muted-slash">／</span></button><button id="graphics-toggle" class="graphics-button" aria-label="그래픽 절전 모드 전환">고화질</button><button id="help" class="round-button" aria-label="도움말">?</button><button id="leave-room" class="quiet-button" hidden>방 나가기 ↗</button></div></header>'
  +'<main id="screen"></main><div class="toast" id="toast" role="status" hidden></div><div class="connection-overlay" hidden><span class="loader"></span><h2>집과 다시 연결하고 있어요.</h2><p>잠시만 기다려 주세요. 같은 자리로 돌아갑니다.</p></div><dialog id="help-dialog"><button class="close-dialog" aria-label="닫기">×</button><span class="small-label">YOUR HOME. YOUR CREW.</span><h2>갈고리 하나로,<br>같이 살아남자.</h2><p>집은 자동으로 달립니다. 길을 막은 장애물을 치우고, 마지막 방벽까지 우리 집을 지켜 주세요.</p><dl><div><dt>W A S D / 방향키</dt><dd>이동</dd></div><div><dt>좌클릭 유지</dt><dd>갈고리 · 회수 / 공격 / 쓰러진 동료 구조</dd></div><div><dt>우클릭</dt><dd>들고 있는 물체 투척 · 빈손이면 밀치기</dd></div><div><dt>E / Q</dt><dd>장착·설치 / 내려놓기</dd></div><div><dt>Space / F</dt><dd>회피 / 위치 알리기</dd></div></dl><p class="help-note">고철은 집 근처에서 납품, 축전지는 엔진 가속, 수리 가방은 집과 동료 회복. 화약통은 던지거나 집에서 박격포로 발사할 수 있어요. 쓰러진 친구를 조준하고 갈고리를 쏘면 즉시 구조합니다.</p><button class="primary close-help">알겠어, 출발하자 ↗</button></dialog><div class="review-caption" hidden><span></span><strong></strong><p></p></div>';

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const net=new Transport();let room:RoomSnapshot|null=null,playerId='',view:EscapeView|null=null,menu:EscapeScene|null=null,screenKind='',sound=false;
let toastTimer:ReturnType<typeof setTimeout>;
function notice(message:string):void{const toast=$('toast');toast.textContent=message;toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.hidden=true,3000);}
function send(message:Parameters<Transport['send']>[0]):void{if(!net.send(message))notice('서버에 연결한 뒤 다시 시도해 주세요.');}
function name():string{
  const value=$<HTMLInputElement>('nickname')?.value.trim()??localStorage.getItem('heaven.name')??'도망자';
  if(!value){notice('친구들이 부를 이름을 입력하세요.');$('nickname')?.focus();return'';}
  localStorage.setItem('heaven.name',value);return value;
}
function ensureMenu():void {
  $('menu-world').hidden=false;document.querySelector<HTMLElement>('.menu-shade')!.hidden=false;app.classList.remove('in-game');
  if(!menu)try{menu=new EscapeScene($('menu-world'));}catch{notice('3D 화면을 준비하지 못했어요. WebGL을 지원하는 브라우저를 사용해 주세요.');}
}
function entry():void{
  if(screenKind==='entry')return;view?.destroy();view=null;screenKind='entry';ensureMenu();
  $('screen').innerHTML='<div class="entry-content"><div class="entry-copy"><span class="eyebrow"><i></i> 2–4인 온라인 협동 액션</span><h1>집은 두고<br>갈 수 없잖아.</h1><p>폭풍은 오고, 집은 달리고.<br>갈고리 하나로 함께 만드는 아슬아슬한 탈출.</p><div class="feature-tags"><span>끌어오고</span><i>·</i><span>던지고</span><i>·</i><span>서로를 구하고</span></div></div><section class="entry-card"><div class="card-heading"><span>오늘의 도주 멤버는?</span><small>01 / JOIN THE CREW</small></div><label for="nickname">친구들이 부를 이름</label><input id="nickname" maxlength="12" autocomplete="nickname" placeholder="도망자"/><button class="primary" id="create-room">우리 집 출발 준비 <span>↗</span></button><div class="join-divider">초대받았다면</div><div class="join-row"><input id="join-code" maxlength="5" autocomplete="off" placeholder="방 코드 5자리" aria-label="방 코드"/><button id="join-room">합류하기 ↗</button></div><p class="entry-note">친구 한 명만 더 있으면 출발.<br>최대 4명 · 한 집 · 같은 목적지.</p></section></div><div class="scene-location"><i></i><div><span>먼지의 외곽 / DUSTBOUND OUTSKIRTS</span><p>오늘도, 우리의 집은 움직인다.</p></div><small>HOUSEFLIGHT · 1.0</small></div>';
  $<HTMLInputElement>('nickname').value=localStorage.getItem('heaven.name')??'도망자';
  const code=new URLSearchParams(location.search).get('room');if(code)$<HTMLInputElement>('join-code').value=code.slice(0,5).toUpperCase();
  $('create-room').onclick=()=>{const n=name();if(n){playUiSound();send({type:'create',name:n,modeId:ESCAPE_ID});}};
  const join=()=>{const n=name(),code=$<HTMLInputElement>('join-code').value.trim().toUpperCase();if(!n)return;if(code.length!==5){notice('방 코드 다섯 자리를 입력하세요.');return;}send({type:'join',name:n,code});};
  $('join-room').onclick=join;$('join-code').onkeydown=e=>{if(e.key==='Enter')join();};
}
function lobby():void {
  if(!room)return;const host=room.hostId===playerId,others=room.players.filter(p=>p.id!==room!.hostId),ready=room.players.length>=2&&room.players.every(p=>p.connected)&&others.every(p=>p.ready);
  if(screenKind!=='lobby'){view?.destroy();view=null;screenKind='lobby';ensureMenu();$('screen').innerHTML='<div class="lobby-layout"><div class="lobby-story"><span class="eyebrow">BEFORE THE STORM</span><h1>이번에도,<br>같이 가자.</h1><p>누군가는 길을 뚫고,<br>누군가는 친구를 끌어올리고.</p><div class="lobby-code"><span>친구에게 이 코드를 보내세요</span><button id="lobby-copy"></button></div></div><section class="lobby-card entry-card"><div class="card-heading"><span>우리의 도주 팀</span><small id="crew-count"></small></div><div id="lobby-members"></div><div class="lobby-mission"><span>이번 원정</span><b>먼지의 외곽 → 마지막 방벽</b><p>길을 열고, 집을 개조하고, 추격자를 떼어 내세요.</p></div><button id="ready-start" class="primary"></button><p id="lobby-note"></p></section></div>';$('lobby-copy').onclick=copyCode;}
  $('crew-count').textContent=room.players.length+' / 4';$('lobby-copy').textContent=room.code+' ⧉';
  const members=$('lobby-members');members.replaceChildren();
  for(let i=0;i<4;i++){
    const p=room.players[i],row=document.createElement('div');row.className='lobby-member'+(p?'':' empty');
    if(p){const orb=document.createElement('i');orb.style.background=p.color;const label=document.createElement('b');label.textContent=p.name+(p.id===playerId?' · 나':'');const state=document.createElement('span');state.textContent=!p.connected?'재접속 중':p.id===room.hostId?'방장':p.ready?'준비 완료':'준비 중';row.append(orb,label,state);}
    else row.innerHTML='<i>+</i><span>친구의 자리</span>';members.append(row);
  }
  const button=$<HTMLButtonElement>('ready-start'),self=room.players.find(p=>p.id===playerId)!;
  button.disabled=host&&!ready;button.textContent=host?'모두 탑승! 출발하기 ↗':self.ready?'준비 취소':'준비 완료 ↗';
  button.onclick=()=>send(host?{type:'start'}:{type:'ready',ready:!self.ready});
  $('lobby-note').textContent=room.players.length<2?'친구 한 명이 더 합류하면 출발할 수 있어요.':host&&!ready?'친구들이 준비되면 출발할 수 있어요.':host?'갈고리와 마음의 준비, 모두 끝.':'방장이 출발을 준비합니다.';
}
function render():void {
  const inRoom=!!room;$('copy-room').hidden=!inRoom;$('leave-room').hidden=!inRoom;
  if(room)$('copy-room').querySelector('b')!.textContent=room.code;
  if(!room){entry();return;}
  if(room.phase==='lobby'){lobby();return;}
  if(screenKind!=='playing'){
    menu?.destroy();menu=null;$('menu-world').hidden=true;document.querySelector<HTMLElement>('.menu-shade')!.hidden=true;app.classList.add('in-game');screenKind='playing';
    try{view=new EscapeView({element:$('screen'),playerId,players:room.players,command:action=>{if(net.connected)net.command(action);},notice});}
    catch(error){notice('3D 화면을 시작하지 못했어요. '+String(error));return;}
  }
  view?.update(room);
}
net.addEventListener('message',event=>{
  const message=(event as CustomEvent<ServerMessage>).detail;
  if(message.type==='joined'){playerId=message.playerId;room=message.room;render();}
  if(message.type==='state'){room=message.room;render();}
  if(message.type==='left'){room=null;playerId='';render();}
  if(message.type==='error')notice(message.message);
  if(message.type==='ack'&&!message.ok&&message.error)notice(message.error);
});
net.addEventListener('connection',event=>{
  const connected=(event as CustomEvent<{connected:boolean}>).detail.connected;
  $('connection').classList.toggle('online',connected);$('connection').querySelector('span')!.textContent=connected?'온라인':'연결 중';
  document.querySelector<HTMLElement>('.connection-overlay')!.hidden=connected||!room;
});
net.addEventListener('sessionExpired',()=>{room=null;playerId='';screenKind='';render();notice('이전 원정이 종료됐어요. 새 방에서 다시 만나요.');});
net.addEventListener('replaced',()=>{room=null;playerId='';screenKind='';render();notice('다른 창에서 같은 캐릭터로 접속했어요.');});
async function copyCode():Promise<void>{if(!room)return;try{await navigator.clipboard.writeText(room.code);notice('방 코드 '+room.code+' 복사 완료');}catch{notice('친구에게 '+room.code+' 코드를 보내세요.');}}
$('copy-room').onclick=copyCode;$('leave-room').onclick=()=>send({type:'leave'});
$('screen').addEventListener('return-lobby',()=>send({type:'lobby'}));
$('sound-toggle').onclick=()=>{sound=!sound;setSoundEnabled(sound);$('sound-toggle').classList.toggle('sound-on',sound);$('sound-toggle').setAttribute('aria-label',sound?'효과음 끄기':'효과음 켜기');playUiSound();};
const graphicsParam=new URLSearchParams(location.search).get('graphics');if(graphicsParam==='economy')localStorage.setItem('houseflight.graphics','economy');
let economy=localStorage.getItem('houseflight.graphics')==='economy';$('graphics-toggle').textContent=economy?'절전':'고화질';$('graphics-toggle').onclick=()=>{economy=!economy;localStorage.setItem('houseflight.graphics',economy?'economy':'high');$('graphics-toggle').textContent=economy?'절전':'고화질';menu?.setEconomy(economy);view?.scene.setEconomy(economy);};
const help=$<HTMLDialogElement>('help-dialog');$('help').onclick=()=>help.showModal();help.querySelector('.close-dialog')!.addEventListener('click',()=>help.close());help.querySelector('.close-help')!.addEventListener('click',()=>help.close());
help.addEventListener('click',e=>{if(e.target===help)help.close();});
entry();
declare global {interface Window {__review?:{snapshot:()=>{room:RoomSnapshot|null;playerId:string};project:(x:number,z:number,y?:number)=>{x:number;y:number;visible:boolean}|null;metrics:()=>{fps:number;drawCalls:number;triangles:number}|null;audio:typeof finishAudioRecording;caption:(title:string,description:string)=>void}}}
if(new URLSearchParams(location.search).has('review'))window.__review={
  snapshot:()=>({room:room?JSON.parse(JSON.stringify(room)):null,playerId}),
  project:(x,z,y)=>{if(!view)return null;if(y===undefined){const state=room?.game as EscapeState|undefined;const deck=state&&Math.abs(x)<4.6&&Math.abs(z-state.house.z)<5.6;y=(deck?1.61:0)+.8;}const point=view.scene.project(x,z,y),rect=view.scene.canvas.getBoundingClientRect();return{x:point.x+rect.left,y:point.y+rect.top,visible:point.visible};},
  metrics:()=>view?.scene.metrics()??null,audio:finishAudioRecording,
  caption:(title,description)=>{const el=document.querySelector<HTMLElement>('.review-caption')!;el.hidden=!title;el.querySelector('span')!.textContent='REAL GAMEPLAY / 실제 플레이';el.querySelector('strong')!.textContent=title;el.querySelector('p')!.textContent=description;}
};
