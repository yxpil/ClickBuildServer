#!/bin/sh
# 作者：yxpil
# Linux 内置服务冒烟测试：在 WSL / 任意 x86_64 Linux 上直接拉起 MariaDB、Redis、RustFS，
# 验证端口监听和停止，不依赖 Electron。用法：bash tools/linux-smoke.sh
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SVC="$ROOT/vendor/services-linux"
NODE="$ROOT/runtime/node-linux/bin/node"
TMP=$(mktemp -d /tmp/clickbuild-smoke.XXXXXX)
PIDS=""

cleanup() {
  for pid in $PIDS; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

wait_port() {
  port=$1
  i=0
  while [ "$i" -lt 60 ]; do
    if "$NODE" -e "const n=require('net');const s=n.connect($port,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    i=$((i + 1))
    sleep 0.5
  done
  return 1
}

echo "== MariaDB =="
mkdir -p "$TMP/mariadb"
"$SVC/MariaDB/bin/mariadb-install-db" --datadir "$TMP/mariadb" --basedir "$SVC/MariaDB" --auth-root-authentication-method=normal >"$TMP/install.log" 2>&1 || {
  tail -30 "$TMP/install.log"; exit 1;
}
[ -d "$TMP/mariadb/mysql" ] || { tail -30 "$TMP/install.log"; echo "系统表未生成"; exit 1; }
rm -f "$TMP/mariadb/my.cnf" "$TMP/mariadb/my.ini"
MYSQL_USER=""
[ "$(id -u)" = 0 ] && MYSQL_USER="--user=root"
LD_LIBRARY_PATH="$SVC/MariaDB/lib" "$SVC/MariaDB/bin/mariadbd" \
  --no-defaults --datadir "$TMP/mariadb" --port 13306 --bind-address=127.0.0.1 \
  --skip-grant-tables --skip-name-resolve --innodb-buffer-pool-size=64M \
  --lc-messages-dir "$SVC/MariaDB/share" $MYSQL_USER >"$TMP/mariadb.log" 2>&1 &
MDB=$!
PIDS="$PIDS $MDB"
if ! wait_port 13306; then tail -40 "$TMP/mariadb.log"; exit 1; fi
echo "MariaDB 监听 13306"
kill "$MDB" 2>/dev/null || true
wait "$MDB" 2>/dev/null || true

echo "== Redis =="
"$SVC/Redis/redis-server" --port 16379 --dir "$TMP" --daemonize no >"$TMP/redis.log" 2>&1 &
REDIS=$!
PIDS="$PIDS $REDIS"
if ! wait_port 16379; then tail -20 "$TMP/redis.log"; exit 1; fi
echo "Redis 监听 16379"
kill "$REDIS" 2>/dev/null || true
wait "$REDIS" 2>/dev/null || true

echo "== RustFS =="
mkdir -p "$TMP/rustfs"
RUSTFS_ACCESS_KEY=clickbuild RUSTFS_SECRET_KEY=clickbuild123 \
  "$SVC/RustFS/rustfs" server --address 127.0.0.1:19000 --console-enable \
  --console-address 127.0.0.1:19001 "$TMP/rustfs" >"$TMP/rustfs.log" 2>&1 &
S3=$!
PIDS="$PIDS $S3"
if ! wait_port 19000; then tail -40 "$TMP/rustfs.log"; exit 1; fi
echo "RustFS 监听 19000 / 控制台 19001"
kill "$S3" 2>/dev/null || true
wait "$S3" 2>/dev/null || true

echo "全部通过"
