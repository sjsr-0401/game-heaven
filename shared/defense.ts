export const DEFENSE_ID = 'nightwatch';
export const GRID = { x: 268, y: 236, cols: 8, rows: 5, step: 64 };
export const TRACK = { left: 131, right: 853, top: 124, bottom: 604 };
export const PATH_LENGTH = 2 * (TRACK.right - TRACK.left + TRACK.bottom - TRACK.top);
export const BOARD = { width: 984, height: 716 };
export const SUMMON_COST = 40;
export const WAGER_COST = 120;
export const MAX_DEFENDERS = 16;
export const LAST_WAVE = 12;
export const WAVE_SECONDS = 18;
export const MAX_ENEMIES = 55;
export const START_GOLD = 420;
export const FAMILIES = ['ranger', 'ember', 'frost', 'volt', 'sentinel', 'shade'] as const;
export type Family = typeof FAMILIES[number];
export type Priority = 'front' | 'strong' | 'weak';
export const PRIORITIES: Record<Priority,string> = { front: '선두 우선', strong: '강한 적 우선', weak: '약한 적 우선' };
export const FAMILIES_INFO = {
  ranger: { name:'유랑 사수',short:'사수',color:'#edc281',role:'빠른 사격 · 관통',damage:27,interval:.75,range:305,guild:'3명 · 공격 속도 +25%',symbol:'⌖' },
  ember: { name:'화염 연금술사',short:'화염',color:'#ff916d',role:'폭발탄 · 범위 공격',damage:44,interval:1.7,range:320,guild:'3명 · 폭발에 3초 화상',symbol:'♨' },
  frost: { name:'서리 검사',short:'서리',color:'#94def2',role:'검기 · 이동 둔화',damage:29,interval:1.15,range:300,guild:'3명 · 둔화된 적 피해 +25%',symbol:'❄' },
  volt: { name:'뇌전 술사',short:'뇌전',color:'#ccb1ff',role:'연쇄 번개 · 군중 제어',damage:25,interval:1.5,range:315,guild:'3명 · 번개 2회 추가 연쇄',symbol:'ϟ' },
  sentinel: { name:'철갑 수호자',short:'철갑',color:'#c4d8ae',role:'충격파 · 장갑 파괴',damage:37,interval:1.5,range:285,guild:'3명 · 파괴된 장갑 회복 지연',symbol:'⛨' },
  shade: { name:'황혼 척후병',short:'황혼',color:'#f4a2bb',role:'투척 단검 · 높은 치명타',damage:22,interval:.68,range:295,guild:'3명 · 치명타 확률 +20%p',symbol:'◈' },
} as const;
export const RARITIES = [
  { name:'일반',color:'#b8c1cf',multiplier:1,chance:.70,wagerChance:.50 },
  { name:'희귀',color:'#7fcfff',multiplier:2.5,chance:.24,wagerChance:.30 },
  { name:'영웅',color:'#c6a0ff',multiplier:6.5,chance:.05,wagerChance:.15 },
  { name:'전설',color:'#ffd075',multiplier:17,chance:.009,wagerChance:.045 },
  { name:'신화',color:'#ff8caf',multiplier:42,chance:.001,wagerChance:.005 },
] as const;
export const RELICS = {
  scope:{name:'매의 망원경',symbol:'⌖',color:'#8fcce5',description:'모든 용병 사거리 +45. 먼 길목부터 사격합니다.'},
  clock:{name:'태엽 심장',symbol:'◷',color:'#e9cc89',description:'모든 용병 공격 속도 +18%.'},
  emberglass:{name:'별을 담은 유리',symbol:'✧',color:'#d8adf0',description:'모든 용병 공격력 +24%.'},
  coin:{name:'도박사의 동전',symbol:'◉',color:'#ebbe78',description:'승부 소환 비용 120 → 90 G. 추첨 확률은 같습니다.'},
  ledger:{name:'낡은 급료 장부',symbol:'▤',color:'#bcd395',description:'매 웨이브 급료 +35 G. 남은 골드의 5% 이자, 최대 25 G.'},
  hunter:{name:'사냥꾼의 인장',symbol:'♜',color:'#f09b81',description:'보스에게 주는 모든 피해 +45%.'},
  powder:{name:'불멸의 화약',symbol:'♨',color:'#f0b485',description:'지원 포격 피해 +40%, 재사용 대기시간 28 → 20초.'},
  banner:{name:'여섯 길드의 깃발',symbol:'⚑',color:'#9edbb5',description:'서로 다른 직업 4종 이상을 배치하면 전원 공격력 +30%.'},
  blood:{name:'핏빛 계약서',symbol:'◇',color:'#f0a3b8',description:'전원 공격력 +40%. 대신 몬스터 허용 수 55 → 45마리.'},
} as const;
export type RelicId = keyof typeof RELICS;
export const RELIC_IDS = Object.keys(RELICS) as RelicId[];
export type BossKind = 'warden' | 'witch' | 'reaper';
export const BOSSES = {
  warden:{name:'녹슨 성문지기',subtitle:'지면 강타 · 붉은 원 밖으로 재배치',color:'#e9b18b'},
  witch:{name:'종탑의 마녀',subtitle:'하수인 소환 · 군중 제어와 범위 공격',color:'#c7a4ef'},
  reaper:{name:'새벽을 삼킨 자',subtitle:'광폭화 · 둔화와 보스 집중 공격',color:'#f098a9'},
} as const;
export interface Defender {
  id:number;ownerId:string;family:Family;rank:number;slot:number;cooldown:number;kills:number;
  damage:number;priority:Priority;stunnedUntil:number;
}
export interface Enemy {
  id:number;ownerId:string;progress:number;hp:number;maxHp:number;speed:number;
  kind:'raider'|'brute'|'runner'|'wraith'|'boss';slowUntil:number;armor?:number;
  shatteredUntil?:number;burnUntil?:number;burnDamage?:number;burnNext?:number;burnSourceId?:number;
  bossType?:BossKind;abilityAt?:number;enraged?:boolean;
}
export interface Hazard { id:number;ownerId:string;sourceId:number;x:number;y:number;radius:number;resolveAt:number; }
export interface DefensePlayer {
  id:string;gold:number;upgrade:number;kills:number;summons:number;wagers:number;bestRank:number;burstReadyAt:number;
  status:'active'|'victory'|'defeat'|'left';endedAt:number;reason:string;
  relics:RelicId[];relicChoices:RelicId[];drafts:number;contracts:number;bosses:number;damage:number;
}
export interface CombatEvent {
  id:number;ownerId:string;type:'shot'|'hit'|'summon'|'burst'|'kill'|'wave'|'upgrade'|'relic'|'hazard'|'bosskill'|'stun';
  at:number;x:number;y:number;tx?:number;ty?:number;family?:Family;rank?:number;amount?:number;text?:string;
  unitId?:number;targetId?:number;critical?:boolean;relic?:RelicId;special?:boolean;
}
export interface DefenseState {
  mode:typeof DEFENSE_ID;time:number;phase:'preparing'|'battle'|'finished';wave:number;waveEndsAt:number;spawned:number;
  players:DefensePlayer[];defenders:Defender[];enemies:Enemy[];events:CombatEvent[];hazards:Hazard[];
  bossDeadlines:Record<string,number>;
}
export type DefenseAction =
  |{kind:'summon';slot?:number;wager?:boolean}
  |{kind:'move';defenderId:number;slot:number}
  |{kind:'priority';defenderId:number;priority:Priority}
  |{kind:'dismiss';defenderId:number}
  |{kind:'relic';relic:RelicId}
  |{kind:'upgrade'}
  |{kind:'burst';x:number;y:number};
