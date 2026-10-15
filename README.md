# GalaxyPulse · 风月纳斯达克助手（Android 版）

> 用 Capacitor 把网页版 GalaxyPulse 包成 APK，行情接口直接在 WebView 里取 — **零外部依赖、装好就能跑**。

**这是 `main` 分支（纯网页版）的 Android 改造分支。** 想在电脑上跑，看 main 的 README；想装手机上，继续往下看。

---

## 为什么要单独做 Android 版

网页版跑在浏览器里，有两个手机上用不了的硬伤：

| 问题 | 根因 | Android 版解决 |
|---|---|---|
| 行情接口 CORS | 新浪 / 腾讯 / 东方财富的行情 API 都拦浏览器跨域 | **native fetch** — Capacitor 8 的 `CapacitorHttp` 用原生 OkHttp 发请求，浏览器 CORS 规则不适用 |
| A股名字乱码 | 腾讯 `qt.gtimg.cn` 返回 GBK 编码，浏览器 `fetch()` 不支持指定 `responseType: 'arraybuffer'` 后手动解码 TextDecoder | `backend.js` 强制走 `arraybuffer`，`new TextDecoder('gbk')` 解原始字节 |

还有一些"顺便做了"的事：

- 移动端专属 UI（底部 pill Tab、KPI 横向滑动卡轨、2×2 Hero 布局、触控目标 ≥ 38px）
- K 线手势从桌面的 box-select 改成手机的 **拖拽平移** + 双击回位
- Canvas resize 缓存，避免每帧重传纹理到 GPU
- 移动端自动 reduce-motion，所有 backdrop-filter blur() 替换为纯纯色底（滚动流畅度 v19）

---

## 架构改造思路

### 整体架构

```
┌─────────────────────────────────────────┐
│              Android APK                │
│  ┌───────────────────────────────────┐  │
│  │  Capacitor WebView                │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │ frontend/                   │  │  │
│  │  │  index.html · app.js        │  │  │
│  │  │  styles.css · styles.mobile  │  │  │
│  │  │  bridge/                     │  │  │
│  │  │   backend.js (HTTP+解析)     │  │  │
│  │  │   service.js (行情组装)      │  │  │
│  │  │   api.js  (调度)             │  │  │
│  │  │   storage.js (localStorage)   │  │  │
│  │  └──────────────┬──────────────┘  │  │
│  │                 │ fetch()          │  │
│  │  CapacitorHttp  ▼                  │  │
│  └─────────────────┬─────────────────┘  │
│                    │ OkHttp (native)     │
└────────────────────┼────────────────────┘
                     ▼
    新浪 hq.sinajs.cn / 腾讯 qt.gtimg.cn
    东方财富 push2his.eastmoney.com
    金投网 api.jijinhao.com
```

### 与 main 分支的核心差异

| 点 | main 分支（网页版） | android 分支 |
|---|---|---|
| **HTTP 层** | 浏览器 fetch → CORS 被拦 | CapacitorHttp（原生 OkHttp）→ 绕过 CORS |
| **后端** | Python `server.py` 做聚合 + 静态托管 | 后端移植为 JS（`frontend/bridge/backend.js`），直接在 WebView 里跑 |
| **编码** | Python `requests` 默认解 gb2312 没问题 | JS 强制 `arraybuffer` + `TextDecoder('gbk')` |
| **入口** | 浏览器 → `python3 server.py` → `http://localhost:8000` | APK → 安装后直接启动，WebView 加载本地 `frontend/` |
| **适配层** | desktop-first | desktop + `styles.mobile.css` 移动端专属 |
| **K 线** | hover 十字线 / box-select | 拖拽平移 / tap 十字线 / 双击回位 |

### Python → JS 移植设计

`frontend/bridge/backend.js` 是 `backend/server.py` 的 1:1 移植。设计原则：

1. **HTTP 层抽象为 `httpGet(url, {headers, enc, timeout, retry})`**
   - CapacitorHttp 环境：走原生 `Capacitor.Plugins.Http.get()`
   - Node 环境（用于 `_regress.cjs` 对比测试）：用 Node 原生 `fetch`
   - 浏览器纯 `fetch`：走 `arraybuffer` → `TextDecoder`，解决编码 + CORS
   
