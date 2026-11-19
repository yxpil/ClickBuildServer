'use strict';

const N = require('./naming');

function slug(ir) {
  return N.kebab(ir.project.name || 'app');
}

function dockerfile(ir) {
  const p = ir.project;
  if (p.lang === 'rust') {
    return `# ${p.name} — 多阶段构建
FROM rust:1.82-bookworm AS build
WORKDIR /build
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \\
    && apt-get install -y --no-install-recommends ca-certificates curl \\
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/target/release/${N.snake(p.name)} /usr/local/bin/app
ENV PORT=${p.port}
EXPOSE ${p.port}
CMD ["app"]
`;
  }
  if (p.packageType === 'war') {
    return `# ${p.name} — WAR 部署到 Tomcat
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q -DskipTests package

FROM tomcat:10.1-jdk17-temurin
RUN rm -rf /usr/local/tomcat/webapps/*
COPY --from=build /build/target/*.war /usr/local/tomcat/webapps/ROOT.war
EXPOSE 8080
CMD ["catalina.sh", "run"]
`;
  }
  return `# ${p.name} — 可执行 JAR
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /build/target/*.jar app.jar
ENV PORT=${p.port}
EXPOSE ${p.port}
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "app.jar"]
`;
}

function appEnv(ir) {
  const p = ir.project;
  const env = {
    PORT: String(p.port),
    DB_HOST: p.database.cluster && p.database.cluster.enabled ? 'mysql-master' : 'mysql-master',
    DB_PORT: '3306',
    DB_NAME: p.database.name,
    DB_USER: 'root',
    DB_PASSWORD: p.database.password,
    JWT_SECRET: p.security.jwtSecret,
    TOKEN_TTL: String(p.security.ttlSeconds),
  };
  if (p.database.cluster && p.database.cluster.enabled) env.DB_READ_URL = `mysql://root:${p.database.password}@mysql-slave1:3306/${p.database.name}`;
  if (p.redis.enabled) {
    env.REDIS_MODE = p.redis.mode;
    env.REDIS_URL = p.redis.mode === 'cluster'
      ? 'redis://redis-1:6379,redis-2:6379,redis-3:6379'
      : `redis://redis:6379/${p.redis.db || 0}`;
  }
  env.STORAGE_PROVIDER = p.storage.provider;
  if (p.storage.provider === 'minio' || p.storage.provider === 's3') {
    env.STORAGE_ENDPOINT = p.storage.endpoint || 'http://minio:9000';
    env.STORAGE_BUCKET = p.storage.bucket;
    env.STORAGE_ACCESS_KEY = p.storage.accessKey;
    env.STORAGE_SECRET_KEY = p.storage.secretKey;
  }
  return env;
}

function dbServiceName(c) {
  return `mysql-${N.kebab(c.name).replace(/_/g, '-')}`;
}

/** 应用容器探活：Node / Go 用 wget 打 /api/health；Java 精简镜像未必带 wget，用 bash 探端口。 */
function appHealthCheck(port, lang) {
  const test = lang === 'java'
    ? `bash -c 'exec 3<>/dev/tcp/127.0.0.1/${port}'`
    : `wget -qO- http://127.0.0.1:${port}/api/health >/dev/null 2>&1 || exit 1`;
  return `    healthcheck:
      test: ["CMD-SHELL", ${JSON.stringify(test)}]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 25s`;
}

