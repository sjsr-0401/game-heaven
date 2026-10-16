import test from 'node:test';
import assert from 'node:assert/strict';
import {EscapeSession,escapeMode} from '../server/modes/escape.js';
import {dist,type Enemy,type EscapeState} from '../shared/escape.js';
import type {PlayerInfo} from '../shared/protocol.js';
import {decide} from '../scripts/crew-agent.js';
const players=(count=2):PlayerInfo[]=>Array.from({length:count},(_,i)=>({id:'crew-'+i,name:'친구 '+i,color:'#fff',connected:true,ready:true}));
const game=(n=2)=>new EscapeSession(players(n),123);
const enemy=(id:string,x:number,z:number):Enemy=>({id,x,z,kind:'scrapper',hp:200,maxHp:200,armor:0,stunnedUntil:100,attackAt:100,windupUntil:0,targetX:0,targetZ:0,exposedUntil:0,cycle:0,born:0});
function advance(g:EscapeSession,seconds:number):void{for(let t=0;t<seconds;t+=1/30)g.tick(1/30);}
test('the new expedition supports two to four human players',()=>{assert.equal(escapeMode.minPlayers,2);assert.equal(escapeMode.maxPlayers,4);assert.equal(game(4).state.crew.length,4);});
test('movement is normalized, rate-independent, expires, and rejects invalid coordinates',()=>{
  const g=game(),p=g.state.crew[0];p.x=-10;const x=p.x,z=p.z;
  assert.equal(g.command(p.id,{kind:'input',x:1,z:1,aimX:1,aimZ:0}).ok,true);advance(g,.3);
  assert.ok(Math.hypot(p.x-x,p.z-z)<1.6);
  const before={x:p.x,z:p.z};advance(g,1);assert.ok(dist(p,before)<.35,'a stale key must not keep moving the player');
  assert.equal(g.command(p.id,{kind:'input',x:NaN,z:0,aimX:1,aimZ:0}).ok,false);
  assert.equal(g.command(p.id,{kind:'input',x:Infinity,z:0,aimX:1,aimZ:0}).ok,false);
});
test('hook ownership and range prevent theft and remote pickup',()=>{
  const g=game(),a=g.state.crew[0],b=g.state.crew[1],o=g.state.props[0];g.state.props=[o];a.x=-7;a.z=-1;o.x=-7;o.z=4;
  assert.ok(g.command(a.id,{kind:'hook',x:o.x,z:o.z}).ok);assert.equal(a.carry,o.id);
  b.x=-7;b.z=1;g.command(b.id,{kind:'hook',x:o.x,z:o.z});assert.equal(b.carry,null);assert.equal(o.owner,a.id);
  g.command(a.id,{kind:'drop'});a.x=-15;a.z=-15;advance(g,.6);g.command(a.id,{kind:'hook',x:o.x,z:o.z});assert.equal(a.carry,null);
});
test('hooks hit the first object on the line and enforce a cooldown',()=>{
  const g=game(),p=g.state.crew[0];g.state.props=[];p.x=-8;p.z=0;const front=enemy('front',-8,4),back=enemy('back',-8,8);g.state.enemies=[front,back];
  g.command(p.id,{kind:'hook',x:-8,z:10});assert.equal(front.hp,178);assert.equal(back.hp,200);
  assert.equal(g.command(p.id,{kind:'hook',x:-8,z:10}).ok,false);assert.equal(front.hp,178);
});
test('throws use swept collision, damage opponents, and consume the thrown object',()=>{
  const g=game(),p=g.state.crew[0],o=g.state.props[0];g.state.props=[o];o.kind='barrel';o.owner=p.id;p.carry=o.id;p.x=-8;p.z=0;p.aimX=0;p.aimZ=1;
  const e=enemy('target',-8,6);g.state.enemies=[e];g.command(p.id,{kind:'throw',x:-8,z:14});advance(g,.6);
  assert.ok(e.hp<=30);assert.equal(g.state.props.some(p=>p.id===o.id),false);assert.equal(p.stats.throws,1);
});
test('a barrel explosion cannot hurt allies',()=>{
  const g=game(),p=g.state.crew[0],friend=g.state.crew[1],o=g.state.props[0];g.state.props=[o];o.kind='barrel';o.owner=p.id;p.carry=o.id;p.x=-8;p.z=0;p.aimX=0;p.aimZ=1;friend.x=-8;friend.z=5;
  g.command(p.id,{kind:'throw',x:-8,z:5});advance(g,.8);assert.equal(friend.hp,100);
});
test('repair and battery installation require proximity and spend the owned item once',()=>{
  const g=game(),p=g.state.crew[0],o=g.state.props[0];o.kind='repair';o.owner=p.id;p.carry=o.id;g.state.house.hp=100;p.x=-16;
  assert.equal(g.command(p.id,{kind:'install'}).ok,false);assert.equal(g.state.house.hp,100);
  p.x=-3;assert.equal(g.command(p.id,{kind:'install'}).ok,true);assert.equal(g.state.house.hp,122);
  assert.equal(g.command(p.id,{kind:'install'}).ok,false);assert.equal(g.state.house.hp,122);
  const battery=g.state.props[0];battery.kind='battery';battery.owner=p.id;p.carry=battery.id;g.command(p.id,{kind:'install'});assert.ok(g.state.house.boostUntil>g.state.clock);
});
test('a hook rescues a downed teammate immediately without waiting for a respawn',()=>{
  const g=game(),p=g.state.crew[0],friend=g.state.crew[1];g.state.props=[];p.x=-8;p.z=0;friend.x=-8;friend.z=6;friend.hp=0;friend.downUntil=15;
  g.command(p.id,{kind:'hook',x:-8,z:6});assert.equal(friend.downUntil,0);assert.equal(friend.hp,55);assert.equal(p.stats.rescues,1);assert.ok(dist(p,friend)<2);
});
test('automatic recovery has a finite wait and a shared, limited consequence',()=>{
  const g=game(),p=g.state.crew[0];g.state.phase='camp';g.state.campUntil=1000;p.hp=0;p.downUntil=3;const hp=g.state.house.hp;
  advance(g,3.5);assert.equal(p.downUntil,0);assert.equal(p.hp,65);assert.equal(g.state.house.hp,hp-8);
});
test('shared upgrades validate phase, cost, ownership and caps without overspending',()=>{
  const g=game(),p=g.state.crew[0];assert.equal(g.command(p.id,{kind:'upgrade',upgrade:'hull'}).ok,false);
  g.state.phase='camp';g.state.resources=3;assert.equal(g.command(p.id,{kind:'upgrade',upgrade:'hull'}).ok,true);
  assert.equal(g.state.resources,0);assert.equal(g.state.house.maxHp,280);
  assert.equal(g.command(g.state.crew[1].id,{kind:'upgrade',upgrade:'hull'}).ok,false);
  assert.equal(g.command(p.id,{kind:'upgrade',upgrade:'__proto__'}).ok,false);
  assert.equal(g.command('outsider',{kind:'upgrade',upgrade:'hook'}).ok,false);
});
test('leaving drops carried equipment and snapshots cannot mutate server state',()=>{
  const g=game(),p=g.state.crew[0],o=g.state.props[0];p.carry=o.id;o.owner=p.id;g.playerLeft(p.id);
  assert.equal(o.owner,null);assert.equal(p.left,true);const snapshot=g.snapshot();snapshot.house.hp=0;assert.ok(g.state.house.hp>0);
});
test('dodge cooldown cannot be bypassed and hazard damage is authoritative',()=>{
  const g=game(),p=g.state.crew[0];g.state.props=[];p.x=-10;p.z=0;
  assert.equal(g.command(p.id,{kind:'dodge'}).ok,true);assert.equal(g.command(p.id,{kind:'dodge'}).ok,false);
  g.state.hazards=[{id:'test',kind:'slam',x:p.x,z:p.z,toX:p.x,toZ:p.z,radius:3,at:.1,by:'fixture'}];advance(g,.15);assert.equal(p.hp,100);
  advance(g,.8);g.state.hazards=[{id:'test2',kind:'slam',x:p.x,z:p.z,toX:p.x,toZ:p.z,radius:3,at:g.state.clock+.1,by:'fixture'}];advance(g,.15);assert.equal(p.hp,58);
});
test('both branches accept votes only during camp',()=>{
  const g=game(),p=g.state.crew[0];assert.equal(g.command(p.id,{kind:'vote',route:'foundry'}).ok,false);
  g.state.phase='camp';g.state.campUntil=.05;assert.ok(g.command(p.id,{kind:'vote',route:'foundry'}).ok);g.tick(.1);assert.equal(g.state.biome,'foundry');assert.equal(g.state.stage,2);
});
test('a completely unattended expedition reaches a real defeat',()=>{const g=game();advance(g,300);assert.equal(g.state.phase,'lost');assert.equal(g.state.house.hp,0);});
test('production commands can complete seeded two, three and four-player expeditions',()=>{
  const results:unknown[]=[];
  for(const n of [2,3,4])for(const seed of [41,729]){
    const g=new EscapeSession(players(n),seed);let next=0;const cds=new Map<string,number>();
    for(let tick=0;tick<30*650&&!g.finished();tick++){
      if(g.state.clock>=next){next=g.state.clock+.13;
        g.state.crew.forEach((p,i)=>{const d=decide(g.state,p.id,i);g.command(p.id,{kind:'input',...d.move,aimX:d.aim.x-p.x,aimZ:d.aim.z-p.z});
          if(d.dodge)g.command(p.id,{kind:'dodge'});if(d.route)g.command(p.id,{kind:'vote',route:d.route});if(d.upgrade)g.command(p.id,{kind:'upgrade',upgrade:d.upgrade});
          if(d.action&&g.state.clock>(cds.get(p.id+d.action)??0)){g.command(p.id,{kind:d.action,x:d.aim.x,z:d.aim.z});cds.set(p.id+d.action,g.state.clock+(d.action==='hook'?.53:d.action==='dodge'?1.5:.5));}
        });
      }g.tick(1/30);
    }
    results.push({n,seed,phase:g.state.phase,distance:Math.round(g.state.distance),hp:Math.round(g.state.house.hp),seconds:Math.round(g.state.clock),boss:g.state.bossDefeated,stats:g.state.crew.map(p=>p.stats)});
    assert.ok(g.finished());assert.ok(Number.isFinite(g.state.house.hp));assert.ok(g.state.crew.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)));
  }console.log('EXPEDITION_SAMPLES '+JSON.stringify(results));
});
