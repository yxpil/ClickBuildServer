# 作者：yxpil
# -*- coding: utf-8 -*-
"""
ClickBuild 生成的 Python Flask 服务（原生运行时）。
读取同目录 service.json，直接用 Flask + PyMySQL 执行脚本与 SQL，不经过 Node。
运行：
    pip install -r requirements.txt
    python app.py
环境变量：PORT / API_PREFIX / MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DB
可选项：REDIS_HOST / REDIS_PORT / REDIS_DB / S3_ENDPOINT / S3_PORT / S3_ACCESS_KEY / S3_SECRET_KEY
"""
import os
import re
import json
import uuid
import time
import hashlib
import datetime
import decimal
import traceback
from urllib.parse import urljoin, urlparse, quote

from flask import Flask, request, Response, jsonify, make_response, send_from_directory
import pymysql
import requests

ROOT = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(ROOT, "service.json"), "r", encoding="utf-8") as f:
    SERVICE = json.load(f)


def _find_config_file():
    candidates = []
    if os.environ.get("CBS_CONFIG"):
        candidates.append(os.environ["CBS_CONFIG"])
    candidates += [
        os.path.join(ROOT, "config.json"),
        os.path.join(ROOT, "..", "..", "config.json"),
        os.path.join(ROOT, "..", "..", "..", "config.json"),
    ]
    for file in candidates:
        try:
            if file and os.path.isfile(file):
                return os.path.abspath(file)
        except Exception:
            pass
    return ""


def _read_dotenv():
    out = {}
    for file in (os.path.join(ROOT, ".env"), os.path.join(ROOT, "..", "..", ".env")):
        try:
            if not os.path.isfile(file):
                continue
            with open(file, "r", encoding="utf-8") as f:
                for line in f:
                    m = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$", line)
                    if not m:
                        continue
                    value = m.group(2).strip()
                    if value[:1] in ("'", '"'):
                        q = value[0]
                        end = value.find(q, 1)
                        if end > 0:
                            value = value[1:end]
                    else:
                        value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
                    out[m.group(1)] = value
        except Exception:
            pass
    return out


CONFIG_FILE = _find_config_file()
CONFIG = {}
if CONFIG_FILE:
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8-sig") as f:
            CONFIG = json.load(f) or {}
        print("[config] 已加载 " + CONFIG_FILE, flush=True)
    except Exception as e:
        print("[config] 读取 %s 失败：%s" % (CONFIG_FILE, e))
DOT_ENV = _read_dotenv()


def cfg(key, fallback=None):
    """优先级：系统环境变量 > config.json > .env > 代码默认值。"""
    if key in os.environ:
        return os.environ[key]
    if key in CONFIG:
        return CONFIG[key]
    if key in DOT_ENV:
        return DOT_ENV[key]
    return fallback


API_PREFIX = str(cfg("API_PREFIX", SERVICE.get("apiPrefix") or "/api"))
PORT = int(cfg("PORT", "18100"))

MYSQL = {
    "host": str(cfg("MYSQL_HOST", "127.0.0.1")),
    "port": int(cfg("MYSQL_PORT", "13306")),
    "user": str(cfg("MYSQL_USER", "root")),
    "password": str(cfg("MYSQL_PASSWORD", "")),
    "database": str(cfg("MYSQL_DB", "clickbuild")),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
    "autocommit": False,
}
REDIS_CFG = {
    "host": str(cfg("REDIS_HOST", "127.0.0.1")),
    "port": int(cfg("REDIS_PORT", "16379")),
    "db": int(cfg("REDIS_DB", "0")),
}
S3_CFG = {
    "endpoint": str(cfg("S3_ENDPOINT", "127.0.0.1")),
    "port": int(cfg("S3_PORT", "19000")),
    "access": str(cfg("S3_ACCESS_KEY", "clickbuild")),
    "secret": str(cfg("S3_SECRET_KEY", "clickbuild123")),
    "secure": str(cfg("S3_SSL", "false")).lower() == "true",
}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = max(1, int(cfg("MAX_BODY_MB", "64"))) * 1024 * 1024


def _json_default(value):
    if isinstance(value, datetime.datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, datetime.date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, decimal.Decimal):
        return float(value)
    return str(value)


app.json.default = _json_default

UPSTREAMS = {u.get("id") or u.get("name"): u for u in (SERVICE.get("upstreams") or [])}
PERMISSIONS = SERVICE.get("permissions") or {}
ROLES_MAX = 5

_redis = None
try:
    import redis as redislib
    _redis = redislib.Redis(host=REDIS_CFG["host"], port=REDIS_CFG["port"], db=REDIS_CFG["db"], decode_responses=True)
    _redis.ping()
except Exception:
    _redis = None

_s3 = None
try:
    from minio import Minio
    _s3 = Minio(
        "%s:%s" % (S3_CFG["endpoint"], S3_CFG["port"]),
        access_key=S3_CFG["access"], secret_key=S3_CFG["secret"], secure=S3_CFG["secure"],
    )
except Exception:
    _s3 = None

TOKENS = {}


