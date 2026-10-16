import { BOARD, BOSSES, FAMILIES_INFO, GRID, RARITIES, armyStats, slotPosition, trackPosition, type DefenseState, type CombatEvent, type Enemy } from '../../../shared/defense.js';
import { playCombat } from '../../core/audio.js';
import { drawGuardian, mapArt, star } from './art.js';

export class ForestRenderer {
  selected: number | null = null;
  hoverSlot = -1;
  drag: { id: number; x: number; y: number } | null = null;
  aiming: { x: number; y: number } | null = null;
  state: DefenseState | null = null;
  private ctx: CanvasRenderingContext2D;
  private background = mapArt();
  private animation = 0;
  private lastFrame = performance.now();
  private receivedAt = performance.now();
  private boardId = '';
  private seenEvents = new Set<number>();
  private effects: { event: CombatEvent; born: number }[] = [];
  private positions = new Map<number, { x: number; y: number }>();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = BOARD.width; canvas.height = BOARD.height;
    this.ctx = canvas.getContext('2d')!;
    this.animation = requestAnimationFrame(this.frame);
  }
  update(state: DefenseState, boardId: string): void {
    if(this.boardId !== boardId) {
      this.boardId = boardId; this.effects = []; this.positions.clear(); this.seenEvents.clear();
    }
    this.state = state; this.receivedAt = performance.now();
    for (const event of state.events) if (!this.seenEvents.has(event.id)) {
      this.seenEvents.add(event.id);
      // Do not replay an entire reconnect backlog as simultaneous impacts.
      if(state.time - event.at < 0.55) { this.effects.push({ event, born: performance.now() + (event.type==='hit'?65:0) }); playCombat(event); }
    }
    if (this.seenEvents.size > 5000) this.seenEvents = new Set(state.events.map(e => e.id));
    const ids = new Set([...state.enemies, ...state.defenders].map(e => e.id));
    for (const id of this.positions.keys()) if (!ids.has(id)) this.positions.delete(id);
  }
  point(event: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * BOARD.width, y: (event.clientY - rect.top) / rect.height * BOARD.height };
  }
  slotAt(x: number, y: number): number {
    const col = Math.floor((x - GRID.x + 32) / GRID.step), row = Math.floor((y - GRID.y + 32) / GRID.step);
    return col >= 0 && col < GRID.cols && row >= 0 && row < GRID.rows ? row * GRID.cols + col : -1;
  }
  unitAt(x:number,y:number):number|null {
    const units=[...(this.state?.defenders??[])].sort((a,b)=>slotPosition(b.slot).y-slotPosition(a.slot).y);
    for(const unit of units){
      const p=this.positions.get(unit.id)??slotPosition(unit.slot);
      if(x>=p.x-25&&x<=p.x+25&&y>=p.y-68&&y<=p.y+14)return unit.id;
    }
    return null;
  }
  private smooth(id: number, point: {x:number;y:number}, dt: number): {x:number;y:number} {
    const old = this.positions.get(id) ?? point, alpha = 1-Math.exp(-dt*22);
    const value={x:old.x+(point.x-old.x)*alpha,y:old.y+(point.y-old.y)*alpha};
    this.positions.set(id,value); return value;
  }
  private frame = (now: number): void => {
    const dt=Math.max(0,Math.min((now-this.lastFrame)/1000,0.06));this.lastFrame=now;
    const ctx=this.ctx;ctx.imageSmoothingEnabled=false;
    ctx.clearRect(0,0,BOARD.width,BOARD.height);
    this.effects=this.effects.filter(e=>Math.max(0,now-e.born)<2100);
    ctx.save();
    const shake=this.reducedMotion?0:Math.min(4,this.effects.reduce((sum,e)=>{
      const age=Math.max(0,(now-e.born)/1000);
      return sum+(e.event.type==='burst'?6*Math.max(0,1-age/.38):e.event.type==='hit'&&e.event.critical?1.5*Math.max(0,1-age/.15):0);
    },0));
    ctx.translate(Math.sin(now*.13)*shake,Math.cos(now*.17)*shake*.65);
    ctx.drawImage(this.background,0,0);
    this.drawAtmosphere(now);
    if(this.state) {
      this.drawState(now,dt);
      for(const effect of this.effects)if(now>=effect.born)this.drawEffect(effect.event,(now-effect.born)/1000);
    }
    ctx.restore();
    this.animation=requestAnimationFrame(this.frame);
  };
  private drawAtmosphere(now:number):void {
    const ctx=this.ctx,t=now/1000,act=Math.min(2,Math.floor(Math.max(0,(this.state?.wave??1)-1)/4));
    if(act>0){ctx.fillStyle=act===1?'#6b3b7c0c':'#db826610';ctx.fillRect(0,0,BOARD.width,BOARD.height);}
    for(const x of [190,790])for(const y of [174,552]){
      const flicker=1+Math.sin(t*11+x)*.12+Math.sin(t*17+y)*.07;
      ctx.save();ctx.translate(x,y-19);
      ctx.fillStyle='#ffb76555';ctx.fillRect(-6*flicker,-8*flicker,12*flicker,17);
      ctx.fillStyle='#ffd69b';ctx.fillRect(-3,-9*flicker,6,10);ctx.fillStyle='#fff0bf';ctx.fillRect(-1,-6*flicker,2,8);
      const glow=ctx.createRadialGradient(0,0,0,0,0,58*flicker);glow.addColorStop(0,'#ffbb7a22');glow.addColorStop(1,'#ffbb7a00');ctx.fillStyle=glow;ctx.fillRect(-70,-70,140,140);ctx.restore();
    }
    for(let i=0;i<18;i++){
      const x=(i*137+t*(8+i%5))%984,y=(i*79-t*(12+i%4)+2000)%716;
      ctx.globalAlpha=.12+.22*(.5+.5*Math.sin(t+i));ctx.fillStyle=i%3?'#e4bb84':'#c5bdd9';ctx.fillRect(x,y,2,2);
    }
    ctx.globalAlpha=1;
    for(let i=0;i<3;i++){
      const x=(t*13+i*360)%1200-170,y=630+i*19;
      const fog=ctx.createRadialGradient(x,y,0,x,y,180);fog.addColorStop(0,'#c5c8d50a');fog.addColorStop(1,'#c5c8d500');
      ctx.fillStyle=fog;ctx.fillRect(x-180,y-100,360,180);
    }
  }
  private drawState(now:number,dt:number):void {
    const state=this.state!,ctx=this.ctx,time=now/1000;
    const player=state.players.find(p=>p.id===this.boardId);
    for(const hazard of state.hazards){
      const remaining=hazard.resolveAt-state.time,progress=Math.max(0,Math.min(1,1-remaining/2.2));
      ctx.save();ctx.translate(hazard.x,hazard.y);
      ctx.fillStyle='#ff614b'+(Math.sin(time*13)>0?'22':'11');ctx.strokeStyle='#fa8875';ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(0,0,hazard.radius,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.strokeStyle='#ffd6aa';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,hazard.radius+5,-Math.PI/2,-Math.PI/2+Math.PI*2*progress);ctx.stroke();
      ctx.fillStyle='#ffd8bc';ctx.font='bold 12px "Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.fillText('강타 '+Math.max(0,remaining).toFixed(1)+'s',0,3);ctx.restore();
    }
    const selected=state.defenders.find(d=>d.id===this.selected);
    if(selected) {
      const p=slotPosition(selected.slot),range=player?armyStats(selected,player,state.defenders).range:FAMILIES_INFO[selected.family].range;
      ctx.fillStyle='#adc5ed0c';ctx.strokeStyle='#d0d5a455';ctx.lineWidth=1.5;
      ctx.setLineDash([6,7]);ctx.beginPath();ctx.arc(p.x,p.y,range,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);
    }
    if(this.hoverSlot>=0){
      const p=slotPosition(this.hoverSlot);ctx.fillStyle='#ecd6a619';ctx.fillRect(p.x-30,p.y-30,60,60);
      ctx.strokeStyle='#d6c49f77';ctx.strokeRect(p.x-30,p.y-30,60,60);
    }
    const things:{y:number;draw:()=>void}[]=[];
    for(const enemy of state.enemies){
      const p=trackPosition(enemy.progress+(player?.status==='active'?Math.min(.08,Math.max(0,now-this.receivedAt)/1000)*enemy.speed*(enemy.slowUntil>state.time?.52:1):0));
      const smooth=this.smooth(enemy.id,p,dt);
      const hit=[...this.effects].reverse().find(e=>e.born<=now&&e.event.type==='hit'&&e.event.targetId===enemy.id);
      const age=hit?Math.max(0,(now-hit.born)/1000):9;
      things.push({y:smooth.y,draw:()=>this.drawEnemy(enemy,smooth.x,smooth.y,time,age,p.angle)});
    }
    for(const unit of state.defenders){
      if(this.drag?.id===unit.id)continue;
      const p=this.smooth(unit.id,slotPosition(unit.slot),dt);
      const shot=[...this.effects].reverse().find(e=>e.event.type==='shot'&&e.event.unitId===unit.id);
      const age=shot?Math.max(0,(now-shot.born)/1000):9;
      const attack=age<.36?Math.floor((1-age/.36)*5)/5:0, facing=shot?.event.tx!==undefined&&shot.event.tx<p.x?-1:1;
      things.push({y:p.y,draw:()=>{
        const color=RARITIES[unit.rank].color;
        if(unit.rank>=2){
          ctx.save();ctx.globalAlpha=.12;ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(p.x,p.y-8,26+unit.rank*3,44,0,0,Math.PI*2);ctx.fill();ctx.restore();
        }
        ctx.fillStyle='#060b1699';ctx.beginPath();ctx.ellipse(p.x,p.y+7,24,8,0,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=unit.id===this.selected?'#f8df9e':color+'77';ctx.lineWidth=unit.id===this.selected?2:1;
        ctx.beginPath();ctx.ellipse(p.x,p.y+7,24,8,0,0,Math.PI*2);ctx.stroke();
        drawGuardian(ctx,p.x,p.y,unit.family,unit.rank,1.8,time,attack,facing,unit.id);
        if(unit.stunnedUntil>state.time){
          for(let i=0;i<3;i++)star(ctx,p.x+Math.cos(time*5+i*2.1)*17,p.y-75+Math.sin(time*5+i*2.1)*5,3,'#ffe8a1');
        }
        if(unit.rank>=3){
          const pulse=.5+.5*Math.sin(time*4+unit.id);ctx.save();ctx.globalAlpha=.3+pulse*.25;
          star(ctx,p.x,p.y-84,unit.rank===4?7:4,color);ctx.restore();
        }
        if(unit.id===this.selected){
          ctx.font='bold 11px "Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.fillStyle='#141b2bef';
          ctx.fillRect(p.x-48,p.y-86,96,19);ctx.fillStyle=color;ctx.fillText(FAMILIES_INFO[unit.family].name,p.x,p.y-72);
        }
      }});
    }
    things.sort((a,b)=>a.y-b.y).forEach(t=>t.draw());
    if(this.drag){
      const unit=state.defenders.find(d=>d.id===this.drag!.id);
      if(unit){ctx.globalAlpha=.8;drawGuardian(ctx,this.drag.x,this.drag.y,unit.family,unit.rank,1.8,time,0,1,unit.id);ctx.globalAlpha=1;}
    }
    if(this.aiming){
      ctx.fillStyle='#ffbe7322';ctx.strokeStyle='#ffca82';ctx.lineWidth=2;ctx.setLineDash([9,6]);ctx.beginPath();
      ctx.arc(this.aiming.x,this.aiming.y,165,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.moveTo(this.aiming.x-16,this.aiming.y);ctx.lineTo(this.aiming.x+16,this.aiming.y);
      ctx.moveTo(this.aiming.x,this.aiming.y-16);ctx.lineTo(this.aiming.x,this.aiming.y+16);ctx.stroke();
    }
    if(state.phase==='preparing'){
      ctx.fillStyle='#101828e6';ctx.fillRect(322,552,340,35);ctx.fillStyle='#e8d2a2';ctx.textAlign='center';ctx.font='bold 14px "Malgun Gothic",sans-serif';
      ctx.fillText('첫 습격까지 '+Math.max(1,Math.ceil(state.waveEndsAt-state.time))+'초 · 용병을 고용하세요',492,575);
    }
  }
  private drawEnemy(enemy:Enemy,x:number,y:number,time:number,hitAge:number,angle:number):void {
    const ctx=this.ctx,boss=enemy.kind==='boss',scale=boss?enemy.bossType==='reaper'?2.8:2.55:enemy.kind==='brute'?1.8:enemy.kind==='runner'?1.12:1.4;
    ctx.save();ctx.translate(Math.round(x),Math.round(y));
    ctx.fillStyle='#060b1699';ctx.beginPath();ctx.ellipse(0,5,15*scale,5*scale,0,0,Math.PI*2);ctx.fill();
    ctx.scale(angle>Math.PI/2||angle<0?-scale:scale,scale);
    const recoil=hitAge<.16?Math.sin(hitAge/.16*Math.PI)*3:0;
    ctx.translate(-recoil,0);
    if(hitAge<.06)ctx.filter='brightness(2.6)';
    if(enemy.kind==='wraith'){ctx.globalAlpha=.8;ctx.translate(0,Math.sin(time*4+enemy.id)*2);}
    const rect=(c:string,a:number,b:number,w:number,h:number)=>{ctx.fillStyle=c;ctx.fillRect(a,b,w,h);};
    const walk=Math.sin(time*10+enemy.id)>0?2:-1;
    rect('#131826',-8,-4,7,7+walk);rect('#131826',3,-4,7,8-walk);
    rect('#424053',-7,-4,5,5+walk);rect('#51475b',4,-4,5,5-walk);
    rect('#191a2c',-10,-23,21,21);rect(enemy.kind==='brute'?'#74818b':enemy.kind==='wraith'?'#665480':boss&&enemy.bossType==='reaper'?'#3b354d':'#604859',-8,-22,17,18);
    rect('#b17a70',-8,-22,4,7);rect('#302d44',-7,-7,16,3);
    rect('#161c2b',-7,-35,15,14);rect('#706378',-6,-34,13,11);
    rect('#a18a91',-5,-34,10,3);rect('#292439',-6,-27,14,5);
    rect('#ffbd7f',-2,-28,3,2);rect('#ffbd7f',5,-28,3,2);
    rect('#292333',-13,-22,6,12);rect('#8d6b72',-12,-22,4,7);
    rect('#483448',8,-22,7,13);rect('#bc9380',10,-11,5,3);
    if(enemy.kind==='brute'){
      rect('#a4acb1',-12,-25,8,6);rect('#b8b6b1',7,-25,9,6);rect('#d2ba90',-4,-18,11,2);
      rect('#4d5667',-2,-22,3,17);
    }
    if(enemy.kind==='runner'){rect('#c7a58b',-9,-32,19,3);rect('#9c5b62',-13,-29,6,12);}
    if(enemy.kind==='wraith'){rect('#8c6c9f',-9,-36,18,7);rect('#b595c9',-6,-39,12,4);rect('#493b68',-13,-15,4,14);}
    if(boss){
      rect('#322b40',-17,-25,12,7);rect('#a78072',-17,-25,11,3);
      rect('#322b40',7,-25,12,7);rect('#a78072',8,-25,11,3);
      rect('#c6aa84',-7,-37,2,7);rect('#c6aa84',5,-37,2,7);
      rect('#2b2438',14,-30,4,34);rect('#c1a68b',10,-30,15,8);rect('#7a6c72',18,-34,9,14);
      rect('#c2a47a',-3,-20,6,3);rect('#cf7970',-1,-16,2,7);
      if(enemy.bossType==='witch'){
        rect('#302641',-12,-42,24,8);rect('#9a6db0',-8,-47,17,7);rect('#dcb4d9',-3,-49,7,5);
        rect('#6d4c8e',-10,-21,22,24);rect('#c698d6',-7,-20,3,20);rect('#c698d6',8,-20,2,20);
        star(ctx,20,-33,7+Math.sin(time*4)*2,'#efccff');
      }
      if(enemy.bossType==='reaper'){
        rect('#1e2336',-10,-40,21,11);rect('#cab8b1',-6,-32,14,5);rect('#f1a0a6',-3,-29,3,2);rect('#f1a0a6',5,-29,3,2);
        rect('#322c43',-15,-23,30,24);rect('#8f6177',-13,-22,4,19);rect('#8f6177',11,-22,3,21);
        rect('#e8d4c8',15,-40,17,3);rect('#d1b5b3',25,-38,7,4);rect('#a88c9a',30,-35,3,7);
      }
    }else{
      rect('#b0a0a1',14,-27,3,18);rect('#e1cfc0',15,-28,1,17);rect('#8a6b5d',12,-11,7,2);
    }
    if(enemy.slowUntil>this.state!.time){ctx.globalAlpha=.65;rect('#9cdff4',-11,-1,25,3);ctx.globalAlpha=1;}
    if((enemy.burnUntil??0)>this.state!.time){star(ctx,0,-12,7+Math.sin(time*12)*2,'#ffb16c');}
    ctx.restore();
    if((enemy.shatteredUntil??0)>this.state!.time){
      ctx.fillStyle='#eed19a';ctx.fillRect(x-7,y-60,5,4);ctx.fillRect(x+2,y-57,5,4);
    }
    const width=boss?82:34,barY=y-(boss?112:57);
    if(enemy.hp<enemy.maxHp||boss){
      ctx.fillStyle='#090f1be8';ctx.fillRect(x-width/2-2,barY-2,width+4,boss?9:6);
      ctx.fillStyle=boss?'#ed8679':'#bda59e';ctx.fillRect(x-width/2,barY,width*enemy.hp/enemy.maxHp,boss?5:3);
    }
  }
  private drawEffect(event:CombatEvent,age:number):void {
    const ctx=this.ctx;ctx.save();
    const color=event.family?FAMILIES_INFO[event.family].color:'#ffd598';
    if(event.type==='shot'&&event.tx!==undefined&&event.ty!==undefined){
      const sx=event.x,sy=event.y-25,tx=event.tx,ty=event.ty-20;
      const a=Math.atan2(ty-sy,tx-sx),duration=event.family==='ember'?.18:.08,t=Math.min(1,age/duration);
      if(age<duration){
        const x=sx+(tx-sx)*t,y=sy+(ty-sy)*t;
        ctx.strokeStyle=color;ctx.lineWidth=event.family==='ranger'||event.family==='shade'?3:5;ctx.beginPath();ctx.moveTo(x-Math.cos(a)*35,y-Math.sin(a)*35);ctx.lineTo(x,y);ctx.stroke();
        ctx.fillStyle='#fff5da';ctx.fillRect(x-3,y-3,6,6);
        if(event.family==='ember'){star(ctx,x,y,10,color);}
      }
      if(event.family==='volt'&&age<.22){
        ctx.strokeStyle=color;ctx.lineWidth=age<.08?6:3;ctx.beginPath();ctx.moveTo(sx,sy);
        for(let i=1;i<=7;i++){const t=i/7,j=i===7?0:Math.sin(i*9+event.id)*16;ctx.lineTo(sx+(tx-sx)*t+j,sy+(ty-sy)*t-j);}ctx.stroke();
        ctx.strokeStyle='#f4edff';ctx.lineWidth=1.5;ctx.stroke();
      }
      if(event.family==='frost'&&age<.28){
        ctx.translate(tx,ty);ctx.rotate(a);ctx.globalAlpha=1-age/.28;
        ctx.strokeStyle='#ecfcff';ctx.lineWidth=7;ctx.beginPath();ctx.arc(-16,0,35,-1.2,1.2);ctx.stroke();
        ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(-22,0,44,-1.2,1.2);ctx.stroke();
      }
      if(event.family==='sentinel'&&age<.4){
        ctx.globalAlpha=1-age/.4;ctx.strokeStyle='#d1debb';ctx.lineWidth=5;ctx.beginPath();ctx.ellipse(tx,ty+18,12+age*180,5+age*80,0,0,Math.PI*2);ctx.stroke();
        for(let i=0;i<7;i++){ctx.fillStyle='#c8d6b0';ctx.fillRect(tx+Math.sin(i*4)*age*140,ty+Math.cos(i*3)*age*70,8,3);}
      }
      if(event.family==='shade'&&age<.15){
        ctx.save();ctx.translate(sx+(tx-sx)*t,sy+(ty-sy)*t);ctx.rotate(a);ctx.fillStyle='#fff0df';ctx.fillRect(-10,-2,22,3);ctx.fillStyle=color;ctx.fillRect(-8,2,10,2);ctx.restore();
      }
      if((event.rank??0)>=3&&age<.2){ctx.globalAlpha=1-age/.2;ctx.strokeStyle=RARITIES[event.rank!].color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(tx,ty);ctx.stroke();}
      if(event.family==='ranger'&&age<.09){
        star(ctx,sx+Math.cos(a)*28,sy+Math.sin(a)*28,15,'#fff0b1');
      }
    }else if(event.type==='hit'&&age<.7){
      const x=event.x,y=event.y-20,big=event.family==='ember'||event.family==='sentinel',radius=big?30:15;
      if(age<.22){
        ctx.globalAlpha=1-age/.22;
        star(ctx,x,y,(event.critical?32:radius)*(1+age*3),'#fff1c3');
        ctx.strokeStyle=color;ctx.lineWidth=big?5:2;ctx.beginPath();ctx.arc(x,y,8+age*(big?260:150),0,Math.PI*2);ctx.stroke();
        for(let i=0;i<(big?12:6);i++){
          const a=i*2.4+event.id,r=age*(big?230:160),size=Math.max(1,5-age*13);
          ctx.fillStyle=i%2?color:'#ffecc8';ctx.fillRect(x+Math.cos(a)*r,y+Math.sin(a)*r,size*1.8,size);
        }
      }
      const hits=this.effects.filter(e=>e.event.type==='hit'&&e.event.targetId===event.targetId);
      const latest=hits.at(-1)?.event.id===event.id;
      if(event.amount&&latest){
        // One readable number per target. Hits arriving together are shown as their real sum.
        const recent=hits.filter(e=>event.at-e.event.at>=0&&event.at-e.event.at<.12);
        const amount=recent.reduce((total,e)=>total+(e.event.amount??0),0);
        const critical=recent.some(e=>e.event.critical),id=event.targetId??event.id;
        const nx=x+(id%3-1)*14,dy=y-24-(id%4)*12-age*32;
        ctx.globalAlpha=Math.min(1,(.7-age)*3);ctx.textAlign='center';
        ctx.font=(critical?'900 18px':'bold 13px')+' monospace';
        const label=(critical?'✦ ':'')+amount;
        ctx.strokeStyle='#101322';ctx.lineWidth=4;ctx.strokeText(label,nx,dy);
        ctx.fillStyle=critical?'#ffce7f':'#f1eee0';ctx.fillText(label,nx,dy);
      }
    }else if(event.type==='stun'&&age<.7){
      ctx.globalAlpha=1-age/.7;ctx.strokeStyle='#ee9b77';ctx.lineWidth=6;ctx.beginPath();ctx.ellipse(event.x,event.y,12+age*150,5+age*70,0,0,Math.PI*2);ctx.stroke();
      for(let i=0;i<14;i++){ctx.fillStyle=i%2?'#c9ac9a':'#6c6a7a';ctx.fillRect(event.x+Math.sin(i*2.4)*age*160,event.y+Math.cos(i*2.4)*age*90,7,4);}
    }else if((event.type==='relic'||event.type==='bosskill')&&age<2){
      ctx.globalAlpha=Math.min(1,age*6,(2-age)*2);ctx.fillStyle='#101b2aee';ctx.fillRect(292,298,400,90);
      ctx.strokeStyle='#d5b980';ctx.lineWidth=1;ctx.strokeRect(296,302,392,82);
      ctx.textAlign='center';ctx.font='bold 13px "Malgun Gothic",sans-serif';ctx.fillStyle='#aeb6c6';ctx.fillText(event.type==='relic'?'유물 획득':'BOUNTY COMPLETE',492,329);
      ctx.font='bold 21px "Malgun Gothic",sans-serif';ctx.fillStyle='#efcf96';ctx.fillText(event.text??'',492,365);
    }else if(event.type==='kill'&&age<.6){
      ctx.globalAlpha=1-age/.6;
      for(let i=0;i<9;i++){const a=i*2.399+event.id,r=age*90;ctx.fillStyle=i%3?'#b88272':'#ffcb87';ctx.fillRect(event.x+Math.cos(a)*r,event.y-15+Math.sin(a)*r+age*25,5-age*5,4);}
    }else if(event.type==='summon'&&age<1.8){
      const rank=event.rank??0,c=RARITIES[rank].color,fade=Math.max(0,1-age/1.8);
      ctx.globalAlpha=fade;ctx.strokeStyle=c;ctx.lineWidth=rank>=2?3:1.5;
      ctx.beginPath();ctx.ellipse(event.x,event.y+5,20+age*20,8+age*9,0,0,Math.PI*2);ctx.stroke();
      if(age<.6){
        ctx.fillStyle=c+'55';ctx.fillRect(event.x-15,event.y-110,30,115);
        for(let i=0;i<10+rank*4;i++){const a=i*2.4,r=12+age*55;star(ctx,event.x+Math.cos(a)*r,event.y-25+Math.sin(a)*r-age*35,rank>=2?4:2,c);}
      }
      if(rank>=1){
        ctx.fillStyle='#101724f0';ctx.fillRect(event.x-91,event.y-108,182,27);ctx.fillStyle=c;ctx.font='bold 13px "Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.fillText(event.text??'',event.x,event.y-90);
      }
    }else if(event.type==='burst'&&age<1.1){
      ctx.globalAlpha=Math.max(0,1-age/1.1);
      if(age<.25){
        ctx.strokeStyle='#ffe3b9';ctx.lineWidth=15;ctx.beginPath();ctx.moveTo(event.x-80,event.y-420);ctx.lineTo(event.x,event.y);ctx.stroke();
      }
      const r=Math.min(165,age*650);ctx.fillStyle='#ff9b4a44';ctx.beginPath();ctx.arc(event.x,event.y,r,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#ffdfad';ctx.lineWidth=8*(1-age/1.1);ctx.stroke();
      for(let i=0;i<32;i++){
        const a=i*2.4,r=age*(100+(i%5)*42),x=event.x+Math.cos(a)*r,y=event.y+Math.sin(a)*r*.6;
        ctx.fillStyle=i%3?'#ffad61':'#fff0bd';ctx.fillRect(x,y,7*(1-age/1.1),4);
      }
      if(age<.12){ctx.fillStyle='#ffe2ad22';ctx.fillRect(0,0,BOARD.width,BOARD.height);}
    }else if(event.type==='wave'&&age<1.7){
      ctx.globalAlpha=Math.min(1,age*5,(1.7-age)*3);ctx.fillStyle='#101827e8';ctx.fillRect(305,328,374,53);
      ctx.fillStyle='#ead8b0';ctx.font='bold 23px "Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.fillText(event.text??'',492,363);
    }else if(event.type==='upgrade'&&age<1.2){
      ctx.globalAlpha=1-age/1.2;ctx.font='bold 20px "Malgun Gothic",sans-serif';ctx.fillStyle='#e7d3a4';ctx.textAlign='center';ctx.fillText(event.text??'',492,175-age*25);
    }
    ctx.restore();
  }
  destroy():void {cancelAnimationFrame(this.animation);}
}
