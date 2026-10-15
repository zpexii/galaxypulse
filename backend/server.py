#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GalaxyPulse 后端聚合服务
====================
聚合 新浪 + 腾讯 免费行情接口，提供实时监控与复盘接口。
 - /api/live    : 最新全量行情 (纳指/美股ETF/美元黄金参考指标)
 - /api/replay  : 当日复盘 (指定日期快照, 存于本地)
 - 静态托管前端 PWA 页面
零额外依赖: 仅需 requests。运行: python3 server.py
"""
import json
import os
import re
import sys
import time
import itertools
import threading
import concurrent.futures
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

try:
    import requests
except ImportError:
    requests = None

# BASE = 项目根目录 (galaxypulse/), 兼容源码模式和 PyInstaller 打包
if getattr(sys, 'frozen', False):
    # PyInstaller 打包后 sys.executable 在项目根目录
    BASE = os.path.dirname(os.path.abspath(sys.executable))
else:
    # 源码模式: server.py 在 backend/ 下, 上一级是项目根
    _HERE = os.path.dirname(os.path.abspath(__file__))
    BASE = os.path.dirname(_HERE)
FRONTEND_DIR = os.path.join(BASE, 'frontend')
DATA_DIR = os.path.join(BASE, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
PORT = int(os.environ.get('PORT', 8000))
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# ---------------------------------------------------------------- HTTP
def http_get(url, headers=None, timeout=5, enc='gbk'):
    hdrs = headers or {"User-Agent": UA}
    if requests:
        r = requests.get(url, headers=hdrs, timeout=timeout)
        return r.content.decode(enc, 'ignore')
    # requests 不可用时走标准库 urllib (零依赖兜底)
    try:
        req = Request(url, headers=hdrs)
        with urlopen(req, timeout=timeout) as resp:
            return resp.read().decode(enc, 'ignore')
    except (URLError, HTTPError):
        return ''

def sina_get(symbols):
    return http_get(f"https://hq.sinajs.cn/list={symbols}",
                    headers={"Referer": "https://finance.sina.com.cn", "User-Agent": UA})

def tx_get(qs):
    return http_get(f"https://qt.gtimg.cn/q={qs}", headers={"User-Agent": UA})

# ---------------------------------------------------------------- 解析
US_TIME_RE = re.compile(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$')
# 超过这么多天没更新视为停更(退市/长期停牌), 最长假期也不会超过它
US_STALE_DAYS = 10
# 丢弃原因 → 前端提示文案
US_MISS_TEXT = {'ghost': '代码无效', 'stale': '行情已停更', 'malformed': '代码无效', 'empty': '上游无此代码'}

def _sina_us_fields(p):
    """以时间戳为锚点回推字段: 名称含逗号(如 "NetSuite, Inc.")时, 按位置取字段会整体错位"""
    f = p.split(',')
    for i in range(max(0, min(6, len(f) - 2))):
        t = f[i + 2] if i + 2 < len(f) else ''
        if not US_TIME_RE.match(t or ''):
            continue
        try:
            return {
                'name': ','.join(f[:i]).strip() or f[0],
                'price': float(f[i]), 'changePct': float(f[i + 1]), 'time': t,
                'change': float(f[i + 3]) if i + 3 < len(f) and f[i + 3] else 0,
                'volume': float(f[i + 4]) if i + 4 < len(f) and f[i + 4] else 0,
            }
        except (ValueError, IndexError):
            return None
    return None

def _us_reject_reason(rec, symbol):
    """识别幽灵行情: 新浪对未知代码会回一条 现价1.0·零成交 的占位记录"""
    if not rec or not rec.get('price') or rec['price'] <= 0:
        return 'ghost'
    t = rec.get('time') or ''
    if US_TIME_RE.match(t):
        try:
            if time.time() - time.mktime(time.strptime(t, '%Y-%m-%d %H:%M:%S')) > US_STALE_DAYS * 86400:
                return 'stale'
        except (ValueError, OverflowError):
            pass
    if (rec.get('name', '').upper() == symbol.upper()
            and not rec.get('change') and not rec.get('changePct') and not rec.get('volume')):
        return 'ghost'
    return None

def parse_sina_us(txt, dropped=None):
    """dropped: 可选 dict, 收集被丢弃的代码及原因, 供前端明确提示而非静默消失"""
    out = {}
    for m in re.finditer(r'var hq_str_gb_(\w+)="([^"]*)"', txt):
        code, p = m.group(1).upper(), m.group(2)
        if not p.strip():
            if dropped is not None: dropped[code] = 'empty'
            continue
        rec = _sina_us_fields(p)
        if not rec:
            if dropped is not None: dropped[code] = 'malformed'
            continue
        rec['symbol'] = code
        reason = _us_reject_reason(rec, code)
        if reason:
            if dropped is not None: dropped[code] = reason
            continue
        out[code] = rec
    return out

def parse_tx_us(txt):
    """腾讯美股/指数: 3现价 4昨收 5今开 6成交量 30时间 31涨跌 32涨跌幅 33最高 34最低"""
    out = {}
    for m in re.finditer(r'v_us(\w+)="([^"]*)"', txt):
        code, p = m.group(1), m.group(2)
        f = p.split('~')
        if len(f) < 35:
            continue
        try:
            prev = float(f[4]) if f[4] else None
            out[code.upper()] = {
                'symbol': f[2].strip('.') or code.upper(),
                'name': f[1], 'price': float(f[3]),
                'open': float(f[5]) if f[5] else None,
                'high': float(f[33]) if f[33] else None,
                'low': float(f[34]) if f[34] else None,
                'volume': float(f[6]) if f[6] else 0,
                'change': float(f[31]) if f[31] else 0,
                'changePct': float(f[32]) if f[32] else 0,
                'time': f[30],
            }
        except (ValueError, IndexError):
            continue
    return out

def parse_tx_hf(txt):
    """腾讯期货: 0最新,1涨跌幅%,2最新,3买,4卖,5昨收,6今开,7最高,8最低,..."""
    out = {}
    for m in re.finditer(r'v_hf_(\w+)="([^"]*)"', txt):
        code, p = m.group(1), m.group(2)
        f = p.split(',')
        if len(f) < 14:
            continue
        try:
            price = float(f[0]); prev = float(f[7])
            out[code.upper()] = {
                'symbol': code.upper(), 'name': f[13] or code.upper(),
                'price': price, 'change': round(price - prev, 2),
                'changePct': round((price - prev) / prev * 100, 2),
                'time': f[6],
            }
        except (ValueError, IndexError):
            continue
    return out

def parse_sina_hf(txt):
    """新浪境外期货 hf_NQ/hf_GC...: 0最新,2买,3卖,4高,5低,6时间,7昨结,8开盘,...,13名称,14日期"""
    out = {}
    for m in re.finditer(r'var hq_str_hf_(\w+)="([^"]*)"', txt):
        code, p = m.group(1), m.group(2)
        f = p.split(',')
        if len(f) < 14 or not f[0]:
            continue
        try:
            price = float(f[0]); prev = float(f[7])
            out[code.upper()] = {
                'symbol': code.upper(), 'name': f[13] or code.upper(),
                'price': price,
                'open': float(f[8]) if f[8] else None,
                'high': float(f[4]) if f[4] else None,
                'low': float(f[5]) if f[5] else None,
                'change': round(price - prev, 3),
                'changePct': round((price - prev) / prev * 100, 2) if prev else 0,
                'time': f[6],
            }
        except (ValueError, IndexError):
            continue
    return out

def _em_json(url, timeout=6):
    """东方财富 JSON GET (带浏览器头), 限流时空串由调用方容错"""
    txt = _kline_get_text(url, headers={"Referer": "https://quote.eastmoney.com/",
                                        "User-Agent": UA})
    return json.loads(txt) if txt and txt.strip().startswith('{') else None

def em_bond_quote(sym):
    """美国国债收益率 (东方财富行情中心 171.US10Y/US30Y):
    走 push2his 日K —— 取最后两根, 最新收益率 + 相对前收的基点变动。
    (东财的 trends2 日内序列对美债恒为一条直线, 与日K收盘价同值, 故直接用日K)。
    经 kline 缓存: 东财对同一 IP 限流极紧, 缓存兼作限流与失败回退;
    失败返回 None"""
    data = kline_cached(sym, 'bonds', 3)
    bars = ((data or {}).get('bars') or [])
    if not bars:
        return None
    last = bars[-1]
    pre = float(bars[-2]['c']) if len(bars) >= 2 else float(last['o'])
    if not pre:
        return None
    price = float(last['c'])
    chg = price - pre
    return {
        'symbol': sym, 'name': NAMES.get(sym, sym),
        'price': round(price, 4), 'change': round(chg, 4),
        'changePct': round(chg / pre * 100, 2),
        'bp': round(chg * 100, 1),                  # 1 个百分点 = 100 BP
        'unit': '%', 'decimals': 2,
        'time': last['d'], 'sec': 'bonds',
    }

def cngold_gold_quote():
    """COMEX 黄金备份源: 金投网行情 (api.jijinhao.com), 代码 JO_12552。
    q5 最新价 / q2 昨收 / q70 涨跌额 / q80 涨跌幅%; 失败返回 None"""
    try:
        txt = http_get(f"https://api.jijinhao.com/quoteCenter/realTime.htm?codes={CNGOLD_GOLD_CODE}",
                       headers={"Referer": "https://quote.cngold.org/", "User-Agent": UA}, enc='utf-8')
        m = re.search(r'(\{.*\})', txt or '', re.S)
        q = (json.loads(m.group(1)).get(CNGOLD_GOLD_CODE)) if m else None
        if not q or q.get('q5') in (None, 0):
            return None
        price = float(q['q5'])
        prev = float(q.get('q2') or 0) or None
        chg = float(q.get('q70') or 0)
        pct = float(q.get('q80') or 0)
        return {
            'symbol': 'GC', 'name': 'COMEX黄金', 'price': round(price, 2),
            'change': round(chg, 2), 'changePct': round(pct, 2),
            'prevClose': prev, 'time': time.strftime('%H:%M:%S'), 'sec': 'futures',
        }
    except Exception:
        return None

def em_future_quote(sym):
    """期货备份源: 东方财富行情中心全球期货主连 (101.GC00Y/102.CL00Y)。
    f43 最新 / f60 昨结 / f169 涨跌额 / f170 涨跌幅%; 失败返回 None"""
    meta = EM_FUTURE_SECIDS.get(sym)
    if not meta:
        return None
    secid, cname = meta
    qs = (f"secid={secid}&fields=f43,f57,f58,f60,f169,f170&fltt=2&invt=2"
          "&ut=fa5fd1943c7b386f172d6893dbfba10b")
    try:
        j = _em_json(f"https://push2delay.eastmoney.com/api/qt/stock/get?{qs}")
        d = (j or {}).get('data')
        if not d or d.get('f43') in (None, '-'):
            return None
        price = float(d['f43']); prev = float(d.get('f60') or 0)
        return {
            'symbol': sym, 'name': cname, 'price': round(price, 2),
            'change': round(float(d.get('f169') or 0), 2),
            'changePct': round(float(d.get('f170') or 0), 2),
            'prevClose': prev or None, 'time': time.strftime('%H:%M:%S'),
            'sec': 'futures',
        }
    except Exception:
        return None


def parse_sina_idx(txt):
    """新浪境外指数 DINIW: 时间,最新,?,昨收,...,名称,日期"""
    out = {}
    for m in re.finditer(r'var hq_str_(\w+)="([^"]*)"', txt):
        code, p = m.group(1), m.group(2)
        f = p.split(',')
        if len(f) < 10:
            continue
        try:
            price = float(f[1]); prev = float(f[3])
            out[code.upper()] = {
                'symbol': code.upper(), 'name': f[9] or code.upper(),
                'price': price, 'change': round(price - prev, 4),
                'changePct': round((price - prev) / prev * 100, 2),
                'time': f[0],
            }
        except (ValueError, IndexError):
            continue
    return out

def parse_sina_a(txt):
    """新浪 A股: 0名称 1今开 2昨收 3现价 4最高 5最低 6买一 7卖一 8成交量 9成交额 ... 30日期 31时间"""
    out = {}
    for m in re.finditer(r'var hq_str_(\w+)="([^"]*)"', txt):
        code, p = m.group(1), m.group(2)
        f = p.split(',')
        if len(f) < 32 or not f[0]:
            continue
        try:
            prev = float(f[2])
            price = float(f[3])
            vol = float(f[8]) if f[8] else 0
            amount = float(f[9]) if f[9] else 0
            # 去掉前缀 (sh/sz) 作为 symbol, 同时保留原始 code 方便识别
            sym = code.upper()
            out[sym] = {
                'symbol': sym,
                'name': f[0],
                'price': price,
                'open': float(f[1]) if f[1] else None,
                'high': float(f[4]) if f[4] else None,
                'low': float(f[5]) if f[5] else None,
                'prevClose': prev,
                'change': round(price - prev, 3),
                'changePct': round((price - prev) / prev * 100, 2) if prev else 0,
                'volume': vol,
                'amount': amount,
                'time': f[31] if len(f) > 31 else '',
                'date': f[30] if len(f) > 30 else '',
                'market': 'SH' if code.lower().startswith('sh') else 'SZ',
            }
        except (ValueError, IndexError):
            continue
    return out

def parse_sina_fund(txt):
    """新浪基金(fu_前缀): 0名称 1估值时间 2实时估值 3上一交易日净值 4累计净值 5估值涨跌额 6估值涨跌幅% 7日期 8当日净值 9当日涨幅%"""
    out = {}
    for m in re.finditer(r'var hq_str_fu_(\d+)=\"([^\"]*)\"', txt):
        code, p = m.group(1), m.group(2)
        f = p.split(',')
        if len(f) < 10 or not f[0]:
            continue
        try:
            prev = float(f[3]) if f[3] else None    # 上一日净值
            estimate = float(f[2]) if f[2] else None  # 实时估值
            change_pct = float(f[6]) if f[6] else 0   # 估值涨跌幅
            change_amt = float(f[5]) if f[5] else 0   # 估值涨跌额
            # 如果估值为0/空, 回退到当日净值
            price = estimate if estimate else (float(f[8]) if f[8] else prev)
            sym = 'FU' + code   # 统一前缀, 避免和 A股/美股代码冲突
            out[sym] = {
                'symbol': sym,
                'name': f[0],
                'price': price,
                'prevClose': prev,
                'estimate': estimate,
                'change': round(change_amt, 4),
                'changePct': round(change_pct, 2),
                'time': f[1],
                'date': f[7] if len(f) > 7 else '',
                'nav': float(f[8]) if f[8] else None,
                'navChange': float(f[9]) if f[9] else None,
                'market': 'FUND',
                'volumeText': '基金',
            }
        except (ValueError, IndexError):
            continue
    return out

# ---------------------------------------------------------------- 自选配置
# 看板内容由 data/watchlist.json 驱动，可增删自选，多端同步
WATCHLIST_PATH = os.path.join(DATA_DIR, 'watchlist.json')

DEFAULT_WATCHLIST = {
    'hero': 'IXIC',
    'etfs': ['AAPL', 'NVDA', 'TSLA', 'QQQ', 'SPY', 'TQQQ'],
    'indexes': ['IXIC', 'INX', 'DJI'],
    'ashares': ['SZ300088', 'SH600519', 'SH688981', 'SH688825'],
    'funds': ['FU018147', 'FU005827', 'FU161725', 'FU110011'],
    'macroBonds': ['US10Y', 'US30Y'],
    'macroFx': ['DINIW'],
    'macroFutures': ['GC', 'SI', 'CL', 'NQ'],
}

# 常用美股/ETF/指数 代码 → 中文名 映射表 (用于模糊搜索)
# 输入 mu 可匹配 "美光/MU/Micron"
STOCK_ALIASES = {
    'AAPL':   {'name': '苹果',       'en': 'Apple',          'sec': 'etfs'},
    'MSFT':   {'name': '微软',       'en': 'Microsoft',      'sec': 'etfs'},
    'GOOGL':  {'name': '谷歌A',      'en': 'Alphabet',       'sec': 'etfs'},
    'GOOG':   {'name': '谷歌C',      'en': 'Alphabet',       'sec': 'etfs'},
    'AMZN':   {'name': '亚马逊',     'en': 'Amazon',         'sec': 'etfs'},
    'META':   {'name': 'Meta',      'en': 'Meta',           'sec': 'etfs'},
    'NVDA':   {'name': '英伟达',     'en': 'NVIDIA',         'sec': 'etfs'},
    'TSLA':   {'name': '特斯拉',     'en': 'Tesla',          'sec': 'etfs'},
    'AMD':    {'name': 'AMD',       'en': 'AMD',            'sec': 'etfs'},
    'MU':     {'name': '美光科技',   'en': 'Micron',         'sec': 'etfs'},
    'INTC':   {'name': '英特尔',     'en': 'Intel',          'sec': 'etfs'},
    'TSM':    {'name': '台积电',     'en': 'TSMC',           'sec': 'etfs'},
    'AVGO':   {'name': '博通',       'en': 'Broadcom',       'sec': 'etfs'},
    'ORCL':   {'name': '甲骨文',     'en': 'Oracle',         'sec': 'etfs'},
    'ADBE':   {'name': 'Adobe',     'en': 'Adobe',          'sec': 'etfs'},
    'CRM':    {'name': 'Salesforce','en': 'Salesforce',     'sec': 'etfs'},
    'NFLX':   {'name': '奈飞',       'en': 'Netflix',        'sec': 'etfs'},
    'DIS':    {'name': '迪士尼',     'en': 'Disney',         'sec': 'etfs'},
    'BABA':   {'name': '阿里巴巴',   'en': 'Alibaba',        'sec': 'etfs'},
    'PDD':    {'name': '拼多多',     'en': 'PDD',            'sec': 'etfs'},
    'BIDU':   {'name': '百度',       'en': 'Baidu',          'sec': 'etfs'},
    'NIO':    {'name': '蔚来',       'en': 'NIO',            'sec': 'etfs'},
    'LI':     {'name': '理想',       'en': 'Li Auto',        'sec': 'etfs'},
    'XPEV':   {'name': '小鹏',       'en': 'XPeng',          'sec': 'etfs'},
    'JPM':    {'name': '摩根大通',   'en': 'JPMorgan',       'sec': 'etfs'},
    'BAC':    {'name': '美国银行',   'en': 'Bank of America','sec': 'etfs'},
    'V':      {'name': 'Visa',      'en': 'Visa',           'sec': 'etfs'},
    'MA':     {'name': '万事达卡',   'en': 'Mastercard',     'sec': 'etfs'},
    'JNJ':    {'name': '强生',       'en': 'Johnson & Johnson','sec': 'etfs'},
    'UNH':    {'name': '联合健康',   'en': 'UnitedHealth',   'sec': 'etfs'},
    'XOM':    {'name': '埃克森美孚', 'en': 'Exxon Mobil',    'sec': 'etfs'},
    'CVX':    {'name': '雪佛龙',     'en': 'Chevron',        'sec': 'etfs'},
    'COST':   {'name': '好市多',     'en': 'Costco',         'sec': 'etfs'},
    'WMT':    {'name': '沃尔玛',     'en': 'Walmart',        'sec': 'etfs'},
    'HD':     {'name': '家得宝',     'en': 'Home Depot',     'sec': 'etfs'},
    'MCD':    {'name': '麦当劳',     'en': 'McDonalds',      'sec': 'etfs'},
    'KO':     {'name': '可口可乐',   'en': 'Coca-Cola',      'sec': 'etfs'},
    'PEP':    {'name': '百事可乐',   'en': 'PepsiCo',        'sec': 'etfs'},
    'QQQ':    {'name': '纳指100ETF','en': 'Invesco QQQ',    'sec': 'etfs'},
    'SPY':    {'name': '标普500ETF','en': 'SPDR S&P 500',   'sec': 'etfs'},
    'TQQQ':   {'name': '纳指3倍做多','en': 'ProShares UltraPro QQQ','sec': 'etfs'},
    'SQQQ':   {'name': '纳指3倍做空','en': 'ProShares UltraPro Short QQQ','sec': 'etfs'},
    'VOO':    {'name': 'Vanguard标普500','en': 'Vanguard S&P 500','sec': 'etfs'},
    'ARKK':   {'name': 'ARK创新ETF','en': 'ARK Innovation','sec': 'etfs'},
    'DIA':    {'name': '道指ETF',    'en': 'SPDR Dow Jones', 'sec': 'etfs'},
    'IWM':    {'name': '罗素2000ETF','en': 'iShares Russell 2000','sec': 'etfs'},
    'TLT':    {'name': '美债20年+ETF','en': 'iShares 20+ Year Treasury','sec': 'etfs'},
    'GLD':    {'name': '黄金ETF',    'en': 'SPDR Gold',      'sec': 'etfs'},
    'SLV':    {'name': '白银ETF',    'en': 'iShares Silver', 'sec': 'etfs'},
    'USO':    {'name': '原油ETF',    'en': 'United States Oil','sec': 'etfs'},
    'UVXY':   {'name': 'VIX 2倍做多','en': 'ProShares Ultra VIX','sec': 'etfs'},
    # A股 - 科技/半导体
    'SZ300088': {'name': '长信科技', 'en': 'Changxin Technology', 'sec': 'ashares'},
    'SH600519': {'name': '贵州茅台', 'en': 'Kweichow Moutai',   'sec': 'ashares'},
    'SH688981': {'name': '中芯国际', 'en': 'SMIC',              'sec': 'ashares'},
    'SH603986': {'name': '兆易创新', 'en': 'GigaDevice',        'sec': 'ashares'},
    'SZ300782': {'name': '卓胜微',   'en': 'Maxscend',          'sec': 'ashares'},
    'SH688008': {'name': '澜起科技', 'en': 'Montage Tech',      'sec': 'ashares'},
    'SZ002371': {'name': '北方华创', 'en': 'Naura',             'sec': 'ashares'},
    'SH600584': {'name': '长电科技', 'en': 'JCET',              'sec': 'ashares'},
    'SZ002156': {'name': '通富微电', 'en': 'TFME',              'sec': 'ashares'},
    'SH688126': {'name': '沪硅产业', 'en': 'Shanghai Silicon',  'sec': 'ashares'},
    'SZ300661': {'name': '圣邦股份', 'en': 'SG Micro',          'sec': 'ashares'},
    'SZ300604': {'name': '长川科技', 'en': 'Changchuan',        'sec': 'ashares'},
    'SH603501': {'name': '豪威集团', 'en': 'Will Semiconductor','sec': 'ashares'},
    'SZ002049': {'name': '紫光国微', 'en': 'Unigroup Guoxin',   'sec': 'ashares'},
    'SZ300458': {'name': '全志科技', 'en': 'Allwinner',         'sec': 'ashares'},
    'SH688047': {'name': '龙芯中科', 'en': 'Loongson',          'sec': 'ashares'},
    'SH688825': {'name': '长鑫科技', 'en': 'CXMT',              'sec': 'ashares'},
    'SZ002245': {'name': '蔚蓝锂芯', 'en': 'Weilan Lithium',    'sec': 'ashares'},
    'SZ300115': {'name': '长盈精密', 'en': 'Everwin',           'sec': 'ashares'},
    'SZ300684': {'name': '中石科技', 'en': 'Zhongshi',          'sec': 'ashares'},
    'SH603290': {'name': '斯达半导', 'en': 'Starpower',         'sec': 'ashares'},
    'SZ002185': {'name': '华天科技', 'en': 'Hua Tian Tech',     'sec': 'ashares'},
    # A股 - 金融/消费
    'SZ000001': {'name': '平安银行', 'en': 'Ping An Bank',      'sec': 'ashares'},
    'SH601318': {'name': '中国平安', 'en': 'Ping An Insurance', 'sec': 'ashares'},
    'SH600036': {'name': '招商银行', 'en': 'China Merchants',   'sec': 'ashares'},
    'SZ000858': {'name': '五粮液',   'en': 'Wuliangye',         'sec': 'ashares'},
    'SZ000333': {'name': '美的集团', 'en': 'Midea',             'sec': 'ashares'},
    'SH601899': {'name': '紫金矿业', 'en': 'Zijin Mining',      'sec': 'ashares'},
    'SH600900': {'name': '长江电力', 'en': 'Yangtze Power',     'sec': 'ashares'},
    # 热门基金
    'FU018147': {'name': '建信新兴市场混合C',   'en': 'CXM Emerging Markets C',  'sec': 'funds'},
    'FU005827': {'name': '易方达蓝筹精选混合',   'en': 'E Fund Blue Chip Select',  'sec': 'funds'},
    'FU161725': {'name': '招商中证白酒指数A',   'en': 'CMF Baijiu Index A',       'sec': 'funds'},
    'FU110011': {'name': '易方达优质精选混合',   'en': 'E Fund Quality Select',    'sec': 'funds'},
    'FU000001': {'name': '华夏成长混合A',       'en': 'ChinaAMC Growth A',        'sec': 'funds'},
    'FU162607': {'name': '景顺资源垄断混合A',   'en': 'Invesco Resource Monopoly', 'sec': 'funds'},
    'FU003834': {'name': '华夏能源革新股票',     'en': 'ChinaAMC Energy Innovation','sec': 'funds'},
    'FU001714': {'name': '工银文体产业股票A',    'en': 'ICBC Culture & Sports A',  'sec': 'funds'},
    'FU003095': {'name': '中欧医疗健康混合A',    'en': 'CMF Healthcare A',         'sec': 'funds'},
    'FU005669': {'name': '前海开源公用事业股票', 'en': 'QH Utilities Stock',       'sec': 'funds'},
    'FU001410': {'name': '信达澳银新能源产业股票','en': 'Cinda Silver New Energy',  'sec': 'funds'},
    'FU005176': {'name': '富国精准医疗混合',     'en': 'Fullgoal Precision Medical','sec': 'funds'},
    'FU004851': {'name': '广发医疗保健股票A',    'en': 'GF Healthcare Stock A',     'sec': 'funds'},
    'FU002692': {'name': '富国创新科技混合A',    'en': 'Fullgoal Innovation A',    'sec': 'funds'},
    'FU005911': {'name': '广发双擎升级混合A',    'en': 'GF Twin Engine A',         'sec': 'funds'},
    'FU004997': {'name': '广发高端制造股票A',    'en': 'GF High-End Mfg A',        'sec': 'funds'},
    'FU001678': {'name': '前海开源国家比较优势', 'en': 'QH National Comparative',   'sec': 'funds'},
    'FU006113': {'name': '工银前沿医疗股票A',    'en': 'ICBC Frontier Medical A',  'sec': 'funds'},
    'FU001856': {'name': '前海开源沪港深核心资源','en': 'QH Core Resources',        'sec': 'funds'},
    'FU001938': {'name': '中欧时代先锋股票A',    'en': 'CMF Pioneer Times A',      'sec': 'funds'},
    'FU515050': {'name': '5GETF',               'en': '5GETF',                     'sec': 'funds'},
    'FU512880': {'name': '证券ETF',             'en': 'Securities ETF',            'sec': 'funds'},
    'FU513100': {'name': '纳指ETF',             'en': 'Nasdaq ETF',                'sec': 'funds'},
    'FU513500': {'name': '标普500ETF',          'en': 'S&P 500 ETF',               'sec': 'funds'},
    'FU513030': {'name': '德国DAX ETF',         'en': 'DAX ETF',                   'sec': 'funds'},
    'FU513520': {'name': '日经ETF',             'en': 'Nikkei ETF',                'sec': 'funds'},
    'FU159995': {'name': '芯片ETF',            'en': 'Semiconductor Chip ETF',    'sec': 'funds'},
    'FU006751': {'name': '华夏国证半导体芯片ETF联接A','en': 'ChinaAMC Semi ETF A','sec': 'funds'},
    'FU000961': {'name': '天弘沪深300ETF联接A', 'en': 'Tianhong CSI 300 A',       'sec': 'funds'},
    'FU001594': {'name': '天弘中证500指数A',    'en': 'Tianhong CSI 500 A',       'sec': 'funds'},
    'IXIC':   {'name': '纳斯达克综合', 'en': 'NASDAQ Composite', 'sec': 'index'},
    'NDX':    {'name': '纳斯达克100',  'en': 'NASDAQ 100',      'sec': 'index'},
    'INX':    {'name': '标普500',       'en': 'S&P 500',         'sec': 'index'},
    'SPX':    {'name': '标普500',       'en': 'S&P 500',         'sec': 'index'},
    'DJI':    {'name': '道琼斯',         'en': 'Dow Jones',       'sec': 'index'},
    'RUT':    {'name': '罗素2000',       'en': 'Russell 2000',    'sec': 'index'},
    'VIX':    {'name': '恐慌指数',       'en': 'VIX',             'sec': 'index'},
    'DINIW':  {'name': '美元指数',       'en': 'DXY',             'sec': 'fx'},
    'USDJPY': {'name': '美元兑日元',     'en': 'USD/JPY',         'sec': 'fx'},
    'EURUSD': {'name': '欧元兑美元',     'en': 'EUR/USD',         'sec': 'fx'},
    'USDCNY': {'name': '美元兑人民币',   'en': 'USD/CNY',         'sec': 'fx'},
    'US10Y':  {'name': '美国10年期国债', 'en': 'US 10Y Yield',    'sec': 'bonds'},
    'US30Y':  {'name': '美国30年期国债', 'en': 'US 30Y Yield',    'sec': 'bonds'},
    'GC':     {'name': 'COMEX黄金',      'en': 'Gold',            'sec': 'futures'},
    'SI':     {'name': '纽约白银',       'en': 'Silver',          'sec': 'futures'},
    'CL':     {'name': 'NYMEX原油',      'en': 'WTI Crude',       'sec': 'futures'},
    'NQ':     {'name': '纳指期货',       'en': 'Nasdaq 100 Fut',  'sec': 'futures'},
    'NG':     {'name': '天然气',         'en': 'Natural Gas',     'sec': 'futures'},
    'HG':     {'name': '铜',             'en': 'Copper',          'sec': 'futures'},
}

# 美债收益率: 内部代码 -> 东方财富行情中心 secid
BOND_SECIDS = {'US10Y': '171.US10Y', 'US30Y': '171.US30Y'}
# 期货备份源: 东方财富行情中心 secid (101=COMEX, 102=NYMEX)
EM_FUTURE_SECIDS = {'GC': ('101.GC00Y', 'COMEX黄金'), 'CL': ('102.CL00Y', 'NYMEX原油')}
# 金投网行情: COMEX 黄金
CNGOLD_GOLD_CODE = 'JO_12552'

def search_stocks(q, limit=10):
    """模糊搜索: 按代码 / 中文名 / 英文名 / 拼音别名做多级匹配, 纯内置表零依赖"""
    if not q: return []
    q = q.strip().lower()
    if not q: return []
    py_alias = {
        'pg': 'AAPL', 'wg': 'AAPL', 'pingguo': 'AAPL',
        'wrs': 'MSFT', 'mr': 'MSFT', 'weiruan': 'MSFT',
        'gg': 'GOOGL', 'google': 'GOOGL', 'gug': 'GOOGL',
        'ymx': 'AMZN', 'yx': 'AMZN', 'yamaxun': 'AMZN',
        'lsp': 'META', 'fb': 'META', 'lianshu': 'META',
        'ywd': 'NVDA', 'np': 'NVDA', 'yingweida': 'NVDA',
        'tsl': 'TSLA', 'tesla': 'TSLA', 'telong': 'TSLA',
        'mgkj': 'MU', 'mg': 'MU', 'meiguang': 'MU', 'micron': 'MU',
        'yine': 'INTC', 'yt': 'INTC', 'yingtel': 'INTC',
        'tjj': 'TSM', 'taijidian': 'TSM',
        'bt': 'BABA', 'albb': 'BABA', 'alibab': 'BABA',
        'pdd': 'PDD', 'pinduoduo': 'PDD',
        'bd': 'BIDU', 'baidu': 'BIDU',
        'wl': 'NIO', 'weilai': 'NIO',
        'lx': 'LI', 'lixiang': 'LI',
        'xp': 'XPEV', 'xiaopeng': 'XPEV',
        'qqq': 'QQQ', 'nazhi': 'QQQ',
        'spy': 'SPY', 'biaopu': 'SPY',
        'nzx': 'IXIC', 'nazong': 'IXIC', 'nasdaq': 'IXIC',
        'bp500': 'INX', 'biaopu500': 'INX',
        'dqs': 'DJI', 'daoqiong': 'DJI',
        'myzs': 'DINIW', 'dxy': 'DINIW', 'usdx': 'DINIW',
        'hj': 'GC', 'huangjin': 'GC', 'gold': 'GC', 'comexhj': 'GC',
        'by': 'SI', 'baiyin': 'SI', 'silver': 'SI',
        'yy': 'CL', 'yuanyou': 'CL', 'oil': 'CL', 'nymex': 'CL',
        'nq': 'NQ', 'nazhiqihuo': 'NQ', '纳指期货': 'NQ', 'ndxf': 'NQ',
        'us10y': 'US10Y', '10y': 'US10Y', 'mz10': 'US10Y', '10年期国债': 'US10Y', '美债10': 'US10Y',
        'us30y': 'US30Y', '30y': 'US30Y', 'mz30': 'US30Y', '30年期国债': 'US30Y', '美债30': 'US30Y',
        '国债': 'US10Y', '美债': 'US10Y', 'guozhai': 'US10Y', 'meizhai': 'US10Y',
        'trq': 'TQQQ', 'sbz': 'TQQQ',
        # A股常用拼音/简称
        'cxkj': 'SZ300088', 'changxin': 'SZ300088', '长信': 'SZ300088',
        'gzmt': 'SH600519', 'maotai': 'SH600519', '茅台': 'SH600519',
        'zxgj': 'SH688981', 'smic': 'SH688981', '中芯': 'SH688981',
        'zycx': 'SH603986', 'zhaoyi': 'SH603986', '兆易': 'SH603986',
        'zsw': 'SZ300782', 'zhuoshengwei': 'SZ300782',
        'lqkj': 'SH688008', 'lanqi': 'SH688008',
        'bfhc': 'SZ002371', 'beifang': 'SZ002371',
        'cdkj': 'SH600584', 'changdian': 'SH600584',
        'tfwd': 'SZ002156', 'tongfu': 'SZ002156',
        'hgcy': 'SH688126', 'hugui': 'SH688126',
        'sbfg': 'SZ300661', 'shengbang': 'SZ300661',
        'cckj': 'SZ300604', 'changchuan': 'SZ300604',
        'hwjt': 'SH603501', 'haowei': 'SH603501',
        'zggw': 'SZ002049', 'ziguang': 'SZ002049',
        'qzkj': 'SZ300458', 'quanzhi': 'SZ300458',
        'lxzk': 'SH688047', 'longxin': 'SH688047',
        'cxkj': 'SH688825', 'changxin': 'SH688825', '长鑫': 'SH688825', 'cxmt': 'SH688825',
        'pah': 'SZ000001', 'pingan': 'SZ000001',
        'zsyh': 'SH600036', 'zhaoshang': 'SH600036',
        'wly': 'SZ000858', 'wuliangye': 'SZ000858',
        'mdjt': 'SZ000333', 'midea': 'SZ000333',
        'zjky': 'SH601899', 'zijin': 'SH601899',
        'cjdl': 'SH600900', 'changjiang': 'SH600900',
        # 基金
        'jxxx': 'FU018147', 'jianxin': 'FU018147', '建信': 'FU018147', '新兴市场': 'FU018147',
        'yfd': 'FU005827', 'yifangda': 'FU005827', '易方达': 'FU005827', '蓝筹': 'FU005827',
        'zs': 'FU161725', 'zhaoshang': 'FU161725', '招商': 'FU161725', '白酒': 'FU161725',
        'yfdyz': 'FU110011', 'youzhi': 'FU110011', '优质精选': 'FU110011', '易方达优质': 'FU110011',
        'hxc': 'FU000001', 'huaxia': 'FU000001', '华夏成长': 'FU000001',
        'js': 'FU162607', 'jingshun': 'FU162607', '景顺': 'FU162607',
        'gf': 'FU000011', 'guangfa': 'FU000011', '广发聚富': 'FU000011',
        'da': 'FU000043', 'daCheng': 'FU000043', '大成精选': 'FU000043',
        'yx': 'FU100016', 'yinhe': 'FU100016', '银河银泰': 'FU100016',
        'tf': 'FU162201', 'taida': 'FU162201', '泰达荷银': 'FU162201',
    }
    results = []
    seen = set()
    def _add(code, info):
        if code in seen: return
        seen.add(code)
        results.append(dict(info, symbol=code))
    # 1. 拼音别名精确命中 → 置顶
    if q in py_alias:
        code = py_alias[q].upper()
        if code in STOCK_ALIASES:
            _add(code, STOCK_ALIASES[code])
    # 1.5 泛称「美债 / 国债」→ 同时给出 10Y 与 30Y 两个期限
    if q in ('美债', '国债', 'meizhai', 'guozhai'):
        for bc in ('US10Y', 'US30Y'):
            _add(bc, STOCK_ALIASES[bc])
    # 2. 代码前缀匹配
    for code, info in STOCK_ALIASES.items():
        if code.lower().startswith(q):
            _add(code, info)
            if len(results) >= limit: return results
    # 3. 代码包含匹配
    for code, info in STOCK_ALIASES.items():
        if q in code.lower():
            _add(code, info)
            if len(results) >= limit: return results
    # 4. 中文名/英文名包含匹配
    for code, info in STOCK_ALIASES.items():
        if q in info['name'].lower() or q in info['en'].lower():
            _add(code, info)
            if len(results) >= limit: return results
    return results

def load_watchlist():
    try:
        with open(WATCHLIST_PATH, 'r', encoding='utf-8') as f:
            w = json.load(f)
    except Exception:
        w = {}
    d = json.loads(json.dumps(DEFAULT_WATCHLIST))
    for k in d:
        if k == 'hero':
            if isinstance(w.get('hero'), str) and w['hero'].strip():
                d['hero'] = w['hero'].upper()
        elif isinstance(w.get(k), list):
            d[k] = [str(i).upper() for i in w[k] if isinstance(i, str) and i.strip()]
    return d

def save_watchlist(w):
    try:
        tmp = WATCHLIST_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(w, f, ensure_ascii=False, indent=2)
        os.replace(tmp, WATCHLIST_PATH)
        return True
    except Exception:
        return False

NAMES = {
    'IXIC': '纳斯达克综合', 'INX': '标普500', 'DJI': '道琼斯',
    'DINIW': '美元指数', 'US10Y': '美国10年期国债', 'US30Y': '美国30年期国债',
    'GC': 'COMEX黄金', 'SI': '纽约白银', 'CL': 'NYMEX原油', 'NQ': '纳指期货',
    'AAPL': '苹果', 'NVDA': '英伟达', 'TSLA': '特斯拉',
    'QQQ': '纳指100ETF', 'SPY': '标普500ETF', 'TQQQ': '纳指3倍做多ETF',
}

# ---------------------------------------------------------------- 取数
def _vol_text(v):
    """成交量中文化: 亿/百万/M"""
    if not v: return ''
    try: v = float(v)
    except (TypeError, ValueError): return ''
    if v >= 1e8: return f"{v/1e8:.2f}亿"
    if v >= 1e4: return f"{v/1e4:.0f}万"
    return f"{v:.0f}"

def _spark(symbol):
    """纳指(QQQ·Nasdaq100)近30日日K收盘序列, 用于 hero 迷你走势; 失败返回空"""
    try:
        # 腾讯 K 线 (usQQQ.OQ 稳定返回完整日线)
        url = ("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
               f"?param=us{symbol}.OQ,day,,,30,qfq")
        j = json.loads(http_get(url, enc='utf-8', timeout=(2, 3)))
        node = (j.get('data') or {}).get(f'us{symbol}.OQ') or {}
        klines = node.get('qfqday') or node.get('day') or []
        closes = [float(x[2]) for x in klines]
        return closes[-30:]
    except Exception:
        return []

# spark 是日线数据, 30 分钟缓存足够, 避免拖慢 /api/live
_SPARK_CACHE = {'at': 0.0, 'data': []}
_SPARK_TTL = 1800.0

def _spark_cached(symbol):
    now = time.time()
    if _SPARK_CACHE['data'] and now - _SPARK_CACHE['at'] < _SPARK_TTL:
        return _SPARK_CACHE['data']
    d = _spark(symbol)
    if d:
        _SPARK_CACHE['at'], _SPARK_CACHE['data'] = now, d
    return d or _SPARK_CACHE['data']

# ================================================================ 通用日K
# 卡片迷你 K 线 / 历史弹层统一数据源
#   etfs    美股: 腾讯 fqkline, 纳斯达克 .OQ 优先, 空则回退纽交所 .N
#   ashares A股: 腾讯 fqkline (sz/sh 小写代码)
#   funds   基金: 天天基金历史单位净值 (仅有收盘净值 → line)
#   index   指数: 腾讯 fqkline (us.IXIC 等)
#   futures 期货: 新浪 GlobalFuturesDailyKLine
#   fx      外汇: 免费日K源不稳定, 不提供 (返回空, 前端不造假数据)
_KLINE_CACHE = {}
_KLINE_TTL = 1800.0
# 无数据可回退时的熔断窗口: /api/live 每 6s 一次, 上游限流时若不加节流会越打越死
_KLINE_FAIL_TTL = 60.0
_kline_lock = threading.Lock()

# 东财行情节点: 裸域名常被负载均衡落到某台限流节点(直接空响应), 编号域名指向别的节点。
# 限流是按节点而非按 IP —— 哪台被限随时在变, 所以多备几台并让连续请求错开起点
_EM_KLINE_HOSTS = ('2.push2his.eastmoney.com', '44.push2his.eastmoney.com',
                   '1.push2his.eastmoney.com', '23.push2his.eastmoney.com',
                   'push2his.eastmoney.com')
_em_host_rr = itertools.count()

def _em_kline_text(qs):
    """东财 kline/get: 逐台轮询, 连续调用错开起点(避免两次请求都先撞同一台限流节点)"""
    n = len(_EM_KLINE_HOSTS)
    start = next(_em_host_rr) % n
    txt = ''
    for i in range(n):
        host = _EM_KLINE_HOSTS[(start + i) % n]
        txt = _kline_get_text(f"https://{host}/api/qt/stock/kline/get?{qs}",
                              headers={"Referer": "https://quote.eastmoney.com/",
                                       "User-Agent": UA})
        if txt and txt.strip().startswith('{'):
            return txt
    return txt

def _kline_get_text(url, headers=None):
    """K线类接口偶发空响应/瞬时限流: 失败间隔重试一次"""
    last = ''
    for i in range(2):
        try:
            txt = http_get(url, enc='utf-8', timeout=(2, 6), headers=headers)
            if txt and txt.strip():
                return txt
            last = txt
        except Exception:
            pass
        time.sleep(0.6)
    return last

def _tx_day_kline(src, n, fq=True):
    """腾讯日K; src 如 usAAPL.OQ / sz300088 / us.IXIC。
    个股/ETF 走 fqkline(qfq); 指数走通用 kline (指数复权接口仅返回 1 根)。"""
    if fq:
        url = ("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
               f"?param={src},day,,,{max(n, 60)},qfq")
    else:
        url = ("https://web.ifzq.gtimg.cn/appstock/app/kline/kline"
               f"?param={src},day,,,{max(n, 60)}")
    j = json.loads(_kline_get_text(url))
    node = (j.get('data') or {}).get(src) or {}
    rows = node.get('qfqday') or node.get('day') or []
    bars = []
    for r in rows[len(rows) - n:]:
        if len(r) < 6:
            continue
        try:
            bars.append({'d': r[0], 'o': float(r[1]), 'c': float(r[2]),
                         'h': float(r[3]), 'l': float(r[4]), 'v': float(r[5])})
        except (TypeError, ValueError):
            continue
    return bars

def _sina_future_kline(sym, n):
    """新浪 COMEX/NYMEX 期货日K (GC/SI/CL/NG/HG)"""
    url = ("https://stock.finance.sina.com.cn/futures/api/jsonp.php/"
           "var%20_t=/GlobalFuturesService.getGlobalFuturesDailyKLine"
           f"?symbol={sym}")
    txt = _kline_get_text(url)
    m = re.search(r'(\[.*\])', txt, re.S)
    if not m:
        return []
    rows = json.loads(m.group(1))
    bars = []
    for r in rows[len(rows) - n:]:
        try:
            bars.append({'d': r['date'], 'o': float(r['open']), 'c': float(r['close']),
                         'h': float(r['high']), 'l': float(r['low']),
                         'v': float(r.get('volume') or 0)})
        except (TypeError, ValueError, KeyError):
            continue
    return bars

def _em_day_kline(symbol, n):
    """东方财富 A股日K (腾讯被限流时的备选源); symbol 如 SZ300088/SH600519。
    klines 行格式: 日期,开,收,高,低,成交量,成交额; 时间正序。"""
    code = re.sub(r'\D', '', symbol)
    mkt = '1' if symbol.upper().startswith('SH') else '0'
    qs = (f"secid={mkt}.{code}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56"
          f"&klt=101&fqt=1&end=20500101&lmt={max(n, 60)}")
    rows = ((json.loads(_em_kline_text(qs)).get('data') or {}).get('klines') or [])
    bars = []
    for row in rows[len(rows) - n:]:
        p = row.split(',')
        if len(p) < 6:
            continue
        try:
            bars.append({'d': p[0], 'o': float(p[1]), 'c': float(p[2]),
                         'h': float(p[3]), 'l': float(p[4]), 'v': float(p[5])})
        except ValueError:
            continue
    return bars

def _em_bond_kline(sym, n=3):
    """美债收益率日K (东方财富行情中心 171.US10Y/US30Y):
    klines 行格式 日期,开,收,高,低,量; 时间正序, 收益率单位为百分数"""
    secid = BOND_SECIDS.get(sym.upper())
    if not secid:
        return []
    qs = (f"secid={secid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56"
          f"&klt=101&fqt=0&end=20500101&lmt={max(n, 3)}")
    txt = _em_kline_text(qs)
    try:
        rows = ((json.loads(txt).get('data') or {}).get('klines') or [])
    except (ValueError, AttributeError):
        return []
    bars = []
    for row in rows:
        p = row.split(',')
        if len(p) < 5:
            continue
        try:
            bars.append({'d': p[0], 'o': float(p[1]), 'c': float(p[2]),
                         'h': float(p[3]), 'l': float(p[4]),
                         'v': float(p[5]) if len(p) > 5 else 0.0})
        except ValueError:
            continue
    return bars

def _fund_navline(sym, n):
    """基金历史单位净值 (天天基金); sym 可为 FU018147 或 6 位代码; 返回仅含 d/c 的 bars"""
    code = sym[2:] if sym.upper().startswith('FU') else sym
    url = ("https://api.fund.eastmoney.com/f10/lsjz?"
           f"fundCode={code}&pageIndex=1&pageSize={max(n, 60)}")
    txt = _kline_get_text(url, headers={"Referer": "https://fundf10.eastmoney.com/",
                                        "User-Agent": UA})
    m = re.search(r'\((\{.*\})\)\s*;?\s*$', txt.strip())
    j = json.loads(m.group(1) if m else txt)
    rows = (j.get('Data') or {}).get('LSJZList') or []
    bars = []
    for r in rows:  # 接口为最新在前, 反转为时间正序
        try:
            if r.get('DWJZ'):
                bars.append({'d': r['FSRQ'], 'c': float(r['DWJZ'])})
        except (TypeError, ValueError):
            continue
    bars.reverse()
    return bars[len(bars) - n:]

def fetch_kline(symbol, sec, n=30):
    """统一日K入口, 返回 (type, bars); type=candles|line; 任何失败抛异常由缓存层容错"""
    symbol = (symbol or '').upper()
    sec = (sec or '').lower()
    if sec == 'ashares':
        # 腾讯优先; 空响应/限流时回退东方财富
        bars = _tx_day_kline(symbol.lower(), n)
        if not bars:
            bars = _em_day_kline(symbol, n)
        return 'candles', bars
    if sec == 'funds':
        return 'line', _fund_navline(symbol, n)
    if sec == 'index':
        return 'candles', _tx_day_kline('us.' + symbol, n, fq=False)
    if sec == 'futures':
        return 'candles', _sina_future_kline(symbol, n)
    if sec == 'bonds':
        # 美债收益率: 东财日K (171.US10Y/US30Y)。
        # 只按需要根数取 —— 东财限流下响应会随数据量线性变慢, 取满反而拖垮 /api/live
        return 'candles', _em_bond_kline(symbol, n)
    if sec == 'fx':
        # 外汇: 免费源仅有实时(新浪境外指数), 无稳定日K, 返回空 → 前端留白不造假
        return 'line', []
    # etfs / 美股: 纳斯达克 .OQ 优先, 空数据再试纽交所 .N
    bars = _tx_day_kline(f'us{symbol}.OQ', n)
    if not bars:
        bars = _tx_day_kline(f'us{symbol}.N', n)
    return 'candles', bars

def kline_cached(symbol, sec, n=30):
    """30 分钟 TTL 缓存 (日K盘中变化慢); 失败回退旧缓存; 无缓存返回 None"""
    key = (sec, symbol, n)
    now = time.time()
    with _kline_lock:
        old = _KLINE_CACHE.get(key)
        if old and now - old['at'] < (_KLINE_TTL if old['data'] else _KLINE_FAIL_TTL):
            return old['data']
    try:
        typ, bars = fetch_kline(symbol, sec, n)
        data = {'type': typ, 'bars': bars} if bars else None
    except Exception:
        data = None
    if data:
        with _kline_lock:
            _KLINE_CACHE[key] = {'at': now, 'data': data}
        return data
    if old and old['data']:
        return old['data']            # 有旧数据就继续用, 时间戳不刷新, 到期后自然重试
    with _kline_lock:
        _KLINE_CACHE[key] = {'at': now, 'data': None}   # 无旧数据: 进熔断窗口
    return None

def _resolve_quote(symbol, kind, dropped=None):
    """按类型解析单个标的最新行情: kind=stock/index/fx/futures; 失败返回 None
    dropped: 可选 dict, kind=stock 时回填被拒原因(幽灵/停更), 供前端明确提示"""
    symbol = (symbol or '').upper()
    try:
        if kind == 'stock':
            return parse_sina_us(sina_get('gb_' + symbol.lower()), dropped).get(symbol)
        if kind == 'astock':
            # A股: 代码自带 SH/SZ 前缀, 直接用
            code = symbol.lower()
            return parse_sina_a(sina_get(code)).get(symbol.upper())
        if kind == 'fund':
            # 基金: 去掉 FU 前缀, 加 fu_
            code = symbol[2:] if symbol.startswith('FU') else symbol
            return parse_sina_fund(sina_get('fu_' + code)).get(symbol.upper())
        if kind == 'index':
            return parse_tx_us(tx_get('us' + symbol)).get(symbol)
        if kind == 'bonds':
            return em_bond_quote(symbol)
        if kind == 'fx':
            return parse_sina_idx(sina_get(symbol)).get(symbol)
        if kind == 'futures':
            r = parse_tx_hf(tx_get('hf_' + symbol)).get(symbol)
            if r:
                return r
            # 腾讯无此品种 (如 NQ) → 新浪 hf_; GC → 金投; GC/CL → 东财
            r = parse_sina_hf(sina_get('hf_' + symbol)).get(symbol)
            if r:
                return r
            if symbol == 'GC':
                r = cngold_gold_quote()
            if not r and symbol in EM_FUTURE_SECIDS:
                r = em_future_quote(symbol)
            return r
    except Exception:
        return None
    return None

def fetch_all(wl=None):
    """按自选配置并发拉取所有数据并组装 /api/live 结构"""
    import concurrent.futures
    wl = wl or load_watchlist()
    etfs_syms = wl.get('etfs', [])
    idx_syms = wl.get('indexes', [])
    a_syms = wl.get('ashares', [])
    fund_syms = wl.get('funds', [])
    bond_syms = wl.get('macroBonds', [])
    fx_syms = wl.get('macroFx', [])
    hf_syms = wl.get('macroFutures', [])
    result = {'kpis': [], 'etfs': [], 'ashares': [], 'funds': [], 'macro': [], 'hero': None,
              'etfTime': '', 'aShareTime': '', 'fundTime': '', 'macroTime': '', 'fetchedAt': time.strftime('%H:%M:%S'),
              'unresolved': []}

    def miss(symbol, sec, reason):
        """记录取不到行情的自选, 由前端明示占位, 不再静默消失"""
        result['unresolved'].append({'symbol': symbol, 'sec': sec, 'reason': reason})

    jobs = {}
    if etfs_syms: jobs['sina_us'] = lambda: sina_get(','.join('gb_' + s.lower() for s in etfs_syms))
    if idx_syms:  jobs['tx_index'] = lambda: tx_get(','.join('us' + x for x in idx_syms))
    if a_syms:    jobs['sina_a'] = lambda: sina_get(','.join(s.lower() for s in a_syms))
    if fund_syms: jobs['sina_fund'] = lambda: sina_get(','.join('fu_' + s[2:].lower() for s in fund_syms if s.startswith('FU')))
    if fx_syms:   jobs['sina_idx'] = lambda: sina_get(','.join(fx_syms))
    if hf_syms:   jobs['tx_hf'] = lambda: tx_get(','.join('hf_' + x for x in hf_syms))
    # 期货备份源: 新浪 hf_ (NQ 仅新浪有), 金投黄金, 东财 GC/CL
    if hf_syms:   jobs['sina_hf'] = lambda: sina_get(','.join('hf_' + x for x in hf_syms))
    if 'GC' in hf_syms: jobs['cngold_gc'] = cngold_gold_quote
    # 美债走同一个东财节点, 并发请求会被判为限流而齐齐失败 → 串行取
    if bond_syms:
        jobs['em_bonds'] = lambda: {s: em_bond_quote(s) for s in bond_syms}
    jobs['spark'] = lambda: _spark_cached('QQQ')

    ex = concurrent.futures.ThreadPoolExecutor(max_workers=8)
    futs = {k: ex.submit(fn) for k, fn in jobs.items()}
    def safe_get(k, dv=''):
        try: return futs[k].result(timeout=6)
        except Exception: return dv
    sina_us_txt = safe_get('sina_us')
    tx_index_txt = safe_get('tx_index')
    sina_a_txt = safe_get('sina_a')
    sina_idx_txt = safe_get('sina_idx')
    tx_hf_txt = safe_get('tx_hf')
    sina_hf_txt = safe_get('sina_hf') if hf_syms else ''
    cngold_gc = safe_get('cngold_gc', None) if 'GC' in hf_syms else None
    bonds_map = safe_get('em_bonds', None) or {s: None for s in bond_syms}
    spark = safe_get('spark', [])
    # 不等超时任务收尾(典型是被东财节点限流的美债): 它跑完会自行写入缓存,
    # 下一轮 /api/live 直接命中 —— 否则单个上游能把整个响应拖到十几秒
    ex.shutdown(wait=False)

    dropped_us = {}
    sina_us = parse_sina_us(sina_us_txt, dropped_us)
    tx_index = parse_tx_us(tx_index_txt)
    sina_a = parse_sina_a(sina_a_txt)
    sina_idx = parse_sina_idx(sina_idx_txt)
    tx_hf = parse_tx_hf(tx_hf_txt)
    sina_hf = parse_sina_hf(sina_hf_txt)

    etfs = []
    for sym in etfs_syms:
        r = sina_us.get(sym)
        if r:
            r['name'] = NAMES.get(sym, r['name'])
            r['volumeText'] = _vol_text(r.get('volume'))
            etfs.append(r)
        else:
            miss(sym, 'etfs', US_MISS_TEXT.get(dropped_us.get(sym), '上游无此代码'))
    result['etfs'] = etfs
    result['etfTime'] = etfs[0]['time'] if etfs else ''

    # A 股
    ashares = []
    for sym in a_syms:
        r = sina_a.get(sym.upper())
        if r:
            r['volumeText'] = _vol_text(r.get('volume'))
            ashares.append(r)
        else:
            miss(sym, 'ashares', '上游无此代码')
    result['ashares'] = ashares
    result['aShareTime'] = ashares[0]['time'] if ashares else ''

    # 基金
    sina_fund_txt = safe_get('sina_fund')
    sina_fund = parse_sina_fund(sina_fund_txt)
    funds = []
    for sym in fund_syms:
        r = sina_fund.get(sym.upper())
        if r:
            funds.append(r)
        else:
            miss(sym, 'funds', '上游无此代码')
    result['funds'] = funds
    result['fundTime'] = funds[0]['time'] if funds else ''

    # hero 在当前指数里选；若被删则回退到首个指数
    hero_idx = wl['hero'] if wl['hero'] in idx_syms else (idx_syms[0] if idx_syms else None)
    hero = tx_index.get(hero_idx) if hero_idx else None
    if hero:
        hero['name'] = NAMES.get(hero_idx, hero.get('name', '纳斯达克'))
        hero['spark'] = spark
    result['hero'] = hero

    for x in idx_syms:
        r = tx_index.get(x)
        if r:
            result['kpis'].append({'name': NAMES.get(x, r['name']), 'value': r['price'],
                                   'changePct': r['changePct'], 'decimals': 2, 'tag': '指数'})
        else:
            miss(x, 'index', '上游无此代码')

    macro = []
    # 1) 美债收益率 (东财): 卡片显示百分数 + BP
    for code in bond_syms:
        r = bonds_map.get(code)
        if r:
            macro.append(r)
        else:
            miss(code, 'bonds', '上游无此代码')
    # 2) 美元/外汇 (新浪境外指数)
    for code in fx_syms:
        r = sina_idx.get(code)
        if r:
            r['name'] = NAMES.get(code, r['name'])
            r['sec'] = 'fx'
            macro.append(r)
        else:
            miss(code, 'fx', '上游无此代码')
    # 3) 商品/股指期货: 腾讯主源 → 新浪 hf_ → 金投(GC) → 东财(GC/CL)
    for h in hf_syms:
        r = tx_hf.get(h) or sina_hf.get(h)
        if not r and h == 'GC':
            r = cngold_gc
        if not r and h in EM_FUTURE_SECIDS:
            r = em_future_quote(h)
        if r:
            r = dict(r)
            r['symbol'] = h
            r['name'] = NAMES.get(h, r.get('name') or h)
            r['sec'] = 'futures'
            macro.append(r)
        else:
            miss(h, 'futures', '上游无此代码')
    result['macro'] = macro
    result['macroTime'] = macro[0]['time'] if macro else ''

    # KPI 指标条维持原语义: 取前两个非美债宏观指标 (美元指数/黄金 …)
    for m in [x for x in macro if x.get('sec') != 'bonds'][:2]:
        result['kpis'].append({'name': m['name'], 'value': m['price'],
                               'changePct': m['changePct'], 'decimals': 2, 'tag': '指标'})

    return result

# ---------------------------------------------------------------- /api/live 缓存
# 上游接口 RTT 高且限流, 6 秒 TTL 让看板/刷新秒回; 配置变更即失效
_LIVE_CACHE = {'at': 0.0, 'key': None, 'data': None}
_LIVE_TTL = 6.0
_live_lock = threading.Lock()

def get_live():
    wl = load_watchlist()
    key = json.dumps(wl, sort_keys=True)
    now = time.time()
    with _live_lock:
        c = _LIVE_CACHE
        if c['data'] is not None and c['key'] == key and now - c['at'] < _LIVE_TTL:
            return c['data']
    data = fetch_all(wl)
    with _live_lock:
        _LIVE_CACHE.update({'at': time.time(), 'key': key, 'data': data})
    return data

def invalidate_live_cache():
    with _live_lock:
        _LIVE_CACHE.update({'at': 0.0, 'key': None, 'data': None})

# ================================================================ 历史数据
# 展示标的 -> 历史数据源: (类型, 源symbol)
#   tx   : 腾讯 fqkline (us.IXIC 指数 / usXXX.OQ 纳斯达克标的)
#   sina : 新浪 GlobalFuturesDailyKLine (COMEX 黄金/白银/原油)
# 标普500ETF(SPY) 无腾讯历史, 用标普500指数(us.INX)代理
HIST = {
    'IXIC': ('tx', 'us.IXIC'), 'INX': ('tx', 'us.INX'), 'DJI': ('tx', 'us.DJI'),
    'AAPL': ('tx', 'usAAPL.OQ'), 'NVDA': ('tx', 'usNVDA.OQ'), 'TSLA': ('tx', 'usTSLA.OQ'),
    'QQQ': ('tx', 'usQQQ.OQ'), 'SPY': ('tx', 'us.INX'), 'TQQQ': ('tx', 'usTQQQ.OQ'),
    'GC': ('sina', 'GC'), 'SI': ('sina', 'SI'), 'CL': ('sina', 'CL'),
}
HIST_NAME = dict(NAMES)
HIST_NAME['SPY'] = '标普500ETF·SPY'
RANGES = {'1W': 7, '1M': 30, '3M': 90, '6M': 130, '1Y': 252, '2Y': 504, 'ALL': 1180}

def _clamp(v, lo, hi): return max(lo, min(hi, float(v)))

def _hist_payload(symbol, rg, bars, typ='candles', name=None):
    """把 bars 组装为历史弹层契约; line(基金净值) 补齐 o/h/l/v 以复用前端绘图"""
    if not bars:
        return {'ok': False, 'reason': 'empty'}
    if typ == 'line':
        for b in bars:
            b.setdefault('o', b['c']); b.setdefault('h', b['c'])
            b.setdefault('l', b['c']); b.setdefault('v', 0)
    first_c, last_c = bars[0]['c'], bars[-1]['c']
    dec = 4 if last_c < 100 else 2
    return {
        'ok': True, 'symbol': symbol, 'name': name or symbol,
        'range': rg, 'type': typ, 'bars': bars,
        'firstClose': round(first_c * 100) / 100, 'lastClose': round(last_c * 100) / 100,
        'decimals': dec,
        'change': round(last_c - first_c, dec),
        'changePct': round((last_c - first_c) / first_c * 100, 2) if first_c else 0,
    }

def fetch_hist(symbol, rg='3M', sec=None):
    """返回历史K线 dict; 无数据源时不抛错, 给出原因。
    sec 指定板块(etfs/ashares/funds/index/futures/fx)时走通用日K源; 否则回退内置 HIST 表。"""
    n = RANGES.get(rg, 90)
    if sec:
        data = kline_cached(symbol, sec, n)
        if not data:
            return {'ok': False, 'reason': 'no_history'}
        alias = STOCK_ALIASES.get(symbol) or {}
        return _hist_payload(symbol, rg, data['bars'], data['type'],
                             alias.get('name') or symbol)
    if symbol not in HIST:
        return {'ok': False, 'reason': 'no_history'}
    kind, src = HIST[symbol]
    bars = []
    try:
        if kind == 'tx':
            url = ("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
                   f"?param={src},day,2015-01-01,{time.strftime('%Y-%m-%d')},{max(n,60)},")
            txt = http_get(url, timeout=8, enc='utf-8')
            node = (json.loads(txt).get('data') or {}).get(src) or {}
            rows = node.get('day') or node.get('qfqday') or []
            for r in rows[len(rows)-n:]:
                if len(r) < 6: continue
                bars.append({'d': r[0], 'o': float(r[1]), 'c': float(r[2]),
                             'h': float(r[3]), 'l': float(r[4]), 'v': float(r[5])})
        else:
            url = ("https://stock.finance.sina.com.cn/futures/api/jsonp.php/"
                   "var%20_t=/GlobalFuturesService.getGlobalFuturesDailyKLine"
                   f"?symbol={src}")
            txt = http_get(url, timeout=8, enc='utf-8')
            m = re.search(r'(\[.*\])', txt, re.S)
            if not m: return {'ok': False, 'reason': 'empty'}
            rows = json.loads(m.group(1))
            for r in rows[len(rows)-n:]:
                bars.append({'d': r['date'], 'o': float(r['open']), 'c': float(r['close']),
                             'h': float(r['high']), 'l': float(r['low']),
                             'v': float(r.get('volume') or 0)})
    except Exception:
        return {'ok': False, 'reason': 'error'}
    return _hist_payload(symbol, rg, bars, 'candles', HIST_NAME.get(symbol, symbol))

def read_list():
    return []

# ---------------------------------------------------------------- HTTP Server
import gzip
from email.utils import formatdate, parsedate_to_datetime

class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    _head_only = False

    def _send(self, code, body, ctype='application/json; charset=utf-8', cache='no-store', extra=None):
        # 文本类响应且客户端支持时 gzip 压缩 (css/js/html 体积约 -75%)
        gzippable = ctype.startswith(('text/', 'application/json', 'application/javascript', 'application/manifest'))
        if gzippable and len(body) > 1024 and 'gzip' in (self.headers.get('Accept-Encoding') or ''):
            body = gzip.compress(body, compresslevel=6)
            self.send_response(code)
            self.send_header('Content-Encoding', 'gzip')
        else:
            self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', cache)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if not self._head_only:
            self.wfile.write(body)

    def do_HEAD(self):
        # 健康检查/预检: 头信息与 GET 一致, 不发 body
        self._head_only = True
        try:
            self.do_GET()
        finally:
            self._head_only = False

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        qs = parse_qs(url.query)
        if path == '/api/live':
            try:
                data = get_live()
                self._send(200, json.dumps(data, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self._send(500, json.dumps({'error': str(e)}, ensure_ascii=False).encode('utf-8'))
        elif path == '/api/search':
            q = (qs.get('q', [''])[0] or '').strip()
            sec = (qs.get('section', ['etfs'])[0] or 'etfs').lower()
            results = search_stocks(q)
            # 如果指定了 section, 优先返回对应类别的结果, 但仍展示其它类别(标类型)
            if sec != 'all':
                results.sort(key=lambda r: 0 if r.get('sec')==sec else 1)
            self._send(200, json.dumps({'q': q, 'results': results}, ensure_ascii=False).encode('utf-8'))
        elif path == '/api/watchlist':
            self._send(200, json.dumps(load_watchlist(), ensure_ascii=False).encode('utf-8'))
        elif path == '/api/quote':
            sym = (qs.get('symbol', [''])[0] or '').upper()
            sec = (qs.get('section', ['etfs'])[0] or 'etfs').lower()
            kind = {'etfs': 'stock', 'stock': 'stock', 'ashares': 'astock', 'funds': 'fund', 'index': 'index', 'fx': 'fx', 'futures': 'futures', 'bonds': 'bonds'}.get(sec, 'stock')
            dropped = {}
            r = _resolve_quote(sym, kind, dropped if kind == 'stock' else None)
            if r:
                r['ok'] = True; r.setdefault('section', sec)
            else:
                # 明确给出失败原因, 前端据此拒绝写入而不是悄悄添加
                r = {'ok': False, 'symbol': sym, 'section': sec,
                     'reason': US_MISS_TEXT.get(dropped.get(sym), '上游无此代码')}
                dropped.clear()
            self._send(200, json.dumps(r, ensure_ascii=False).encode('utf-8'))
        elif path == '/api/klines':
            # 批量迷你日K: items=etfs:AAPL,ashares:SZ300088,funds:FU018147
            items_raw = qs.get('items', [''])[0] or ''
            try:
                n = int(qs.get('n', ['30'])[0] or '30')
            except ValueError:
                n = 30
            n = max(10, min(n, 120))
            items = []
            for it in items_raw.split(','):
                it = it.strip()
                if ':' not in it:
                    continue
                sec, sym = it.split(':', 1)
                sec, sym = sec.strip().lower(), sym.strip().upper()
                if sym:
                    items.append((sec, sym))
            out = {}
            if items:
                with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
                    futs = {f'{sec}:{sym}': ex.submit(kline_cached, sym, sec, n)
                            for sec, sym in items}
                    for key, fu in futs.items():
                        try:
                            out[key] = fu.result(timeout=12)
                        except Exception:
                            out[key] = None
            self._send(200, json.dumps({'ok': True, 'items': out},
                                       ensure_ascii=False).encode('utf-8'))
        elif path == '/api/history':
            sym = (qs.get('symbol', [''])[0] or '').upper()
            rg = (qs.get('range', ['3M'])[0] or '3M').upper()
            sec = (qs.get('section', [''])[0] or '').lower() or None
            try:
                data = fetch_hist(sym, rg, sec)
                self._send(200, json.dumps(data, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self._send(500, json.dumps({'ok': False, 'reason': 'error', 'msg': str(e)},
                                           ensure_ascii=False).encode('utf-8'))
        elif path == '/api/replay':
            self._send(200, json.dumps({'items': [], 'date': qs.get('date', [''])[0]},
                                       ensure_ascii=False).encode('utf-8'))
        else:
            self.serve_static(path)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path != '/api/watchlist':
            self._send(404, json.dumps({'ok': False, 'error': 'not found'}).encode('utf-8')); return
        try:
            n = int(self.headers.get('Content-Length') or 0)
            body = self.rfile.read(n) if n else b''
            req = json.loads(body.decode('utf-8') or '{}')
            base = json.loads(json.dumps(DEFAULT_WATCHLIST))
            for k in base:
                if isinstance(req.get(k), list):
                    base[k] = [str(i).upper() for i in req[k] if isinstance(i, str) and i.strip()]
            if isinstance(req.get('hero'), str) and req['hero'].strip():
                base['hero'] = req['hero'].upper()
            # 去重
            for k in base:
                if isinstance(base[k], list):
                    base[k] = list(dict.fromkeys(base[k]))
            if base['hero'] not in base['indexes']:
                base['hero'] = base['indexes'][0] if base['indexes'] else DEFAULT_WATCHLIST['hero']
            ok = save_watchlist(base)
            if ok:
                invalidate_live_cache()
            self._send(200, json.dumps({'ok': ok, 'watchlist': base}, ensure_ascii=False).encode('utf-8'))
        except Exception as e:
            self._send(500, json.dumps({'ok': False, 'error': str(e)}, ensure_ascii=False).encode('utf-8'))

    def serve_static(self, path):
        # 防路径穿越
        if '..' in path:
            self._send(403, b'forbidden'); return
        if path == '/' or path == '':
            path = '/index.html'
        fp = os.path.normpath(os.path.join(FRONTEND_DIR, path.lstrip('/')))
        if not fp.startswith(FRONTEND_DIR) or not os.path.isfile(fp):
            self._send(404, b'not found'); return
        ctype = {
            '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
            '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
        }.get(os.path.splitext(fp)[1], 'application/octet-stream')
        # Last-Modified 条件请求: 未变更返回 304, 局域网内秒开
        mtime = os.stat(fp).st_mtime
        ims = self.headers.get('If-Modified-Since')
        if ims:
            try:
                if int(parsedate_to_datetime(ims).timestamp()) >= int(mtime):
                    self.send_response(304)
                    self.send_header('Cache-Control', 'no-cache')
                    self.end_headers()
                    return
            except Exception:
                pass
        with open(fp, 'rb') as f:
            body = f.read()
        self._send(200, body, ctype, cache='no-cache',
                   extra={'Last-Modified': formatdate(mtime, usegmt=True)})

    def log_message(self, *a):
        return

def main():
    print(f"\n  GalaxyPulse 服务已启动")
    print(f"  本机访问:  http://localhost:{PORT}")
    print(f"  局域网访问: http://<你的IP>:{PORT}  (手机同WiFi可开)")
    print(f"  接口:      /api/live   /api/replay\n")
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")

if __name__ == '__main__':
    main()