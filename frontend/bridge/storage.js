// ============================================================
// storage.js — localStorage 持久化 (替代 server.py 里的 data/watchlist.json)
// 前后端同进程, 不再需要 HTTP PUT /api/watchlist 落盘
// ============================================================
(function(global) {
  'use strict';

  const KEY = 'gp-watchlist-v1';

  const DEFAULT = {
    hero: 'IXIC',
    etfs: ['AAPL', 'NVDA', 'TSLA', 'QQQ', 'SPY', 'TQQQ'],
    indexes: ['IXIC', 'INX', 'DJI'],
    ashares: ['SZ300088', 'SH600519', 'SH688981', 'SH688825'],
    funds: ['FU018147', 'FU005827', 'FU161725', 'FU110011'],
    macroBonds: ['US10Y', 'US30Y'],
    macroFx: ['DINIW'],
    macroFutures: ['GC', 'SI', 'CL', 'NQ'],
  };

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    const d = deepClone(DEFAULT);
    if (!stored || typeof stored !== 'object') return d;
    for (const k of Object.keys(d)) {
      if (k === 'hero') {
        if (typeof stored[k] === 'string' && stored[k].trim()) d.hero = stored[k].toUpperCase();
      } else if (Array.isArray(stored[k])) {
        d[k] = stored[k].filter(x => typeof x === 'string' && x.trim()).map(x => x.toUpperCase());
      }
    }
    return d;
  }

  function save(wl) {
    try {
      localStorage.setItem(KEY, JSON.stringify(wl));
      return true;
    } catch (e) { return false; }
  }

  // Expose
  global.GPStorage = { load, save, DEFAULT };
})(typeof window !== 'undefined' ? window : globalThis);
