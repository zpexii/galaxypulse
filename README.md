# GalaxyPulse · 风月纳斯达克助手（网页版）

> 一张"苹果风"的市场看板 — 纳指情绪 + 自选股票 + A股 + 基金 + 宏观指标，全部实时。

![license](https://img.shields.io/badge/python-3.9+-3776AB.svg) ![license](https://img.shields.io/badge/html5--CSS3-ff6b6b.svg) ![license](https://img.shields.io/badge/zero--dependency-22c55e.svg)

---

## 这是什么

一个**本地运行的纯前端看板 + 轻量行情聚合服务**。打开浏览器、双击 `start.sh`、等 8000 端口就完事。

- **纳指 KPI 卡轨**：IXIC / INX / DJI 三个指数横向滑动，一眼看到盘面冷暖
- **自选股票**：默认 AAPL · NVDA · TSLA · QQQ · SPY · TQQQ，自己在工作台里加
- **A股科技 + 消费**：长信、茅台、中芯、长鑫…… 默认选了一篮子半导体
- **热门基金**：建信、易方达、招商、华夏等 30+ 只（新浪实时估值 + 天天基金净值）
- **宏观指标**：美债 10Y / 30Y · 美元指数 · COMEX 黄金 · 白银 · WTI 原油 · 纳指期货
- **历史走势弹层**：任意标的点开即看 K 线 / 面积图，支持 1周 / 1月 / 3月 / 6月 / 1年 / 2年 / 全部
- **复盘视图**：`start.sh --replay` 或点右上角"当日复盘"切换到复盘快照模式

**设计语言**：苹果工业美学 — 毛玻璃、极光氛围层、品牌光束描边、情绪联动（涨绿跌红，背景随当日涨跌幅呼吸）。

---

## 技术栈

| 层 | 选型 | 原因 |
|---|---|---|
| 后端 | Python `http.server` + 可选 `requests` | 零依赖、可 PyInstaller 打包、单文件 `server.py` |
| 前端 | 原生 HTML5 + CSS3 + ES6 Canvas | 无构建、无框架、可双击打开 |
| 行情源 | 新浪 / 腾讯 / 东方财富 / 金投网 | 免费、无 API Key |
| 缓存 | 后端内存 + 30min TTL | 日 K 盘中变化慢，够用 |
| 自选存储 | `data/watchlist.json` | 本地 JSON，改了立即生效 |

**零依赖**：除了可能缺的 `requests`（标准库 `urllib.request` 自动兜底）和 `python3`。

---

## 快速开始

```bash
# 方式一：一键启动（推荐）
./start.sh            # macOS / Linux
start.bat             # Windows

# 方式二：手动
python3 backend/server.py
# 打开 http://localhost:8000
```

首次启动后端会并发拉取所有行情（6~10s），之后每 60 秒自动刷新。

---

## 目录结构

```
galaxypulse/
├── backend/server.py    # 行情聚合 + 静态托管 (+ /api/live, /api/kline, /api/replay)
├── frontend/
│   ├── index.html       # PWA 主页面（单入口）
│   ├── app.js           # 看板渲染 / K 线绘制 / 手势 / 弹层 / 工作台
│   ├── styles.css       # 多主题 Token + 苹果风设计系统
│   ├── manifest.json    # PWA manifest
│   └── sw.js            # Service Worker（离线缓存）
├── start.sh / .bat      # 跨平台启动脚本（自动 fallback 到 urllib）
└── data/watchlist.json # 自选配置（运行时生成，已 .gitignore）
```

### 后端接口

| 路由 | 说明 |
|---|---|
| `GET /api/live?t=` | 全量实时行情（KPI 指数 / 美股 ETF / A股 / 基金 / 宏观 + Hero 迷你走势） |
| `GET /api/kline?symbol=AAPL&sec=etfs&n=60` | 统一日K（candles 或 line，来源按 sec 自动选择） |
| `GET /api/replay?date=2025-10-14` | 当日复盘快照（JSON，可直接回放） |
| `GET /api/search?q=茅台` | 模糊搜索（内置 STOCK_ALIASES 表，支持拼音 / 简称 / 代码前缀） |
| `GET /api/watchlist` / `POST /api/watchlist` | 自选配置读写 |

**sec 可值**：`etfs`（美股 ETF / 个股）· `ashares`（A股）· `funds`（基金）· `index`（指数）· `futures`（期货）· `bonds`（美债）· `fx`（外汇）

---

## 数据源策略

免费行情接口天生带反爬 / 限流 / 偶发空响应。这里的做法：

1. **多源并发 + 熔断** — 新浪美股 · 腾讯指数 · 东财期货 · 金投黄金 8 路并发，东财接口一旦连续空响应进入 60s 熔断窗口
2. **节点轮询** — 东财 `push2his.eastmoney.com` 有多个编号节点（`2./44./1./23.`），连续请求错开起点，避免撞同一台被限
3. **后端兜底** — 无 `requests` 自动切 `urllib.request`；新浪未知代码返回现价 1.0 零成交的占位记录，识别为"幽灵行情"在 UI 上明示，不再静默消失
4. **K 线多源回退** — 美股 `.OQ` 空则试 `.N`；A股腾讯空则东财；期货腾讯空则新浪 / 金投 / 东财依次回退

> ⚠️ 免费源随时可能挂，后端会自动降级。如果某天纳指不更新了，大概率是上游接口挂了，不是代码问题。

---

## 自选配置

第一次启动会自动在 `data/watchlist.json` 生成默认配置：

```json
{
  "hero": "IXIC",
  "etfs":   ["AAPL", "NVDA", "TSLA", "QQQ", "SPY", "TQQQ"],
  "indexes": ["IXIC", "INX", "DJI"],
  "ashares": ["SZ300088", "SH600519", "SH688981", "SH688825"],
  "funds":   ["FU018147", "FU005827", "FU161725", "FU110011"],
  "macroBonds": ["US10Y", "US30Y"],
  "macroFx":  ["DINIW"],
  "macroFutures": ["GC", "SI", "CL", "NQ"]
}
```

也可以在页面上点右上角齿轮图标，交互式增删自选。

**代码规则**：
- 美股：直接写代码（`AAPL`）
- A股：6 位代码 + 前缀（`SH600519` / `SZ300088`）
- 基金：`FU` + 6 位代码（`FU018147`）
- 期货：纯代码（`GC` / `SI` / `CL` / `NQ`）
- 美债收益率：`US10Y` / `US30Y`

---

## 后续升级预期

| 方向 | 内容 |
|---|---|
| **数据源** | 免费口不稳定。如果要长期跑，建议换付费 API（Polygon / Finnhub / Tushare Pro），后端多源调度器已经搭好框架，换源只改 `_resolve_quote` 里的分支 |
| **WebSocket 实时** | 现在是 60s 轮询。新浪 `hq.sinajs.cn` 有 WebSocket 版本，换成实时推送延迟能到秒级 |
| **多端同步** | 当前自选存在本地。加个 `STOCK_ALIASES` 字典 + Git Submodule 就能跨设备共享；或者上一个轻量 Cloudflare Worker 做 JSON 同步 |
| **图表库升级** | 原生 Canvas 手写 K 线维护成本高。后续可以切 TradingView Lightweight Charts（轻量、快、交互全），只需要把 `drawHistFrame` 换成 Lightweight Charts `setData` |
| **主题系统** | 现在 5 套主题（midnight / ocean / titanium / dusk / light）走 CSS Token，加新主题只改 `html[data-theme="new"]` 下的 Token 值。可以再出一个 "morning paper" 晨间日报风格 |
| **离线 PWA** | Service Worker 已经有了，再加 IndexedDB 存 K 线历史就能离线看数据曲线 |
| **告警** | 自选触发涨跌幅阈值时浏览器 `Notification` 推送，或者 Telegram / Server 酱 |

---

## 仓库分支说明

本仓库有两个分支：

| 分支 | 内容 | 适用场景 |
|---|---|---|
| `main` | **纯网页版** — 前端看板 + Python 行情服务，一个 `start.sh` 启动 | 本地 / 服务器跑网页 |
| `android` | **Android 改造版** — 用 Capacitor 把网页包成 APK，行情接口切 JS 原生桥接绕过 WebView CORS | 手机上装一个 App |

想在电脑上跑，用 `main`；想装手机上，切 `android` 分支看它的 README。

---

## 版本

v1.2.0 — PyInstaller 打包 + requests 缺失兜底 + 美债收益率取数修复

完整迭代见 [CHANGELOG.md](CHANGELOG.md)。
