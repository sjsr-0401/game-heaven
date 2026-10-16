import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomHub,type Peer} from '../server/rooms.js';
import {escapeMode} from '../server/modes/escape.js';
import type {RoomSnapshot,ServerMessage} from '../shared/protocol.js';
class Socket implements Peer{
  messages:ServerMessage[]=[];constructor(readonly id:string){}
  send(m:ServerMessage):void{this.messages.push(structuredClone(m));}close():void{}
  last<T extends ServerMessage['type']>(kind:T):Extract<ServerMessage,{type:T}>{return [...this.messages].reverse().find(m=>m.type===kind) as Extract<ServerMessage,{type:T}>;}
}
test('a Houseflight room enforces minimum, maximum, readiness and private session restoration',()=>{
  let now=1000;const hub=new RoomHub(new Map([[escapeMode.id,escapeMode]]),()=>now),peers=Array.from({length:5},(_,i)=>new Socket('socket-'+i));
  peers.forEach(p=>hub.connect(p));hub.receive(peers[0].id,{type:'create',name:'A',modeId:escapeMode.id});
  const host=peers[0].last('joined');hub.receive(peers[0].id,{type:'start'});assert.equal(peers[0].last('state').room.phase,'lobby');
  for(let i=1;i<5;i++)hub.receive(peers[i].id,{type:'join',name:'friend '+i,code:host.room.code});
  assert.equal(peers[0].last('state').room.players.length,4);assert.match(peers[4].last('error').message,/가득/);
  hub.receive(peers[0].id,{type:'start'});assert.equal(peers[0].last('state').room.phase,'lobby');
  for(let i=1;i<4;i++)hub.receive(peers[i].id,{type:'ready',ready:true});
  hub.receive(peers[0].id,{type:'start'});assert.equal(peers[0].last('state').room.phase,'playing');
  const old=peers[2].last('joined');hub.disconnect(peers[2].id);now+=1000;
  const resumed=new Socket('resumed');hub.connect(resumed);hub.receive(resumed.id,{type:'resume',token:old.token,code:host.room.code});
  assert.equal(resumed.last('joined').playerId,old.playerId);assert.notEqual(resumed.last('joined').token,old.token);
  const json=JSON.stringify(resumed.last('joined').room);assert.ok(!json.includes(host.token));assert.ok(!json.includes(old.token));assert.ok(!json.includes('token'));
  const before=JSON.stringify(resumed.last('state').room.game);
  hub.receive(resumed.id,{type:'command',requestId:2,action:{kind:'input',x:1,z:0,aimX:1,aimZ:0}});
  hub.receive(resumed.id,{type:'command',requestId:2,action:{kind:'input',x:-1,z:0,aimX:1,aimZ:0}});assert.equal(resumed.last('ack').ok,false);
});
