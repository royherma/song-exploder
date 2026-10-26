(() => {
if(document.documentElement.classList.contains('frame'))return;
const key=slug=>'sr-mix:'+slug;
let ready=null,last='';

function snapshot(){
  return JSON.stringify({src:S.src,srcRow:S.srcRow,mute:S.mute,solo:S.solo,swap:S.swap||{},tr:S.tr||{},drumKit:S.drumKit||null,
    mode:S.mode,fold:S.fold,pos:+curPos().toFixed(1)});
}
function restore(){
  let m;try{m=JSON.parse(localStorage.getItem(key(S.slug))||'null')}catch(e){m=null}
  if(m){
    setSource(m.src==='ours'?'ours':'orig');
    Object.assign(S,{srcRow:m.srcRow||{},mute:m.mute||{},solo:m.solo||{},tr:m.tr||{},swap:m.swap||{},fold:m.fold||{}});
    if(m.drumKit)setDrumKit(m.drumKit);else if(Object.keys(S.swap).length)afterSwap();
    if(m.mode&&m.mode!==S.mode)setMode(m.mode);
    if(!A.playing&&m.pos>0&&m.pos<(dur()||Infinity))A.pos=m.pos;
    ensureLoads();mixSig='';renderMixer();syncRows();applyGains();
  }
  ready=S.slug;last=snapshot();
}

const _onReport=onReport;
onReport=function(){_onReport();if(S.slug&&ready!==S.slug&&S.report&&Array.isArray(S.report.stems))restore()};
setInterval(()=>{
  if(!S.slug||ready!==S.slug)return;
  const s=snapshot();if(s===last)return;
  last=s;try{localStorage.setItem(key(S.slug),s)}catch(e){}
},1000);
})();
