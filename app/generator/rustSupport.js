'use strict';
/** Rust 工程：配置、数据库、错误、ID、认证、RBAC、缓存、搜索、存储、文件数据源、启动自举 */

const jstr = (s) => JSON.stringify(String(s == null ? '' : s));
const rsStr = (s) => JSON.stringify(String(s == null ? '' : s));

function cargo(ir) {
  const p = ir.project;
  const lines = [
    '[package]',
    `name = "${p.artifact.replace(/-/g, '_')}"`,
    `version = "${p.version}"`,
    'edition = "2021"',
    '',
    '[dependencies]',
    'axum = "0.7"',
    'tokio = { version = "1", features = ["full"] }',
    'serde = { version = "1", features = ["derive"] }',
    'serde_json = "1"',
    'sqlx = { version = "0.8", features = ["runtime-tokio", "mysql", "chrono", "macros"] }',
    'chrono = { version = "0.4", features = ["serde"] }',
    'jsonwebtoken = "9"',
    'uuid = { version = "1", features = ["v4"] }',
    'tower-http = { version = "0.5", features = ["cors", "trace"] }',
    'tracing = "0.1"',
    'tracing-subscriber = { version = "0.3", features = ["env-filter"] }',
    'anyhow = "1"',
    'thiserror = "1"',
    'bcrypt = "0.15"',
    'csv = "1.3"',
    'calamine = "0.26"',
    // calamine 0.26 与 zip 2.6 的 API 不兼容，锁到 2.2.x
    'zip = { version = "=2.2.2", default-features = false, features = ["deflate"] }',
    'sha2 = "0.10"',
    'hmac = "0.12"',
    'hex = "0.4"',
  ];
  lines.push(`redis = { version = "0.27", features = ["tokio-comp", "connection-manager"${p.redis.mode === 'cluster' ? ', "cluster"' : ''}] }`);
  lines.push('');
  lines.push('[profile.release]');
  lines.push('lto = true');
  lines.push('codegen-units = 1');
  return lines.join('\n') + '\n';
}

function configRs(ir) {
  const p = ir.project;
  const pkg = p.artifact.replace(/-/g, '_');
  return `use std::env;

#[derive(Clone, Debug)]
pub struct StorageCfg {
    pub provider: String,
    pub endpoint: String,
    pub bucket: String,
    pub access_key: String,
    pub secret_key: String,
    pub local_dir: String,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub read_database_url: Option<String>,
    pub pool_max: u32,
    pub redis_url: Option<String>,
    pub redis_mode: String,
    pub jwt_secret: String,
    pub ttl_seconds: i64,
    pub cookie_name: String,
    pub id_strategy: String,
    pub key_prefix: String,
    pub search_engine: String,
    pub init_admin: String,
    pub init_password: String,
    pub storage: StorageCfg,
}

impl Config {
    pub fn from_env() -> Self {
        let host = env_or("DB_HOST", "${p.database.host}");
        let port = env_or("DB_PORT", "${p.database.port}");
        let name = env_or("DB_NAME", "${p.database.name}");
        let user = env_or("DB_USER", "${p.database.user}");
        let pass = env_or("DB_PASSWORD", "${p.database.password}");
        let database_url = env_or("DATABASE_URL", &format!(
            "mysql://{}:{}@{}:{}/{}",
            user, pass, host, port, name
        ));
        let read_database_url = env::var("DB_READ_URL").ok();
        Config {
            port: env_or("PORT", "${p.port}").parse().unwrap_or(${p.port}),
            database_url,
            read_database_url,
            pool_max: env_or("DB_POOL_MAX", "${p.database.pool.max}").parse().unwrap_or(${p.database.pool.max}),
            redis_url: ${p.redis.enabled ? `env::var("REDIS_URL").ok().or(Some("redis://${p.redis.nodes[0] || '127.0.0.1:6379'}/".to_string()))` : 'None'},
            redis_mode: env_or("REDIS_MODE", "${p.redis.mode}"),
            jwt_secret: env_or("JWT_SECRET", "${p.security.jwtSecret}"),
            ttl_seconds: env_or("TOKEN_TTL", "${p.security.ttlSeconds}").parse().unwrap_or(${p.security.ttlSeconds}),
            cookie_name: env_or("COOKIE_NAME", "${p.security.cookieName}"),
            id_strategy: env_or("ID_STRATEGY", "${p.idStrategy}"),
            key_prefix: env_or("KEY_PREFIX", "${p.redis.keyPrefix}"),
            search_engine: env_or("SEARCH_ENGINE", "${p.search.engine}"),
            init_admin: env_or("INIT_ADMIN", "${p.security.initAdmin}"),
            init_password: env_or("INIT_PASSWORD", "${p.security.initPassword}"),
            storage: StorageCfg {
                provider: env_or("STORAGE_PROVIDER", "${p.storage.provider}"),
                endpoint: env_or("STORAGE_ENDPOINT", "${p.storage.endpoint}"),
                bucket: env_or("STORAGE_BUCKET", "${p.storage.bucket}"),
                access_key: env_or("STORAGE_ACCESS_KEY", "${p.storage.accessKey}"),
                secret_key: env_or("STORAGE_SECRET_KEY", "${p.storage.secretKey}"),
                local_dir: env_or("STORAGE_LOCAL_DIR", "${p.storage.localDir}"),
            },
        }
    }
}

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}
`;
}

