(() => {
const FRAME=document.documentElement.classList.contains('frame');
const pcOf=k=>NN.indexOf(k);
const keyName=(pc,mode)=>NN[((pc%12)+12)%12]+(mode==='minor'?' min':' maj');
const clean=t=>String(t||'').replace(/^y2mate\.is\s*-\s*/i,'').replace(/\s*[\[(][^\])]*(official|video|audio|lyrics|hd|visualizer)[^\])]*[\])]/gi,'').trim();

document.head.insertAdjacentHTML('beforeend',`<style>
html.frame #tu-nav{display:none!important}
html.frame body{background:transparent}
html.frame .app{height:100vh!important;min-height:0!important;min-width:0!important;grid-template-rows:minmax(0,1fr)!important}
html.frame .top,html.frame .cols>aside{display:none!important}
html.frame .cols{grid-template-columns:minmax(0,1fr)!important;padding:0!important}
.cols>aside.hide{display:none}
#bframe{border:0;width:100%;height:100%;min-height:0;min-width:0;background:transparent;display:block}
.center.hasbar{grid-template-rows:auto auto minmax(0,1fr) 232px}
.sbar{display:flex;flex-direction:column;justify-content:center;gap:6px;height:64px;padding:0 12px}
.sbar .l{display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;min-width:0;font-size:12px;color:var(--mute)}
.sbar .k{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font:700 12px var(--disp);color:#06101f;flex:none}
.sbar .k.a{background:var(--accent)}.sbar .k.b{background:#ff7aa8}
.sbar .t{font-weight:700;color:var(--text);font-size:13px;overflow:hidden;text-overflow:ellipsis;min-width:0}
.sbar .v{font:600 12px var(--mono);color:var(--text)}
.sbar .v.warn{color:var(--warn)}
.sbar label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.sbar .sep{width:1px;height:14px;background:var(--line2);margin:0 2px;flex:none}
.sbar .sp{flex:1}
.sbar .x{height:20px;min-width:22px;padding:0 6px;border:1px solid var(--line2);border-radius:5px;background:linear-gradient(180deg,#1b2132,#121722);font:700 10.5px var(--mono);color:var(--mute);flex:none}
.sbar .x:hover{color:var(--text);border-color:var(--accent)}
.sbar .tog{height:22px;padding:0 8px;font-size:11.5px;flex:none}
@container mid (max-width:700px){.sbar .w{display:none!important}.sbar .t{flex:1 1 60px}#bbusy{max-width:80px;overflow:hidden;text-overflow:ellipsis}}
@container mid (max-width:820px){.swapbar .vol{display:none!important}.bottom>.panel{overflow:hidden}}
.sbar select{height:24px;font-size:12px;padding:0 6px;min-width:110px;max-width:300px;flex:0 1 auto}
#addb.on,.railb.on{border-color:var(--accent);color:var(--accent)}
.btn{white-space:nowrap;flex:none}
.railb{width:34px;padding:0;font-size:17px;line-height:1;flex:none}
.cols>aside{position:relative}
.cols>aside.shut>*:not(.rail-tab){display:none!important}
.rail-tab{display:none}
.cols>aside.shut .rail-tab{display:flex;align-items:center;justify-content:center;width:30px;height:100%;padding:0;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--mute);writing-mode:vertical-rl;font:700 11px var(--sans);letter-spacing:1.2px;text-transform:uppercase}
.rr.shut .rail-tab{transform:rotate(180deg)}
.cols>aside.shut .rail-tab:hover{color:var(--accent);border-color:var(--accent)}
.rail-x{position:absolute;top:50%;width:16px;height:44px;margin-top:-22px;z-index:20;padding:0;border:1px solid var(--line2);border-radius:6px;background:var(--panel2);color:var(--mute);font:700 13px var(--mono);display:grid;place-items:center}
.rl .rail-x{right:-13px}.rr .rail-x{left:-13px}
.rail-x:hover{color:var(--accent);border-color:var(--accent)}
#vidB{display:block;width:100%;max-height:300px;border-radius:10px;background:#000;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 10px 30px -12px rgba(255,122,168,.35)}
#vthumbB{display:none;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px}
#vidpB.thumb #vthumbB{display:block}#vidpB.thumb #vidB{display:none}
.vk{width:16px;height:16px;border-radius:4px;display:grid;place-items:center;font:700 10px var(--disp);color:#06101f;letter-spacing:0}
.vk.a{background:var(--accent)}.vk.b{background:#ff7aa8}
#vidp .vk.a{display:none}.cols.hasb #vidp .vk.a{display:grid}
</style>`);