def now_text():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def log(level, message, **extra):
    data = {"ts": now_text(), "level": level, "message": message}
    data.update(extra)
    print(json.dumps(data, ensure_ascii=False), flush=True)


def json_dump(value):
    return json.dumps(value, ensure_ascii=False, default=str)


def token_store_new(payload):
    token = uuid.uuid4().hex
    ttl = int((SERVICE.get("token") or {}).get("ttl") or 7200)
    record = dict(payload or {})
    record["_expires"] = int(time.time()) + ttl
    TOKENS[token] = record
    if _redis:
        try:
            _redis.setex("icb:token:%s" % token, ttl, json_dump(record))
        except Exception:
            pass
    return {"token": token, "ttl": ttl}


def token_store_get(token):
    if not token:
        return None
    rec = TOKENS.get(token)
    if rec is None and _redis:
        try:
            raw = _redis.get("icb:token:%s" % token)
            rec = json.loads(raw) if raw else None
        except Exception:
            rec = None
    if rec and int(rec.get("_expires") or 0) < int(time.time()):
        return None
    return rec


def token_store_del(token):
    TOKENS.pop(token, None)
    if _redis:
        try:
            _redis.delete("icb:token:%s" % token)
        except Exception:
            pass


# ---------------- 表结构与占位符 ----------------
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
NUMERIC = {"bigint", "int", "smallint", "tinyint", "decimal", "float", "double", "bool", "boolean"}
RE_TOKEN = re.compile(r"\{\{\s*([A-Za-z0-9_.:]+)\s*\}\}")
STRUCT = {"t", "table", "columns", "allColumns", "insertColumns", "insertValues", "updateSet", "where", "orderBy",
          "limit", "offset", "idColumn", "page", "pageSize", "schema", "tableComment", "bindColumn", "bucket"}


def ident(value, label="标识符"):
    value = str(value or "").strip()
    if not IDENT_RE.match(value):
        raise ValueError("非法%s：%s" % (label, value))
    return value


def split_token(token):
    if ":" in token:
        return token.split(":", 1)
    return token, ""


def table_of(iface, key):
    tables = iface.get("tables") or []
    if not tables:
        return None
    if not key:
        return tables[0]
    for t in tables:
        if t.get("key") == key:
            return t
    # 本接口没有这个表键时，按项目目录找其它接口的真实表名。
    for t in iface.get("projectTables") or []:
        names = (t.get("key"), t.get("name"), t.get("ref"))
        if key in [x for x in names if x]:
            return t
        schema = str(t.get("schema") or "")
        if schema and key == schema + "." + str(t.get("name") or ""):
            return t
        if t.get("ifaceId") and key == str(t.get("ifaceId")) + "." + str(t.get("key") or ""):
            return t
    return None


def binding_of(iface, key):
    t = table_of(iface, key)
    if not t:
        raise ValueError("未知表键：%s" % (key or "main"))
    return t


def field_of(binding, name):
    for f in binding.get("fields") or []:
        if f.get("name") == name:
            return f
    return None


def cast_value(field, raw):
    if raw is None:
        return None
    ftype = str((field or {}).get("type") or "varchar").lower()
    if ftype in ("bool", "boolean"):
        return str(raw).lower() in ("1", "true", "yes", "on")
    if ftype in NUMERIC:
        try:
            return float(raw) if "." in str(raw) else int(raw)
        except (TypeError, ValueError):
            return raw
    if isinstance(raw, (list, dict)):
        return json_dump(raw)
    return str(raw)


def columns_sql(binding):
    return ", ".join(ident(f.get("name")) for f in (binding.get("fields") or []) if not f.get("hidden"))


def all_columns_sql(binding):
    return ", ".join(ident(f.get("name")) for f in (binding.get("fields") or []))


def id_field(binding):
    for f in binding.get("fields") or []:
        if f.get("pk"):
            return f
    return (binding.get("fields") or [{"name": "id", "type": "bigint"}])[0]


def writable_fields(binding):
    return [f for f in (binding.get("fields") or [])
            if not f.get("pk") and not f.get("auto") and f.get("writable") is not False]


def cast_for_name(iface, name, value):
    for t in iface.get("tables") or []:
        f = field_of(t, name)
        if f:
            return cast_value(f, value)
    return value


def query_param(query, name):
    if name not in query:
        return None
    value = query.get(name)
    if isinstance(value, list):
        return value[-1] if value else None
    return value


