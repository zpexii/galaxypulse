// GalaxyPulse 前端逻辑
const API = '/api';
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let motionPreference = 'system';
try{ motionPreference = localStorage.getItem('gp-motion') || 'system'; }catch(e){}
function reducedMotion(){ return motionPreference === 'reduce' || motionQuery.matches; }
function syncMotion(){
  document.documentElement.classList.toggle('reduce-motion', reducedMotion());
  const button = document.getElementById('motionBtn');
  if(button){ button.textContent = motionPreference === 'reduce' ? '动效：简化' : '动效：跟随系统'; button.setAttribute('aria-pressed', String(motionPreference === 'reduce')); }
  document.getElementById('heroCard')?.style.removeProperty('transform');
  document.querySelector('.hero-glow')?.style.removeProperty('transform');
}
motionQuery.addEventListener('change', syncMotion);
syncMotion();
document.getElementById('motionBtn')?.addEventListener('click', ()=>{
  motionPreference = motionPreference === 'reduce' ? 'system' : 'reduce';
  try{ localStorage.setItem('gp-motion', motionPreference); }catch(e){}
  syncMotion();
});

let activeDialog = null;
function enterDialog(sheet, close, trigger = document.activeElement){
  activeDialog = {sheet, close, trigger};
  document.getElementById('app').inert = true;
  sheet.tabIndex = -1;
  (sheet.querySelector('button') || sheet).focus({preventScroll:true});
}
function leaveDialog(sheet){
  if(activeDialog?.sheet !== sheet) return;
  const trigger = activeDialog.trigger;
  activeDialog = null;
  document.getElementById('app').inert = false;
  document.body.classList.remove('sheet-open');
  const target = trigger?.isConnected ? trigger : document.getElementById('refreshBtn');
  target?.focus({preventScroll:true});
}
document.addEventListener('keydown', e=>{
  if(!activeDialog) return;
  if(e.key === 'Escape'){ e.preventDefault(); activeDialog.close(); return; }
  if(e.key !== 'Tab') return;
  const nodes = [...activeDialog.sheet.querySelectorAll('button:not(:disabled), input:not(:disabled), select, [tabindex="0"], a[href]')].filter(n=>n.getClientRects().length);
  const first = nodes[0], last = nodes[nodes.length-1];
  if(!first){ e.preventDefault(); activeDialog.sheet.focus(); }
  else if(e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))){ e.preventDefault(); first.focus(); }
});

