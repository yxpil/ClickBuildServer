#!/usr/bin/env bash
# 作者：yxpil
# 组装 Linux x86_64 内置运行时：Node 25.2.1 + MariaDB 13.0.2 + Redis 8.10.3（musl 静态）+ RustFS 1.0.6。
# 只在 Linux / WSL 上运行；产物不提交到 git，打包前由 CI 或本机执行。
# 用法：bash tools/vendor-services-linux.sh [--force]
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
CACHE=${CACHE_DIR:-"$ROOT/.cache/services-linux"}
SERVICES="$ROOT/vendor/services-linux"
NODE_DIR="$ROOT/runtime/node-linux"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "缺少命令：$1。$2" >&2; exit 1; }
}
need curl "请先安装 curl。"
need tar "请先安装 tar。"
need sha256sum "请先安装 coreutils。"

fetch() {
  local name=$1 url=$2 sha=$3
  local file="$CACHE/$name"
  mkdir -p "$CACHE"
  if [ -f "$file" ] && echo "$sha  $file" | sha256sum -c - >/dev/null 2>&1; then
    echo "缓存命中：$name"
    return
  fi
  echo "下载：$url"
  rm -f "$file" "$file.part"
  curl -fL --retry 5 --retry-all-errors --connect-timeout 20 -o "$file.part" "$url"
  echo "$sha  $file.part" | sha256sum -c -
  mv "$file.part" "$file"
}

mkdir -p "$SERVICES/MariaDB/bin" "$SERVICES/MariaDB/lib" "$SERVICES/Redis" "$SERVICES/RustFS" "$NODE_DIR/bin"

# ---- Node ----
NODE_URL=https://nodejs.org/dist/v25.2.1/node-v25.2.1-linux-x64.tar.xz
NODE_SHA=b9f6a97e81c89a9df45526b4f86dafdccaf12b82295f7bf35bdb2b0f5e68744f
if [ "$FORCE" = 1 ] || [ ! -x "$NODE_DIR/bin/node" ]; then
  fetch node-v25.2.1-linux-x64.tar.xz "$NODE_URL" "$NODE_SHA"
  rm -f "$NODE_DIR/bin/node"
  tar -xJf "$CACHE/node-v25.2.1-linux-x64.tar.xz" -C "$NODE_DIR" --strip-components=1 node-v25.2.1-linux-x64/bin/node
  chmod 755 "$NODE_DIR/bin/node"
fi
echo "Node: $("$NODE_DIR/bin/node" --version)"

# ---- RustFS ----
RUSTFS_URL=https://dl.rustfs.com/artifacts/rustfs/release/rustfs-linux-x86_64-musl-v1.0.6.zip
RUSTFS_SHA=a4d109a09857c04bf5d11b2cec0fbbf0887819b9392e5d46d7d153dae6a1398f
if [ "$FORCE" = 1 ] || [ ! -x "$SERVICES/RustFS/rustfs" ]; then
  need unzip "请先安装 unzip。"
  fetch rustfs-linux-x86_64-musl-v1.0.6.zip "$RUSTFS_URL" "$RUSTFS_SHA"
  tmp=$(mktemp -d)
  unzip -q "$CACHE/rustfs-linux-x86_64-musl-v1.0.6.zip" -d "$tmp"
  install -m 755 "$tmp/rustfs" "$SERVICES/RustFS/rustfs"
  rm -rf "$tmp"
fi
echo "RustFS: $("$SERVICES/RustFS/rustfs" --version | head -1)"