function mysqlBlock(ir) {
  const p = ir.project;
  const clusters = ir.clusters || [];
  return clusters.map((c, i) => {
    const name = dbServiceName(c);
    const hostPort = c.port || 3306 + i;
    return `
  ${name}:
    image: mysql:8.0
    command:
      - --server-id=${i + 1}
      - --server-id-bits=32${c.role === 'primary' ? '' : `
      - --relay-log=relay-bin
      - --read-only=ON`}${c.role === 'primary' ? `
      - --log-bin=mysql-bin
      - --binlog-format=ROW` : ''}
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --default-authentication-plugin=mysql_native_password
    environment:
      MYSQL_ROOT_PASSWORD: "${c.password || p.database.password}"
      MYSQL_DATABASE: "${c.database || p.database.name}"
      TZ: Asia/Shanghai
    ports: ["${hostPort}:3306"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-p${(c.password || p.database.password)}"]
      interval: 10s
      timeout: 5s
      retries: 5
    volumes:
      - ${name}-data:/var/lib/mysql${c.role === 'primary' ? '\n      - ./sql:/docker-entrypoint-initdb.d:ro' : ''}`;
  }).join('\n');
}

function compose(ir) {
  const p = ir.project;
  const s = slug(ir);
  const env = appEnv(ir);
  const envLines = Object.entries(env).map(([k, v]) => `      ${k}: "${String(v).replace(/"/g, '\\"')}"`).join('\n');
  const clusters = ir.clusters || [];
  const g = ir.gateway;

  const redisBlock = !p.redis.enabled ? '' : p.redis.mode === 'cluster' ? `
  redis-1:
    image: redis:7-alpine
    command: ["redis-server", "--cluster-enabled", "yes", "--cluster-config-file", "nodes.conf", "--appendonly", "yes"]
    ports: ["6379:6379"]
  redis-2:
    image: redis:7-alpine
    command: ["redis-server", "--cluster-enabled", "yes", "--cluster-config-file", "nodes.conf", "--appendonly", "yes"]
    ports: ["6380:6379"]
  redis-3:
    image: redis:7-alpine
    command: ["redis-server", "--cluster-enabled", "yes", "--cluster-config-file", "nodes.conf", "--appendonly", "yes"]
    ports: ["6381:6379"]
  redis-cluster-init:
    image: redis:7-alpine
    depends_on: [redis-1, redis-2, redis-3]
    entrypoint: ["sh", "-c", "sleep 3 && redis-cli --cluster create redis-1:6379 redis-2:6379 redis-3:6379 --cluster-replicas 0 --cluster-yes"]
` : `
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "512mb", "--maxmemory-policy", "allkeys-lru"]
    ports: ["6379:6379"]
    volumes: [redis-data:/data]
`;

  const minioBlock = p.storage.provider === 'minio' || p.storage.provider === 's3' ? `
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: "${p.storage.accessKey}"
      MINIO_ROOT_PASSWORD: "${p.storage.secretKey}"
    ports: ["9000:9000", "9001:9001"]
    volumes: [minio-data:/data]
  minio-init:
    image: minio/mc:latest
    depends_on: [minio]
    entrypoint: ["sh", "-c", "until mc alias set local http://minio:9000 ${p.storage.accessKey} ${p.storage.secretKey}; do sleep 2; done; mc mb -p local/${p.storage.bucket} || true"]
` : '';

  const msOn = !!(p.microservices && p.microservices.enabled);
  const gatewayBlock = g.enabled ? `
  gateway:
    image: ${g.image || 'onrouter:latest'}
    restart: unless-stopped
    ports: ["${g.port}:${g.port}"]
    volumes:
      - ./gateway/onrouter.yaml:/etc/onrouter/onrouter.yaml:ro
    depends_on:${msOn ? ir.services.map((s) => `\n      - ${s.id}`).join('') : '\n      - app'}
` : '';

  const volumes = [
    ...clusters.map((c) => `  ${dbServiceName(c)}-data:`),
    ...(p.redis.enabled && p.redis.mode !== 'cluster' ? ['  redis-data:'] : []),
    ...(minioBlock ? ['  minio-data:'] : []),
  ].join('\n');

  const appDependsOn = clusters.map((c) => `\n      - ${dbServiceName(c)}`).join('')
    + (p.redis.enabled ? (p.redis.mode === 'cluster' ? '\n      - redis-1\n      - redis-2\n      - redis-3' : '\n      - redis') : '')
    + (minioBlock ? '\n      - minio' : '');

  const svcBlocks = msOn ? ir.services.map((s) => `
  ${s.id}:
    build:
      context: ./services/${s.id}
    restart: unless-stopped
    ports: ["${s.port}:${s.port}"]
    environment:
      PORT: "${s.port}"
      DB_MODE: "cluster"
${appHealthCheck(s.port, p.lang)}
    depends_on:${appDependsOn}
`).join('') : '';

  const appBlock = msOn ? '' : `
  app:
    build: .
    restart: unless-stopped
    ports: ["${p.port}:${p.port}"]
    environment:
${envLines}
${appHealthCheck(p.port, p.lang)}
    depends_on:${appDependsOn}
`;

  return `name: ${s}

services:
${mysqlBlock(ir)}${redisBlock}${minioBlock}${gatewayBlock}${svcBlocks}${appBlock}
# 微服务模式：每个服务一个容器，网关按 gateway/onrouter.yaml 转发；
# 单应用模式：只有一个 app 容器。两种模式的基础设施一致。
volumes:
${volumes}
`;
}