def build_where(binding, ctx, params):
    parts = []
    query = ctx.get("query") or {}
    for key, raw in query.items():
        if key in ("page", "pageSize", "sort", "keyword", "keywordRegex", "keyword_regex"):
            continue
        m = re.match(r"^([A-Za-z0-9_]+?)(?:__(gte|lte|gt|lt|like|in|between|ne|regex|iregex|notregex|contains|startswith|endswith|isnull|notnull))?$", key)
        if not m:
            continue
        field = field_of(binding, m.group(1))
        if not field:
            continue
        op = m.group(2) or "eq"
        raw = raw[-1] if isinstance(raw, list) and raw else raw
        if raw in ("", None):
            continue
        col = ident(field.get("name"))
        if op == "eq":
            parts.append("%s = %%s" % col); params.append(cast_value(field, raw))
        elif op == "ne":
            parts.append("%s <> %%s" % col); params.append(cast_value(field, raw))
        elif op in ("gte", "gt", "lte", "lt"):
            sign = {"gte": ">=", "gt": ">", "lte": "<=", "lt": "<"}[op]
            parts.append("%s %s %%s" % (col, sign)); params.append(cast_value(field, raw))
        elif op == "like":
            parts.append("%s LIKE %%s" % col); params.append("%%%s%%" % raw)
        elif op in ("regex", "iregex", "notregex"):
            parts.append("%s %sREGEXP %%s" % (col, "NOT " if op == "notregex" else "")); params.append(raw)
        elif op in ("contains", "startswith", "endswith"):
            v = str(raw).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            parts.append("%s LIKE %%s" % col)
            params.append("%" + v + "%" if op == "contains" else (v + "%" if op == "startswith" else "%" + v))
        elif op == "in":
            vals = raw if isinstance(raw, list) else str(raw).split(",")
            vals = [v for v in (str(x).strip() for x in vals) if v][:50]
            if vals:
                parts.append("%s IN (%s)" % (col, ", ".join(["%s"] * len(vals))))
                params.extend(cast_value(field, v) for v in vals)
        elif op == "between":
            vals = raw if isinstance(raw, list) else str(raw).split(",")
            if len(vals) >= 2:
                parts.append("%s BETWEEN %%s AND %%s" % col)
                params.extend([cast_value(field, vals[0]), cast_value(field, vals[1])])
        elif op == "isnull":
            parts.append("%s IS %sNULL" % (col, "" if str(raw).lower() in ("1", "true", "yes", "y") else "NOT "))
        elif op == "notnull":
            parts.append("%s IS NOT NULL" % col)
    keyword = str(query_param(query, "keyword") or "").strip()
    search_fields = [f for f in (binding.get("fields") or []) if f.get("search") and re.search(r"char|text", str(f.get("type") or ""))]
    if keyword and search_fields:
        parts.append("(" + " OR ".join("%s LIKE %%s" % ident(f.get("name")) for f in search_fields) + ")")
        params.extend(["%%%s%%" % keyword] * len(search_fields))
    return " AND ".join(parts) if parts else "1 = 1"


def order_by_sql(binding, ctx):
    raw = str(query_param(ctx.get("query") or {}, "sort") or "").strip()
    fields = {f.get("name") for f in binding.get("fields") or []}
    if raw:
        built = []
        for p in [x.strip() for x in raw.split(",") if x.strip()][:3]:
            m = re.match(r"^([A-Za-z0-9_]+)(?::(asc|desc))?$", p, re.I)
            if m and m.group(1) in fields:
                built.append("%s %s" % (ident(m.group(1)), (m.group(2) or "asc").upper()))
        if built:
            return ", ".join(built)
    return "%s DESC" % ident(id_field(binding).get("name"))


def int_in(value, default, minimum, maximum):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return min(maximum, max(minimum, n))


def value_of(token, ctx, iface):
    if token == "id":
        return ctx.get("id")
    if token == "now":
        return now_text()
    if token in ("uuid", "onlyId"):
        return ctx.get("uuid") or uuid.uuid4().hex
    if token == "token":
        return ctx.get("token") or ""
    if token == "remoteIp":
        return ctx.get("remoteIp") or ""
    if token == "filename":
        return (ctx.get("file") or {}).get("filename", "")
    if token == "contentType":
        return (ctx.get("file") or {}).get("contentType", "")
    if token == "size":
        return (ctx.get("file") or {}).get("size", 0)
    if token == "objectKey":
        return (ctx.get("file") or {}).get("objectKey", "")
    if token == "objectUrl":
        return (ctx.get("file") or {}).get("objectUrl", "")
    dot = token.find(".")
    scope = token[:dot] if dot > 0 else ""
    key = token[dot + 1:] if dot > 0 else token
    bag = {"query": ctx.get("query"), "body": ctx.get("body"), "path": ctx.get("path"),
           "file": ctx.get("file"), "user": ctx.get("user") or {}}.get(scope)
    if bag is None:
        return None
    return cast_for_name(iface, key.split(".")[-1], bag.get(key))


