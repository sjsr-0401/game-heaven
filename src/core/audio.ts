import {VIEW_RIGHT,onDeck,type EscapeEvent,type EscapeState} from '../../shared/escape.js';
import type { CombatEvent } from '../../shared/defense.js';

let audio:AudioContext|null=null,master:GainNode|null=null,noise:AudioBuffer|null=null;
let enabled=false,last=0;
let recorder:MediaRecorder|null=null,recordedAt=0;
const chunks:Blob[]=[];
const soundFiles={
 hook0:'kenney-impact/Audio/impactMetal_light_000.ogg',hook1:'kenney-impact/Audio/impactMetal_light_001.ogg',
 hit0:'kenney-impact/Audio/impactMetal_medium_000.ogg',hit1:'kenney-impact/Audio/impactMetal_medium_001.ogg',
 armor:'kenney-impact/Audio/impactMetal_heavy_000.ogg',house0:'kenney-impact/Audio/impactWood_heavy_000.ogg',house1:'kenney-impact/Audio/impactWood_heavy_001.ogg',
 hurt:'kenney-impact/Audio/impactPunch_heavy_000.ogg',plank0:'kenney-impact/Audio/impactPlank_medium_000.ogg',plank1:'kenney-impact/Audio/impactPlank_medium_001.ogg',
 pickup:'kenney-impact/Audio/impactGeneric_light_000.ogg',tin:'kenney-impact/Audio/impactTin_medium_000.ogg',
 concrete0:'kenney-impact/Audio/footstep_concrete_000.ogg',concrete1:'kenney-impact/Audio/footstep_concrete_001.ogg',
 wood0:'kenney-impact/Audio/footstep_wood_000.ogg',wood1:'kenney-impact/Audio/footstep_wood_001.ogg',
 click:'kenney-interface/Audio/click_003.ogg',select:'kenney-interface/Audio/select_001.ogg',confirm:'kenney-interface/Audio/confirmation_001.ogg',close:'kenney-interface/Audio/close_001.ogg'
};
type Sample=keyof typeof soundFiles;
const sounds=new Map<Sample,AudioBuffer>(),steps=new Map<string,number>();let soundsLoading:Promise<void>|null=null,voices=0,audioPlayer='',listener={x:0,z:0};
function loadSoundKit(context:AudioContext):void{
 if(soundsLoading)return;
 soundsLoading=Promise.all((Object.entries(soundFiles) as [Sample,string][]).map(async([name,path])=>{
  const response=await fetch('/art/'+path);if(!response.ok)throw Error('Missing game sound '+path);sounds.set(name,await context.decodeAudioData(await response.arrayBuffer()));
 })).then(()=>{}).catch(error=>console.error(String(error)));
}
export function gameAudioStatus():{loaded:number;total:number}{return{loaded:sounds.size,total:Object.keys(soundFiles).length};}
export function setGameAudioPlayer(id:string):void{audioPlayer=id;steps.clear();}
function sample(name:Sample,volume=.3,rate=1,pan=0):boolean{
 if(!enabled||!audio||!master||audio.state!=='running')return false;
 const buffer=sounds.get(name);if(!buffer)return false;if(voices>=18)return true;
 const ctx=audio,source=ctx.createBufferSource(),gain=ctx.createGain(),position=ctx.createStereoPanner();
 source.buffer=buffer;source.playbackRate.value=rate;gain.gain.value=volume;position.pan.value=Math.max(-.8,Math.min(.8,pan));
 source.connect(gain);gain.connect(position);position.connect(master);voices++;source.start();
 source.onended=()=>{voices--;source.disconnect();gain.disconnect();position.disconnect();};return true;
}
export function setSoundEnabled(value:boolean):void{
  enabled=value;
  if(!value){if(master&&audio)master.gain.setTargetAtTime(0,audio.currentTime,.025);return;}
  if(!audio){
    audio=new AudioContext();loadSoundKit(audio);master=audio.createGain();master.gain.value=.6;const limiter=audio.createDynamicsCompressor();limiter.threshold.value=-10;limiter.knee.value=8;limiter.ratio.value=6;limiter.attack.value=.004;limiter.release.value=.16;master.connect(limiter);limiter.connect(audio.destination);
    noise=audio.createBuffer(1,Math.ceil(audio.sampleRate*.7),audio.sampleRate);
    const data=noise.getChannelData(0);let seed=19723;
    for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;data[i]=(seed>>>0)/2147483648-1;}
    // Only this game's mixed audio bus is captured; no microphone or other app audio is requested.
    if(new URLSearchParams(location.search).get('record')==='1'&&typeof MediaRecorder!=='undefined'){
      const destination=audio.createMediaStreamDestination();limiter.connect(destination);
      const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/webm';
      recorder=new MediaRecorder(destination.stream,{mimeType:mime});
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recordedAt=Date.now();recorder.start(1000);
    }
  }
  void audio.resume();master!.gain.setTargetAtTime(.6,audio.currentTime,.025);
}
function pulse(frequency:number,end:number,duration:number,volume:number,type:OscillatorType='triangle',delay=0):void{
  if(!enabled||!audio||!master||audio.state!=='running')return;
  const ctx=audio,now=ctx.currentTime+delay,osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type=type;osc.frequency.setValueAtTime(frequency,now);osc.frequency.exponentialRampToValueAtTime(Math.max(15,end),now+duration);
  gain.gain.setValueAtTime(.001,now);gain.gain.exponentialRampToValueAtTime(volume,now+.005);gain.gain.exponentialRampToValueAtTime(.001,now+duration);
  osc.connect(gain);gain.connect(master);osc.start(now);osc.stop(now+duration+.01);
  osc.onended=()=>{osc.disconnect();gain.disconnect();};
}
function impact(duration:number,volume:number,frequency:number,type:BiquadFilterType='lowpass'):void{
  if(!enabled||!audio||!master||!noise||audio.state!=='running')return;
  const ctx=audio,source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain(),now=ctx.currentTime;
  source.buffer=noise;filter.type=type;filter.frequency.value=frequency;filter.Q.value=.6;
  gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.001,now+duration);
  source.connect(filter);filter.connect(gain);gain.connect(master);source.start(now);source.stop(now+duration);
  source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
}
function chime(rank:number):void{
  const root=rank>=3?440:330;
  for(let i=0;i<Math.min(4,rank+1);i++)pulse(root*[1,1.25,1.5,2][i],root*[1,1.25,1.5,2][i],.3+i*.07,.045,'sine',i*.07);
}
export function playUiSound():void{if(!sample('click',.18))pulse(170,90,.12,.03);}
export function playCombat(event:CombatEvent):void{
  if(!enabled||!audio)return;
  if(event.type==='summon'){chime(event.rank??0);return;}
  if(event.type==='relic'||event.type==='bosskill'){chime(3);return;}
  if(event.type==='hazard'){pulse(130,95,.2,.035,'sine');return;}
  if(event.type==='burst'){impact(.65,.24,850);pulse(80,24,.6,.17,'sine');return;}
  if(event.type==='stun'){impact(.25,.14,600);pulse(70,28,.2,.08,'sine');return;}
  if(event.type!=='shot'||performance.now()-last<65)return;last=performance.now();
  if(event.family==='ranger'){impact(.09,.16,1900);pulse(160,50,.09,.06,'triangle');}
  if(event.family==='ember'){impact(.3,.15,950);pulse(110,35,.25,.08,'sine');}
  if(event.family==='frost'){impact(.12,.065,3200,'highpass');pulse(900,400,.13,.025,'sine');}
  if(event.family==='volt'){impact(.13,.1,2600,'bandpass');pulse(310,90,.12,.02,'sawtooth');}
  if(event.family==='sentinel'){impact(.2,.15,900);pulse(100,35,.18,.07,'triangle');}
  if(event.family==='shade'){impact(.08,.045,4900,'highpass');}
}
export async function finishAudioRecording():Promise<{base64:string;startedAt:number}|null>{
  if(!recorder||recorder.state==='inactive')return null;
  const capture=recorder;
  await new Promise<void>(resolve=>{capture.addEventListener('stop',()=>resolve(),{once:true});capture.stop();});
  const blob=new Blob(chunks,{type:capture.mimeType});
  const url=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  return{base64:url.slice(url.indexOf(',')+1),startedAt:recordedAt};
}