function dbRs(ir) {
  return `use crate::config::Config;
use crate::error::AppError;
use sqlx::mysql::{MySqlPool, MySqlPoolOptions};

/// 读写分离：写走 write pool，读走 read pool（集群从库）。
#[derive(Clone)]
pub struct Db {
    pub write: MySqlPool,
    pub read: MySqlPool,
}

impl Db {
    pub async fn connect(cfg: &Config) -> Result<Self, AppError> {
        let write = MySqlPoolOptions::new()
            .max_connections(cfg.pool_max)
            .connect(&cfg.database_url)
            .await?;
        let read = match &cfg.read_database_url {
            Some(url) if !url.is_empty() => {
                MySqlPoolOptions::new().max_connections(cfg.pool_max).connect(url).await?
            }
            _ => write.clone(),
        };
        Ok(Self { write, read })
    }
}
`;
}

function errorRs(ir) {
  return `use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

#[derive(Debug)]
pub enum AppError {
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    Internal(String),
    Sqlx(sqlx::Error),
    Redis(String),
}

#[derive(Serialize)]
struct ErrBody {
    code: i32,
    message: String,
    data: Option<()>,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, 400, m),
            AppError::Unauthorized(m) => (StatusCode::UNAUTHORIZED, 401, m),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, 403, m),
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, 404, m),
            AppError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, 500, m),
            AppError::Sqlx(e) => {
                tracing::error!("sqlx error: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, 500, "数据库错误".to_string())
            }
            AppError::Redis(e) => {
                tracing::error!("redis error: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, 500, "缓存服务错误".to_string())
            }
        };
        (status, Json(ErrBody { code, message, data: None })).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self { AppError::Sqlx(e) }
}

impl From<redis::RedisError> for AppError {
    fn from(e: redis::RedisError) -> Self { AppError::Redis(e.to_string()) }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self { AppError::Internal(e.to_string()) }
}

#[derive(Serialize)]
pub struct ApiResult<T> {
    pub code: i32,
    pub message: String,
    pub data: Option<T>,
}

impl<T> ApiResult<T> {
    pub fn ok(data: T) -> Self {
        Self { code: 0, message: "ok".into(), data: Some(data) }
    }
}

#[derive(Serialize)]
pub struct Page<T> {
    pub page: i64,
    pub size: i64,
    pub total: i64,
    pub records: Vec<T>,
}
`;
}

function idRs(ir) {
  const p = ir.project;
  if (p.idStrategy === 'ulid' || p.idStrategy === 'uuid') {
    return `use uuid::Uuid;

pub fn next_id() -> String {
    Uuid::new_v4().to_string().replace('-', "")
}
`;
  }
  return `use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

struct State {
    last_ts: u64,
    seq: u64,
}

static STATE: Mutex<State> = Mutex::new(State { last_ts: 0, seq: 0 });
const EPOCH: u64 = 1704067200000;
const WORKER: u64 = ${Number(p.port) % 1024};

pub fn next_id() -> i64 {
    let mut st = STATE.lock().unwrap();
    let mut ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
    if ts <= st.last_ts {
        st.seq += 1;
        if st.seq >= 4096 {
            while ts <= st.last_ts {
                ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
            }
            st.seq = 0;
        }
        ts = st.last_ts;
    } else {
        st.seq = 0;
    }
    st.last_ts = ts;
    (((ts - EPOCH) << 22) | (WORKER << 12) | st.seq) as i64
}
`;
}