if(FRAME)frameMode();else parentMode();

function parentMode(){
const B={open:false,slug:null,song:null,songs:[],matchTempo:true,matchKey:true,semisAdj:0,nudge:0,fine:0,lock:{},
  aSlug:null,aSlugSaved:null,sig:''};
const R={left:true,right:true};
try{Object.assign(R,JSON.parse(localStorage.getItem('sr-rails')||'{}'))}catch(e){}
const fw=()=>{try{return $('#bframe')?.contentWindow?.FB||null}catch(e){return null}};

function aSong(){const r=rep(),rh=r.rhythm||{},h=r.harmony||{};if(!S.slug||!rh.bpm)return null;
  return{slug:S.slug,bpm:rh.bpm,beats:rh.beats||[],downbeats:rh.downbeats||[],key:h.key,mode:h.mode}}
function keyShift(a,b){
  if(pcOf(a.key)<0||pcOf(b.key)<0)return 0;
  const pb=a.mode===b.mode?pcOf(b.key):pcOf(b.key)+(b.mode==='minor'?3:9);
  const s=(((pcOf(a.key)-pb)%12)+12)%12;return s>6?s-12:s;
}
function tf(){
  const a=aSong(),b=B.song;if(!a||!b)return{r:1,mult:1,semis:0};
  let r=1,mult=1;
  if(B.matchTempo&&b.bpm)[r,mult]=[0.5,1,2].map(m=>[a.bpm/(b.bpm*m),m]).sort((x,y)=>Math.abs(Math.log(x[0]))-Math.abs(Math.log(y[0])))[0];
  return{r:Math.round(r*10000)/10000,mult,semis:(B.matchKey?keyShift(a,b):0)+B.semisAdj};
}
const grid=s=>s.downbeats.length?s.downbeats:s.beats.length?s.beats:[0];
function offB(){const a=aSong(),b=B.song;if(!a||!b)return 0;return grid(a)[0]-grid(b)[0]/tf().r+B.nudge*60/a.bpm+B.fine/1000}
function sigB(){const a=aSong(),t=tf();return a&&B.song?`${B.song.slug}|${a.slug}|${t.r}|${t.semis}`:''}
async function stretchUrl(url){
  const t=tf(),slug=/^\/songs\/([\w-]+)\//.exec(url)?.[1];
  if(slug!==B.slug)throw new Error('song B changed');
  const j=await fetch(`/api/mix/stretch?slug=${slug}&src=${encodeURIComponent(url)}&tempo=${t.r.toFixed(4)}&semis=${t.semis}`).then(r=>r.json());
  if(j.error)throw new Error(j.error);return j.url;
}

const _start=start;start=function(off){_start(off);if(A.playing)fw()?.parentStarted(A.t0)};
const _stopSrc=stopSrc;stopSrc=function(){_stopSrc();fw()?.parentStopped()};

function save(){try{localStorage.setItem('sr-songb',JSON.stringify({open:B.open,slug:B.slug,matchTempo:B.matchTempo,matchKey:B.matchKey,
  semisAdj:B.semisAdj,nudge:B.nudge,fine:B.fine,aSlug:B.aSlug}))}catch(e){}}
function loadSaved(){try{return JSON.parse(localStorage.getItem('sr-songb')||'{}')||{}}catch(e){return{}}}

async function lock(){
  const a=aSong(),b=B.song;if(!a||!b||!B.open)return;
  const t=tf(),base=offB()-B.fine/1000,key=[B.sig,base.toFixed(3)].join('|');
  if(B.lock.key===key&&B.lock.state!=='fail')return;
  B.lock={key,state:'busy'};bars();
  try{
    const j=await fetch(`/api/mix/align?a=${a.slug}&b=${b.slug}&tempo=${t.r.toFixed(4)}&semis=${t.semis}&off=${base.toFixed(3)}&beat=${(60/(b.bpm*t.r)).toFixed(4)}`).then(r=>r.json());
    if(B.lock.key!==key)return;if(j.error)throw new Error(j.error);
    B.lock={key,state:'done',...j};B.fine=j.shift_ms;moved();
  }catch(e){if(B.lock.key===key){B.lock={key,state:'fail'};toast('Beat lock: '+e.message,5000,'bad');bars()}}
}
function moved(){bars();fw()?.restart();save()}
function bars(){renderABar();fw()?.renderBar()}
function retune(){B.fine=0;B.lock={};checkSig(true)}
function checkSig(force){
  if(!B.open)return;
  const a=aSong();
  if(a&&a.slug!==B.aSlug){
    const keep=B.aSlug===null&&B.aSlugSaved===a.slug&&B.fine;
    B.aSlug=a.slug;B.aSlugSaved=null;
    if(keep)B.lock={state:'kept'};else{B.fine=0;B.nudge=0;B.semisAdj=0;B.lock={}}
    force=true;
  }
  const sig=sigB();
  if(!force&&sig===B.sig)return;
  B.sig=sig;fw()?.retune();bars();save();
  if(sig&&B.lock.state!=='kept')lock();
}

function renderABar(){
  const el=$('#abar');if(!el)return;
  const a=aSong(),s=curSong();
  el.innerHTML=`<div class="l"><span class="k a">A</span><span class="t">${esc(clean(s?.title||S.slug||''))}</span>
      <span class="v">${a?Math.round(a.bpm)+' bpm · '+keyName(pcOf(a.key),a.mode):''}</span><span class="w">· B follows this tempo and key</span>
      <span class="sp"></span><button class="tog" id="bexp" title="Download what you hear (A + B) as one WAV, full length of song A">Export mix</button></div>
    <div class="l"><button class="tog" data-p="b" title="B's vocals on, A's vocals muted">B vocals on A beat</button><button class="tog" data-p="a" title="A's vocals only, B's beat">A vocals on B beat</button><button class="tog" data-p="all" title="Everything from both songs">Both full</button></div>`;
  el.querySelector('#bexp').onclick=exportMix;
  el.querySelectorAll('[data-p]').forEach(x=>x.onclick=()=>preset(x.dataset.p));
}
function layout(){
  const cols=$('.cols'),center=$('.center'),[left,right]=document.querySelectorAll('.cols>aside'),btn=$('#addb');
  btn.classList.toggle('on',B.open);btn.textContent=B.open?'− Song B':'+ Song B';
  if(!B.open){
    fw()?.teardown();$('#bframe')?.remove();$('#abar')?.remove();center.classList.remove('hasbar');
  }else{
    if(!$('#abar')){center.insertAdjacentHTML('afterbegin','<div class="panel sbar" id="abar"></div>');center.classList.add('hasbar')}
    let f=$('#bframe');
    if(!f){f=document.createElement('iframe');f.id='bframe';f.title='Song B';center.after(f)}
    if(f.dataset.slug!==B.slug){fw()?.teardown();f.dataset.slug=B.slug;f.src=`${location.pathname}?frame=b&song=${encodeURIComponent(B.slug)}`}
    renderABar();
  }
  cols.classList.toggle('hasb',B.open);
  left.classList.toggle('shut',!R.left);right.classList.toggle('shut',!R.right);
  document.querySelectorAll('.railb').forEach(b=>{const on=R[b.dataset.side];b.classList.toggle('on',on);b.title=(on?'Hide':'Show')+' the '+b.dataset.name+' panel'});
  cols.style.gridTemplateColumns=[R.left?'272px':'30px','minmax(0,1fr)',B.open&&'minmax(0,1fr)',R.right?'356px':'30px'].filter(Boolean).join(' ');
  fitGen++;dirty=true;requestAnimationFrame(()=>{fitGen++;drawWaves();drawChart();dirty=true});
}

function preset(p){
  const f=fw();if(!f)return;
  const mainA=stemList().main.map(s=>s.name),mainB=f.mainNames();
  const want=p==='b'?[n=>n!=='vocals',n=>n==='vocals']:p==='a'?[n=>n==='vocals',n=>n!=='vocals']:[()=>true,()=>true];
  for(const n of mainA){S.mute[n]=!want[0](n);S.solo[n]=false}
  f.setMutes(Object.fromEntries(mainB.map(n=>[n,!want[1](n)])));
  if(S.mode!=='stems')setMode('stems');
  syncRows();applyGains();if(A.playing)start(curPos());
}
async function pickB(slug,keep){
  const s=await fetch('/api/mix/song?slug='+encodeURIComponent(slug)).then(r=>r.ok?r.json():null);
  if(!s)return toast('That song has no finished run yet',4000,'bad');
  B.slug=slug;B.song=s;
  if(!keep){B.fine=0;B.nudge=0;B.semisAdj=0;B.lock={}}
  layout();checkSig(true);save();
}
async function openB(slug,restore){
  if(!B.songs.length)B.songs=await fetch('/api/mix/songs').then(r=>r.json()).catch(()=>[]);
  const ok=x=>B.songs.some(s=>s.slug===x);
  slug=ok(slug)&&slug!==S.slug?slug:(B.songs.find(s=>s.slug!==S.slug)||{}).slug;
  if(!slug)return toast('Add a second song first - paste a link above',4000,'bad');
  B.open=true;
  await pickB(slug,restore);
}
function closeB(){B.open=false;B.sig='';layout();save()}

function wav(buf){
  const ch=buf.numberOfChannels,len=buf.length,out=new DataView(new ArrayBuffer(44+len*ch*2));
  const w=(o,s)=>[...s].forEach((c,i)=>out.setUint8(o+i,c.charCodeAt(0)));
  w(0,'RIFF');out.setUint32(4,36+len*ch*2,true);w(8,'WAVE');w(12,'fmt ');out.setUint32(16,16,true);out.setUint16(20,1,true);out.setUint16(22,ch,true);
  out.setUint32(24,buf.sampleRate,true);out.setUint32(28,buf.sampleRate*ch*2,true);out.setUint16(32,ch*2,true);out.setUint16(34,16,true);w(36,'data');out.setUint32(40,len*ch*2,true);
  const data=[...Array(ch)].map((_,c)=>buf.getChannelData(c));let o=44;
  for(let i=0;i<len;i++)for(let c=0;c<ch;c++){const v=Math.max(-1,Math.min(1,data[c][i]));out.setInt16(o,v<0?v*0x8000:v*0x7fff,true);o+=2}
  return new Blob([out],{type:'audio/wav'});
}
function partsOf(win){
  const out=[],skipped=[];
  for(const k of win.audibleSet()){
    if(win.S.mode==='stems'&&win.swapOf(k)){skipped.push(k);continue}
    const b=win.A.bufs[win.S.mode==='stems'?win.bufKey(k):k];if(b&&b.b)out.push({buf:b.b,gain:win.effGain(k)});
  }
  return{out,skipped};
}
async function exportMix(){
  const f=fw();
  if(!f||B.lock.state==='busy'||f.busy())return toast('Still lining up song B - export when it is done');
  const sr=44100,oc=new OfflineAudioContext(2,Math.ceil(dur()*sr),sr),o=offB();
  const a=partsOf({audibleSet,swapOf,bufKey,effGain,A,S}),b=partsOf(f);
  for(const[list,at]of[[a.out,0],[b.out,o]])for(const p of list){
    const src=oc.createBufferSource(),g=oc.createGain();src.buffer=p.buf;g.gain.value=p.gain;src.connect(g).connect(oc.destination);
    if(at>=0)src.start(at,0);else src.start(0,-at);
  }
  if(!a.out.length&&!b.out.length)return toast('Nothing is on - unmute a part first');
  const btn=$('#bexp');btn.disabled=true;btn.textContent='Rendering…';
  try{
    const out=await oc.startRendering();
    let peak=0;for(let c=0;c<out.numberOfChannels;c++){const d=out.getChannelData(c);for(let i=0;i<d.length;i++){const v=Math.abs(d[i]);if(v>peak)peak=v}}
    if(peak>0.98){const k=0.98/peak;for(let c=0;c<out.numberOfChannels;c++){const d=out.getChannelData(c);for(let i=0;i<d.length;i++)d[i]*=k}}
    const name=`mix-${S.slug.slice(0,24)}-x-${B.slug.slice(0,24)}.wav`,skipped=a.skipped.concat(b.skipped);
    const l=document.createElement('a');l.href=URL.createObjectURL(wav(out));l.download=name;l.click();
    toast(`Saved ${name}`+(peak>0.98?` - lowered ${(20*Math.log10(peak/0.98)).toFixed(1)} dB so it does not clip`:'')+(skipped.length?` - left out ${skipped.join(', ')} (played as MIDI)`:''),6000);
  }finally{btn.disabled=false;btn.textContent='Export mix'}
}

window.SongB={get A(){return A},state:B,rawPos:()=>rawPos(),toggle:()=>toggle(),seek:p=>seek(p),pause:()=>pause(),ensureCtx:()=>ensureCtx(),
  tf,offB,stretchUrl,lockText,set(patch){Object.assign(B,patch);if('matchTempo'in patch||'matchKey'in patch||'semisAdj'in patch)retune();else moved()},
  relock(){B.fine=0;B.lock={};moved();lock()},pick:slug=>pickB(slug),close:closeB,songs:()=>B.songs,aSong};
function lockText(){const L=B.lock;
  if(L.state==='busy')return'<span class="v warn">listening…</span>';
  if(L.state==='fail')return'<span class="v warn">failed</span>';
  return `<span class="v ${L.state==='done'&&L.steady_pct<40?'warn':''}" title="${L.state==='done'?`Holds on ${L.steady_pct}% of 12 s stretches - low means one song speeds up or slows down`:''}">${B.fine>0?'+':''}${B.fine} ms${L.state==='done'?' · '+L.steady_pct+'%':''}</span>`}

const st=loadSaved();
Object.assign(B,{matchTempo:st.matchTempo??true,matchKey:st.matchKey??true,semisAdj:st.semisAdj||0,nudge:st.nudge||0,fine:st.fine||0,
  aSlugSaved:st.aSlug||null});
$('#vidp .ph-h').insertAdjacentHTML('afterbegin','<span class="vk a">A</span>');
$('#vidp').insertAdjacentHTML('afterend','<div class="panel vidp" id="vidpB"><div class="ph-h"><span class="vk b">B</span>Video<span class="r" id="vidoffB"></span></div><div class="vbox"><video id="vidB" muted playsinline preload="auto"></video><img id="vthumbB" alt=""></div></div>');
function syncVidB(){
  const box=$('#vidpB'),v=$('#vidB'),x=B.open?fw()?.vid?.():null,s=x?.song,show=!!(s&&(s.video||s.thumb));
  if(box.classList.contains('on')!==show){box.classList.toggle('on',show);dirty=true}
  if(!s||!s.video){
    if(v.dataset.src){v.pause();v.removeAttribute('src');v.load();delete v.dataset.src}
    box.classList.toggle('thumb',show);
    const im=$('#vthumbB');if(show&&im.dataset.src!==s.thumb){im.dataset.src=s.thumb;im.src=s.thumb}
    return}
  box.classList.remove('thumb');
  if(v.dataset.src!==s.video){v.dataset.src=s.video;v.src=s.video;$('#vidoffB').textContent=x.rate===1?'':`${Math.round(x.rate*1000)/10}% speed`}
  if(Math.abs(v.playbackRate-x.rate)>0.001)v.playbackRate=x.rate;
  const tgt=x.raw+(+s.video_offset||0),ok=tgt>=0&&(!v.duration||tgt<v.duration);
  if(A.playing&&ok){
    if(v.paused){v.currentTime=tgt;v.play().catch(()=>{})}
    else if(Math.abs(v.currentTime-tgt)>0.08)v.currentTime=tgt;
  }else{
    if(!v.paused)v.pause();
    if(ok&&Math.abs(v.currentTime-tgt)>0.05&&v.readyState>0)v.currentTime=tgt;
  }
}
(function vloop(){syncVidB();requestAnimationFrame(vloop)})();
function rails(){
  document.querySelectorAll('.cols>aside').forEach((el,i)=>{
    const side=i?'right':'left',name=i?'Grade':'Pipeline';
    el.classList.add(i?'rr':'rl');
    el.insertAdjacentHTML('beforeend',`<button class="rail-x" title="Hide the ${name.toLowerCase()} column">${i?'›':'‹'}</button><button class="rail-tab" title="Show the ${name.toLowerCase()} column">${i?'‹ ':''}${name}${i?'':' ›'}</button>`);
    const flip=()=>{R[side]=!R[side];try{localStorage.setItem('sr-rails',JSON.stringify(R))}catch(e){}layout()};
    el.querySelector('.rail-x').onclick=flip;el.querySelector('.rail-tab').onclick=flip;
    (i?$('.railb'):$('#addb')).insertAdjacentHTML('afterend',`<button class="btn railb" data-side="${side}" data-name="${name.toLowerCase()}">${i?'◨':'◧'}</button>`);
    document.querySelector(`.railb[data-side="${side}"]`).onclick=flip;
  });
  layout();
}
rails();
$('#addb').onclick=()=>B.open?closeB():openB(B.slug||st.slug);
setInterval(()=>{if(B.open){checkSig();if(S.slug&&$('#abar')&&!$('#abar').textContent.includes('bpm'))renderABar()}},400);
if(st.open&&st.slug)openB(st.slug,true);
}