// ---------- 主题调色板 (Canvas 实时读取 CSS 令牌) ----------
const THEMES = [
  { id: 'midnight', name: '午夜星河', sw: ['#7c6cff', '#22d3ee', '#34d399'] },
  { id: 'ocean',    name: '深海蓝',   sw: ['#0a84ff', '#64d2ff', '#30d158'] },
  { id: 'titanium', name: '钛金',     sw: ['#d6b27c', '#9fa6b2', '#30d158'] },
  { id: 'dusk',     name: '暮色粉',   sw: ['#f26d9c', '#b07cff', '#30d158'] },
  { id: 'light',    name: '晨光',     sw: ['#0071e3', '#5e5ce6', '#1d8f4f'] },
];
const P = {};
function hexToRgb(h){ h = (h||'').trim(); if(/^#/.test(h)){ h = h.slice(1); if(h.length===3) h = h.split('').map(c=>c+c).join(''); const n = parseInt(h,16); return [(n>>16)&255,(n>>8)&255,n&255]; } const m = h.match(/\d+(\.\d+)?/g); return m ? m.slice(0,3).map(x=>Math.round(+x)) : [0,0,0]; }
function rgbaRGB(rgb,a){ return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`; }
function refreshPalette(){
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  P.up = v('--up'); P.down = v('--down'); P.accent = v('--accent'); P.accent2 = v('--accent2');
  P.upGlow = v('--up-glow'); P.downGlow = v('--down-glow');
  P.upRGB = v('--up-rgb').split(',').map(Number);
  P.downRGB = v('--down-rgb').split(',').map(Number);
  P.accentRGB = v('--accent-rgb').split(',').map(Number);
  P.accent2RGB = v('--accent2-rgb').split(',').map(Number);
  P.textRGB = hexToRgb(v('--text'));
  P.dimRGB = v('--text-dim-rgb').split(',').map(Number);
  P.grid = v('--chart-grid');
  P.candleEdge = v('--candle-edge');
  P.tipBg = v('--tip-bg'); P.tipText = v('--tip-text'); P.tipTextRGB = hexToRgb(v('--tip-text'));
}
refreshPalette();

// 切换主题 + 持久化 + 全画布重绘
function applyTheme(id, {silent=false} = {}){
  const t = THEMES.find(x=>x.id===id) ? id : 'midnight';
  if(t === 'midnight') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try{ localStorage.setItem('gp-theme', t); }catch(e){}
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim());
  refreshPalette();
  repaintAllCanvases();
  if(!silent) toast(`已切换至「${THEMES.find(x=>x.id===t).name}」`);
}
function repaintAllCanvases(){
  repaintAllMinis();
  if(state.quote?.hero) drawSpark(state.quote.hero.spark);
  // 历史大图
  if(hist && hist.data && hist.data.ok){
    try{ drawHistFrame(hist.data, 1, hist._selView || null); }catch(e){}
  }
}

const state = {
  mode: 'live',
  quote: null,      // 最新行情总量
  replay: null,     // 复盘数据
  polling: null,
  hasPainted: false, // 首次渲染完成标记 (控制入场 stagger)
};

const el = {
  clock: document.getElementById('clock'),
  marketStatus: document.getElementById('marketStatus'),
  refreshBtn: document.getElementById('refreshBtn'),
  heroHist: document.getElementById('heroHist'),
  heroPrice: document.getElementById('heroPrice'),
  heroChange: document.getElementById('heroChange'),
  heroIndex: document.getElementById('heroIndex'),
  kpis: document.getElementById('kpis'),
  stockGrid: document.getElementById('stockGrid'),
  aShareGrid: document.getElementById('aShareGrid'),
  fundGrid: document.getElementById('fundGrid'),
  macroGrid: document.getElementById('macroGrid'),
  etfTime: document.getElementById('etfUpdateTime'),
  aShareTime: document.getElementById('aShareUpdateTime'),
  fundTime: document.getElementById('fundUpdateTime'),
  macroTime: document.getElementById('macroUpdateTime'),
  replayView: document.getElementById('replayView'),
  replayDate: document.getElementById('replayDate'),
  replayContent: document.getElementById('replayContent'),
  liveBadge: document.getElementById('liveBadge'),
};

// ---------- 时钟与市场状态 ----------
function tick() {
  const now = new Date();
  el.clock.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  // 美东时间
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false }));
  const day = est.getDay();
  const hh = est.getHours(), mm = est.getMinutes();
  const t = hh * 60 + mm;
  const isWeekend = (day === 0 || day === 6);
  const open = !isWeekend && (t >= 570 && t < 960); // 9:30-16:00 ET
  el.marketStatus.classList.toggle('open', open);
  el.marketStatus.classList.toggle('closed', !open && !isWeekend);
  el.marketStatus.classList.toggle('weekend', isWeekend);
  el.marketStatus.lastElementChild.textContent = open ? '美盘已开盘' : (isWeekend ? '周末休市' : '美盘未开');

  // 太阳/月亮图标 — 跟随美东时间日夜轮转
  const celestial = document.getElementById('celestialIcon');
  if (celestial) {
    const isDaytime = hh >= 6 && hh < 18;
    celestial.classList.toggle('moon', !isDaytime);
  }
}
setInterval(tick, 1000); tick();

// ---------- Hero 鼠标视差微动 ----------
const heroCard = document.getElementById('heroCard');
if (heroCard) {
  const glow = heroCard.querySelector('.hero-glow');
  let raf = null;
  heroCard.addEventListener('mousemove', (e) => {
    if(reducedMotion() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const rect = heroCard.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / rect.width;   // -0.5 ~ 0.5
    const dy = (e.clientY - cy) / rect.height;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      // max ±1deg rotateX/Y
      heroCard.style.transform = `perspective(900px) rotateY(${dx * 1.2}deg) rotateX(${-dy * 1.2}deg)`;
      if (glow) glow.style.transform = `translate3d(${dx * 14}px, ${dy * 14}px, 0)`;
    });
  });
  heroCard.addEventListener('mouseleave', () => {
    if (raf) cancelAnimationFrame(raf);
    heroCard.style.transform = '';
    if (glow) glow.style.transform = '';
  });
}

// ---------- 工具 ----------
const fmt = (v, d=2) => v==null ? '--' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
function fmtBp(n){ return ((n)*100).toFixed(2); }
function cls(v){ return v>0?'up':(v<0?'down':''); }
function sign(n){ return n>0?'+':''; }
function toast(msg){
  let t=document.getElementById('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; document.body.appendChild(t); }
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'), 2600);
}

// ---------- 数字滚动 tween + 微光脉冲 ----------
function tweenNumber(elm, from, to, dec=2, dur=520){
  if(elm._tw) cancelAnimationFrame(elm._tw);
  if(reducedMotion() || !isFinite(from) || !isFinite(to) || from===to){ elm.textContent = fmt(to, dec); return; }
  const t0 = performance.now();
  const step = (t)=>{
    const p = Math.min(1, (t-t0)/dur);
    const e = 1-Math.pow(1-p,3);
    elm.textContent = fmt(from+(to-from)*e, dec);
    if(p<1) elm._tw = requestAnimationFrame(step); else elm._tw = null;
  };
  elm._tw = requestAnimationFrame(step);
}
function pulseNum(elm, up){
  elm.classList.remove('tick-up','tick-down');
  void elm.offsetWidth;
  elm.classList.add(up?'tick-up':'tick-down');
}

// ---------- 渲染: KPI (增量更新, 不重建 DOM) ----------
function renderKpis(q){
  const tpl=document.getElementById('kpiTpl');
  [...el.kpis.children].forEach(c=>{ if(!c._key) c.remove(); });  // 清骨架屏
  const old = new Map([...el.kpis.children].map(c=>[c._key, c]));
  const keep = new Set();
  (q.kpis||[]).forEach((k, idx)=>{
    const key = k.name;
    let card = old.get(key);
    if(card){
      keep.add(key);
      card.classList.toggle('up', (k.changePct||0)>0);
      card.classList.toggle('down', (k.changePct||0)<0);
      card.querySelector('.kpi-tag').textContent=k.tag||'';
      const vEl=card.querySelector('.kpi-val');
      const oldV=parseFloat(vEl.dataset.v||'NaN');
      if(k.value!=null){
        vEl.dataset.v=k.value;
        if(isFinite(oldV)&&oldV!==k.value){ tweenNumber(vEl, oldV, k.value, k.decimals||2); pulseNum(vEl, k.value>oldV); }
        else vEl.textContent=fmt(k.value, k.decimals||2);
      }
      const d=card.querySelector('.kpi-delta');
      d.textContent=(k.changePct!=null? (k.changePct>0?'+':'')+k.changePct.toFixed(2)+'%':'');
      d.className='kpi-delta '+cls(k.changePct);
      el.kpis.appendChild(card);
      return;
    }
    const node=tpl.content.cloneNode(true);
    const nc=node.querySelector('.kpi-card');
    nc._key=key;
    nc.classList.add(cls(k.changePct));
    node.querySelector('.kpi-name').textContent=k.name;
    node.querySelector('.kpi-tag').textContent=k.tag||'';
    const vEl=node.querySelector('.kpi-val');
    vEl.textContent=fmt(k.value,k.decimals||2);
    vEl.dataset.v=k.value??'';
    const d=node.querySelector('.kpi-delta');
    d.textContent= (k.changePct!=null? (k.changePct>0?'+':'')+k.changePct.toFixed(2)+'%':'');
    d.classList.add(cls(k.changePct));
    if(!state.hasPainted){ nc.classList.add('card-in'); nc.style.animationDelay=(idx*45)+'ms'; }
    el.kpis.appendChild(node);
  });
  old.forEach((c,key)=>{ if(!keep.has(key)) c.remove(); });
}

// ---------- 渲染: 取不到行情的自选 (以占位卡明示, 避免静默消失) ----------
function renderGhostCards(grid, tpl, items, old, keep, kind){
  if(!grid || !items || !items.length) return;
  const sel = kind === 'macro'
    ? { card:'.macro-card', name:'.mc-name', sym:'.mc-symbol', price:'.mc-price', delta:'.mc-delta' }
    : { card:'.stock-card', name:'.stock-name', sym:'.stock-symbol', price:'.stock-price', delta:'.stock-change' };
  items.forEach(u=>{
    const key = 'GHOST:' + (u.sec||'') + ':' + u.symbol;
    const card = old.get(key);
    if(card){ keep.add(key); grid.appendChild(card); return; }
    const node = tpl.content.cloneNode(true);
    const nc = node.querySelector(sel.card);
    nc._key = key;
    nc.classList.add('ghost-card');
    nc.dataset.symbol = u.symbol;
    nc.dataset.sec = u.sec || '';
    nc.title = u.symbol + ' 暂无行情数据，可移除后重新添加';
    nc.querySelector(sel.name).textContent = u.symbol;
    nc.querySelector(sel.sym).textContent = u.reason || '暂无行情';
    const p = nc.querySelector(sel.price);
    p.textContent = '—'; p.dataset.v = '';
    nc.querySelector(sel.delta).textContent = '';
    if(kind === 'macro'){
      nc.querySelector('.mc-icon').textContent = '⚠';
    } else {
      nc.querySelector('.stock-badge').hidden = true;
      nc.querySelector('.stock-vol').textContent = '';
      nc.querySelector('.mini-bar').style.setProperty('--w', '0%');
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'ghost-rm';
    rm.title = '从看板移除';
    rm.setAttribute('aria-label', '移除 ' + u.symbol);
    rm.textContent = '移除';
    rm.addEventListener('click', ev=>{ ev.stopPropagation(); cfgRemove(u.sec, u.symbol); });
    nc.appendChild(rm);
    grid.appendChild(nc);
    keep.add(key);
  });
}
function renderStocks(q){
  const tpl=document.getElementById('stockTpl');
  [...el.stockGrid.children].forEach(c=>{ if(!c._key) c.remove(); });
  const old = new Map([...el.stockGrid.children].map(c=>[c._key, c]));
  const keep = new Set();
  (q.etfs||[]).forEach((s, idx)=>{
    const key = s.symbol;
    const barW = s.changePct!=null?Math.min(100, Math.abs(s.changePct)*2):0;
    const barC = s.changePct>0?'var(--up)':(s.changePct<0?'var(--down)':'var(--accent)');
    const changeTxt = `${sign(s.changePct)}${s.changePct!=null?s.changePct.toFixed(2):'--'}%  (${sign(s.change)}${fmt(s.change)})`;
    let card = old.get(key);
    if(card){
      keep.add(key);
      const p=card.querySelector('.stock-price');
      const oldV=parseFloat(p.dataset.v||'NaN');
      if(s.price!=null){
        p.dataset.v=s.price;
        if(isFinite(oldV)&&oldV!==s.price){ tweenNumber(p, oldV, s.price, 2); pulseNum(p, s.price>oldV); }
        else p.textContent=fmt(s.price);
      }
      p.className='stock-price '+cls(s.changePct);
      const c=card.querySelector('.stock-change');
      c.textContent=changeTxt; c.className='stock-change '+cls(s.changePct);
      card.querySelector('.stock-vol').textContent=s.volumeText||'';
      const bar=card.querySelector('.mini-bar');
      bar.style.setProperty('--w', barW+'%');
      bar.style.setProperty('--bar-c', barC);
      el.stockGrid.appendChild(card);
      return;
    }
    const node=tpl.content.cloneNode(true);
    const nc=node.querySelector('.stock-card');
    nc._key=key;
    nc.dataset.symbol=s.symbol;
    nc.dataset.sec='etfs';
    nc.classList.add('clickable');
    nc.addEventListener('click', ()=> openHist(s.symbol, state.quote||q, s.name, 'etfs'));
    const nameEl=nc.querySelector('.stock-name');
    nameEl.textContent=s.name; nameEl.title=s.name||'';
    nc.querySelector('.stock-symbol').textContent=s.symbol;
    nc.querySelector('.stock-badge').hidden=true;
    const p=nc.querySelector('.stock-price');
    p.textContent=fmt(s.price); p.dataset.v=s.price??'';
    p.classList.add(cls(s.changePct));
    const c=nc.querySelector('.stock-change');
    c.textContent=changeTxt;
    c.classList.add(cls(s.changePct));
    nc.querySelector('.stock-vol').textContent=s.volumeText||'';
    const bar=nc.querySelector('.mini-bar');
    bar.style.setProperty('--w', barW+'%');
    bar.style.setProperty('--bar-c', barC);
    if(!state.hasPainted){ nc.classList.add('card-in'); nc.style.animationDelay=(idx*40)+'ms'; }
    if(state._newSym === key){ nc.classList.add('card-new'); state._newSym = null; }
    el.stockGrid.appendChild(node);
  });
  renderGhostCards(el.stockGrid, tpl, (q.unresolved||[]).filter(u=>u.sec==='etfs'), old, keep, 'stock');
  old.forEach((c,key)=>{ if(!keep.has(key)) c.remove(); });
  el.etfTime.textContent = q.etfTime||'';
}

// ---------- 渲染: A股 (增量更新, 复用 stock-card 样式) ----------
function renderAshares(q){
  const tpl=document.getElementById('stockTpl');
  if(!el.aShareGrid) return;
  [...el.aShareGrid.children].forEach(c=>{ if(!c._key) c.remove(); });
  const old = new Map([...el.aShareGrid.children].map(c=>[c._key, c]));
  const keep = new Set();
  (q.ashares||[]).forEach((s, idx)=>{
    const key = s.symbol;
    const barW = s.changePct!=null?Math.min(100, Math.abs(s.changePct)*2):0;
    const barC = s.changePct>0?'var(--up)':(s.changePct<0?'var(--down)':'var(--accent)');
    const changeTxt = `${sign(s.changePct)}${s.changePct!=null?s.changePct.toFixed(2):'--'}%  (${sign(s.change)}${fmt(s.change)})`;
    let card = old.get(key);
    if(card){
      keep.add(key);
      const p=card.querySelector('.stock-price');
      const oldV=parseFloat(p.dataset.v||'NaN');
      if(s.price!=null){
        p.dataset.v=s.price;
        if(isFinite(oldV)&&oldV!==s.price){ tweenNumber(p, oldV, s.price, 2); pulseNum(p, s.price>oldV); }
        else p.textContent=fmt(s.price);
      }
      p.className='stock-price '+cls(s.changePct);
      const c=card.querySelector('.stock-change');
      c.textContent=changeTxt; c.className='stock-change '+cls(s.changePct);
      card.querySelector('.stock-vol').textContent=s.volumeText||'';
      const bar=card.querySelector('.mini-bar');
      bar.style.setProperty('--w', barW+'%');
      bar.style.setProperty('--bar-c', barC);
      el.aShareGrid.appendChild(card);
      return;
    }
    const node=tpl.content.cloneNode(true);
    const nc=node.querySelector('.stock-card');
    nc._key=key;
    nc.dataset.symbol=s.symbol;
    nc.dataset.sec='ashares';
    nc.classList.add('clickable');
    // 市场徽标与代码同组排列, 不再悬浮遮挡
    const badge = nc.querySelector('.stock-badge');
    badge.textContent = s.market || (key.startsWith('SH')?'SH':'SZ');
    nc.addEventListener('click', ()=> openHist(s.symbol, state.quote||q, s.name, 'ashares'));
    const nameEl=nc.querySelector('.stock-name');
    nameEl.textContent=s.name; nameEl.title=s.name||'';
    nc.querySelector('.stock-symbol').textContent=s.symbol;
    const p=nc.querySelector('.stock-price');
    p.textContent=fmt(s.price); p.dataset.v=s.price??'';
    p.classList.add(cls(s.changePct));
    const c=nc.querySelector('.stock-change');
    c.textContent=changeTxt;
    c.classList.add(cls(s.changePct));
    nc.querySelector('.stock-vol').textContent=s.volumeText||'';
    const bar=nc.querySelector('.mini-bar');
    bar.style.setProperty('--w', barW+'%');
    bar.style.setProperty('--bar-c', barC);
    if(!state.hasPainted){ nc.classList.add('card-in'); nc.style.animationDelay=(idx*40)+'ms'; }
    if(state._newSym === key){ nc.classList.add('card-new'); state._newSym = null; }
    el.aShareGrid.appendChild(node);
  });
  renderGhostCards(el.aShareGrid, tpl, (q.unresolved||[]).filter(u=>u.sec==='ashares'), old, keep, 'stock');
  old.forEach((c,key)=>{ if(!keep.has(key)) c.remove(); });
  if(el.aShareTime) el.aShareTime.textContent = q.aShareTime||'';
}

// ---------- 渲染: 基金 (增量更新, 复用 stock-card 样式) ----------
function renderFunds(q){
  const tpl=document.getElementById('stockTpl');
  if(!el.fundGrid) return;
  [...el.fundGrid.children].forEach(c=>{ if(!c._key) c.remove(); });
  const old = new Map([...el.fundGrid.children].map(c=>[c._key, c]));
  const keep = new Set();
  (q.funds||[]).forEach((s, idx)=>{
    const key = s.symbol;
    const barW = s.changePct!=null?Math.min(100, Math.abs(s.changePct)*2):0;
    const barC = s.changePct>0?'var(--up)':(s.changePct<0?'var(--down)':'var(--accent)');
    const changeTxt = `${sign(s.changePct)}${s.changePct!=null?s.changePct.toFixed(2):'--'}%  (${sign(s.change)}${fmt(s.change,4)})`;
    let card = old.get(key);
    if(card){
      keep.add(key);
      const p=card.querySelector('.stock-price');
      const oldV=parseFloat(p.dataset.v||'NaN');
      if(s.price!=null){
        p.dataset.v=s.price;
        if(isFinite(oldV)&&oldV!==s.price){ tweenNumber(p, oldV, s.price, 4); pulseNum(p, s.price>oldV); }
        else p.textContent=fmt(s.price);
      }
      p.className='stock-price '+cls(s.changePct);
      const c=card.querySelector('.stock-change');
      c.textContent=changeTxt; c.className='stock-change '+cls(s.changePct);
      card.querySelector('.stock-vol').textContent='估值';
      const bar=card.querySelector('.mini-bar');
      bar.style.setProperty('--w', barW+'%');
      bar.style.setProperty('--bar-c', barC);
      el.fundGrid.appendChild(card);
      return;
    }
    const node=tpl.content.cloneNode(true);
    const nc=node.querySelector('.stock-card');
    nc._key=key;
    nc.dataset.symbol=s.symbol;
    nc.dataset.sec='funds';
    nc.classList.add('clickable');
    // 基金徽标与代码同组排列
    const badge = nc.querySelector('.stock-badge');
    badge.classList.add('fund-badge');
    badge.textContent = '基金';
    nc.addEventListener('click', ()=> openHist(s.symbol, state.quote||q, s.name, 'funds'));
    const nameEl=nc.querySelector('.stock-name');
    nameEl.textContent=s.name; nameEl.title=s.name||'';
    nc.querySelector('.stock-symbol').textContent=s.symbol.replace('FU','');
    const p=nc.querySelector('.stock-price');
    p.textContent=fmt(s.price, 4); p.dataset.v=s.price??'';
    p.classList.add(cls(s.changePct));
    const c=nc.querySelector('.stock-change');
    c.textContent=changeTxt;
    c.classList.add(cls(s.changePct));
    nc.querySelector('.stock-vol').textContent='估值';
    const bar=nc.querySelector('.mini-bar');
    bar.style.setProperty('--w', barW+'%');
    bar.style.setProperty('--bar-c', barC);
    if(!state.hasPainted){ nc.classList.add('card-in'); nc.style.animationDelay=(idx*40)+'ms'; }
    if(state._newSym === key){ nc.classList.add('card-new'); state._newSym = null; }
    el.fundGrid.appendChild(node);
  });
  renderGhostCards(el.fundGrid, tpl, (q.unresolved||[]).filter(u=>u.sec==='funds'), old, keep, 'stock');
  old.forEach((c,key)=>{ if(!keep.has(key)) c.remove(); });
  if(el.fundTime) el.fundTime.textContent = q.fundTime||'';
}

// ---------- 渲染: 宏观指标 (增量更新) ----------
const MACRO_ICON = { '美元指数':'💵','黄金':'🥇','现货黄金':'🥇','纽约黄金':'🥇','COMEX黄金':'🥇','纽约白银':'🥈','白银':'🥈','原油':'🛢','纽约原油':'🛢','NYMEX原油':'🛢','纳指期货':'📈','天然气':'🔥','铜':'🔶','美债':'🏛','美国10年期国债':'🏛','美国30年期国债':'🏛','恐慌':'🌩','国债':'🏛','美元兑日元':'💴','欧元兑美元':'💶','美元兑人民币':'🇨🇳' };

// 迷你面积折线 (基金净值 / 宏观指标), 尺寸自适应 canvas 自身渲染盒
function drawMiniArea(canvas, points, up){
  if(!canvas || !points || points.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width || parseInt(canvas.getAttribute('width')) || 80;
  const H = rect.height || parseInt(canvas.getAttribute('height')) || 32;
  const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
  if(canvas.width !== cw) canvas.width = cw;
  if(canvas.height !== ch) canvas.height = ch;
  if(!rect.width) canvas.style.width = W+'px';
  if(!rect.height) canvas.style.height = H+'px';
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  let mn = Math.min(...points), mx = Math.max(...points), rg = (mx-mn) || 1;
  const xy = p => {
    const i = points.indexOf(p);
    return [i/(points.length-1)*W, H-2-((p-mn)/rg)*(H-4)];
  };
  // 面积填充
  g.beginPath();
  points.forEach((p,i)=>{
    const x = i/(points.length-1)*W;
    const y = H-2-((p-mn)/rg)*(H-4);
    i===0 ? g.moveTo(x, y) : g.lineTo(x, y);
  });
  g.lineTo(W, H); g.lineTo(0, H); g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, up ? rgbaRGB(P.upRGB,0.35) : rgbaRGB(P.downRGB,0.35));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fill();
  // 线条
  g.beginPath();
  points.forEach((p,i)=>{
    const x = i/(points.length-1)*W;
    const y = H-2-((p-mn)/rg)*(H-4);
    i===0 ? g.moveTo(x, y) : g.lineTo(x, y);
  });
  g.strokeStyle = up ? P.up : P.down;
  g.lineWidth = 1.5; g.lineJoin = 'round'; g.lineCap = 'round';
  g.stroke();
  // 终点光点
  const [ex, ey] = xy(points[points.length-1]);
  g.beginPath();
  g.shadowColor = up ? rgbaRGB(P.upRGB,0.9) : rgbaRGB(P.downRGB,0.9);
  g.shadowBlur = 6;
  g.fillStyle = up ? P.upGlow : P.downGlow;
  g.arc(ex, ey, 2.1, 0, Math.PI*2); g.fill();
  g.shadowBlur = 0;
}

function renderMacro(q){
  const tpl=document.getElementById('macroTpl');
  // 美债收益率卡片: 价格带 % 后缀, 变动以 BP 表达
  const isBond = m => m.sec === 'bonds' || m.unit === '%';
  const priceText = (m, p, dec) => isBond(m) ? fmt(p, dec) + '%' : fmt(p, dec);
  const deltaText = m => {
    if(isBond(m) && m.bp != null){
      const v = Math.abs(m.bp).toFixed(1);
      return m.bp > 0 ? `+${v} BP` : (m.bp < 0 ? `−${v} BP` : `${v} BP`);
    }
    return m.changePct!=null ? (sign(m.changePct)+m.changePct.toFixed(2)+'%') : '--';
  };
  [...el.macroGrid.children].forEach(c=>{ if(!c._key) c.remove(); });
  const old = new Map([...el.macroGrid.children].map(c=>[c._key, c]));
  const keep = new Set();
  (q.macro||[]).forEach((m, idx)=>{
    const key = m.symbol;
    const price = m.price != null ? m.price : m.value;
    const dec = m.decimals != null ? m.decimals : (price != null && Math.abs(price) < 10 ? 4 : 2);
    const up = (m.changePct||0) > 0;
    const down = (m.changePct||0) < 0;
    let card = old.get(key);
    if(card){
      keep.add(key);
      card.classList.toggle('up', up);
      card.classList.toggle('down', down);
      const vEl=card.querySelector('.mc-price');
      const oldV=parseFloat(vEl.dataset.v||'NaN');
      if(price!=null){
        vEl.dataset.v=price;
        // 收益率盘中变动极小, 直接赋值 (保留 % 后缀), 不做数字滚动
        if(isBond(m) || !isFinite(oldV) || oldV===price) vEl.textContent=priceText(m, price, dec);
        else { tweenNumber(vEl, oldV, price, dec); pulseNum(vEl, price>oldV); }
      }
      vEl.className='mc-price ' + (up?'up':(down?'down':''));
      const d=card.querySelector('.mc-delta');
      d.textContent=deltaText(m);
      d.className='mc-delta '+(up?'up':(down?'down':''));
      // 真实迷你走势由 IO 模块按日K懒加载, 不随轮询伪造重绘
      el.macroGrid.appendChild(card);
      return;
    }
    const node=tpl.content.cloneNode(true);
    const nc=node.querySelector('.macro-card');
    nc._key=key;
    nc.dataset.symbol=m.symbol;
    nc.dataset.sec=m.sec||'fx';
    nc.classList.add('clickable');
    nc.classList.toggle('up', up); nc.classList.toggle('down', down);
    nc.addEventListener('click', ()=> openHist(m.symbol, state.quote||q, m.name, m.sec||'fx'));
    nc.querySelector('.mc-icon').textContent=MACRO_ICON[m.name]||'📊';
    nc.querySelector('.mc-name').textContent=m.name;
    nc.querySelector('.mc-symbol').textContent=m.symbol;
    const vEl=nc.querySelector('.mc-price');
    vEl.textContent=priceText(m, price, dec);
    vEl.dataset.v=price??'';
    vEl.classList.add(up?'up':(down?'down':''));
    const d=nc.querySelector('.mc-delta');
    d.textContent=deltaText(m);
    d.classList.add(up?'up':(down?'down':''));
    // 真实迷你走势 (期货日K) 由 IO 模块懒加载; 无数据源(如美元指数)保持留白
    if(!state.hasPainted){ nc.classList.add('card-in'); nc.style.animationDelay=(idx*50)+'ms'; }
    if(state._newSym === key){ nc.classList.add('card-new'); state._newSym = null; }
    el.macroGrid.appendChild(node);
  });
  renderGhostCards(el.macroGrid, tpl, (q.unresolved||[]).filter(u=>['bonds','fx','futures'].includes(u.sec)), old, keep, 'macro');
  old.forEach((c,key)=>{ if(!keep.has(key)) c.remove(); });
  el.macroTime.textContent=q.macroTime||'';
}

// ---------- 卡片迷你 K 线: 日K蜡烛/净值折线 + IO 懒加载 + 批量请求 ----------
const MINI_TTL = 30*60*1000;       // 日K变化慢, 30 分钟内复用
const MINI_FAIL_TTL = 2*60*1000;   // 失败 2 分钟后再试, 避免反复打上游
const miniCache = new Map();       // "sec:SYM" -> {at, data}
let miniObserver = null;
const miniPending = new Map();     // key -> 首张卡片
let miniTimer = null;

const miniKey = card => (card.dataset.sec||'') + ':' + (card.dataset.symbol||'');

function setupMiniCanvas(canvas){
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = rect.width  || parseInt(canvas.getAttribute('width'))  || 200;
  const H = rect.height || parseInt(canvas.getAttribute('height')) || 46;
  const cw = Math.round(W*dpr), ch = Math.round(H*dpr);
  if(canvas.width !== cw) canvas.width = cw;
  if(canvas.height !== ch) canvas.height = ch;
  canvas.style.width = W+'px'; canvas.style.height = H+'px';
  const g = canvas.getContext('2d');
  g.setTransform(dpr,0,0,dpr,0,0);
  return {g,W,H};
}

// 迷你蜡烛图 (美股/A股/指数/期货 日K): 影线+实体, 今日收盘呼吸光点
function drawMiniCandles(canvas, bars){
  if(!bars || bars.length < 2) return;
  const {g,W,H} = setupMiniCanvas(canvas);
  g.clearRect(0,0,W,H);
  const n = bars.length;
  let hi = -Infinity, lo = Infinity;
  bars.forEach(b=>{ if(b.h>hi) hi=b.h; if(b.l<lo) lo=b.l; });
  const padY = 5;
  const rg = (hi-lo) || Math.abs(hi)*0.002 || 1;
  const y = v => H-padY-((v-lo)/rg)*(H-padY*2);
  const slot = W/n;
  const bw = Math.max(2, Math.min(7, slot*0.56));
  bars.forEach((b,i)=>{
    const cx = slot*(i+0.5);
    const isUp = b.c >= b.o;
    const col = isUp ? P.up : P.down;
    g.globalAlpha = i===n-1 ? 1 : 0.78;
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(cx)+0.5, y(b.h));
    g.lineTo(Math.round(cx)+0.5, y(b.l));
    g.stroke();
    const yO=y(b.o), yC=y(b.c);
    g.fillRect(cx-bw/2, Math.min(yO,yC), bw, Math.max(1, Math.abs(yC-yO)));
  });
  g.globalAlpha = 1;
  const lb = bars[n-1], lcx = slot*(n-0.5), lup = lb.c >= lb.o;
  g.beginPath();
  g.shadowColor = lup ? rgbaRGB(P.upRGB,0.9) : rgbaRGB(P.downRGB,0.9);
  g.shadowBlur = 7;
  g.fillStyle = lup ? P.upGlow : P.downGlow;
  g.arc(lcx, y(lb.c), 2.3, 0, Math.PI*2); g.fill();
  g.shadowBlur = 0;
}

function paintMini(card, data){
  if(!document.contains(card) || !data || !data.bars || data.bars.length < 2) return;
  const closes = data.bars.map(b=>b.c);
  // 折线(基金/宏观指标)颜色跟随当日实时涨跌方向, 与卡片口径一致; 无方向时退回区间首尾
  let up = closes[closes.length-1] >= closes[0];
  if(card.classList.contains('up')) up = true;
  else if(card.classList.contains('down')) up = false;
  if(card.classList.contains('macro-card')){
    drawMiniArea(card.querySelector('.mc-spark'), closes, up);
    card.classList.add('mini-on');
    return;
  }
  const canvas = card.querySelector('.mini-kline');
  if(data.type === 'line') drawMiniArea(canvas, closes, up);
  else drawMiniCandles(canvas, data.bars);
  card.querySelector('.stock-chart').classList.add('has-kline');
}

async function fetchPendingMinis(){
  const cards = [...miniPending.values()].filter(c=>document.contains(c));
  miniPending.clear();
  if(!cards.length) return;
  const byKey = new Map();
  cards.forEach(c=>{ if(!byKey.has(miniKey(c))) byKey.set(miniKey(c), c); });
  const need = [...byKey.keys()].filter(k=>{
    const c = miniCache.get(k);
    return !c || (Date.now()-c.at) > (c.data ? MINI_TTL : MINI_FAIL_TTL);
  });
  if(need.length){
    try{
      const r = await fetch(`${API}/klines?items=${encodeURIComponent(need.join(','))}&n=30&t=${Date.now()}`);
      if(!r.ok) throw new Error('klines '+r.status);
      const d = await r.json();
      const at = Date.now();
      need.forEach(k=> miniCache.set(k, {at, data:(d.items && d.items[k]) || null}));
    }catch(e){
      const at = Date.now();
      need.forEach(k=>{ if(!miniCache.get(k)) miniCache.set(k, {at, data:null}); });
    }
  }
  byKey.forEach(card=>{
    const hit = miniCache.get(miniKey(card));
    if(hit) paintMini(card, hit.data);   // data 为 null 时静默保留 mini-bar / 留白
  });
}

function scheduleMiniFetch(){
  clearTimeout(miniTimer);
  miniTimer = setTimeout(fetchPendingMinis, 120);
}

function observeMiniCards(){
  // 占位卡(:not(.ghost-card))本就没有行情, 不参与迷你K线懒加载
  const SEL = '.stock-card[data-symbol]:not(.ghost-card),.macro-card[data-symbol]:not(.ghost-card)';
  if(!('IntersectionObserver' in window)){
    document.querySelectorAll(SEL).forEach(c=>{
      if(c.dataset.sec) miniPending.set(miniKey(c), c);
    });
    scheduleMiniFetch();
    return;
  }
  if(!miniObserver){
    miniObserver = new IntersectionObserver(entries=>{
      entries.forEach(en=>{
        if(!en.isIntersecting) return;
        const card = en.target;
        miniObserver.unobserve(card);
        if(!card.dataset.sec) return;
        const key = miniKey(card), hit = miniCache.get(key);
        if(hit && (Date.now()-hit.at) <= (hit.data ? MINI_TTL : MINI_FAIL_TTL)){
          paintMini(card, hit.data);
          return;
        }
        miniPending.set(key, card);
        scheduleMiniFetch();
      });
    }, {rootMargin:'160px 0px', threshold:0});
  }
  document.querySelectorAll(SEL).forEach(card=>{
    if(card.dataset.sec) miniObserver.observe(card);
  });
}

// 窗口尺寸变化后按缓存数据重绘全部已显示迷你图
function repaintAllMinis(){
  document.querySelectorAll('.stock-chart.has-kline').forEach(box=>{
    const card = box.closest('.stock-card');
    const hit = card && miniCache.get(miniKey(card));
    if(hit) paintMini(card, hit.data);
  });
  document.querySelectorAll('.macro-card.mini-on').forEach(card=>{
    const hit = miniCache.get(miniKey(card));
    if(hit) paintMini(card, hit.data);
  });
}

// ---------- Hero 主指数 + 迷你走势 ----------
function drawSpark(points, el0){
  const c=document.getElementById('heroSparkCanvas');
  const pulse=document.getElementById('sparkPulse');
  if(!c) return;
  const dpr=window.devicePixelRatio||1;
  const rect=c.parentElement.getBoundingClientRect();
  const W=rect.width, H=rect.height;
  c.width=W*dpr; c.height=H*dpr;
  c.style.width=W+'px'; c.style.height=H+'px';
  const g=c.getContext('2d'); g.scale(dpr,dpr);
  g.clearRect(0,0,W,H);
  if(!points||points.length<2){ if(pulse) pulse.classList.remove('on'); return; }
  let mn=Math.min(...points), mx=Math.max(...points), rg=(mx-mn)||1;
  const path=(col,lineW)=>{
    g.beginPath();
    points.forEach((p,i)=>{ const x=i/(points.length-1)*W, y=H-4-((p-mn)/rg)*(H-8); i===0?g.moveTo(x,y):g.lineTo(x,y); });
    g.strokeStyle=col; g.lineWidth=lineW; g.lineJoin='round'; g.lineCap='round';
    g.stroke();
    return {mx:W, my:H-4-((points[points.length-1]-mn)/rg)*(H-8)};
  };
  // 颜色跟随 Hero 当日涨跌情绪 (data-mood), 与大数字/徽标口径一致
  const mood = document.getElementById('heroCard')?.dataset.mood;
  const up = mood === 'up' ? true : mood === 'down' ? false : points[points.length-1]>=points[0];
  const col = up?P.up:P.down;
  // 渐变填充
  g.save();
  path(col,2);
  g.restore();
  g.save();
  g.beginPath();
  points.forEach((p,i)=>{ const x=i/(points.length-1)*W, y=H-4-((p-mn)/rg)*(H-8); i===0?g.moveTo(x,y):g.lineTo(x,y); });
  g.lineTo(W,H); g.lineTo(0,H); g.closePath();
  const grad=g.createLinearGradient(0,0,0,H);
  grad.addColorStop(0, up?rgbaRGB(P.upRGB,0.22):rgbaRGB(P.downRGB,0.22));
  grad.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle=grad; g.fill();
  g.restore();
  // 末端呼吸光点定位
  if(pulse){
    const lastY = H-4-((points[points.length-1]-mn)/rg)*(H-8);
    pulse.style.left = (W-3)+'px';
    pulse.style.top = lastY+'px';
    pulse.classList.add('on');
  }
}
function renderHero(q){
  el.heroIndex.textContent = q.hero ? (q.hero.name||'NAS100') : '--';
  const prevPrice = parseFloat(el.heroPrice.dataset.last || 'NaN');
  const newPrice = q.hero && q.hero.price!=null ? Number(q.hero.price) : NaN;
  el.heroPrice.dataset.last = isFinite(newPrice) ? String(newPrice) : '';
  if(isFinite(prevPrice) && isFinite(newPrice) && prevPrice!==newPrice){
    tweenNumber(el.heroPrice, prevPrice, newPrice, 2, 620);
  } else {
    el.heroPrice.textContent = fmt(isFinite(newPrice)?newPrice:null);
  }
  el.heroPrice.classList.remove('up','down');
  if(q.hero && q.hero.changePct!=null){ el.heroPrice.classList.add(cls(q.hero.changePct)); }

  const c=el.heroChange;
  c.textContent= q.hero? `${sign(q.hero.changePct)}${(q.hero.changePct??0).toFixed(2)}%  ${sign(q.hero.change)}${fmt(q.hero.change)}`:'--';
  c.classList.remove('up','down'); c.classList.add(cls(q.hero&&q.hero.changePct));

  // Hero 四宫格 mini stat (开盘/最高/最低/成交)
  const hs = q.hero || {};
  const setStat = (id, v) => { const n=document.getElementById(id); if(n) n.textContent = v==null?'--':fmt(v, (id==='hsVol2')?0:2); };
  setStat('hsOpen',  hs.open);
  setStat('hsHigh2', hs.high);
  setStat('hsLow2',  hs.low);
  setStat('hsVol2',  hs.volume);

  // Hero 卡片 mood + body 背景 mood (强度跟随涨跌幅)
  const heroCard = document.getElementById('heroCard');
  const mood = q.hero && q.hero.changePct>0 ? 'up' : (q.hero && q.hero.changePct<0 ? 'down' : 'flat');
  if (heroCard) heroCard.dataset.mood = mood;
  document.body.dataset.mood = mood;
  const pct = Math.abs((q.hero && q.hero.changePct) || 0);
  document.body.style.setProperty('--moodI', Math.min(2.4, 1 + pct*0.55).toFixed(2));

  drawSpark(q.hero && q.hero.spark);
}

// ---------- 全量渲染 ----------
function renderAll(q){
  renderHero(q);
  renderKpis(q);
  renderStocks(q);
  renderAshares(q);
  renderFunds(q);
  renderMacro(q);
  document.querySelectorAll('.clickable').forEach(card=>{
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-haspopup', 'dialog');
    if(!card._keyboardBound){
      card.addEventListener('click', e=>{
        if(!e.target.closest('button, a, input')) card.focus({preventScroll:true});
      }, {capture:true});
      card.addEventListener('keydown', e=>{
        if(e.target === card && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); card.click(); }
      });
      card._keyboardBound = true;
    }
  });
  state.hasPainted = true;
  // 卡片 DOM 稳定后, 由 IntersectionObserver 按需懒加载迷你 K 线
  requestAnimationFrame(observeMiniCards);
}

// ---------- 数据获取 ----------
async function fetchLive(){
  const btn=el.refreshBtn;
  if(btn.getAttribute('aria-busy') === 'true') return;
  btn.setAttribute('aria-busy', 'true');
  btn.setAttribute('aria-label', '正在刷新行情');
  btn.classList.add('spinning');
  try{
    const r=await fetch(API+'/live?t='+Date.now());
    if(!r.ok) throw new Error(r.status);
    const q=await r.json();
    state.quote=q; renderAll(q); cacheQuote(q); el.liveBadge.style.opacity=1;
  }catch(e){
    toast('行情获取失败，请检查服务是否在运行');
    el.liveBadge.style.opacity=0.4;
  }finally{
    btn.classList.remove('spinning');
    btn.setAttribute('aria-busy', 'false');
    btn.setAttribute('aria-label', '刷新行情');
  }
}

function startPolling(){
  stopPolling();
  if(document.hidden || state.mode !== 'live') return;
  state.polling=setInterval(fetchLive, 60000); // 每60秒
}

function stopPolling(){ if(state.polling){ clearInterval(state.polling); state.polling=null; } }

// ---------- 复盘 ----------
async function loadReplay(){
  const date=el.replayDate.value||new Date().toISOString().slice(0,10);
  try{
    const r=await fetch(`${API}/replay?date=${date}`);
    if(!r.ok) throw new Error(r.status);
    const data=await r.json();
    renderReplay(data, date);
  }catch(e){ toast('该日期暂无复盘数据'); }
}
function renderReplay(data, date){
  // 保留 .timeline-rail
  const rail = el.replayContent.querySelector('.timeline-rail');
  el.replayContent.innerHTML = '';
  if (rail) el.replayContent.appendChild(rail);

  const rows = data && data.items;
  if(!rows||!rows.length){
    const empty = document.createElement('div');
    empty.className = 'replay-bar glass';
    empty.style.gridTemplateColumns = '1fr';
    empty.innerHTML = '<span class="name" style="text-align:center;color:var(--text-dim)">当日暂无记录</span>';
    el.replayContent.appendChild(empty);
    return;
  }
  rows.forEach(it=>{
    const div=document.createElement('div');
    div.className = 'replay-bar glass ' + cls(it.changePct);
    const time = it.time || '--:--';
    div.innerHTML = `
      <span class="time">${time}</span>
      <span class="name">${it.name}</span>
      <span class="val ${cls(it.changePct)}">${it.value!=null?fmt(it.value):'--'}
        <small>${sign(it.changePct)}${it.changePct!=null?it.changePct.toFixed(2):'--'}%</small>
      </span>`;
    el.replayContent.appendChild(div);
  });
}

// ============= 历史走势弹层 =============
const hist = {
  el: {
    mask: document.getElementById('histMask'), sheet: document.getElementById('histSheet'),
    symbol: document.getElementById('histSymbol'), name: document.getElementById('histName'),
    price: document.getElementById('histPrice'), delta: document.getElementById('histDelta'),
    window: document.getElementById('histWindow'), ranges: document.getElementById('histRanges'),
    chartModes: document.getElementById('chartModes'),
    canvas: document.getElementById('histCanvas'), tip: document.getElementById('histTip'),
    empty: document.getElementById('histEmpty'), loading: document.getElementById('histLoading'),
    note: document.getElementById('histNote'), close: document.getElementById('histClose'),
    selWrap: document.getElementById('selWrap'), selBadge: document.getElementById('selBadge'),
    hint: document.getElementById('histHint'),
    st: {
      chg: document.getElementById('hsRangeChg'), hi: document.getElementById('hsHigh'),
      lo: document.getElementById('hsLow'), amp: document.getElementById('hsAmp'),
      vol: document.getElementById('hsVol'),
    },
  },
  sym: null, sec: null, rg: '3M', data: null, cache: {}, quote: null, mode: 'area',
  drag: null, cross: null, // {i0,i1} / {x,idx,py}
};
const RANGES = [['1W','1周'],['1M','1月'],['3M','3月'],['6M','6月'],['1Y','1年'],['2Y','2年'],['ALL','全部']];
const fmtHist = (v,d=2) => v==null?'--':Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});

function openHist(sym, quote, displayName, sec){
  hist.sym = sym; hist.sec = sec || null; hist.rg = '3M'; hist.quote = quote;
  hist.data = null; hist.drag = null; hist.cross = null;
  hist.el.quoteCurrent = quote;
  hist.el.symbol.textContent = sym;
  hist.el.name.textContent = displayName || sym;
  // 重置范围选中
  hist.el.ranges.querySelectorAll('.hr').forEach(b=> b.classList.toggle('active', b.dataset.range==='3M'));
  setMode('area');
  hist.el.mask.classList.remove('hidden'); hist.el.sheet.classList.remove('hidden');
  document.body.classList.add('sheet-open');
  hist.el.loading.classList.add('on'); hist.el.empty.classList.add('hidden'); hist.el.tip.style.display='none'; hist.el.canvas.style.opacity=0;
  hist.el.selWrap.style.display='none'; hist.el.hint.style.display='block';
  requestAnimationFrame(()=>{ if(activeDialog?.sheet === hist.el.sheet) hist.el.sheet.classList.add('show'); });
  enterDialog(hist.el.sheet, closeHist);
  loadHist('3M', true);
}
function closeHist(){
  if(hist.el.sheet.classList.contains('hidden')) return;
  hist.requestId = (hist.requestId || 0) + 1;
  hist.controller?.abort();
  cancelAnimationFrame(hist.frame);
  hist.el.sheet.classList.remove('show');
  hist.el.sheet.classList.add('hidden'); hist.el.mask.classList.add('hidden');
  leaveDialog(hist.el.sheet);
}
function setMode(m){
  hist.mode = m;
  document.querySelectorAll('#chartModes .cm').forEach(b=> b.classList.toggle('active', b.dataset.mode===m));
  if(hist.data && hist.data.ok && !hist.el.sheet.classList.contains('hidden')) drawHist(hist.data);
}
async function loadHist(rg, animate=false){
  hist.controller?.abort();
  hist.controller = new AbortController();
  const requestId = hist.requestId = (hist.requestId || 0) + 1;
  cancelAnimationFrame(hist.frame);
  hist.rg = rg;
  hist.el.loading.classList.add('on');
  hist.el.canvas.style.opacity = 0;
  hist.el.tip.style.display = 'none';
  hist.el.selWrap.style.display='none';
  hist.drag = null; hist.cross = null;
  try{
    const secQ = hist.sec ? `&section=${hist.sec}` : '';
    const r = await fetch(`${API}/history?symbol=${hist.sym}${secQ}&range=${rg}&t=${Date.now()}`, {signal:hist.controller.signal});
    if(!r.ok) throw new Error(r.status);
    const d = await r.json();
    if(requestId !== hist.requestId) return;
    if(!d.ok){ showHistEmpty(); return; }
    hist.data = d;
    const up = d.changePct >= 0;
    // 基金只有单位净值 (line): 禁用 K线切换, 强制线图
    const candleBtn = document.querySelector('#chartModes .cm[data-mode="candle"]');
    if(candleBtn) candleBtn.disabled = (d.type === 'line');
    if(d.type === 'line' && hist.mode === 'candle') setMode('area');
    hist.el.empty.classList.add('hidden');
    const isHistBond = hist.sec === 'bonds';
    const dec = d.decimals ?? (isHistBond ? 2 : (d.lastClose<100?4:2));
    hist.el.price.textContent = fmtHist(d.lastClose, dec) + (isHistBond ? '%' : '');
    hist.el.delta.textContent = `${d.changePct>=0?'+':''}${d.changePct.toFixed(2)}%`;
    hist.el.delta.className = 'hist-delta '+(up?'up':'down');
    const firstD = d.bars[0].d, lastD = d.bars[d.bars.length-1].d;
    hist.el.window.textContent = `${firstD} — ${lastD} · ${d.bars.length}${isHistBond?'个收益率点':(d.type==='line'?'个净值点':'根K')}`;
    hist.el.note.textContent = (hist.sym==='SPY') ? 'SPY 用标普500指数(INX)代理走势'
      : (isHistBond ? '美国国债收益率走势（%）· 东财行情中心'
      : (d.type==='line' ? '历史单位净值走势 · 红涨绿跌（基金无盘中开高低数据）'
                         : 'K线：开盘 / 最高 / 最低 / 收盘 · 红涨绿跌'));
    // ---- 区间统计 ----
    const highs = d.bars.map(b=>b.h), lows = d.bars.map(b=>b.l);
    const hi = Math.max(...highs), lo = Math.min(...lows);
    const amp = (hi-lo)/lo*100;
    const avgVol = d.bars.reduce((s,b)=>s+b.v,0)/d.bars.length;
    const st = hist.el.st;
    st.chg.textContent = `${d.changePct>=0?'+':''}${d.changePct.toFixed(2)}%`;
    st.chg.className = 'up'; st.chg.classList.toggle('up', up); st.chg.classList.toggle('down', !up);
    st.hi.textContent = fmtHist(hi, dec); st.lo.textContent = fmtHist(lo, dec);
    st.amp.textContent = amp.toFixed(2)+'%';
    st.vol.textContent = fmtVol(avgVol);
    hist.el.loading.classList.remove('on');
    if(animate) drawHistAnimated(d);
    else hist.frame = requestAnimationFrame(()=> drawHist(d));
  }catch(e){ if(e.name !== 'AbortError' && requestId === hist.requestId) showHistEmpty(); }
}
function fmtVol(v){
  if(!v) return '--';
  if(v>=1e8) return (v/1e8).toFixed(2)+'亿';
  if(v>=1e4) return (v/1e4).toFixed(1)+'万';
  return v.toFixed(0);
}
function showHistEmpty(){
  hist.el.loading.classList.remove('on');
  hist.el.empty.classList.remove('hidden');
  hist.el.note.textContent='';
  hist.el.canvas.style.opacity=0;
  // 清空上一标的残留, 避免统计数据张冠李戴
  hist.el.price.textContent='--';
  hist.el.delta.textContent='--';
  hist.el.delta.className='hist-delta';
  hist.el.window.textContent='';
  if(hist.el.st) ['chg','hi','lo','amp','vol'].forEach(k=>{ hist.el.st[k].textContent='--'; hist.el.st[k].className=''; });
  // 美债/外汇无日K源: 头部回填实时报价, 弹层仍有参考价值
  const live = (hist.quote && hist.quote.macro || []).find(m => m.symbol === hist.sym);
  if(live){
    const isB = live.sec === 'bonds' || live.unit === '%';
    const dec = live.decimals != null ? live.decimals : 2;
    hist.el.price.textContent = fmt(live.price, dec) + (isB ? '%' : '');
    if(isB && live.bp != null){
      const v = Math.abs(live.bp).toFixed(1);
      hist.el.delta.textContent = live.bp > 0 ? `+${v} BP` : (live.bp < 0 ? `−${v} BP` : `${v} BP`);
    } else if(live.changePct != null){
      hist.el.delta.textContent = sign(live.changePct) + live.changePct.toFixed(2) + '%';
    }
    hist.el.delta.className = 'hist-delta ' + cls(live.changePct);
    hist.el.window.textContent = live.time ? `实时 ${live.time}` : '';
  }
}
// ---------- 历史图绘制 ----------
const HIST_RATIO = { padT: 14, padB: 34, padL: 54, padR: 14 };
const histDec = (v)=> v==null?2 : (v>=100?2 : (v>=10?3:4));
function setupCanvas(c){
  const dpr = window.devicePixelRatio||1;
  const rect = c.parentElement.getBoundingClientRect();
  const W = rect.width || c.clientWidth || 600;
  const H = (rect.height || 320);
  if(c.width !== W*dpr || c.height !== H*dpr){ c.width = W*dpr; c.height = H*dpr; }
  c.style.width = W+'px'; c.style.height = H+'px';
  const g = c.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0);
  return {g, W, H};
}
function histAnchors(d, W, H){
  const lo = Math.min(...d.bars.map(b=>b.l));
  const hi = Math.max(...d.bars.map(b=>b.h));
  const range = (hi - lo) || hi*0.001 || 1;
  const pad = range*0.10;
  return { mn: lo - pad, mx: hi + pad };
}
function priceY(v, mn, mx, W, H){
  const top = HIST_RATIO.padT, bot = H - HIST_RATIO.padB;
  return bot - (v-mn)/(mx-mn)*(bot-top);
}
function histGeo(d, W, H){
  const pd = HIST_RATIO, n = d.bars.length;
  const xAt = (i)=> pd.padL + (n===1?0:(i/(n-1))*(W - pd.padL - pd.padR));
  return {xAt, n, pd};
}
function roundRect(g, x, y, w, h, r){
  r = Math.min(r, w/2, h/2);
  g.beginPath();
  g.moveTo(x+r,y); g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r);
  g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath();
}
function drawHistFrame(d, prog=1, view){
  if(!d || !d.bars || !d.bars.length) return;
  const {g, W, H} = setupCanvas(hist.el.canvas);
  const pd = HIST_RATIO;
  const {mn, mx} = histAnchors(d, W, H);
  const {xAt, n} = histGeo(d, W, H);
  const yAt = (c)=> priceY(c, mn, mx, W, H);
  const maxV = d.bars.reduce((m,b)=>Math.max(m,b.v),1);
  const up = d.changePct >= 0;
  const col = up? P.up : P.down;
  const colSoft = a => rgbaRGB(up ? P.upRGB : P.downRGB, a);
  const dec = histDec(d.lastClose);
  const k = Math.max(2, Math.floor(n*prog));

  g.clearRect(0,0,W,H);
  g.font = '10.5px -apple-system, PingFang SC, sans-serif';

  // ---- 背景横格 + 纵轴价格刻度 ----
  g.textAlign = 'right'; g.textBaseline = 'middle';
  g.strokeStyle = P.grid; g.lineWidth = 1;
  const plimit = Math.min(5, 2 + Math.round((H-pd.padT-pd.padB)/46));
  for(let i=0;i<plimit;i++){
    const v = mn + (mx-mn)*i/(plimit-1);
    const y = yAt(v);
    g.beginPath(); g.moveTo(pd.padL,y); g.lineTo(W-pd.padR,y); g.stroke();
    if(i>0 && i<plimit-1) continue;           // 只标上下与中间
    g.fillStyle = rgbaRGB(P.dimRGB,0.8);
    g.fillText(v.toLocaleString('en-US',{maximumFractionDigits: dec}), pd.padL-8, y);
  }

  // ---- 成交量 副图 (高度 1:4) ----
  const vBase = H - pd.padB + 4, vMaxH = pd.padB - 8;
  const bw = Math.max(1, Math.min(3, (W - pd.padL - pd.padR)/n * 0.72));
  for(let i=0;i<k;i++){
    const b = d.bars[i];
    const bh = (b.v/maxV)*vMaxH;
    g.fillStyle = (b.c>=b.o)? rgbaRGB(P.upRGB,0.22) : rgbaRGB(P.downRGB,0.16);
    g.fillRect(xAt(i)-bw/2, vBase - bh, bw, Math.max(1,bh));
  }

  // ---- 区间起始基准线 (Apple 白色基线) ----
  const baseC = d.bars[0].c, baseY = yAt(baseC);
  if(prog>=1){
    g.save();
    g.strokeStyle = rgbaRGB(P.textRGB,0.26); g.setLineDash([2,5]); g.lineWidth=1;
    g.beginPath(); g.moveTo(pd.padL,baseY); g.lineTo(W-pd.padR,baseY); g.stroke();
    g.setLineDash([]);
    g.fillStyle=rgbaRGB(P.textRGB,0.5);
    g.fillText('基准 '+fmtHist(baseC,dec), W-pd.padR-4, baseY-6);
    g.restore();
  }

  // ---- 主序列 ----
  if(hist.mode==='candle'){
    drawCandles(g, d, k, xAt, yAt, W, H, pd);
  } else {
    drawArea(g, d, k, xAt, yAt, W, H, pd, col, colSoft, dec, prog);
  }

  // ---- 区间框选高亮 ----
  if(view && view.sel){
    const {i0, i1} = view.sel;
    const x0 = xAt(i0), x1 = xAt(i1);
    g.save();
    const bg = g.createLinearGradient(0, pd.padT, 0, H-pd.padB);
    bg.addColorStop(0, rgbaRGB(P.accentRGB,0.16)); bg.addColorStop(1, rgbaRGB(P.accent2RGB,0.10));
    g.fillStyle = bg; g.fillRect(x0, pd.padT, x1-x0, H-pd.padB-pd.padT);
    g.strokeStyle = rgbaRGB(P.accentRGB,0.5); g.lineWidth=1;
    g.setLineDash([3,3]); g.strokeRect(x0, pd.padT, x1-x0, H-pd.padB-pd.padT); g.setLineDash([]);
    g.restore();
  }

  // ---- 底部日期刻度 (自适应抽样) ----
  g.textAlign = 'center';
  g.fillStyle = rgbaRGB(P.dimRGB,0.6); g.font='10px -apple-system, PingFang SC, sans-serif';
  const nTicks = Math.min(5, Math.max(3, Math.floor(W/120)));
  const step = Math.max(1, Math.round((n-1)/nTicks));
  for(let i=0;i<=n; i+=step){
    const di = Math.min(n-1,i);
    g.fillText(d.bars[di].d.slice(5), xAt(di), H-10);
  }

  hist.el.canvas.style.opacity = 1;
  hist.el.tipX = xAt; hist.el.yAt = yAt; hist.el.anchors = {mn,mx}; hist.el.n= n;
}

function drawArea(g, d, k, xAt, yAt, W, H, pd, col, colSoft, dec, prog){
  const list = d.bars.slice(0,k).map((b,i)=>[xAt(i), yAt(b.c)]);
  const segs = smoothPath(list);
  const trace = (g)=>{
    g.beginPath(); g.moveTo(segs[0].x, segs[0].y);
    for(let i=1;i<segs.length;i++){ const s=segs[i];
      g.bezierCurveTo(s.cp1x,s.cp1y,s.cp2x,s.cp2y,s.x,s.y); }
  };
  const lastX = segs[segs.length-1].x, lastY = segs[segs.length-1].y;
  // 渐变面积
  g.save();
  trace(g);
  g.lineTo(lastX, H-pd.padB); g.lineTo(pd.padL, H-pd.padB); g.closePath();
  const grad = g.createLinearGradient(0, pd.padT, 0, H-pd.padB);
  grad.addColorStop(0, colSoft(0.30)); grad.addColorStop(0.6, colSoft(0.10)); grad.addColorStop(1, colSoft(0));
  g.fillStyle = grad; g.fill();
  g.restore();
  // 主序线 + 光晕 (Apple 柔光)
  g.save();
  trace(g);
  g.strokeStyle = col; g.lineWidth = 2; g.lineJoin='round'; g.lineCap='round';
  g.shadowColor = colSoft(0.45); g.shadowBlur = 14;
  g.stroke();
  g.restore();
  // 末端圆点 + 价格标签
  if(prog>=1){
    g.beginPath(); g.arc(lastX, lastY, 3.2, 0, Math.PI*2);
    g.fillStyle = col; g.strokeStyle=P.candleEdge; g.lineWidth=2; g.fill(); g.stroke();
    g.textAlign='left'; g.fillStyle = col; g.font='600 11px -apple-system, PingFang SC, sans-serif';
    g.fillText(fmtHist(d.bars[k-1].c, dec), lastX+8, lastY-5);
  }
}

function drawCandles(g, d, k, xAt, yAt, W, H, pd){
  const plotW = (W - pd.padL - pd.padR);
  const bw = Math.max(1.5, plotW/k*0.62);
  const half = bw/2;
  for(let i=0;i<k;i++){
    const b = d.bars[i];
    const upD = b.c>=b.o;
    const colC = upD?P.up:P.down;
    const x = xAt(i);
    const yo = yAt(b.o), yc = yAt(b.c);
    const top = Math.min(yo,yc), hgt = Math.max(1, Math.abs(yc-yo));
    // 影线
    g.strokeStyle = upD? rgbaRGB(P.upRGB,0.75):rgbaRGB(P.downRGB,0.75);
    g.lineWidth=1;
    g.beginPath(); g.moveTo(x, yAt(b.h)); g.lineTo(x, yAt(b.l)); g.stroke();
    // 实体
    g.fillStyle = upD?P.up:P.down;
    g.fillRect(x-half, top, bw, hgt);
  }
  // 收盘价参考线
  g.save();
  g.font='600 11px -apple-system, PingFang SC, sans-serif';
  g.textAlign='left';
  const last = d.bars[k-1], ly = yAt(last.c), dec = histDec(last.c);
  g.fillStyle = last.c>=last.o? P.up:P.down;
  g.fillText(fmtHist(last.c,dec), xAt(k-1)+4, ly-4);
  g.restore();
}

const clampSeg = (v, lo, hi)=> hi<lo? (lo+hi)/2 : Math.max(lo, Math.min(hi, v));
function smoothPath(pts){
  if(pts.length<2) return [{x:pts[0][0], y:pts[0][1]}];
  const segs = [{ x: pts[0][0], y: pts[0][1] }];
  const t = 0.18;
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[Math.max(i-1,0)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(i+2,pts.length-1)];
    const lo3 = Math.min(p0[1], p1[1], p2[1]), hi3 = Math.max(p0[1], p1[1], p2[1]);
    const lo3b = Math.min(p1[1], p2[1], p3[1]), hi3b = Math.max(p1[1], p2[1], p3[1]);
    let c1y = p1[1]+(p2[1]-p0[1])*t; c1y = clampSeg(c1y, lo3, hi3);
    let c2y = p2[1]-(p3[1]-p1[1])*t; c2y = clampSeg(c2y, lo3b, hi3b);
    segs.push({ cp1x: p1[0]+(p2[0]-p0[0])*t, cp1y: c1y,
                cp2x: p2[0]-(p3[0]-p1[0])*t, cp2y: c2y, x: p2[0], y: p2[1] });
  }
  return segs;
}
function drawHist(d, view=null){
  if(!d || !d.bars || !d.bars.length) return;
  hist._selView = view;
  setupCanvas(hist.el.canvas);
  drawHistFrame(d, 1, view);
}
function histIdxAt(e){
  const d = hist.data; if(!d || !d.ok) return -1;
  const rect = hist.el.canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const xs = hist.el.tipX, n = hist.el.n;
  if(!xs) return -1;
  let idx = Math.round((x - xs(0)) / ((xs(1)-xs(0))||1));
  return Math.max(0, Math.min(n-1, idx));
}

// ---------- 十字准星 + 提示 ----------
function paintCross(g, d, view){
  const {idx} = view.cross;
  const b = d.bars[idx];
  const px = hist.el.tipX(idx), py = hist.el.yAt(b.c);
  const W = hist.el._W, H = hist.el._H;
  const pd = HIST_RATIO;
  // 全屏十字线
  g.save();
  g.strokeStyle=rgbaRGB(P.textRGB,0.22); g.setLineDash([3,4]); g.lineWidth=1;
  g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
  g.beginPath(); g.moveTo(pd.padL, py); g.lineTo(W-pd.padR, py); g.stroke();
  g.setLineDash([]);
  // 中心点
  g.beginPath(); g.arc(px, py, 3.4, 0, Math.PI*2);
  g.fillStyle = (b.c>=b.o)?P.up:P.down; g.fill();
  g.strokeStyle='#fff'; g.lineWidth=1.6; g.stroke();
  // 右侧价格轴标签
  const dec = histDec(b.c);
  const label = fmtHist(b.c, dec);
  g.font='600 10px -apple-system, PingFang SC, sans-serif';
  const tw = g.measureText(label).width+12;
  g.fillStyle=P.tipBg; roundRect(g, W-pd.padR+2, py-9, tw, 18, 6); g.fill();
  g.fillStyle=P.tipText; g.textAlign='left'; g.textBaseline='middle';
  g.fillText(label, W-pd.padR+8, py+0.5);
  // 底部日期轴标签
  const dl = b.d;
  g.font='600 10px -apple-system, PingFang SC, sans-serif';
  const dw = g.measureText(dl).width+12;
  const dx = Math.max(pd.padL, Math.min(W-pd.padR-dw, px-dw/2));
  g.fillStyle=P.tipBg; roundRect(g, dx, H-10, dw, 16, 6); g.fill();
  g.fillStyle=rgbaRGB(P.tipTextRGB,0.9); g.textAlign='center';
  g.fillText(dl, dx+dw/2, H-2);
  g.restore();
}
hist.el.canvas.addEventListener('pointerdown', (e)=>{
  e.preventDefault();
  const idx = histIdxAt(e);
  if(idx<0) return;
  hist.drag = {i0: idx, i1: idx, x0: hist.el.tipX(idx), started: false};
  hist.el.canvas.setPointerCapture && hist.el.canvas.setPointerCapture(e.pointerId);
  hist.el.tip.style.display='none';
  hist.el.hint.style.display='none';
});
hist.el.canvas.addEventListener('pointermove', (e)=>{
  const d = hist.data; if(!d || !d.ok) return;
  if(hist.drag){
    const idx = histIdxAt(e);
    if(idx<0) return;
    hist.drag.i1 = idx;
    const dx0 = Math.abs(hist.el.tipX(idx) - hist.drag.x0);
    if(dx0 < 2 && !hist.drag.started) return;   // 未形成拖拽
    hist.drag.started = true;
    historyCssCoord();                          // 更新 DOM 选框
    drawHist(d, {sel: {i0: Math.min(hist.drag.i0,hist.drag.i1), i1: Math.max(hist.drag.i0,hist.drag.i1)}});
    document.getElementById('histChart').classList.remove('cross-on');
  } else {
    const idx = histIdxAt(e);
    if(idx<0) return;
    hist.cross = {idx};
    const b = d.bars[idx];
    const tip = hist.el.tip;
    tip.style.display='block';
    const upDay = b.c>=b.o, dayChg = b.o? ((b.c-b.o)/b.o*100):0;
    tip.innerHTML = `<div class="tip-date">${b.d}</div>
      <div class="tip-row"><span>开</span><b>${fmtHist(b.o,histDec(b.c))}</b><span>收</span><b>${fmtHist(b.c,histDec(b.c))}</b></div>
      <div class="tip-row"><span>高</span><b>${fmtHist(b.h,histDec(b.c))}</b><span>低</span><b>${fmtHist(b.l,histDec(b.c))}</b></div>
      <div class="tip-vol">成交 <b>${fmtHist(b.v,0)}</b></div>
      <div class="tip-delta ${upDay?'up':'down'}">${upDay?'+':''}${dayChg.toFixed(2)}%</div>`;
    tip.classList.add('show');
    const {g, W, H} = setupCanvas(hist.el.canvas); hist.el._W=W; hist.el._H=H;
    drawHistFrame(d, 1, {cross:{idx}});
    paintCross(g, d, {cross:{idx}});
    // 同步 overlay 十字
    const x = hist.el.tipX(idx);
    const histChart = document.getElementById('histChart');
    const crossV = document.getElementById('crossV');
    const crossH = document.getElementById('crossH');
    if (crossV && crossH) {
      crossV.style.left = x + 'px';
      const yAt = (v)=> priceY(v, histAnchors(d,W,H).mn, histAnchors(d,W,H).mx, W, H);
      crossH.style.top = yAt(b.c) + 'px';
      histChart.classList.add('cross-on');
    }
  }
});
function historyCssCoord(){
  const d = hist.data; if(!d || !d.ok || !hist.drag) return;
  const {i0, i1} = hist.drag;
  const a = Math.min(i0,i1), b = Math.max(i0,i1);
  const xs = hist.el.tipX;
  const x0 = xs(a), x1 = xs(b);
  const selWrap = hist.el.selWrap;
  selWrap.style.display='block';
  selWrap.style.left = (x0-1)+'px';
  selWrap.style.width = Math.max(8, x1-x0+2)+'px';
  // 区间涨跌
  const bc = d.bars[a].c, ec = d.bars[b].c;
  const chg = bc? (ec-bc)/bc*100 : 0;
  const upSel = chg>=0;
  hist.el.selBadge.textContent = `${d.bars[a].d.slice(5)}` + (a<b?` → ${d.bars[b].d.slice(5)}`:'') + `  ${chg>=0?'+':''}${chg.toFixed(2)}%`;
  hist.el.selBadge.className = 'sel-badge '+(upSel?'up':'down');
}
hist.el.canvas.addEventListener('pointerup', ()=>{
  if(!hist.drag) return;
  if(hist.drag.started){
    historyCssCoord();   // 保留选区
    drawHist(hist.data, {sel: {i0: Math.min(hist.drag.i0,hist.drag.i1), i1: Math.max(hist.drag.i0,hist.drag.i1)}});
    hist.el.hint.style.display='none';
  } else {
    hist.drag = null; hist.el.selWrap.style.display='none';
    drawHist(hist.data); hist.el.hint.style.display='block';
  }
  hist.drag = null;
});
hist.el.canvas.addEventListener('pointerleave', ()=>{
  if(hist.drag){ hist.drag=null; hist.el.selWrap.style.display='none'; drawHist(hist.data); hist.el.hint.style.display='block'; }
  hist.cross = null;
  hist.el.tip.classList.remove('show'); hist.el.tip.style.display='none';
  document.getElementById('histChart').classList.remove('cross-on');
  if(hist.data && hist.data.ok && !hist.drag) drawHist(hist.data);
});
// 范围切换
hist.el.ranges.addEventListener('click', (e)=>{
  const b = e.target.closest('.hr'); if(!b || b.classList.contains('active')) return;
  hist.el.ranges.querySelectorAll('.hr').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  loadHist(b.dataset.range, false);
});
// 图表模式切换
hist.el.chartModes.addEventListener('click', (e)=>{
  const b = e.target.closest('.cm'); if(!b || b.classList.contains('active')) return;
  setMode(b.dataset.mode);
});
hist.el.close.addEventListener('click', closeHist);
hist.el.mask.addEventListener('click', closeHist);
hist.el.canvas.addEventListener('pointercancel', ()=>{
  hist.drag = null; hist.cross = null; hist.el.tip.style.display = 'none';
  if(hist.data?.ok) drawHist(hist.data);
});

function drawHistAnimated(d){
  hist._selView = null;
  setupCanvas(hist.el.canvas);
  cancelAnimationFrame(hist.frame);
  if(reducedMotion() || document.hidden){ drawHistFrame(d, 1); return; }
  const t0 = performance.now(), dur = 520;
  const frame = (t)=>{
    const p = Math.min(1, (t-t0)/dur);
    const ease = 1-Math.pow(1-p, 3);
    drawHistFrame(d, ease);
    if(p<1 && !document.hidden && !reducedMotion()) hist.frame = requestAnimationFrame(frame);
    else drawHistFrame(d, 1);
  };
  hist.frame = requestAnimationFrame(frame);
}

function syncVisibility(){
  document.documentElement.classList.toggle('page-hidden', document.hidden);
  if(document.hidden){
    stopPolling();
    cancelAnimationFrame(hist.frame);
  }else{
    if(hist.data?.ok && activeDialog?.sheet === hist.el.sheet) drawHist(hist.data);
    if(state.mode === 'live'){ startPolling(); fetchLive(); }
  }
}
document.addEventListener('visibilitychange', syncVisibility);
window.addEventListener('pagehide', ()=>{ stopPolling(); hist.controller?.abort(); cancelAnimationFrame(hist.frame); });
window.addEventListener('pageshow', e=>{ if(e.persisted) syncVisibility(); });

// 触发打开: hero
el.heroHist && el.heroHist.addEventListener('click', (e)=>{
  e.stopPropagation();
  const hero = state.quote?.hero;
  if(hero?.symbol) openHist(hero.symbol, hero, hero.name || hero.symbol, 'indexes');
});

// ---------- 分段切换 · 滑动指示 pill ----------
function updateSegPill(){
  const nav=document.getElementById('modeSwitch');
  if(!nav) return;
  const active=nav.querySelector('.seg.active');
  const pill=nav.querySelector('.seg-pill');
  if(!active||!pill) return;
  pill.style.left = active.offsetLeft+'px';
  pill.style.width = active.offsetWidth+'px';
  nav.classList.add('ready');
}

// ---------- 卡片磁吸光斑 (事件委托) ----------
function bindSpotlight(container){
  if(!container) return;
  let pending = null, frame = 0;
  container.addEventListener('pointermove', e=>{
    if(e.pointerType !== 'mouse' || reducedMotion()) return;
    const card = e.target.closest('.kpi-card,.stock-card,.macro-card');
    if(!card) return;
    pending = {card, x:e.clientX, y:e.clientY};
    if(frame) return;
    frame = requestAnimationFrame(()=>{
      frame = 0;
      const {card, x, y} = pending, r = card.getBoundingClientRect();
      card.style.setProperty('--mx', (x-r.left)+'px');
      card.style.setProperty('--my', (y-r.top)+'px');
    });
  }, {passive:true});
}
[el.kpis, el.stockGrid, el.aShareGrid, el.fundGrid, el.macroGrid].forEach(bindSpotlight);

// ---------- 顶栏滚动沉浸态 ----------
const topbarEl = document.querySelector('.topbar');
window.addEventListener('scroll', ()=>{
  if(topbarEl) topbarEl.classList.toggle('scrolled', window.scrollY>8);
}, {passive:true});

// ---------- 窗口尺寸变化: 校正 pill 与 spark ----------
let resizeTimer=null;
window.addEventListener('resize', ()=>{
  updateSegPill();
  if(resizeTimer) clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{
    if(state.quote && state.quote.hero) drawSpark(state.quote.hero.spark);
    repaintAllMinis();
  }, 160);
});
window.addEventListener('load', updateSegPill);

// ---------- 事件绑定 ----------
el.refreshBtn.addEventListener('click', fetchLive);

// ---------- 配色主题切换 ----------
(function initThemeSwitcher(){
  const wrap = document.getElementById('themeWrap');
  const btn = document.getElementById('themeBtn');
  const pop = document.getElementById('themePop');
  if(!wrap || !btn || !pop) return;
  let current = 'midnight';
  try{ current = localStorage.getItem('gp-theme') || 'midnight'; }catch(e){}
  const markActive = () => pop.querySelectorAll('.theme-opt').forEach(o => o.classList.toggle('active', o.dataset.theme === current));
  const setOpen = on => {
    const restore = pop.contains(document.activeElement);
    wrap.classList.toggle('open', on); pop.inert = !on;
    btn.setAttribute('aria-expanded', String(on));
    if(on) (pop.querySelector('.theme-opt.active') || pop.querySelector('button')).focus();
    else if(restore) btn.focus();
  };
  pop.inert = true;
  pop.addEventListener('keydown', e=>{
    const options = [...pop.querySelectorAll('button')];
    const index = options.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
      e.preventDefault();
      options[e.key === 'Home' ? 0 : e.key === 'End' ? options.length-1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length)%options.length].focus();
    }
  });
  wrap.addEventListener('focusout', ()=>queueMicrotask(()=>{ if(!wrap.contains(document.activeElement)) setOpen(false); }));
  markActive();
  btn.addEventListener('click', (e)=>{ e.stopPropagation(); setOpen(!wrap.classList.contains('open')); });
  pop.addEventListener('click', (e)=>{
    const opt = e.target.closest('.theme-opt[data-theme]'); if(!opt) return;
    current = opt.dataset.theme;
    markActive();
    applyTheme(current);
    setOpen(false);
  });
  document.addEventListener('click', (e)=>{ if(!wrap.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') setOpen(false); });
})();
document.querySelectorAll('#modeSwitch .seg').forEach(b=>{
  b.addEventListener('click', ()=>{
    document.querySelectorAll('#modeSwitch .seg').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    updateSegPill();
    state.mode=b.dataset.mode;
    if(state.mode==='live'){ el.replayView.classList.add('hidden'); startPolling(); if(!state.quote) fetchLive(); }
    else { el.replayView.classList.remove('hidden'); stopPolling(); }
  });
});
document.getElementById('goReplay').addEventListener('click', loadReplay);
// 默认复盘日期为最近工作日
el.replayDate.value = new Date().toISOString().slice(0,10);

// ============= 自选配置面板 =============
const cfg = {
  el: {
    btn: document.getElementById('cfgBtn'),
    mask: document.getElementById('cfgMask'), sheet: document.getElementById('cfgSheet'),
    close: document.getElementById('cfgClose'),
    hero: document.getElementById('cfgHero'),
    etfs: document.getElementById('cfgEtfs'), addEtfs: document.getElementById('cfgAddEtfs'),
    index: document.getElementById('cfgIndex'), addIndex: document.getElementById('cfgAddIndex'),
    ashares: document.getElementById('cfgAshares'), addAshares: document.getElementById('cfgAddAshares'),
    funds: document.getElementById('cfgFunds'), addFunds: document.getElementById('cfgAddFunds'),
    macro: document.getElementById('cfgMacro'),
    addFutures: document.getElementById('cfgAddFutures'), addFx: document.getElementById('cfgAddFx'),
  },
  data: null,            // {hero, etfs[], indexes[], macroFx[], macroFutures[]}
  saveTimer: null,
};
// 按钮 data-sec -> watchlist 数组键 + 校验分类
const CFG_SEC = {
  'etfs':    { key: 'etfs',        label: '美股/ETF' },
  'index':   { key: 'indexes',     label: '指数' },
  'ashares': { key: 'ashares',     label: 'A 股' },
  'funds':   { key: 'funds',       label: '基金' },
  'futures': { key: 'macroFutures',label: '期货' },
  'fx':      { key: 'macroFx',     label: '外汇/指数' },
  'bonds':   { key: 'macroBonds', label: '美债收益率' },
};
// sec(短名) → dataKey(长名) 双向映射
const SEC_TO_DATAKEY = { etfs:'etfs', index:'indexes', indexes:'indexes', ashares:'ashares', funds:'funds', futures:'macroFutures', macroFutures:'macroFutures', fx:'macroFx', macroFx:'macroFx', bonds:'macroBonds', macroBonds:'macroBonds' };
const DATAKEY_TO_SEC = { etfs:'etfs', indexes:'index', ashares:'ashares', funds:'funds', macroFutures:'futures', macroFx:'fx', macroBonds:'bonds' };
function dataKeyOf(sec){ return SEC_TO_DATAKEY[sec] || sec; }
function secOf(dataKey){ return DATAKEY_TO_SEC[dataKey] || dataKey; }
const CFG_LABEL = { IXIC:'纳斯达克', INX:'标普500', DJI:'道琼斯', NDX:'纳斯达克100',
  GC:'COMEX黄金', SI:'白银', CL:'NYMEX原油', NQ:'纳指期货', DINIW:'美元指数',
  US10Y:'美债10年', US30Y:'美债30年' };

async function cfgOpen(){
  const trigger = cfg.el.btn;
  if(trigger.getAttribute('aria-busy') === 'true' || activeDialog) return;
  trigger.setAttribute('aria-busy', 'true');
  try{
    const loaded = await loadWatchlist();
    if(!loaded || activeDialog) return;
    cfg.el.mask.classList.remove('hidden'); cfg.el.sheet.classList.remove('hidden');
    document.body.classList.add('sheet-open');
    requestAnimationFrame(()=>{ if(activeDialog?.sheet === cfg.el.sheet) cfg.el.sheet.classList.add('show'); });
    enterDialog(cfg.el.sheet, cfgClose, trigger);
  }finally{ trigger.setAttribute('aria-busy', 'false'); }
}
function cfgClose(){
  if(cfg.el.sheet.classList.contains('hidden')) return;
  cfg.el.sheet.classList.remove('show');
  cfg.el.sheet.classList.add('hidden'); cfg.el.mask.classList.add('hidden');
  leaveDialog(cfg.el.sheet);
}
async function loadWatchlist(){
  try{
    const r = await fetch(API+'/watchlist');
    if(!r.ok) throw new Error(r.status);
    const d = await r.json();
    cfg.data = {
      hero: d.hero || 'IXIC',
      etfs: d.etfs || [], indexes: d.indexes || [],
      ashares: d.ashares || [], funds: d.funds || [],
      macroFx: d.macroFx || [], macroFutures: d.macroFutures || [],
      macroBonds: d.macroBonds || [],
    };
    cfgRenderAll();
    return true;
  }catch(e){ toast('配置读取失败，请重试'); return false; }
}
// 防抖保存：改动即写服务端，并轻量刷新看板
function cfgSave(){
  if(cfg.saveTimer) clearTimeout(cfg.saveTimer);
  cfg.saveTimer = setTimeout(async ()=>{
    try{
      const response = await fetch(API+'/watchlist', {
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(cfg.data),
      });
      if(!response.ok) throw new Error(response.status);
      toast('自选已保存');
      // 配置已驱动 /api/live，重拉看板（不打断弹层）
      fetchLive();
    }catch(e){ toast('自选保存失败，本次修改尚未同步'); }
  }, 220);
}
function cfgRenderAll(){
  cfgRenderHero();
  cfg.renderList(cfg.el.etfs, cfg.data.etfs, 'etfs');
  cfg.renderList(cfg.el.index, cfg.data.indexes, 'index');
  cfg.renderList(cfg.el.ashares, cfg.data.ashares, 'ashares');
  cfg.renderList(cfg.el.funds, cfg.data.funds, 'funds');
  // 宏观按组显示: 美债 → 外汇 → 期货, 带小组标题, 各自可删
  cfg.el.macro.innerHTML = '';
  const macroGroups = [
    { label: '美债收益率', items: cfg.data.macroBonds.map(s=>({s, sec:'bonds'})) },
    { label: '外汇 / 指数', items: cfg.data.macroFx.map(s=>({s, sec:'fx'})) },
    { label: '商品 / 股指期货', items: cfg.data.macroFutures.map(s=>({s, sec:'futures'})) },
  ];
  macroGroups.forEach(g => {
    if (!g.items.length) return;
    const lab = document.createElement('div');
    lab.className = 'cfg-group-label'; lab.textContent = g.label;
    const box = document.createElement('div');
    box.className = 'cfg-group-items';
    cfg.el.macro.appendChild(lab);
    cfg.el.macro.appendChild(box);
    cfg.renderList(box, g.items, 'macro');
  });
}
function cfgRenderHero(){
  const w = cfg.el.hero; w.innerHTML='';
  cfg.data.indexes.forEach(s=>{
    const chip = document.createElement('button');
    chip.className = 'cfg-chip' + (s===cfg.data.hero ? ' active':'');
    chip.innerHTML = `<b>${s}</b><small>${cfgItemLabel(s)}</small>`;
    chip.title = '设为主指数';
    chip.addEventListener('click', ()=>{
      cfg.data.hero = s;
      cfgRenderAll(); cfgSave();
    });
    w.appendChild(chip);
  });
}
function cfgItemLabel(s){ return CFG_LABEL[s] || s; }
cfg.renderList = function(wrap, items, sec){
  wrap.innerHTML='';
  items.forEach(item=>{
    const sym = typeof item === 'string' ? item : item.s;
    const secKey = typeof item === 'string' ? sec : item.sec;
    const tag = document.createElement('span');
    tag.className='cfg-item';
    tag.innerHTML = `<span class="nm">${cfgItemLabel(sym)}</span>
      <button class="rm" title="移除 ${sym}" aria-label="移除 ${sym}">✕</button>`;
    tag.querySelector('.rm').addEventListener('click', ()=> cfgRemove(secKey, sym));
    wrap.appendChild(tag);
  });
  if(!items.length && sec!=='macro'){
    const none = document.createElement('span');
    none.className='cfg-empty'; none.textContent = '（空）在下方输入代码添加';
    wrap.appendChild(none);
  }
};
function cfgRemove(secKey, sym){
  const dk = dataKeyOf(secKey);          // 短名→长名, 确保能在 cfg.data 里找到
  const arr = cfg.data[dk];
  if(!arr) return;
  const i = arr.indexOf(sym);
  if(i>=0) arr.splice(i,1);
  if(dk==='indexes' && cfg.data.hero===sym){
    cfg.data.hero = arr[0] || null;
  }
  cfgRenderAll(); cfgSave();
  toast('已移除 '+sym);
}
// 校验不通过: 明确报错并拒绝写入, 不让无效代码悄悄进自选
function cfgReject(input, srcEl, sym, reason){
  const why = (reason && reason !== '上游无此代码') ? reason : '暂无行情';
  toast(`${sym} · ${why}，未添加`);
  if(srcEl){
    srcEl.classList.add('reject');
    srcEl.textContent = '✕ ' + why;
    setTimeout(()=>{ srcEl.classList.remove('reject'); srcEl.textContent = '+ 添加'; }, 1800);
    const item = srcEl.closest('.sg-item');
    if(item) item.classList.add('reject');
  }
  if(input) input.focus();
}
async function cfgAdd(secKey, input, sym, itemSec, srcEl){
  sym = (sym||'').trim();
  if(!sym) { input.focus(); return; }
  // —— 兜底: 如果输入含中文/看起来不是代码, 先搜索找到正确代码 ——
  const hasChinese = /[\u4e00-\u9fa5]/.test(sym);
  const looksLikeCode = /^[A-Z]{1,6}$/.test(sym.toUpperCase()) || /^(SH|SZ)\d{6}$/i.test(sym);
  if(hasChinese || (!itemSec && !looksLikeCode)){
    try{
      const r = await fetch(`${API}/search?q=${encodeURIComponent(sym)}&section=all&t=${Date.now()}`);
      const data = await r.json();
      if(data && data.results && data.results.length > 0){
        const first = data.results[0];
        sym = first.symbol;
        itemSec = first.sec;
      }
    }catch(e){}
  }
  sym = sym.toUpperCase();
  // 如果搜索结果带了实际类别, 用它决定加到哪个分组 (比如在指数面板搜出 QQQ, 应该加到 etfs)
  const targetSec = itemSec || secKey;
  const dk = dataKeyOf(targetSec);
  const arr = cfg.data[dk];
  if(!arr){ toast('未知分组'); return; }
  if(arr.includes(sym)){
    // 已存在也给个反馈
    if(srcEl){
      srcEl.textContent = '已存在';
      srcEl.classList.add('exists');
      setTimeout(()=>{ srcEl.textContent = '+ 添加'; srcEl.classList.remove('exists'); }, 1200);
    } else {
      toast(sym+' 已在列表中');
    }
    return;
  }

  // —— 视觉反馈: 按钮变 ✓ ——
  if(srcEl){
    srcEl.classList.add('adding');
    srcEl.textContent = '添加中…';
  }

  // —— 硬门槛: 先校验代码能否取到行情, 取不到就不写入 (避免幽灵卡片 / 加了却不显示) ——
  let label = sym;
  const secQ = secOf(dk);   // 传给后端的短名
  try{
    const r = await fetch(`${API}/quote?symbol=${encodeURIComponent(sym)}&section=${secQ}&t=${Date.now()}`);
    const q = await r.json();
    if(!q || !q.ok || !q.name){ cfgReject(input, srcEl, sym, q && q.reason); return; }
    label = q.name; CFG_LABEL[sym]=CFG_LABEL[sym]||q.name;
  }catch(e){
    cfgReject(input, srcEl, sym, '校验失败，请重试');
    return;
  }

  arr.push(sym);
  state._newSym = sym;     // 标记新卡片, 让 render 函数加高亮入场
  cfgRenderAll(); cfgSave();

  // —— 视觉反馈: 成功 ✓ ——
  if(srcEl){
    srcEl.classList.remove('adding');
    srcEl.classList.add('added');
    srcEl.textContent = '✓ 已添加';
    // 搜索项整体滑出
    const sgItem = srcEl.closest('.sg-item');
    if(sgItem){
      setTimeout(()=>{ sgItem.classList.add('fly-out'); }, 280);
      setTimeout(()=>{ sgItem.remove(); }, 600);
    }
    setTimeout(()=>{
      // 如果还有其他搜索项就保留面板, 否则关闭
      const panel = sgItem?.parentElement;
      if(panel && panel.querySelectorAll('.sg-item').length === 0){
        panel.classList.remove('show');
      }
    }, 620);
  }

  input.value=''; input.focus();
  if(!srcEl) toast('已添加 '+label+' → '+CFG_SEC[secOf(dk)]?.label);
}
// ---- 事件绑定 ----
cfg.el.btn.addEventListener('click', cfgOpen);
cfg.el.close.addEventListener('click', cfgClose);
cfg.el.mask.addEventListener('click', cfgClose);
// 左导航 tab 切换
document.querySelectorAll('.cfg-nav-item').forEach(item=>{
  item.addEventListener('click', ()=>{
    const tab = item.dataset.tab;
    document.querySelectorAll('.cfg-nav-item').forEach(n=>n.classList.toggle('active', n===item));
    document.querySelectorAll('.cfg-pane-section').forEach(p=>{
      const isActive = p.dataset.pane === tab;
      p.classList.toggle('active', isActive);
      if (isActive) { p.style.animation = 'none'; void p.offsetWidth; p.style.animation = ''; }
    });
  });
});
document.querySelectorAll('.cfg-add button[data-sec]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const wrap = btn.closest('.cfg-add');
    const input = wrap.querySelector('input');
    const sec = CFG_SEC[btn.dataset.sec];
    if(input && sec) cfgAdd(sec.key, input, input.value);
  });
});
['cfgAddEtfs','cfgAddIndex','cfgAddAshares','cfgAddFunds','cfgAddFutures','cfgAddFx','cfgAddBonds'].forEach(id=>{
  const input = document.getElementById(id);
  if(!input) return;
  const sec = CFG_SEC['cfgAddEtfs'===id?'etfs':'cfgAddIndex'===id?'index':'cfgAddAshares'===id?'ashares':'cfgAddFunds'===id?'funds':'cfgAddFutures'===id?'futures':'cfgAddBonds'===id?'bonds':'fx'];
  const panel = document.querySelector(`.search-suggest[data-input="${id}"]`);
  let debounceT = null;

  async function doSearch(){
    const q = input.value.trim();
    if(!q){ if(panel) panel.classList.remove('show'); return; }
    try{
      const r = await fetch(`${API}/search?q=${encodeURIComponent(q)}&section=${secOf(sec.key)}`);
      const data = await r.json();
      if(!panel) return;
      const list = data.results || [];
      if(!list.length){
        panel.innerHTML = `<div class="sg-empty">没找到 <b>${q}</b>，直接回车可手动添加代码</div>`;
      } else {
        panel.innerHTML = list.map(r=>{
          const secLabel = {etfs:'股票', index:'指数', fx:'外汇', futures:'期货', bonds:'美债'}[r.sec] || r.sec;
          return `<div class="sg-item" data-sym="${r.symbol}" data-sec="${r.sec}">
            <div class="sg-left">
              <span class="sg-code">${r.symbol}</span>
              <span class="sg-name">${r.name||''} · ${r.en||''}</span>
            </div>
            <span class="sg-tag">${secLabel}</span>
            <span class="sg-add">+ 添加</span>
          </div>`;
        }).join('');
      }
      panel.classList.add('show');
    }catch(e){ if(panel) panel.classList.remove('show'); }
  }

  input.addEventListener('input', ()=>{
    clearTimeout(debounceT);
    debounceT = setTimeout(doSearch, 180);
  });
  input.addEventListener('focus', ()=>{ if(input.value.trim()) doSearch(); });
  input.addEventListener('blur', ()=>{
    setTimeout(()=>{ if(panel) panel.classList.remove('show'); }, 180);
  });
  input.addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){
      e.preventDefault();
      // 如果有搜索结果且第一项不是自定义输入, 优先加第一项
      const first = panel && panel.querySelector('.sg-item');
      const firstBtn = first && first.querySelector('.sg-add');
      if(first && panel.classList.contains('show')){
        cfgAdd(sec.key, input, first.dataset.sym, first.dataset.sec, firstBtn);
      } else {
        cfgAdd(sec.key, input, input.value);
      }
    } else if(e.key==='Escape'){
      if(panel) panel.classList.remove('show');
      input.blur();
    }
  });
  if(panel){
    panel.addEventListener('pointerdown', (e)=>{
      const item = e.target.closest('.sg-item');
      if(!item) return;
      e.preventDefault();
      const btn = item.querySelector('.sg-add');
      cfgAdd(sec.key, input, item.dataset.sym, item.dataset.sec, btn);
    });
  }
});

// ---------- 秒开: 本地缓存 SWR + 首屏骨架 ----------
const QUOTE_CACHE_KEY = 'gp_quote_v1';

function renderSkeleton(){
  const sk = '<div class="sk-card"><div class="sk-line w40"></div><div class="sk-num"></div><div class="sk-line w70"></div></div>';
  el.kpis.innerHTML = sk.repeat(5);
  el.stockGrid.innerHTML = sk.repeat(6);
  if(el.aShareGrid) el.aShareGrid.innerHTML = sk.repeat(3);
  el.macroGrid.innerHTML = sk.repeat(4);
}

function paintCachedQuote(){
  try{
    const raw = localStorage.getItem(QUOTE_CACHE_KEY);
    if(!raw) return false;
    const q = JSON.parse(raw);
    if(!q || !q.hero) return false;
    state.quote = q;
    renderAll(q);
    return true;
  }catch(e){ return false; }
}

function cacheQuote(q){
  try{ localStorage.setItem(QUOTE_CACHE_KEY, JSON.stringify(q)); }catch(e){}
}

// PWA service worker
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=> navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}

// 启动: 有缓存先秒渲染(后台拉新), 无缓存上骨架屏
tick();
updateSegPill();
if(!paintCachedQuote()) renderSkeleton();
fetchLive();
startPolling();