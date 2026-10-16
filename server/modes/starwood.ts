import { randomInt } from 'node:crypto';
import {
  BOARD, BOSSES, DEFENSE_ID, FAMILIES, GRID, LAST_WAVE, MAX_DEFENDERS, PRIORITIES,
  RARITIES, RELICS, RELIC_IDS, START_GOLD, SUMMON_COST, WAVE_SECONDS,
  armyStats, burstCooldown, createRandom, dismissValue, enemyLimit, rollRank, slotPosition, trackPosition, upgradeCost, wagerCost, waveInfo,
  type CombatEvent,type Defender,type DefensePlayer,type DefenseState,type Enemy,type RelicId,
} from '../../shared/defense.js';
import { isRecord,type PlayerInfo } from '../../shared/protocol.js';
import type { CommandResult,GameMode,ModeSession } from './types.js';

const fail=(error:string):CommandResult=>({ok:false,error}),ok:CommandResult={ok:true};
export class StarwoodSession implements ModeSession {
  readonly state:DefenseState;
  private nextId=1;
  private eventId=1;
  private nextSpawn=0;
  private lastIncome=0;
  private random:()=>number;
  private draws=new Map<string,()=>number>();
  constructor(players:PlayerInfo[],seed=randomInt(0,2147483647)){
    this.random=createRandom(seed^0x931ab);
    this.state={mode:DEFENSE_ID,time:0,phase:'preparing',wave:0,waveEndsAt:7,spawned:0,bossDeadlines:{},hazards:[],
      players:players.map(p=>({id:p.id,gold:START_GOLD,upgrade:0,kills:0,summons:0,wagers:0,bestRank:0,burstReadyAt:0,
        status:'active',endedAt:0,reason:'',relics:[],relicChoices:[],drafts:0,contracts:0,bosses:0,damage:0})),
      defenders:[],enemies:[],events:[]};
    players.forEach((p,index)=>{
      this.draws.set(p.id,createRandom(seed+index*104729));
      FAMILIES.slice(0,4).forEach((family,i)=>this.addDefender(p.id,family,0,[1,6,32,38][i],false));
    });
    this.state.events=[];
  }
  private event(event:Omit<CombatEvent,'id'|'at'>):void{this.state.events.push({...event,id:this.eventId++,at:this.state.time});}
  private active():DefensePlayer[]{return this.state.players.filter(p=>p.status==='active');}
  private addDefender(ownerId:string,family:Defender['family'],rank:number,slot:number,wager:boolean):Defender{
    const unit:Defender={id:this.nextId++,ownerId,family,rank,slot,cooldown:.25,kills:0,damage:0,priority:'front',stunnedUntil:0};
    this.state.defenders.push(unit);
    this.event({type:'summon',ownerId,...slotPosition(slot),family,rank,unitId:unit.id,special:wager,
      text:RARITIES[rank].name+' · '+familyName(family)});
    return unit;
  }
  command(playerId:string,action:unknown):CommandResult{
    const player=this.state.players.find(p=>p.id===playerId);
    if(!player)return fail('참가 중인 플레이어가 아닙니다.');
    if(this.finished()||player.status!=='active')return fail('내 전투가 종료됐어요. 친구 전장을 관전하세요.');
    if(!isRecord(action))return fail('올바르지 않은 명령입니다.');
    const army=this.state.defenders.filter(d=>d.ownerId===playerId);
    if(action.kind==='summon'){
      if(action.wager!==undefined&&typeof action.wager!=='boolean')return fail('올바르지 않은 소환 방식입니다.');
      const wager=action.wager===true,contract=wager&&player.contracts>0,cost=wager?wagerCost(player):SUMMON_COST;
      if(!contract&&player.gold<cost)return fail('소환할 골드가 부족해요.');
      if(army.length>=MAX_DEFENDERS)return fail('용병은 최대 16명입니다. 필요 없는 용병을 해고할 수 있어요.');
      const occupied=new Set(army.map(d=>d.slot));
      let slot=-1;
      if(action.slot!==undefined){
        if(!this.validSlot(action.slot)||occupied.has(action.slot))return fail('빈 배치 칸을 선택하세요.');
        slot=action.slot;
      }else{
        const preferred=[0,7,8,15,24,31,39,33,2,5,34,37,16,23,3,4];
        slot=preferred.find(s=>!occupied.has(s))??Array.from({length:40},(_,i)=>i).find(s=>!occupied.has(s))??-1;
      }
      if(slot<0)return fail('소환할 빈자리가 없어요.');
      const random=this.draws.get(playerId)!;
      const rank=rollRank(random(),wager),family=FAMILIES[Math.floor(random()*FAMILIES.length)];
      if(contract)player.contracts--;else player.gold-=cost;
      player.summons++;if(wager)player.wagers++;player.bestRank=Math.max(player.bestRank,rank);
      this.addDefender(playerId,family,rank,slot,wager);
      return ok;
    }
    if(action.kind==='relic'){
      if(typeof action.relic!=='string'||!player.relicChoices.includes(action.relic as RelicId))return fail('현재 제안받은 유물 중 하나를 선택하세요.');
      const relic=action.relic as RelicId;
      player.relics.push(relic);player.relicChoices=[];player.drafts++;
      if(player.drafts<[2,5,8].filter(w=>w<=this.state.wave).length)this.offerRelics(player);
      this.event({type:'relic',ownerId:playerId,x:492,y:350,relic,text:RELICS[relic].name});
      return ok;
    }
    if(action.kind==='upgrade'){
      if(player.upgrade>=8)return fail('최대 강화에 도달했어요.');
      const cost=upgradeCost(player.upgrade);if(player.gold<cost)return fail('강화할 골드가 부족해요.');
      player.gold-=cost;player.upgrade++;
      this.event({type:'upgrade',ownerId:playerId,x:492,y:350,text:'전원 공격력 +'+player.upgrade*18+'%'});
      return ok;
    }
    if(action.kind==='burst'){
      if(this.state.phase!=='battle')return fail('전투가 시작되면 사용할 수 있어요.');
      if(this.state.time<player.burstReadyAt)return fail('지원 포격을 준비하고 있어요.');
      if(typeof action.x!=='number'||typeof action.y!=='number'||!Number.isFinite(action.x)||!Number.isFinite(action.y)
        ||action.x<0||action.x>BOARD.width||action.y<0||action.y>BOARD.height)return fail('전장 안을 선택하세요.');
      player.burstReadyAt=this.state.time+burstCooldown(player);
      this.event({type:'burst',ownerId:playerId,x:action.x,y:action.y});
      for(const enemy of this.state.enemies.filter(e=>e.ownerId===playerId&&e.hp>0)){
        const p=trackPosition(enemy.progress);
        if(Math.hypot(p.x-action.x,p.y-action.y)<=165){
          enemy.shatteredUntil=this.state.time+3;
          this.damage(enemy,(200+this.state.wave*55)*(player.relics.includes('powder')?1.4:1)*(enemy.kind==='boss'&&player.relics.includes('hunter')?1.45:1),undefined,false,'ember',true);
        }
      }
      return ok;
    }
    if(action.kind==='move'||action.kind==='dismiss'||action.kind==='priority'){
      const unit=army.find(d=>d.id===action.defenderId);if(!unit)return fail('내 용병만 지휘할 수 있어요.');
      if(action.kind==='dismiss'){
        player.gold+=dismissValue(unit.rank);this.state.defenders.splice(this.state.defenders.indexOf(unit),1);return ok;
      }
      if(action.kind==='priority'){
        if(typeof action.priority!=='string'||!Object.hasOwn(PRIORITIES,action.priority))return fail('올바른 공격 우선순위를 선택하세요.');
        unit.priority=action.priority as Defender['priority'];return ok;
      }
      if(!this.validSlot(action.slot))return fail('배치 가능한 칸을 선택하세요.');
      const other=army.find(d=>d.slot===action.slot),old=unit.slot;
      unit.slot=action.slot;if(other)other.slot=old;
      return ok;
    }
    return fail('지원하지 않는 명령입니다.');
  }
  private validSlot(slot:unknown):slot is number{return typeof slot==='number'&&Number.isInteger(slot)&&slot>=0&&slot<GRID.cols*GRID.rows;}
  private end(player:DefensePlayer,status:'victory'|'defeat',reason:string):void{
    player.status=status;player.endedAt=this.state.time;player.reason=reason;
    this.state.hazards=this.state.hazards.filter(h=>h.ownerId!==player.id);
  }
  private offerRelics(player:DefensePlayer):void{
    if(player.relicChoices.length)return;
    const pool=RELIC_IDS.filter(id=>!player.relics.includes(id)),random=this.draws.get(player.id)!;
    const choices:RelicId[]=[];
    while(choices.length<3&&pool.length)choices.push(pool.splice(Math.floor(random()*pool.length),1)[0]);
    player.relicChoices=choices;
  }
  private beginWave():void{
    this.state.wave++;this.state.phase='battle';this.state.waveEndsAt=this.state.time+WAVE_SECONDS;
    this.state.spawned=0;this.nextSpawn=this.state.time+.65;
    const info=waveInfo(this.state.wave);
    for(const player of this.active()){
      const interest=player.relics.includes('ledger')?Math.min(25,Math.floor(player.gold*.05)):0;
      player.gold+=65+(player.relics.includes('ledger')?35:0)+interest;
      if([2,5,8].includes(this.state.wave))this.offerRelics(player);
      this.event({type:'wave',ownerId:player.id,x:492,y:354,text:'WAVE '+this.state.wave+' · '+info.name});
    }
  }
  private spawnEnemy():void{
    const info=waveInfo(this.state.wave),boss=!!info.boss&&this.state.spawned===0;
    const kind:Enemy['kind']=boss?'boss':info.kind==='wraith'&&this.state.spawned%3===0?'raider':info.kind;
    const base=75*1.34**(this.state.wave-1);
    const hp=Math.round(boss?1500*1.28**(this.state.wave-1):base*(kind==='brute'?2.2:kind==='runner'?.68:kind==='wraith'?1.15:1));
    for(const player of this.active()){
      const enemy:Enemy={id:this.nextId++,ownerId:player.id,progress:0,hp,maxHp:hp,
        speed:boss?39:kind==='runner'?135+this.state.wave*2:kind==='brute'?55+this.state.wave*2:79+this.state.wave*2,
        kind,slowUntil:0,armor:kind==='brute'?.35:boss?.15:0,bossType:boss?info.boss:undefined,abilityAt:boss?this.state.time+2.2:undefined};
      this.state.enemies.push(enemy);
      if(boss){
        this.state.bossDeadlines[player.id]=this.state.time+38;
        this.event({type:'wave',ownerId:player.id,x:492,y:354,targetId:enemy.id,special:true,text:BOSSES[info.boss!].name+' 출현'});
      }
    }
    this.state.spawned++;
  }
  private damage(enemy:Enemy,raw:number,unit?:Defender,critical=false,family?:Defender['family'],ignoreArmor=false):void{
    if(enemy.hp<=0)return;
    const armor=ignoreArmor||enemy.shatteredUntil&&enemy.shatteredUntil>this.state.time?0:(enemy.armor??0);
    const amount=Math.min(enemy.hp,Math.max(1,Math.round(raw*(1-armor))));
    enemy.hp-=amount;
    const player=this.state.players.find(p=>p.id===enemy.ownerId)!;
    player.damage+=amount;if(unit)unit.damage+=amount;
    this.event({type:'hit',ownerId:enemy.ownerId,...trackPosition(enemy.progress),targetId:enemy.id,family,amount,critical});
    if(enemy.hp<=0){
      player.kills++;player.gold+=enemy.kind==='boss'?140:enemy.kind==='brute'?8:4;
      if(unit)unit.kills++;
      if(enemy.kind==='boss'){
        player.contracts++;player.bosses++;
        this.state.hazards=this.state.hazards.filter(h=>h.sourceId!==enemy.id);
        this.event({type:'bosskill',ownerId:enemy.ownerId,...trackPosition(enemy.progress),targetId:enemy.id,text:'보스 격파 · 승부 계약서 +1'});
      }
      this.event({type:'kill',ownerId:enemy.ownerId,...trackPosition(enemy.progress),targetId:enemy.id,special:enemy.kind==='boss'});
    }
  }
  private bossActions(enemy:Enemy,army:Defender[]):void{
    if(enemy.kind!=='boss'||enemy.hp<=0)return;
    if(!enemy.enraged&&enemy.hp<enemy.maxHp*.5){
      enemy.enraged=true;if(enemy.bossType==='reaper')enemy.speed*=1.5;
      this.event({type:'wave',ownerId:enemy.ownerId,x:492,y:354,text:'광폭화 · '+BOSSES[enemy.bossType??'warden'].name});
    }
    if(this.state.time<(enemy.abilityAt??Infinity))return;
    enemy.abilityAt=this.state.time+(enemy.enraged?5.5:7);
    if(enemy.bossType==='witch'){
      const hp=Math.round(enemy.maxHp*.025);
      for(let i=0;i<3;i++)this.state.enemies.push({id:this.nextId++,ownerId:enemy.ownerId,progress:Math.max(0,enemy.progress-i*35),
        hp,maxHp:hp,speed:135,kind:'runner',slowUntil:0});
      this.event({type:'hazard',ownerId:enemy.ownerId,...trackPosition(enemy.progress),text:'그림자 증원'});
    }
    if(!army.length)return;
    const target=army[Math.floor(this.random()*army.length)],p=slotPosition(target.slot);
    this.state.hazards.push({id:this.nextId++,ownerId:enemy.ownerId,sourceId:enemy.id,...p,radius:75,resolveAt:this.state.time+2.2});
    this.event({type:'hazard',ownerId:enemy.ownerId,...p,text:'강타 예고 · 붉은 원에서 벗어나세요'});
  }
  tick(dt:number):void{
    if(this.finished()||!Number.isFinite(dt)||dt<=0)return;
    dt=Math.min(dt,.1);this.state.time+=dt;
    this.state.events=this.state.events.filter(e=>this.state.time-e.at<2.2);
    if(this.state.time-this.lastIncome>=5){this.active().forEach(p=>{p.gold+=7;});this.lastIncome=this.state.time;}
    if(this.state.time>=this.state.waveEndsAt&&this.state.wave<LAST_WAVE)this.beginWave();
    if(this.state.phase==='preparing')return;
    const info=waveInfo(this.state.wave);
    if(this.state.time>=this.nextSpawn&&this.state.spawned<info.count){this.spawnEnemy();this.nextSpawn+=Math.min(.68,(WAVE_SECONDS-3)/info.count);}
    for(const player of this.active()){
      const army=this.state.defenders.filter(d=>d.ownerId===player.id);
      const enemies=this.state.enemies.filter(e=>e.ownerId===player.id&&e.hp>0);
      for(const enemy of enemies){
        enemy.progress+=enemy.speed*dt*(enemy.slowUntil>this.state.time?.52:1);
        this.bossActions(enemy,army);
        if((enemy.burnUntil??0)>this.state.time&&this.state.time>=(enemy.burnNext??0)){
          enemy.burnNext=this.state.time+.5;this.damage(enemy,enemy.burnDamage??0,undefined,false,'ember',true);
        }
      }
      for(const unit of army){
        unit.cooldown-=dt;if(unit.cooldown>0||unit.stunnedUntil>this.state.time)continue;
        const stats=armyStats(unit,player,army),origin=slotPosition(unit.slot);
        const targets=enemies.filter(e=>e.hp>0&&Math.hypot(trackPosition(e.progress).x-origin.x,trackPosition(e.progress).y-origin.y)<=stats.range)
          .sort((a,b)=>unit.priority==='strong'?b.maxHp-a.maxHp||b.progress-a.progress:unit.priority==='weak'?a.hp-b.hp||b.progress-a.progress:b.progress-a.progress);
        const target=targets[0];if(!target)continue;
        const critical=this.random()<stats.crit,point=trackPosition(target.progress);
        const raw=stats.damage*(critical?(unit.family==='shade'?2.2:1.8):1);
        const amount=(e:Enemy)=>raw*(e.kind==='boss'?stats.bossMultiplier:1)*(e.slowUntil>this.state.time?stats.frostBonus:1);
        unit.cooldown=stats.interval;
        this.event({type:'shot',ownerId:player.id,unitId:unit.id,targetId:target.id,...origin,tx:point.x,ty:point.y,
          family:unit.family,rank:unit.rank,critical,special:stats.guild});
        if(unit.family==='ember'||unit.family==='sentinel'){
          for(const enemy of enemies.filter(e=>e.hp>0)){
            const p=trackPosition(enemy.progress);if(Math.hypot(p.x-point.x,p.y-point.y)>(unit.family==='ember'?82:65))continue;
            if(unit.family==='sentinel')enemy.shatteredUntil=this.state.time+(stats.guild?6:3);
            this.damage(enemy,amount(enemy),unit,critical,unit.family,unit.family==='sentinel');
            if(unit.family==='ember'&&stats.guild&&enemy.hp>0){
              enemy.burnUntil=this.state.time+3;enemy.burnDamage=Math.max(enemy.burnDamage??0,raw*.12);enemy.burnNext=this.state.time+.5;
            }
          }
        }else if(unit.family==='volt'){
          let previous=point;
          targets.slice(0,stats.chain).forEach((enemy,index)=>{
            const dest=trackPosition(enemy.progress);
            if(index)this.event({type:'shot',ownerId:player.id,x:previous.x,y:previous.y+25,tx:dest.x,ty:dest.y,
              family:unit.family,rank:unit.rank,special:stats.guild});
            this.damage(enemy,amount(enemy)*(index?0.65:1),unit,critical,unit.family,true);previous=dest;
          });
        }else{
          this.damage(target,amount(target),unit,critical,unit.family,unit.family==='frost');
          if(unit.family==='frost')target.slowUntil=this.state.time+1.8;
          if(unit.family==='ranger'&&targets[1]){
            const p=trackPosition(targets[1].progress);
            if(Math.hypot(p.x-point.x,p.y-point.y)<65)this.damage(targets[1],amount(targets[1])*.4,unit,false,unit.family);
          }
        }
      }
    }
    for(const hazard of this.state.hazards.filter(h=>h.resolveAt<=this.state.time)){
      for(const unit of this.state.defenders.filter(d=>d.ownerId===hazard.ownerId)){
        const p=slotPosition(unit.slot);
        if(Math.hypot(p.x-hazard.x,p.y-hazard.y)<=hazard.radius)unit.stunnedUntil=Math.max(unit.stunnedUntil,this.state.time+2.8);
      }
      this.event({type:'stun',ownerId:hazard.ownerId,x:hazard.x,y:hazard.y,text:'성문 강타'});
    }
    this.state.hazards=this.state.hazards.filter(h=>h.resolveAt>this.state.time);
    this.state.enemies=this.state.enemies.filter(e=>e.hp>0);
    for(const player of this.active()){
      const enemies=this.state.enemies.filter(e=>e.ownerId===player.id),boss=enemies.some(e=>e.kind==='boss');
      if(!boss)delete this.state.bossDeadlines[player.id];
      if(enemies.length>=enemyLimit(player))this.end(player,'defeat','몬스터 누적 '+enemyLimit(player)+'마리');
      else if(boss&&this.state.time>=this.state.bossDeadlines[player.id])this.end(player,'defeat','보스 제한 시간 초과');
      else if(this.state.wave===LAST_WAVE&&this.state.spawned>=info.count&&enemies.length===0)this.end(player,'victory','새벽까지 '+LAST_WAVE+'웨이브 방어 성공');
    }
    if(!this.active().length)this.state.phase='finished';
  }
  playerLeft(playerId:string):void{
    const player=this.state.players.find(p=>p.id===playerId);
    if(player?.status==='active'){player.status='left';player.endedAt=this.state.time;player.reason='전장 이탈';}
    this.state.defenders=this.state.defenders.filter(d=>d.ownerId!==playerId);
    this.state.enemies=this.state.enemies.filter(e=>e.ownerId!==playerId);
    this.state.hazards=this.state.hazards.filter(h=>h.ownerId!==playerId);
    this.draws.delete(playerId);delete this.state.bossDeadlines[playerId];
    if(!this.active().length)this.state.phase='finished';
  }
  snapshot():DefenseState{return this.state;}
  finished():boolean{return this.state.phase==='finished';}
}
function familyName(family:Defender['family']):string {
  return ({ranger:'유랑 사수',ember:'화염 연금술사',frost:'서리 검사',volt:'뇌전 술사',sentinel:'철갑 수호자',shade:'황혼 척후병'})[family];
}
export const starwoodMode:GameMode={
  id:DEFENSE_ID,title:'밤의 용병단',subtitle:'운으로 모으고, 조합으로 살아남는 개인 디펜스',minPlayers:1,maxPlayers:4,
  create:(players,seed)=>new StarwoodSession(players,seed),
};