function authRs(ir) {
  const p = ir.project;
  return `use axum::http::HeaderMap;
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::cache::Cache;
use crate::config::Config;
use crate::error::AppError;
use crate::rbac;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub username: String,
    pub tid: String,
    pub exp: usize,
}

#[derive(Debug, Clone)]
pub struct LoginUser {
    pub user_id: i64,
    pub username: String,
    pub token_id: String,
    pub perms: Vec<String>,
}

pub fn create_token(cfg: &Config, user_id: i64, username: &str, tid: &str) -> String {
    let claims = Claims {
        sub: user_id.to_string(),
        username: username.to_string(),
        tid: tid.to_string(),
        exp: (Utc::now().timestamp() + cfg.ttl_seconds) as usize,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(cfg.jwt_secret.as_bytes()),
    )
    .unwrap_or_default()
}

pub fn parse_token(cfg: &Config, token: &str) -> Result<Claims, AppError> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(cfg.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| AppError::Unauthorized("令牌无效或已过期".into()))?;
    Ok(data.claims)
}

pub fn token_from_headers(headers: &HeaderMap) -> Option<String> {
    if let Some(v) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
        if let Some(t) = v.strip_prefix("Bearer ") {
            return Some(t.to_string());
        }
    }
    if let Some(v) = headers.get("x-token").and_then(|v| v.to_str().ok()) {
        if !v.is_empty() {
            return Some(v.to_string());
        }
    }
    if let Some(v) = headers.get("cookie").and_then(|v| v.to_str().ok()) {
        for part in v.split(';') {
            let kv = part.trim();
            if let Some((k, val)) = kv.split_once('=') {
                if k == "CB_TOKEN" || k == "cb_token" {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

pub struct AuthState {
    pub cache: Option<Cache>,
}

pub async fn current(
    cfg: &Config,
    db: &crate::db::Db,
    cache: &Option<Cache>,
    headers: &HeaderMap,
) -> Result<LoginUser, AppError> {
    let token = token_from_headers(headers).ok_or_else(|| AppError::Unauthorized("未登录".into()))?;
    let claims = parse_token(cfg, &token)?;
    let user_id: i64 = claims.sub.parse().map_err(|_| AppError::Unauthorized("令牌主体非法".into()))?;
    let perms = rbac::perms(cfg, db, cache, user_id).await;
    Ok(LoginUser {
        user_id,
        username: claims.username,
        token_id: claims.tid,
        perms,
    })
}

pub fn ensure(user: &LoginUser, code: &str) -> Result<(), AppError> {
    if user.perms.iter().any(|p| p == "*" || p == code) {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!("无权限：{}", code)))
    }
}
`;
}

function rbacRs(ir) {
  const p = ir.project;
  return `use crate::cache::Cache;
use crate::config::Config;
use crate::db::Db;
use crate::error::AppError;

/// 用户权限集合：super_admin 返回 *，其余走 sys_role_permission 并缓存。
pub async fn perms(cfg: &Config, db: &Db, cache: &Option<Cache>, user_id: i64) -> Vec<String> {
    let key = format!("{}:perm:{}", cfg.key_prefix, user_id);
    if let Some(c) = cache {
        if let Some(v) = c.get(&key).await {
            if !v.is_empty() {
                return v.split(',').map(|s| s.to_string()).collect();
            }
        }
    }
    let roles: Vec<String> = sqlx::query_scalar(
        "SELECT r.role_code FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id \\
         WHERE ur.user_id = ? AND ur.deleted = 0 AND r.deleted = 0",
    )
    .bind(user_id)
    .fetch_all(&db.read)
    .await
    .unwrap_or_default();
    if roles.iter().any(|r| r == "super_admin") {
        return vec!["*".to_string()];
    }
    let codes: Vec<String> = sqlx::query_scalar(
        "SELECT rp.perm_code FROM sys_user_role ur JOIN sys_role_permission rp ON rp.role_id = ur.role_id \\
         WHERE ur.user_id = ? AND ur.deleted = 0 AND rp.deleted = 0",
    )
    .bind(user_id)
    .fetch_all(&db.read)
    .await
    .unwrap_or_default();
    if let Some(c) = cache {
        if !codes.is_empty() {
            let _ = c.set(&key, &codes.join(","), 600).await;
        }
    }
    codes
}

pub fn ok() -> Result<(), AppError> { Ok(()) }
`;
}