2. **所有解析函数 `_parse_sina_us` / `_parse_tx_us` / `parse_tx_hf` … 名字与 Python 版完全相同** — 便于 Node 原生 fetch 回归测试和 Python 输出对比

3. **缓存 / 限流 / 熔断逻辑 1:1 保留** — `_KLINE_CACHE` + `_KLINE_FAIL_TTL` + 东财节点轮询

4. **`enc:'gbk'` 默认值** — 腾讯 `qt.gtimg.cn` 中文股票名字走 GBK 编码，解错就是乱码

### APK 构建链路

```bash
npm install                         # 装 @capacitor/cli + @capacitor/android
npx cap add android                 # 首次生成 android/ 目录
# 把 capacitor.config.json 里 CapacitorHttp.enabled = true
npx cap sync android                # 把 frontend/ 复制到 android/app/src/main/assets/public/
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

**关键配置**（缺了就会 CORS）：

```json
// capacitor.config.json
{
  "plugins": {
    "CapacitorHttp": { "enabled": true }
  }
}
```

---

## 目录结构

```
galaxypulse/                    # android 分支
├── android/                    # Capacitor 生成的 Android 工程
│   ├── app/build.gradle        # 编译配置（compileSdk 34, minSdk 23）
│   ├── app/src/main/AndroidManifest.xml
│   ├── app/src/main/assets/    # ← npx cap sync 后 frontend/ 复制到这里
│   └── gradle/
├── frontend/                   # 和 main 同名，但多了 bridge/ 和 mobile.css
│   ├── index.html
│   ├── app.js                  # 含 isMobileView() 视窗判断 + 移动端手势
│   ├── styles.css
│   ├── styles.mobile.css       # 移动端专属（安全区 / 底部 pill / 触控 ≥ 38px）
│   ├── bridge/                 # ← main 没有的，后端移植层
│   │   ├── backend.js          # HTTP + 行情解析（server.py → JS）
│   │   ├── service.js          # 行情组装 / K 线调度
│   │   ├── api.js              # fetchKline / fetchLive 入口
│   │   ├── storage.js          # localStorage 自选持久化
│   │   └── _regress.cjs        # Node 原生 fetch 回归测试
│   └── sw.js
├── capacitor.config.json       # 告诉 Capacitor: webDir=frontend, CapacitorHttp=on
├── package.json                # @capacitor/core / @capacitor/cli / @capacitor/android
├── backend/server.py           # 保留，作为 Python 版实现的参照
├── CHANGELOG.md
└── README.md                   # ← 就是这个文件
```

---

## 快速开始（装到手机）

### 前置
- Node.js 18+
- Android Studio（或命令行 SDK：`platform-tools` + `build-tools` + `platforms;android-34`）
- Java 17（Gradle 8 要求）
- 手机开 USB 调试，或者 `adb install`

### 构建

```bash
# 1. 依赖
npm install

# 2. 同步前端到 android assets
npx cap sync android

# 3. 构建 APK
cd android
./gradlew assembleDebug --no-daemon

# 4. 找到 APK
ls -lh app/build/outputs/apk/debug/app-debug.apk
# 或直接
cp app/build/outputs/apk/debug/app-debug.apk ~/Desktop/GalaxyPulse.apk
```

### 安装

```bash
# adb 命令行
adb install -r ~/Desktop/GalaxyPulse.apk

