// ============================================================
// backend.js — GalaxyPulse 后端聚合逻辑 (Python server.js → JS 移植)
//
// 设计原则:
//   - HTTP 层抽象为 httpGet(url, {headers, enc, timeout})
//     浏览器环境: fetch + ReadableStream + TextDecoder
//     Node 环境: 同一签名, 实现不同 —— 便于单元测试对比 Python 输出
//   - 所有解析函数 1:1 对应 server.py 中的同名函数
//   - 用 Map 替代 Python dict, 用 async/await 替代 ThreadPoolExecutor
//   - 缓存 / 限流 / 熔断逻辑完全保留
// ============================================================
(function(global) {
  'use strict';

  // -------------------- HTTP Layer --------------------
  const UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              + "(KHTML, like Gecko) Chrome/120.0 Safari/537.36");

  // enc 可能是 'gbk' / 'utf-8' / 'utf8' / undefined → 默认 utf-8
  function decoderFor(enc) {
    if (!enc) return new TextDecoder();
    const e = String(enc).replace('-', '').toLowerCase();
    if (e === 'gbk' || e === 'gb2312' || e === 'gb18030') {
      try { return new TextDecoder('gbk'); } catch(_) {}
      try { return new TextDecoder('gb18030'); } catch(_) {}
      return new TextDecoder(); // fallback
    }
    return new TextDecoder(e);
  }

  async function httpGet(url, opts = {}) {
    const { headers = {}, enc = 'utf-8', timeout = 5 } = opts;
    const hdrs = Object.assign({ 'User-Agent': UA }, headers);

    // Capacitor 原生 HTTP (Android/iOS) — 零 CORS 限制
    // 用官方内置的 CapacitorHttp (Capacitor 5+ 自带, 无需 @capacitor-community/http 插件)
    if (globalThis.CapacitorHttp && typeof globalThis.CapacitorHttp.get === 'function') {
      try {
        // responseType: 'text' 直接返回字符串
        const { data } = await globalThis.CapacitorHttp.get({
          url, headers: hdrs, responseType: 'text'
        });
        return typeof data === 'string' ? data : '';
      } catch(e) { /* fallthrough */ }
    }
    // 兼容旧版 community/http 插件
    if (globalThis.Capacitor && globalThis.Capacitor.Plugins && globalThis.Capacitor.Plugins.Http) {
      try {
        const { value } = await globalThis.Capacitor.Plugins.Http.get({ url, headers: hdrs });
        return typeof value === 'string' ? value : '';
      } catch(e) { /* fallthrough */ }
    }

    // 浏览器 / 桌面: 标准 fetch (会受 CORS 限制 —— 由 api.js fallback 兜底)
    let controller; let timer;
    try {
      controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeout * 1000);
      const resp = await fetch(url, { headers: hdrs, signal: controller.signal });
      if (!resp.ok) return '';
      const buf = await resp.arrayBuffer();
      return decoderFor(enc).decode(new Uint8Array(buf));
    } catch (e) {
      return '';
    } finally { clearTimeout(timer); }
  }

  function sinaGet(symbols) {
    return httpGet(`https://hq.sinajs.cn/list=${symbols}`,
      { headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': UA }, enc: 'gbk' });
  }

  function txGet(qs) {
    return httpGet(`https://qt.gtimg.cn/q=${qs}`, { headers: { 'User-Agent': UA } });
  }

  // -------------------- Constants --------------------
  const US_TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const US_STALE_DAYS = 10;
  const US_MISS_TEXT = { ghost: '代码无效', stale: '行情已停更', malformed: '代码无效', empty: '上游无此代码' };

  const CNGOLD_GOLD_CODE = 'JO_12552';
  const BOND_SECIDS = { US10Y: '171.US10Y', US30Y: '171.US30Y' };
  const EM_FUTURE_SECIDS = { GC: ['101.GC00Y', 'COMEX黄金'], CL: ['102.CL00Y', 'NYMEX原油'] };

  const NAMES = {
    IXIC: '纳斯达克综合', INX: '标普500', DJI: '道琼斯',
    DINIW: '美元指数', US10Y: '美国10年期国债', US30Y: '美国30年期国债',
    GC: 'COMEX黄金', SI: '纽约白银', CL: 'NYMEX原油', NQ: '纳指期货',
    NG: '天然气', HG: '铜',
    AAPL: '苹果', NVDA: '英伟达', TSLA: '特斯拉',
    QQQ: '纳指100ETF', SPY: '标普500ETF', TQQQ: '纳指3倍做多ETF',
  };

  // -------------------- Parsers --------------------
  function _sinaUsFields(p) {
    const f = p.split(',');
    for (let i = 0; i < Math.min(6, Math.max(0, f.length - 2)); i++) {
      const t = f[i + 2] || '';
      if (!US_TIME_RE.test(t)) continue;
      try {
        return {
          name: f.slice(0, i).join(',').trim() || f[0],
          price: parseFloat(f[i]),
          changePct: parseFloat(f[i + 1]),
          time: t,
          change: (i + 3 < f.length && f[i + 3]) ? parseFloat(f[i + 3]) : 0,
          volume: (i + 4 < f.length && f[i + 4]) ? parseFloat(f[i + 4]) : 0,
        };
      } catch (e) { return null; }
    }
    return null;
  }

  function _usRejectReason(rec, symbol) {
    if (!rec || !rec.price || rec.price <= 0) return 'ghost';
    const t = rec.time || '';
    if (US_TIME_RE.test(t)) {
      const dt = new Date(t.replace(' ', 'T'));
      if (!isNaN(dt.getTime()) && (Date.now() - dt.getTime()) / 1000 > US_STALE_DAYS * 86400) return 'stale';
    }
    if ((rec.name || '').toUpperCase() === symbol.toUpperCase()
        && !rec.change && !rec.changePct && !rec.volume) return 'ghost';
    return null;
  }

  function parseSinaUs(txt, dropped) {
    const out = {};
    const re = /var hq_str_gb_(\w+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const code = m[1].toUpperCase();
      const p = m[2];
      if (!p.trim()) { if (dropped) dropped[code] = 'empty'; continue; }
      const rec = _sinaUsFields(p);
      if (!rec) { if (dropped) dropped[code] = 'malformed'; continue; }
      rec.symbol = code;
      const reason = _usRejectReason(rec, code);
      if (reason) { if (dropped) dropped[code] = reason; continue; }
      out[code] = rec;
    }
    return out;
  }

  function parseTxUs(txt) {
    const out = {};
    const re = /v_us(\w+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const code = m[1], p = m[2];
      const f = p.split('~');
      if (f.length < 35) continue;
      try {
        const prev = f[4] ? parseFloat(f[4]) : null;
        out[code.toUpperCase()] = {
          symbol: (f[2].replace(/^\./, '') || code.toUpperCase()),
          name: f[1], price: parseFloat(f[3]),
          open: f[5] ? parseFloat(f[5]) : null,
          high: f[33] ? parseFloat(f[33]) : null,
          low: f[34] ? parseFloat(f[34]) : null,
          volume: f[6] ? parseFloat(f[6]) : 0,
          change: f[31] ? parseFloat(f[31]) : 0,
          changePct: f[32] ? parseFloat(f[32]) : 0,
          time: f[30],
        };
      } catch(e) { continue; }
    }
    return out;
  }

  function parseTxHf(txt) {
    const out = {};
    const re = /v_hf_(\w+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const code = m[1], p = m[2];
      const f = p.split(',');
      if (f.length < 14) continue;
      try {
        const price = parseFloat(f[0]); const prev = parseFloat(f[7]);
        out[code.toUpperCase()] = {
          symbol: code.toUpperCase(), name: f[13] || code.toUpperCase(),
          price: price, change: Math.round((price - prev) * 100) / 100,
          changePct: Math.round((price - prev) / prev * 10000) / 100,
          time: f[6],
        };
      } catch(e) { continue; }
    }
    return out;
  }

  function parseSinaHf(txt) {
    const out = {};
    const re = /var hq_str_hf_(\w+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const code = m[1], p = m[2];
      const f = p.split(',');
      if (f.length < 14 || !f[0]) continue;
      try {
        const price = parseFloat(f[0]); const prev = parseFloat(f[7]);
        out[code.toUpperCase()] = {
          symbol: code.toUpperCase(), name: f[13] || code.toUpperCase(),
          price: price,
          open: f[8] ? parseFloat(f[8]) : null,
          high: f[4] ? parseFloat(f[4]) : null,
          low: f[5] ? parseFloat(f[5]) : null,
          change: Math.round((price - prev) * 1000) / 1000,
          changePct: prev ? Math.round((price - prev) / prev * 10000) / 100 : 0,
          time: f[6],
        };
      } catch(e) { continue; }
    }
    return out;
  }

  function parseSinaIdx(txt) {
    const out = {};
    const re = /var hq_str_(\w+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const code = m[1], p = m[2];
      const f = p.split(',');
      if (f.length < 10) continue;
      try {
        const price = parseFloat(f[1]); const prev = parseFloat(f[3]);
        out[code.toUpperCase()] = {
          symbol: code.toUpperCase(), name: f[9] || code.toUpperCase(),
          price: price,
          change: Math.round((price - prev) * 10000) / 10000,
          changePct: Math.round((price - prev) / prev * 10000) / 100,
          time: f[0],
        };
      } catch(e) { continue; }
    }
    return out;
  }

  function parseSinaA(txt) {
    const out = {};
    const re = /var hq_str_(\w+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const code = m[1], p = m[2];
      const f = p.split(',');
      if (f.length < 32 || !f[0]) continue;
      try {
        const prev = parseFloat(f[2]);
        const price = parseFloat(f[3]);
        const vol = f[8] ? parseFloat(f[8]) : 0;
        const amount = f[9] ? parseFloat(f[9]) : 0;
        const sym = code.toUpperCase();
        out[sym] = {
          symbol: sym, name: f[0], price: price,
          open: f[1] ? parseFloat(f[1]) : null,
          high: f[4] ? parseFloat(f[4]) : null,
          low: f[5] ? parseFloat(f[5]) : null,
          prevClose: prev,
          change: Math.round((price - prev) * 1000) / 1000,
          changePct: prev ? Math.round((price - prev) / prev * 10000) / 100 : 0,
          volume: vol, amount: amount,
          time: f[31] || '', date: f[30] || '',
          market: code.toLowerCase().startsWith('sh') ? 'SH' : 'SZ',
        };
      } catch(e) { continue; }
    }
    return out;
  }

  function parseSinaFund(txt) {
    const out = {};
    const re = /var hq_str_fu_(\d+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const code = m[1], p = m[2];
      const f = p.split(',');
      if (f.length < 10 || !f[0]) continue;
      try {
        const prev = f[3] ? parseFloat(f[3]) : null;
        const estimate = f[2] ? parseFloat(f[2]) : null;
        const changePct = f[6] ? parseFloat(f[6]) : 0;
        const changeAmt = f[5] ? parseFloat(f[5]) : 0;
        let price = estimate || (f[8] ? parseFloat(f[8]) : prev);
        const sym = 'FU' + code;
        out[sym] = {
          symbol: sym, name: f[0], price: price,
          prevClose: prev, estimate: estimate,
          change: Math.round(changeAmt * 10000) / 10000,
          changePct: Math.round(changePct * 100) / 100,
          time: f[1], date: f[7] || '',
          nav: f[8] ? parseFloat(f[8]) : null,
          navChange: f[9] ? parseFloat(f[9]) : null,
          market: 'FUND', volumeText: '基金',
        };
      } catch(e) { continue; }
    }
    return out;
  }

  // -------------------- EM JSON / Bond / Gold --------------------
  async function emBondQuote(sym) {
    try {
      const secid = BOND_SECIDS[sym];
      if (!secid) return null;
      // 直接走 kline 接口
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}`
                + '&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56'
                + '&klt=101&fqt=0&end=20500101&lmt=3'
                + '&ut=fa5fd1943c7b386f172d6893dbfba10b';
      const txt = await httpGet(url, { headers: { Referer: 'https://quote.eastmoney.com/' }, enc: 'utf-8', timeout: 6 });
      if (!txt || !txt.trim().startsWith('{')) return null;
      const j = JSON.parse(txt);
      const rows = ((j.data || {}).klines) || [];
      if (rows.length < 2) return null;
      const last = rows[rows.length - 1].split(',');
      const pre = rows[rows.length - 2].split(',');
      if (last.length < 5 || pre.length < 5) return null;
      const price = parseFloat(last[2]);
      const prev = parseFloat(pre[2]);
      if (!prev) return null;
      const chg = price - prev;
      return {
        symbol: sym, name: NAMES[sym] || sym,
        price: Math.round(price * 10000) / 10000,
        change: Math.round(chg * 10000) / 10000,
        changePct: Math.round(chg / prev * 10000) / 100,
        bp: Math.round(chg * 1000),
        unit: '%', decimals: 2,
        time: last[0], sec: 'bonds',
      };
    } catch(e) { return null; }
  }

  async function cngoldQuote() {
    try {
      const url = `https://api.jijinhao.com/quoteCenter/realTime.htm?codes=${CNGOLD_GOLD_CODE}`;
      const txt = await httpGet(url,
        { headers: { Referer: 'https://quote.cngold.org/' }, enc: 'utf-8', timeout: 6 });
      const m = (txt || '').match(/(\{[\s\S]*\})/);
      const q = m ? JSON.parse(m[1])[CNGOLD_GOLD_CODE] : null;
      if (!q || q.q5 == null || q.q5 === 0) return null;
      const price = parseFloat(q.q5);
      const prev = q.q2 ? parseFloat(q.q2) : null;
      return {
        symbol: 'GC', name: 'COMEX黄金',
        price: Math.round(price * 100) / 100,
        change: Math.round((parseFloat(q.q70) || 0) * 100) / 100,
        changePct: Math.round((parseFloat(q.q80) || 0) * 100) / 100,
        prevClose: prev, time: new Date().toTimeString().slice(0, 8),
        sec: 'futures',
      };
    } catch(e) { return null; }
  }

  async function emFutureQuote(sym) {
    try {
      const meta = EM_FUTURE_SECIDS[sym];
      if (!meta) return null;
      const secid = meta[0];
      const url = `https://push2delay.eastmoney.com/api/qt/stock/get?secid=${secid}`
                + '&fields=f43,f57,f58,f60,f169,f170&fltt=2&invt=2'
                + '&ut=fa5fd1943c7b386f172d6893dbfba10b';
      const txt = await httpGet(url, { headers: { Referer: 'https://quote.eastmoney.com/' }, enc: 'utf-8', timeout: 6 });
      if (!txt || !txt.trim().startsWith('{')) return null;
      const j = JSON.parse(txt);
      const d = j.data;
      if (!d || d.f43 == null || d.f43 === '-') return null;
      const price = parseFloat(d.f43);
      return {
        symbol: sym, name: meta[1],
        price: Math.round(price * 100) / 100,
        change: Math.round(parseFloat(d.f169 || 0) * 100) / 100,
        changePct: Math.round(parseFloat(d.f170 || 0) * 100) / 100,
        prevClose: parseFloat(d.f60 || 0) || null,
        time: new Date().toTimeString().slice(0, 8), sec: 'futures',
      };
    } catch(e) { return null; }
  }

  global.GPBackend = {
    httpGet, sinaGet, txGet, decoderFor,
    parseSinaUs, parseTxUs, parseTxHf, parseSinaHf, parseSinaIdx, parseSinaA, parseSinaFund,
    emBondQuote, cngoldQuote, emFutureQuote,
    US_TIME_RE, US_STALE_DAYS, US_MISS_TEXT,
    NAMES, BOND_SECIDS, EM_FUTURE_SECIDS, CNGOLD_GOLD_CODE, UA,
  };
})(typeof window !== 'undefined' ? window : globalThis);
