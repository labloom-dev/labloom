# Research Desk

Research Desk 是一个基于 Tauri 的本地优先个人学术工作台。应用在单个桌面窗口中提供 RSS、arXiv 订阅、会议/期刊截止日期管理，以及 Zotero 浏览和本地 Markdown 数学笔记。

## 功能

- RSS / Atom / JSON Feed 订阅、搜索、已读、收藏和三栏阅读
- 按订阅记录 ETag 与 Last-Modified，支持启动刷新和定时刷新
- OPML 导入和导出
- 通过分类、关键词和作者创建 arXiv 查询，支持打开摘要页和 PDF
- DDL 列表与月历、新增、编辑、删除、CSV 导入导出和 CCF RSS 导入
- 只读浏览 Zotero 本机分类与论文条目，支持打开 Zotero 条目及可用附件
- 每个 Zotero 条目一份本地 Markdown 笔记，支持编辑、分栏和预览
- MathJax 4 CHTML 数学渲染，支持 AMS 环境和常用自定义宏
- 跟随系统的浅色/深色主题，也可手动选择

## 技术栈

- Tauri 2 与官方 Store、HTTP、Dialog、FS、Opener 插件
- Svelte 5 runes、TypeScript、Vite 和 scoped CSS
- feedsmith、csv42、CodeMirror 6、markdown-it、MathJax 4、DOMPurify
- Event Calendar（仅 DayGrid 和 List）与 Lucide Svelte

应用没有后端服务器和数据库。CodeMirror、markdown-it、MathJax 与 Event Calendar 均按需加载。

## 开发

环境需要 Node.js、pnpm、Rust 和当前平台的 Tauri 2 系统依赖。

```bash
pnpm install
pnpm tauri dev
```

只启动 Vite 可检查静态界面，但 Store、HTTP、Dialog、FS 和 Opener 依赖 Tauri runtime，普通浏览器中不会工作。

## 检查与构建

```bash
pnpm check
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build
```

`pnpm build` 会将 MathJax CHTML 动态模块和字体作为本地资源写入 `dist/mathjax/`。应用运行时不访问 MathJax CDN。

## 本地数据

所有持久化数据都由 `@tauri-apps/plugin-store` 写入单个 `research-desk.json`，顶层 key 为：

```text
schemaVersion
settings
feeds
entries
deadlines
paperNotes
```

常见默认位置：

- Linux：`~/.local/share/dev.researchdesk.desktop/research-desk.json`
- macOS：`~/Library/Application Support/dev.researchdesk.desktop/research-desk.json`
- Windows：`%APPDATA%\dev.researchdesk.desktop\research-desk.json`

实际目录由 Tauri 的应用数据目录规则决定。Feed 文章数量受设置中的每 Feed 上限约束；应用不保存 PDF、图片、完整网页或 MathJax 渲染结果。笔记只保存原始 Markdown。

## Zotero

1. 启动 Zotero，并在 Zotero 设置中允许本机应用访问其 Local API。
2. Research Desk 默认连接 `http://localhost:23119/api`。
3. 在 Research Desk 设置中可修改该地址，然后进入 Zotero 页面重试。

Research Desk 只读取 Zotero Local API，不读取或修改 `zotero.sqlite`，也不会写回 Zotero Notes。打开条目使用 `zotero://select/library/items/{ITEM_KEY}`。只有 API 提供可靠附件链接时才显示附件按钮。

## OPML

RSS 页可导入标准 OPML 订阅文件。应用读取 outline 的 `xmlUrl`、`htmlUrl`、`title`/`text` 和嵌套文件夹；导出格式为 OPML 2.0。只接受 HTTP 或 HTTPS Feed URL。

## DDL CSV

CSV 必须使用以下固定表头和顺序：

```csv
title,type,deadlineAt,timezoneLabel,url,note
```

- `title` 必填
- `type` 只能是 `conference` 或 `journal`
- `deadlineAt` 必须是带时区偏移的 ISO 8601，例如 `2027-05-15T23:59:00-12:00`
- AoE 使用 `-12:00`，`timezoneLabel` 可填写 `AoE`
- `url` 和 `note` 可为空
- 导入记录的 `source` 为 `csv`，按 `title + deadlineAt` 去重

CCF RSS URL 可在设置中预先填写，也可在 DDL 页首次点击“CCF RSS”时填写。只有带明确时区且能够可靠解析的 Feed 日期会被导入。

## 当前不支持

- AI、LLM、Embedding、RAG 或推荐算法
- 登录、云同步、多人协作或通知
- SQLite 或其他数据库
- PDF 下载管理、解析、标注或全文搜索
- 网页全文抽取
- Zotero 写入、Zotero Notes 同步或 Zotero Web API 云端同步
- Google Calendar、ICS 和邮件同步
- 自动更新、开机启动和后台服务

## 常见问题

### 未连接到 Zotero

确认 Zotero 正在运行，本机 API 已启用，并检查设置中的地址是否为 `http://localhost:23119/api`。端口被防火墙拦截或 Zotero 禁用本机 API 时也会连接失败。

### RSS 或 arXiv 刷新失败

检查订阅 URL、网络和远端服务状态。每个 Feed 的错误独立记录，不会中断其他订阅。arXiv 请求会串行并保持间隔，以遵守公共 API 的访问频率。

### HTTP scope denied

若错误包含 capability 或 scope denied，确认运行的是最新 Tauri 构建，并检查 `src-tauri/capabilities/default.json`。修改 capability 后需要重新启动 `pnpm tauri dev`。

### 数学预览首次加载较慢

MathJax、CHTML 字体元数据和编辑器均为延迟加载。首次展开笔记并预览公式时需要初始化本地资源，后续渲染会复用缓存。

### Arch Linux 上 AppImage 打包失败

较新的 Arch Linux `gdk-pixbuf 2.44` 不再提供旧的 loader 目录，而 Tauri 当前下载的 `linuxdeploy-plugin-gtk` 仍会复制该目录。此时 release 二进制、DEB 和 RPM 可以正常生成，但 AppImage 阶段会报 `cannot stat .../gdk-pixbuf-2.0/2.10.0`；请在提供兼容 loader 目录的构建环境中生成 AppImage，或等待上游 GTK 打包插件更新。
