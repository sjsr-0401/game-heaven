import { BOARD, FAMILIES_INFO, RARITIES, LAST_WAVE, MAX_ENEMIES, PITY_COUNT, SUMMON_COST, defenderDamage, upgradeCost, type DefenseState, type DefenseAction } from '../../../shared/defense.js';
import type { RoomSnapshot } from '../../../shared/protocol.js';
import type { ClientMode, ModeContext } from '../types.js';
import { portrait } from './art.js';
import { ForestRenderer } from './renderer.js';

export class StarwoodView implements ClientMode {
  private renderer: ForestRenderer;
  private state: DefenseState | null = null;
  private room: RoomSnapshot | null = null;
  private selected: number | null = null;
  private aiming = false;
  private pointerStart: { id: number; x: number; y: number } | null = null;
  private abort = new AbortController();
  private uiAt = 0;
  private detailKey = '';
  private readonly images = new Map<string, string>();

  constructor(private readonly context: ModeContext) {
    context.element.innerHTML = `
      <div class="game-layout">
        <section class="battle-panel" aria-label="별숲 전장">
          <div class="map-ribbon"><span><i class="tiny-star">✦</i> 01 <b>반딧불 숲</b></span><span class="map-weather">◒ &nbsp; 저녁의 숲</span></div>
          <canvas id="battlefield" aria-label="수호자를 선택하거나 드래그해 배치하는 전장" tabindex="0"></canvas>
          <div class="map-bottom"><span><i class="live-dot"></i> <span id="battle-state">숲을 준비하고 있어요</span></span><span id="board-count">0 / 10 수호자</span></div>
          <div class="aim-banner" hidden>별비를 내릴 곳을 클릭하세요 <kbd>ESC</kbd> 취소</div>
          <div class="result-overlay" hidden><div class="result-card"><div class="result-symbol">✦</div><p class="eyebrow">EXPEDITION COMPLETE</p><h2 id="result-title"></h2><p id="result-copy"></p><button class="primary" id="return-lobby">대기실로 돌아가기 <span>↗</span></button><p class="result-wait" hidden>방장이 다음 판을 준비하고 있어요.</p></div></div>
        </section>
        <aside class="game-sidebar">
          <section class="panel wave-panel"><div class="section-label"><span>숲의 위협</span><span id="wave-kind" class="muted">준비 중</span></div><div class="wave-title"><strong id="wave-number">00</strong><span>/ ${String(LAST_WAVE).padStart(2, '0')} <small>WAVES</small></span><div class="wave-icon">☽</div></div><div class="progress"><i id="wave-progress"></i></div><div class="row-between small"><span id="wave-time">잠시 후 시작</span><span id="enemy-count">0 / ${MAX_ENEMIES}</span></div><p class="danger-note" id="danger-note">몬스터가 ${MAX_ENEMIES}마리 쌓이면 숲을 잃어요.</p></section>
          <section class="panel party-panel"><div class="section-label"><span>함께 지키는 친구들</span><span class="muted" id="party-count">1 / 4</span></div><div id="party-list"></div></section>
          <section class="panel guardian-panel"><div class="section-label"><span>선택한 수호자</span><kbd>클릭</kbd></div><div id="guardian-detail"><div class="empty-selection"><span>⌖</span><p>전장의 수호자를 선택하세요</p><small>사거리와 합성 가능 대상을 확인해요.</small></div></div></section>
          <div class="field-note"><span>✧</span><p>운은 소환에, 실력은 배치에.<br><strong>함께라면 조금 더 멀리.</strong></p></div>
        </aside>
        <section class="command-bar" aria-label="전투 명령">
          <div class="resource"><span class="resource-star">✦</span><div><small>내 별조각</small><strong id="gold">240</strong></div></div>
          <button class="action summon-action" id="summon"><kbd>Q</kbd><div><b>수호자 소환</b><small>✦ ${SUMMON_COST} <span>· 무작위 수호자</span></small></div><span class="action-arrow">↗</span></button>
          <button class="action" id="upgrade"><kbd>W</kbd><div><b>전체 공격 강화 <em id="upgrade-level">0</em></b><small id="upgrade-cost">✦ 80 · 내 수호자 공격력 +15%</small></div></button>
          <button class="action skill-action" id="burst"><kbd>E</kbd><div><b>별비 내리기</b><small id="burst-label">범위 공격 · 준비 완료</small></div><span class="skill-symbol">✧</span></button>
          <div class="luck-meter"><div class="row-between"><span>작은 행운</span><b id="pity-count">0 / ${PITY_COUNT}</b></div><div class="luck-dots">${'<i></i>'.repeat(PITY_COUNT)}</div><small>일반 ${PITY_COUNT - 1}회 연속 → 다음은 희귀 이상</small></div>
        </section>
      </div><div class="controls-footer"><span><kbd>좌클릭</kbd> 선택 <i>·</i> <kbd>드래그 / 우클릭</kbd> 재배치 <i>·</i> 같은 수호자 2명 합성</span><span>소환 확률 <b>일반 76%</b> / 희귀 20% / 영웅 3.5% / 전설 0.5%</span></div>`;
    const canvas = context.element.querySelector<HTMLCanvasElement>('canvas')!;
    this.renderer = new ForestRenderer(canvas, context.playerId);
    const signal = this.abort.signal;
    canvas.addEventListener('contextmenu', event => {
      event.preventDefault(); const p = this.renderer.point(event); const slot = this.renderer.slotAt(p.x, p.y);
      if (this.selected !== null && slot >= 0) this.send({ kind: 'move', defenderId: this.selected, slot });
    }, { signal });
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.state) return;
      const point = this.renderer.point(event);
      if (this.aiming) { this.send({ kind: 'burst', ...point }); this.cancelAim(); return; }
      const slot = this.renderer.slotAt(point.x, point.y);
      const unit = this.state.defenders.find(d => d.slot === slot);
      this.selected = unit?.id ?? null; this.renderer.selected = this.selected;
      this.uiAt = 0; this.refreshUI();
      if (unit?.ownerId === this.context.playerId) {
        this.pointerStart = { id: unit.id, ...point }; canvas.setPointerCapture(event.pointerId);
      }
    }, { signal });
    canvas.addEventListener('pointermove', event => {
      const point = this.renderer.point(event); this.renderer.hoverSlot = this.renderer.slotAt(point.x, point.y);
      if (this.aiming) this.renderer.aiming = point;
      if (this.pointerStart && Math.hypot(point.x - this.pointerStart.x, point.y - this.pointerStart.y) > 7) this.renderer.drag = { id: this.pointerStart.id, ...point };
    }, { signal });
    canvas.addEventListener('pointerup', event => {
      if (this.renderer.drag && this.pointerStart && this.state) {
        const point = this.renderer.point(event), slot = this.renderer.slotAt(point.x, point.y);
        const target = this.state.defenders.find(d => d.slot === slot);
        const source = this.state.defenders.find(d => d.id === this.pointerStart!.id);
        if (target && source && target.id !== source.id && target.ownerId === source.ownerId && target.family === source.family && target.rank === source.rank && source.rank < 3)
          this.send({ kind: 'merge', defenderId: source.id, targetId: target.id });
        else if (slot >= 0) this.send({ kind: 'move', defenderId: this.pointerStart.id, slot });
      }
      this.pointerStart = null; this.renderer.drag = null;
    }, { signal });
    canvas.addEventListener('pointercancel', () => { this.pointerStart = null; this.renderer.drag = null; }, { signal });
    canvas.addEventListener('pointerleave', () => { this.renderer.hoverSlot = -1; }, { signal });
    this.$('summon').addEventListener('click', () => this.summon(), { signal });
    this.$('upgrade').addEventListener('click', () => this.send({ kind: 'upgrade' }), { signal });
    this.$('burst').addEventListener('click', () => this.startAim(), { signal });
    context.element.addEventListener('click', event => {
      const merge = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-merge]');
      if (merge && this.selected !== null) this.send({ kind: 'merge', defenderId: this.selected, targetId: Number(merge.dataset.merge) });
    }, { signal });
    window.addEventListener('keydown', event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (document.querySelector('dialog[open]')) return;
      if (event.code === 'Escape') this.cancelAim();
      if (event.code === 'KeyQ') { event.preventDefault(); this.summon(); }
      if (event.code === 'KeyW') { event.preventDefault(); this.send({ kind: 'upgrade' }); }
      if (event.code === 'KeyE') { event.preventDefault(); this.startAim(); }
    }, { signal });
  }
  private $(id: string): HTMLElement { return this.context.element.querySelector(`#${id}`)!; }
  private send(action: DefenseAction): void {
    if (!this.room || this.room.phase !== 'playing') return;
    this.context.command(action);
  }
  private summon(): void {
    const slot = this.renderer.hoverSlot;
    this.send(slot >= 0 && !this.state?.defenders.some(d => d.slot === slot) ? { kind: 'summon', slot } : { kind: 'summon' });
  }
  private startAim(): void {
    const player = this.state?.players.find(p => p.id === this.context.playerId);
    if (!player || !this.state || this.state.phase !== 'battle') { this.context.notice('전투가 시작되면 별비를 사용할 수 있어요.'); return; }
    if (player.burstReadyAt > this.state.time) { this.context.notice('별비를 충전하고 있어요.'); return; }
    this.aiming = !this.aiming;
    this.context.element.querySelector<HTMLElement>('.aim-banner')!.hidden = !this.aiming;
    this.renderer.aiming = this.aiming ? { x: 492, y: 364 } : null;
    this.renderer.canvas.classList.toggle('aiming', this.aiming);
    this.$('burst').classList.toggle('active', this.aiming);
  }
  private cancelAim(): void {
    this.aiming = false; this.renderer.aiming = null; this.renderer.canvas.classList.remove('aiming');
    this.context.element.querySelector<HTMLElement>('.aim-banner')!.hidden = true; this.$('burst').classList.remove('active');
  }
  update(room: RoomSnapshot): void {
    this.room = room;
    const state = room.game as DefenseState;
    if (state?.mode !== 'starwood') return;
    this.state = state;
    this.renderer.update(state, room.players);
    if (this.selected !== null && !state.defenders.some(d => d.id === this.selected)) { this.selected = null; this.renderer.selected = null; }
    this.refreshUI();
    const overlay = this.context.element.querySelector<HTMLElement>('.result-overlay')!;
    overlay.hidden = room.phase !== 'finished';
    if (room.phase === 'finished') {
      this.cancelAim();
      this.$('result-title').textContent = state.phase === 'victory' ? '오늘도 숲을 지켰어요!' : '숲은 다음 도전을 기다려요';
      this.$('result-copy').textContent = `${state.wave} 웨이브 · ${state.totalKills}마리 처치 · ${Math.floor(state.time / 60)}분 ${Math.floor(state.time % 60)}초`;
      this.$('return-lobby').hidden = room.hostId !== this.context.playerId;
      this.context.element.querySelector<HTMLElement>('.result-wait')!.hidden = room.hostId === this.context.playerId;
    }
  }
  private refreshUI(): void {
    if (!this.state || !this.room) return;
    const now = performance.now(); if (now - this.uiAt < 100) return; this.uiAt = now;
    const state = this.state, room = this.room;
    const player = state.players.find(p => p.id === this.context.playerId); if (!player) return;
    this.$('gold').textContent = player.gold.toLocaleString();
    this.$('wave-number').textContent = String(state.wave).padStart(2, '0');
    this.$('wave-kind').textContent = state.wave % 4 === 0 && state.wave ? '보스 웨이브' : state.phase === 'preparing' ? '준비 중' : '방어 중';
    const seconds = Math.max(0, Math.ceil(state.waveEndsAt - state.time));
    this.$('wave-time').textContent = state.wave === LAST_WAVE ? '마지막 적까지 막아주세요' : `다음 웨이브 ${seconds}초`;
    this.$('wave-progress').style.width = `${state.phase === 'preparing' ? 0 : Math.min(100, (20 - seconds) / 20 * 100)}%`;
    this.$('enemy-count').textContent = `${state.enemies.length} / ${MAX_ENEMIES}`;
    this.$('enemy-count').classList.toggle('danger', state.enemies.length > MAX_ENEMIES * 0.7);
    this.$('danger-note').textContent = state.bossDeadline ? `보스 제한 시간 ${Math.max(0, Math.ceil(state.bossDeadline - state.time))}초` : `몬스터가 ${MAX_ENEMIES}마리 쌓이면 숲을 잃어요.`;
    this.$('board-count').textContent = `${state.defenders.filter(d => d.ownerId === player.id).length} / 10 내 수호자`;
    this.$('battle-state').textContent = state.phase === 'preparing' ? '소환과 합성으로 첫 전투를 준비하세요' : `함께 ${state.totalKills}마리를 막아냈어요`;
    this.$('upgrade-level').textContent = `+${player.upgrade}`;
    this.$('upgrade-cost').textContent = player.upgrade >= 10 ? '최대 강화 완료' : `✦ ${upgradeCost(player.upgrade)} · 내 수호자 공격력 +15%`;
    (this.$('summon') as HTMLButtonElement).disabled = player.gold < SUMMON_COST || state.defenders.filter(d => d.ownerId === player.id).length >= 10 || room.phase !== 'playing';
    (this.$('upgrade') as HTMLButtonElement).disabled = player.gold < upgradeCost(player.upgrade) || player.upgrade >= 10 || room.phase !== 'playing';
    const cooldown = Math.ceil(player.burstReadyAt - state.time);
    this.$('burst-label').textContent = cooldown > 0 ? `${cooldown}초 뒤 사용 가능` : '범위 공격 · 준비 완료';
    (this.$('burst') as HTMLButtonElement).disabled = cooldown > 0 || state.phase !== 'battle' || room.phase !== 'playing';
    this.$('pity-count').textContent = `${player.pity} / ${PITY_COUNT}`;
    this.context.element.querySelectorAll('.luck-dots i').forEach((dot, index) => dot.classList.toggle('lit', index < player.pity));
    this.$('party-count').textContent = `${room.players.length} / 4`;
    this.$('party-list').replaceChildren(...room.players.map(info => {
      const stats = state.players.find(p => p.id === info.id);
      const row = document.createElement('div'); row.className = 'party-member';
      row.innerHTML = `<div class="avatar" style="--player-color:${info.color}"></div><div class="member-name"></div><div class="member-kills"><b>${stats?.kills ?? 0}</b><small>처치</small></div>`;
      const name = row.querySelector('.member-name')!; const strong = document.createElement('strong'); strong.textContent = info.name; name.append(strong);
      const small = document.createElement('small'); small.textContent = info.id === player.id ? '나 · 함께 방어 중' : info.connected ? '함께 방어 중' : '재접속 대기 중'; name.append(small);
      if (info.id === player.id) row.classList.add('me'); return row;
    }));
    const unit = state.defenders.find(d => d.id === this.selected);
    const detail = this.$('guardian-detail');
    if (unit) {
      const key = `${unit.family}-${unit.rank}`;
      if (!this.images.has(key)) this.images.set(key, portrait(unit.family, unit.rank));
      const info = FAMILIES_INFO[unit.family], rarity = RARITIES[unit.rank];
      const owner = state.players.find(p => p.id === unit.ownerId);
      const pair = state.defenders.find(d => d.id !== unit.id && d.ownerId === player.id && d.family === unit.family && d.rank === unit.rank && unit.rank < 3);
      const detailKey = `${unit.id}:${unit.rank}:${owner?.upgrade}:${pair?.id}`;
      if (this.detailKey === detailKey) return;
      this.detailKey = detailKey;
      detail.innerHTML = `<div class="guardian-heading"><div class="portrait" style="--rank-color:${rarity.color}"><img src="${this.images.get(key)}" alt="${info.name}" /></div><div><span class="rarity" style="color:${rarity.color}">${rarity.name}</span><h3>${info.name}</h3><small>${info.role}</small></div></div><div class="guardian-stats"><div><small>공격력</small><b>${defenderDamage(unit, owner?.upgrade ?? 0)}</b></div><div><small>공격 주기</small><b>${info.interval}초</b></div><div><small>사거리</small><b>${info.range}</b></div></div>${unit.ownerId === player.id ? `<button class="merge-button" ${!pair || unit.rank >= 3 ? 'disabled' : ''} data-merge="${pair?.id ?? ''}"><span>✧</span> ${unit.rank >= 3 ? '최고 등급 수호자' : pair ? `${rarity.name} 2명 → ${RARITIES[unit.rank + 1].name} 합성` : '같은 수호자가 한 명 더 필요해요'}</button><p class="selection-tip">드래그해서 이동 · 내 수호자끼리 자리 교환</p>` : '<p class="selection-tip">친구의 수호자예요. 조작은 친구에게 맡겨요.</p>'}`;
    } else if (!detail.querySelector('.empty-selection')) { this.detailKey = ''; detail.innerHTML = '<div class="empty-selection"><span>⌖</span><p>전장의 수호자를 선택하세요</p><small>사거리와 합성 가능 대상을 확인해요.</small></div>'; }
  }
  destroy(): void { this.abort.abort(); this.renderer.destroy(); this.context.element.replaceChildren(); }
}
