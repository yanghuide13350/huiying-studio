# 慧影工坊 · Huiying Studio

慧影工坊是一款 AI 视频制作工作台，将剧本创作、角色与场景设计、分镜生成、视频制作和拼接导出整合在一个应用中，适合短剧、漫剧和文学故事视频制作。

## 功能介绍

- **剧本创作与改写**：整理故事内容，按剧集推进创作，通过 AI 改写和细化剧情。
- **角色、场景与道具**：管理人物和素材，为分镜绑定参考图片，保持人物形象与场景风格的一致性。
- **分镜制作**：编辑画面描述、台词、氛围、时长和生成提示词，按镜头组织制作任务。
- **图片与视频生成**：配置文本、图片和视频模型服务，生成素材与镜头视频，支持批量视频任务。
- **连续大屏预览**：点击视频画面打开预览，直接切换上一个、下一个镜头，按 ESC 关闭。
- **素材管理与重绘**：选择删除镜头视频或成片，同时清理对应的本地文件；重绘会替换目标旧图片或视频。
- **拼接与导出**：组合镜头生成成片，统一画幅、帧率和音频规格，管理和下载导出结果。
- **文学故事制作**：支持原文检索、人物阶段管理，以及分镜时长和声音连续性规则。
- **本地保存**：项目、配置和生成素材保存在本机，支持自定义存储位置。

## 下载与使用

到 [Releases 下载页面](https://github.com/yanghuide13350/huiying-studio/releases/latest) 选择安装包：

| 系统 | 下载文件 |
| --- | --- |
| Apple 芯片 Mac | 带 `arm64` 的 `.dmg` |
| Intel Mac | 带 `x64` 的 `.dmg` |
| Windows 64 位 | `setup` 安装程序 `.exe` |

1. Mac 打开 DMG，将「慧影工坊」拖入应用程序；Windows 双击安装程序完成安装。
2. 首次启动，在设置中配置自己的模型服务和 API 密钥。软件不附带模型额度。
3. 新建项目，依次完成剧本、素材、分镜视频和拼接导出。

当前安装包未配置 Apple 公证与 Windows 代码签名，系统可能显示安全提示。Windows 和 Intel Mac 的完整实机操作验收状态见发布说明。

维护者：杨慧德。

## 开发

需要 Node.js 22 或更新的受支持版本，以及 npm。依赖安装使用 npm 锁定文件。

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

## 许可

本项目采用 [CC BY-NC-SA 4.0](LICENSE) 许可。来源署名及修改说明见 [NOTICE](NOTICE.md)，版本记录见 [CHANGELOG](CHANGELOG.md)。第三方依赖适用各自的许可。