export function slotPosition(slot:number):{x:number;y:number}{return{x:GRID.x+slot%GRID.cols*GRID.step,y:GRID.y+Math.floor(slot/GRID.cols)*GRID.step};}
export function trackPosition(progress:number):{x:number;y:number;angle:number}{
  const w=TRACK.right-TRACK.left,h=TRACK.bottom-TRACK.top;
  let p=((progress%PATH_LENGTH)+PATH_LENGTH)%PATH_LENGTH;
  if(p<w)return{x:TRACK.left+p,y:TRACK.top,angle:0};p-=w;
  if(p<h)return{x:TRACK.right,y:TRACK.top+p,angle:Math.PI/2};p-=h;
  if(p<w)return{x:TRACK.right-p,y:TRACK.bottom,angle:Math.PI};
  return{x:TRACK.left,y:TRACK.bottom-(p-w),angle:-Math.PI/2};
}
export function waveInfo(wave:number):{name:string;detail:string;kind:Enemy['kind'];count:number;boss?:BossKind}{
  if(wave>0&&wave%4===0){
    const boss=(['warden','witch','reaper'] as BossKind[])[Math.min(2,Math.floor(wave/4)-1)];
    return{name:BOSSES[boss].name,detail:BOSSES[boss].subtitle,kind:'raider',count:12+wave,boss};
  }
  const pattern=(wave-1)%4;
  return pattern===1?{name:'질주하는 그림자',detail:'빠른 적 · 둔화와 선두 우선 추천',kind:'runner',count:14+wave*2}:
    pattern===2?{name:'철갑 행군',detail:'장갑 피해 감소 · 철갑 수호자로 파괴',kind:'brute',count:8+wave}:
    {name:wave>=5?'안개의 망령':'성문의 약탈자',detail:wave>=5?'망령과 약탈자의 혼성 습격':'기본 습격 · 용병단을 준비하세요',kind:wave>=5?'wraith':'raider',count:12+wave*2};
}
export function upgradeCost(level:number):number{return 100+level*70;}
export function dismissValue(rank:number):number{return [10,20,40,80,160][rank]??0;}
export function wagerCost(player:DefensePlayer):number{return player.relics.includes('coin')?90:WAGER_COST;}
export function enemyLimit(player:DefensePlayer):number{return player.relics.includes('blood')?45:MAX_ENEMIES;}
export function burstCooldown(player:DefensePlayer):number{return player.relics.includes('powder')?20:28;}
export function defenderDamage(defender:Defender,upgrade:number):number {
  return Math.round(FAMILIES_INFO[defender.family].damage*RARITIES[defender.rank].multiplier*(1+upgrade*.18));
}
export function armyStats(unit:Defender,player:DefensePlayer,army:Defender[]){
  const guild=army.filter(d=>d.family===unit.family).length>=3;
  const diverse=new Set(army.map(d=>d.family)).size>=4;
  const damage=defenderDamage(unit,player.upgrade)*(player.relics.includes('emberglass')?1.24:1)
    *(player.relics.includes('blood')?1.4:1)*(player.relics.includes('banner')&&diverse?1.3:1);
  return {
    damage:Math.round(damage),
    interval:FAMILIES_INFO[unit.family].interval/(1+unit.rank*.055)/(player.relics.includes('clock')?1.18:1)/(guild&&unit.family==='ranger'?1.25:1),
    range:FAMILIES_INFO[unit.family].range+(player.relics.includes('scope')?45:0),
    crit:Math.min(.7,(unit.family==='shade'?.27:.10)+(guild&&unit.family==='shade'?.20:0)),
    chain:guild&&unit.family==='volt'?5:3,guild,
    bossMultiplier:player.relics.includes('hunter')?1.45:1,
    frostBonus:army.filter(d=>d.family==='frost').length>=3?1.25:1,
  };
}
export function rollRank(roll:number,wager=false):number{
  let total=0;for(let i=0;i<RARITIES.length;i++){total+=wager?RARITIES[i].wagerChance:RARITIES[i].chance;if(roll<total)return i;}return RARITIES.length-1;
}
export function createRandom(seed:number):()=>number{
  let state=seed>>>0;return()=>{state+=0x6D2B79F5;let x=Math.imul(state^(state>>>15),1|state);x^=x+Math.imul(x^(x>>>7),61|x);return((x^(x>>>14))>>>0)/4294967296;};
}
