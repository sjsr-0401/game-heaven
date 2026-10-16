import {CREW_COLORS} from '../../../shared/escape.js';
export function crewIndex(color:string):number {return Math.max(0,CREW_COLORS.findIndex(c=>c===color));}
export function crewPortrait(color:string):string {
 const i=crewIndex(color),skin=['#ddb18d','#a87153','#efc8a1','#c68f6d'][i],hair=['#634634','#303641','#704934','#3a302c'][i];
 const headgear=[
 '<path d="M9 16V13C9 2 35 2 35 13V16M6 16H38M22 4V13" fill="'+color+'"/><rect x="18" y="8" width="8" height="7" rx="1" fill="#f9e8b3"/>',
 '<path d="M10 14V10Q22 0 34 10V14L38 17H9" fill="'+color+'"/><path d="M12 12H33" stroke="#f0dec1" stroke-width="3"/>',
 '<path d="M11 14Q7 4 18 4H28Q37 6 33 18L12 18" fill="'+color+'"/><path d="M31 17Q43 21 35 34L31 29" fill="'+hair+'"/><path d="M11 14H33" stroke="#e9ddbb" stroke-width="4"/>',
 '<path d="M11 14V9Q22 1 33 10V15" fill="'+hair+'"/><path d="M9 15Q7 1 22 3Q37 3 35 17" fill="none" stroke="'+color+'" stroke-width="5"/><rect x="7" y="15" width="7" height="12" rx="3" fill="'+color+'"/><rect x="31" y="15" width="7" height="12" rx="3" fill="'+color+'"/>'
 ][i];
 return '<svg viewBox="0 0 44 48" aria-hidden="true"><g stroke="#293541" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 47V39Q9 32 17 31H28Q37 34 38 40V47" fill="'+color+'"/><path d="M17 33L21 39L28 33V28H17Z" fill="'+skin+'"/><path d="M11 13Q22 7 34 14L33 25Q31 32 23 33Q14 32 12 25Z" fill="'+skin+'"/><path d="M12 18L12 13Q22 4 34 14V19L29 14L17 16" fill="'+hair+'"/>'+headgear+'<path d="M17 22V24M28 22V24" stroke-width="2.7"/><path d="M20 28Q23 30 26 27" fill="none"/><path d="M13 37L14 47M32 37L31 47" fill="none"/><path d="M18 40H27V47H18Z" fill="#e9dcc1"/></g></svg>';
}
const paths:Record<string,string>={
 hook:'<path d="M15 3v10a5 5 0 1 1-10 0v-2l4 2M11 3h8M15 8h5"/>',
 throw:'<path d="M3 17l4-5 5 4-4 5zM10 9C12 2 20 3 21 10M18 8l3 3 2-4"/>',
 repair:'<path d="M8 5V3h8v2M3 8h18v13H3zM10 11h4v3h3v3h-3v3h-4v-3H7v-3h3z"/>',
 barrel:'<path d="M6 3h12l2 4v13H4V7zM4 8h16M4 17h16M10 10l-1 4h3l-1 3 5-5h-3l1-2z"/>',
 battery:'<path d="M9 3h6v3M6 6h12v15H6zM13 8l-4 6h4l-1 5 4-7h-4z"/>',
 scrap:'<path d="M3 7l9-4 9 4v13H3zM3 10h18M12 4v16M6 14l2 3 2-3M15 14h3"/>',
 spring:'<path d="M3 4h18M7 7l10 3-10 4 10 3M4 20h16M4 18v3M20 18v3"/>',
 hull:'<path d="M12 2l9 4-2 11-7 5-7-5L3 6zM7 7l10 10M8 17l9-10"/>',
 reel:'<circle cx="12" cy="11" r="7"/><circle cx="12" cy="11" r="3"/><path d="M17 16v5h-7M12 4V2"/>',
 blast:'<path d="M12 2l2 6 6-4-3 6 5 2-6 3 3 6-6-4-4 5-1-6-6 1 4-5-4-4 7 1z"/>',
 medic:'<path d="M8 3h8v5h5v8h-5v5H8v-5H3V8h5z"/>',
 engine:'<path d="M4 8h14v11H4zM8 8V4h7M18 11h3v5h-3M1 11h3M1 16h3M8 19v3M15 19v3M10 10l-2 4h5l-1 3 4-5h-5l1-2"/>',
 dodge:'<path d="M3 7h6M1 12h6M3 17h6M12 4l8 8-8 8M20 12H9"/>',
 drop:'<path d="M12 2v12M7 10l5 5 5-5M4 15v6h16v-6"/>',
 parts:'<path d="M10 2h4l1 4 4-1 2 3-3 3 3 3-2 4-4-1-1 4h-4l-1-4-4 1-2-4 3-3-3-3 2-3 4 1z"/><circle cx="12" cy="11.5" r="3"/>',
 hand:'<path d="M8 12V6a2 2 0 0 1 4 0v5V4a2 2 0 0 1 4 0v8V7a2 2 0 0 1 4 0v8c0 5-3 7-7 7-4 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2"/>'
};
export function toolIcon(kind:string):string {return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(paths[kind==='hook'?'hook':kind]??paths.parts)+'</svg>';}
