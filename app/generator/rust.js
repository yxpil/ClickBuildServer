'use strict';

const N = require('./naming');
const { supportFiles } = require('./rustSupport');

const rsStr = (s) => JSON.stringify(String(s == null ? '' : s));

/** 路由 -> 合法 Rust 标识符片段：/order/biz-order -> order_biz_order */
const fnId = (t) => t.route.replace(/^\//, '').replace(/[-\/]/g, '_');

const COMMON = new Set(['id', 'tenant_id', 'version', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted']);

function rustType(col) {
  const t = String(col.type).toLowerCase();
  if (t.startsWith('bigint')) return 'i64';
  if (t.startsWith('tinyint')) return 'i8';
  if (t.startsWith('smallint')) return 'i16';
  if (/^int/.test(t) || t.startsWith('mediumint')) return 'i32';
  if (t.startsWith('decimal') || t.startsWith('numeric') || t.startsWith('double') || t.startsWith('float')) return 'f64';
  if (t.startsWith('datetime') || t.startsWith('timestamp')) return 'NaiveDateTime';
  if (t.startsWith('date')) return 'NaiveDate';
  if (t.startsWith('time')) return 'NaiveTime';
  if (t.startsWith('blob') || t.startsWith('binary')) return 'Vec<u8>';
  return 'String';
}

const idType = (p) => (p.idStrategy === 'ulid' || p.idStrategy === 'uuid' ? 'String' : 'i64');

function modelsRs(ir) {
  const p = ir.project;
  const structs = ir.mysqlTables.map((t) => {
    const idt = idType(p);
    const fields = t.columns.map((c) => {
      const ty = rustType(c);
      if (c.name === 'id') return `    pub id: ${idt},`;
      if (c.required && c.name !== 'id') return `    pub ${c.name}: ${ty},`;
      return `    pub ${c.name}: Option<${ty}>,`;
    });
    return `/** ${t.comment}（${t.name}） */
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ${t.class} {
${fields.join('\n')}
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ${t.class}Input {
${t.columns.filter((c) => !COMMON.has(c.name)).map((c) => `    pub ${c.name}: Option<${rustType(c)}>,`).join('\n')}
${COMMON.has('id') ? `    pub id: Option<${idt}>,` : ''}
}
`;
  });
  return `use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde::{Deserialize, Serialize};

${structs.join('\n')}
`;
}

function pageQuery() {
  return `#[derive(Debug, Deserialize)]
pub struct PageQuery {
    pub page: Option<i64>,
    pub size: Option<i64>,
    pub keyword: Option<String>,
}
`;
}

function listFn(t, ir) {
  const p = ir.project;
  const name = `list_${fnId(t)}`;
  const search = t.search;
  const searchBlock = search.length ? `    if !keyword.is_empty() {
        let like = format!("%{}%", keyword);
        count_qb.push(" AND (");
        list_qb.push(" AND (");
${search.map((f, i) => `        ${i === 0 ? '' : 'count_qb.push(" OR "); list_qb.push(" OR ");\n        '}count_qb.push("${f} LIKE ").push_bind(&like); list_qb.push("${f} LIKE ").push_bind(&like);`).join('\n')}
        count_qb.push(")");
        list_qb.push(")");
    }
` : '';
  return `pub async fn ${name}(
    State(app): State<AppState>,
    Query(q): Query<PageQuery>,
    headers: HeaderMap,
) -> Result<Json<ApiResult<Page<${t.class}>>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "${t.moduleId}:list")?;
    let page = q.page.unwrap_or(1).max(1);
    let size = q.size.unwrap_or(20).clamp(1, 200);
    let keyword = q.keyword.unwrap_or_default();

    let mut count_qb: QueryBuilder<MySql> = QueryBuilder::new("SELECT COUNT(1) FROM ${t.name} WHERE deleted = 0");
    let mut list_qb: QueryBuilder<MySql> = QueryBuilder::new("SELECT * FROM ${t.name} WHERE deleted = 0");
${searchBlock}    let total: i64 = count_qb.build_query_scalar().fetch_one(&app.db.read).await?;
    list_qb.push(" ORDER BY id DESC LIMIT ").push_bind(size).push(" OFFSET ").push_bind((page - 1) * size);
    let records: Vec<${t.class}> = list_qb.build_query_as().fetch_all(&app.db.read).await?;
    Ok(Json(ApiResult::ok(Page { page, size, total, records })))
}
`;
}

function getFn(t, ir) {
  const p = ir.project;
  const name = `get_${fnId(t)}`;
  const idt = idType(p);
  const ttl = t.cacheTtl || 300;
  return `pub async fn ${name}(
    State(app): State<AppState>,
    Path(id): Path<${idt}>,
    headers: HeaderMap,
) -> Result<Json<ApiResult<${t.class}>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "${t.moduleId}:detail")?;
    let key = format!("{}:${t.name}:{}", app.cfg.key_prefix, id);
${t.cache ? `    if let Some(c) = &app.cache {
        if let Some(json) = c.get(&key).await {
            if let Ok(row) = serde_json::from_str::<${t.class}>(&json) {
                return Ok(Json(ApiResult::ok(row)));
            }
        }
    }
` : ''}    let row: Option<${t.class}> = sqlx::query_as("SELECT * FROM ${t.name} WHERE id = ? AND deleted = 0")
        .bind(&id)
        .fetch_optional(&app.db.read)
        .await?;
    let row = row.ok_or_else(|| AppError::NotFound("记录不存在".into()))?;
${t.cache ? `    if let Some(c) = &app.cache {
        let _ = c.set(&key, &serde_json::to_string(&row).unwrap_or_default(), ${ttl}).await;
    }
` : ''}    Ok(Json(ApiResult::ok(row)))
}
`;
}

function createFn(t, ir) {
  const p = ir.project;
  const name = `create_${fnId(t)}`;
  const idt = idType(p);
  const cols = t.columns.filter((c) => c.name !== 'id');
  const textExpr = t.search.length
    ? t.search.map((f) => `input.${f}.clone().unwrap_or_default()`).join(' + " " + ')
    : 'String::new()';
  const bindLines = cols.map((c) => {
    if (['created_at', 'updated_at', 'deleted', 'version', 'tenant_id'].includes(c.name)) return '';
    if (['created_by', 'updated_by'].includes(c.name)) return '\n    .bind(user.user_id)';
    return `\n    .bind(input.${c.name}.unwrap_or_default())`;
  }).join('');
  return `pub async fn ${name}(
    State(app): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<${t.class}Input>,
) -> Result<Json<ApiResult<Value>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "${t.moduleId}:create")?;
    let id: ${idt} = input.id.clone().unwrap_or_else(id::next_id);
${t.search.length ? `    let text = format!("{}", ${textExpr});
` : ''}    sqlx::query(
        "INSERT INTO ${t.name} (id, ${cols.map((c) => c.name).join(', ')}) VALUES (?, ${cols.map((c) => {
          if (c.name === 'created_at' || c.name === 'updated_at') return 'NOW()';
          if (c.name === 'deleted' || c.name === 'version' || c.name === 'tenant_id') return '0';
          return '?';
        }).join(', ')})",
    )
    .bind(&id)${bindLines}
    .execute(&app.db.write)
    .await?;
${t.cache ? `    let key = format!("{}:${t.name}:{}", app.cfg.key_prefix, id);
    if let Some(c) = &app.cache { let _ = c.del(&key).await; }
` : ''}${t.search.length ? `    if let Some(c) = &app.cache {
        search::index(&app.cfg, c, "${t.name}", &id.to_string(), &text).await;
    }
` : ''}    Ok(Json(ApiResult::ok(serde_json::json!({ "id": id }))))
}
`;
}

function updateFn(t, ir) {
  const p = ir.project;
  const name = `update_${fnId(t)}`;
  const idt = idType(p);
  const userCols = t.columns.filter((c) => !COMMON.has(c.name) && c.name !== 'id');
  return `pub async fn ${name}(
    State(app): State<AppState>,
    Path(id): Path<${idt}>,
    headers: HeaderMap,
    Json(input): Json<${t.class}Input>,
) -> Result<Json<ApiResult<()>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "${t.moduleId}:update")?;
    let mut qb: QueryBuilder<MySql> = QueryBuilder::new("UPDATE ${t.name} SET updated_at = NOW(), updated_by = ");
    qb.push_bind(user.user_id);
${userCols.map((c) => `    if let Some(v) = &input.${c.name} { qb.push(", ${c.name} = ").push_bind(v); }`).join('\n')}
    qb.push(" WHERE id = ").push_bind(&id).push(" AND deleted = 0");
    qb.build().execute(&app.db.write).await?;
${t.cache ? `    let key = format!("{}:${t.name}:{}", app.cfg.key_prefix, id);
    if let Some(c) = &app.cache { let _ = c.del(&key).await; }
` : ''}${t.search.length ? `    let text = format!("{}", ${t.search.map((f) => `input.${f}.clone().unwrap_or_default()`).join(' + " " + ')});
    if let Some(c) = &app.cache { search::index(&app.cfg, c, "${t.name}", &id.to_string(), &text).await; }
` : ''}    Ok(Json(ApiResult::ok(())))
}
`;
}

function deleteFn(t, ir) {
  const p = ir.project;
  const name = `delete_${fnId(t)}`;
  const idt = idType(p);
  return `pub async fn ${name}(
    State(app): State<AppState>,
    Path(id): Path<${idt}>,
    headers: HeaderMap,
) -> Result<Json<ApiResult<()>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "${t.moduleId}:delete")?;
    sqlx::query("UPDATE ${t.name} SET deleted = 1 WHERE id = ?")
        .bind(&id)
        .execute(&app.db.write)
        .await?;
${t.cache ? `    let key = format!("{}:${t.name}:{}", app.cfg.key_prefix, id);
    if let Some(c) = &app.cache { let _ = c.del(&key).await; }
` : ''}    Ok(Json(ApiResult::ok(())))
}
`;
}

function auditFn(t, ir) {
  if (!(t.features && t.features.audit) || !ir.tables.some((x) => x.name === 'sys_approval')) return '';
  const p = ir.project;
  const idt = idType(p);
  const name = `submit_audit_${fnId(t)}`;
  return `pub async fn ${name}(
    State(app): State<AppState>,
    Path(id): Path<${idt}>,
    headers: HeaderMap,
) -> Result<Json<ApiResult<Value>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "${t.moduleId}:audit")?;
    let approval_id = id::next_id();
    sqlx::query(
        "INSERT INTO sys_approval (id, biz_module, biz_id, title, status, current_node, applicant_id, applicant_name, created_at, updated_at, created_by, updated_by, deleted, version) \\
         VALUES (?,?,?,?,?,?,?,?,NOW(),NOW(),?,?,0,0)",
    )
    .bind(&approval_id)
    .bind("${t.moduleId}")
    .bind(&id)
    .bind(format!("${t.comment} {}", id))
    .bind(0i8)
    .bind(1i32)
    .bind(user.user_id)
    .bind(&user.username)
    .bind(user.user_id)
    .bind(user.user_id)
    .execute(&app.db.write)
    .await?;
    Ok(Json(ApiResult::ok(serde_json::json!({ "approvalId": approval_id }))))
}
`;
}

function fileFns(t, ir) {
  const moduleId = t.moduleId;
  const base = fnId(t);
  const store = `app.files.get("${t.name}").cloned()`;
  return `fn store_${base}(app: &AppState) -> Result<Arc<FileStore>, AppError> {
    ${store}.ok_or_else(|| AppError::NotFound("数据源不存在".into()))
}

pub async fn list_${base}(
    State(app): State<AppState>,
    Query(q): Query<PageQuery>,
    headers: HeaderMap,
) -> Result<Json<ApiResult<Page<Value>>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "${moduleId}:list")?;
    let page = q.page.unwrap_or(1).max(1);
    let size = q.size.unwrap_or(20).clamp(1, 200);
    let keyword = q.keyword.unwrap_or_default();
    let store = store_${base}(&app)?;
    let total = store.count(&keyword);
    let records = store.list(&keyword, page, size);
    Ok(Json(ApiResult::ok(Page { page, size, total, records })))
}

pub async fn get_${base}(
    State(app): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResult<Value>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "${moduleId}:detail")?;
    let store = store_${base}(&app)?;
    store.get(&id).map(|v| Json(ApiResult::ok(v))).ok_or_else(|| AppError::NotFound("记录不存在".into()))
}

pub async fn create_${base}(
    State(app): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<ApiResult<Value>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "${moduleId}:create")?;
    let store = store_${base}(&app)?;
    Ok(Json(ApiResult::ok(store.save(body))))
}

pub async fn update_${base}(
    State(app): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<ApiResult<()>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "${moduleId}:update")?;
    let store = store_${base}(&app)?;
    if !store.update(&id, body) { return Err(AppError::NotFound("记录不存在".into())); }
    Ok(Json(ApiResult::ok(())))
}

pub async fn delete_${base}(
    State(app): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<ApiResult<()>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "${moduleId}:delete")?;
    let store = store_${base}(&app)?;
    store.delete(&id);
    Ok(Json(ApiResult::ok(())))
}
`;
}

function moduleRoutes(module, tables, ir) {
  const routes = [];
  tables.forEach((t) => {
    const base = `/${module.dir}/${N.kebab(t.name)}`;
    const f = fnId(t);
    if (t.engine === 'mysql') {
      routes.push(`        .route("/api${base}", get(list_${f}).post(create_${f}))`);
      routes.push(`        .route("/api${base}/:id", get(get_${f}).put(update_${f}).delete(delete_${f}))`);
      if (t.features && t.features.audit && ir.tables.some((x) => x.name === 'sys_approval')) {
        routes.push(`        .route("/api${base}/:id/submit-audit", axum::routing::post(submit_audit_${f}))`);
      }
    } else {
      routes.push(`        .route("/api${base}", get(list_${f}).post(create_${f}))`);
      routes.push(`        .route("/api${base}/:id", get(get_${f}).put(update_${f}).delete(delete_${f}))`);
    }
  });
  return routes.join('\n');
}

function moduleFile(module, tables, ir) {
  const p = ir.project;
  const structs = tables.filter((t) => t.engine === 'mysql').map((t) => t.class);
  const hasFile = tables.some((t) => t.engine !== 'mysql');
  const hasAudit = tables.some((t) => t.features && t.features.audit) && ir.tables.some((x) => x.name === 'sys_approval');
  const imports = [
    'use std::sync::Arc;',
    'use axum::extract::{Path, Query, State};',
    'use axum::http::HeaderMap;',
    'use axum::routing::get;',
    'use axum::Json;',
    'use serde::Deserialize;',
    'use serde_json::Value;',
    'use sqlx::{MySql, QueryBuilder};',
    'use crate::auth;',
    'use crate::error::{ApiResult, AppError, Page};',
    'use crate::filesource::FileStore;',
    'use crate::id;',
    'use crate::search;',
    'use crate::AppState;',
    structs.length ? `use crate::models::{${structs.map((c) => `${c}, ${c}Input`).join(', ')}};` : '',
  ].filter(Boolean);

  const fns = [];
  tables.forEach((t) => {
    if (t.engine === 'mysql') {
      fns.push(listFn(t, ir), getFn(t, ir), createFn(t, ir), updateFn(t, ir), deleteFn(t, ir));
      const a = auditFn(t, ir);
      if (a) fns.push(a);
    } else {
      fns.push(fileFns(t, ir));
    }
  });

  return `// ${module.name} · 自动生成的 REST 接口
${imports.join('\n')}

${pageQuery()}${fns.join('\n')}
pub fn routes() -> axum::Router<AppState> {
    axum::Router::new()
${moduleRoutes(module, tables, ir)}
}
`;
}

function authApi(ir) {
  const p = ir.project;
  const hasSession = ir.tables.some((t) => t.name === 'sys_session');
  return `use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;

use crate::auth;
use crate::error::{ApiResult, AppError};
use crate::id;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct LoginReq {
    pub username: String,
    pub password: String,
}

pub async fn login(State(app): State<AppState>, Json(req): Json<LoginReq>) -> Result<Response, AppError> {
    let row: Option<(i64, String, String, i8)> = sqlx::query_as(
        "SELECT id, username, password, status FROM sys_user WHERE username = ? AND deleted = 0 LIMIT 1",
    )
    .bind(&req.username)
    .fetch_optional(&app.db.read)
    .await?;
    let (user_id, username, hash, status) =
        row.ok_or_else(|| AppError::Unauthorized("账号或密码错误".into()))?;
    if status == 0 {
        return Err(AppError::Forbidden("账号已被禁用".into()));
    }
    let ok = bcrypt::verify(&req.password, &hash).unwrap_or(false);
    if !ok {
        return Err(AppError::Unauthorized("账号或密码错误".into()));
    }
    let tid = uuid::Uuid::new_v4().to_string().replace('-', "");
    let token = auth::create_token(&app.cfg, user_id, &username, &tid);
${hasSession ? `    let expires = chrono::Local::now().naive_local() + chrono::Duration::seconds(app.cfg.ttl_seconds);
    sqlx::query(
        "INSERT INTO sys_session (id, token_id, user_id, device, expires_at, revoked, created_at, updated_at, created_by, updated_by, deleted, version) \\
         VALUES (?,?,?,?,?,?,NOW(),NOW(),?,?,0,0)",
    )
    .bind(id::next_id())
    .bind(&tid)
    .bind(user_id)
    .bind("web")
    .bind(expires)
    .bind(0i8)
    .bind(user_id)
    .bind(user_id)
    .execute(&app.db.write)
    .await?;
` : ''}    if let Some(c) = &app.cache {
        let _ = c
            .set(&format!("{}:session:{}", app.cfg.key_prefix, tid), &user_id.to_string(), app.cfg.ttl_seconds)
            .await;
    }
    let perms = crate::rbac::perms(&app.cfg, &app.db, &app.cache, user_id).await;
    let body = serde_json::json!({
        "token": token,
        "userId": user_id,
        "username": username,
        "perms": perms,
        "expiresIn": app.cfg.ttl_seconds
    });
    let mut response = Json(ApiResult::ok(body)).into_response();
    let cookie = format!(
        "{}={}; Path=/; HttpOnly; Max-Age={}; SameSite=Lax",
        app.cfg.cookie_name, token, app.cfg.ttl_seconds
    );
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append(header::SET_COOKIE, v);
    }
    Ok(response)
}

pub async fn logout(State(app): State<AppState>, headers: HeaderMap) -> Result<Response, AppError> {
    if let Some(token) = auth::token_from_headers(&headers) {
        if let Ok(claims) = auth::parse_token(&app.cfg, &token) {
${hasSession ? `            let _ = sqlx::query("UPDATE sys_session SET revoked = 1 WHERE token_id = ?")
                .bind(&claims.tid)
                .execute(&app.db.write)
                .await;
` : ''}            if let Some(c) = &app.cache {
                let _ = c.del(&format!("{}:session:{}", app.cfg.key_prefix, claims.tid)).await;
            }
        }
    }
    let mut response = Json(ApiResult::ok(())).into_response();
    let cookie = format!("{}=; Path=/; HttpOnly; Max-Age=0", app.cfg.cookie_name);
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        response.headers_mut().append(header::SET_COOKIE, v);
    }
    Ok(response)
}

pub async fn me(State(app): State<AppState>, headers: HeaderMap) -> Result<Json<ApiResult<Value>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    Ok(Json(ApiResult::ok(serde_json::json!({
        "userId": user.user_id,
        "username": user.username,
        "perms": user.perms
    }))))
}

pub fn routes() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
}
`;
}

function approvalApi(ir) {
  if (!ir.tables.some((t) => t.name === 'sys_approval')) return null;
  return `use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use sqlx::Row;

use crate::auth;
use crate::error::{ApiResult, AppError};
use crate::models::SysApproval;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct AuditBody {
    pub opinion: Option<String>,
}

pub async fn todo(State(app): State<AppState>, headers: HeaderMap) -> Result<Json<ApiResult<Vec<SysApproval>>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "approval:list")?;
    let rows: Vec<SysApproval> = sqlx::query_as("SELECT * FROM sys_approval WHERE status = 0 AND deleted = 0 ORDER BY id DESC LIMIT 200")
        .fetch_all(&app.db.read)
        .await?;
    Ok(Json(ApiResult::ok(rows)))
}

pub async fn pass(
    State(app): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    body: Option<Json<AuditBody>>,
) -> Result<Json<ApiResult<()>>, AppError> {
    act(&app, &headers, id, true, body.map(|b| b.0.opinion.unwrap_or_default()).unwrap_or_default()).await
}

pub async fn reject(
    State(app): State<AppState>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    body: Option<Json<AuditBody>>,
) -> Result<Json<ApiResult<()>>, AppError> {
    act(&app, &headers, id, false, body.map(|b| b.0.opinion.unwrap_or_default()).unwrap_or_default()).await
}

async fn act(app: &AppState, headers: &HeaderMap, id: i64, pass: bool, opinion: String) -> Result<Json<ApiResult<()>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, headers).await?;
    auth::ensure(&user, "approval:audit")?;
    let row = sqlx::query("SELECT status FROM sys_approval WHERE id = ? AND deleted = 0")
        .bind(id)
        .fetch_optional(&app.db.read)
        .await?;
    let row = row.ok_or_else(|| AppError::NotFound("审核单不存在".into()))?;
    let status: i8 = row.get("status");
    if status != 0 {
        return Err(AppError::BadRequest("审核单已结束".into()));
    }
    let new_status = if pass { 1i8 } else { 2i8 };
    sqlx::query("UPDATE sys_approval SET status = ?, finished_at = NOW(), updated_at = NOW() WHERE id = ?")
        .bind(new_status)
        .bind(id)
        .execute(&app.db.write)
        .await?;
    sqlx::query(
        "INSERT INTO sys_approval_node (id, approval_id, node_no, auditor_id, auditor_name, action, opinion, acted_at, created_at, updated_at, created_by, updated_by, deleted, version) \\
         VALUES (?,?,?,?,?,?,?,NOW(),NOW(),NOW(),?,?,0,0)",
    )
    .bind(crate::id::next_id())
    .bind(id)
    .bind(1i32)
    .bind(user.user_id)
    .bind(&user.username)
    .bind(if pass { "pass" } else { "reject" })
    .bind(opinion)
    .bind(user.user_id)
    .bind(user.user_id)
    .execute(&app.db.write)
    .await?;
    Ok(Json(ApiResult::ok(())))
}

pub fn routes() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/api/approval/task/todo", get(todo))
        .route("/api/approval/task/:id/pass", post(pass))
        .route("/api/approval/task/:id/reject", post(reject))
}
`;
}

function storageApi(ir) {
  return `use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::Json;
use serde_json::{json, Value};

use crate::auth;
use crate::error::{ApiResult, AppError};
use crate::storage;
use crate::AppState;

pub async fn presign_put(
    State(app): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<ApiResult<Value>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "file:upload")?;
    let key = body.get("objectKey").and_then(|v| v.as_str()).unwrap_or("upload.bin");
    Ok(Json(ApiResult::ok(json!({
        "url": storage::presign(&app.cfg, key, "PUT", 900),
        "objectKey": key
    }))))
}

pub async fn presign_get(
    State(app): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ApiResult<Value>>, AppError> {
    let user = auth::current(&app.cfg, &app.db, &app.cache, &headers).await?;
    auth::ensure(&user, "file:download")?;
    Ok(Json(ApiResult::ok(json!({ "info": "pass objectKey in query" }))))
}

pub fn routes() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/api/storage/presign-put", post(presign_put))
        .route("/api/storage/presign-get", post(presign_get))
}
`;
}

function apiMod(ir) {
  const modules = ir.modules;
  const hasApproval = ir.tables.some((t) => t.name === 'sys_approval');
  const entityMods = [];
  modules.forEach((m) => {
    const tables = ir.tables.filter((t) => t.moduleId === m.id);
    if (!tables.length) return;
    if (m.id === 'auth') entityMods.push('auth_session');
    else if (m.id === 'approval') entityMods.push('approval_entity');
    else entityMods.push(m.dir);
  });
  const declares = [
    'pub mod auth;',
    ...entityMods.map((m) => `pub mod ${m};`),
    ...(hasApproval ? ['pub mod approval;'] : []),
    'pub mod storage;',
  ];
  const merges = ['        .merge(auth::routes())'];
  entityMods.forEach((m) => merges.push(`        .merge(${m}::routes())`));
  if (hasApproval) merges.push('        .merge(approval::routes())');
  merges.push('        .merge(storage::routes())');
  return `${declares.join('\n')}

use axum::Router;

use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
${merges.join('\n')}
}
`;
}

function generateRust(ir) {
  const files = [
    ...supportFiles(ir),
    { path: 'src/models.rs', content: modelsRs(ir) },
    { path: 'src/api/mod.rs', content: apiMod(ir) },
    { path: 'src/api/auth.rs', content: authApi(ir) },
  ];
  ir.modules.forEach((m) => {
    const tables = ir.tables.filter((t) => t.moduleId === m.id);
    if (!tables.length) return;
    let file = m.dir;
    if (m.id === 'auth') file = 'auth_session';
    if (m.id === 'approval') file = 'approval_entity';
    files.push({ path: `src/api/${file}.rs`, content: moduleFile(m, tables, ir) });
  });
  if (tablesOfApproval(ir).length) {
    files.push({ path: 'src/api/approval.rs', content: approvalApi(ir) });
  }
  files.push({ path: 'src/api/storage.rs', content: storageApi(ir) });
  return files;
}

function tablesOfApproval(ir) {
  return ir.tables.filter((t) => t.moduleId === 'approval');
}

module.exports = { generateRust, modelsRs };
