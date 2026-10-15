// ============================================================
// api.js — fetch 拦截桥
//
// 把 fetch('/api/live?...') / fetch('/api/quote?...') 等请求
// 拦截下来, 转为调用 GPService 的 JS 函数, 返回 Promise<Response>
// 前端 app.js 完全不感知后端是本地 JS 还是远端 HTTP
// ============================================================
(function() {
  'use strict';
  const S = window.GPService;

  // 解析 fetch 传入的 URL (string / Request)
  function parseUrl(u) {
    if (typeof u === 'string') {
      // 用 base URL 解析成 URL 对象, 兼容相对路径
      return new URL(u, window.location.origin);
    }
    if (u && u.url) return new URL(u.url);
    throw new Error('Unsupported fetch URL type');
  }

  function jsonResponse(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  // 判断 JS 取数结果是否明显 "空壳" → 需要 fallback 到 Python server
  function _looksEmpty(data, path) {
    if (!data) return true;
    if (path === '/api/quote') return data.ok === false;
    if (path === '/api/history') return data.ok === false;
    return false;
  }

  async function handleApiRequest(url, init) {
    const u = parseUrl(url);
    const path = u.pathname;
    const q = u.searchParams;

    const section = q.get('section') || 'etfs';

    try {
      let result = null;

      // ---- GET ----
      if (path === '/api/live') {
        result = await S.getLive();
        const d = result || {};
        // CORS 环境 (桌面浏览器预览) 下 bridge 大面积取空 → fallback Python server
        // 真机 Capacitor 原生 OkHttp 不受 CORS 限制, 不会触发
        const wanted = ['etfs','ashares','funds','macro'];
        const got = wanted.reduce((n, k) => n + ((d[k] && d[k].length) ? 1 : 0), 0);
        const unresolvedN = (d.unresolved || []).length;
        const totalCards = (d.etfs?.length||0) + (d.ashares?.length||0) + (d.funds?.length||0)
                         + (d.macro?.length||0) + (d.kpis?.length||0) + unresolvedN;
        const failRatio = totalCards ? unresolvedN / totalCards : 1;
        if (got < 3 || failRatio > 0.4) return _origFetch(url, init);
        return jsonResponse(result);
      }

      if (path === '/api/search') {
        const r = S.searchStocks(q.get('q') || '', 10);
        return jsonResponse({ q: q.get('q') || '', results: r });
      }

      if (path === '/api/watchlist' && (!init || !init.method || init.method === 'GET')) {
        return jsonResponse(S.loadWatchlist());
      }

      if (path === '/api/quote') {
        const sym = (q.get('symbol') || '').toUpperCase();
        const kindMap = { etfs: 'stock', stock: 'stock', ashares: 'astock', funds: 'fund', index: 'index', fx: 'fx', futures: 'futures', bonds: 'bonds' };
        const kind = kindMap[section] || 'stock';
        const r = await S.resolveQuote(sym, kind);
        const decorated = Object.assign({ ok: r && !r.ok !== false && !r.symbol, section }, r || { ok: false });
        // 如果 JS 取数失败 (CORS), fallback 到 Python
        if (_looksEmpty(decorated, path)) return _origFetch(url, init);
        return jsonResponse(decorated);
      }

      if (path === '/api/klines') {
        const itemsRaw = q.get('items') || '';
        let n = parseInt(q.get('n') || '30', 10);
        n = Math.max(10, Math.min(n, 120));
        const items = [];
        for (const it of itemsRaw.split(',')) {
          if (!it.includes(':')) continue;
          const [sec, sym] = it.split(':');
          if (sym) items.push([sec.trim().toLowerCase(), sym.trim().toUpperCase()]);
        }
        const out = {};
        await Promise.all(items.map(async ([sec, sym]) => {
          const k = `${sec}:${sym}`;
          try { out[k] = await S.klineCached(sym, sec, n); } catch(e) { out[k] = null; }
        }));
        // CORS 敏感源 (etfs/funds/ashares/futures/bonds) 拿到 null → 整个请求 fallback
        const corsSensitive = items.some(([sec]) => ['etfs','funds','ashares','futures','bonds'].includes(sec));
        const allNull = items.every(([sec, sym]) => out[`${sec}:${sym}`] === null);
        if (corsSensitive && allNull) return _origFetch(url, init);
        // 部分 null 也 fallback (保守策略, 让 Python 全取回来)
        const nullCount = Object.values(out).filter(v => v === null).length;
        if (nullCount > 0 && corsSensitive) return _origFetch(url, init);
        return jsonResponse({ ok: true, items: out });
      }

      if (path === '/api/history') {
        const sym = (q.get('symbol') || '').toUpperCase();
        const rg = (q.get('range') || '3M').toUpperCase();
        const sec = (q.get('section') || '').toLowerCase() || null;
        const data = await S.fetchHist(sym, rg, sec);
        if (_looksEmpty(data, path)) return _origFetch(url, init);
        return jsonResponse(data);
      }

      if (path === '/api/replay') {
        return jsonResponse({ items: [], date: q.get('date') || '' });
      }

      // ---- PUT ----
      if (path === '/api/watchlist' && init && (init.method === 'PUT' || init.method === 'PATCH')) {
        let body = {};
        try { body = JSON.parse(init.body || '{}'); } catch(e) {}
        const wl = S.saveWatchlist(body);
        return jsonResponse({ ok: true, watchlist: wl });
      }

      return _origFetch(url, init);

    } catch (e) {
      // 异常也 fallback
      try { return _origFetch(url, init); }
      catch(_) { return jsonResponse({ ok: false, error: String(e && e.message || e) }, 500); }
    }
  }

  const _origFetch = window.fetch.bind(window);
  window.fetch = function(url, init) {
    // 字符串 pathname 拦截, Request 对象也是同构的 url.toString() 会被 parseUrl 再 parse 一遍
    const urlStr = typeof url === 'string' ? url : (url && url.url) || '';
    if (urlStr.startsWith('/api/')) {
      return handleApiRequest(urlStr, init);
    }
    return _origFetch(url, init);
  };
})();