function frameMode(){
let PB;try{PB=window.parent.SongB}catch(e){}
if(!PB)return;
const smap=new Map(),needsAt={'@original':['original'],'@beat':['beat'],'@rebuild':['rebuild','vox']};
const T=()=>PB.tf(),trivial=t=>Math.abs(t.r-1)<0.00005&&!t.semis;

ensureCtx=function(){if(!PB.A.ctx)PB.ensureCtx();if(A.ctx!==PB.A.ctx){if(A.ctx&&A.ctx.close)A.ctx.close().catch(()=>{});for(const k in MIDI.gain)delete MIDI.gain[k];A.ctx=PB.A.ctx;A.master=A.ctx.createGain();A.master.connect(A.ctx.destination)}};
ensureCtx();
syncVideo=function(){};
rawPos=function(){return (PB.rawPos()-PB.offB())*T().r};
curPos=function(){return Math.max(0,rawPos())};
toggle=function(){PB.toggle()};
pause=function(){PB.pause()};
seek=function(p){PB.seek(PB.offB()+Math.max(0,p)/T().r);dirty=true};
midiStart=function(){};
start=function(){bStart(null)};
function bStart(when){
  stopSrc();
  const P=PB.A;A.playing=!!P.playing;
  if(!A.playing){setPlayBtn();dirty=true;return}
  ensureCtx();
  when=when??A.ctx.currentTime+0.03;
  const bt=P.o0+(when-P.t0)-PB.offB();
  const {main,drums}=stemList();
  const keys=S.mode==='stems'?main.concat(drums).map(s=>s.name):S.mode==='vox'?['vocals','@rebuild']:['@'+S.mode];
  keys.forEach(k=>{
    if(S.mode==='stems'&&swapOf(k))return;
    const b=A.bufs[S.mode==='stems'?bufKey(k):k]?.b;
    if(!b||bt>=b.duration)return;
    const s=A.ctx.createBufferSource();s.buffer=b;
    const g=A.ctx.createGain();g.gain.value=effGain(k);
    s.connect(g);g.connect(A.master);
    if(bt>=0)s.start(when,bt);else s.start(when-bt,0);
    A.srcs.push(s);A.gains[k]=g;
  });
  setPlayBtn();dirty=true;
}
const _loadBuf=loadBuf;
loadBuf=function(key,url){
  const t=T();
  if(trivial(t))return _loadBuf(key,url);
  if(needsAt[key]&&!needsAt[key].includes(S.mode))return;
  const sk=`${t.r}|${t.semis}|${url}`;
  if(smap.has(sk)){const u=smap.get(sk);if(u)_loadBuf(key,u);return}
  smap.set(sk,null);A.pending[key]=sk;renderBusy();
  PB.stretchUrl(url).then(u=>{smap.set(sk,u);if(A.pending[key]===sk)delete A.pending[key];const n=T();if(n.r===t.r&&n.semis===t.semis)_loadBuf(key,u)})
    .catch(e=>{smap.delete(sk);if(A.pending[key]===sk)delete A.pending[key];A.failed[key]=url;toast(`Song B ${key}: ${e.message}`,5000,'bad')})
    .finally(renderBusy);
};
const _setMode=setMode;setMode=function(m){_setMode(m);ensureLoads()};
$('#play').onclick=()=>toggle();
$('#rew').onclick=()=>seek(0);

const center=document.querySelector('.center');
center.insertAdjacentHTML('afterbegin','<div class="panel sbar" id="bbar"></div>');center.classList.add('hasbar');
const busy=()=>Object.keys(A.pending).length>0;
function renderBusy(){const el=$('#bbusy');if(el)el.textContent=busy()?`matching ${Object.keys(A.pending).length} parts…`:''}
function renderBar(){
  const el=$('#bbar'),b=PB.state,a=PB.aSong(),t=T(),s=b.song;if(!el||!s)return;
  const pct=((t.r-1)*100).toFixed(1);
  el.innerHTML=`<div class="l"><span class="k b">B</span><select id="bsong" title="The second song - it follows A's tempo and key">${PB.songs().map(x=>`<option value="${esc(x.slug)}"${x.slug===s.slug?' selected':''}>${esc(clean(x.title))} · ${x.bpm?Math.round(x.bpm):'?'} bpm · ${x.key?keyName(pcOf(x.key),x.mode):'?'}</option>`).join('')}</select>
      <span class="v warn" id="bbusy"></span><span class="sp"></span><button class="x" data-n="-4" title="Move B one bar earlier">−bar</button><button class="x w" data-n="-1" title="Move B one beat earlier">−beat</button><button class="x w" data-n="1" title="Move B one beat later">+beat</button><button class="x" data-n="4" title="Move B one bar later">+bar</button><button class="tog" id="bx" title="Remove song B">Close</button></div>
    <div class="l"><label title="Match tempo: speed B up or down to A's tempo (pitch stays)"><input type="checkbox" id="bmt"${b.matchTempo?' checked':''}><span class="w">Tempo</span></label>
      <span class="v ${Math.abs(t.r-1)>0.12?'warn':''}">${Math.round(s.bpm)}→${Math.round(s.bpm*t.r*10)/10}${b.matchTempo&&a?`<span class="w"> ${t.r>=1?'+':''}${pct}%</span>${t.mult===2?' half':t.mult===0.5?' double':''}`:''}</span>
      <span class="sep"></span><label title="Match key: shift B's pitch to A's key"><input type="checkbox" id="bmk"${b.matchKey?' checked':''}><span class="w">Key</span></label>
      <span class="v">${keyName(pcOf(s.key),s.mode)}→${keyName(pcOf(s.key)+t.semis,s.mode)}</span>
      <button class="x" id="bsd" title="Down 1 semitone">−</button><button class="x" id="bsu" title="Up 1 semitone">+</button>
      <span class="sep"></span><span title="B is shifted so its drum hits land on A's - measured from the audio" class="w">Lock</span>${PB.lockText()}
      <button class="x w" id="bfd" title="B 10 ms earlier">−</button><button class="x w" id="bfu" title="B 10 ms later">+</button><button class="x" id="brl" title="Line up again by the drum hits">↻</button></div>`;
  el.querySelector('#bsong').onchange=e=>PB.pick(e.target.value);
  el.querySelector('#bx').onclick=()=>PB.close();
  el.querySelector('#bmt').onchange=e=>PB.set({matchTempo:e.target.checked});
  el.querySelector('#bmk').onchange=e=>PB.set({matchKey:e.target.checked,semisAdj:0});
  el.querySelector('#bsd').onclick=()=>PB.set({semisAdj:b.semisAdj-1});
  el.querySelector('#bsu').onclick=()=>PB.set({semisAdj:b.semisAdj+1});
  el.querySelector('#bfd').onclick=()=>PB.set({fine:b.fine-10});
  el.querySelector('#bfu').onclick=()=>PB.set({fine:b.fine+10});
  el.querySelector('#brl').onclick=()=>PB.relock();
  el.querySelectorAll('[data-n]').forEach(x=>x.onclick=()=>PB.set({nudge:b.nudge+ +x.dataset.n}));
  renderBusy();
}
window.FB={A,S,vid:()=>({song:curSong(),raw:rawPos(),rate:T().r}),audibleSet,swapOf,bufKey,effGain,busy,renderBar,
  parentStarted:t=>bStart(t),
  parentStopped(){stopSrc();A.playing=false;setPlayBtn();dirty=true},
  restart(){if(PB.A.playing)bStart(null);dirty=true},
  retune(){audioReset();A.playing=!!PB.A.playing;ensureLoads();renderBar();dirty=true},
  teardown(){stopSrc();try{A.master&&A.master.disconnect()}catch(e){}},
  mainNames:()=>stemList().main.map(s=>s.name),
  setMutes(m){for(const n in m){S.mute[n]=m[n];S.solo[n]=false}if(S.mode!=='stems')_setMode('stems');syncRows();applyGains()},
};
A.playing=!!PB.A.playing;
const iv=setInterval(()=>{if(S.report&&PB.state.song){clearInterval(iv);renderBar();FB.retune()}},200);
}
})();
