import {dist,onDeck,type EscapeState,type CrewActor,type Vec} from '../shared/escape.js';
export interface Decision {move:Vec;aim:Vec;action?:'hook'|'throw'|'install'|'dodge'|'drop';upgrade?:string;route?:string;dodge?:boolean}
export function decide(s:EscapeState,id:string,index:number):Decision {
  const p=s.crew.find(c=>c.id===id)!;
  let target:Vec={x:index%2===0?-3.1:3.1,z:s.house.z+(index<2?3:-2)};
  const out:Decision={move:{x:0,z:0},aim:{x:p.x+p.aimX*5,z:p.z+p.aimZ*5}};
  if(p.downUntil>s.clock||s.phase==='won'||s.phase==='lost')return out;
  if(s.phase==='camp'){
    const order=['hull','hook','blast','engine','medic','reel'];
    const key=order.find(k=>(s.upgrades as Record<string,number>)[k]<2&&s.resources>=3+(s.upgrades as Record<string,number>)[k]*3);
    if(index===0&&key)out.upgrade=key;out.route=s.stage===1?'canal':'foundry';return out;
  }
  const hazards=s.hazards.filter(h=>h.kind==='charge'?false:dist(p,h)<h.radius+1);
  if(hazards.length){const h=hazards[0];let dx=p.x-h.x,dz=p.z-h.z;if(Math.hypot(dx,dz)<.2){dx=index%2?-1:1;dz=-1;}const d=Math.hypot(dx,dz);out.move={x:dx/d,z:dz/d};out.action='dodge';return out;}
  const down=s.crew.filter(c=>c.id!==id&&!c.left&&c.downUntil>s.clock).sort((a,b)=>dist(a,p)-dist(b,p))[0];
  const carried=s.props.find(o=>o.id===p.carry);
  const enemies=[...s.enemies].sort((a,b)=>dist(a,p)-dist(b,p));
  const near=enemies.find(e=>dist(e,p)<13);
  const blocked=!s.gate.open&&s.gate.z-s.house.z<16;
  const boss=enemies.find(e=>e.kind==='devourer');
  if(down&&dist(down,p)<18&&!carried){target=down;out.aim=down;if(dist(down,p)<11)out.action='hook';}
  else if(carried){
    if(carried.kind==='repair'||carried.kind==='battery'||carried.kind==='scrap'){
      if(carried.kind==='battery'&&boss&&dist(p,boss)<16){out.aim=boss;out.action='throw';}
      else{target={x:p.x<0?-3.2:3.2,z:s.house.z+2.8};if(dist(p,s.house)<7.4)out.action='install';}
    }else if(carried.kind==='spring'){out.action='install';}
    else if(near){out.aim=near;out.action='throw';}
    else if(blocked){out.aim={x:0,z:s.gate.z};if(dist(p,out.aim)<17)out.action='throw';else target={x:index%2?-4:4,z:s.gate.z-8};}
    else{target={x:index%2?3.1:-3.1,z:s.house.z+3};}
  }else if(blocked){
    target={x:index%2?3.8:-3.8,z:s.gate.z-8};out.aim={x:0,z:s.gate.z};if(dist(p,out.aim)<12+s.upgrades.reel*3)out.action='hook';
  }else{
    const needsRepair=s.house.hp/s.house.maxHp<.72;
    const supplies=s.props.filter(o=>!o.owner&&!o.pad&&!o.flight&&o.z>s.stormZ+5&&dist(o,p)<18);
    const score=(o:typeof supplies[number])=>dist(o,p)+(needsRepair?(o.kind==='repair'?-20:8):o.kind==='barrel'&&near?-6:o.kind==='repair'?8:o.kind==='scrap'?3:o.kind==='spring'?8:0);
    supplies.sort((a,b)=>score(a)-score(b));
    const object=supplies[0];
    if(object&&(needsRepair&&object.kind==='repair'||!near||object.kind==='barrel'&&dist(object,p)<5)){
      target=object;out.aim=object;if(dist(object,p)<10.5+s.upgrades.reel*3)out.action='hook';
    }else if(near){target=near;out.aim=near;if(dist(p,near)<11+s.upgrades.reel*3){out.action='hook';target={x:p.x,z:p.z};}if(dist(p,near)<2.5){target={x:p.x+(p.x-near.x)*2,z:p.z+(p.z-near.z)*2};if(p.dodgeReady<=s.clock)out.dodge=true;}}
    else if(blocked){target={x:index%2?3.8:-3.8,z:s.gate.z-8};out.aim={x:0,z:s.gate.z};if(dist(p,out.aim)<12+s.upgrades.reel*3)out.action='hook';}
    else if(boss){target={x:index%2?7:-7,z:boss.z-7};out.aim=boss;if(dist(p,boss)<12+s.upgrades.reel*3)out.action='hook';}
  }
  // Walk around the cabin rather than pushing through its walls.
  const rz=p.z-s.house.z, tz=target.z-s.house.z;
  if(Math.sign(p.x)!==Math.sign(target.x)&&Math.abs(target.x)>2.2&&Math.abs(p.x)>1){const side=tz>0?1:-1;if(Math.abs(rz)<3.7)target={x:p.x<0?-3.3:3.3,z:s.house.z+side*4};else target={x:target.x,z:p.z};}
  const d=dist(p,target);if(d>.75)out.move={x:(target.x-p.x)/d,z:(target.z-p.z)/d};
  if(!onDeck(p,s.house)&&p.z<s.house.z-14&&p.dodgeReady<s.clock)out.action='dodge';
  return out;
}
