export const WORLD_HALF_WIDTH=12;
export const ESCAPE_ID = 'houseflight';
export const ESCAPE_VERSION = '1.0.0';
export const STAGE_ENDS = [44, 88, 140] as const;
export const CREW_COLORS = ['#f5bd62', '#65d5cc', '#ae9bfa', '#f08d9c'];
export type PropKind = 'scrap' | 'battery' | 'barrel' | 'repair' | 'spring';
export type EnemyKind = 'scrapper' | 'rammer' | 'snatcher' | 'devourer';
export type Biome = 'quarry' | 'canal' | 'foundry';
export type UpgradeId = 'hook' | 'hull' | 'reel' | 'blast' | 'medic' | 'engine';
export const PROP_INFO: Record<PropKind,{name:string;color:string;damage:number;hint:string}> = {
  scrap:{name:'고철 뭉치',color:'#d8c7a9',damage:95,hint:'던져서 공격 · 집에 납품하면 부품 +2'},
  battery:{name:'축전지',color:'#69e4d8',damage:65,hint:'엔진에 장착하면 가속 · 던지면 감전'},
  barrel:{name:'화약통',color:'#ee8862',damage:170,hint:'던지면 범위 폭발 · 집에서 E로 박격포'},
  repair:{name:'수리 가방',color:'#b9d991',damage:45,hint:'집 근처에서 E · 집과 주변 동료 회복'},
  spring:{name:'도약 발판',color:'#bc9beb',damage:80,hint:'E로 설치 · 밟으면 빠르게 도약'}
};
export const UPGRADE_INFO: Record<UpgradeId,{name:string;description:string;icon:string}> = {
  hook:{name:'강철 갈고리',description:'갈고리 공격 +12 · 장갑과 장애물에도 적용',icon:'↗'},
  hull:{name:'덧댄 철판',description:'내구도 +40 · 즉시 40 회복 · 적 타격 완화',icon:'▰'},
  reel:{name:'긴 견인줄',description:'사거리 +3 · 무거운 물건 운반 속도 개선',icon:'⌁'},
  blast:{name:'충격 증폭기',description:'투척 피해 +25% · 폭발 범위 확대',icon:'✶'},
  medic:{name:'구조 장비',description:'구조 시 집 +8 · 집 수리량 +8',icon:'✚'},
  engine:{name:'터보 배관',description:'기본 주행 속도 +8% · 축전지 가속 +5초',icon:'»'}
};
export interface Vec { x:number; z:number }
export interface CrewActor extends Vec {
  id:string;name:string;color:string;hp:number;maxHp:number;aimX:number;aimZ:number;
  carry:string|null;downUntil:number;invulnerableUntil:number;dodgeUntil:number;dodgeReady:number;
  hookReady:number;throwReady:number;walk:number;left:boolean;
  stats:{hooks:number;throws:number;rescues:number;repairs:number;deliveries:number;damage:number;downs:number};
}
export interface Prop extends Vec {
  id:string;kind:PropKind;owner:string|null;vx:number;vz:number;flight:number;flightMax:number;by:string|null;
  ttl:number;pad:boolean;born:number;
}
export interface Enemy extends Vec {
  id:string;kind:EnemyKind;hp:number;maxHp:number;armor:number;stunnedUntil:number;attackAt:number;
  windupUntil:number;targetX:number;targetZ:number;exposedUntil:number;cycle:number;born:number;
}
export interface Hazard extends Vec {id:string;kind:'slam'|'charge'|'sweep';radius:number;toX:number;toZ:number;at:number;by:string}
export interface EscapeEvent extends Vec {
  id:number;type:'hook'|'throw'|'hit'|'explode'|'rescue'|'down'|'repair'|'install'|'dodge'|'warning'|'kill'|'boss'|'camp'|'upgrade'|'win'|'lose'|'ping'|'pad';
  at:number;by?:string;toX?:number;toZ?:number;value?:number;prop?:PropKind;text?:string;
}
export interface EscapeState {
  version:string;clock:number;phase:'travel'|'camp'|'won'|'lost';stage:number;biome:Biome;
  house:Vec & {hp:number;maxHp:number;boostUntil:number;speed:number};
  stormZ:number;crew:CrewActor[];props:Prop[];enemies:Enemy[];hazards:Hazard[];events:EscapeEvent[];
  gate:{z:number;hp:number;maxHp:number;open:boolean};
  resources:number;upgrades:Record<UpgradeId,number>;campUntil:number;votes:Record<string,'canal'|'foundry'>;
  bossDefeated:boolean;result:string;distance:number;
}
export const clamp=(v:number,lo:number,hi:number):number=>Math.max(lo,Math.min(hi,v));
export const dist=(a:Vec,b:Vec):number=>Math.hypot(a.x-b.x,a.z-b.z);
export function distanceToSegment(p:Vec,a:Vec,b:Vec):number {
  const dx=b.x-a.x,dz=b.z-a.z,l=dx*dx+dz*dz;
  const t=l?clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/l,0,1):0;
  return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);
}
export const onDeck=(p:Vec,h:Vec):boolean=>Math.abs(p.x-h.x)<4.6&&Math.abs(p.z-h.z)<5.6;
export const upgradeCost=(level:number):number=>3+level*3;
export function targetProgress(state:EscapeState):number {return clamp(state.house.z/STAGE_ENDS[2],0,1);}

export function crewSpeed(state:EscapeState,actor:CrewActor):number {
 if(actor.dodgeUntil>state.clock)return 12;
 const heavy=state.props.find(o=>o.id===actor.carry)?.kind==='scrap';
 return 4.5*(heavy?.77+state.upgrades.reel*.06:1);
}
export function constrainCrew(point:Vec,house:Vec):Vec {
 let x=clamp(point.x,-WORLD_HALF_WIDTH,WORLD_HALF_WIDTH),z=clamp(point.z,house.z-22,house.z+27),rz=z-house.z;
 if(Math.abs(x)<2.2&&rz>-2.65&&rz<2.2){
  const side=2.2-Math.abs(x),front=2.2-rz,back=rz+2.65;
  if(side<Math.min(front,back))x=x<0?-2.2:2.2;else z=house.z+(front<back?2.2:-2.65);
 }
 return{x,z};
}
