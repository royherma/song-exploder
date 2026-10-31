(()=>{
const SORTS={recent:'Newest',name:'A-Z',grade:'Best grade'};
const P={open:false,q:'',sort:'recent',hi:0,rows:[]};
try{P.sort=localStorage.getItem('sr-song-sort')||'recent'}catch(e){}
if(!SORTS[P.sort])P.sort='recent';

const tidy=t=>String(t||'').replace(/^y2mate\.is\s*-\s*/i,'').replace(/\s*[\[(][^\])]*(official|video|audio|lyrics|hd|visualizer|dirty|remaster)[^\])]*[\])]/gi,'').replace(/\s+/g,' ').trim();
function names(s){
  const t=tidy(s.title),i=t.indexOf(' - ');
  if(i>0)return{name:t.slice(i+3),by:t.slice(0,i)};
  return{name:t||s.slug,by:s.author?tidy(s.author).replace(/\s*-\s*topic$/i,''):''};
}
const hue=s=>[...s].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7)%360;
function cover(s,n){
  const img=s.thumb||s.poster;
  if(img)return`<span class="sp-cv"><img src="${esc(img)}" alt="" loading="lazy"></span>`;
  const h=hue(s.slug);
  return`<span class="sp-cv sp-gen" style="background:linear-gradient(135deg,hsl(${h} 70% 42%),hsl(${(h+60)%360} 65% 22%))">${esc((n.name.match(/\p{L}|\d/u)||['?'])[0].toUpperCase())}</span>`;
}
const runsOf=s=>(s.runs||[]).filter(r=>/^r\d{8}-/.test(r));
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function ago(ms){
  if(!ms)return'';
  const d=new Date(ms),now=new Date(),day=86400000;
  const days=Math.floor((new Date(now.getFullYear(),now.getMonth(),now.getDate())-new Date(d.getFullYear(),d.getMonth(),d.getDate()))/day);
  if(days<=0)return'Today';if(days===1)return'Yesterday';if(days<7)return days+' days ago';
  return`${MON[d.getMonth()]} ${d.getDate()}`;
}
const gradeCls=g=>g==null?'':g>=80?'good':g>=65?'ok':'low';

function sorted(){
  const q=P.q.trim().toLowerCase();
  const list=S.songs.map(s=>({s,n:names(s)})).filter(({s,n})=>!q||(n.name+' '+n.by+' '+s.slug).toLowerCase().includes(q));
  const by={recent:(a,b)=>(b.s.added||0)-(a.s.added||0),name:(a,b)=>a.n.name.localeCompare(b.n.name),grade:(a,b)=>(b.s.best??-1)-(a.s.best??-1)}[P.sort];
  return list.sort(by);
}

function renderBtn(){
  const b=$('#songbtn');if(!b)return;
  const s=curSong();
  if(!s){b.innerHTML=`<span class="sp-cv sp-gen">+</span><span class="sp-tx"><b>${S.songs.length?'Pick a song':'No songs yet'}</b></span>`;return}
  const n=names(s);
  b.innerHTML=`${cover(s,n)}<span class="sp-tx"><b>${esc(n.name)}</b><small>${esc(n.by||'')}</small></span><svg class="sp-chev" viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  b.title=`${n.by?n.by+' - ':''}${n.name}`;
}

function renderList(){
  const box=$('#sp-list');if(!box)return;
  P.rows=sorted();
  P.hi=Math.max(0,Math.min(P.hi,P.rows.length-1));
  $('#sp-sort').innerHTML=Object.entries(SORTS).map(([k,v])=>`<button data-k="${k}" class="${k===P.sort?'on':''}">${v}</button>`).join('');
  $('#sp-n').textContent=`${P.rows.length} song${P.rows.length===1?'':'s'}`;
  box.innerHTML=P.rows.length?P.rows.map(({s,n},i)=>{
    const runs=runsOf(s).length,g=s.best;
    return`<div class="sp-row${s.slug===S.slug?' cur':''}${i===P.hi?' hi':''}" data-i="${i}">${cover(s,n)}
      <span class="sp-tx"><b>${esc(n.name)}</b><small>${esc(n.by||' ')}</small></span>
      <span class="sp-meta"><em class="sp-g ${gradeCls(g)}">${g==null?'-':g.toFixed(1)}</em><small>${ago(s.added)} · ${runs} run${runs===1?'':'s'}${s.running?' · <i>live</i>':''}</small></span></div>`;
  }).join(''):`<div class="sp-empty">No song matches "${esc(P.q)}"</div>`;
  const h=box.querySelector('.hi');if(h)h.scrollIntoView({block:'nearest'});
}

function pick(i){
  const r=P.rows[i];if(!r)return;
  close();
  if(r.s.slug===S.slug)return;
  const sel=$('#song');sel.value=r.s.slug;sel.dispatchEvent(new Event('change'));
}
function open(){
  P.open=true;P.q='';
  P.hi=0;$('#songpop').classList.add('on');$('#songbtn').classList.add('on');
  $('#sp-q').value='';renderList();
  const ci=P.rows.findIndex(r=>r.s.slug===S.slug);if(ci>=0){P.hi=ci;renderList()}
  $('#sp-q').focus();
}
function close(){P.open=false;$('#songpop').classList.remove('on');$('#songbtn').classList.remove('on')}

function init(){
  const b=$('#songbtn'),pop=$('#songpop');
  b.onclick=e=>{e.stopPropagation();P.open?close():open()};
  pop.onclick=e=>e.stopPropagation();
  document.addEventListener('click',()=>{if(P.open)close()});
  $('#sp-q').oninput=e=>{P.q=e.target.value;P.hi=0;renderList()};
  $('#sp-q').onkeydown=e=>{
    if(e.key==='ArrowDown'){e.preventDefault();P.hi=Math.min(P.rows.length-1,P.hi+1);renderList()}
    else if(e.key==='ArrowUp'){e.preventDefault();P.hi=Math.max(0,P.hi-1);renderList()}
    else if(e.key==='Enter'){e.preventDefault();pick(P.hi)}
    else if(e.key==='Escape'){e.preventDefault();close();b.focus()}
  };
  $('#sp-sort').onclick=e=>{const k=e.target.dataset.k;if(!k)return;P.sort=k;P.hi=0;try{localStorage.setItem('sr-song-sort',k)}catch(x){}renderList();$('#sp-q').focus()};
  $('#sp-list').onclick=e=>{const r=e.target.closest('.sp-row');if(r)pick(+r.dataset.i)};
  $('#sp-list').onmousemove=e=>{const r=e.target.closest('.sp-row');if(r&&+r.dataset.i!==P.hi){P.hi=+r.dataset.i;box().forEach(x=>x.classList.toggle('hi',+x.dataset.i===P.hi))}};
  renderBtn();
}
const box=()=>[...document.querySelectorAll('#sp-list .sp-row')];

window.SongPick={render(){renderBtn();if(P.open)renderList()}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
