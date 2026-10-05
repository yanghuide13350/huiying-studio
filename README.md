# 慧影工坊 · Huiying Studio

杨慧德维护的 AI 视频制作工作台：从剧本改写、角色与场景素材，到分镜视频制作和拼接导出。

本项目基于 [chatfire-AI/huobao-drama](https://github.com/chatfire-AI/huobao-drama) 的 **v4.0.7** 改造，保留上游署名和许可。上游源码基线为 `f2b4d866e9490f4f71ed4bf14fb7f12648ce1021`；本项目的修改说明见 [CHANGELOG.md](CHANGELOG.md)。

## 已整理的功能

- 视频制作页点击画面打开大预览，预览可连续切换上一个、下一个镜头；按 ESC 关闭。
- 拼接导出的镜头素材与成片列表支持选择删除，同时清理对应本地视频、历史记录和海报。
- 图片或视频重绘时清理目标旧素材与历史，再创建新的生成任务。首帧、尾帧、合成图片分别处理。
- 删除和重绘会检查正在执行的任务、共享文件和参考依赖；数据库操作失败时恢复已暂存的文件。
- 拼接时统一帧率、画幅及音频采样，并控制素材音量，避免直接拼接造成黑帧、时长或音量异常。
- 保留文学原文检索、角色阶段与身份锚点、分镜时长检查及声音连续性规则。
- 保留阿里云万相图片适配器和原有多供应商配置。

## 开发

需要 Node.js 22 或更新的受支持版本，以及 npm。依赖安装使用锁定文件，不需要上游私有 npm 仓库。

```bash
npm ci --prefix backend
npm ci --prefix frontend
npm ci --prefix desktop
```

网页开发需要两个终端：

```bash
npm run dev:backend
npm run dev:frontend
```

打开 `http://localhost:3013`。首次使用在设置页配置自己的模型服务；不要将 API 密钥提交到 Git。

## 验证与桌面构建

```bash
npm run typecheck --prefix backend
npm run build --prefix backend
npm run test:media --prefix backend
npm run build:frontend
npm run dist
```

macOS 本机构建可在 `desktop` 目录执行：

```bash
npm run build:backend
npm run build:main
node scripts/prepare-resources.mjs
npx electron-builder --mac --arm64 --dir
```

完整跨平台安装包仍需在相应平台验证。当前仓库不包含生成内容、数据库、密钥或已编译的软件包。

## 本地数据与升级

macOS 安装版继续读取 `~/Library/Application Support/HuobaoDrama`，让现有项目和存储设置可以接续使用；开发版使用独立的 `HuiyingStudio-Dev` 目录。名称保留仅用于旧数据兼容。

仓库只保存源码和公共提示词／技能模板。数据库、生成图片视频、原著缓存、项目身份元数据和构建产物均留在本地。资源打包也只复制 `prompts` 和 `skills` 两类模板。

自动更新默认关闭。未来发布自己的版本时，可通过 `HUIYING_UPDATE_FEED` 指向本项目的更新清单。发布脚本只向本仓库创建草稿 Release。

## 署名与许可

原项目：**Huobao Drama / 火宝短剧**，作者及维护者 **chatfire-AI 与原贡献者**。原 README 保存在 [docs/upstream/README.zh-CN.md](docs/upstream/README.zh-CN.md)。

改造及维护：**杨慧德**，项目名 **慧影工坊 / Huiying Studio**。更名、功能修改和构建整理始于 2026-10-05。

本衍生项目沿用 **CC BY-NC-SA 4.0（署名、非商业性使用、相同方式共享）**，完整许可见 [LICENSE](LICENSE)。第三方依赖仍适用各自的许可。
