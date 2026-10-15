// Node 原生 fetch (undici): 真 AbortSignal + GBK TextDecoder, 等价 Android OkHttp 直连
const fs = require('fs');
globalThis.window = globalThis;
globalThis.localStorage = { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; }, removeItem(k){ delete this._d[k]; } };
for (const f of ['storage.js','backend.js','service.js']) eval(fs.readFileSync(f,'utf-8'));

(async()=>{
  let fail = 0;
  const check = (name, cond, extra='') => { console.log((cond?'✓':'✗')+' '+name, extra); if(!cond) fail++; };

  // 实时
  const d = await GPService.getLive();
  check('live hero', d.hero && d.hero.price>0, d.hero?.symbol+' '+d.hero?.price);
  check('etfs ≥5', d.etfs.length>=5, d.etfs.length+' 只, AAPL='+d.etfs.find(e=>e.symbol==='AAPL')?.name);
  check('A股中文名', d.ashares.some(a=>a.name==='贵州茅台'), d.ashares.map(a=>a.name).join('/'));
  check('A股时间格式化', /^\d{4}-\d{2}-\d{2}/.test(d.ashares[0]?.time||''), d.ashares[0]?.time);
  check('ashares ≥3', d.ashares.length>=3, d.ashares.length+' 只');
  check('基金', d.funds.length>=3, d.funds.map(f=>f.symbol+':'+f.name+'('+f.change+')').join(', '));
  check('macro 含GC', d.macro.some(m=>m.symbol==='GC'), d.macro.map(m=>m.symbol).join(','));
  // 美债走东财 push2his: 本机 IP 被临时限流时会失败 (curl 同样 000), 手机网络不受影响 → 仅告警
  const bondMiss = d.unresolved.filter(u=>u.sec==='bonds').length;
  const otherMiss = d.unresolved.filter(u=>u.sec!=='bonds');
  check('unresolved 非美债为 0', otherMiss.length===0, JSON.stringify(otherMiss));
  if(bondMiss) console.log('⚠ 美债缺失(本机东财限流, 忽略):', bondMiss);

  // K线
  const ix = await GPService.fetchHist('IXIC','3M','indexes');
  check('IXIC 3M ≥80根', ix.ok && ix.bars.length>=80, ix.bars?.length+' 根');
  const ix1y = await GPService.fetchHist('IXIC','1Y','indexes');
  check('IXIC 1Y ≥200根', ix1y.ok && ix1y.bars.length>=200, ix1y.bars?.length+' 根');
  const aapl = await GPService.fetchHist('AAPL','1Y','etfs');
  check('AAPL 1Y ≥200根', aapl.ok && aapl.bars.length>=200, aapl.bars?.length+' 根');
  const gc = await GPService.fetchHist('GC','3M','futures');
  check('GC 3M ≥50根', gc.ok && gc.bars.length>=50, gc.bars?.length+' 根');
  const sh = await GPService.fetchHist('SH600519','3M','ashares');
  check('茅台 3M ≥50根', sh.ok && sh.bars.length>=50, sh.bars?.length+' 根');

  console.log(fail===0 ? '\n✅ 全链路通过' : `\n❌ ${fail} 项失败`);
  process.exit(fail?1:0);
})();
