import type {EscapeEvent,EscapeState} from '../../shared/escape.js';
import type { CombatEvent } from '../../shared/defense.js';

let audio:AudioContext|null=null,master:GainNode|null=null,noise:AudioBuffer|null=null;
let enabled=false,last=0;
let recorder:MediaRecorder|null=null,recordedAt=0;
const chunks:Blob[]=[];
export function setSoundEnabled(value:boolean):void{
  enabled=value;
  if(!value){if(master&&audio)master.gain.setTargetAtTime(0,audio.currentTime,.025);return;}
  if(!audio){
    audio=new AudioContext();master=audio.createGain();master.gain.value=.6;master.connect(audio.destination);
    noise=audio.createBuffer(1,Math.ceil(audio.sampleRate*.7),audio.sampleRate);
    const data=noise.getChannelData(0);let seed=19723;
    for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;data[i]=(seed>>>0)/2147483648-1;}
    // Only the synthesized game bus is captured; no microphone or other app audio is requested.
    if(new URLSearchParams(location.search).get('record')==='1'&&typeof MediaRecorder!=='undefined'){
      const destination=audio.createMediaStreamDestination();master.connect(destination);
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
export function playUiSound():void{pulse(170,90,.12,.03);}
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
  if(e.type==='hook'){impact(.1,.06,2600,'bandpass');pulse(350,120,.13,.04,'triangle');}
  if(e.type==='throw'){impact(.16,.07,1200);pulse(140,300,.12,.025);}
  if(e.type==='hit'&&performance.now()-escapeHitAt>55){escapeHitAt=performance.now();impact(.12,.12,1100);pulse(e.text==='crew'?80:125,35,.13,.06,'sine');}
  if(e.type==='explode'){impact(.48,.22,e.prop==='battery'?2400:800);pulse(85,24,.45,.13,'sine');}
  if(e.type==='kill'){pulse(210,80,.16,.035);}
  if(e.type==='install'||e.type==='repair'||e.type==='rescue'){for(let i=0;i<3;i++)pulse([330,440,550][i],[330,440,550][i],.23,.025,'sine',i*.07);}
  if(e.type==='warning'){pulse(180,150,.2,.035,'triangle');pulse(180,150,.2,.03,'triangle',.28);}
  if(e.type==='camp'||e.type==='upgrade'){chime(2);}
  if(e.type==='boss'){impact(.6,.12,600);pulse(70,35,.7,.07,'sine');}
  if(e.type==='win'){[262,330,392,523,659].forEach((n,i)=>pulse(n,n,1,.035,'sine',i*.15));}
  if(e.type==='lose'){[196,175,147].forEach((n,i)=>pulse(n,n,.7,.035,'sine',i*.18));}
  if(e.type==='dodge'||e.type==='pad'){impact(.12,.035,1500,'highpass');}
}
export function advanceEscapeAudio(s:EscapeState):void {
  if(!enabled||!audio)return;
  const beat=Math.floor(s.clock/.65);if(beat===lastBeat)return;lastBeat=beat;
  if(s.phase==='won'||s.phase==='lost')return;
  const bass=[65.4,65.4,77.8,58.3][Math.floor(beat/8)%4];
  if(beat%2===0)pulse(bass,bass,.55,.012,'sine');
  const notes=[261.6,0,392,0,311.1,0,349.2,0,261.6,0,466.2,392,0,311.1,0,0];
  const note=notes[beat%notes.length];if(note)pulse(note,note,.45,s.phase==='camp'?.018:.008,'sine');
  if(beat%4===0)impact(.35,.013,s.biome==='canal'?1400:850,'lowpass');
}