let lastBeat=-1,escapeHitAt=0;
export function playEscapeEvent(e:EscapeEvent):void {
 if(!enabled||!audio)return;
 const pan=((e.x-listener.x)*VIEW_RIGHT.x+(e.z-listener.z)*VIEW_RIGHT.z)/15,range=Math.hypot(e.x-listener.x,e.z-listener.z),gain=1/(1+range*.025),rate=.96+(e.id%5)*.02;
 if(e.type==='hook'){if(!sample(e.id%2?'hook0':'hook1',.13*gain,rate,pan))impact(.1,.06,2600,'bandpass');impact(.07,.025,2100,'highpass');if(e.prop)sample('pickup',.18*gain,1.02,pan);}
 if(e.type==='throw'){sample('plank0',.1*gain,.9,pan);impact(.14,.035,1500,'bandpass');}
 if(e.type==='hit'&&performance.now()-escapeHitAt>55){
  escapeHitAt=performance.now();const kind:Sample=e.text==='crew'?'hurt':e.text==='house'?e.id%2?'house0':'house1':e.text==='장갑'?'armor':e.text==='gate'?e.id%2?'plank0':'plank1':e.id%2?'hit0':'hit1';
  if(!sample(kind,(e.text==='crew'?.28:.24)*gain,rate,pan))impact(.12,.12,1100);
  if(e.text==='crew'||e.text==='house')pulse(72,32,.12,.025,'sine');
 }
 if(e.type==='explode'){sample(e.prop==='battery'?'tin':'armor',.3*gain,.8,pan);impact(.42,.2,e.prop==='battery'?1900:750);pulse(80,24,.4,.1,'sine');}
 if(e.type==='kill'){sample('tin',.17*gain,.86,pan);}
 if(e.type==='install'){sample(e.prop==='scrap'?'plank1':'select',.22*gain,rate,pan);}
 if(e.type==='repair'||e.type==='rescue'){sample(e.type==='rescue'&&!e.by?'select':'confirm',.2*gain,1,pan);if(e.by||e.type==='repair')pulse(330,440,.17,.012,'sine',.12);}
 if(e.type==='warning'){pulse(180,150,.2,.025,'triangle');pulse(180,150,.2,.022,'triangle',.28);}
 if(e.type==='camp'||e.type==='upgrade'){sample('confirm',.19);}
 if(e.type==='boss'){sample('armor',.28,.7,pan);impact(.6,.09,600);pulse(65,34,.65,.05,'sine');}
 if(e.type==='win'){sample('confirm',.24);[262,330,392,523].forEach((n,i)=>pulse(n,n,.7,.018,'sine',i*.14));}
 if(e.type==='lose'){sample('close',.22,.82);pulse(147,98,.6,.022,'sine');}
 if(e.type==='dodge'||e.type==='pad'){impact(.1,.027,1500,'highpass');}
}
export function advanceEscapeAudio(s:EscapeState):void {
 if(!enabled||!audio)return;
 const own=s.crew.find(p=>p.id===audioPlayer);listener=own?{x:own.x,z:own.z}:{x:0,z:s.house.z};
 for(const p of s.crew){
  const stride=Math.floor(p.walk/1.55),before=steps.get(p.id);steps.set(p.id,stride);
  if(before!==undefined&&before!==stride&&p.downUntil<=s.clock&&!p.left){
   const deck=onDeck(p,s.house)||(s.biome==='canal'&&Math.abs(p.x)>9.6),pan=((p.x-listener.x)*VIEW_RIGHT.x+(p.z-listener.z)*VIEW_RIGHT.z)/15,volume=.085/(1+Math.hypot(p.x-listener.x,p.z-listener.z)*.13);
   sample(deck?(stride%2?'wood0':'wood1'):(stride%2?'concrete0':'concrete1'),volume,.96+(stride%3)*.04,pan);
  }
 }
 const beat=Math.floor(s.clock/.65);if(beat===lastBeat)return;lastBeat=beat;if(s.phase==='won'||s.phase==='lost')return;
 const bass=[65.4,65.4,77.8,58.3][Math.floor(beat/8)%4];
 if(beat%2===0)pulse(bass,bass,.55,.008,'sine');
 if(s.phase==='camp'&&beat%2===0){const notes=[261.6,329.6,392,293.7];pulse(notes[Math.floor(beat/2)%4],notes[Math.floor(beat/2)%4],.45,.009,'sine');}
 if(beat%4===0)impact(.3,.01,s.biome==='canal'?1400:850,'lowpass');
}