function cacheRs(ir) {
  const p = ir.project;
  const cluster = p.redis.mode === 'cluster';
  return `use std::sync::Arc;
use std::time::Duration;

use crate::config::Config;

#[derive(Clone)]
pub enum Cache {
    Single(redis::aio::ConnectionManager)${cluster ? ',\n    Cluster(Arc<redis::cluster::ClusterClient>)' : ''},
}

impl Cache {
    pub async fn connect(cfg: &Config) -> Option<Cache> {
        let url = cfg.redis_url.clone()?;
        if cfg.redis_mode == "cluster" {
${cluster ? `            let nodes: Vec<String> = url
                .trim_start_matches("redis://")
                .split(',')
                .map(|s| s.trim_end_matches('/').to_string())
                .collect();
            match redis::cluster::ClusterClient::new(nodes) {
                Ok(client) => Some(Cache::Cluster(Arc::new(client))),
                Err(e) => {
                    tracing::warn!("redis cluster connect failed: {}", e);
                    None
                }
            }` : `            tracing::warn!("build generated without cluster support, fallback to single node");
            let client = redis::Client::open(url).ok()?;
            redis::aio::ConnectionManager::new(client).await.ok().map(Cache::Single)`}
        } else {
            let client = redis::Client::open(url).ok()?;
            match redis::aio::ConnectionManager::new(client).await {
                Ok(m) => Some(Cache::Single(m)),
                Err(e) => {
                    tracing::warn!("redis connect failed: {}", e);
                    None
                }
            }
        }
    }

    pub async fn get(&self, key: &str) -> Option<String> {
        match self {
            Cache::Single(m) => {
                let mut conn = m.clone();
                redis::cmd("GET").arg(key).query_async::<Option<String>>(&mut conn).await.ok().flatten()
            }
${cluster ? `            Cache::Cluster(c) => {
                let c = c.clone();
                let k = key.to_string();
                tokio::task::spawn_blocking(move || {
                    let mut conn = c.get_connection().ok()?;
                    redis::cmd("GET").arg(k).query::<Option<String>>(&mut conn).ok().flatten()
                })
                .await
                .ok()
                .flatten()
            }` : ''}${cluster ? '' : '            _ => None,'}
        }
    }

    pub async fn set(&self, key: &str, value: &str, ttl_seconds: i64) -> Option<()> {
        match self {
            Cache::Single(m) => {
                let mut conn = m.clone();
                redis::cmd("SET")
                    .arg(key)
                    .arg(value)
                    .arg("EX")
                    .arg(ttl_seconds)
                    .query_async::<()>(&mut conn)
                    .await
                    .ok()
            }
${cluster ? `            Cache::Cluster(c) => {
                let c = c.clone();
                let k = key.to_string();
                let v = value.to_string();
                tokio::task::spawn_blocking(move || {
                    let mut conn = c.get_connection().ok()?;
                    redis::cmd("SET").arg(k).arg(v).arg("EX").arg(ttl_seconds).query::<()>(&mut conn).ok()
                })
                .await
                .ok()
                .flatten()
            }` : ''}${cluster ? '' : '            _ => None,'}
        }
    }

    pub async fn del(&self, key: &str) -> Option<()> {
        match self {
            Cache::Single(m) => {
                let mut conn = m.clone();
                redis::cmd("DEL").arg(key).query_async::<()>(&mut conn).await.ok()
            }
${cluster ? `            Cache::Cluster(c) => {
                let c = c.clone();
                let k = key.to_string();
                tokio::task::spawn_blocking(move || {
                    let mut conn = c.get_connection().ok()?;
                    redis::cmd("DEL").arg(k).query::<()>(&mut conn).ok()
                })
                .await
                .ok()
                .flatten()
            }` : ''}${cluster ? '' : '            _ => None,'}
        }
    }

    /// 通用命令执行（搜索用到 SADD / SINTER / HSET / HGET）。
    pub async fn cmd(&self, parts: Vec<String>) -> Option<redis::Value> {
        if parts.is_empty() {
            return None;
        }
        match self {
            Cache::Single(m) => {
                let mut conn = m.clone();
                let mut cmd = redis::cmd(&parts[0]);
                for p in &parts[1..] {
                    cmd.arg(p);
                }
                cmd.query_async::<redis::Value>(&mut conn).await.ok()
            }
${cluster ? `            Cache::Cluster(c) => {
                let c = c.clone();
                tokio::task::spawn_blocking(move || {
                    let mut conn = c.get_connection().ok()?;
                    let mut cmd = redis::cmd(&parts[0]);
                    for p in &parts[1..] {
                        cmd.arg(p);
                    }
                    cmd.query::<redis::Value>(&mut conn).ok()
                })
                .await
                .ok()
                .flatten()
            }` : ''}${cluster ? '' : '            _ => None,'}
        }
    }

    pub fn ttl(_seconds: i64) -> Duration { Duration::from_secs(_seconds.max(1) as u64) }
}
`;
}