# 或拖到手机 /storage/emulated/0/Download/ 里，文件管理器点开安装
```

### 后续开发

改了 `frontend/` 里的东西，**一定要**先 `npx cap sync android` 再构建 —— APK 里的前端代码不会自动更新。

---

## 真机验证清单

| 项 | 预期 | 验证方式 |
|---|---|---|
| **GBK 编码** | A股中文名正常显示（茅台 / 中芯 / 长信） | 打开"纳指与美 ETF"卡 → 滚到 A股 → 名字不是乱码 |
| **KPI 数据** | IXIC / INX / DJI 三个指数有值 | 首页 KPI 横向滑动卡轨 |
| **K 线** | 点开任意卡片能看到 90 根 K 线 | 拖拽平移、查看十字线 |
| **Hero spark** | 主指数上方迷你走势线 | 面积折线，最新点微亮 |
| **滚动流畅** | 上下拖动 60 FPS | v19 已经砍光 backdrop-filter 和重特效 |
| **弹层** | 历史走势 sheet、工作台 sheet 全屏贴底 | `transform: translateY(100%)` 覆盖桌面 `translateX(-50%)` |
| **底部 Tab** | 固定 pill，不随滚动跑 | iPhone 刘海屏/安卓挖孔屏都安全区对 |

---

## 已知限制

1. **首次启动需要等行情** — 没有 mock 数据，上游接口不通时会看到"行情获取失败"提示。国内网络如果直连 `qt.gtimg.cn` 慢可以换代理。
2. **基金历史净值在 App 里也会 CORS** — 免费基金净值接口 `api.fund.eastmoney.com/f10/lsjz` 有时拦 WebView，后端 JS 桥接层已经做了 `fetch + mode: 'no-cors'` 兜底，但这个接口本身是 HTTPS + 同源策略，能拿到最好，拿不到跳过。
3. **K 线视窗固定** — 手机默认展示 60 根蜡烛（桌面全量），拖拽平移查看历史。后续可以加"查看更多"按钮。
4. **iOS 未测试** — Capacitor 理论上也能出 iOS 版，需要一台 Mac + Xcode，我没有。

---

## 后续升级预期

| 方向 | 内容 |
|---|---|
| **正式签名** | 现在是 `assembleDebug`（debug 签名）。上架 Play Store 需要 `assembleRelease` + keystore + Google Play Signing |
| **iOS 版** | 同 `capacitor.config.json`，`npx cap add ios` + `npx cap sync ios` + Xcode archive。需要 Apple Developer 账号（$99/年） |
| **行情接口换付费源** | Polygon / Finnhub / Alpha Vantage，`backend.js` 的 `httpGet` 抽象可以直接插进去。免费源的稳定性是长期最大痛点 |
| **实时 WebSocket** | 现在是 60s 轮询。腾讯有 `wss://qt.gtimg.cn/ws`，换成实时推送延迟到秒级。Capacitor WebView 原生支持 WebSocket |
| **自选同步** | 存在 localStorage → 换设备丢。加 Cloudflare Worker 做 JSON 同步端点，桥接层加 `POST /watchlist` |
| **原生推送告警** | 自定义涨跌幅阈值触发通知。Capacitor 有 `@capacitor/push-notifications` 插件 |
| **原生 Tab 栏** | 现在底部 pill 是 HTML + CSS 模拟的。换成 `@capacitor/browser` + 原生 tab 切换不同 WebView |
| **桌面版** | Electron / Tauri 打包，已经有 Python 后端可以直接嵌。Tauri 更轻量（~5MB） |
| **图表库替换** | 原生 Canvas 手写 K 线维护成本高。TradingView Lightweight Charts 轻量且交互全，只需要把 `drawHistFrame` 换成 `setData` |
| **离线 K 线** | 加 IndexedDB 缓存，Service Worker 已经有了 |

---

## 版本演进

| 版本 | Commit | 关键改动 |
|---|---|---|
| **v18** | `c52626e` | 乱码根因修复（GBK arraybuffer + TextDecoder）· K 线视窗 60 根蜡烛 · 移动端全屏弹层 · 工作台配置增删自选 |
| **v19** | `3e739d6` | 砍光 backdrop-filter / aurora / hero 光束描边 —— 移动端滚动流畅度攻坚；Canvas resize 缓存；移动端自动 reduce-motion；弹层暂停轮询 |

完整历史见 `CHANGELOG.md`。

---

## 与 main 分支的关系

本仓库有两个分支：

| 分支 | 内容 | 适用场景 |
|---|---|---|
| `main` | **纯网页版** — Python `server.py` + 浏览器直跑 | 本地 / 服务器 / 局域网看盘 |
| `android` | **Android 改造版** — 本分支，Capacitor + JS 后端桥接 | 装手机里 |

本分支的 `frontend/styles.mobile.css` 和 `frontend/bridge/` 是 main 没有的。`backend/server.py` 保留作为 Python 版参照。