def render_sql(text, iface, ctx):
    params = []
    out = []
    last = 0
    for m in RE_TOKEN.finditer(str(text or "")):
        out.append(str(text)[last:m.start()])
        token = m.group(1)
        base, key = split_token(token)
        if base in STRUCT:
            b = binding_of(iface, key) if base not in ("bucket", "bindColumn") else None
            if base in ("t", "table"):
                out.append(ident(b.get("name")))
            elif base == "schema":
                out.append((ident(b.get("schema")) + ".") if b.get("schema") else "")
            elif base == "columns":
                out.append(columns_sql(b))
            elif base == "allColumns":
                out.append(all_columns_sql(b))
            elif base == "insertColumns":
                out.append(", ".join(ident(f.get("name")) for f in writable_fields(b)))
            elif base == "insertValues":
                body = ctx.get("body") or {}
                vals = []
                for f in writable_fields(b):
                    raw = body.get(f.get("name"), f.get("default") if f.get("default") not in (None, "") else None)
                    params.append(cast_value(f, raw)); vals.append("%s")
                out.append(", ".join(vals))
            elif base == "updateSet":
                body = ctx.get("body") or {}
                cols = [f for f in writable_fields(b) if f.get("name") in body]
                if not cols:
                    raise ValueError("更新语句没有可写字段")
                for f in cols:
                    params.append(cast_value(f, body.get(f.get("name"))))
                out.append(", ".join("%s = %%s" % ident(f.get("name")) for f in cols))
            elif base == "where":
                out.append(build_where(b, ctx, params))
            elif base == "orderBy":
                out.append(order_by_sql(b, ctx))
            elif base == "limit":
                out.append(str(int_in(query_param(ctx.get("query") or {}, "pageSize") or query_param(ctx.get("query") or {}, "limit"), (SERVICE.get("page") or {}).get("size", 20), 1, 500)))
            elif base == "offset":
                size = int_in(query_param(ctx.get("query") or {}, "pageSize") or query_param(ctx.get("query") or {}, "limit"), (SERVICE.get("page") or {}).get("size", 20), 1, 500)
                page = int_in(query_param(ctx.get("query") or {}, "page"), 1, 1, 100000)
                out.append(str((page - 1) * size))
            elif base == "page":
                out.append(str(int_in(query_param(ctx.get("query") or {}, "page"), 1, 1, 100000)))
            elif base == "pageSize":
                out.append(str(int_in(query_param(ctx.get("query") or {}, "pageSize"), (SERVICE.get("page") or {}).get("size", 20), 1, 500)))
            elif base == "idColumn":
                out.append(ident(id_field(b).get("name")))
            elif base == "bindColumn":
                out.append(ident((iface.get("storage") or {}).get("bindField") or "file_key"))
            elif base == "bucket":
                out.append(str((iface.get("storage") or {}).get("bucket") or "clickbuild").replace("'", ""))
            else:
                out.append("")
        else:
            params.append(value_of(token, ctx, iface))
            out.append("%s")
        last = m.end()
    out.append(str(text)[last:])
    return "".join(out), params


def render_text(text, iface, ctx):
    def repl(m):
        token = m.group(1)
        base, key = split_token(token)
        if base in ("t", "table"):
            return ident(binding_of(iface, key).get("name"))
        if base == "columns":
            return columns_sql(binding_of(iface, key))
        if base == "allColumns":
            return all_columns_sql(binding_of(iface, key))
        if base == "idColumn":
            return ident(id_field(binding_of(iface, key)).get("name"))
        if token == "now":
            return now_text()
        if token in ("uuid", "onlyId"):
            return ctx.get("uuid") or uuid.uuid4().hex
        v = value_of(token, ctx, iface)
        return "" if v is None else str(v)
    return RE_TOKEN.sub(repl, str(text or ""))


# ---------------- 表达式求值 ----------------
def eval_expr(node, scope, iface, ctx):
    if node is None:
        return None
    k = node.get("k")
    if k == "lit":
        return node.get("v")
    if k == "ph":
        return value_of(node.get("v"), ctx, iface)
    if k == "var":
        cur = scope.get(node.get("name"))
        for p in node.get("path") or []:
            if cur is None:
                return None
            if isinstance(cur, (list, tuple)) and isinstance(p, int):
                cur = cur[p] if 0 <= p < len(cur) else None
            elif isinstance(cur, dict):
                cur = cur.get(p)
            else:
                cur = getattr(cur, p, None)
        return cur
    if k == "ident":
        name = str(node.get("name") or "").lower()
        if name in ("true", "false"):
            return name == "true"
        if name == "null":
            return None
        return {"user": ctx.get("user"), "query": ctx.get("query"), "body": ctx.get("body"),
                "path": ctx.get("path"), "file": ctx.get("file")}.get(name)
    if k == "array":
        return [eval_expr(x, scope, iface, ctx) for x in node.get("items") or []]
    if k == "object":
        return {e.get("key"): eval_expr(e.get("value"), scope, iface, ctx) for e in node.get("entries") or []}
    if k == "un":
        v = eval_expr(node.get("a"), scope, iface, ctx)
        return (not v) if node.get("op") == "!" else -float(v)
    if k == "and":
        return bool(eval_expr(node.get("a"), scope, iface, ctx)) and bool(eval_expr(node.get("b"), scope, iface, ctx))
    if k == "or":
        return bool(eval_expr(node.get("a"), scope, iface, ctx)) or bool(eval_expr(node.get("b"), scope, iface, ctx))
    if k == "cmp":
        a = eval_expr(node.get("a"), scope, iface, ctx)
        b = eval_expr(node.get("b"), scope, iface, ctx)
        op = node.get("op")
        if op == "==": return a == b
        if op == "!=": return a != b
        if op == ">": return a > b
        if op == "<": return a < b
        if op == ">=": return a >= b
        if op == "<=": return a <= b
    if k == "bin":
        a = eval_expr(node.get("a"), scope, iface, ctx)
        b = eval_expr(node.get("b"), scope, iface, ctx)
        op = node.get("op")
        if op == "+": return a + b
        if op == "-": return a - b
        if op == "*": return a * b
        if op == "/": return a / b
        if op == "%": return a % b
    if k == "call":
        return call_func(str(node.get("name") or "").upper(), [eval_expr(x, scope, iface, ctx) for x in node.get("args") or []], scope, iface, ctx)
    raise ValueError("不支持的表达式节点：%s" % k)