function searchRs(ir) {
  const p = ir.project;
  return `use redis::FromRedisValue;

use crate::cache::Cache;
use crate::config::Config;

fn tokenize(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let lower = text.to_lowercase();
    for word in lower.split(|c: char| !c.is_alphanumeric() && !(c as u32 >= 0x4e00 && (c as u32) <= 0x9fff)) {
        if word.is_empty() {
            continue;
        }
        out.push(word.to_string());
        if word.chars().count() > 2 && word.chars().all(|c| (c as u32) >= 0x4e00) {
            let chars: Vec<char> = word.chars().collect();
            for i in 0..chars.len().saturating_sub(1) {
                out.push(format!("{}{}", chars[i], chars[i + 1]));
            }
        }
    }
    out
}

fn tok(cfg: &Config, table: &str, token: &str) -> String {
    format!("{}:idx:{}:tok:{}", cfg.key_prefix, table, token)
}
fn doc(cfg: &Config, table: &str) -> String {
    format!("{}:idx:{}:doc", cfg.key_prefix, table)
}

pub async fn index(cfg: &Config, cache: &Cache, table: &str, id: &str, text: &str) {
    let _ = cache.cmd(vec!["HSET".into(), doc(cfg, table), id.into(), text.into()]).await;
    for t in tokenize(text) {
        let _ = cache.cmd(vec!["SADD".into(), tok(cfg, table, &t), id.into()]).await;
    }
}

pub async fn remove(cfg: &Config, cache: &Cache, table: &str, id: &str) {
    let _ = cache.cmd(vec!["HDEL".into(), doc(cfg, table), id.into()]).await;
}

pub async fn search(cfg: &Config, cache: &Cache, table: &str, keyword: &str, limit: i64) -> Vec<(String, String)> {
    let tokens = tokenize(keyword);
    if tokens.is_empty() {
        return Vec::new();
    }
    let keys: Vec<String> = tokens.iter().map(|t| tok(cfg, table, t)).collect();
    let mut cmd_parts: Vec<String> = vec!["SINTER".into()];
    cmd_parts.extend(keys);
    let value = cache.cmd(cmd_parts).await;
    let ids: Vec<String> = value
        .and_then(|v| Vec::<String>::from_redis_value(&v).ok())
        .unwrap_or_default();
    let mut out = Vec::new();
    for id in ids.into_iter().take(limit as usize) {
        let text: Option<String> = cache
            .cmd(vec!["HGET".into(), doc(cfg, table), id.clone()])
            .await
            .and_then(|v| Option::<String>::from_redis_value(&v).ok())
            .flatten();
        out.push((id, text.unwrap_or_default()));
    }
    out
}
`;
}

function storageRs(ir) {
  const p = ir.project;
  return `use std::path::PathBuf;

use chrono::Utc;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::config::{Config, StorageCfg};

type HmacSha256 = Hmac<Sha256>;

fn hex_hash(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    hex::encode(h.finalize())
}

fn signing_key(secret: &str, date: &str, region: &str, service: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(format!("AWS4{}", secret).as_bytes()).unwrap();
    mac.update(date.as_bytes());
    let k_date = mac.finalize().into_bytes();
    let mut mac = HmacSha256::new_from_slice(&k_date).unwrap();
    mac.update(region.as_bytes());
    let k_region = mac.finalize().into_bytes();
    let mut mac = HmacSha256::new_from_slice(&k_region).unwrap();
    mac.update(service.as_bytes());
    let k_service = mac.finalize().into_bytes();
    let mut mac = HmacSha256::new_from_slice(&k_service).unwrap();
    mac.update(b"aws4_request");
    mac.finalize().into_bytes()
}

/// S3 / MinIO 预签名 URL（SigV4，path-style）。
pub fn presign(cfg: &Config, key: &str, method: &str, expires: i64) -> String {
    let s: &StorageCfg = &cfg.storage;
    if s.provider == "local" {
        return format!("/storage/local-get/{}", key);
    }
    let endpoint = s.endpoint.trim_end_matches('/');
    let host = endpoint.split("://").nth(1).unwrap_or(endpoint);
    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = now.format("%Y%m%d").to_string();
    let scope = format!("{}/us-east-1/s3/aws4_request", date);
    let path = format!("/{}/{}", s.bucket, key);
    let query = format!(
        "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={}%2F{}&X-Amz-Date={}&X-Amz-Expires={}&X-Amz-SignedHeaders=host",
        url_encode(&s.access_key),
        scope.replace('/', "%2F"),
        amz_date,
        expires
    );
    let canonical = format!(
        "{}\\n{}\\n{}\\nhost:{}\\n\\nhost\\nUNSIGNED-PAYLOAD",
        method, path, query, host
    );
    let string_to_sign = format!("AWS4-HMAC-SHA256\\n{}\\n{}\\n{}", amz_date, scope, hex_hash(canonical.as_bytes()));
    let key_bytes = signing_key(&s.secret_key, &date, "us-east-1", "s3");
    let mut mac = HmacSha256::new_from_slice(&key_bytes).unwrap();
    mac.update(string_to_sign.as_bytes());
    let signature = hex::encode(mac.finalize().into_bytes());
    format!("{}{}?{}&X-Amz-Signature={}", endpoint, path, query, signature)
}

fn url_encode(input: &str) -> String {
    input
        .replace('%', "%25")
        .replace('/', "%2F")
        .replace(':', "%3A")
}

pub fn local_path(cfg: &Config, key: &str) -> PathBuf {
    PathBuf::from(&cfg.storage.local_dir).join(key)
}
`;
}

