import test from 'node:test';
import assert from 'node:assert/strict';
import { StarwoodSession } from '../server/modes/starwood.js';
import { armyStats,slotPosition,trackPosition,upgradeCost,wagerCost,type DefenseState } from '../shared/defense.js';
import type { PlayerInfo } from '../shared/protocol.js';
const players:PlayerInfo[]=[{id:'bot',name:'balance',color:'#ccaa88',connected:true,ready:true}];
export function commandBot(session:StarwoodSession,id:string):void{
  const s=session.state,p=s.players.find(p=>p.id===id)!;if(p.status!=='active')return;
  const army=s.defenders.filter(d=>d.ownerId===id);
  if(p.relicChoices.length){
    const order=['hunter','banner','clock','emberglass','scope','coin','powder','ledger','blood'];
    session.command(id,{kind:'relic',relic:[...p.relicChoices].sort((a,b)=>order.indexOf(a)-order.indexOf(b))[0]});
  }
  for(const hazard of s.hazards.filter(h=>h.ownerId===id)){
    const occupied=new Set(army.map(d=>d.slot));
    for(const unit of army){
      const point=slotPosition(unit.slot);if(Math.hypot(point.x-hazard.x,point.y-hazard.y)>hazard.radius)continue;
      const slot=Array.from({length:40},(_,i)=>i).find(i=>{const q=slotPosition(i);return !occupied.has(i)&&Math.hypot(q.x-hazard.x,q.y-hazard.y)>120;});
      if(slot!==undefined){occupied.delete(unit.slot);occupied.add(slot);session.command(id,{kind:'move',defenderId:unit.id,slot});}
    }
  }
  if(army.length<12&&p.gold>=40)session.command(id,{kind:'summon',wager:p.gold>=wagerCost(p)*2});
  else if(p.upgrade<6&&p.gold>=upgradeCost(p.upgrade))session.command(id,{kind:'upgrade'});
  else if(army.length>=12&&(p.contracts>0||p.gold>=wagerCost(p)+80)){
    const worst=[...army].sort((a,b)=>armyStats(a,p,army).damage/armyStats(a,p,army).interval-armyStats(b,p,army).damage/armyStats(b,p,army).interval)[0];
    if(worst.rank<2){session.command(id,{kind:'dismiss',defenderId:worst.id});session.command(id,{kind:'summon',wager:true});}
  }
  const enemies=s.enemies.filter(e=>e.ownerId===id),boss=enemies.find(e=>e.kind==='boss');
  if(p.burstReadyAt<=s.time&&s.phase==='battle'&&(boss||enemies.length>=8)){
    const point=trackPosition((boss??enemies[0]).progress);session.command(id,{kind:'burst',x:point.x,y:point.y});
  }
}
test('multiple real recruitment seeds finish full runs with valid economies, choices and results',()=>{
  const results:{seed:number;status:string;wave:number;seconds:number;summons:number;bestRank:number}[]=[];
  for(let seed=1;seed<=16;seed++){
    const game=new StarwoodSession(players,seed*7919);
    for(let step=0;step<30*300&&!game.finished();step++){
      if(step%15===0)commandBot(game,'bot');
      game.tick(1/30);
      const s:DefenseState=game.state,p=s.players[0];
      assert.ok(Number.isFinite(p.gold)&&p.gold>=0);assert.ok(new Set(p.relics).size===p.relics.length);
      assert.ok(s.enemies.every(e=>Number.isFinite(e.hp)&&e.hp>0&&Number.isFinite(e.progress)));
    }
    const p=game.state.players[0];assert.equal(game.finished(),true);
    results.push({seed,status:p.status,wave:game.state.wave,seconds:+game.state.time.toFixed(1),summons:p.summons,bestRank:p.bestRank});
  }
  console.log('BALANCE_SAMPLE '+JSON.stringify({runs:results.length,wins:results.filter(r=>r.status==='victory').length,results}));
});
