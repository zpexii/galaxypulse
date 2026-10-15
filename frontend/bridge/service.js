// ============================================================
// service.js — kline / search / watchlist / history / live 组装
// 依赖 backend.js 和 storage.js (全局 GPBackend / GPStorage)
// ============================================================
(function(global) {
  'use strict';
  const B = global.GPBackend;
  const S = global.GPStorage;

  const STOCK_ALIASES = {
    'AAPL':   {name:'苹果',en:'Apple',sec:'etfs'},
    'MSFT':   {name:'微软',en:'Microsoft',sec:'etfs'},
    'GOOGL':  {name:'谷歌A',en:'Alphabet',sec:'etfs'},
    'GOOG':   {name:'谷歌C',en:'Alphabet',sec:'etfs'},
    'AMZN':   {name:'亚马逊',en:'Amazon',sec:'etfs'},
    'META':   {name:'Meta',en:'Meta',sec:'etfs'},
    'NVDA':   {name:'英伟达',en:'NVIDIA',sec:'etfs'},
    'TSLA':   {name:'特斯拉',en:'Tesla',sec:'etfs'},
    'AMD':    {name:'AMD',en:'AMD',sec:'etfs'},
    'MU':     {name:'美光科技',en:'Micron',sec:'etfs'},
    'INTC':   {name:'英特尔',en:'Intel',sec:'etfs'},
    'TSM':    {name:'台积电',en:'TSMC',sec:'etfs'},
    'AVGO':   {name:'博通',en:'Broadcom',sec:'etfs'},
    'ORCL':   {name:'甲骨文',en:'Oracle',sec:'etfs'},
    'ADBE':   {name:'Adobe',en:'Adobe',sec:'etfs'},
    'CRM':    {name:'Salesforce',en:'Salesforce',sec:'etfs'},
    'NFLX':   {name:'奈飞',en:'Netflix',sec:'etfs'},
    'DIS':    {name:'迪士尼',en:'Disney',sec:'etfs'},
    'BABA':   {name:'阿里巴巴',en:'Alibaba',sec:'etfs'},
    'PDD':    {name:'拼多多',en:'PDD',sec:'etfs'},
    'BIDU':   {name:'百度',en:'Baidu',sec:'etfs'},
    'NIO':    {name:'蔚来',en:'NIO',sec:'etfs'},
    'LI':     {name:'理想',en:'Li Auto',sec:'etfs'},
    'XPEV':   {name:'小鹏',en:'XPeng',sec:'etfs'},
    'JPM':    {name:'摩根大通',en:'JPMorgan',sec:'etfs'},
    'BAC':    {name:'美国银行',en:'Bank of America',sec:'etfs'},
    'V':      {name:'Visa',en:'Visa',sec:'etfs'},
    'MA':     {name:'万事达卡',en:'Mastercard',sec:'etfs'},
    'JNJ':    {name:'强生',en:'Johnson & Johnson',sec:'etfs'},
    'UNH':    {name:'联合健康',en:'UnitedHealth',sec:'etfs'},
    'XOM':    {name:'埃克森美孚',en:'Exxon Mobil',sec:'etfs'},
    'CVX':    {name:'雪佛龙',en:'Chevron',sec:'etfs'},
    'COST':   {name:'好市多',en:'Costco',sec:'etfs'},
    'WMT':    {name:'沃尔玛',en:'Walmart',sec:'etfs'},
    'HD':     {name:'家得宝',en:'Home Depot',sec:'etfs'},
    'MCD':    {name:'麦当劳',en:'McDonalds',sec:'etfs'},
    'KO':     {name:'可口可乐',en:'Coca-Cola',sec:'etfs'},
    'PEP':    {name:'百事可乐',en:'PepsiCo',sec:'etfs'},
    'QQQ':    {name:'纳指100ETF',en:'Invesco QQQ',sec:'etfs'},
    'SPY':    {name:'标普500ETF',en:'SPDR S&P 500',sec:'etfs'},
    'TQQQ':   {name:'纳指3倍做多',en:'ProShares UltraPro QQQ',sec:'etfs'},
    'SQQQ':   {name:'纳指3倍做空',en:'ProShares UltraPro Short QQQ',sec:'etfs'},
    'VOO':    {name:'Vanguard标普500',en:'Vanguard S&P 500',sec:'etfs'},
    'ARKK':   {name:'ARK创新ETF',en:'ARK Innovation',sec:'etfs'},
    'DIA':    {name:'道指ETF',en:'SPDR Dow Jones',sec:'etfs'},
    'IWM':    {name:'罗素2000ETF',en:'iShares Russell 2000',sec:'etfs'},
    'TLT':    {name:'美债20年+ETF',en:'iShares 20+ Year Treasury',sec:'etfs'},
    'GLD':    {name:'黄金ETF',en:'SPDR Gold',sec:'etfs'},
    'SLV':    {name:'白银ETF',en:'iShares Silver',sec:'etfs'},
    'USO':    {name:'原油ETF',en:'United States Oil',sec:'etfs'},
    'UVXY':   {name:'VIX 2倍做多',en:'ProShares Ultra VIX',sec:'etfs'},
    'SZ300088':{name:'长信科技',en:'Changxin Technology',sec:'ashares'},
    'SH600519':{name:'贵州茅台',en:'Kweichow Moutai',sec:'ashares'},
    'SH688981':{name:'中芯国际',en:'SMIC',sec:'ashares'},
    'SH603986':{name:'兆易创新',en:'GigaDevice',sec:'ashares'},
    'SZ300782':{name:'卓胜微',en:'Maxscend',sec:'ashares'},
    'SH688008':{name:'澜起科技',en:'Montage Tech',sec:'ashares'},
    'SZ002371':{name:'北方华创',en:'Naura',sec:'ashares'},
    'SH600584':{name:'长电科技',en:'JCET',sec:'ashares'},
    'SZ002156':{name:'通富微电',en:'TFME',sec:'ashares'},
    'SH688126':{name:'沪硅产业',en:'Shanghai Silicon',sec:'ashares'},
    'SZ300661':{name:'圣邦股份',en:'SG Micro',sec:'ashares'},
    'SZ300604':{name:'长川科技',en:'Changchuan',sec:'ashares'},
    'SH603501':{name:'豪威集团',en:'Will Semiconductor',sec:'ashares'},
    'SZ002049':{name:'紫光国微',en:'Unigroup Guoxin',sec:'ashares'},
    'SZ300458':{name:'全志科技',en:'Allwinner',sec:'ashares'},
    'SH688047':{name:'龙芯中科',en:'Loongson',sec:'ashares'},
    'SH688825':{name:'长鑫科技',en:'CXMT',sec:'ashares'},
    'SZ002245':{name:'蔚蓝锂芯',en:'Weilan Lithium',sec:'ashares'},
    'SZ300115':{name:'长盈精密',en:'Everwin',sec:'ashares'},
    'SZ300684':{name:'中石科技',en:'Zhongshi',sec:'ashares'},
    'SH603290':{name:'斯达半导',en:'Starpower',sec:'ashares'},
    'SZ002185':{name:'华天科技',en:'Hua Tian Tech',sec:'ashares'},
    'SZ000001':{name:'平安银行',en:'Ping An Bank',sec:'ashares'},
    'SH601318':{name:'中国平安',en:'Ping An Insurance',sec:'ashares'},
    'SH600036':{name:'招商银行',en:'China Merchants',sec:'ashares'},
    'SZ000858':{name:'五粮液',en:'Wuliangye',sec:'ashares'},
    'SZ000333':{name:'美的集团',en:'Midea',sec:'ashares'},
    'SH601899':{name:'紫金矿业',en:'Zijin Mining',sec:'ashares'},
    'SH600900':{name:'长江电力',en:'Yangtze Power',sec:'ashares'},
    'FU018147':{name:'建信新兴市场混合C',en:'CXM Emerging Markets C',sec:'funds'},
    'FU005827':{name:'易方达蓝筹精选混合',en:'E Fund Blue Chip Select',sec:'funds'},
    'FU161725':{name:'招商中证白酒指数A',en:'CMF Baijiu Index A',sec:'funds'},
    'FU110011':{name:'易方达优质精选混合',en:'E Fund Quality Select',sec:'funds'},
    'IXIC':   {name:'纳斯达克综合',en:'NASDAQ Composite',sec:'index'},
    'NDX':    {name:'纳斯达克100',en:'NASDAQ 100',sec:'index'},
    'INX':    {name:'标普500',en:'S&P 500',sec:'index'},
    'SPX':    {name:'标普500',en:'S&P 500',sec:'index'},
    'DJI':    {name:'道琼斯',en:'Dow Jones',sec:'index'},
    'RUT':    {name:'罗素2000',en:'Russell 2000',sec:'index'},
    'VIX':    {name:'恐慌指数',en:'VIX',sec:'index'},
    'DINIW':  {name:'美元指数',en:'DXY',sec:'fx'},
    'USDJPY': {name:'美元兑日元',en:'USD/JPY',sec:'fx'},
    'EURUSD': {name:'欧元兑美元',en:'EUR/USD',sec:'fx'},
    'USDCNY': {name:'美元兑人民币',en:'USD/CNY',sec:'fx'},
    'US10Y':  {name:'美国10年期国债',en:'US 10Y Yield',sec:'bonds'},
    'US30Y':  {name:'美国30年期国债',en:'US 30Y Yield',sec:'bonds'},
    'GC':     {name:'COMEX黄金',en:'Gold',sec:'futures'},
    'SI':     {name:'纽约白银',en:'Silver',sec:'futures'},
    'CL':     {name:'NYMEX原油',en:'WTI Crude',sec:'futures'},
    'NQ':     {name:'纳指期货',en:'Nasdaq 100 Fut',sec:'futures'},
    'NG':     {name:'天然气',en:'Natural Gas',sec:'futures'},
    'HG':     {name:'铜',en:'Copper',sec:'futures'},
  };

  const RANGES = { '1W': 7, '1M': 30, '3M': 90, '6M': 130, '1Y': 252, '2Y': 504, 'ALL': 1180 };
  const HIST = {
    IXIC: ['tx', 'us.IXIC'], INX: ['tx', 'us.INX'], DJI: ['tx', 'us.DJI'],
    AAPL: ['tx', 'usAAPL.OQ'], NVDA: ['tx', 'usNVDA.OQ'], TSLA: ['tx', 'usTSLA.OQ'],
    QQQ: ['tx', 'usQQQ.OQ'], SPY: ['tx', 'us.INX'], TQQQ: ['tx', 'usTQQQ.OQ'],
    GC: ['sina', 'GC'], SI: ['sina', 'SI'], CL: ['sina', 'CL'],
  };

  // -------------------- Kline cache --------------------
  const KLINE_CACHE = {};
  const KLINE_TTL = 1800; // 30min
  const KLINE_FAIL_TTL = 60;

  async function _txDayKline(src, n, fq = true) {
    const p = fq
      ? `${src},day,,,${Math.max(n, 60)},qfq`
      : `${src},day,,,${Math.max(n, 60)}`;
    const url = `https://web.ifzq.gtimg.cn/appstock/app/${fq ? 'fqkline' : 'kline'}/get?param=${encodeURIComponent(p)}`;
    const txt = await B.httpGet(url, { enc: 'utf-8', timeout: 8 });
    if (!txt) return [];
    let j; try { j = JSON.parse(txt); } catch(e) { return []; }
    const node = (j.data || {})[src] || {};
    const rows = node.qfqday || node.day || [];
    const bars = [];
    for (const r of rows.slice(rows.length - n)) {
      if (r.length < 6) continue;
      bars.push({ d: r[0], o: parseFloat(r[1]), c: parseFloat(r[2]), h: parseFloat(r[3]), l: parseFloat(r[4]), v: parseFloat(r[5]) });
    }
    return bars;
  }

  async function _sinaFutureKline(sym, n) {
    const url = `https://stock.finance.sina.com.cn/futures/api/jsonp.php/var%20_t=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=${sym}`;
    const txt = await B.httpGet(url, { enc: 'utf-8', timeout: 8 });
    const m = (txt || '').match(/(\[[\s\S]*\])/);
    if (!m) return [];
    let rows; try { rows = JSON.parse(m[1]); } catch(e) { return []; }
    const bars = [];
    for (const r of rows.slice(rows.length - n)) {
      bars.push({ d: r.date, o: parseFloat(r.open), c: parseFloat(r.close), h: parseFloat(r.high), l: parseFloat(r.low), v: parseFloat(r.volume || 0) });
    }
    return bars;
  }

  async function _emDayKline(symbol, n) {
    const code = symbol.replace(/\D/g, '');
    const mkt = symbol.toUpperCase().startsWith('SH') ? '1' : '0';
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${mkt}.${code}`
              + '&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56'
              + `&klt=101&fqt=1&end=20500101&lmt=${Math.max(n, 60)}`
              + '&ut=fa5fd1943c7b386f172d6893dbfba10b';
    const txt = await B.httpGet(url, { headers: { Referer: 'https://quote.eastmoney.com/' }, enc: 'utf-8', timeout: 8 });
    if (!txt || !txt.trim().startsWith('{')) return [];
    let j; try { j = JSON.parse(txt); } catch(e) { return []; }
    const rows = ((j.data || {}).klines) || [];
    const bars = [];
    for (const row of rows.slice(rows.length - n)) {
      const p = row.split(',');
      if (p.length < 6) continue;
      bars.push({ d: p[0], o: parseFloat(p[1]), c: parseFloat(p[2]), h: parseFloat(p[3]), l: parseFloat(p[4]), v: parseFloat(p[5]) });
    }
    return bars;
  }

  async function _emBondKline(sym, n = 3) {
    const secid = B.BOND_SECIDS[sym.toUpperCase()];
    if (!secid) return [];
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}`
              + '&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56'
              + `&klt=101&fqt=0&end=20500101&lmt=${Math.max(n, 3)}`
              + '&ut=fa5fd1943c7b386f172d6893dbfba10b';
    const txt = await B.httpGet(url, { headers: { Referer: 'https://quote.eastmoney.com/' }, enc: 'utf-8', timeout: 8 });
    if (!txt || !txt.trim().startsWith('{')) return [];
    let j; try { j = JSON.parse(txt); } catch(e) { return []; }
    const rows = ((j.data || {}).klines) || [];
    const bars = [];
    for (const row of rows) {
      const p = row.split(',');
      if (p.length < 5) continue;
      bars.push({ d: p[0], o: parseFloat(p[1]), c: parseFloat(p[2]), h: parseFloat(p[3]), l: parseFloat(p[4]), v: p[5] ? parseFloat(p[5]) : 0 });
    }
    return bars;
  }

  async function _fundNavline(sym, n) {
    const code = sym.toUpperCase().startsWith('FU') ? sym.slice(2) : sym;
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=${Math.max(n, 60)}`;
    const txt = await B.httpGet(url, { headers: { Referer: 'https://fundf10.eastmoney.com/' }, enc: 'utf-8', timeout: 8 });
    if (!txt) return [];
    let j; try {
      const m = txt.trim().match(/\((\{[\s\S]*\})\)\s*;?$/);
      j = JSON.parse(m ? m[1] : txt);
    } catch(e) { return []; }
    const rows = ((j.Data || {}).LSJZList) || [];
    const bars = [];
    for (const r of rows) {
      if (r.DWJZ) bars.push({ d: r.FSRQ, c: parseFloat(r.DWJZ) });
    }
    bars.reverse();
    return bars.slice(bars.length - n);
  }

  async function fetchKline(symbol, sec, n = 30) {
    symbol = (symbol || '').toUpperCase();
    sec = (sec || '').toLowerCase();
    if (sec === 'ashares') {
      let bars = await _txDayKline(symbol.toLowerCase(), n);
      if (!bars.length) bars = await _emDayKline(symbol, n);
      return { type: 'candles', bars };
    }
    if (sec === 'funds') return { type: 'line', bars: await _fundNavline(symbol, n) };
    if (sec === 'index') return { type: 'candles', bars: await _txDayKline('us.' + symbol, n, false) };
    if (sec === 'futures') return { type: 'candles', bars: await _sinaFutureKline(symbol, n) };
    if (sec === 'bonds') return { type: 'candles', bars: await _emBondKline(symbol, n) };
    if (sec === 'fx') return { type: 'line', bars: [] };
    // etfs / 美股
    let bars = await _txDayKline(`us${symbol}.OQ`, n);
    if (!bars.length) bars = await _txDayKline(`us${symbol}.N`, n);
    return { type: 'candles', bars };
  }

  async function klineCached(symbol, sec, n = 30) {
    const key = sec + ':' + symbol + ':' + n;
    const now = Date.now() / 1000;
    const old = KLINE_CACHE[key];
    if (old && old.data && now - old.at < KLINE_TTL) return old.data;
    if (old && !old.data && now - old.at < KLINE_FAIL_TTL) return null;
    let data = null;
    try {
      const r = await fetchKline(symbol, sec, n);
      if (r.bars && r.bars.length) data = r;
    } catch(e) {}
    KLINE_CACHE[key] = { at: now, data };
    if (data) return data;
    if (old && old.data) return old.data;
    return null;
  }

  // -------------------- Search --------------------
  function searchStocks(q, limit = 10) {
    if (!q) return [];
    q = q.trim().toLowerCase();
    if (!q) return [];
    const pyAlias = {
      'pg':'AAPL','wg':'AAPL','pingguo':'AAPL','wrs':'MSFT','mr':'MSFT','weiruan':'MSFT',
      'gg':'GOOGL','google':'GOOGL','gug':'GOOGL','ymx':'AMZN','yx':'AMZN','yamaxun':'AMZN',
      'lsp':'META','fb':'META','lianshu':'META','ywd':'NVDA','np':'NVDA','yingweida':'NVDA',
      'tsl':'TSLA','tesla':'TSLA','telong':'TSLA','mgkj':'MU','mg':'MU','meiguang':'MU',
      'yine':'INTC','yt':'INTC','yingtel':'INTC','tjj':'TSM','taijidian':'TSM',
      'bt':'BABA','albb':'BABA','alibab':'BABA','pdd':'PDD','bd':'BIDU','baidu':'BIDU',
      'wl':'NIO','weilai':'NIO','lx':'LI','lixiang':'LI','xp':'XPEV','xiaopeng':'XPEV',
      'qqq':'QQQ','spy':'SPY','nzx':'IXIC','nazong':'IXIC','bp500':'INX','dqs':'DJI','daoqiong':'DJI',
      'myzs':'DINIW','dxy':'DINIW','hj':'GC','huangjin':'GC','gold':'GC','comexhj':'GC',
      'by':'SI','baiyin':'SI','silver':'SI','yy':'CL','yuanyou':'CL','oil':'CL','nymex':'CL',
      'nq':'NQ','nazhiqihuo':'NQ','ndxf':'NQ',
      'us10y':'US10Y','10y':'US10Y','mz10':'US10Y','us30y':'US30Y','30y':'US30Y','mz30':'US30Y',
      '国债':'US10Y','美债':'US10Y','guozhai':'US10Y','meizhai':'US10Y','trq':'TQQQ','sbz':'TQQQ',
      'cxkj':'SZ300088','changxin':'SZ300088','长信':'SZ300088',
      'gzmt':'SH600519','maotai':'SH600519','茅台':'SH600519',
      'zxgj':'SH688981','smic':'SH688981','中芯':'SH688981',
      'pah':'SZ000001','pingan':'SZ000001','zsyh':'SH600036','zhaoshang':'SH600036',
      'wly':'SZ000858','wuliangye':'SZ000858','mdjt':'SZ000333','midea':'SZ000333',
      'zjky':'SH601899','zijin':'SH601899','cjdl':'SH600900','changjiang':'SH600900',
      'jxxx':'FU018147','jianxin':'FU018147','建信':'FU018147','yfd':'FU005827','yifangda':'FU005827','易方达':'FU005827',
      'zs':'FU161725','zhaoshang':'FU161725','招商':'FU161725','白酒':'FU161725',
    };
    const results = [];
    const seen = new Set();
    function add(code) {
      if (seen.has(code)) return;
      const info = STOCK_ALIASES[code.toUpperCase()];
      if (!info) return;
      seen.add(code);
      results.push(Object.assign({}, info, { symbol: code.toUpperCase() }));
    }
    if (pyAlias[q]) add(pyAlias[q]);
    if (q === '美债' || q === '国债' || q === 'meizhai') { add('US10Y'); add('US30Y'); }
    for (const code of Object.keys(STOCK_ALIASES)) {
      const c = code.toLowerCase();
      if (c.startsWith(q)) add(code);
      if (results.length >= limit) return results;
    }
    for (const code of Object.keys(STOCK_ALIASES)) {
      if (code.toLowerCase().includes(q)) add(code);
      if (results.length >= limit) return results;
    }
    for (const [code, info] of Object.entries(STOCK_ALIASES)) {
      if (info.name.toLowerCase().includes(q) || info.en.toLowerCase().includes(q)) add(code);
      if (results.length >= limit) return results;
    }
    return results;
  }

  // -------------------- Watchlist --------------------
  function loadWatchlist() { return S.load(); }
  function saveWatchlist(wl) {
    const base = JSON.parse(JSON.stringify(S.DEFAULT));
    for (const k of Object.keys(base)) {
      if (Array.isArray(base[k]) && Array.isArray(wl && wl[k])) {
        base[k] = wl[k].filter(x => typeof x === 'string' && x.trim()).map(x => x.toUpperCase());
        base[k] = [...new Set(base[k])];
      }
    }
    if (typeof wl.hero === 'string' && wl.hero.trim()) base.hero = wl.hero.toUpperCase();
    if (!base.indexes.includes(base.hero)) base.hero = base.indexes[0] || S.DEFAULT.hero;
    S.save(base);
    // invalidate live cache
    LIVE_CACHE.at = 0; LIVE_CACHE.data = null; LIVE_CACHE.key = null;
    return base;
  }

  // -------------------- Quote resolver --------------------
  async function resolveQuote(sym, kind) {
    sym = (sym || '').toUpperCase();
    try {
      if (kind === 'stock') {
        const dropped = {};
        const rec = B.parseSinaUs(await B.sinaGet('gb_' + sym.toLowerCase()), dropped)[sym];
        if (rec) return rec;
        return { ok: false, symbol: sym, reason: B.US_MISS_TEXT[dropped[sym]] || '上游无此代码' };
      }
      if (kind === 'astock') {
        const code = sym.toLowerCase();
        const rec = B.parseSinaA(await B.sinaGet(code))[sym.toUpperCase()];
        return rec || { ok: false, symbol: sym, reason: '上游无此代码' };
      }
      if (kind === 'fund') {
        const code = sym.startsWith('FU') ? sym.slice(2) : sym;
        const rec = B.parseSinaFund(await B.sinaGet('fu_' + code))[sym.toUpperCase()];
        return rec || { ok: false, symbol: sym, reason: '上游无此代码' };
      }
      if (kind === 'index') {
        const rec = B.parseTxUs(await B.txGet('us' + sym))[sym];
        return rec || { ok: false, symbol: sym, reason: '上游无此代码' };
      }
      if (kind === 'bonds') {
        const r = await B.emBondQuote(sym);
        return r || { ok: false, symbol: sym, reason: '上游无此代码' };
      }
      if (kind === 'fx') {
        const rec = B.parseSinaIdx(await B.sinaGet(sym))[sym];
        return rec || { ok: false, symbol: sym, reason: '上游无此代码' };
      }
      if (kind === 'futures') {
        let r = B.parseTxHf(await B.txGet('hf_' + sym))[sym];
        if (!r) r = B.parseSinaHf(await B.sinaGet('hf_' + sym))[sym];
        if (!r && sym === 'GC') r = await B.cngoldQuote();
        if (!r && B.EM_FUTURE_SECIDS[sym]) r = await B.emFutureQuote(sym);
        return r || { ok: false, symbol: sym, reason: '上游无此代码' };
      }
    } catch(e) { return { ok: false, symbol: sym, reason: '网络错误' }; }
    return { ok: false, symbol: sym, reason: '未知类型' };
  }

  // -------------------- History --------------------
  function _histPayload(symbol, rg, bars, typ, name) {
    if (!bars || !bars.length) return { ok: false, reason: 'empty' };
    if (typ === 'line') {
      for (const b of bars) { b.o = b.c; b.h = b.c; b.l = b.c; b.v = 0; }
    }
    const firstC = bars[0].c, lastC = bars[bars.length - 1].c;
    const dec = lastC < 100 ? 4 : 2;
    return {
      ok: true, symbol, name: name || symbol,
      range: rg, type: typ, bars,
      firstClose: Math.round(firstC * 100) / 100,
      lastClose: Math.round(lastC * 100) / 100,
      decimals: dec,
      change: Math.round((lastC - firstC) * Math.pow(10, dec)) / Math.pow(10, dec),
      changePct: firstC ? Math.round((lastC - firstC) / firstC * 10000) / 100 : 0,
    };
  }

  async function fetchHist(symbol, rg = '3M', sec) {
    symbol = (symbol || '').toUpperCase();
    const n = RANGES[rg] || 90;
    if (sec) {
      const data = await klineCached(symbol, sec, n);
      if (!data) return { ok: false, reason: 'no_history' };
      const alias = STOCK_ALIASES[symbol] || {};
      return _histPayload(symbol, rg, data.bars, data.type, alias.name || symbol);
    }
    if (!HIST[symbol]) return { ok: false, reason: 'no_history' };
    const [kind, src] = HIST[symbol];
    let bars = [];
    try {
      if (kind === 'tx') {
        const p = `${src},day,2015-01-01,${new Date().toISOString().slice(0,10)},${Math.max(n, 60)},`;
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(p)}`;
        const txt = await B.httpGet(url, { enc: 'utf-8', timeout: 10 });
        const j = JSON.parse(txt);
        const node = (j.data || {})[src] || {};
        const rows = node.day || node.qfqday || [];
        for (const r of rows.slice(rows.length - n)) {
          if (r.length < 6) continue;
          bars.push({ d: r[0], o: parseFloat(r[1]), c: parseFloat(r[2]), h: parseFloat(r[3]), l: parseFloat(r[4]), v: parseFloat(r[5]) });
        }
      } else {
        bars = await _sinaFutureKline(src, n);
      }
    } catch(e) { return { ok: false, reason: 'error' }; }
    const histName = Object.assign({}, B.NAMES, { SPY: '标普500ETF·SPY' });
    return _histPayload(symbol, rg, bars, 'candles', histName[symbol] || symbol);
  }

  // -------------------- Live cache + assembly --------------------
  const LIVE_CACHE = { at: 0, key: null, data: null };
  const LIVE_TTL = 6;

  function volText(v) {
    if (!v) return '';
    try { v = parseFloat(v); } catch(e) { return ''; }
    if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (v >= 1e4) return Math.round(v / 1e4) + '万';
    return Math.round(v);
  }

  // Spark cache
  const SPARK_CACHE = { at: 0, data: [] };
  const SPARK_TTL = 1800;
  async function _sparkCached() {
    const now = Date.now() / 1000;
    if (SPARK_CACHE.data && now - SPARK_CACHE.at < SPARK_TTL) return SPARK_CACHE.data;
    try {
      const txt = await B.httpGet(
        'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=usQQQ.OQ,day,,,30,qfq',
        { enc: 'utf-8', timeout: 6 });
      const j = JSON.parse(txt);
      const node = ((j.data || {})['usQQQ.OQ']) || {};
      const rows = node.qfqday || node.day || [];
      const closes = rows.slice(-30).map(r => parseFloat(r[2]));
      SPARK_CACHE.at = now; SPARK_CACHE.data = closes;
      return closes;
    } catch(e) { return SPARK_CACHE.data || []; }
  }

  async function fetchAll(wl) {
    wl = wl || S.load();
    const etfsSyms = wl.etfs || [];
    const idxSyms = wl.indexes || [];
    const aSyms = wl.ashares || [];
    const fundSyms = wl.funds || [];
    const bondSyms = wl.macroBonds || [];
    const hfSyms = wl.macroFutures || [];

    const result = {
      kpis: [], etfs: [], ashares: [], funds: [], macro: [], hero: null,
      etfTime: '', aShareTime: '', fundTime: '', macroTime: '',
      fetchedAt: new Date().toTimeString().slice(0, 8), unresolved: [],
    };
    const miss = (symbol, sec, reason) => result.unresolved.push({ symbol, sec, reason });

    // ====================================================================
    // 【Android 主力】全走腾讯 qt.gtimg.cn (原生 OkHttp 直连, 零反爬)
    // 浏览器环境下腾讯可能被 CORS 拦 —— api.js 的 fallback 兜底
    // ====================================================================
    const jobs = {};
    if (etfsSyms.length) jobs.txUsa = B.txGet(etfsSyms.map(s => 'us' + s).join(','));
    if (idxSyms.length)  jobs.txIdx  = B.txGet(idxSyms.map(s => 'us' + s).join(','));
    if (aSyms.length)    jobs.txA    = B.txGet(aSyms.map(s => s.toLowerCase()).join(','));
    if (hfSyms.length)   jobs.txFut  = B.txGet(hfSyms.map(s => 'hf_' + s).join(','));

    // 东财美债 (原样保留, Node 原生 OK)
    if (bondSyms.length) {
      jobs.emBonds = (async () => { const m = {}; for (const s of bondSyms) m[s] = await B.emBondQuote(s); return m; })();
    }

    // 天天基金净值 (腾讯拿不到基金, 东财天天 LSJZ 是目前唯一原生 OK 的源)
    if (fundSyms.length) {
      jobs.emFunds = (async () => {
        const m = {};
        for (const s of fundSyms.filter(s => s.startsWith('FU'))) {
          const code = s.slice(2);
          try {
            const txt = await B.httpGet(
              `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=3`,
              { headers: { Referer: 'https://fundf10.eastmoney.com/' }, enc: 'utf-8', timeout: 6 });
            let j = JSON.parse(txt);
            const list = (j.Data && j.Data.LSJZList) || [];
            const latest = list[0] || {};
            m[s.toUpperCase()] = {
              symbol: s.toUpperCase(), name: STOCK_ALIASES[s.toUpperCase()]?.name || code,
              price: parseFloat(latest.DWJZ || '0') || 0,
              changePct: parseFloat(latest.JZZZL || '0') || 0,
              time: latest.FSRQ || '',
              market: 'FUND', volumeText: '基金',
            };
          } catch(e) { m[s.toUpperCase()] = null; }
        }
        return m;
      })();
    }

    jobs.spark = _sparkCached();

    // Concurrent resolve
    const results = {};
    await Promise.all(Object.keys(jobs).map(async k => {
      try { results[k] = await Promise.race([jobs[k], new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 6000))]); }
      catch (e) { results[k] = null; }
    }));

    const txUsa = B.parseTxUsa(results.txUsa || '');
    const txIdx = B.parseTxIndex(results.txIdx || '');
    const txA   = B.parseTxA(results.txA || '');
    const txFut = B.parseTxFutures(results.txFut || '');

    // ETFs / 美股
    for (const sym of etfsSyms) {
      const r = txUsa[sym] || txIdx[sym];
      if (r) {
        r.name = B.NAMES[sym] || r.name;
        r.volumeText = volText(r.volume);
        result.etfs.push(r);
      } else miss(sym, 'etfs', '上游无此代码');
    }
    result.etfTime = result.etfs[0] ? result.etfs[0].time : '';

    // A-shares
    for (const sym of aSyms) {
      const r = txA[sym.toUpperCase()];
      if (r) { r.volumeText = volText(r.volume); result.ashares.push(r); }
      else miss(sym, 'ashares', '上游无此代码');
    }
    result.aShareTime = result.ashares[0] ? result.ashares[0].time : '';

    // Funds (from emFunds)
    const emFunds = results.emFunds || {};
    for (const sym of fundSyms) {
      const r = emFunds[sym.toUpperCase()];
      if (r) result.funds.push(r);
      else miss(sym, 'funds', '上游无此代码');
    }
    result.fundTime = result.funds[0] ? result.funds[0].time : '';

    // Hero
    const heroIdx = wl.hero && idxSyms.includes(wl.hero) ? wl.hero : (idxSyms[0] || null);
    const hero = heroIdx ? txIdx[heroIdx] : null;
    if (hero) { hero.name = B.NAMES[heroIdx] || hero.name; hero.spark = results.spark || []; }
    result.hero = hero;

    // KPI 指数条
    for (const x of idxSyms) {
      const r = txIdx[x];
      if (r) result.kpis.push({ name: B.NAMES[x] || r.name, value: r.price, changePct: r.changePct, decimals: 2, tag: '指数' });
      else miss(x, 'index', '上游无此代码');
    }

    // Macro: bonds + futures
    const bondsMap = results.emBonds || {};
    for (const code of bondSyms) {
      const r = bondsMap[code];
      if (r) result.macro.push(r);
      else miss(code, 'bonds', '上游无此代码');
    }
    for (const h of hfSyms) {
      let r = txFut[h];
      if (!r && B.EM_FUTURE_SECIDS[h]) {
        try { r = await B.emFutureQuote(h); } catch(e) {}
      }
      if (r) { r.name = B.NAMES[h] || r.name; result.macro.push(r); }
      else miss(h, 'futures', '上游无此代码');
    }
    result.macroTime = result.macro[0] ? result.macro[0].time : '';

    // KPI 附加 (宏观期货, 非 bonds)
    for (const m of result.macro.filter(x => x.sec !== 'bonds').slice(0, 2)) {
      result.kpis.push({ name: m.name, value: m.price, changePct: m.changePct, decimals: 2, tag: '指标' });
    }

    return result;
  }

  async function getLive() {
    const wl = S.load();
    const key = JSON.stringify(wl);
    const now = Date.now() / 1000;
    if (LIVE_CACHE.data !== null && LIVE_CACHE.key === key && now - LIVE_CACHE.at < LIVE_TTL) return LIVE_CACHE.data;
    const data = await fetchAll(wl);
    LIVE_CACHE.at = now; LIVE_CACHE.key = key; LIVE_CACHE.data = data;
    return data;
  }

  global.GPService = {
    loadWatchlist, saveWatchlist, searchStocks,
    resolveQuote, fetchHist, fetchAll, getLive,
    klineCached, STOCK_ALIASES, RANGES, HIST, volText,
  };
})(typeof window !== 'undefined' ? window : globalThis);