def call_func(name, args, scope, iface, ctx):
    def a(i, default=None):
        return args[i] if i < len(args) else default
    if name in ("LEN", "LENGTH"): return len(a(0) or "")
    if name == "NOW": return now_text()
    if name in ("UUID", "ONLYID"): return uuid.uuid4().hex
    if name == "UPPER": return str(a(0) or "").upper()
    if name == "LOWER": return str(a(0) or "").lower()
    if name == "TRIM": return str(a(0) or "").strip()
    if name in ("TOSTRING", "STR"): return "" if a(0) is None else str(a(0))
    if name in ("TOINT", "INT"): return int(float(a(0) or 0))
    if name == "CONCAT": return "".join("" if x is None else str(x) for x in args)
    if name == "SUBSTR": return str(a(0) or "")[int(a(1, 0)): int(a(1, 0)) + int(a(2, 999999))]
    if name == "REPLACE": return str(a(0) or "").replace(str(a(1) or ""), str(a(2) or ""))
    if name == "SPLIT": return str(a(0) or "").split(str(a(1) or ","))
    if name == "JOIN": return str(a(1) or "").join(str(x) for x in (a(0) or []))
    if name == "ROUND": return round(float(a(0) or 0), int(a(1, 0)))
    if name == "ABS": return abs(float(a(0) or 0))
    if name in ("MD5", "SHA1"): return hashlib.new(name.lower(), str(a(0) or "").encode()).hexdigest()
    if name == "JSON": return json_dump(a(0))
    if name == "JSONGET":
        cur = a(0)
        if isinstance(cur, str):
            cur = json.loads(cur)
        for p in str(a(1) or "").split("."):
            if p == "":
                continue
            cur = cur[int(p)] if isinstance(cur, list) and p.isdigit() else cur.get(p)
        return cur
    if name == "TOLIST":
        v = a(0)
        if isinstance(v, dict):
            return v.get("rows") or []
        return v if isinstance(v, list) else ([] if v is None else [v])
    if name in ("SM4_ENC", "SM4_DEC"):
        # Python 原生运行时没有内置 SM4；退化为 AES-GCM 会破坏互操作，明确报错。
        raise ValueError("Python 运行时暂未接入 SM4，请在脚本里改用 AES_ENC/AES_DEC 或 Node 运行时")
    if name == "AES_ENC":
        from cryptography.fernet import Fernet
        import base64
        key = base64.urlsafe_b64encode(hashlib.sha256(str(a(1) or "").encode()).digest())
        return Fernet(key).encrypt(str(a(0) or "").encode()).decode()
    if name == "AES_DEC":
        from cryptography.fernet import Fernet
        import base64
        key = base64.urlsafe_b64encode(hashlib.sha256(str(a(1) or "").encode()).digest())
        return Fernet(key).decrypt(str(a(0) or "").encode()).decode()
    raise ValueError("Python 运行时尚未实现函数：%s" % name)


# ---------------- 数据库 ----------------
class Runtime(object):
    def __init__(self, iface, ctx):
        self.iface = iface
        self.ctx = ctx
        self.conn = pymysql.connect(**MYSQL)
        self.closed = False

    def query(self, sql, params):
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() or []
            return {"rows": rows, "count": len(rows)}

    def execute(self, sql, params):
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return {"affectedRows": cur.rowcount, "insertId": cur.lastrowid}

    def commit(self):
        if not self.closed:
            self.conn.commit()

    def rollback(self):
        if not self.closed:
            self.conn.rollback()

    def close(self):
        if not self.closed:
            self.closed = True
            self.conn.close()


