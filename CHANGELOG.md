# CHANGELOG — GalaxyPulse 全球市场脉动

所有重要变更将记录于此。按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式维护。

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