function nginxConf(ir) {
  const p = ir.project;
  return `worker_processes auto;
events { worker_connections 1024; }

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    client_max_body_size 1024m;

    upstream app_upstream {
        server app:${p.port};
        keepalive 32;
    }

    server {
        listen 80;
        server_name _;

        location / {
            proxy_pass         http://app_upstream;
            proxy_http_version 1.1;
            proxy_set_header   Host $host;
            proxy_set_header   X-Real-IP $remote_addr;
            proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header   X-Forwarded-Proto $scheme;
            proxy_read_timeout 300s;
        }
    }
}
`;
}

function replicaScript(ir) {
  const p = ir.project;
  const replicas = (ir.clusters || []).filter((c) => c.role === 'replica');
  const primary = (ir.clusters || []).find((c) => c.role === 'primary') || { name: 'primary' };
  const masterSvc = dbServiceName(primary);
  const blocks = replicas.map((c) => `
echo "==> ${c.name} 指向 ${masterSvc}"
docker compose exec -T ${dbServiceName(c)} mysql -uroot -p"$MASTER_PWD" <<'SQL'
CHANGE MASTER TO
  MASTER_HOST='${masterSvc}',
  MASTER_USER='repl',
  MASTER_PASSWORD='repl123456',
  MASTER_AUTO_POSITION=1;
START SLAVE;
SHOW SLAVE STATUS\\G
SQL`).join('\n');
  return `#!/usr/bin/env bash
# 配置 MySQL 主从（所有容器起来之后执行）
set -e
MASTER_PWD="${(primary && primary.password) || p.database.password}"

echo "==> 在主库创建复制账号"
docker compose exec -T ${masterSvc} mysql -uroot -p"$MASTER_PWD" <<'SQL'
CREATE USER IF NOT EXISTS 'repl'@'%' IDENTIFIED WITH mysql_native_password BY 'repl123456';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';
FLUSH PRIVILEGES;
SQL
${blocks}

echo "完成。若 SHOW SLAVE STATUS 中 Slave_IO_Running / Slave_SQL_Running 均为 Yes 即成功。"
`;
}

function generateDocker(ir) {
  const p = ir.project;
  if (!p.integrations.docker) return [];
  const files = [
    { path: 'Dockerfile', content: dockerfile(ir) },
    { path: 'docker-compose.yml', content: compose(ir) },
  ];
  if (p.integrations.nginx) {
    files.push({ path: 'docker/nginx/nginx.conf', content: nginxConf(ir) });
  }
  if ((ir.clusters || []).some((c) => c.role === 'replica')) {
    files.push({ path: 'scripts/setup-replica.sh', content: replicaScript(ir) });
  }
  return files;
}

module.exports = { generateDocker, dockerfile, compose };