function filesourceRs(ir) {
  return `use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use calamine::{open_workbook_auto, Data, Reader};
use serde_json::{json, Value};

/// 把 CSV / JSON / Excel 当数据库：加载进内存，按行 CRUD，写回原文件。
pub struct FileStore {
    pub table: String,
    pub engine: String,
    pub path: PathBuf,
    pub columns: Vec<String>,
    pub rows: RwLock<HashMap<String, Value>>,
}

impl FileStore {
    pub fn new(table: &str, engine: &str, path: &str, columns: Vec<String>) -> Self {
        let store = Self {
            table: table.to_string(),
            engine: engine.to_string(),
            path: PathBuf::from(path),
            columns,
            rows: RwLock::new(HashMap::new()),
        };
        store.load();
        store
    }

    pub fn load(&self) {
        let mut map = HashMap::new();
        match self.engine.as_str() {
            "csv" => {
                if let Ok(mut rdr) = csv::Reader::from_path(&self.path) {
                    if let Ok(headers) = rdr.headers() {
                        let cols: Vec<String> = headers.iter().map(|s| s.to_string()).collect();
                        for record in rdr.records().flatten() {
                            let mut row = serde_json::Map::new();
                            for (i, col) in cols.iter().enumerate() {
                                if let Some(v) = record.get(i) {
                                    row.insert(col.clone(), Value::String(v.to_string()));
                                }
                            }
                            let id = row.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            if !id.is_empty() {
                                map.insert(id, Value::Object(row));
                            }
                        }
                    }
                }
            }
            "json" => {
                if let Ok(text) = fs::read_to_string(&self.path) {
                    if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&text) {
                        for item in items {
                            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                                map.insert(id.to_string(), item);
                            }
                        }
                    }
                }
            }
            "excel" => {
                if let Ok(mut wb) = open_workbook_auto(&self.path) {
                    if let Some(Ok(range)) = wb.worksheet_range_at(0) {
                        let mut rows = range.rows();
                        if let Some(headers) = rows.next() {
                            let cols: Vec<String> = headers.iter().map(|c| c.to_string()).collect();
                            for r in rows {
                                let mut obj = serde_json::Map::new();
                                for (i, col) in cols.iter().enumerate() {
                                    let v = match r.get(i) {
                                        Some(Data::String(s)) => s.clone(),
                                        Some(Data::Float(f)) => f.to_string(),
                                        Some(Data::Int(n)) => n.to_string(),
                                        Some(Data::Bool(b)) => b.to_string(),
                                        _ => String::new(),
                                    };
                                    obj.insert(col.clone(), Value::String(v));
                                }
                                if let Some(id) = obj.get("id").and_then(|v| v.as_str()) {
                                    map.insert(id.to_string(), Value::Object(obj));
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        *self.rows.write().unwrap() = map;
    }

    pub fn list(&self, keyword: &str, page: i64, size: i64) -> Vec<Value> {
        let rows = self.rows.read().unwrap();
        let mut out: Vec<Value> = rows
            .values()
            .filter(|v| keyword.is_empty() || self.matches(v, keyword))
            .cloned()
            .collect();
        out.sort_by(|a, b| {
            let ia = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let ib = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
            ib.cmp(ia)
        });
        let from = ((page - 1).max(0) * size) as usize;
        out.into_iter().skip(from).take(size as usize).collect()
    }

    pub fn count(&self, keyword: &str) -> i64 {
        let rows = self.rows.read().unwrap();
        rows.values().filter(|v| keyword.is_empty() || self.matches(v, keyword)).count() as i64
    }

    pub fn get(&self, id: &str) -> Option<Value> {
        self.rows.read().unwrap().get(id).cloned()
    }

    pub fn save(&self, body: Value) -> Value {
        let mut row = serde_json::Map::new();
        for col in &self.columns {
            row.insert(col.clone(), body.get(col).cloned().unwrap_or(Value::String(String::new())));
        }
        let id = body.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string().replace('-', ""));
        row.insert("id".into(), Value::String(id.clone()));
        row.insert("created_at".into(), Value::String(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()));
        let value = Value::Object(row);
        self.rows.write().unwrap().insert(id, value.clone());
        self.persist();
        value
    }

    pub fn update(&self, id: &str, body: Value) -> bool {
        let mut rows = self.rows.write().unwrap();
        if let Some(existing) = rows.get_mut(id) {
            if let Value::Object(map) = existing {
                if let Value::Object(input) = body {
                    for (k, v) in input {
                        if k != "id" {
                            map.insert(k, v);
                        }
                    }
                }
                map.insert("updated_at".into(), Value::String(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()));
                drop(rows);
                self.persist();
                return true;
            }
        }
        false
    }

    pub fn delete(&self, id: &str) -> bool {
        let removed = self.rows.write().unwrap().remove(id).is_some();
        if removed {
            self.persist();
        }
        removed
    }

    fn matches(&self, row: &Value, keyword: &str) -> bool {
        let k = keyword.to_lowercase();
        for col in &self.columns {
            if let Some(v) = row.get(col).and_then(|v| v.as_str()) {
                if v.to_lowercase().contains(&k) {
                    return true;
                }
            }
        }
        false
    }

    fn persist(&self) {
        if self.engine == "excel" {
            tracing::warn!("excel datasource {} is read-only at runtime", self.table);
            return;
        }
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let rows = self.rows.read().unwrap();
        if self.engine == "json" {
            let list: Vec<Value> = rows.values().cloned().collect();
            if let Ok(text) = serde_json::to_string_pretty(&list) {
                let _ = fs::write(&self.path, text);
            }
            return;
        }
        if let Ok(file) = fs::File::create(&self.path) {
            let mut wtr = csv::Writer::from_writer(file);
            let _ = wtr.write_record(&self.columns);
            for row in rows.values() {
                let record: Vec<String> = self
                    .columns
                    .iter()
                    .map(|c| row.get(c).map(|v| v.as_str().unwrap_or("").to_string()).unwrap_or_default())
                    .collect();
                let _ = wtr.write_record(&record);
            }
            let _ = wtr.flush();
        }
    }
}

pub fn registry() -> HashMap<String, std::sync::Arc<FileStore>> {
    let mut map: HashMap<String, std::sync::Arc<FileStore>> = HashMap::new();
${ir.fileTables.map((t) => `    map.insert(
        ${rsStr(t.name)}.to_string(),
        std::sync::Arc::new(FileStore::new(
            ${rsStr(t.name)},
            ${rsStr(t.engine)},
            ${rsStr(t.filePath || 'data/' + t.name + '.' + (t.engine === 'excel' ? 'xlsx' : t.engine))},
            vec![${t.columns.map((c) => rsStr(c.name)).join(', ')}],
        )),
    );`).join('\n')}
    map
}
`;
}

