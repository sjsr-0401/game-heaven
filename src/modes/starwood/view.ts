import { DEFENSE_ID, BOSSES, FAMILIES, FAMILIES_INFO, PRIORITIES, RARITIES, RELICS, LAST_WAVE, MAX_DEFENDERS, SUMMON_COST, START_GOLD, WAVE_SECONDS, armyStats, burstCooldown, dismissValue, enemyLimit, upgradeCost, wagerCost, waveInfo, type DefenseState, type DefenseAction, type RelicId } from '../../../shared/defense.js';
import type { RoomSnapshot } from '../../../shared/protocol.js';
import type { ClientMode, ModeContext } from '../types.js';
import { portrait } from './art.js';
import { ForestRenderer } from './renderer.js';

export class StarwoodView implements ClientMode {
  private renderer: ForestRenderer;
  private state: DefenseState | null = null;
  private room: RoomSnapshot | null = null;
  private boardId: string;
  private selected: number | null = null;
  private aiming = false;
  private pointerStart: { id: number; x: number; y: number } | null = null;
  private abort = new AbortController();
  private uiAt = 0;
  private detailKey = '';
  private partyKey = '';
  private relicKey = '';
  private lastEvent = 0;
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly images = new Map<string, string>();

  constructor(private readonly context: ModeContext) {
    this.boardId=context.playerId;
    context.element.innerHTML = `
      <div class="game-layout">
        <section class="battle-panel" aria-label="개인 용병 전장">
          <div class="map-ribbon"><span><i class="tiny-star">✦</i> 01 <b id="board-name">내 전장 · 잿빛 성채</b></span><span class="map-weather"><span id="act-name">ACT I · 성문</span></span></div>
          <canvas id="battlefield" aria-label="용병을 선택하고 드래그해 배치하는 개인 전장" tabindex="0"></canvas>
          <div class="boss-hud" hidden><div><b id="boss-name"></b><span id="boss-time"></span></div><div class="boss-health"><i id="boss-health"></i></div><small id="boss-description"></small></div>
          <div class="summon-reveal" hidden aria-live="polite"></div>
          <button class="relic-prompt" id="open-relics" hidden><span>✧</span><div><b>전리품이 도착했습니다</b><small>유물 3개 중 1개 선택 · 무료</small></div><span>↗</span></button>
          <div class="synergy-dock" id="synergies" aria-label="직업 시너지"></div>
          <div class="map-bottom"><span><i class="live-dot"></i> <span id="battle-state">첫 습격 준비</span></span><span id="board-count">4 / 16 용병</span></div>
          <div class="aim-banner" hidden>포격할 곳을 클릭하세요 <kbd>ESC</kbd> 취소</div>
          <div class="result-overlay" hidden><div class="result-card"><div class="result-symbol">✦</div><p class="eyebrow">NIGHTWATCH / RESULTS</p><h2 id="result-title"></h2><p id="result-copy"></p><div id="result-stats"></div><div id="result-mvp"></div><button class="primary" id="return-lobby">대기실로 돌아가기 <span>↗</span></button><p class="result-wait" hidden>방장이 다음 판을 준비하고 있어요.</p></div></div>
        </section>
        <aside class="game-sidebar">
          <section class="panel wave-panel"><div class="section-label"><span>습격 현황</span><span id="wave-kind" class="muted">준비 중</span></div><div class="wave-title"><strong id="wave-number">00</strong><span>/ ${LAST_WAVE} <small>WAVES</small></span><div class="wave-icon">☽</div></div><div class="progress"><i id="wave-progress"></i></div><div class="row-between small"><span id="wave-time"></span><span id="enemy-count">0 / 55</span></div><p class="danger-note" id="danger-note">누적 55마리면 내 전장 패배</p></section>
          <section class="panel party-panel"><div class="section-label"><span>개인전 현황 · 클릭하면 관전</span><span class="muted" id="party-count"></span></div><div id="party-list"></div></section>
          <section class="panel guardian-panel"><div class="section-label"><span>선택한 용병</span><kbd>클릭</kbd></div><div id="guardian-detail"><div class="empty-selection"><span>⌖</span><p>용병을 선택하세요</p><small>사거리·공격력·장비 확인</small></div></div></section>
          <section class="relic-inventory" aria-label="보유 유물"><span>획득한 유물</span><div id="relic-inventory">두 번째 웨이브부터 선택합니다.</div></section>
        </aside>
        <section class="command-bar" aria-label="전투 명령">
          <div class="resource"><span class="resource-star">G</span><div><small>내 골드</small><strong id="gold">${START_GOLD}</strong></div></div>
          <button class="action summon-action" id="summon"><kbd>Q</kbd><div><b>일반 소환</b><small id="summon-cost">${SUMMON_COST} G · 6직업 중 무작위</small></div></button>
          <button class="action wager-action" id="wager"><kbd>R</kbd><div><b>승부 소환 <span>✦</span></b><small id="wager-cost">120 G · 일반도 나와요</small></div></button>
          <button class="action" id="upgrade"><kbd>W</kbd><div><b>전원 강화 <em id="upgrade-level">0</em></b><small id="upgrade-cost">100 G · 공격력 +18%</small></div></button>
          <button class="action skill-action" id="burst"><kbd>E</kbd><div><b>지원 포격</b><small id="burst-label">범위 공격 · 준비 완료</small></div></button>
        </section>
      </div>
      <div class="controls-footer"><span><kbd>클릭</kbd> 선택 <i>·</i> <kbd>드래그 / 우클릭</kbd> 배치 <i>·</i> 최대 16명 · 합성 없음</span><button class="odds-button" id="show-odds">소환 확률 보기 ↗</button></div>
      <dialog class="odds-dialog"><button class="dialog-close" aria-label="확률 창 닫기">×</button><p class="eyebrow">RECRUITMENT ODDS</p><h2>한 번의 행운, 다섯 등급.</h2><p>골드는 이 판 안에서만 사용하는 게임 재화입니다. 모든 추첨은 서버에서 실행하며, 보장 소환은 없습니다.</p><table class="odds-table"><thead><tr><th>등급</th><th>일반 · 40 G</th><th>승부 · 120 G</th><th>공격 배율</th></tr></thead><tbody>${RARITIES.map(r=>`<tr><th style="color:${r.color}">${r.name}</th><td>${+(r.chance*100).toFixed(2)}%</td><td>${+(r.wagerChance*100).toFixed(2)}%</td><td>×${r.multiplier}</td></tr>`).join('')}</tbody></table><p>직업 6종은 각각 1/6 확률로 추첨합니다. 승부 소환도 일반이 나올 수 있습니다. 해고 환급은 일반 10 / 희귀 20 / 영웅 40 / 전설 80 / 신화 160 G입니다.</p></dialog>`;
    context.element.insertAdjacentHTML('beforeend',`<dialog class="relic-dialog"><button class="dialog-close" aria-label="유물 창 닫기">×</button><p class="eyebrow">SPOILS OF THE NIGHT</p><h2>이번 밤을 바꿀 한 가지.</h2><p>무료로 하나를 선택하세요. 전투는 계속 진행됩니다.</p><div class="relic-choices"></div><p class="dialog-note">유물은 이 판 동안 내 전장에 적용됩니다. 2·5·8웨이브마다 선택할 수 있습니다.</p></dialog><dialog class="dismiss-dialog"><p class="eyebrow">DISMISS MERCENARY</p><h2>이 용병을 해고할까요?</h2><p>소환한 등급과 용병은 되돌릴 수 없습니다.</p><div class="dialog-actions"><button class="secondary" data-cancel-dismiss>취소</button><button class="primary" data-confirm-dismiss>해고하기</button></div></dialog>`);
    const canvas=context.element.querySelector<HTMLCanvasElement>('canvas')!;
    this.renderer=new ForestRenderer(canvas);
    const signal=this.abort.signal;
    canvas.addEventListener('contextmenu',event=>{
      event.preventDefault();const p=this.renderer.point(event),slot=this.renderer.slotAt(p.x,p.y);
      if(this.selected!==null&&slot>=0)this.send({kind:'move',defenderId:this.selected,slot});
    },{signal});
    canvas.addEventListener('pointerdown',event=>{
      if(event.button!==0||!this.state)return;
      const point=this.renderer.point(event);
      if(this.aiming){this.send({kind:'burst',...point});this.cancelAim();return;}
      const unitId=this.renderer.unitAt(point.x,point.y);
      const unit=this.state.defenders.find(d=>d.id===unitId);
      this.selected=unit?.id??null;this.renderer.selected=this.selected;this.uiAt=0;this.refreshUI();
      if(unit&&this.canCommand()){this.pointerStart={id:unit.id,...point};canvas.setPointerCapture(event.pointerId);}
    },{signal});
    canvas.addEventListener('pointermove',event=>{
      const point=this.renderer.point(event);this.renderer.hoverSlot=this.renderer.slotAt(point.x,point.y);
      if(this.aiming)this.renderer.aiming=point;
      if(this.pointerStart&&Math.hypot(point.x-this.pointerStart.x,point.y-this.pointerStart.y)>7)this.renderer.drag={id:this.pointerStart.id,...point};
    },{signal});
    canvas.addEventListener('pointerup',event=>{
      if(this.renderer.drag&&this.pointerStart){
        const p=this.renderer.point(event),slot=this.renderer.slotAt(p.x,p.y);
        if(slot>=0)this.send({kind:'move',defenderId:this.pointerStart.id,slot});
      }
      this.pointerStart=null;this.renderer.drag=null;
    },{signal});
    canvas.addEventListener('pointercancel',()=>{this.pointerStart=null;this.renderer.drag=null;},{signal});
    canvas.addEventListener('pointerleave',()=>{this.renderer.hoverSlot=-1;},{signal});
    this.$('summon').addEventListener('click',()=>this.summon(false),{signal});
    this.$('wager').addEventListener('click',()=>this.summon(true),{signal});
    this.$('upgrade').addEventListener('click',()=>this.send({kind:'upgrade'}),{signal});
    this.$('burst').addEventListener('click',()=>this.startAim(),{signal});
    context.element.addEventListener('click',event=>{
      const target=event.target as HTMLElement;
      const watch=target.closest<HTMLButtonElement>('[data-watch]');
      if(watch){this.boardId=watch.dataset.watch!;this.selected=null;this.renderer.selected=null;this.pointerStart=null;this.renderer.drag=null;this.cancelAim();this.uiAt=0;if(this.room)this.update(this.room);}
      if(target.closest('[data-dismiss]')&&this.selected!==null){
        const unit=this.state?.defenders.find(d=>d.id===this.selected);
        if(unit&&unit.rank>=2){
          const dialog=context.element.querySelector<HTMLDialogElement>('.dismiss-dialog')!;
          const id=unit.id;dialog.showModal();
          dialog.querySelector<HTMLButtonElement>('[data-confirm-dismiss]')!.onclick=()=>{this.send({kind:'dismiss',defenderId:id});dialog.close();};
        }else this.send({kind:'dismiss',defenderId:this.selected});
      }
      const priority=target.closest<HTMLButtonElement>('[data-priority]');
      if(priority&&this.selected!==null)this.send({kind:'priority',defenderId:this.selected,priority:priority.dataset.priority as 'front'|'strong'|'weak'});
      const relic=target.closest<HTMLButtonElement>('[data-relic]');
      if(relic&&this.canCommand()){this.send({kind:'relic',relic:relic.dataset.relic as RelicId});context.element.querySelector<HTMLDialogElement>('.relic-dialog')!.close();}
    },{signal});
    const relicDialog=context.element.querySelector<HTMLDialogElement>('.relic-dialog')!;
    this.$('open-relics').addEventListener('click',()=>{if(this.canCommand())relicDialog.showModal();},{signal});
    relicDialog.querySelector('button')!.addEventListener('click',()=>relicDialog.close(),{signal});
    context.element.querySelector<HTMLButtonElement>('[data-cancel-dismiss]')!.addEventListener('click',()=>context.element.querySelector<HTMLDialogElement>('.dismiss-dialog')!.close(),{signal});
    const odds=context.element.querySelector<HTMLDialogElement>('.odds-dialog')!;
    this.$('show-odds').addEventListener('click',()=>odds.showModal(),{signal});
    odds.querySelector('button')!.addEventListener('click',()=>odds.close(),{signal});
    window.addEventListener('keydown',event=>{
      if(event.target instanceof HTMLInputElement||event.target instanceof HTMLTextAreaElement||event.ctrlKey||event.metaKey||event.altKey||event.repeat||document.querySelector('dialog[open]'))return;
      if(event.code==='Escape')this.cancelAim();
      if(event.code==='KeyQ'){event.preventDefault();this.summon(false);}
      if(event.code==='KeyR'){event.preventDefault();this.summon(true);}
      if(event.code==='KeyW'){event.preventDefault();this.send({kind:'upgrade'});}
      if(event.code==='KeyE'){event.preventDefault();this.startAim();}
    },{signal});
  }
  private $(id:string):HTMLElement{return this.context.element.querySelector('#'+id)!;}
  private canCommand():boolean{return this.boardId===this.context.playerId&&this.room?.phase==='playing'&&this.state?.players.find(p=>p.id===this.context.playerId)?.status==='active';}
  private send(action:DefenseAction):void{if(this.canCommand())this.context.command(action);}
  private summon(wager:boolean):void{
    const slot=this.renderer.hoverSlot;
    this.send(slot>=0&&!this.state?.defenders.some(d=>d.ownerId===this.context.playerId&&d.slot===slot)?{kind:'summon',slot,wager}:{kind:'summon',wager});
  }
  private startAim():void{
    const player=this.state?.players.find(p=>p.id===this.context.playerId);
    if(!this.canCommand()||this.state?.phase!=='battle'||!player||player.burstReadyAt>this.state.time)return;
    this.aiming=!this.aiming;
    this.context.element.querySelector<HTMLElement>('.aim-banner')!.hidden=!this.aiming;
    this.renderer.aiming=this.aiming?{x:492,y:364}:null;
    this.renderer.canvas.classList.toggle('aiming',this.aiming);this.$('burst').classList.toggle('active',this.aiming);
  }
  private cancelAim():void{
    this.aiming=false;this.renderer.aiming=null;this.renderer.canvas.classList.remove('aiming');
    this.context.element.querySelector<HTMLElement>('.aim-banner')!.hidden=true;this.$('burst').classList.remove('active');
  }
  update(room:RoomSnapshot):void{
    this.room=room;const state=room.game as DefenseState;if(state?.mode!==DEFENSE_ID)return;this.state=state;
    if(!room.players.some(p=>p.id===this.boardId))this.boardId=this.context.playerId;
    this.renderer.update({...state,defenders:state.defenders.filter(d=>d.ownerId===this.boardId),enemies:state.enemies.filter(e=>e.ownerId===this.boardId),events:state.events.filter(e=>e.ownerId===this.boardId),hazards:state.hazards.filter(h=>h.ownerId===this.boardId)},this.boardId);
    if(this.selected!==null&&!state.defenders.some(d=>d.id===this.selected)){this.selected=null;this.renderer.selected=null;}
    if(!this.canCommand())this.cancelAim();
    this.refreshUI();
    const fresh=state.events.filter(e=>e.id>this.lastEvent&&e.ownerId===this.boardId&&e.type==='summon'&&state.time-e.at<.5);
    this.lastEvent=Math.max(this.lastEvent,...state.events.map(e=>e.id));
    const summon=fresh.at(-1);
    if(summon?.family!==undefined&&summon.rank!==undefined)this.showRecruit(summon.family,summon.rank,summon.unitId??0,summon.special??false);
    this.context.element.querySelector<HTMLElement>('.result-overlay')!.hidden=room.phase!=='finished';
    if(room.phase==='finished'){
      const player=state.players.find(p=>p.id===this.context.playerId)!;
      this.$('result-title').textContent=player.status==='victory'?'성채를 지켜냈다.':'다음 밤엔, 다른 운명.';
      this.$('result-copy').textContent=player.reason+' · 최고 '+RARITIES[player.bestRank].name;
      this.$('result-stats').innerHTML=`<div><strong>${player.kills}</strong><small>처치</small></div><div><strong>${player.bosses}</strong><small>보스 격파</small></div><div><strong>${player.summons}</strong><small>용병 계약</small></div>`;
      const mvp=state.defenders.filter(d=>d.ownerId===player.id).sort((a,b)=>b.damage-a.damage)[0];
      const mvpKey=mvp?mvp.family+'-'+mvp.rank+'-'+mvp.id:'';
      if(mvp&&!this.images.has(mvpKey))this.images.set(mvpKey,portrait(mvp.family,mvp.rank,92,mvp.id));
      if(mvp)this.$('result-mvp').innerHTML=`<img src="${this.images.get(mvpKey)}" alt="${FAMILIES_INFO[mvp.family].name}"/><div><small>용병 MVP · ${RARITIES[mvp.rank].name}</small><strong>${FAMILIES_INFO[mvp.family].name}</strong><span>${Math.round(mvp.damage).toLocaleString()} 피해 · ${mvp.kills} 처치</span></div>`;
      this.context.element.querySelector<HTMLDialogElement>('.relic-dialog')!.close();
      this.context.element.querySelector<HTMLDialogElement>('.dismiss-dialog')!.close();
      this.$('return-lobby').hidden=room.hostId!==this.context.playerId;
      this.context.element.querySelector<HTMLElement>('.result-wait')!.hidden=room.hostId===this.context.playerId;
    }
  }
  private refreshUI():void{
    if(!this.state||!this.room)return;
    const now=performance.now();if(now-this.uiAt<100)return;this.uiAt=now;
    const state=this.state,room=this.room,player=state.players.find(p=>p.id===this.context.playerId)!,watched=state.players.find(p=>p.id===this.boardId)!;
    const mine=this.boardId===this.context.playerId;
    const army=state.defenders.filter(d=>d.ownerId===this.boardId),enemies=state.enemies.filter(e=>e.ownerId===this.boardId);
    this.$('board-name').textContent=(mine?'내 전장':room.players.find(p=>p.id===this.boardId)?.name+' 관전')+' · 잿빛 성채';
    this.$('gold').textContent=player.gold.toLocaleString();
    const wave=waveInfo(Math.max(1,state.wave)),limit=enemyLimit(watched);
    this.$('act-name').textContent=['ACT I · 성문','ACT II · 종탑','ACT III · 새벽'][Math.min(2,Math.floor(Math.max(0,state.wave-1)/4))];
    this.$('wave-number').textContent=String(state.wave).padStart(2,'0');
    this.$('wave-kind').textContent=watched.status!=='active'?watched.status==='victory'?'방어 성공':'탈락':state.phase==='preparing'?'준비 중':wave.boss?'보스 출현':wave.name;
    const seconds=Math.max(0,Math.ceil(state.waveEndsAt-state.time));
    this.$('wave-time').textContent=state.wave===LAST_WAVE?'최후의 습격': '다음 습격 '+seconds+'초';
    this.$('wave-progress').style.width=(state.phase==='preparing'?0:Math.min(100,(WAVE_SECONDS-seconds)/WAVE_SECONDS*100))+'%';
    this.$('enemy-count').textContent=enemies.length+' / '+limit;
    this.$('enemy-count').classList.toggle('danger',enemies.length>limit*.7);
    const deadline=state.bossDeadlines[this.boardId];
    this.$('danger-note').textContent=watched.status!=='active'?watched.reason:deadline?'보스 제한 '+Math.max(0,Math.ceil(deadline-state.time))+'초':wave.detail;
    const boss=enemies.find(e=>e.kind==='boss');
    this.context.element.querySelector<HTMLElement>('.boss-hud')!.hidden=!boss;
    if(boss){
      const info=BOSSES[boss.bossType??'warden'];
      this.$('boss-name').textContent=info.name+(boss.enraged?' · 광폭화':'');
      this.$('boss-time').textContent=Math.max(0,Math.ceil((deadline??state.time)-state.time))+'s';
      this.$('boss-health').style.width=(boss.hp/boss.maxHp*100)+'%';this.$('boss-health').style.background=info.color;
      this.$('boss-description').textContent=info.subtitle;
    }
    this.$('board-count').textContent=army.length+' / '+MAX_DEFENDERS+' 용병';
    this.$('battle-state').textContent=watched.status!=='active'?'전투 종료 · 다른 플레이어를 클릭해 관전하세요':mine?'내 전장 · '+watched.kills+'처치':'관전 중 · 명령은 내 전장에서';
    this.$('upgrade-level').textContent='+'+player.upgrade;
    this.$('upgrade-cost').textContent=player.upgrade>=8?'최대 강화':upgradeCost(player.upgrade)+' G · 공격력 +18%';
    (this.$('summon') as HTMLButtonElement).disabled=!this.canCommand()||player.gold<SUMMON_COST||army.length>=MAX_DEFENDERS;
    (this.$('wager') as HTMLButtonElement).disabled=!this.canCommand()||(player.contracts===0&&player.gold<wagerCost(player))||army.length>=MAX_DEFENDERS;
    (this.$('upgrade') as HTMLButtonElement).disabled=!this.canCommand()||player.gold<upgradeCost(player.upgrade)||player.upgrade>=8;
    const cooldown=Math.ceil(player.burstReadyAt-state.time);
    this.$('burst').style.setProperty('--cooldown',Math.max(0,cooldown)/burstCooldown(player)*100+'%');
    this.$('burst-label').textContent=cooldown>0?cooldown+'초 뒤 사용 가능':'범위 공격 · 준비 완료';
    (this.$('burst') as HTMLButtonElement).disabled=!this.canCommand()||cooldown>0||state.phase!=='battle';
    this.$('wager-cost').textContent=player.contracts>0?'보스 계약서 '+player.contracts+'장 · 이번 소환 무료':wagerCost(player)+' G · 일반도 나와요';
    this.$('open-relics').hidden=!mine||!player.relicChoices.length||player.status!=='active';
    this.$('open-relics').classList.toggle('available',player.relicChoices.length>0);
    const relicKey=JSON.stringify([this.boardId,watched.relics,player.relicChoices]);
    if(relicKey!==this.relicKey){
      this.relicKey=relicKey;
      this.$('relic-inventory').innerHTML=watched.relics.length?watched.relics.map(id=>`<span title="${RELICS[id].name} · ${RELICS[id].description}" style="--relic-color:${RELICS[id].color}">${RELICS[id].symbol}<small>${RELICS[id].name}</small></span>`).join(''):'2·5·8웨이브 · 무료 유물 선택';
      this.context.element.querySelector('.relic-choices')!.innerHTML=player.relicChoices.map(id=>`<button data-relic="${id}" style="--relic-color:${RELICS[id].color}"><span>${RELICS[id].symbol}</span><h3>${RELICS[id].name}</h3><p>${RELICS[id].description}</p><small>이 유물 선택 ↗</small></button>`).join('');
    }
    const synergyKey=FAMILIES.map(f=>army.filter(d=>d.family===f).length).join(':');
    if(this.$('synergies').dataset.key!==synergyKey){
      this.$('synergies').dataset.key=synergyKey;
      this.$('synergies').innerHTML=FAMILIES.map(f=>{const n=army.filter(d=>d.family===f).length,info=FAMILIES_INFO[f];return `<span class="${n>=3?'active':''}" title="${info.short} ${n}명 · ${info.guild}" style="--guild-color:${info.color}"><b>${info.symbol}</b><small>${n}/3</small></span>`;}).join('');
    }
    this.$('party-count').textContent=room.players.length+' / 4';
    const partyKey=JSON.stringify(room.players.map(info=>[info.id,info.name,info.connected,state.players.find(p=>p.id===info.id)?.status]));
    if(partyKey!==this.partyKey){
      this.partyKey=partyKey;
      this.$('party-list').replaceChildren(...room.players.map(info=>{
        const stats=state.players.find(p=>p.id===info.id)!;
        const row=document.createElement('button');row.type='button';row.className='party-member watch-row';row.dataset.watch=info.id;
        row.innerHTML='<div class="avatar" style="--player-color:'+info.color+'"></div><div class="member-name"><strong></strong><small></small></div><div class="member-kills"><b>0</b><small>처치</small></div>';
        row.querySelector('strong')!.textContent=info.name+(info.id===player.id?' · 나':'');
        row.querySelector('.member-name small')!.textContent=!info.connected?'재접속 중':stats.status==='active'?'생존 중':stats.status==='victory'?'방어 성공':'탈락';
        return row;
      }));
    }
    this.context.element.querySelectorAll<HTMLButtonElement>('[data-watch]').forEach(row=>{
      row.classList.toggle('me',row.dataset.watch===this.boardId);row.setAttribute('aria-pressed',String(row.dataset.watch===this.boardId));
      const stats=state.players.find(p=>p.id===row.dataset.watch)!;row.querySelector('b')!.textContent=String(stats.kills);
    });
    const unit=state.defenders.find(d=>d.id===this.selected),detail=this.$('guardian-detail');
    if(unit){
      const key=unit.family+'-'+unit.rank+'-'+unit.id;if(!this.images.has(key))this.images.set(key,portrait(unit.family,unit.rank,88,unit.id));
      const info=FAMILIES_INFO[unit.family],rarity=RARITIES[unit.rank],owner=state.players.find(p=>p.id===unit.ownerId)!;
      const stats=armyStats(unit,owner,army);
      const detailKey=[unit.id,unit.rank,owner.upgrade,this.canCommand(),unit.priority,owner.relics.join(','),stats.damage,stats.interval,stats.range,stats.guild].join(':');
      const record=detail.querySelector<HTMLElement>('.unit-record');if(record)record.textContent=unit.kills+' 처치 · '+Math.round(unit.damage).toLocaleString()+' 피해';
      if(this.detailKey===detailKey)return;this.detailKey=detailKey;
      detail.innerHTML=`<div class="guardian-heading"><div class="portrait" style="--rank-color:${rarity.color}"><img src="${this.images.get(key)}" alt="${info.name}" /></div><div><span class="rarity" style="color:${rarity.color}">${rarity.name} · ×${rarity.multiplier}</span><h3>${info.name}</h3><small>${info.role}</small></div></div><div class="guardian-stats"><div><small>공격력</small><b>${stats.damage}</b></div><div><small>공격 주기</small><b>${stats.interval.toFixed(2)}초</b></div><div><small>사거리</small><b>${stats.range}</b></div></div><div class="priority-picker" aria-label="공격 우선순위">${Object.entries(PRIORITIES).map(([id,label])=>`<button data-priority="${id}" class="${unit.priority===id?'active':''}" ${this.canCommand()?'':'disabled'}>${label}</button>`).join('')}</div><p class="guild-note ${stats.guild?'active':''}">${stats.guild?'✦ 시너지 활성 · ':''}${info.guild}</p><button class="merge-button" data-dismiss ${this.canCommand()?'':'disabled'}>용병 해고 · ${dismissValue(unit.rank)} G 환급</button><p class="unit-record">${unit.kills} 처치 · ${Math.round(unit.damage).toLocaleString()} 피해</p><p class="selection-tip">드래그로 이동 · 같은 칸이면 자리 교환</p>`;
    }else if(!detail.querySelector('.empty-selection')){
      this.detailKey='';detail.innerHTML='<div class="empty-selection"><span>⌖</span><p>용병을 선택하세요</p><small>사거리·공격력·장비 확인</small></div>';
    }
  }
  private showRecruit(family:typeof FAMILIES[number],rank:number,id:number,wager:boolean):void{
    const box=this.context.element.querySelector<HTMLElement>('.summon-reveal')!,rarity=RARITIES[rank],info=FAMILIES_INFO[family];
    if(this.revealTimer)clearTimeout(this.revealTimer);
    box.hidden=false;box.style.setProperty('--reveal-color',rarity.color);box.className='summon-reveal rank-'+rank;
    box.innerHTML=`<img src="${portrait(family,rank,112,id)}" alt="${info.name}"/><div><small>${wager?'승부 계약':'용병 계약'} · ${rarity.name}</small><strong>${info.name}</strong><p>${info.role}</p><span>전투력 ×${rarity.multiplier}</span></div>`;
    this.revealTimer=setTimeout(()=>{box.hidden=true;},rank>=3?3200:rank>=1?2100:1300);
  }
  destroy():void{if(this.revealTimer)clearTimeout(this.revealTimer);this.abort.abort();this.context.element.querySelectorAll<HTMLDialogElement>('dialog').forEach(d=>d.close());this.renderer.destroy();this.context.element.replaceChildren();}
}