def run_script(ast, iface, ctx, rt):
    scope = dict(ctx.get("vars") or {})
    scope.update({"user": ctx.get("user"), "query": ctx.get("query"), "body": ctx.get("body"),
                  "path": ctx.get("path"), "id": ctx.get("id"), "file": ctx.get("file"),
                  "token": ctx.get("token"), "uuid": ctx.get("uuid"), "remoteIp": ctx.get("remoteIp")})
    logs = []

    def exec_block(stmts):
        for st in stmts or []:
            res = exec_stmt(st)
            if res is not None:
                return res
        return None

    def exec_stmt(st):
        k = st.get("k")
        if k == "let":
            src = st.get("from")
            if src == "query":
                sql, params = render_sql(st.get("sql"), iface, ctx)
                scope[st.get("name")] = rt.query(sql, params)
            elif src == "exec":
                sql, params = render_sql(st.get("sql"), iface, ctx)
                scope[st.get("name")] = rt.execute(sql, params)
            elif src == "http":
                url = render_text(st.get("url"), iface, ctx)
                body = eval_expr(st.get("expr"), scope, iface, ctx) if st.get("bodyText") else None
                method = st.get("method") or "GET"
                r = requests.request(method, url, json=body if method != "GET" else None, timeout=15)
                try:
                    data = r.json()
                except Exception:
                    data = r.text
                scope[st.get("name")] = {"status": r.status_code, "ok": 200 <= r.status_code < 300, "body": data}
            elif src == "crawl":
                url = render_text(st.get("url"), iface, ctx)
                opt = {}
                if st.get("optionsText"):
                    try:
                        opt = json.loads(re.sub(r"\btrue\b", "true", st.get("optionsText")))
                    except Exception:
                        opt = {}
                r = requests.get(url, timeout=20, headers={"user-agent": "ClickBuildCrawler/1.0"})
                raw = r.content or b""
                text = r.text
                m = re.search(r"<title[^>]*>([\s\S]*?)</title>", text, re.I)
                bodytext = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.I)
                bodytext = re.sub(r"<style[\s\S]*?</style>", " ", bodytext, flags=re.I)
                bodytext = re.sub(r"<[^>]+>", " ", bodytext)
                bodytext = re.sub(r"\s+", " ", bodytext).strip()
                links = []
                for href in re.findall(r"<a\s+[^>]*href=[\"']([^\"']+)", text, re.I)[:200]:
                    try:
                        links.append(urljoin(url, href))
                    except Exception:
                        pass
                matched = ""
                pattern = opt.get("pattern") if isinstance(opt, dict) else ""
                if pattern:
                    try:
                        hit = re.search(str(pattern), text, re.I)
                        matched = (hit.group(1) if hit and hit.groups() else (hit.group(0) if hit else ""))
                    except Exception:
                        matched = ""
                scope[st.get("name")] = {"status": r.status_code, "ok": r.ok, "url": url,
                                         "contentType": r.headers.get("content-type", ""),
                                         "title": m.group(1).strip() if m else "", "text": bodytext[:200000],
                                         "matched": matched, "links": links, "bytes": len(raw)}
            elif src == "token":
                payload = eval_expr(st.get("expr"), scope, iface, ctx)
                if st.get("action") == "NEW":
                    scope[st.get("name")] = token_store_new(payload)
                else:
                    scope[st.get("name")] = token_store_get(str(payload))
            else:
                scope[st.get("name")] = eval_expr(st.get("expr"), scope, iface, ctx)
            return None
        if k == "sql":
            sql, params = render_sql(st.get("sql"), iface, ctx)
            (rt.query if st.get("mode") == "query" else rt.execute)(sql, params)
            return None
        if k == "wait":
            ms = eval_expr(st.get("expr"), scope, iface, ctx)
            ms = max(0, min(float(ms or 0), 60000))
            time.sleep(ms / 1000.0)
            logs.append({"level": "DEBUG", "message": "WAIT %dms" % int(ms)})
            return None
        if k == "tx":
            action = str(st.get("action") or "").upper()
            if action == "BEGIN": rt.conn.begin()
            elif action == "COMMIT": rt.commit()
            elif action == "ROLLBACK": rt.rollback()
            return None
        if k == "tokenDel":
            token_store_del(eval_expr(st.get("expr"), scope, iface, ctx))
            return None
        if k == "publish":
            if _redis:
                try:
                    _redis.publish(str(st.get("channel")), json_dump(eval_expr(st.get("expr"), scope, iface, ctx)))
                except Exception:
                    pass
            return None
        if k == "log":
            value = eval_expr(st.get("expr"), scope, iface, ctx)
            message = value if isinstance(value, str) else json_dump(value)
            level = st.get("level") or "INFO"
            logs.append({"level": level, "message": message})
            log(level, message, route=iface.get("name"))
            return None
        if k == "if":
            for branch in st.get("branches") or []:
                if eval_expr(branch.get("cond"), scope, iface, ctx):
                    return exec_block(branch.get("body"))
            if st.get("elseBody"):
                return exec_block(st.get("elseBody"))
            return None
        if k == "foreach":
            for item in call_func("TOLIST", [eval_expr(st.get("expr"), scope, iface, ctx)], scope, iface, ctx):
                scope[st.get("name")] = item
                res = exec_block(st.get("body"))
                if res is not None:
                    return res
            return None
        if k == "return":
            body = eval_expr(st.get("expr"), scope, iface, ctx) if st.get("expr") else None
            return int(st.get("status") or 200), body
        return None

    res = exec_block(ast)
    if isinstance(res, tuple) and len(res) == 2:
        return res[0], res[1], logs
    return 200, res, logs


# ---------------- HTTP 入口 ----------------
ROUTES = []
for iface in SERVICE.get("interfaces") or []:
    for route in iface.get("routes") or []:
        prefix = re.escape(API_PREFIX + (iface.get("basePath") or ""))
        segs = []
        keys = []
        for i, seg in enumerate([s for s in route.get("path", "/").split("/") if s != ""]):
            if seg.startswith(":"):
                keys.append((i, seg[1:]))
                segs.append("(?P<p%d>[^/]+)" % i)
            else:
                segs.append(re.escape(seg))
        pattern = "^" + prefix + ("/" + "/".join(segs) if segs else "") + "/?$"
        ROUTES.append((re.compile(pattern), iface, route, keys))