function bootstrapRs(ir) {
  const hasUser = ir.tables.some((t) => t.name === 'sys_user');
  if (!hasUser) {
    return `use crate::config::Config;
use crate::db::Db;

/// 未启用账号模块，无需自举。
pub async fn run(_cfg: &Config, _db: &Db) {}
`;
  }
  return `use crate::config::Config;
use crate::db::Db;
use crate::id;
use sqlx::Row;

/// 启动自举：管理员账号 + 权限点。即使没有跑 seed SQL 也能登录。
pub async fn run(cfg: &Config, db: &Db) {
    if let Err(e) = seed_permissions(db).await {
        tracing::warn!("seed permissions failed: {}", e);
    }
    if let Err(e) = seed_admin(cfg, db).await {
        tracing::warn!("seed admin failed: {}", e);
    }
}

async fn seed_permissions(db: &Db) -> Result<(), sqlx::Error> {
    let perms: Vec<(&str, &str, &str)> = vec![
${ir.perms.map((p) => `        (${rsStr(p.code)}, ${rsStr(p.name)}, ${rsStr(p.moduleId)}),`).join('\n')}
    ];
    for (code, name, module) in perms {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM sys_permission WHERE perm_code = ?")
            .bind(code)
            .fetch_one(&db.write)
            .await?;
        if exists == 0 {
            sqlx::query(
                "INSERT INTO sys_permission (id, perm_code, perm_name, module_id, kind, created_at, updated_at, created_by, updated_by, deleted, version) \\
                 VALUES (?,?,?,?,?,NOW(),NOW(),0,0,0,0)",
            )
            .bind(id::next_id())
            .bind(code)
            .bind(name)
            .bind(module)
            .bind("api")
            .execute(&db.write)
            .await?;
        }
    }
    Ok(())
}

async fn seed_admin(cfg: &Config, db: &Db) -> Result<(), sqlx::Error> {
    let roles: Vec<(&str, &str)> = vec![
        ("super_admin", "超级管理员"),
        ("operator", "业务操作员"),
        ("auditor", "审核员"),
    ];
    for (code, name) in roles {
        let exists: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM sys_role WHERE role_code = ?")
            .bind(code)
            .fetch_one(&db.write)
            .await?;
        if exists == 0 {
            sqlx::query(
                "INSERT INTO sys_role (id, role_code, role_name, data_scope, remark, created_at, updated_at, created_by, updated_by, deleted, version) \\
                 VALUES (?,?,?,?,?,NOW(),NOW(),0,0,0,0)",
            )
            .bind(id::next_id())
            .bind(code)
            .bind(name)
            .bind(1)
            .bind("bootstrap")
            .execute(&db.write)
            .await?;
        }
    }
    let users: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM sys_user")
        .fetch_one(&db.write)
        .await?;
    if users > 0 {
        return Ok(());
    }
    let admin_id = id::next_id();
    let hash = bcrypt::hash(&cfg.init_password, 10).unwrap_or_default();
    sqlx::query(
        "INSERT INTO sys_user (id, username, password, nickname, status, created_at, updated_at, created_by, updated_by, deleted, version) \\
         VALUES (?,?,?,?,?,NOW(),NOW(),0,0,0,0)",
    )
    .bind(admin_id)
    .bind(&cfg.init_admin)
    .bind(hash)
    .bind("管理员")
    .bind(1)
    .execute(&db.write)
    .await?;
    let role_id: i64 = sqlx::query_scalar("SELECT id FROM sys_role WHERE role_code = 'super_admin' LIMIT 1")
        .fetch_one(&db.write)
        .await?;
    sqlx::query(
        "INSERT INTO sys_user_role (id, user_id, role_id, created_at, updated_at, created_by, updated_by, deleted, version) \\
         VALUES (?,?,?,NOW(),NOW(),0,0,0,0)",
    )
    .bind(id::next_id())
    .bind(admin_id)
    .bind(role_id)
    .execute(&db.write)
    .await?;
    tracing::info!("initial admin created: {}", cfg.init_admin);
}
`;
}

