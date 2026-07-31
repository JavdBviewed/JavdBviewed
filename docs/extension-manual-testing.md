# 拓展真浏览器测试指南

本项目已有 Vitest 覆盖拓展内部逻辑。这里补充一套 **Playwright + 持久化 Chromium profile** 的测试入口，用于验证构建后的 MV3 拓展能在真实浏览器上下文里加载、打开 popup/dashboard，并允许人工或 AI 做探索测试。

## 快速启动

在 `F:\JavdBviewed-project\JavdBviewed` 运行：

```bash
pnpm run test:extension:open
```

脚本会先构建拓展，再启动 Chromium，并使用本地测试 profile：

```text
F:\JavdBviewed-project\JavdBviewed\.test-profiles\extension-chromium
```

第一次需要登录目标网站时，请在这个测试浏览器里手动登录一次；后续 cookies、localStorage、IndexedDB 会保留在测试 profile 中。

## 打开指定页面

打开 dashboard：

```bash
pnpm run test:extension:open -- --dashboard
```

打开某个目标站点，让 content script 自动注入：

```bash
pnpm run test:extension:open -- --url=https://example.test/page
```

降低操作速度，方便观察：

```bash
pnpm run test:extension:open -- --slow-mo=250
```

如果需要用别的 Chromium channel：

```bash
pnpm run test:extension:open -- --channel=chrome
```

默认 channel 是 `chromium`。若本机缺少 Playwright Chromium，可先运行：

```bash
pnpm exec playwright install chromium
```

## 冒烟测试

运行构建后拓展的真浏览器冒烟测试：

```bash
pnpm run test:extension:e2e
```

当前冒烟测试会验证：

- MV3 service worker 可加载，并能解析拓展 ID；
- `popup/popup.html` 能打开，body 非空；
- `dashboard/dashboard.html` 能打开，body 非空；
- 打开这些拓展页面时没有 `pageerror` 或 console error；
- 如果设置了 `JAVDB_EXTENSION_URL`，会额外打开该网页，方便观察 content script。

失败时 Playwright 会把截图、video、trace 留在：

```text
test-results/extension-e2e
```

## 环境变量

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `JAVDB_EXTENSION_DIST` | 已构建拓展目录 | `dist` |
| `JAVDB_EXTENSION_PROFILE` | 测试浏览器用户数据目录 | `.test-profiles/extension-chromium` |
| `JAVDB_EXTENSION_URL` | 冒烟测试额外打开的目标网页 | 空 |
| `JAVDB_EXTENSION_CHANNEL` | Playwright Chromium channel | `chromium` |

## 不建议直接复制主 Chrome 数据

不要直接把日常 Chrome 的主 `User Data` 目录拿来自动化。里面包含 cookie、历史记录、站点数据和其他敏感信息，也容易遇到 Chrome profile 锁或自动化策略限制。

推荐做法：使用本测试 profile，首次手动登录一次。只有在确实无法复现登录态时，才复制一个专门创建的 Chrome profile，并确保 Chrome 已完全退出。
