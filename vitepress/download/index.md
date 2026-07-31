# 下载与更新

JavdBviewed 的客户端会逐步在这里提供下载入口。Cloud 是自部署容器，不提供桌面安装包；它通过 GHCR 镜像发布，并由发布仓库提供更新清单和发布说明。

## Cloud 1.0.0

镜像：`ghcr.io/lmixture/javdbviewed-cloud:1.0.0`

发布通道：`stable`

更新清单：[stable.json](https://raw.githubusercontent.com/lmixture/JavdBviewed-release/main/manifests/cloud/stable.json)

发布说明：[Cloud 1.0.0](https://github.com/lmixture/JavdBviewed-release/blob/main/releases/cloud/v1.0.0.md)

Cloud 只检查并提示更新，不会自动拉取镜像、替换容器或重启服务。

## 安装

在 Cloud 仓库的 `deploy/` 目录准备好 `.env` 和持久化的 `data/` 目录后，把镜像名设为：

```dotenv
CLOUD_IMAGE_NAME=ghcr.io/lmixture/javdbviewed-cloud:1.0.0
```

然后拉取并启动：

```bash
docker compose pull cloud
docker compose up -d --no-build cloud
```

启动后检查：

```bash
curl -s http://127.0.0.1:18080/health
curl -s http://127.0.0.1:18080/version
```

`/version` 返回的 version、commit、buildNumber 和 releaseChannel 应与更新清单一致。

## 更新与回滚

1. 在 Cloud 管理台创建快照，并备份宿主机 `data/` 目录。
2. 把 `CLOUD_IMAGE_NAME` 改为目标版本 tag。
3. 执行 `docker compose pull cloud`，再执行 `docker compose up -d --no-build cloud`。
4. 检查健康接口、版本接口和管理员登录。

更新失败时，把 `CLOUD_IMAGE_NAME` 改回上一个已验证 tag，重复拉取和启动命令。数据异常时，从升级前快照或 `data/` 备份恢复。不要删除或重新初始化原有数据卷。

## 更新通道

| 通道 | 当前状态 | 面向对象 |
| --- | --- | --- |
| `stable` | 已启用 | 普通自部署用户，Cloud 默认且唯一使用的通道 |
| `beta` | 预留 | 未来的测试版，不提供部署配置 |
| `dev` | 预留 | 本地开发或内测，不提供部署配置 |

当前无需也不能通过环境变量切换通道。Cloud 内置 stable 的官方清单地址，文档站域名变动不会影响更新检测。

## 网络加速

网络无法直接访问 GitHub Raw 时，可在 Cloud 的 `.env` 中配置完整的 manifest 镜像 URL：

```dotenv
CLOUD_UPDATE_MANIFEST_MIRRORS=https://mirror.example.com/lmixture/JavdBviewed-release/main/manifests/cloud/stable.json
```

多个地址使用英文逗号分隔。每个地址都必须返回与官方 `stable.json` 完全兼容的 JSON。Cloud 会按顺序尝试这些地址，失败后自动回退到官方主源；它们只用于传输加速，不是新的更新通道或可信发布源。