ROUTES.sort(key=lambda x: ":" not in x[2].get("path", "/"), reverse=True)


def match_route(path, method):
    for rex, iface, route, keys in ROUTES:
        m = rex.match(path)
        if not m:
            continue
        if route.get("method") != method and not (method == "HEAD" and route.get("method") == "GET"):
            continue
        params = {}
        for idx, k in keys:
            params[k] = m.group("p%d" % idx)
        return iface, route, params
    return None, None, None


def bearer():
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get((SERVICE.get("token") or {}).get("cookie") or "icb_token", "")


def proxy_request(iface, route, params):
    cfg = route.get("proxy") or {}
    up = UPSTREAMS.get(cfg.get("upstream")) or {}
    base = up.get("baseUrl") or ""
    target = cfg.get("target") or ""
    if target:
        used = set()
        def _sub(m):
            k = m.group(1)
            if k in params:
                used.add(k)
                return quote(str(params[k]), safe="")
            return m.group(0)
        target = re.sub(r":([A-Za-z_][A-Za-z0-9_]*)", _sub, target)
        missing = []
        for k in re.findall(r":([A-Za-z_][A-Za-z0-9_]*)", route.get("path", "")):
            if k not in used and k in params:
                missing.append(params[k])
        if missing and not re.search(r":\w", target):
            target = target.rstrip("/") + "/" + "/".join(quote(str(v), safe="") for v in missing)
    if not target:
        target = route.get("path", "/")
        for k, v in params.items():
            target = target.replace(":" + k, v)
        target = target.lstrip("/")
    if not base and not re.match(r"^https?://", target):
        return jsonify({"ok": False, "error": "UPSTREAM_MISSING", "message": "代理路由没有配置上游 baseUrl"}), 502
    url = target if re.match(r"^https?://", target) else base.rstrip("/") + "/" + target.lstrip("/")
    headers = {}
    if cfg.get("forwardHeaders") is not False:
        for h in ("Accept", "User-Agent", "Authorization", "Cookie", "Content-Type"):
            if request.headers.get(h):
                headers[h] = request.headers[h]
    if up.get("authHeader"):
        headers[up["authHeader"]] = up.get("authValue", "")
    headers.update(up.get("headers") or {})
    r = requests.request(request.method, url, headers=headers, data=request.get_data(),
                         params=request.args, timeout=float(cfg.get("timeout") or up.get("timeout") or 15), allow_redirects=False)
    excluded = {"content-encoding", "transfer-encoding", "connection", "content-length"}
    out_headers = [(k, v) for k, v in r.headers.items() if k.lower() not in excluded]
    return Response(r.content, status=r.status_code, headers=dict(out_headers))


def object_table(iface, route):
    cfg = iface.get("objects") or {}
    if not cfg.get("enabled"):
        return jsonify({"ok": False, "error": "OBJECT_TABLE_OFF", "message": "该接口未启用对象表"}), 404
    if not _s3:
        return jsonify({"ok": False, "error": "S3_NOT_READY", "message": "对象存储未连接"}), 503
    bucket = request.args.get("bucket") or cfg.get("bucket") or (iface.get("storage") or {}).get("bucket") or "clickbuild"
    prefix = request.args.get("prefix", cfg.get("prefix") or "")
    size = max(1, min(int(request.args.get("size") or cfg.get("pageSize") or 20), 200))
    if request.method == "DELETE":
        key = request.args.get("key") or ""
        if not key:
            return jsonify({"ok": False, "error": "KEY_REQUIRED", "message": "删除对象需要 ?key="}), 400
        _s3.remove_object(bucket, key)
        return jsonify({"ok": True, "data": {"bucket": bucket, "key": key, "deleted": True}})
    objects = list(_s3.list_objects(bucket, prefix=prefix, recursive=True))
    objects.sort(key=lambda o: o.object_name)
    marker = request.args.get("marker") or ""
    objects = [o for o in objects if o.object_name > marker] if marker else objects
    rows = []
    for o in objects[:size]:
        url = ""
        try:
            url = _s3.presigned_get_object(bucket, o.object_name, expires=datetime.timedelta(hours=1))
        except Exception:
            pass
        rows.append({"key": o.object_name, "name": o.object_name.split("/")[-1], "size": o.size,
                     "etag": o.etag, "lastModified": o.last_modified.isoformat() if o.last_modified else "",
                     "bucket": bucket, "url": url})
    has_more = len(objects) > size
    return jsonify({"ok": True, "data": rows, "page": {"size": size, "count": len(rows), "hasMore": has_more,
                                                       "nextMarker": rows[-1]["key"] if has_more and rows else "",
                                                       "bucket": bucket, "prefix": prefix}})


