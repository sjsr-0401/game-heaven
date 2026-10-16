import { BOARD, FAMILIES_INFO, GRID, RARITIES, slotPosition, trackPosition, type DefenseState, type CombatEvent, type Enemy } from '../../../shared/defense.js';
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
      if(state.time - event.at < 0.55) { this.effects.push({ event, born: performance.now() }); playCombat(event); }
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
    if(this.state) {
      this.drawState(now,dt);
      for(const effect of this.effects)this.drawEffect(effect.event,Math.max(0,(now-effect.born)/1000));
    }
    ctx.restore();
    this.animation=requestAnimationFrame(this.frame);
  };
  private drawState(now:number,dt:number):void {
    const state=this.state!,ctx=this.ctx,time=now/1000;
    const selected=state.defenders.find(d=>d.id===this.selected);
    if(selected) {
      const p=slotPosition(selected.slot),range=FAMILIES_INFO[selected.family].range;
      ctx.fillStyle='#adc5ed0c';ctx.strokeStyle='#d0d5a455';ctx.lineWidth=1.5;
      ctx.setLineDash([6,7]);ctx.beginPath();ctx.arc(p.x,p.y,range,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);
    }
    if(this.hoverSlot>=0){
      const p=slotPosition(this.hoverSlot);ctx.fillStyle='#ecd6a619';ctx.fillRect(p.x-30,p.y-30,60,60);
      ctx.strokeStyle='#d6c49f77';ctx.strokeRect(p.x-30,p.y-30,60,60);
    }
    const things:{y:number;draw:()=>void}[]=[];
    for(const enemy of state.enemies){
      const p=trackPosition(enemy.progress+Math.min(.08,Math.max(0,now-this.receivedAt)/1000)*enemy.speed*(enemy.slowUntil>state.time?.55:1));
      const smooth=this.smooth(enemy.id,p,dt);
      const hit=[...this.effects].reverse().find(e=>e.event.type==='hit'&&e.event.targetId===enemy.id);
      const age=hit?Math.max(0,(now-hit.born)/1000):9;
      things.push({y:smooth.y,draw:()=>this.drawEnemy(enemy,smooth.x,smooth.y,time,age,p.angle)});
    }
    for(const unit of state.defenders){
      if(this.drag?.id===unit.id)continue;
      const p=this.smooth(unit.id,slotPosition(unit.slot),dt);
      const shot=[...this.effects].reverse().find(e=>e.event.type==='shot'&&e.event.unitId===unit.id);
      const age=shot?Math.max(0,(now-shot.born)/1000):9;
      const attack=age<.3?1-age/.3:0, facing=shot?.event.tx!==undefined&&shot.event.tx<p.x?-1:1;
      things.push({y:p.y,draw:()=>{
        const color=RARITIES[unit.rank].color;
        if(unit.rank>=2){
          ctx.save();ctx.globalAlpha=.12;ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(p.x,p.y-8,26+unit.rank*3,44,0,0,Math.PI*2);ctx.fill();ctx.restore();
        }
        ctx.fillStyle='#060b1699';ctx.beginPath();ctx.ellipse(p.x,p.y+7,24,8,0,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=unit.id===this.selected?'#f8df9e':color+'77';ctx.lineWidth=unit.id===this.selected?2:1;
        ctx.beginPath();ctx.ellipse(p.x,p.y+7,24,8,0,0,Math.PI*2);ctx.stroke();
        drawGuardian(ctx,p.x,p.y,unit.family,unit.rank,1.75,time,attack,facing);
        if(unit.id===this.selected){
          ctx.font='bold 11px "Malgun Gothic",sans-serif';ctx.textAlign='center';ctx.fillStyle='#141b2bef';
          ctx.fillRect(p.x-48,p.y-86,96,19);ctx.fillStyle=color;ctx.fillText(FAMILIES_INFO[unit.family].name,p.x,p.y-72);
        }
      }});
    }
    things.sort((a,b)=>a.y-b.y).forEach(t=>t.draw());
    if(this.drag){
      const unit=state.defenders.find(d=>d.id===this.drag!.id);
      if(unit){ctx.globalAlpha=.8;drawGuardian(ctx,this.drag.x,this.drag.y,unit.family,unit.rank,1.75,time);ctx.globalAlpha=1;}
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
    const ctx=this.ctx,boss=enemy.kind==='boss',scale=boss?2.6:enemy.kind==='brute'?1.65:1.4;
    ctx.save();ctx.translate(Math.round(x),Math.round(y));
    ctx.fillStyle='#060b1699';ctx.beginPath();ctx.ellipse(0,5,15*scale,5*scale,0,0,Math.PI*2);ctx.fill();
    ctx.scale(angle>Math.PI/2||angle<0?-scale:scale,scale);
    const recoil=hitAge<.16?Math.sin(hitAge/.16*Math.PI)*3:0;
    ctx.translate(-recoil,0);
    if(hitAge<.075)ctx.filter='brightness(3.2)';
    const rect=(c:string,a:number,b:number,w:number,h:number)=>{ctx.fillStyle=c;ctx.fillRect(a,b,w,h);};
    const walk=Math.sin(time*10+enemy.id)>0?2:-1;
    rect('#131826',-8,-4,7,7+walk);rect('#131826',3,-4,7,8-walk);
    rect('#424053',-7,-4,5,5+walk);rect('#51475b',4,-4,5,5-walk);
    rect('#191a2c',-10,-23,21,21);rect(boss?'#6c5260':'#604859',-8,-22,17,18);
    rect('#b17a70',-8,-22,4,7);rect('#302d44',-7,-7,16,3);
    rect('#161c2b',-7,-35,15,14);rect('#706378',-6,-34,13,11);
    rect('#a18a91',-5,-34,10,3);rect('#292439',-6,-27,14,5);
    rect('#ffbd7f',-2,-28,3,2);rect('#ffbd7f',5,-28,3,2);
    rect('#292333',-13,-22,6,12);rect('#8d6b72',-12,-22,4,7);
    rect('#483448',8,-22,7,13);rect('#bc9380',10,-11,5,3);
    if(boss){
      rect('#322b40',-17,-25,12,7);rect('#a78072',-17,-25,11,3);
      rect('#322b40',7,-25,12,7);rect('#a78072',8,-25,11,3);
      rect('#c6aa84',-7,-37,2,7);rect('#c6aa84',5,-37,2,7);
      rect('#2b2438',14,-30,4,34);rect('#c1a68b',10,-30,15,8);rect('#7a6c72',18,-34,9,14);
      rect('#c2a47a',-3,-20,6,3);rect('#cf7970',-1,-16,2,7);
    }else{
      rect('#b0a0a1',14,-27,3,18);rect('#e1cfc0',15,-28,1,17);rect('#8a6b5d',12,-11,7,2);
    }
    if(enemy.slowUntil>this.state!.time){ctx.globalAlpha=.65;rect('#9cdff4',-11,-1,25,3);ctx.globalAlpha=1;}
    ctx.restore();
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
        ctx.strokeStyle=color;ctx.lineWidth=event.family==='ranger'?3:5;ctx.beginPath();ctx.moveTo(x-Math.cos(a)*35,y-Math.sin(a)*35);ctx.lineTo(x,y);ctx.stroke();
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
      if(event.family==='ranger'&&age<.09){
        star(ctx,sx+Math.cos(a)*28,sy+Math.sin(a)*28,15,'#fff0b1');
      }
    }else if(event.type==='hit'&&age<.7){
      const x=event.x,y=event.y-20,big=event.family==='ember',radius=big?30:15;
      if(age<.22){
        ctx.globalAlpha=1-age/.22;
        star(ctx,x,y,(event.critical?32:radius)*(1+age*3),'#fff1c3');
        ctx.strokeStyle=color;ctx.lineWidth=big?5:2;ctx.beginPath();ctx.arc(x,y,8+age*(big?260:150),0,Math.PI*2);ctx.stroke();
        for(let i=0;i<(big?12:6);i++){
          const a=i*2.4+event.id,r=age*(big?230:160),size=Math.max(1,5-age*13);
          ctx.fillStyle=i%2?color:'#ffecc8';ctx.fillRect(x+Math.cos(a)*r,y+Math.sin(a)*r,size*1.8,size);
        }
      }
      if(event.amount){
        ctx.globalAlpha=Math.min(1,(.7-age)*3);ctx.textAlign='center';
        ctx.font=(event.critical?'900 22px':'bold 14px')+' monospace';
        const label=(event.critical?'CRIT ':'')+event.amount,dy=y-18-age*38;
        ctx.strokeStyle='#101322';ctx.lineWidth=4;ctx.strokeText(label,x,dy);
        ctx.fillStyle=event.critical?'#ffce7f':'#f1eee0';ctx.fillText(label,x,dy);
      }
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
