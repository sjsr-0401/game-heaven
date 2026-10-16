import {crewPortrait,toolIcon} from './ui-art.js';
import {EscapeScene} from './scene.js';
import {playEscapeEvent,advanceEscapeAudio,setGameAudioPlayer} from '../../core/audio.js';
import {PROP_INFO,UPGRADE_INFO,upgradeCost,targetProgress,dist,type EscapeState,type UpgradeId,type EscapeEvent} from '../../../shared/escape.js';
import type {RoomSnapshot} from '../../../shared/protocol.js';
import type {ModeContext,ClientMode} from '../types.js';
const escape=(v:unknown)=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export class EscapeView implements ClientMode {
  readonly scene:EscapeScene;
  private state:EscapeState|null=null;private room:RoomSnapshot|null=null;private keys=new Set<string>();private mouse={x:0,z:8};
  private pointer:{x:number;y:number}|null=null;private pressed=false;private nextHook=0;private raf=0;private lastInput=0;private lastHud=0;private lastPhase='';private campKey='';private abort=new AbortController();
  private labels:HTMLDivElement;private floats:HTMLDivElement;private heldLabel:HTMLElement;
  constructor(private context:ModeContext){
    context.element.innerHTML='<div class="playfield"><div class="world"></div><div class="world-vignette"></div><div class="world-labels"></div><div class="float-layer"></div>'
      +'<div class="mission-hud"><div class="mission-title"><span class="small-label" id="stage-label">01 / 먼지의 외곽</span><strong id="objective">집과 함께 앞으로!</strong><span id="sub-objective">길을 뚫고, 서로를 끌어올리세요.</span></div>'
      +'<div class="house-status"><span>우리의 집 <b id="hull-text"></b></span><div class="hull-track"><i id="hull-bar"></i></div><small id="engine-status">자동 주행</small></div>'
      +'<div class="journey-status"><span id="journey-time">00:00</span><div class="journey-track"><i id="journey-bar"></i></div><small id="distance-text">방벽까지 140 m</small></div></div>'
      +'<div class="crew-hud"></div><div class="supply-count"><span>'+toolIcon('parts')+'</span><b id="stock">2</b><small>공용 부품</small></div>'
      +'<div class="boss-hud" hidden><span>고철 포식자 <b id="boss-percent"></b></span><div><i id="boss-bar"></i></div><small id="boss-hint">흡입할 때 화약통을 던지세요</small></div>'
      +'<div class="context-hint" id="context-hint"></div><div class="event-announcement" hidden><span></span><strong></strong></div>'
      +'<div class="controls-hud"><div class="key-guide"><span><kbd>W A S D</kbd> 이동</span><span><kbd>좌클릭 유지</kbd> 갈고리</span><span><kbd>우클릭</kbd> 투척 / 밀치기</span><span><kbd>Space</kbd> 회피</span></div>'
      +'<div class="carried-item" id="held-item"><span class="item-orb">'+toolIcon('hand')+'</span><div><small>빈손</small><strong>좌클릭으로 물건을 회수하세요</strong></div></div>'
      +'<div class="action-guide"><button id="install-action"><kbd>E</kbd><span>장착 / 설치</span></button><button id="drop-action"><kbd>Q</kbd><span>내려놓기</span></button><button id="dodge-action"><kbd>Space</kbd><span id="dodge-status">회피 준비</span></button></div></div>'
      +'<div class="camp-overlay" hidden></div><div class="results-overlay" hidden></div><div class="aim-reticle" hidden></div></div>';
    setGameAudioPlayer(context.playerId);
    const root=context.element;this.labels=root.querySelector('.world-labels')!;this.floats=root.querySelector('.float-layer')!;this.heldLabel=root.querySelector('#held-item')!;
    this.scene=new EscapeScene(root.querySelector('.world')!);this.scene.setOwnId(context.playerId);this.scene.onEvent(e=>this.onEvent(e));
    const opts={signal:this.abort.signal};
    window.addEventListener('keydown',e=>{
      if(this.state&&(this.state.phase==='won'||this.state.phase==='lost'))return;
      if(document.querySelector('dialog[open]')||(e.target as HTMLElement).matches('input,textarea,select')||e.repeat&&['e','q',' ','f'].includes(e.key.toLowerCase()))return;
      if([' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))e.preventDefault();
      this.keys.add(e.key.toLowerCase());
      if(e.key.toLowerCase()==='e')context.command({kind:'install'});
      if(e.key.toLowerCase()==='q')context.command({kind:'drop'});
      if(e.key===' ')context.command({kind:'dodge'});
      if(e.key.toLowerCase()==='f')context.command({kind:'ping',...this.mouse});
    },opts);
    window.addEventListener('keyup',e=>this.keys.delete(e.key.toLowerCase()),opts);
    window.addEventListener('blur',()=>{this.keys.clear();this.pressed=false;this.sendMotion();},opts);
    const point=(e:PointerEvent)=>{this.pointer={x:e.clientX,y:e.clientY};this.updateAim();};
    this.scene.canvas.addEventListener('pointermove',point,opts);
    this.scene.canvas.addEventListener('pointerleave',()=>{this.pointer=null;this.pressed=false;root.querySelector<HTMLElement>('.aim-reticle')!.hidden=true;},opts);
    this.scene.canvas.addEventListener('pointerdown',e=>{
      point(e);this.scene.canvas.focus();if(e.button===0){this.pressed=true;this.hook();}if(e.button===2)context.command({kind:'throw',...this.mouse});e.preventDefault();
    },opts);
    window.addEventListener('pointerup',()=>{this.pressed=false;},opts);
    this.scene.canvas.addEventListener('contextmenu',e=>e.preventDefault(),opts);
    root.querySelector('#install-action')!.addEventListener('click',()=>context.command({kind:'install'}),opts);
    root.querySelector('#drop-action')!.addEventListener('click',()=>context.command({kind:'drop'}),opts);
    root.querySelector('#dodge-action')!.addEventListener('click',()=>context.command({kind:'dodge'}),opts);
    root.addEventListener('click',e=>{
      const button=(e.target as HTMLElement).closest<HTMLButtonElement>('button[data-upgrade],button[data-route],button[data-lobby]');
      if(!button)return;
      if(button.dataset.upgrade)context.command({kind:'upgrade',upgrade:button.dataset.upgrade});
      if(button.dataset.route)context.command({kind:'vote',route:button.dataset.route});
      if(button.hasAttribute('data-lobby'))root.dispatchEvent(new CustomEvent('return-lobby',{bubbles:true}));
    },opts);
    this.loop();
  }
  private updateAim():void {
    if(!this.pointer)return;
    this.mouse=this.scene.world(this.pointer.x,this.pointer.y);this.scene.setAim(this.mouse);
    const reticle=this.context.element.querySelector<HTMLElement>('.aim-reticle')!,rect=this.scene.canvas.getBoundingClientRect();
    reticle.hidden=false;reticle.style.left=(this.pointer.x-rect.left)+'px';reticle.style.top=(this.pointer.y-rect.top)+'px';
  }
  private hook():void {if(!this.state||this.state.phase!=='travel'){this.pressed=false;return;}this.updateAim();this.context.command({kind:'hook',...this.mouse});this.nextHook=performance.now()+520;}
  private motion():{x:number;z:number} {
    if(document.querySelector('dialog[open]')||!this.state||this.state.phase==='won'||this.state.phase==='lost')return{x:0,z:0};
    const horizontal=Number(this.keys.has('d')||this.keys.has('arrowright'))-Number(this.keys.has('a')||this.keys.has('arrowleft'));
    const vertical=Number(this.keys.has('w')||this.keys.has('arrowup'))-Number(this.keys.has('s')||this.keys.has('arrowdown'));
    const length=Math.max(1,Math.hypot(horizontal,vertical));
    return{x:(horizontal*.836-vertical*.548)/length,z:(horizontal*.548+vertical*.836)/length};
  }
  private sendMotion():void {
    const p=this.state?.crew.find(p=>p.id===this.context.playerId);if(!p||!this.state||this.state.phase==='won'||this.state.phase==='lost')return;
    this.updateAim();const m=this.motion();this.scene.setInput(m.x,m.z);
    this.context.command({kind:'input',...m,aimX:this.mouse.x-p.x,aimZ:this.mouse.z-p.z});
  }
  private loop=():void=>{
    const now=performance.now();if(now-this.lastInput>66){this.sendMotion();this.lastInput=now;}
    if(this.pressed&&now>this.nextHook)this.hook();
    if(this.state&&now-this.lastHud>45){this.positionLabels();this.lastHud=now;}
    this.raf=requestAnimationFrame(this.loop);
  };
  update(room:RoomSnapshot):void {
    this.room=room;this.state=room.game as EscapeState;if(this.state.phase==='won'||this.state.phase==='lost'){this.keys.clear();this.pressed=false;this.scene.setInput(0,0);}this.scene.update(this.state);advanceEscapeAudio(this.state);this.hud();
  }
  private hud():void {
    const s=this.state!,root=this.context.element,p=s.crew.find(p=>p.id===this.context.playerId)!;
    const text=(selector:string,value:string)=>{const node=root.querySelector(selector)!;if(node.textContent!==value)node.textContent=value;};
    text('#stage-label',String(s.stage).padStart(2,'0')+' / '+({quarry:'먼지의 외곽',canal:'물안개 운하',foundry:'붉은 제련소'}[s.biome]));
    text('#hull-text',Math.ceil(s.house.hp)+' / '+s.house.maxHp);(root.querySelector('#hull-bar') as HTMLElement).style.width=(s.house.hp/s.house.maxHp*100)+'%';
    text('#stock',String(s.resources));text('#journey-time',Math.floor(s.clock/60).toString().padStart(2,'0')+':'+Math.floor(s.clock%60).toString().padStart(2,'0'));
    (root.querySelector('#journey-bar') as HTMLElement).style.width=(targetProgress(s)*100)+'%';
    text('#distance-text','방벽 '+Math.max(0,Math.ceil(140-s.house.z))+'m · 폭풍 '+Math.max(0,Math.floor(s.house.z-s.stormZ))+'m 뒤');
    text('#engine-status',s.house.boostUntil>s.clock?'엔진 가속 · '+Math.ceil(s.house.boostUntil-s.clock)+'초':s.house.speed===0?'길을 열어 주세요':'자동 주행');
    const boss=s.enemies.find(e=>e.kind==='devourer'),bossHud=root.querySelector<HTMLElement>('.boss-hud')!;bossHud.hidden=!boss;
    if(boss){text('#boss-percent',Math.ceil(boss.hp/boss.maxHp*100)+'%');(root.querySelector('#boss-bar') as HTMLElement).style.width=(boss.hp/boss.maxHp*100)+'%';text('#boss-hint',boss.exposedUntil>s.clock?'흡입구가 열렸다! 화약통을 던지세요':'붉은 경고를 피하고, 물건을 모으세요');}
    const blocked=!s.gate.open&&Math.abs(s.house.z-(s.gate.z-10))<1;
    text('#objective',s.phase==='camp'?'잠깐의 숨 돌림':boss?'추격자를 떼어 내세요':blocked?'장애물을 부수세요':'집과 함께 앞으로!');
    text('#sub-objective',s.phase==='camp'?'공용 부품으로 개조하고 다음 길을 고르세요.':blocked?'갈고리로 뜯거나, 화약통을 던지세요.':s.house.hp/s.house.maxHp<.35?'내구도가 낮아요! 수리 가방을 집으로 가져오세요.':'물건을 회수하고 뒤처진 동료를 구하세요.');
    const crew=root.querySelector<HTMLElement>('.crew-hud')!;
    if(crew.children.length!==s.crew.length)crew.innerHTML=s.crew.map(c=>'<div class="crew-chip" data-crew="'+escape(c.id)+'" style="--crew:'+c.color+'"><i>'+crewPortrait(c.color)+'</i><div><b>'+escape(c.name)+(c.id===p.id?' <small>나</small>':'')+'</b><span><em></em></span></div><small class="crew-state"></small></div>').join('');
    for(const c of s.crew){const card=crew.querySelector<HTMLElement>('[data-crew="'+c.id+'"]')!;card.classList.toggle('down',c.downUntil>s.clock);(card.querySelector('em') as HTMLElement).style.width=c.hp+'%';card.querySelector('.crew-state')!.textContent=c.left?'떠남':c.downUntil>s.clock?'구조!':c.carry?'운반 중':'';}
    const carried=s.props.find(o=>o.id===p.carry),key=carried?.kind??'empty';
    if(this.heldLabel.dataset.kind!==key){this.heldLabel.dataset.kind=key;this.heldLabel.innerHTML='<span class="item-orb" style="--item:'+ (carried?PROP_INFO[carried.kind].color:'#d5c8a5')+'">'+toolIcon(carried?carried.kind:'hand')+'</span><div><small>'+(carried?PROP_INFO[carried.kind].name:'빈손')+'</small><strong>'+(carried?PROP_INFO[carried.kind].hint:'좌클릭으로 물건을 회수하세요')+'</strong></div>';}
    (root.querySelector('#install-action') as HTMLButtonElement).disabled=!carried||(carried.kind!=='spring'&&dist(p,s.house)>7.8)||p.downUntil>s.clock||s.phase!=='travel';(root.querySelector('#drop-action') as HTMLButtonElement).disabled=!carried||p.downUntil>s.clock||s.phase!=='travel';(root.querySelector('#dodge-action') as HTMLButtonElement).disabled=p.dodgeReady>s.clock||p.downUntil>s.clock||s.phase!=='travel';
    root.querySelector('.playfield')!.classList.toggle('controls-known',s.clock>35);root.querySelector('.playfield')!.classList.toggle('low-hull',s.house.hp/s.house.maxHp<.3);
    text('#dodge-status',p.dodgeReady>s.clock?(p.dodgeReady-s.clock).toFixed(1)+'초':'회피 준비');
    const hint=root.querySelector<HTMLElement>('#context-hint')!;
    if(p.downUntil>s.clock){hint.textContent='쓰러졌어요 · 동료가 갈고리로 구조할 수 있어요 · '+Math.ceil(p.downUntil-s.clock)+'초 후 복귀';hint.className='context-hint urgent';}
    else if(carried){hint.textContent=dist(p,s.house)<7.8?'우클릭 투척  /  E 장착  /  Q 내려놓기':'우클릭으로 던지거나 집으로 가져가세요';hint.className='context-hint';}
    else{hint.textContent=s.clock<25?'좌클릭을 누르고 조준하면 갈고리를 계속 쏩니다. 화약통을 잡아 우클릭으로 던져 보세요.':'';hint.className='context-hint';}
    const camp=root.querySelector<HTMLElement>('.camp-overlay')!;camp.hidden=s.phase!=='camp';
    if(s.phase==='camp'){
      const vote=s.votes[p.id],remaining=Math.ceil(s.campUntil-s.clock);
      const campKey=JSON.stringify([s.resources,s.upgrades,s.votes]);if(this.campKey!==campKey){this.campKey=campKey;camp.innerHTML='<div class="camp-card"><span class="small-label">정비 · '+remaining+'초</span><h2>집 개조 · 경로 선택</h2><p>개조는 모두에게 적용돼요. 공용 부품 <b>'+s.resources+'</b>개</p><div class="upgrade-grid">'
        +(Object.keys(UPGRADE_INFO) as UpgradeId[]).map(k=>{const u=UPGRADE_INFO[k],level=s.upgrades[k],cost=upgradeCost(level);return'<button data-upgrade="'+k+'" '+(level>=2||s.resources<cost?'disabled':'')+'><i>'+toolIcon(k)+'</i><span><b>'+u.name+' <small>'+level+'/2</small></b><small>'+u.description+'</small></span><em>'+(level>=2?'완료':'부품 '+cost)+'</em></button>';}).join('')
        +'</div><div class="route-choices"><button data-route="canal" class="'+(vote==='canal'?'chosen':'')+'"><b>물안개 운하</b><small>운하 거리 · 빠른 적 · 차가운 물안개</small><span>'+Object.values(s.votes).filter(v=>v==='canal').length+'표</span></button><button data-route="foundry" class="'+(vote==='foundry'?'chosen':'')+'"><b>붉은 제련소</b><small>뜨거운 거리 · 무거운 적 · 붉은 석양</small><span>'+Object.values(s.votes).filter(v=>v==='foundry').length+'표</span></button></div><footer>다수결로 결정 · 동률이면 운하 · '+remaining+'초 후 자동 출발</footer></div>';}camp.querySelector('.small-label')!.textContent='정비 · '+remaining+'초';camp.querySelector('footer')!.textContent='다수결로 결정 · 동률이면 운하 · '+remaining+'초 후 자동 출발';
    }
    const ended=s.phase==='won'||s.phase==='lost',results=root.querySelector<HTMLElement>('.results-overlay')!;results.hidden=!ended;
    if(ended&&this.lastPhase!==s.phase){
      const host=this.room!.hostId===p.id;
      results.innerHTML='<div class="results-card"><span class="small-label">'+(s.phase==='won'?'탈출 성공':'탈출 실패')+'</span><h2>'+escape(s.result)+'</h2><p>'+Math.floor(s.clock/60)+'분 '+Math.floor(s.clock%60)+'초 · '+Math.floor(s.distance)+'m 주행 · 공용 부품 '+s.resources+'개</p><div class="team-results">'+s.crew.map(c=>'<div style="--crew:'+c.color+'"><i>'+crewPortrait(c.color)+'</i><b>'+escape(c.name)+'</b><span>투척 <strong>'+c.stats.throws+'</strong></span><span>구조 <strong>'+c.stats.rescues+'</strong></span><span>수리 <strong>'+c.stats.repairs+'</strong></span><span>납품 <strong>'+c.stats.deliveries+'</strong></span></div>').join('')+'</div><p class="result-note">갈고리·물체·개조는 다음 원정에서 새로 시작합니다.</p><button class="primary" data-lobby '+(!host?'disabled':'')+'>'+(host?'대기실로 돌아가기 ↗':'방장이 다음 원정을 준비하고 있어요')+'</button></div>';
    }
    if(ended){const button=results.querySelector<HTMLButtonElement>('[data-lobby]');if(button){button.disabled=this.room!.hostId!==p.id;button.textContent=button.disabled?'방장이 다음 원정을 준비하고 있어요':'대기실로 돌아가기 ↗';}}
    this.lastPhase=s.phase;
  }
  private positionLabels():void {
    const s=this.state!;const rows=s.crew.filter(c=>!c.left).map(c=>{const point=this.scene.project(c.x,c.z,onDeckHeight(c,s)+2.35);return'<div class="name-tag '+(c.downUntil>s.clock?'needs-help':'')+'" style="left:'+point.x+'px;top:'+point.y+'px;--crew:'+c.color+';'+(!point.visible?'display:none;':'')+'">'+(c.downUntil>s.clock?'✚ ':'')+escape(c.name)+'</div>';});
    for(const e of s.enemies)if(e.hp<e.maxHp&&e.kind!=='devourer'){const point=this.scene.project(e.x,e.z,2.2);if(point.visible)rows.push('<div class="enemy-health" style="left:'+point.x+'px;top:'+point.y+'px"><i style="width:'+Math.max(0,e.hp/e.maxHp*100)+'%"></i></div>');}
    if(!s.gate.open){const point=this.scene.project(0,s.gate.z,3.1);if(point.visible)rows.push('<div class="gate-label" style="left:'+point.x+'px;top:'+point.y+'px">막힌 길 <b>'+Math.ceil(s.gate.hp)+'</b></div>');}
    this.labels.innerHTML=rows.join('');
    for(const el of this.floats.children){const node=el as HTMLElement;const age=(performance.now()-Number(node.dataset.born))/1000;if(age>1.1){node.remove();continue;}const point=this.scene.project(Number(node.dataset.x),Number(node.dataset.z),1.8+age*1.6);node.style.left=point.x+'px';node.style.top=point.y+'px';node.style.opacity=String(1-age/1.1);}
  }
  private onEvent(e:EscapeEvent):void {
    playEscapeEvent(e);
    if(e.type==='hit'&&e.value){const node=document.createElement('b');node.className='damage-float '+(e.text==='crew'||e.text==='house'?'hurt':'');node.textContent=String(e.value);node.dataset.x=String(e.x+(e.id%3-1)*.25);node.dataset.z=String(e.z);node.dataset.born=String(performance.now());this.floats.append(node);if(this.floats.children.length>35)this.floats.firstElementChild?.remove();}
    if(['rescue','boss','camp','win','lose','upgrade'].includes(e.type)){
      const banner=this.context.element.querySelector<HTMLElement>('.event-announcement')!;banner.hidden=false;banner.dataset.until=String(performance.now()+2500);
      banner.querySelector('span')!.textContent=e.type==='rescue'?'NICE SAVE!':e.type==='upgrade'?'UPGRADED':'HOUSEFLIGHT';
      banner.querySelector('strong')!.textContent=e.type==='rescue'?'동료 구조!':e.type==='upgrade'?UPGRADE_INFO[e.text as UpgradeId]?.name??'함께 더 강하게':e.text??'';
      setTimeout(()=>{if(Number(banner.dataset.until)<performance.now())banner.hidden=true;},2600);
    }
  }
  destroy():void {this.abort.abort();cancelAnimationFrame(this.raf);this.keys.clear();this.scene.destroy();this.context.element.replaceChildren();}
}
function onDeckHeight(c:{x:number;z:number},s:EscapeState):number{return Math.abs(c.x)<4.6&&Math.abs(c.z-s.house.z)<5.6?1.61:0;}