@app.route(API_PREFIX, defaults={"subpath": ""}, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
@app.route(API_PREFIX + "/<path:subpath>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
def dispatch(subpath):
    if request.method == "OPTIONS":
        return ("", 204)
    iface, route, params = match_route(request.path, request.method)
    if not route:
        return jsonify({"ok": False, "error": "NOT_FOUND", "path": request.path}), 404

    query = {k: (v if len(v) > 1 else v[0]) for k, v in request.args.items(multi=True)}
    if request.is_json:
        body = request.get_json(silent=True) or {}
    elif request.form:
        body = request.form.to_dict()
    else:
        body = {}
    token = bearer()
    user = token_store_get(token) if (route.get("auth") or route.get("roles")) else None

    if route.get("auth") and not user:
        return jsonify({"ok": False, "error": "UNAUTHORIZED", "message": "需要有效的 token"}), 401
    if route.get("roles") and not user:
        return jsonify({"ok": False, "error": "UNAUTHORIZED", "message": "需要有效的 token"}), 401
    if PERMISSIONS.get("enforce") and route.get("roles"):
        roles = (user or {}).get("roles") or ([(user or {}).get("role")] if (user or {}).get("role") else [])
        if not set(roles) & set(route.get("roles") or []):
            return jsonify({"ok": False, "error": "FORBIDDEN", "message": "需要角色：" + ",".join(route.get("roles") or [])}), 403

    if route.get("key") == "proxy" or (route.get("proxy") or {}).get("enabled"):
        return proxy_request(iface, route, params)
    if route.get("key") == "objects":
        return object_table(iface, route)

    ctx = {
        "query": query, "body": body, "path": params,
        "id": params.get("id", query.get("id", body.get("id"))),
        "user": user, "token": token, "uuid": uuid.uuid4().hex, "remoteIp": request.remote_addr,
        "file": None, "vars": {},
    }

    # 上传：写到 S3（没连上则落本地 uploads/）
    if request.files and route.get("key") == "upload":
        f = next(iter(request.files.values()))
        data = f.read()
        filename = f.filename or "file"
        key = "%s/%s-%s" % (iface.get("id") or "upload", uuid.uuid4().hex[:8], filename)
        if _s3:
            try:
                bucket = (iface.get("storage") or {}).get("bucket") or "clickbuild"
                if not _s3.bucket_exists(bucket):
                    _s3.make_bucket(bucket)
                from io import BytesIO
                _s3.put_object(bucket, key, BytesIO(data), len(data), content_type=f.content_type or "application/octet-stream")
                url = _s3.presigned_get_object(bucket, key, expires=datetime.timedelta(hours=1))
            except Exception:
                _s3 = None
                url = ""
        if not _s3:
            path = os.path.join(ROOT, "uploads", *key.split("/"))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as out:
                out.write(data)
            url = "/uploads/" + key
        ctx["file"] = {"filename": filename, "contentType": f.content_type, "size": len(data), "objectKey": key, "objectUrl": url}

    rt = Runtime(iface, ctx)
    try:
        status, result, logs = run_script(route.get("ast") or [], iface, ctx, rt)
        if route.get("tx"):
            rt.commit()
        elif not getattr(rt, "closed", False):
            rt.commit()
        failed = int(status or 200) >= 400 or (isinstance(result, dict) and result.get("ok") is False)
        payload = {"ok": not failed, "data": result}
        if failed and isinstance(result, dict):
            payload["error"] = result.get("error") or "ERROR"
            if result.get("message"):
                payload["message"] = result["message"]
        if logs:
            payload["logs"] = logs
        return jsonify(payload), int(status or 200)
    except Exception as e:
        try:
            rt.rollback()
        except Exception:
            pass
        log("ERROR", "脚本执行失败", route=route.get("name"), error=str(e))
        return jsonify({"ok": False, "error": "SCRIPT_FAILED", "message": str(e),
                        "detail": traceback.format_exc() if os.environ.get("ERROR_DETAIL", "1") != "0" else ""}), 500
    finally:
        rt.close()


@app.route("/health")
def health():
    return jsonify({"ok": True, "runtime": "python-flask", "name": SERVICE.get("name"), "routes": len(ROUTES)})


PUBLIC_DIR = os.path.abspath(os.path.join(ROOT, "..", "..", "public"))
UPLOAD_DIR = os.path.join(ROOT, "uploads")


@app.route("/uploads/<path:key>")
def uploaded_file(key):
    if ".." in key.split("/"):
        return jsonify({"ok": False, "error": "BAD_PATH"}), 400
    return send_from_directory(UPLOAD_DIR, key, conditional=True)


@app.route("/", defaults={"asset": ""})
@app.route("/<path:asset>")
def frontend(asset):
    if not asset:
        return send_from_directory(PUBLIC_DIR, "index.html")
    target = os.path.join(PUBLIC_DIR, asset)
    if os.path.isfile(target):
        return send_from_directory(PUBLIC_DIR, asset)
    return send_from_directory(PUBLIC_DIR, "index.html")


if __name__ == "__main__":
    log("INFO", "Python Flask 服务启动", port=PORT, routes=len(ROUTES), redis=bool(_redis), s3=bool(_s3))
    app.run(host="0.0.0.0", port=PORT, threaded=True)
