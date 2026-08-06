# JavdBviewed

<div align="center">

![Jav 助手](apps/extension/src/assets/favicons/light/favicon-128x128.png)

**Jav 视频浏览助手**

[![GitHub release](https://img.shields.io/github/v/release/JavdBviewed/JavdBviewed-release)](https://github.com/JavdBviewed/JavdBviewed-release/releases)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://github.com/JavdBviewed/JavdBviewed-release/releases)

</div>

## 📖 简介

Jav 助手是一个功能强大的浏览器扩展，专为 JavDB 等 Jav 视频网站设计。它能够在列表页和详情页标记视频的“已浏览”或“我看过”状态，并提供丰富的数据管理功能，包括 WebDAV 同步、数据导入导出、115 v2 离线下载集成等高级特性。

📚 **[查看详细使用教程](https://docs.we-together.club/guide/)** - 包含完整的功能说明和使用指南

---
### ⭐ 如果您觉得这个项目对您有帮助，请给它一个 Star！

**您的支持是我持续维护和改进的最大动力 💪**

---
**不接受任何金钱形式的捐赠**
## **项目欢迎各位的pr，也欢迎提供AI的token（codex、claude）支持项目进度**
---

> **⚠️ 重要提示**
> 
> 本扩展仅供**年满18周岁的成年用户**使用。
> 
> - 🔞 本扩展涉及的内容相关功能，请确保您已达到所在地区的法定成年年龄
> - 🚫 请勿在未成年人可访问的设备上安装或使用本扩展
> - 🔒 建议启用扩展内置的隐私保护功能，保护个人隐私
> 
> **开发者不对用户的使用行为承担任何责任，请合法合规使用。**

## ✨ 核心功能

- 🎯 **视频标记** - 已浏览、已观看、想看三种状态标记，智能优先级显示
- 📚 **数据管理** - 番号库、演员库管理，支持导入导出和统计分析
- ☁️ **云端同步** - WebDAV 自动同步，支持多设备数据一致性
- 💾 **115网盘** - 115 v2 离线下载授权、详情页推送、任务管理与联动标记
- 🎨 **页面增强** - 列表预览、详情增强、智能过滤和隐藏
- 👥 **演员管理** - 演员收藏、订阅、黑名单和智能过滤
- 🆕 **新作品监控** - 跟踪订阅演员的新作品，并与详情页操作联动
- 🔍 **磁力搜索** - 多源自动搜索，支持自定义搜索引擎
- 🔒 **隐私保护** - 截图模糊模式，保护敏感信息
- 📊 **数据分析** - 统计报告与可视化结果查看
- 🎬 **Emby增强** - Emby服务器集成和快捷跳转
- 🤖 **AI翻译** - 支持多种AI模型的内容翻译

> 📖 **查看完整功能清单**: [功能总览](https://docs.we-together.club/reference/features) - 按当前真实功能整理

## 🔄 2.0.0 升级与数据迁移

2.0.0 是固定扩展 ID 的主版本升级。Chrome 不会自动把旧 1.x 扩展 ID 的本地数据迁移到新版本，首次安装前请先完成备份。

1. 在旧版扩展中打开“备份与恢复”，选择“导出 ZIP 备份”，确认文件已经下载并可正常保存。
   如果已经配置 WebDAV，再执行一次云端上传，把 ZIP 作为第二份恢复点。
2. 在浏览器扩展管理页保留旧版扩展，不要先卸载；安装并加载 2.0.0 的解压目录。
3. 打开 2.0.0 的“备份与恢复”，选择“导入本地备份”，优先导入 ZIP；历史 JSON 备份也兼容，确认备份范围后完成恢复。
4. 确认番号库、观看记录、演员库、清单和设置恢复正常后，再决定是否移除旧版扩展。

导入失败时不要删除旧版扩展或清理浏览器数据。继续使用旧版导出备份，或从 2.0.0 的“高级配置”导出当前状态后再排查。完整使用说明请查看[在线文档](https://docs.we-together.club/)。

## 🖼️ 界面预览（以实际为准，不会及时更新）

### 首页数据图表
<div align="center">
<img src=".github/assets/首页.png" alt="首页数据图表" width="800">
<p><em>首页 - 数据统计和可视化图表，一目了然查看观看记录</em></p>
</div>

### 番号库管理
<div align="center">
<img src=".github/assets/番号库.png" alt="番号库管理" width="800">
<p><em>番号库 - 管理和查看已标记的视频番号</em></p>
</div>

### 演员库管理
<div align="center">
<img src=".github/assets/演员库.png" alt="演员库管理" width="800">
<p><em>演员库 - 演员信息管理和分类功能</em></p>
</div>

### 新作品监控
<div align="center">
<img src=".github/assets/新作品.png" alt="新作品监控" width="800">
<p><em>新作品 - 自动监控和订阅感兴趣的新发布内容</em></p>
</div>

### 115网盘任务
<div align="center">
<img src=".github/assets/115.png" alt="115网盘任务" width="800">
<p><em>115任务 - 离线下载任务管理、搜索、刷新与状态查看</em></p>
</div>

### AI观影报告
<div align="center">
<img src=".github/assets/报告.png" alt="AI观影报告" width="800">
<p><em>AI观影报告 - 生成详细的观影报告，包括观看时间、观看次数、观看演员等</em></p>
</div>

## 📦 安装方式

### 前置要求

- **基本功能**: 支持 Chrome、Edge 等基于 Chromium 的浏览器
- **115网盘功能**: 建议准备可用的 115 账号，并在扩展 `设置 → 115网盘` 中完成 v2 授权

### 方式一：下载预编译版本（推荐）

> **📢 关于 Chrome 应用商店发布说明**
> 
> 根据 Chrome Web Store 开发者计划政策第 2.7 条规定：
> 
> > **2.7 Adult Content**  
> > *The extension contains content that is pornographic or sexually explicit.*  
> > （扩展包含色情或性暗示内容）
> 
> 
> 用户需要通过以下方式手动安装本扩展。在 GitHub Releases 页面提供最新版本的更新。

**安装步骤：**

1. 访问 [Releases 页面](https://github.com/JavdBviewed/JavdBviewed-release/releases)
2. 下载最新版本的 `javdb-extension-v*.zip` 文件
3. 使用发布说明中提供的密码解压到本地文件夹；2.0.0 的解压密码是 `我已备份数据`
4. 打开浏览器扩展管理页面：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
5. 开启"开发者模式"
6. 点击"加载已解压的扩展程序"，选择解压后的文件夹


## 🛠️ 二次开发与部署

技术文档现已统一迁移到在线文档中心：

- [二次开发指南](https://docs.we-together.club/developer/development)
- [架构说明](https://docs.we-together.club/developer/architecture)
- [开发文档首页](https://docs.we-together.club/developer/)

### 部署与打包

#### 本地构建扩展
```bash
pnpm install
pnpm run build
```

构建完成后，将 `dist` 目录作为未打包扩展加载到浏览器中。

#### 提交前检查
```bash
pnpm run typecheck
pnpm run test
pnpm run test:unit
pnpm run test:regression
pnpm run test:dom
pnpm run test:coverage
pnpm run build
```

#### 文档站

VitePress 文档站已独立维护于 [JavdBviewed-Docs](https://github.com/JavdBviewed/JavdBviewed-Docs)，其中包含本地开发、构建与 Vercel 部署说明。

#### 发布扩展
1. 更新版本号：
   ```bash
   pnpm run version:patch
   ```
2. 构建发布版本：
   ```bash
   pnpm run build
   ```
3. 创建 GitHub Release 并上传打包产物

## 📄 许可证

本项目采用 [AGPL-3.0](LICENSE) 许可证。修改、分发或通过网络提供修改版时，必须按 AGPL-3.0 公开对应源码；如需闭源集成、商业二开或托管修改版而不公开源码，请先取得作者书面授权。

## 🤝 支持与反馈

如有问题或建议，欢迎通过以下方式联系：
- 💬 提交 [Issue](https://github.com/JavdBviewed/JavdBviewed/issues) - 报告问题或提出功能建议
- 🗨️ 发起 [Discussion](https://github.com/JavdBviewed/JavdBviewed/discussions) - 参与讨论和交流


## 致谢

- [Linux Do](https://linux.do) - 佬友开发社区

---

<div align="center">

### ⭐ 如果您觉得这个项目对您有帮助，请给它一个 Star！

**您的支持是我持续维护和改进的最大动力 💪**

[![Star History Chart](https://api.star-history.com/svg?repos=JavdBviewed/JavdBviewed&type=Date)](https://star-history.com/#JavdBviewed/JavdBviewed&Date)

</div>
