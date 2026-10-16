import type { CombatEvent } from '../../shared/defense.js';

let audio: AudioContext | null = null;
let enabled = false;
let last = 0;
export function setSoundEnabled(value: boolean): void {
  enabled = value;
  if(value) { audio ??= new AudioContext(); void audio.resume(); }
}
function pulse(frequency:number,end:number,duration:number,volume:number,type:OscillatorType='triangle'):void{
  if(!enabled||!audio||audio.state!=='running')return;
  const ctx=audio,now=ctx.currentTime,osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type=type;osc.frequency.setValueAtTime(frequency,now);osc.frequency.exponentialRampToValueAtTime(end,now+duration);
  gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.001,now+duration);
  osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(now+duration);
  osc.onended=()=>{osc.disconnect();gain.disconnect();};
}
export function playUiSound():void{pulse(180,80,.12,.025);}
export function playCombat(event:CombatEvent):void{
  if(!enabled||!audio)return;
  if(event.type==='summon'&&(event.rank??0)>=1){pulse(330,1320,.45,.045);return;}
  if(event.type==='burst'){pulse(90,24,.6,.12,'sawtooth');return;}
  if(event.type!=='shot'||performance.now()-last<65)return;
  last=performance.now();
  if(event.family==='ranger')pulse(140,45,.08,.04,'square');
  if(event.family==='ember')pulse(150,35,.22,.055,'sawtooth');
  if(event.family==='frost')pulse(800,300,.15,.025);
  if(event.family==='volt')pulse(360,65,.14,.035,'sawtooth');
}