# ---- MariaDB ----
MARIA_URL=https://mirror.mariadb.org/mariadb-13.0.2/bintar-linux-systemd-x86_64/mariadb-13.0.2-linux-systemd-x86_64.tar.gz
MARIA_SHA=e1b15581cfb2441fb7f3df2cc559998980406999e4c4a150ca303289f58b673c
if [ "$FORCE" = 1 ] || [ ! -x "$SERVICES/MariaDB/bin/mariadbd" ] || [ ! -x "$SERVICES/MariaDB/bin/mariadb-install-db" ] || [ ! -f "$SERVICES/MariaDB/share/mariadb_system_tables.sql" ]; then
  fetch mariadb-13.0.2-linux-systemd-x86_64.tar.gz "$MARIA_URL" "$MARIA_SHA"
  tmp=$(mktemp -d)
  tar -xzf "$CACHE/mariadb-13.0.2-linux-systemd-x86_64.tar.gz" -C "$tmp" --strip-components=1 \
    mariadb-13.0.2-linux-systemd-x86_64/bin/mariadbd \
    mariadb-13.0.2-linux-systemd-x86_64/bin/my_print_defaults \
    mariadb-13.0.2-linux-systemd-x86_64/bin/resolveip \
    mariadb-13.0.2-linux-systemd-x86_64/scripts/mariadb-install-db \
    mariadb-13.0.2-linux-systemd-x86_64/share \
    mariadb-13.0.2-linux-systemd-x86_64/lib
  rm -rf "$SERVICES/MariaDB/share" "$SERVICES/MariaDB/lib"
  cp -a "$tmp/share" "$SERVICES/MariaDB/share"
  mkdir -p "$SERVICES/MariaDB/lib"
  # -L 必须加：上游 lib 里是符号链接，WSL 在 /mnt/c 上生成的 reparse point
  # 在 Windows 侧 lstat 会报 EACCES，electron-builder 直接打包失败。
  cp -aL "$tmp/lib/libmariadb.so"* "$tmp/lib/libmysqlclient.so"* "$SERVICES/MariaDB/lib/" 2>/dev/null || true
  cp "$tmp/bin/my_print_defaults" "$SERVICES/MariaDB/bin/my_print_defaults"
  cp "$tmp/bin/resolveip" "$SERVICES/MariaDB/bin/resolveip"
  cp "$tmp/scripts/mariadb-install-db" "$SERVICES/MariaDB/bin/mariadb-install-db"
  # 官方 bintar 的 mariadbd 未 strip，472MB；strip 后约 35MB。
  if command -v strip >/dev/null 2>&1; then
    strip -o "$SERVICES/MariaDB/bin/mariadbd" "$tmp/bin/mariadbd"
  else
    cp "$tmp/bin/mariadbd" "$SERVICES/MariaDB/bin/mariadbd"
    echo "警告：没有 strip，mariadbd 会保持 472MB。" >&2
  fi
  strip "$SERVICES/MariaDB/bin/my_print_defaults" "$SERVICES/MariaDB/bin/resolveip" 2>/dev/null || true
  chmod 755 "$SERVICES/MariaDB/bin/"*
  rm -rf "$tmp"
fi
echo "MariaDB: $("$SERVICES/MariaDB/bin/mariadbd" --version)"

# ---- Redis（musl 静态编译）----
REDIS_URL=https://download.redis.io/releases/redis-8.10.3.tar.gz
REDIS_SHA=edde778f6bdee7581e42fc139ca9e07e2822212092f7501f99989656e3629d02
if [ "$FORCE" = 1 ] || [ ! -x "$SERVICES/Redis/redis-server" ]; then
  need make "请先安装 build-essential。"
  need musl-gcc "请先安装 musl-tools。"
  fetch redis-8.10.3.tar.gz "$REDIS_URL" "$REDIS_SHA"
  tmp=$(mktemp -d)
  tar -xzf "$CACHE/redis-8.10.3.tar.gz" -C "$tmp" --strip-components=1
  ( cd "$tmp" && make -j"$(nproc)" MALLOC=libc CC="musl-gcc -static" LDFLAGS="-static" redis-server )
  install -m 755 "$tmp/src/redis-server" "$SERVICES/Redis/redis-server"
  rm -rf "$tmp"
fi
echo "Redis: $("$SERVICES/Redis/redis-server" --version)"

TOTAL=$(du -sb "$SERVICES" "$NODE_DIR" | awk '{s+=$1} END {print s+0}')
cat > "$SERVICES/manifest.json" <<EOF
{
  "platform": "linux-x64",
  "node": "25.2.1",
  "mariadb": "13.0.2",
  "redis": "8.10.3",
  "rustfs": "1.0.6",
  "totalSize": $TOTAL
}
EOF

echo "完成：$SERVICES 与 $NODE_DIR（$(numfmt --to=iec-i --suffix=B "$TOTAL" 2>/dev/null || echo "$TOTAL bytes")）"
echo "下一步：bash tools/linux-smoke.sh 或 npm run dist:linux"
