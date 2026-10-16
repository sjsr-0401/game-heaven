import test from 'node:test';
import assert from 'node:assert/strict';
import { StarwoodSession } from '../server/modes/starwood.js';
import { LAST_WAVE, MAX_DEFENDERS, MAX_ENEMIES, PATH_LENGTH, RARITIES, SUMMON_COST, WAGER_COST, createRandom, rollRank, trackPosition, type Enemy } from '../shared/defense.js';
import type { PlayerInfo } from '../shared/protocol.js';

const players:PlayerInfo[]=[{id:'a',name:'A',color:'#ffcc88',connected:true,ready:true},{id:'b',name:'B',color:'#88ccff',connected:true,ready:true}];
function make(seed=78){return new StarwoodSession(players,seed);}
function battle(session:StarwoodSession):void{session.state.phase='battle';session.state.wave=1;session.state.waveEndsAt=999;session.state.spawned=100;}
function enemy(id:number,ownerId='a',hp=1):Enemy{return {id,ownerId,hp,maxHp:hp,progress:200,speed:80,kind:'raider',slowUntil:0};}
function advance(session:StarwoodSession,seconds:number):void{for(let i=0;i<seconds*30;i++)session.tick(1/30);}

test('published normal and wager odds are complete, with reproducible server rolls',()=>{
  assert.ok(Math.abs(RARITIES.reduce((n,r)=>n+r.chance,0)-1)<1e-12);
  assert.ok(Math.abs(RARITIES.reduce((n,r)=>n+r.wagerChance,0)-1)<1e-12);
  assert.deepEqual([0,.6999,.7001,.9401,.9901,.9991].map(n=>rollRank(n)),[0,0,1,2,3,4]);
  assert.deepEqual([.5599,.5601,.8801,.9801,.9981].map(n=>rollRank(n,true)),[0,1,2,3,4]);
  const a=createRandom(99),b=createRandom(99);
  assert.deepEqual(Array.from({length:100},a),Array.from({length:100},b));
  assert.deepEqual(trackPosition(PATH_LENGTH),trackPosition(0));
});
test('each player starts with a separate human army and can occupy identical slots',()=>{
  const s=make(),a=s.state.defenders.filter(d=>d.ownerId==='a'),b=s.state.defenders.filter(d=>d.ownerId==='b');
  assert.equal(a.length,4);assert.equal(b.length,4);
  assert.deepEqual(a.map(d=>d.slot),b.map(d=>d.slot));
  assert.equal(s.command('a',{kind:'move',defenderId:a[0].id,slot:b[1].slot}).ok,true);
  assert.equal(b[1].slot,6);
});
test('summoning spends the chosen cost, accepts no client supplied rarity, and preserves the other economy',()=>{
  const s=make(),b=JSON.stringify(s.state.players[1]);
  const result=s.command('a',{kind:'summon',wager:true,rank:4,family:'fake'});
  assert.equal(result.ok,true);assert.equal(s.state.players[0].gold,520-WAGER_COST);
  assert.equal(s.state.players[0].wagers,1);assert.equal(s.state.players[0].summons,1);
  const same=make();same.command('a',{kind:'summon',wager:true});
  assert.deepEqual(s.state.defenders,same.state.defenders);assert.equal(JSON.stringify(s.state.players[1]),b);
  s.command('a',{kind:'summon'});assert.equal(s.state.players[0].gold,520-WAGER_COST-SUMMON_COST);
});
test('invalid spending, board coordinates, ownership and removed merge commands cannot mutate state',()=>{
  const s=make(),other=s.state.defenders.find(d=>d.ownerId==='b')!;
  s.state.players[0].gold=0;
  for(const action of [{kind:'summon'},{kind:'summon',wager:'yes'},{kind:'upgrade'},
    {kind:'move',defenderId:other.id,slot:2},{kind:'dismiss',defenderId:other.id},
    {kind:'move',defenderId:1,slot:NaN},{kind:'merge',defenderId:1,targetId:2},
    {kind:'burst',x:Infinity,y:1}]){
    const before=JSON.stringify(s.state);assert.equal(s.command('a',action).ok,false);assert.equal(JSON.stringify(s.state),before);
  }
});
test('army cap and dismiss refund leave room for a new summon without profitable infinite recycling',()=>{
  const s=make();s.state.players[0].gold=10000;
  while(s.state.defenders.filter(d=>d.ownerId==='a').length<MAX_DEFENDERS)assert.equal(s.command('a',{kind:'summon'}).ok,true);
  const gold=s.state.players[0].gold;assert.equal(s.command('a',{kind:'summon'}).ok,false);assert.equal(s.state.players[0].gold,gold);
  const unit=s.state.defenders.find(d=>d.ownerId==='a'&&d.rank===0)!;
  assert.equal(s.command('a',{kind:'dismiss',defenderId:unit.id}).ok,true);
  assert.equal(s.state.players[0].gold,gold+10);assert.equal(s.command('a',{kind:'summon'}).ok,true);
});
test('kills, rewards and damage remain on the attacking player board',()=>{
  const s=make();battle(s);s.state.defenders=s.state.defenders.filter(d=>d.ownerId==='a');
  s.state.enemies=[enemy(100,'a'),enemy(101,'b',300)];
  const goldB=s.state.players[1].gold;s.tick(.1);
  assert.equal(s.state.players[0].kills,1);assert.equal(s.state.players[1].kills,0);
  assert.equal(s.state.players[1].gold,goldB);assert.equal(s.state.enemies.find(e=>e.id===101)!.hp,300);
  assert.ok(s.state.events.some(e=>e.type==='hit'&&e.ownerId==='a'));
});
test('burst affects only own enemies and cooldown prevents repeat damage',()=>{
  const s=make();battle(s);s.state.defenders=[];s.state.enemies=[enemy(100,'a',1000),enemy(101,'b',1000)];
  assert.equal(s.command('a',{kind:'burst',x:331,y:124}).ok,true);
  assert.ok(s.state.enemies[0].hp<1000);assert.equal(s.state.enemies[1].hp,1000);
  const before=s.state.enemies[0].hp;assert.equal(s.command('a',{kind:'burst',x:331,y:124}).ok,false);assert.equal(s.state.enemies[0].hp,before);
});
test('one player defeat freezes only that board while the room and friend keep playing',()=>{
  const s=make();battle(s);s.state.defenders=[];
  s.state.enemies=Array.from({length:MAX_ENEMIES},(_,i)=>enemy(100+i,'a',1000));
  s.tick(.1);assert.equal(s.state.players[0].status,'defeat');assert.equal(s.state.players[1].status,'active');assert.equal(s.finished(),false);
  const old=s.state.enemies[0].progress;s.tick(.1);assert.equal(s.state.enemies[0].progress,old);
  assert.equal(s.command('a',{kind:'summon'}).ok,false);assert.equal(s.command('b',{kind:'summon'}).ok,true);
});
test('boss deadlines and victory resolve individually, then all terminal boards finish the room',()=>{
  const s=make();battle(s);s.state.defenders=[];
  s.state.enemies=[{...enemy(100,'a',1000),kind:'boss'},enemy(101,'b',1000)];s.state.bossDeadlines.a=.05;
  s.tick(.1);assert.equal(s.state.players[0].status,'defeat');assert.equal(s.state.players[1].status,'active');
  s.state.wave=LAST_WAVE;s.state.enemies=[];s.tick(.1);
  assert.equal(s.state.players[1].status,'victory');assert.equal(s.finished(),true);
});
test('leaving or expiring a player removes only their board, with all-player leave ending the mode',()=>{
  const s=make();s.playerLeft('a');assert.equal(s.state.players[0].status,'left');
  assert.ok(s.state.defenders.every(d=>d.ownerId==='b'));assert.equal(s.finished(),false);
  s.playerLeft('b');assert.equal(s.finished(),true);
});
test('a full unattended multiplayer match reaches valid terminal results without simulation errors',()=>{
  const s=make(34);advance(s,240);
  assert.equal(s.finished(),true);assert.ok(s.state.players.every(p=>p.status==='defeat'||p.status==='victory'));
  assert.ok(s.state.enemies.every(e=>Number.isFinite(e.progress)&&Number.isFinite(e.hp)));
});