function mainRs(ir) {
  const p = ir.project;
  return `mod api;
mod auth;
mod bootstrap;
mod cache;
mod config;
mod db;
mod error;
mod filesource;
mod id;
mod models;
mod rbac;
mod search;
mod storage;

use axum::http::{HeaderValue, Method};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<config::Config>,
    pub db: db::Db,
    pub cache: Option<cache::Cache>,
    pub files: Arc<std::collections::HashMap<String, Arc<filesource::FileStore>>>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = Arc::new(config::Config::from_env());
    let db = db::Db::connect(&cfg).await?;
    let cache = cache::Cache::connect(&cfg).await;
    let files = Arc::new(filesource::registry());

    bootstrap::run(&cfg, &db).await;

    let state = AppState { cfg: cfg.clone(), db, cache, files };
${ir.tables.some((t) => t.name === 'sys_session') ? `
    let job_state = state.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            ticker.tick().await;
            let _ = sqlx::query("DELETE FROM sys_session WHERE expires_at < NOW()").execute(&job_state.db.write).await;
        }
    });
` : ''}
    let app = api::router()
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_origin("*".parse::<HeaderValue>().unwrap())
                .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
                .allow_headers(tower_http::cors::Any),
        )
        .layer(TraceLayer::new_for_http());

    let addr = format!("0.0.0.0:{}", cfg.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("{} listening on {}", "${p.name}", addr);
    axum::serve(listener, app).await?;
    Ok(())
}
`;
}

function supportFiles(ir) {
  const files = [
    { path: 'Cargo.toml', content: cargo(ir) },
    { path: 'src/main.rs', content: mainRs(ir) },
    { path: 'src/config.rs', content: configRs(ir) },
    { path: 'src/db.rs', content: dbRs(ir) },
    { path: 'src/error.rs', content: errorRs(ir) },
    { path: 'src/id.rs', content: idRs(ir) },
    { path: 'src/auth.rs', content: authRs(ir) },
    { path: 'src/rbac.rs', content: rbacRs(ir) },
    { path: 'src/storage.rs', content: storageRs(ir) },
  ];
  const c = cacheRs(ir);
  if (c) files.push({ path: 'src/cache.rs', content: c });
  const s = searchRs(ir);
  if (s) files.push({ path: 'src/search.rs', content: s });
  const f = filesourceRs(ir);
  if (f) files.push({ path: 'src/filesource.rs', content: f });
  const b = bootstrapRs(ir);
  if (b) files.push({ path: 'src/bootstrap.rs', content: b });
  return files;
}

module.exports = { supportFiles, cargo, configRs, mainRs };
