# 1.0.0 验证记录

验证日期：2026-10-05。macOS Apple Silicon，Node.js 22。

## 源码检查

- `npm run typecheck --prefix backend`：通过。
- `npm run build --prefix backend`：通过。
- `npm run generate --prefix frontend`：通过。
- Electron 主进程和后端 esbuild 打包：通过。
- 上游 Wan 3.0 和供应商边界测试：16 项通过（使用 `node --import tsx --test`）。

- 前端供应商配置相关测试：8 项通过；图片万相端点独立于视频 Wan 3.0 端点。

## 媒体清理

`npm run test:media --prefix backend`：通过。真实内存 SQLite 与临时文件验证了视频、成片、历史记录、海报、角色／场景／道具图片、首尾帧隔离、共享引用和活动任务保护、事务失败回滚、路径及符号链接限制。

## 实际页面与 API

用隔离数据库和三段测试视频启动源码服务：

- 制作页点击画面打开大预览；镜头 1 → 2 → 1 连续切换；ESC 关闭通过。
- 三段 1 秒视频成功导出 3 秒成片：90 帧、30fps、320×180，音频 48kHz。
- 选中成片删除成功，列表刷新为 0；对应视频与海报文件消失。
- 批量删除三个镜头的视频成功，三个分镜仍保留，视频 URL 清空，视频目录为空。

以上删除验收使用临时测试素材。没有触发付费模型生成。真实模型生成效果、Windows 安装包及跨架构 macOS 包不在本轮验收范围。
