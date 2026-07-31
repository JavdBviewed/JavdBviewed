<script setup>
import DownloadCenter from '../.vitepress/components/DownloadCenter.vue'
</script>

# 下载与更新

浏览器扩展已提供正式下载。Cloud 以 Docker 容器交付；桌面端和 Android 客户端将在准备完成后开放。

<DownloadCenter />

## 扩展安装

1. 下载最新扩展 ZIP 并解压到固定目录。
2. 在 Chromium 浏览器打开扩展管理页，例如 Chrome 的 `chrome://extensions/`。
3. 开启“开发者模式”，选择“加载已解压的扩展程序”，然后选中解压目录。
4. 后续更新时下载新的 ZIP、替换目录内容，再在扩展管理页重新加载。

下载卡片优先读取 GitHub Latest Release 并直达扩展 ZIP。GitHub API 暂时不可用时，入口会自动回退到 [Releases 页面](https://github.com/lmixture/JavdBviewed/releases)。

## Cloud 部署指南 {#cloud-deploy}

> [!IMPORTANT]
> 部署前请确认上方 Cloud 状态。只有 stable 清单显示“已发布”时才执行拉取；“发布准备中”表示镜像、摘要或发布说明仍可能调整。

Cloud 只提供容器镜像，不提供桌面安装包，也不会自行替换或重启正在运行的容器。下面的 Compose 配置将数据保存在当前目录的 `data/`，并启用只读根文件系统、无额外 capabilities 和禁止提权。

### 1. 准备目录

新建一个独立部署目录，并在其中创建 `compose.yaml`：

```yaml
services:
  cloud:
    image: ${CLOUD_IMAGE_NAME:-ghcr.io/lmixture/javdbviewed-cloud:1.0.0}
    container_name: javdbviewed-cloud
    restart: unless-stopped
    ports:
      - "18080:8080"
    environment:
      CLOUD_ADDR: ":8080"
      CLOUD_DATA_DIR: /data
      CLOUD_ADMIN_USER: admin
      CLOUD_JWT_SECRET: ${CLOUD_JWT_SECRET}
      CLOUD_ADMIN_PASSWORD: ${CLOUD_ADMIN_PASSWORD:-}
      CLOUD_UPDATE_MANIFEST_MIRRORS: ${CLOUD_UPDATE_MANIFEST_MIRRORS:-}
    volumes:
      - ./data:/data
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp:size=64m,mode=1777,noexec,nosuid,nodev
    healthcheck:
      test: ["CMD", "/app/cloud", "healthcheck"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

同目录创建 `.env`。`CLOUD_JWT_SECRET` 必须使用至少 16 位的强随机值；可以用 `openssl rand -hex 32` 生成：

```dotenv
CLOUD_IMAGE_NAME=ghcr.io/lmixture/javdbviewed-cloud:1.0.0
CLOUD_JWT_SECRET=请替换为强随机值

# 可选：至少 16 位且包含大小写字母、数字、符号中的三类。
# 留空时，首次启动日志会输出一次性 temporaryPassword。
CLOUD_ADMIN_PASSWORD=

# 可选：GitHub Raw 访问困难时填写完整的 stable.json 镜像地址。
# 多个地址使用英文逗号分隔。
CLOUD_UPDATE_MANIFEST_MIRRORS=
```

### 2. 拉取并启动

stable 清单标记为已发布后，在部署目录执行：

```bash
docker compose pull cloud
docker compose up -d cloud
docker compose ps
```

若没有设置 `CLOUD_ADMIN_PASSWORD`，从首次启动日志取得临时密码：

```bash
docker compose logs --tail 100 cloud
```

管理员账号固定为 `admin`。首次登录后按提示修改密码。

### 3. 核对服务与版本

```bash
curl -fsS http://127.0.0.1:18080/health
curl -fsS http://127.0.0.1:18080/version
```

管理页面位于 `http://127.0.0.1:18080/`。`/version` 返回的 `version`、`commit`、`buildNumber` 和 `releaseChannel` 应与 [stable 清单](https://raw.githubusercontent.com/lmixture/JavdBviewed-release/main/manifests/cloud/stable.json)一致。公网部署请在 Cloud 前增加 Caddy 或 nginx，并只通过 HTTPS 对外提供服务。

### 4. 升级

1. 在管理台创建快照，并额外备份部署目录下的 `data/`。
2. 确认 stable 清单已标记为 `released`，记录目标镜像 tag 和 digest。
3. 修改 `.env` 中的 `CLOUD_IMAGE_NAME`。
4. 拉取镜像并重新创建容器，然后核对健康、版本和管理员登录。

```bash
docker compose pull cloud
docker compose up -d cloud
docker compose logs --tail 100 cloud
```

升级时始终保留原 `data/` 目录。Cloud 的更新检查只负责提示，不会自动执行上述操作。

### 5. 回滚

把 `.env` 中的 `CLOUD_IMAGE_NAME` 改回上一个已验证的版本 tag，再执行：

```bash
docker compose pull cloud
docker compose up -d cloud
```

镜像回滚不会自动回滚数据。若升级涉及数据迁移并出现异常，应停止容器，再从升级前快照或 `data/` 备份恢复；不要删除或重新初始化原数据目录。

## 更新通道

| 通道 | 状态 | 用途 |
| --- | --- | --- |
| `stable` | 当前使用 | 普通自部署用户的唯一更新通道 |
| `beta` | 预留 | 未来测试版本，暂不提供部署清单 |
| `dev` | 预留 | 本地开发或内部验证，暂不提供部署清单 |

Cloud 内置 stable 官方清单地址，不需要配置主地址、检查开关或通道。文档站域名变化不会影响容器检查更新。

## 网络加速

`CLOUD_UPDATE_MANIFEST_MIRRORS` 只用于加速读取更新清单。填写一个或多个完整的 `stable.json` 地址，Cloud 会按顺序尝试，全部失败后回退到官方主源：

```dotenv
CLOUD_UPDATE_MANIFEST_MIRRORS=https://mirror.example.com/lmixture/JavdBviewed-release/main/manifests/cloud/stable.json,https://another.example.com/lmixture/JavdBviewed-release/main/manifests/cloud/stable.json
```

镜像地址必须返回与官方清单兼容的 JSON，不能修改版本、镜像 tag 或摘要。它不是新的更新通道，也不会改变可信发布源。GHCR 镜像拉取加速属于 Docker 守护进程配置，应在宿主机使用自己信任的 registry mirror；不要把 registry 地址填入这个变量。
