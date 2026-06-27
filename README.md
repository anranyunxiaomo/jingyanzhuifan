# 井眼追番 (Auto Bangumi Cloud PWA)

基于 GitHub Pages + Actions + 免费临时大文件直链中继的纯云端番剧点播轻应用。

## 🌟 特点
* **零本地部署**：本地无需运行任何 Python/Docker。
* **零凭证配置**：GitHub 仓库无需配置任何 Secrets。
* **双通道直链播放**：Actions 下载后自动通过 `transfer.sh` 与 `pixeldrain` 转换为 14 天有效视频流，前端点击即看。
