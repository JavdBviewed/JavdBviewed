#!/usr/bin/env bash
set -euo pipefail

# 仅用于本机隔离验收；不要把生产配置或真实媒体目录挂到测试容器。
name=javdb-jf-124-test
port=38496
user=jf-test
password=$(openssl rand -hex 20)

if docker container inspect "$name" >/dev/null 2>&1; then
  printf '%s already exists. Stop/remove it explicitly before creating a new test instance.\n' "$name" >&2
  exit 1
fi

root=$(mktemp -d /tmp/javdb-jf-124-XXXXXX)
chmod 700 "$root"
mkdir -p "$root/config" "$root/cache" "$root/media"
printf '%s\n' "$password" > "$root/.test-password"
chmod 600 "$root/.test-password"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i 'color=c=black:s=320x180:r=1:d=3' \
  -f lavfi -i 'sine=frequency=440:duration=3' \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$root/media/ABC-123.mkv"

docker run -d --name "$name" --restart no \
  -p "127.0.0.1:$port:8096" \
  -v "$root/config:/config" -v "$root/cache:/cache" -v "$root/media:/media:ro" \
  jellyfin/jellyfin:12.4 >/dev/null

base="http://127.0.0.1:$port"
ready=false
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$base/Startup/User" || true)" = 200 ]; then
    ready=true
    break
  fi
  sleep 2
done
if [ "$ready" != true ]; then
  printf 'Jellyfin startup timed out; inspect docker logs %s\n' "$name" >&2
  exit 1
fi

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d "{\"Name\":\"$user\",\"Password\":\"$password\"}" "$base/Startup/User")
if [ "$status" != 204 ]; then
  printf 'Startup/User failed: HTTP %s\n' "$status" >&2
  exit 1
fi
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/Startup/Complete")
if [ "$status" != 204 ]; then
  printf 'Startup/Complete failed: HTTP %s\n' "$status" >&2
  exit 1
fi

token=$(curl -fsS -X POST -H 'Content-Type: application/json' \
  -H 'Authorization: MediaBrowser Client="JavdBviewed", Device="ChromeExtension", DeviceId="JavdBviewed", Version="2.1.3"' \
  -d "{\"Username\":\"$user\",\"Pw\":\"$password\"}" \
  "$base/Users/AuthenticateByName" | jq -r '.AccessToken // empty')
if [ -z "$token" ]; then
  printf 'Test account login failed\n' >&2
  exit 1
fi
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Authorization: MediaBrowser Token=\"$token\"" -H 'Content-Type: application/json' \
  -d '{"LibraryOptions":{"PathInfos":[{"Path":"/media"}]}}' \
  "$base/Library/VirtualFolders?name=QA124&collectionType=movies&refreshLibrary=true")
if [ "$status" != 204 ]; then
  printf 'Creating the test library failed: HTTP %s\n' "$status" >&2
  exit 1
fi

# 新建库时的后台扫描可能早于媒体目录挂载可见，显式刷新后再等待索引。
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Authorization: MediaBrowser Token=\"$token\"" "$base/Library/Refresh")
if [ "$status" != 204 ]; then
  printf 'Refreshing the test library failed: HTTP %s\n' "$status" >&2
  exit 1
fi

indexed=false
for _ in $(seq 1 90); do
  item_count=$(curl -fsS --max-time 5 -H "Authorization: MediaBrowser Token=\"$token\"" \
    "$base/Items?Recursive=true&IncludeItemTypes=Movie&SearchTerm=ABC-123" \
    | jq -r '.TotalRecordCount // 0' || true)
  if [ "${item_count:-0}" -gt 0 ]; then
    indexed=true
    break
  fi
  sleep 2
done
if [ "$indexed" != true ]; then
  printf 'Synthetic movie was not indexed; inspect docker logs %s\n' "$name" >&2
  exit 1
fi

printf 'Jellyfin 12.4 test server: %s (container %s, data %s)\n' "$base" "$name" "$root"
printf 'Run: JELLYFIN_TEST_PASSWORD_FILE=%s/.test-password pnpm exec tsx scripts/jellyfin124Acceptance.ts\n' "$root"
