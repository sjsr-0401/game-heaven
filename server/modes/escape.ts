import type {PlayerInfo} from '../../shared/protocol.js';
import {isRecord} from '../../shared/protocol.js';
import {crewSpeed,constrainCrew,WORLD_HALF_WIDTH,ESCAPE_ID,ESCAPE_VERSION,STAGE_ENDS,PROP_INFO,CREW_COLORS,clamp,dist,distanceToSegment,onDeck,upgradeCost,type EscapeState,type CrewActor,type Prop,type PropKind,type Enemy,type UpgradeId,type EscapeEvent,type Vec} from '../../shared/escape.js';
import type {CommandResult,GameMode,ModeSession} from './types.js';
interface Motion {x:number;z:number;at:number}
const kinds:PropKind[]=['scrap','battery','barrel','repair','spring'];
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<100000;
export class EscapeSession implements ModeSession {
  readonly state:EscapeState;
  private seed:number;private serial=0;private eventId=0;
  private motions=new Map<string,Motion>();private nextEnemy=9;private nextSupply=7;private nextPassive=15;
  private bossSpawned=false;private spawnDistance=0;
  constructor(players:PlayerInfo[],seed:number) {
    this.seed=seed>>>0;
    const maxHp=200+players.length*20;
    this.state={version:ESCAPE_VERSION,clock:0,phase:'travel',stage:1,biome:'quarry',house:{x:0,z:0,hp:maxHp,maxHp,boostUntil:0,speed:0},
      stormZ:-32,crew:players.map((p,i)=>({id:p.id,name:p.name,color:CREW_COLORS.find(color=>color===p.color)??CREW_COLORS[i],x:i%2===0?-3.1:3.1,z:Math.floor(i/2)*2-1,
        hp:100,maxHp:100,aimX:i%2===0?-1:1,aimZ:.1,carry:null,downUntil:0,invulnerableUntil:0,dodgeUntil:0,dodgeReady:0,hookReady:0,throwReady:0,walk:0,left:false,
        stats:{hooks:0,throws:0,rescues:0,repairs:0,deliveries:0,damage:0,downs:0}})),
      props:[],enemies:[],hazards:[],events:[],gate:{z:44,hp:200+players.length*35,maxHp:200+players.length*35,open:false},
      resources:2,upgrades:{hook:0,hull:0,reel:0,blast:0,medic:0,engine:0},campUntil:0,votes:{},bossDefeated:false,result:'',distance:0};
    const positions=[[-7,3],[7,3],[-6,8],[6,8],[-9,-2],[9,-2],[-6,15],[6,15]];
    positions.forEach((p,i)=>this.spawnProp(kinds[i%kinds.length],p[0],p[1]));
  }
  private random():number {this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
  private id(prefix:string):string{return prefix+(++this.serial);}
  private event(type:EscapeEvent['type'],p:Vec,extra:Partial<EscapeEvent>={}):void{
    this.state.events.push({id:++this.eventId,type,at:this.state.clock,x:p.x,z:p.z,...extra});
    if(this.state.events.length>90)this.state.events.splice(0,this.state.events.length-90);
  }
  private spawnProp(kind:PropKind,x:number,z:number):Prop {
    const p:Prop={id:this.id('p'),kind,x,z,owner:null,vx:0,vz:0,flight:0,flightMax:0,by:null,ttl:0,pad:false,born:this.state.clock};
    this.state.props.push(p);return p;
  }
  private actors():CrewActor[]{return this.state.crew.filter(p=>!p.left);}
  private actor(id:string):CrewActor|undefined{return this.state.crew.find(p=>p.id===id&&!p.left);}
  private dropped(p:CrewActor):void {
    const object=this.state.props.find(o=>o.id===p.carry);
    if(object){object.owner=null;object.x=clamp(p.x+p.aimX*1.1,-WORLD_HALF_WIDTH,WORLD_HALF_WIDTH);object.z=p.z+p.aimZ*1.1;object.by=null;
      const rz=object.z-this.state.house.z;if(Math.abs(object.x)<2.5&&rz>-2.9&&rz<2.5)object.x=p.x<0?-3:3;}
    p.carry=null;
  }
  command(id:string,raw:unknown):CommandResult {
    const p=this.actor(id),s=this.state;
    if(!p||!isRecord(raw)||typeof raw.kind!=='string')return{ok:false,error:'명령을 확인할 수 없어요.'};
    if(this.finished())return{ok:false,error:'원정이 끝났어요.'};
    if(raw.kind==='input'){
      if(!finite(raw.x)||!finite(raw.z)||!finite(raw.aimX)||!finite(raw.aimZ))return{ok:false,error:'올바르지 않은 이동입니다.'};
      const length=Math.max(1,Math.hypot(raw.x,raw.z));
      this.motions.set(id,{x:raw.x/length,z:raw.z/length,at:s.clock});
      const a=Math.hypot(raw.aimX,raw.aimZ);
      if(a>.01){p.aimX=raw.aimX/a;p.aimZ=raw.aimZ/a;}
      return{ok:true,broadcast:false};
    }
    if(raw.kind==='ping'){
      if(!finite(raw.x)||!finite(raw.z)||dist(p,{x:raw.x,z:raw.z})>25)return{ok:false};
      const last=[...s.events].reverse().find(e=>e.type==='ping'&&e.by===id);
      if(last&&s.clock-last.at<1)return{ok:false};
      this.event('ping',{x:raw.x,z:raw.z},{by:id,text:p.name});return{ok:true};
    }
    if(raw.kind==='vote'&&s.phase==='camp'&&(raw.route==='canal'||raw.route==='foundry')){
      s.votes[id]=raw.route;return{ok:true};
    }
    if(raw.kind==='upgrade'&&s.phase==='camp'){
      const key=raw.upgrade as UpgradeId;
      if(!Object.prototype.hasOwnProperty.call(s.upgrades,key))return{ok:false,error:'없는 장치입니다.'};
      const level=s.upgrades[key],cost=upgradeCost(level);
      if(level>=2||s.resources<cost)return{ok:false,error:'부품이 부족하거나 이미 최대로 개조했어요.'};
      s.resources-=cost;s.upgrades[key]++;
      if(key==='hull'){s.house.maxHp+=40;s.house.hp=Math.min(s.house.maxHp,s.house.hp+40);}
      this.event('upgrade',s.house,{by:id,text:key});return{ok:true};
    }
    if(p.downUntil>s.clock)return{ok:false};
    if(raw.kind==='drop'){this.dropped(p);return{ok:true};}
    if(raw.kind==='dodge'){
      if(s.clock<p.dodgeReady)return{ok:false};
      p.dodgeUntil=s.clock+.23;p.dodgeReady=s.clock+1.45;p.invulnerableUntil=s.clock+.32;
      this.event('dodge',p,{by:id});return{ok:true};
    }
    if(raw.kind==='install')return this.install(p);
    if(raw.kind==='hook'){
      if(!finite(raw.x)||!finite(raw.z)||s.clock<p.hookReady||p.carry)return{ok:false};
      p.hookReady=s.clock+.48;p.stats.hooks++;
      const range=12+s.upgrades.reel*3,a=Math.atan2(raw.z-p.z,raw.x-p.x);
      p.aimX=Math.cos(a);p.aimZ=Math.sin(a);
      const end={x:p.x+Math.cos(a)*range,z:p.z+Math.sin(a)*range};
      const candidates:{distance:number;type:'crew'|'prop'|'enemy'|'gate';target:Vec & {id?:string}}[]=[];
      for(const c of this.actors())if(c.id!==id&&c.downUntil>s.clock&&distanceToSegment(c,p,end)<1.15&&dist(p,c)<=range)candidates.push({distance:dist(p,c),type:'crew',target:c});
      for(const o of s.props)if(!o.owner&&!o.flight&&!o.pad&&distanceToSegment(o,p,end)<.9&&dist(p,o)<=range)candidates.push({distance:dist(p,o),type:'prop',target:o});
      for(const e of s.enemies)if(distanceToSegment(e,p,end)<(e.kind==='devourer'?2.5:1)&&dist(p,e)<=range)candidates.push({distance:dist(p,e),type:'enemy',target:e});
      if(!s.gate.open&&distanceToSegment({x:0,z:s.gate.z},p,end)<3.6&&Math.abs(s.gate.z-p.z)<=range)candidates.push({distance:Math.abs(s.gate.z-p.z),type:'gate',target:{x:0,z:s.gate.z}});
      const target=candidates.sort((a,b)=>a.distance-b.distance)[0];
      const point=target?.target??end;
      this.event('hook',p,{by:id,toX:point.x,toZ:point.z,prop:target?.type==='prop'?(target.target as Prop).kind:undefined});
      if(target?.type==='crew'){
        const other=target.target as CrewActor;
        other.downUntil=0;other.hp=55;other.x=p.x+p.aimX*1.4;other.z=p.z+p.aimZ*1.4;other.invulnerableUntil=s.clock+2.5;
        p.stats.rescues++;s.house.hp=Math.min(s.house.maxHp,s.house.hp+s.upgrades.medic*8);
        this.event('rescue',other,{by:id,text:other.name});return{ok:true};
      }
      if(target?.type==='prop'){const o=target.target as Prop;o.owner=id;o.by=null;p.carry=o.id;return{ok:true};}
      if(target?.type==='enemy'){
        const e=target.target as Enemy,damage=22+s.upgrades.hook*12;
        if(e.armor>0){e.armor=Math.max(0,e.armor-damage*1.5);this.event('hit',e,{by:id,value:Math.round(damage),text:'장갑'});}
        else this.damage(e,damage*(e.kind==='devourer'&&e.exposedUntil<=s.clock?.4:1),id);
        if(e.kind!=='devourer'){e.stunnedUntil=s.clock+.5;const d=Math.max(1,dist(e,p));e.x+=(p.x-e.x)/d*1.1;e.z+=(p.z-e.z)/d*1.1;}
      }
      if(target?.type==='gate')this.damageGate(26+s.upgrades.hook*12,id);
      return{ok:true};
    }
    if(raw.kind==='throw'){
      if(!finite(raw.x)||!finite(raw.z)||s.clock<p.throwReady)return{ok:false};
      p.throwReady=s.clock+.42;
      const o=s.props.find(o=>o.id===p.carry&&o.owner===id);
      if(!o){for(const e of s.enemies)if(e.kind!=='devourer'&&dist(e,p)<3){this.damage(e,14,id);e.stunnedUntil=s.clock+.65;const d=Math.max(.1,dist(e,p));e.x+=(e.x-p.x)/d*2;e.z+=(e.z-p.z)/d*2;}return{ok:true};}
      const distance=clamp(Math.hypot(raw.x-p.x,raw.z-p.z),3,18),angle=Math.hypot(raw.x-p.x,raw.z-p.z)<.1?Math.atan2(p.aimZ,p.aimX):Math.atan2(raw.z-p.z,raw.x-p.x);
      p.aimX=Math.cos(angle);p.aimZ=Math.sin(angle);o.x=p.x+p.aimX*.9;o.z=p.z+p.aimZ*.9;o.owner=null;o.by=id;o.vx=Math.cos(angle)*distance/.64;o.vz=Math.sin(angle)*distance/.64;
      o.flight=o.flightMax=.64;o.ttl=s.clock+4;p.carry=null;p.stats.throws++;
      this.event('throw',p,{by:id,toX:raw.x,toZ:raw.z,prop:o.kind});return{ok:true};
    }
    return{ok:false};
  }
  private install(p:CrewActor):CommandResult {
    const s=this.state,o=s.props.find(o=>o.id===p.carry&&o.owner===p.id);
    if(!o)return{ok:false,error:'먼저 갈고리로 물건을 회수하세요.'};
    if(o.kind==='spring'){
      o.owner=null;o.pad=true;o.x=p.x;o.z=p.z;o.ttl=s.clock+36;p.carry=null;
      this.event('install',p,{by:p.id,prop:o.kind});return{ok:true};
    }
    if(dist(p,s.house)>7.8)return{ok:false,error:'집 가까이에서 장착할 수 있어요.'};
    if(o.kind==='battery'){s.house.boostUntil=Math.max(s.house.boostUntil,s.clock)+12+s.upgrades.engine*5;this.event('install',s.house,{by:p.id,prop:o.kind,text:'터보 가동'});}
    if(o.kind==='repair'){
      const heal=22+s.upgrades.medic*8;s.house.hp=Math.min(s.house.maxHp,s.house.hp+heal);
      for(const c of this.actors())if(c.downUntil<=s.clock&&dist(c,p)<9)c.hp=Math.min(c.maxHp,c.hp+35);
      p.stats.repairs++;this.event('repair',s.house,{by:p.id,value:heal,prop:o.kind});
    }
    if(o.kind==='scrap'){s.resources=Math.min(99,s.resources+2);p.stats.deliveries++;this.event('install',s.house,{by:p.id,prop:o.kind,text:'부품 +2'});}
    if(o.kind==='barrel'){
      const target=[...s.enemies].sort((a,b)=>dist(a,s.house)-dist(b,s.house))[0];
      if(!target)return{ok:false,error:'지금은 가까운 적이 없어요. 화약통은 던져서 쓸 수도 있어요.'};
      this.explode({x:target.x,z:target.z},o,p.id);this.event('install',s.house,{by:p.id,prop:o.kind,text:'박격포 발사'});
    }
    s.props=s.props.filter(a=>a!==o);p.carry=null;return{ok:true};
  }
  private damageGate(amount:number,by:string):void {
    const s=this.state;if(s.gate.open)return;
    s.gate.hp=Math.max(0,s.gate.hp-amount);const player=this.actor(by);if(player)player.stats.damage+=amount;
    this.event('hit',{x:0,z:s.gate.z},{value:Math.round(amount),by,text:'gate'});
    if(!s.gate.hp){s.gate.open=true;s.resources+=3;this.event('explode',{x:0,z:s.gate.z},{value:3,text:'길이 열렸다!'});}
  }
  private damage(e:Enemy,amount:number,by:string):void {
    if(e.hp<=0)return;const actual=Math.min(e.hp,amount);e.hp-=amount;
    const p=this.actor(by);if(p)p.stats.damage+=actual;
    this.event('hit',e,{by,value:Math.round(actual)});
    if(e.hp<=0){this.event('kill',e,{by,value:e.kind==='devourer'?8:1});
      if(e.kind==='devourer'){this.state.bossDefeated=true;this.state.hazards=[];this.state.gate.open=true;this.state.resources+=8;this.event('boss',e,{text:'추격자 격파!'});}
      else if(this.random()<.38)this.spawnProp(this.random()<.5?'scrap':'repair',e.x,e.z);
    }
  }
  private hurt(p:CrewActor,amount:number):void {
    const s=this.state;if(p.left||p.downUntil>s.clock||p.invulnerableUntil>s.clock)return;
    p.hp=Math.max(0,p.hp-amount);p.invulnerableUntil=s.clock+.8;this.event('hit',p,{by:p.id,value:amount,text:'crew'});
    if(p.hp<=0){this.dropped(p);p.downUntil=s.clock+16;p.stats.downs++;this.event('down',p,{by:p.id});}
  }
  private explode(at:Vec,o:Prop,by:string):void {
    const s=this.state,radius=(o.kind==='barrel'?4.4:o.kind==='battery'?3.4:1.65)+s.upgrades.blast*.35;
    const damage=PROP_INFO[o.kind].damage*(1+s.upgrades.blast*.25);
    this.event(o.kind==='barrel'||o.kind==='battery'?'explode':'hit',at,{by,prop:o.kind,value:Math.round(damage)});
    for(const e of s.enemies)if(dist(at,e)<radius+(e.kind==='devourer'?1.8:.65)){
      if(o.kind==='battery'){e.armor=0;e.stunnedUntil=s.clock+2;e.exposedUntil=s.clock+4;}
      if(e.armor>0)e.armor=Math.max(0,e.armor-damage);
      this.damage(e,damage*(e.kind==='devourer'&&e.exposedUntil<=s.clock?.65:1),by);
    }
    if(!s.gate.open&&Math.abs(at.z-s.gate.z)<radius+1.4&&Math.abs(at.x)<radius+3)this.damageGate(damage,by);
    // Explosions push friends briefly; they cannot injure or down them.
    if(o.kind==='barrel')for(const p of this.actors())if(p.downUntil<=s.clock&&dist(p,at)<radius){
      const d=Math.max(.1,dist(p,at));p.x=clamp(p.x+(p.x-at.x)/d*.7,-WORLD_HALF_WIDTH,WORLD_HALF_WIDTH);p.z+=(p.z-at.z)/d*.7;
    }
  }
  private spawnEnemy(kind?:Enemy['kind']):void {
    const s=this.state,n=this.actors().length;
    kind??=(s.biome==='canal'&&this.random()<.35?'snatcher':this.random()<(s.biome==='foundry'?.5:.28)?'rammer':'scrapper');
    const hp=kind==='devourer'?600+n*180:kind==='rammer'?115:kind==='snatcher'?55:65;
    const e:Enemy={id:this.id('e'),kind,x:kind==='devourer'?0:(this.random()<.5?-1:1)*(10+this.random()*4),
      z:s.house.z+(kind==='devourer'?13:this.random()*22-5),hp,maxHp:hp,armor:kind==='rammer'?45:0,
      stunnedUntil:0,attackAt:s.clock+(kind==='devourer'?4:2),windupUntil:0,targetX:0,targetZ:0,exposedUntil:0,cycle:0,born:s.clock};
    s.enemies.push(e);if(kind==='devourer')this.event('boss',e,{text:'고철 포식자',value:hp});
  }
  private camp():void {
    const s=this.state;s.phase='camp';s.campUntil=s.clock+20;s.hazards=[];s.enemies=[];
    s.house.hp=Math.min(s.house.maxHp,s.house.hp+25);s.resources+=2;s.votes={};
    for(const p of this.actors()){p.hp=100;p.downUntil=0;p.x=p.x<0?-3.2:3.2;p.z=s.house.z+(this.random()-.5)*4;p.invulnerableUntil=s.clock+2;}
    this.spawnProp('repair',-6,s.house.z+1);this.spawnProp('barrel',6,s.house.z+3);this.spawnProp('battery',-6,s.house.z+6);
    this.event('camp',s.house,{text:'잠깐의 숨 돌림'});
  }
  private leaveCamp():void {
    const s=this.state;const votes=Object.values(s.votes);
    s.biome=votes.filter(x=>x==='foundry').length>votes.filter(x=>x==='canal').length?'foundry':'canal';
    s.stage++;s.phase='travel';
    const hp=260+this.actors().length*40;
    s.gate={z:STAGE_ENDS[s.stage-1],hp,maxHp:hp,open:s.stage===3};
    this.nextEnemy=s.clock+6;this.nextSupply=s.clock+5;this.spawnDistance=s.house.z;
    this.event('camp',s.house,{text:s.biome==='canal'?'물안개 운하':'붉은 제련소'});
  }
  tick(dt:number):void {
    if(this.finished()||!Number.isFinite(dt)||dt<=0)return;
    dt=Math.min(dt,.1);const s=this.state;s.clock+=dt;
    s.events=s.events.filter(e=>s.clock-e.at<2.5);
    if(s.phase==='camp'&&s.clock>=s.campUntil)this.leaveCamp();
    const active=s.phase==='travel',lastZ=s.house.z;
    let speed=(.48+s.upgrades.engine*.0384)*(s.house.boostUntil>s.clock?1.7:1);
    if(!active||(!s.gate.open&&s.house.z>s.gate.z-10)||(this.bossSpawned&&!s.bossDefeated&&s.house.z>127))speed=0;
    s.house.speed=speed;s.house.z+=speed*dt;s.distance=s.house.z;
    const delta=s.house.z-lastZ;
    if(active)s.stormZ+=(s.stage===3?.43:.34)*dt;
    for(const p of this.actors()){
      if(onDeck(p,{x:0,z:lastZ}))p.z+=delta;
      if(p.downUntil>0&&p.downUntil<=s.clock){p.downUntil=0;p.hp=65;p.x=s.crew.indexOf(p)%2?-3.1:3.1;p.z=s.house.z;p.invulnerableUntil=s.clock+3;s.house.hp-=8;this.event('rescue',p,{text:'긴급 복귀'});}
      if(p.downUntil>s.clock)continue;
      const input=this.motions.get(p.id),fresh=input&&s.clock-input.at<.32;
      let x=fresh?input.x:0,z=fresh?input.z:0;
      if(p.dodgeUntil>s.clock){const len=Math.hypot(x,z);if(len<.1){x=p.aimX;z=p.aimZ;}}
      const velocity=crewSpeed(s,p),next=constrainCrew({x:p.x+x*velocity*dt,z:p.z+z*velocity*dt},s.house);
      p.x=next.x;p.z=next.z;if(Math.hypot(x,z)>.1)p.walk+=velocity*dt;
      if(p.z<s.stormZ+2&&active)this.hurt(p,15);
      for(const pad of s.props)if(pad.pad&&dist(p,pad)<1&&p.dodgeUntil<=s.clock&&p.dodgeReady<=s.clock){
        p.dodgeUntil=s.clock+.5;p.dodgeReady=s.clock+1.5;p.invulnerableUntil=s.clock+.55;
        this.event('pad',p,{by:p.id});
      }
    }
    for(const o of s.props){
      if(o.owner){const p=this.actor(o.owner);if(p){o.x=p.x+p.aimX*1.1;o.z=p.z+p.aimZ*1.1;}else o.owner=null;continue;}
      if(o.flight>0){
        const before={x:o.x,z:o.z};o.x+=o.vx*dt;o.z+=o.vz*dt;o.flight=Math.max(0,o.flight-dt);
        const hit=s.enemies.find(e=>e.hp>0&&distanceToSegment(e,before,o)<(e.kind==='devourer'?2.5:1.1));
        const gate=!s.gate.open&&Math.abs(o.z-s.gate.z)<1.2&&Math.abs(o.x)<4.5;
        if(hit||gate||!o.flight){this.explode(hit??o,o,o.by??'');o.ttl=-1;o.flight=0;}
      }
    }
    s.props=s.props.filter(o=>o.owner||(!o.ttl||o.ttl>s.clock)&&o.z>s.house.z-30);
    if(active){
      if(s.clock>=this.nextEnemy&&s.enemies.filter(e=>e.kind!=='devourer').length<4+this.actors().length*2){
        this.spawnEnemy();if(this.actors().length>=3&&this.random()<.5)this.spawnEnemy();
        this.nextEnemy=s.clock+Math.max(2.8,6-this.actors().length*.5)-(s.stage-1)*.4;
      }
      if(s.clock>=this.nextSupply||s.house.z-this.spawnDistance>5){
        if(s.props.filter(o=>!o.owner&&!o.pad).length<28){
          const choice=this.random();const kind:PropKind=choice<.26?'barrel':choice<.48?'repair':choice<.69?'scrap':choice<.9?'battery':'spring';
          this.spawnProp(kind,(this.random()<.5?-1:1)*(5.8+this.random()*3.5),s.house.z+5+this.random()*12);
        }
        this.nextSupply=s.clock+4.5;this.spawnDistance=s.house.z;
      }
      if(s.stage===3&&!this.bossSpawned&&s.house.z>112){this.bossSpawned=true;this.spawnEnemy('devourer');}
      this.enemies(dt);
      for(const h of s.hazards.filter(h=>h.at<=s.clock)){
        for(const p of this.actors())if((h.kind==='charge'?distanceToSegment(p,h,{x:h.toX,z:h.toZ}):dist(p,h))<h.radius)this.hurt(p,h.kind==='slam'?42:30);
        if((h.kind==='charge'?distanceToSegment(s.house,h,{x:h.toX,z:h.toZ}):dist(s.house,h))<h.radius+2)s.house.hp-=h.kind==='slam'?10:5;
        this.event('explode',h,{value:h.radius,text:h.kind});
      }
      s.hazards=s.hazards.filter(h=>h.at>s.clock);
      if(s.stormZ>s.house.z-5)s.house.hp-=10*dt;
      if(s.clock>=this.nextPassive){s.resources=Math.min(99,s.resources+1);this.nextPassive=s.clock+25;}
      if(s.stage<3&&s.gate.open&&s.house.z>=s.gate.z-1)this.camp();
      if(s.stage===3&&s.bossDefeated&&s.house.z>=STAGE_ENDS[2])this.end(true,'모두의 집을 지켜냈다!');
    }
    s.enemies=s.enemies.filter(e=>e.hp>0&&e.z>s.house.z-30);
    s.house.hp=clamp(s.house.hp,0,s.house.maxHp);
    if(s.house.hp<=0)this.end(false,'집이 멈췄어요. 다음에는 더 멀리.');
    if(s.clock>720)this.end(false,'폭풍이 도시를 집어삼켰어요.');
  }
  private enemies(dt:number):void {
    const s=this.state;
    for(const e of s.enemies){
      if(e.hp<=0||e.stunnedUntil>s.clock)continue;
      if(e.kind==='devourer'){
        e.z=Math.max(e.z,s.house.z+10);
        if(e.attackAt<=s.clock){
          e.cycle++;e.attackAt=s.clock+6.5;e.exposedUntil=s.clock+3.5;
          const living=this.actors().filter(p=>p.downUntil<=s.clock);
          const target=living[Math.floor(this.random()*living.length)]??s.house;
          if(e.cycle%3===0){
            for(const o of s.props)if(!o.owner&&!o.pad&&!o.flight&&dist(o,e)<20){o.x+=(e.x-o.x)*.45;o.z+=(e.z-o.z)*.45;}
            this.event('warning',e,{text:'흡입! 화약통을 던질 기회'});
          }else{
            const h={id:this.id('h'),kind:'slam' as const,x:target.x,z:target.z,radius:e.cycle%2?4:5.5,toX:target.x,toZ:target.z,at:s.clock+1.65,by:e.id};
            s.hazards.push(h);this.event('warning',h,{text:'붉은 원 밖으로!'});
          }
        }continue;
      }
      if(e.kind==='rammer'&&e.attackAt<=s.clock&&dist(e,s.house)<16){
        const target=this.actors().filter(p=>p.downUntil<=s.clock).sort((a,b)=>dist(a,e)-dist(b,e))[0]??s.house;
        e.attackAt=s.clock+6;e.windupUntil=s.clock+1.25;e.targetX=target.x;e.targetZ=target.z;
        s.hazards.push({id:this.id('h'),kind:'charge',x:e.x,z:e.z,toX:target.x,toZ:target.z,radius:1.7,at:s.clock+1.25,by:e.id});
        this.event('warning',e,{text:'돌진 준비'});continue;
      }
      if(e.windupUntil>0){
        if(s.clock>=e.windupUntil){e.x=e.targetX;e.z=e.targetZ;e.windupUntil=0;}else continue;
      }
      const near=this.actors().filter(p=>p.downUntil<=s.clock).sort((a,b)=>dist(a,e)-dist(b,e))[0];
      const houseTarget={x:e.x<0?-4:4,z:s.house.z+(e.kind==='snatcher'?-3:2)};
      const target=near&&dist(near,e)<5?near:houseTarget;
      const d=dist(e,target),speed=e.kind==='snatcher'?2.9:e.kind==='rammer'?1.3:1.9;
      if(d>1.3){e.x+=(target.x-e.x)/d*speed*dt;e.z+=(target.z-e.z)/d*speed*dt;}
      else if(e.attackAt<=s.clock){
        e.attackAt=s.clock+2.2;if('hp' in target)this.hurt(target as CrewActor,e.kind==='rammer'?22:14);
        else{s.house.hp-=s.upgrades.hull?2.2:3.2;this.event('hit',houseTarget,{value:3,text:'house'});}
      }
    }
  }
  private end(win:boolean,reason:string):void {
    if(this.finished())return;this.state.phase=win?'won':'lost';this.state.result=reason;this.state.house.speed=0;this.state.hazards=[];
    this.event(win?'win':'lose',this.state.house,{text:reason});
  }
  snapshot():EscapeState{return structuredClone(this.state);}
  finished():boolean{return this.state.phase==='won'||this.state.phase==='lost';}
  playerLeft(id:string):void {const p=this.actor(id);if(p){this.dropped(p);p.left=true;this.motions.delete(id);}}
}
export const escapeMode:GameMode={id:ESCAPE_ID,title:'집째로 도망',subtitle:'갈고리 하나로, 같이 살아남자.',minPlayers:2,maxPlayers:4,create:(players,seed)=>new EscapeSession(players,seed)};
