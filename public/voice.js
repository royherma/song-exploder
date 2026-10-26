(() => {
if(document.documentElement.classList.contains('frame'))return;
const MODES=[['off','Off','As sung'],['natural','Natural','Pulls each note to the right note, keeps slides and vibrato'],['hard','Hard','Snaps to the note instantly - the robot sound']];
const FX=[['dry','Dry','No effects'],['studio','Studio','Compressor + a small room'],['big','Big','Chorus, an echo on the beat, a big hall'],['phone','Phone','Thin and gritty, like a phone speaker']];
const V={slug:null,takes:[],set:{},jobs:{},rec:null,ab:{}};
const fmt=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const tracks=()=>['vocals',...V.takes.map(t=>t.id)];
const nameOf=id=>id==='vocals'?'vocals':(V.takes.find(t=>t.id===id)||{}).name;
const idOf=n=>n==='vocals'?'vocals':(V.takes.find(t=>t.name===n)||{}).id;
const PRESETS={off:{str:0,spd:0,vib:100,hold:60,fmt:0},natural:{str:100,spd:40,vib:100,hold:60,fmt:0},hard:{str:100,spd:0,vib:0,hold:60,fmt:0}};
const KNOBS=[['str','Strength','%',0,100,5,'How far each note moves to the right note'],['spd','Speed','ms',0,200,5,'How fast it glides onto the note. 0 = instant robot snap'],
  ['vib','Vibrato','%',0,100,5,"How much of the singer's own wobble and slides survive"],['hold','Note hold','ms',0,200,10,'How long a note must last before the tune follows a new one. Higher = steadier, fewer jumps'],
  ['fmt','Voice','',-6,6,1,'Voice character without changing pitch: lower = deeper, higher = brighter'],['mix','FX amount','%',0,100,5,'How much of the effect you hear']];
const DEF={...PRESETS.off,fx:'dry',mix:100};
const setOf=id=>{const s=V.set[id]||{};return s.mode&&s.str==null?{...DEF,...PRESETS[s.mode],fx:s.fx||'dry'}:{...DEF,...s}};
const presetOf=s=>Object.keys(PRESETS).find(k=>['str','spd','vib','hold','fmt'].every(n=>PRESETS[k][n]===s[n]))||'custom';
const plain=s=>s.str===0&&s.fmt===0&&s.fx==='dry';
const query=s=>['str','spd','vib','hold','fmt','mix'].map(k=>`${k}=${s[k]}`).join('&')+`&fx=${s.fx}`;

document.head.insertAdjacentHTML('beforeend',`<style>
.ms button.vt{width:40px;margin-right:2px;padding:0;border:1px solid var(--line2);border-radius:5px;background:transparent;color:var(--mute);font:700 9px var(--mono);letter-spacing:.04em;display:none;white-space:nowrap}
.row:hover .vt,.vt.on,.vt.busy{display:inline-block}
.lab .vdel{right:44px}.row:hover .lab:has(.vdel){padding-right:72px}
.vdel:hover{border-color:var(--bad)!important;color:var(--bad)!important;box-shadow:none!important}
.vt:hover{border-color:#ff7aa8;color:#ff9dbd}
.vt.on{background:linear-gradient(135deg,#ff7aa8,#c18cff);color:#1a0612;border-color:transparent}
.vt.busy{color:#ff9dbd;border-color:rgba(255,122,168,.5)}
#vtm{position:fixed;z-index:60;display:none;width:330px;padding:6px;border-radius:11px;background:rgba(14,17,25,.97);border:1px solid var(--line2);box-shadow:0 18px 40px -12px rgba(0,0,0,.9),0 0 0 1px rgba(255,122,168,.12)}
#vtm h6{margin:2px 8px 6px;font:700 10.5px var(--mono);letter-spacing:1px;text-transform:uppercase;color:var(--mute)}
#vtm .xr{display:flex;align-items:center;gap:4px;padding:5px 8px}
#vtm .xr span{width:38px;font:600 11.5px var(--sans);color:var(--mute)}
#vtm .xr button{flex:1;border:1px solid var(--line2);background:var(--panel2);color:var(--text);font:600 11.5px var(--sans);border-radius:6px;padding:4px 0;cursor:pointer}
#vtm .xr button:hover{border-color:#ff7aa8}
#vtm .xr button.on{background:linear-gradient(135deg,#ff7aa8,#c18cff);color:#1a0612;border-color:transparent;font-weight:700}
#vtm .kh{display:block;width:calc(100% - 16px);margin:6px 8px 2px;padding:7px 0 0;border:none;border-top:1px solid var(--line2);background:none;text-align:left;cursor:pointer;font:700 10px var(--mono);letter-spacing:1px;text-transform:uppercase;color:var(--mute)}
#vtm .kh:hover{color:var(--text)}
#vtm .gz{margin:6px 8px 4px;padding:7px 8px;border-radius:8px;background:rgba(5,6,10,.5);border:1px solid var(--line2)}
#vtm .gh{font:600 11px var(--sans);color:var(--text);margin-bottom:5px}#vtm .gh em{font-style:normal;color:var(--mute);font-weight:500;margin-left:4px;font-size:10.5px}
#vtm .gr{display:grid;grid-template-columns:44px 1fr 26px;align-items:center;gap:8px;padding:2px 0}
#vtm .gr span{font:600 11px var(--sans);color:var(--mute)}#vtm .gr em{font:700 11px var(--mono);font-style:normal;text-align:right;color:var(--text)}
#vtm .gr i{height:6px;border-radius:3px;background:rgba(255,255,255,.07);overflow:hidden}#vtm .gr b{display:block;height:100%;border-radius:3px}
#vtm .gr.b b{background:#ff6b7a}#vtm .gr.a b{background:#4ade80;box-shadow:0 0 8px rgba(74,222,128,.5)}
#vtm .kn{display:grid;grid-template-columns:72px 1fr 46px;align-items:center;gap:8px;padding:2px 8px;cursor:default}
#vtm .kn span{font:600 11.5px var(--sans);color:var(--mute)}
#vtm .kn input{width:100%;accent-color:#ff7aa8;height:14px}
#vtm .kn em{font:600 11px var(--mono);color:var(--text);font-style:normal;text-align:right}
#vtm .kn.dim{opacity:.4}
#vtm p{margin:6px 8px 2px;font:500 11.5px/1.4 var(--sans);color:var(--mute)}
#vtm p b{color:var(--text);font-family:var(--mono)}
.vprog{position:absolute;left:0;top:0;bottom:0;z-index:2;pointer-events:none;background:linear-gradient(90deg,rgba(255,122,168,.10),rgba(255,122,168,.28));border-right:2px solid #ff7aa8;box-shadow:6px 0 14px -4px #ff7aa8;transition:width .5s}
.vprog b{position:absolute;right:8px;top:50%;transform:translateY(-50%);font:700 11px var(--mono);color:#ffd0e0;text-shadow:0 0 6px #000;white-space:nowrap}
.row.vtuned{box-shadow:inset 3px 0 0 #ff7aa8}
.row.vtuned .lab i,.row.vbusy .lab i{color:#ff9dbd!important;font-weight:600}
#vtm .ab{display:flex;gap:4px;margin:4px 8px;padding:3px;border-radius:8px;background:rgba(5,6,10,.6);border:1px solid var(--line2)}
#vtm .ab button{flex:1;border:none;background:transparent;color:var(--mute);font:600 11.5px var(--sans);border-radius:6px;padding:5px 0;cursor:pointer}
#vtm .ab button.on{background:var(--panel2);color:var(--text);box-shadow:0 0 0 1px #ff7aa8}
#vtm .bar{height:4px;margin:6px 8px 2px;border-radius:2px;background:rgba(255,255,255,.07);overflow:hidden}
#vtm .bar i{display:block;height:100%;background:linear-gradient(90deg,#ff7aa8,#c18cff);transition:width .5s}
#vtm .st{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:4px;font:700 9.5px var(--mono);letter-spacing:.6px;vertical-align:1px}
#vtm .st.on{background:#ff7aa8;color:#1a0612}#vtm .st.busy{background:rgba(255,122,168,.18);color:#ff9dbd}#vtm .st.off{background:rgba(255,255,255,.06);color:var(--mute)}
body.vrec #ph{width:3px;background:#ff3b5c;box-shadow:0 0 10px 2px #ff3b5c,0 0 28px 6px rgba(255,59,92,.45);animation:vglow 1s ease-in-out infinite}
body.vrec #pv{background:linear-gradient(90deg,transparent,rgba(255,59,92,.16))}
body.vrec .panel:has(#rows){box-shadow:0 0 0 1px rgba(255,59,92,.55),0 0 30px -6px rgba(255,59,92,.5);animation:vpanel 1.6s ease-in-out infinite}
.row[data-n="recording"]{background:linear-gradient(90deg,rgba(255,59,92,.22),rgba(255,59,92,.06) 40%,rgba(255,59,92,.03));box-shadow:inset 4px 0 0 #ff3b5c;animation:vrow 1.2s ease-in-out infinite}
.row[data-n="recording"] .lab b{color:#ff8a9c}
.row[data-n="recording"] .lab b::before{content:'●';color:#ff3b5c;margin-right:6px;text-shadow:0 0 8px #ff3b5c;animation:vblink 1s steps(2,start) infinite}
.row[data-n="recording"] .lab i{color:#ff8a9c!important;font:700 11px var(--mono)!important}
.vband{position:absolute;top:2px;bottom:2px;z-index:0;pointer-events:none;border-radius:3px;background:linear-gradient(90deg,rgba(255,59,92,.10),rgba(255,59,92,.30));border-right:2px solid #ff3b5c;box-shadow:4px 0 16px -2px #ff3b5c}
.row[data-n="recording"] .wv canvas{z-index:1}
.row[data-n="recording"],.row[data-n="recording"] .wv,.row[data-n="recording"] .lab{opacity:1!important;filter:none!important}
@keyframes vglow{50%{box-shadow:0 0 4px 1px #ff3b5c,0 0 14px 2px rgba(255,59,92,.3)}}
@keyframes vrow{50%{box-shadow:inset 4px 0 0 #ff3b5c,inset 0 0 22px rgba(255,59,92,.28)}}
@keyframes vpanel{50%{box-shadow:0 0 0 1px rgba(255,59,92,.25),0 0 14px -6px rgba(255,59,92,.3)}}
@keyframes vblink{to{visibility:hidden}}
#recb{display:inline-flex;align-items:center;gap:7px;border-top-right-radius:0;border-bottom-right-radius:0}
#micb{width:26px;padding:0;margin-left:-1px;border-top-left-radius:0;border-bottom-left-radius:0;color:var(--mute);font-size:11px}
#micb:hover{color:var(--text)}
#micm{position:fixed;z-index:60;display:none;min-width:260px;max-width:360px;padding:6px;border-radius:11px;background:rgba(14,17,25,.97);border:1px solid var(--line2);box-shadow:0 18px 40px -12px rgba(0,0,0,.9)}
#micm h6{margin:2px 8px 6px;font:700 10.5px var(--mono);letter-spacing:1px;text-transform:uppercase;color:var(--mute)}
#micm button{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:none;border-radius:7px;background:none;color:var(--text);font:500 12.5px var(--sans);text-align:left;cursor:pointer}
#micm button:hover{background:rgba(255,255,255,.05)}
#micm button i{width:8px;height:8px;border-radius:50%;flex:none;border:1px solid var(--line2)}
#micm button.on i{background:#ff3b5c;border-color:#ff3b5c;box-shadow:0 0 6px #ff3b5c}
#micm p{margin:6px 8px 2px;font:500 11px/1.4 var(--sans);color:var(--mute)}
#recb i{width:10px;height:10px;border-radius:50%;background:#ff5c6c;box-shadow:0 0 8px #ff5c6c}
#recb.on{background:#ff5c6c;color:#1a0508;border-color:transparent}#recb.on i{border-radius:2px;background:#1a0508;box-shadow:none}
</style>`);
document.getElementById('addb').insertAdjacentHTML('afterend',`<span style="display:inline-flex;flex:none"><button class="btn" id="recb" title="Record your voice over the song from the playhead (R). It lands as a new row. Wear headphones."><i></i><span>Record</span></button><button class="btn" id="micb" title="Pick the microphone">▾</button></span>`);
document.documentElement.style.setProperty('--c-recording','#ff3b5c');
const PEAKS=800;
const menu=document.createElement('div');menu.id='vtm';document.body.appendChild(menu);
const micm=document.createElement('div');micm.id='micm';document.body.appendChild(micm);
const micId=()=>{try{return localStorage.getItem('sr-mic')||''}catch(e){return''}};
document.addEventListener('click',e=>{if(e.target.isConnected&&!e.target.closest('#micm,#micb'))micm.style.display='none'});
async function openMics(){
  if(micm.style.display==='block'){micm.style.display='none';return}
  let devs=(await navigator.mediaDevices.enumerateDevices().catch(()=>[])).filter(d=>d.kind==='audioinput');
  if(devs.length&&!devs[0].label){try{(await navigator.mediaDevices.getUserMedia({audio:true})).getTracks().forEach(t=>t.stop())}catch(e){}
    devs=(await navigator.mediaDevices.enumerateDevices().catch(()=>[])).filter(d=>d.kind==='audioinput')}
  const cur=devs.some(d=>d.deviceId===micId())?micId():'default';
  micm.innerHTML='<h6>Microphone</h6>'+(devs.length?devs.map(d=>`<button data-id="${d.deviceId}" class="${d.deviceId===cur||(!micId()&&d.deviceId==='default')?'on':''}"><i></i>${(d.label||'Microphone').replace(/</g,'&lt;')}</button>`).join(''):'<p>No microphone found. Plug one in, then open this again.</p>')+'<p>Wear headphones so the song does not leak into the mic.</p>';
  micm.querySelectorAll('button').forEach(b=>b.onclick=()=>{try{localStorage.setItem('sr-mic',b.dataset.id)}catch(e){}micm.style.display='none';toast('Recording from: '+b.textContent,2500)});
  micm.style.display='block';
  const r=document.getElementById('micb').getBoundingClientRect();
  micm.style.left=Math.max(8,Math.min(r.right-micm.offsetWidth,innerWidth-micm.offsetWidth-8))+'px';micm.style.top=(r.bottom+6)+'px';
}
document.getElementById('micb').onclick=e=>{e.stopPropagation();if(!V.rec)openMics()};
navigator.mediaDevices?.addEventListener?.('devicechange',()=>{if(micm.style.display==='block'){micm.style.display='none';openMics()}});
document.addEventListener('click',e=>{if(e.target.isConnected&&!e.target.closest('#vtm,.vt'))closeMenu()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});
function closeMenu(){menu.style.display='none';menu.dataset.id=''}

function loadSet(){try{V.set=JSON.parse(localStorage.getItem('sr-tune:'+V.slug)||'{}')||{}}catch(e){V.set={}}}
function saveSet(){try{localStorage.setItem('sr-tune:'+V.slug,JSON.stringify(V.set))}catch(e){}}

function inject(){
  const r=S.report;if(!r||!Array.isArray(r.stems)||!V.slug||S.slug!==V.slug)return;
  r.stems=r.stems.filter(s=>s.kind!=='take');
  const voc=r.stems.find(s=>s.name==='vocals');
  if(voc){voc.web0=voc.web0||voc.web;voc.peaks0=voc.peaks0||voc.peaks;const j=V.jobs.vocals;
    const live=!plain(setOf('vocals'))&&j&&j.state==='done'&&V.ab.vocals!=='orig';voc.web=live?j.url:voc.web0;voc.peaks=live&&j.peaks?j.peaks:voc.peaks0}
  for(const t of V.takes){
    const j=V.jobs[t.id],base=V.jobs[t.id+':base'],use=j&&j.state==='done'&&V.ab[t.id]!=='orig'?j:base&&base.state==='done'?base:null;
    S.srcRow[t.name]='orig';
    r.stems.push({name:t.name,kind:'take',web:use?use.url:null,peaks:use?use.peaks:[],tag:{label:`your voice · from ${fmt(t.at)}`}});
  }
  if(V.rec)S.srcRow.recording='orig';
  if(V.rec)r.stems.push({name:'recording',kind:'take',web:null,peaks:V.rec.peaks,tag:{label:'REC'}});
}
function refresh(){inject();mixSig='';renderMixer();ensureLoads()}

const _onReport=onReport;onReport=function(){if(S.slug!==V.slug){if(V.rec)stopRec(V.slug);V.slug=S.slug;V.jobs={};V.takes=[];loadSet();loadTakes()}inject();_onReport()};
const _renderMixer=renderMixer;renderMixer=function(){_renderMixer();decorate()};

function decorate(){
  document.querySelectorAll('#rows .row').forEach(el=>{
    const id=idOf(el.dataset.n);if(!id||el.querySelector('.vt'))return;
    const b=document.createElement('button');b.className='vt';b.dataset.id=id;
    b.onclick=ev=>{ev.stopPropagation();openMenu(b,id)};
    el.querySelector('.ms').prepend(b);
    if(id==='vocals')return;
    const x=el.querySelector('.xdl');
    if(x){x.title='Download this take as you hear it now (MP3)';x.onclick=ev=>{ev.stopPropagation();downloadTake(id)}}
    const d=document.createElement('button');d.className='xdl vdel';d.textContent='×';d.title='Delete this take';
    d.onclick=ev=>{ev.stopPropagation();delTake(id)};
    el.querySelector('.lab').appendChild(d);
  });
  syncButtons();
}
function label(id){
  const s=setOf(id),j=V.jobs[id];
  if(j&&j.state==='busy')return`${j.pct||0}%`;
  if(j&&j.state==='fail')return'TUNE!';
  return'TUNE';
}
function syncButtons(){
  document.querySelectorAll('.vt').forEach(b=>{const id=b.dataset.id,j=V.jobs[id];b.textContent=label(id);
    b.classList.toggle('busy',!!j&&j.state==='busy');b.classList.toggle('on',!plain(setOf(id))&&!!j&&j.state==='done');
    b.title='Auto-tune and effects for this row'+(j&&j.error?` - ${j.error}`:'')});
  document.querySelectorAll('#rows .row').forEach(el=>{
    const id=idOf(el.dataset.n);if(!id)return;
    const j=V.jobs[id],s=setOf(id),busy=!!j&&j.state==='busy',on=!plain(s)&&!!j&&j.state==='done'&&V.ab[id]!=='orig';
    el.classList.toggle('vbusy',busy);el.classList.toggle('vtuned',on);
    const wv=el.querySelector('.wv');let pr=wv.querySelector('.vprog');
    if(busy){if(!pr){pr=document.createElement('div');pr.className='vprog';pr.innerHTML='<b></b>';wv.appendChild(pr)}
      pr.style.width=Math.max(3,j.pct||0)+'%';pr.firstChild.textContent=`Tuning ${desc(s)} · ${j.pct||0}%`}
    else if(pr)pr.remove();
    const sub=el.querySelector('.lab i');if(!sub)return;
    if(!sub.dataset.t)sub.dataset.t=sub.textContent;
    sub.textContent=busy?`tuning ${j.pct||0}% · ${desc(s)}`:on?`${desc(s)}${offBy(s,j)?' · '+offBy(s,j):''}`:j&&j.state==='fail'?'tune failed - see TUNE':sub.dataset.t;
  });
  if(menu.dataset.id&&!(menu.contains(document.activeElement)&&document.activeElement.type==='range'))fillMenu(menu.dataset.id);
}
const desc=s=>{const p=presetOf(s);return[p==='off'?'':p==='custom'?(s.str?`Custom ${s.str}%`:''):MODES.find(m=>m[0]===p)[1],s.fmt?`Voice ${s.fmt>0?'+':''}${s.fmt}`:'',
  s.fx!=='dry'?FX.find(f=>f[0]===s.fx)[1]+(s.mix<100?` ${s.mix}%`:''):''].filter(Boolean).join(' + ')||'as sung'};
const offBy=(s,j)=>s.str>0&&j&&j.cents_after!=null?`♪ off-key ${Math.round(j.cents_before)} → ${Math.round(j.cents_after)}`:'';
const gauge=j=>{const w=c=>Math.min(100,c/50*100).toFixed(0);return`<div class="gz" title="How far the voice sits from the right note, typically. 100 = one whole piano key, 0 = dead on"><div class="gh">♪ How far off the note <em>0 = dead on · 100 = one piano key</em></div>${[['Before',j.cents_before,'b'],['After',j.cents_after,'a']].map(([l,c,k])=>`<div class="gr ${k}"><span>${l}</span><i><b style="width:${w(c)}%"></b></i><em>${Math.round(c)}</em></div>`).join('')}</div>`};

function openMenu(btn,id){
  if(menu.dataset.id===id&&menu.style.display==='block')return closeMenu();
  menu.dataset.id=id;fillMenu(id);menu.style.display='block';
  const b=btn.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(b.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8))+'px';
  menu.style.top=(b.bottom+menu.offsetHeight+6>innerHeight?b.top-menu.offsetHeight-6:b.bottom+6)+'px';
}
function fillMenu(id){
  const s=setOf(id),j=V.jobs[id],r=rep().harmony||{},pre=presetOf(s);
  const row=(k,lbl,list,cur)=>`<div class="xr"><span>${lbl}</span>${list.map(([v,l,t])=>`<button data-k="${k}" data-v="${v}" title="${t}" class="${cur===v?'on':''}">${l}</button>`).join('')}</div>`;
  const busy=j&&j.state==='busy',done=j&&j.state==='done'&&!plain(s);
  const st=busy?'<span class="st busy">WORKING</span>':done&&V.ab[id]!=='orig'?'<span class="st on">ON</span>':'<span class="st off">OFF</span>';
  let info=`Tune snaps to <b>${r.key||'?'} ${r.mode||''}</b> and the chord playing at each moment.`;
  if(busy)info=`Applying <b>${desc(s)}</b> · <b>${j.pct||0}%</b>. The original keeps playing until it is ready.`;
  else if(done)info=`Applied: <b>${desc(s)}</b>`;
  else if(j&&j.state==='fail')info=`Failed: ${j.error||'unknown'}`;
  const ab=done?`<div class="ab"><button data-ab="orig" class="${V.ab[id]==='orig'?'on':''}">Hear original</button><button data-ab="tuned" class="${V.ab[id]!=='orig'?'on':''}">Hear tuned</button></div>`:'';
  const knobs=KNOBS.map(([k,l,u,lo,hi,st,t])=>`<label class="kn${k==='mix'&&s.fx==='dry'?' dim':''}" title="${t}"><span>${l}</span><input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${st}" value="${s[k]}"><em>${k==='fmt'&&s[k]>0?'+':''}${s[k]}${u}</em></label>`).join('');
  menu.innerHTML=`<h6>Auto-tune · ${nameOf(id)}${st}</h6>${row('preset','Tune',MODES,pre)}${row('fx','FX',FX,s.fx)}<button class="kh">${V.adv?'▾':'▸'} Advanced${pre==='custom'?' · custom':''}</button>${V.adv?knobs:''}${busy?`<div class="bar"><i style="width:${j.pct||0}%"></i></div>`:''}<p>${info}</p>${done&&offBy(s,j)?gauge(j):''}${ab}`;
  menu.querySelector('.kh').onclick=()=>{V.adv=!V.adv;fillMenu(id)};
  menu.querySelectorAll('.ab button').forEach(b=>b.onclick=()=>{V.ab[id]=b.dataset.ab;refresh();syncButtons()});
  const apply=patch=>{V.set[id]={...setOf(id),...patch};saveSet();V.ab[id]='tuned';render(id)};
  menu.querySelectorAll('.xr button').forEach(b=>b.onclick=()=>apply(b.dataset.k==='preset'?PRESETS[b.dataset.v]:{fx:b.dataset.v}));
  menu.querySelectorAll('.kn input').forEach(inp=>{
    const k=inp.dataset.k,u=KNOBS.find(x=>x[0]===k)[2];
    inp.oninput=()=>{inp.nextElementSibling.textContent=(k==='fmt'&&+inp.value>0?'+':'')+inp.value+u};
    inp.onchange=()=>{inp.blur();apply({[k]:+inp.value})};
  });
}

async function render(id,key=id,want=setOf(id)){
  if(id==='vocals'&&plain(want)){delete V.jobs.vocals;refresh();syncButtons();return}
  V.jobs[key]={state:'busy',pct:0,want};syncButtons();
  for(;;){
    let j;try{j=await fetch(`/api/voice/render?slug=${V.slug}&track=${id}&${query(want)}`).then(r=>r.json())}catch(e){j={state:'fail',error:e.message}}
    if(j.error&&!j.state)j={state:'fail',error:j.error};
    const cur=V.jobs[key];if(!cur||cur.want!==want)return;
    V.jobs[key]={...j,want};syncButtons();
    if(j.state!=='busy'){if(j.state==='done'){refresh();if(key===id&&!plain(want))toast(`${nameOf(id)}: ${desc(want)} is on${offBy(want,j)?' - '+offBy(want,j):''}`,4000)}return}
    await new Promise(r=>setTimeout(r,700));
  }
}

async function loadTakes(){
  const slug=V.slug;
  const t=await fetch(`/api/voice/takes?slug=${slug}`).then(r=>r.json()).catch(()=>[]);
  if(slug!==V.slug)return;
  V.takes=Array.isArray(t)?t:[];
  for(const tk of V.takes){render(tk.id,tk.id+':base',{...DEF});if(!plain(setOf(tk.id)))render(tk.id)}
  if(!plain(setOf('vocals')))render('vocals');
  refresh();
}
function downloadTake(id){
  const j=V.jobs[id],base=V.jobs[id+':base'],use=j&&j.state==='done'&&V.ab[id]!=='orig'?j:base;
  if(!use||use.state!=='done')return toast('Still getting this take ready',2500);
  const a=document.createElement('a');a.href=use.url;a.download=`${nameOf(id)} - ${desc(use===j?setOf(id):{mode:'off',fx:'dry'})}.mp3`;a.click();
}
async function delTake(id){
  closeMenu();toast(`${nameOf(id)} deleted`,2500);await fetch(`/api/voice/delete?slug=${V.slug}&id=${id}`,{method:'POST'});
  delete V.set[id];saveSet();loadTakes();
}

const WORKLET=`class Grab extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage({t:currentTime,d:c.slice(0)});return true}}registerProcessor('grab',Grab)`;
const recb=document.getElementById('recb');
recb.onclick=()=>V.rec?stopRec():startRec();
document.addEventListener('keydown',e=>{if(e.code==='KeyR'&&!e.metaKey&&!e.ctrlKey&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)){e.preventDefault();V.rec?stopRec():startRec()}});
async function startRec(){
  if(!S.slug||!S.report){toast('Open a song that has finished loading first',3000,'bad');return}
  ensureCtx();if(A.ctx.state==='suspended')await A.ctx.resume();
  let stream;
  if(!navigator.mediaDevices?.getUserMedia){toast('This browser cannot use a microphone here',4000,'bad');return}
  const raw={echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1};
  try{stream=await navigator.mediaDevices.getUserMedia({audio:micId()&&micId()!=='default'?{...raw,deviceId:{exact:micId()}}:raw})}
  catch(e){
    if(e.name==='OverconstrainedError'||e.name==='NotFoundError'){try{localStorage.removeItem('sr-mic')}catch(_){}try{stream=await navigator.mediaDevices.getUserMedia({audio:raw})}catch(e2){e=e2}}
    if(!stream){toast(e.name==='NotAllowedError'?'Mic is blocked. Allow it in the address bar, then press Record again':'No mic: '+e.message,5000,'bad');return}
  }
  if(!V.worklet){await A.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET],{type:'text/javascript'})));V.worklet=true}
  const src=A.ctx.createMediaStreamSource(stream),node=new AudioWorkletNode(A.ctx,'grab'),sink=A.ctx.createGain();
  sink.gain.value=0;src.connect(node);node.connect(sink);sink.connect(A.ctx.destination);
  const lat=(A.ctx.outputLatency||0)+(A.ctx.baseLatency||0)+(stream.getAudioTracks()[0].getSettings().latency||0);
  const rec={stream,src,node,sink,chunks:[],t0:null,lat,peaks:new Array(PEAKS).fill(0)};
  node.port.onmessage=e=>{
    if(rec.t0===null)rec.t0=e.data.t;rec.chunks.push(e.data.d);
    const songT=rec.songO0+(e.data.t-rec.songT0)-lat,i=Math.floor(songT/(dur()||1)*PEAKS);
    if(i<0||i>=PEAKS)return;
    let m=0;for(const x of e.data.d){const a=x<0?-x:x;if(a>m)m=a}
    rec.peaks[i]=Math.max(rec.peaks[i],Math.min(1,m*2.5));
  };
  V.rec=rec;recb.classList.add('on');
  const p=curPos();start(dur()&&p>=dur()-0.5?0:p);
  rec.songT0=A.t0;rec.songO0=A.o0;
  refresh();
  document.body.classList.add('vrec');
  rec.iv=setInterval(()=>{
    const secs=rec.chunks.length*128/A.ctx.sampleRate,d=dur()||1;
    recb.querySelector('span').textContent='Stop '+fmt(secs);
    drawWaves();
    const el=document.querySelector('#rows .row[data-n="recording"]');if(!el)return;
    const wv=el.querySelector('.wv');let band=wv.querySelector('.vband');
    if(!band){band=document.createElement('div');band.className='vband';wv.prepend(band)}
    const a=Math.max(0,rec.songO0-rec.lat)/d*100,b=Math.min(100,curPos()/d*100);
    band.style.left=a+'%';band.style.width=Math.max(0,b-a)+'%';
    el.querySelector('.lab i').textContent=`REC ${fmt(secs)} · from ${fmt(rec.songO0)}`;
  },100);
}
const _drawWaves=drawWaves;
drawWaves=function(){_drawWaves();if(V.rec)drawRec(document.querySelector('#rows .row[data-n="recording"] canvas'),V.rec.peaks)};
function drawRec(c,peaks){
  if(!c)return;const {g,w,h}=fit(c),mid=h/2,L=peaks.length;
  g.clearRect(0,0,w,h);
  const bars=[];
  for(let x=0;x<w;x+=2){const a=Math.floor(x/w*L),b=Math.max(a+1,Math.floor((x+2)/w*L));let m=0;for(let i=a;i<b&&i<L;i++)if(peaks[i]>m)m=peaks[i];if(m>0.01)bars.push([x,Math.max(2,m*(h-4))])}
  g.shadowColor='#ff3b5c';g.shadowBlur=16;g.fillStyle='#ff3b5c';
  for(const[x,hh]of bars)g.fillRect(x,mid-hh/2,2,hh);
  g.shadowBlur=6;g.shadowColor='#ffd0d8';g.fillStyle='#fff';
  for(const[x,hh]of bars)g.fillRect(x+0.5,mid-hh*0.36,1,hh*0.72);
  g.shadowBlur=0;
}
function wav(chunks,sr){
  const n=chunks.reduce((a,c)=>a+c.length,0),b=new DataView(new ArrayBuffer(44+n*2));
  const w=(o,s)=>[...s].forEach((c,i)=>b.setUint8(o+i,c.charCodeAt(0)));
  w(0,'RIFF');b.setUint32(4,36+n*2,true);w(8,'WAVE');w(12,'fmt ');b.setUint32(16,16,true);b.setUint16(20,1,true);b.setUint16(22,1,true);
  b.setUint32(24,sr,true);b.setUint32(28,sr*2,true);b.setUint16(32,2,true);b.setUint16(34,16,true);w(36,'data');b.setUint32(40,n*2,true);
  let o=44;for(const c of chunks)for(const x of c){b.setInt16(o,Math.max(-1,Math.min(1,x))*32767,true);o+=2}
  return b.buffer;
}
async function stopRec(slug=V.slug){
  const rec=V.rec;if(!rec)return;
  V.rec=null;clearInterval(rec.iv);document.body.classList.remove('vrec');
  rec.node.port.onmessage=null;rec.src.disconnect();rec.node.disconnect();rec.sink.disconnect();
  rec.stream.getTracks().forEach(t=>t.stop());
  recb.classList.remove('on');recb.querySelector('span').textContent='Record';
  refresh();
  if(!rec.chunks.length||rec.t0===null){toast('Nothing came in from the mic',3000,'bad');return}
  const at=Math.max(0,rec.songO0+(rec.t0-rec.songT0)-rec.lat);
  const j=await fetch(`/api/voice/take?slug=${slug}&at=${at.toFixed(3)}`,{method:'POST',body:wav(rec.chunks,A.ctx.sampleRate)}).then(r=>r.json()).catch(e=>({error:e.message}));
  if(j.error){toast('Could not save the take: '+j.error,5000,'bad');return}
  toast(`Saved as ${j.name} - hover its row and press TUNE`,3500);
  if(slug===V.slug)await loadTakes();
}
window.VOICE=V;
})();
