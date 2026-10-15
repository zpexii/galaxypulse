# CHANGELOG — GalaxyPulse 全球市场脉动

所有重要变更将记录于此。按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式维护。

---

## [v1.3.0] — 2026-10-15 · Android v18 顶级体验精修

### 修复
- **乱码根因**：腾讯行情接口返回 GBK 编码，原链路按 UTF-8 解码导致 A 股 / 期货中文名乱码；CapacitorHttp 统一改 `arraybuffer` 取原始字节，JS 层 `TextDecoder('gbk')` 解码
- **指数 K 线只有 1 根/打不开**：普通日 K 正确路径是 `kline/kline`（原误写 `kline/get`），复权接口对指数仅返回 1 根
- 基金补全涨跌额 / 前收净值 / 中文全名，改天天基金 LSJZ 并发取数
- A 股时间戳 `20261015120556` 格式化为 `2026-10-15 12:05`
- 历史走势弹层手机端只占半屏（桌面 `translateX(-50%)` 居中未覆盖）
- 顶栏主题 / 配置按钮在窄屏被挤出屏幕，Hero 成交量列被裁切

### 新增
- **K 线图手机视窗**：蜡烛 60 根 / 线图 90 点窗口，单指左右拖动平移历史，轻点查看当日十字光标，双击回到最新；右缘"更新中"微光提示
- NQ 纳指期货三级兜底（腾讯 → 东财 → 新浪 `hf_NQ`）
- HTTP 请求失败自动重试一次；行情聚合 4.5 秒硬上限，单一数据源挂起不拖死首屏
- KPI 卡横向滑动轨道，点击可打开对应指数 / 指标历史走势
- 纵轴价格标签改绘图区内胶囊，日期轴首末向内收，触控目标全部 ≥38–44px

### 变更
- 手机端顶栏 / Hero / 网格 / 弹层 / 底部 Tab 全元素重新适配（CDP 390px 逐屏验证）
- 底部模式切换改 fixed 悬浮 pill，安全区留白全局只计算一次
- 主题弹层改 fixed 深毛玻璃，消除与背景文字叠印
- Python server 同步兼容 `indexes` 历史命名与腾讯期货日 K

---

## [v1.2.0] — 2026-10

### 新增
- **feat** PyInstaller 打包兼容：后端通过 `sys.frozen` 判断运行模式，自动定位前端静态资源目录
- **feat** `requests` 缺失时的标准库 `urllib.request` 兜底实现，避免依赖缺失导致静默空数据
- **feat** 跨平台一键启动脚本（start.sh macOS/Linux + start.bat Windows），检测 Python 环境、默认端口 8000

---

## [v1.1.0] — 2026-10

### 修复
- **fix** 历史走势 K 线数量为 1 根时触发 `TypeError` 异常（K 值下限处理不当）
- **fix** 美债收益率取数（US10Y / US30Y）—— 东方财富 secid 接口口径变更兼容

---

## [v1.0.0] — 2026-10

### 新增
- **feat** 全栈版本首次入库：Python `ThreadingHTTPServer` 后端聚合新浪财经 / 东方财富行情，PWA 前端看板
- **feat** 实时指数面板：纳斯达克综合 / 纳斯达克 100 / 标普 500 / 道琼斯
- **feat** 美股 ETF 池 + 自选列表（本地 JSON 持久化）
- **feat** 美元 / 黄金 / 美债收益率指标卡
- **feat** 历史走势图表（K 线 + 成交量 + 技术指标）
- **feat** 后端兼容源码运行与 PyInstaller 打包两种场景
- **feat** 后端提供跨平台启动脚本，自动检测 Python 环境与端口

---

*本仓库从旧账号 yj9j6xt668/nsdk-help 迁移至 zpexii/galaxypulse，历史 commit 完整保留。*
