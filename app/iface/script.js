'use strict';

// 一个接口的每条路由 = 一段脚本。脚本以行组织，够简单，也够表达：
//   LET $rows = QUERY SELECT ... ;
//   IF LEN($rows.rows) == 0
//     EXEC INSERT INTO ... ;
//     RETURN 201 { "ok": true };
//   ELSE
//     RETURN 409 { "ok": false, "error": "USER_EXISTS" };
//   END
// SQL 里的 {{...}} 由 render.js 安全展开；表达式里可以调 funcs.js 的全套函数与用户自定义函数。
// 这套语法之后可以逐条翻译成 JS / Java / Go（见 codegen 的 export 产物）。

const render = require('./render');
const funcs = require('./funcs');

/* ---------------- 表达式 ---------------- */

function lex(src) {
  const out = [];
  let i = 0;
  const s = String(src || '');
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '{' && s[i + 1] === '{') {
      const end = s.indexOf('}}', i);
      if (end < 0) throw new Error('占位符没有闭合：' + s.slice(i));
      out.push({ k: 'ph', v: s.slice(i + 2, end).trim() });
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let v = '';
      i++;
      while (i < s.length && s[i] !== c) {
        if (s[i] === '\\' && i + 1 < s.length) { v += s[i + 1]; i += 2; }
        else { v += s[i]; i++; }
      }
      i++;
      out.push({ k: 'str', v });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1]))) {
      let v = '';
      while (i < s.length && /[0-9.]/.test(s[i])) { v += s[i]; i++; }
      out.push({ k: 'num', v: Number(v) });
      continue;
    }
    if (c === '$') {
      i++;
      let name = '';
      while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) { name += s[i]; i++; }
      if (!name) throw new Error('$ 后面缺少变量名');
      const path = [];
      while (i < s.length) {
        if (s[i] === '.' && /[A-Za-z_]/.test(s[i + 1] || '')) {
          i++;
          let p = '';
          while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) { p += s[i]; i++; }
          path.push(p);
        } else if (s[i] === '[') {
          const end = s.indexOf(']', i);
          if (end < 0) throw new Error('[] 没有闭合');
          const inner = s.slice(i + 1, end).trim();
          path.push(/^\d+$/.test(inner) ? Number(inner) : inner.replace(/^['"]|['"]$/g, ''));
          i = end + 1;
        } else break;
      }
      out.push({ k: 'var', name, path });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let name = '';
      while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) { name += s[i]; i++; }
      out.push({ k: 'id', v: name });
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) { out.push({ k: 'op', v: two }); i += 2; continue; }
    if ('+-*/%<>!()[]{}.,:'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    throw new Error(`表达式里有无法识别的字符：${c}`);
  }
  return out;
}

class Expr {
  constructor(tokens) { this.t = tokens; this.p = 0; }

  peek() { return this.t[this.p]; }
  eat(v) {
    const tok = this.t[this.p];
    if (!tok || tok.v !== v || (tok.k !== 'op' && tok.k !== 'id')) throw new Error(`表达式语法错误：期望 ${v}`);
    this.p++;
    return tok;
  }
  accept(v) {
    const tok = this.t[this.p];
    if (tok && tok.k === 'op' && tok.v === v) { this.p++; return true; }
    return false;
  }

  parse() {
    const node = this.or();
    if (this.p < this.t.length) throw new Error(`表达式多出了内容：${this.t.slice(this.p).map((x) => x.v).join(' ')}`);
    return node;
  }

  or() {
    let left = this.and();
    while (this.peek() && this.peek().v === '||') { this.p++; left = { k: 'or', a: left, b: this.and() }; }
    return left;
  }
  and() {
    let left = this.eq();
    while (this.peek() && this.peek().v === '&&') { this.p++; left = { k: 'and', a: left, b: this.eq() }; }
    return left;
  }
  eq() {
    let left = this.rel();
    while (this.peek() && (this.peek().v === '==' || this.peek().v === '!=')) {
      const op = this.t[this.p++].v;
      left = { k: 'cmp', op, a: left, b: this.rel() };
    }
    return left;
  }
  rel() {
    let left = this.add();
    while (this.peek() && ['>', '<', '>=', '<='].includes(this.peek().v)) {
      const op = this.t[this.p++].v;
      left = { k: 'cmp', op, a: left, b: this.add() };
    }
    return left;
  }
  add() {
    let left = this.mul();
    while (this.peek() && (this.peek().v === '+' || this.peek().v === '-')) {
      const op = this.t[this.p++].v;
      left = { k: 'bin', op, a: left, b: this.mul() };
    }
    return left;
  }
  mul() {
    let left = this.unary();
    while (this.peek() && ['*', '/', '%'].includes(this.peek().v)) {
      const op = this.t[this.p++].v;
      left = { k: 'bin', op, a: left, b: this.unary() };
    }
    return left;
  }
  unary() {
    const tok = this.peek();
    if (tok && tok.k === 'op' && (tok.v === '!' || tok.v === '-')) { this.p++; return { k: 'un', op: tok.v, a: this.unary() }; }
    return this.primary();
  }
  primary() {
    const tok = this.peek();
    if (!tok) throw new Error('表达式在这里断了');
    if (tok.k === 'num' || tok.k === 'str') { this.p++; return { k: 'lit', v: tok.v }; }
    if (tok.k === 'ph') { this.p++; return { k: 'ph', v: tok.v }; }
    if (tok.k === 'var') { this.p++; return { k: 'var', name: tok.name, path: tok.path }; }
    if (tok.k === 'id') {
      const name = tok.v;
      if (/^(true|false|null)$/i.test(name)) { this.p++; return { k: 'lit', v: name.toLowerCase() === 'null' ? null : name.toLowerCase() === 'true' }; }
      this.p++;
      if (this.peek() && this.peek().k === 'op' && this.peek().v === '(') {
        this.p++;
        const args = [];
        if (!(this.peek() && this.peek().v === ')')) {
          args.push(this.or());
          while (this.accept(',')) args.push(this.or());
        }
        this.eat(')');
        return { k: 'call', name: name.toUpperCase(), args };
      }
      return { k: 'ident', name };
    }
    if (tok.k === 'op' && tok.v === '(') { this.p++; const e = this.or(); this.eat(')'); return e; }
    if (tok.k === 'op' && tok.v === '[') {
      this.p++;
      const items = [];
      if (!(this.peek() && this.peek().v === ']')) {
        items.push(this.or());
        while (this.accept(',')) items.push(this.or());
      }
      this.eat(']');
      return { k: 'array', items };
    }
    if (tok.k === 'op' && tok.v === '{') {
      this.p++;
      const entries = [];
      if (!(this.peek() && this.peek().v === '}')) {
        entries.push(this.pair());
        while (this.accept(',')) entries.push(this.pair());
      }
      this.eat('}');
      return { k: 'object', entries };
    }
    throw new Error(`表达式语法错误：无法从 ${JSON.stringify(tok.v)} 开始`);
  }
  pair() {
    const keyTok = this.peek();
    let key;
    if (keyTok.k === 'str') { key = keyTok.v; this.p++; }
    else if (keyTok.k === 'id') { key = keyTok.v; this.p++; }
    else if (keyTok.k === 'ph') { key = `__ph__${keyTok.v}`; this.p++; }
    else throw new Error('对象的键必须是字符串或标识符');
    this.eat(':');
    return { key, value: this.or() };
  }
}

function parseExpr(src) {
  return new Expr(lex(src)).parse();
}

/* ---------------- 脚本 ---------------- */

function stripComment(line) {
  const t = String(line);
  if (/^\s*(#|\/\/)/.test(t)) return '';
  return t.replace(/\s+#.*$/, '');
}

function scriptLines(text) {
  return String(text || '').split(/\r?\n/).map(stripComment);
}

function splitStatus(rest) {
  const m = /^(\d{3})\s+(.*)$/.exec(rest);
  if (m) return { status: Number(m[1]), exprText: m[2] };
  return { status: 200, exprText: rest.trim() };
}

function parseScript(text) {
  const lines = scriptLines(text);
  const errors = [];
  let i = 0;

  function parseBlock(stopWords) {
    const body = [];
    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trim();
      if (!line) { i++; continue; }
      const word = (line.match(/^([A-Za-z]+)/) || [])[1] || '';
      const upper = word.toUpperCase();
      if (stopWords.includes(upper) && new RegExp(`^${upper}\\b`, 'i').test(line)) {
        return { body, stop: upper, line };
      }
      try {
        body.push(parseStatement());
      } catch (e) {
        errors.push(`第 ${i + 1} 行：${e.message}（${line.slice(0, 60)}）`);
        i++;
      }
    }
    return { body, stop: null };
  }

  function parseStatement() {
    const raw = lines[i];
    const line = raw.trim();
    const upper = ((line.match(/^([A-Za-z]+)/) || [])[1] || '').toUpperCase();

    if (upper === 'IF' || upper === 'ELSEIF') {
      const condText = line.replace(/^(IF|ELSEIF)\s*/i, '');
      i++;
      const branches = [];
      let cond = condText;
      let blk = parseBlock(['ELSEIF', 'ELSE', 'END']);
      branches.push({ cond: parseExpr(cond), body: blk.body });
      while (blk.stop === 'ELSEIF') {
        const next = blk.line.replace(/^ELSEIF\s*/i, '');
        i++;
        blk = parseBlock(['ELSEIF', 'ELSE', 'END']);
        branches.push({ cond: parseExpr(next), body: blk.body });
      }
      let elseBody = null;
      if (blk.stop === 'ELSE') {
        i++;
        blk = parseBlock(['END']);
        elseBody = blk.body;
      }
      if (blk.stop !== 'END') throw new Error('IF 缺少 END');
      i++;
      return { k: 'if', branches, elseBody };
    }

    if (upper === 'FOREACH') {
      const m = /^FOREACH\s+\$([A-Za-z0-9_]+)\s+IN\s+(.+)$/i.exec(line);
      if (!m) throw new Error('FOREACH 写法：FOREACH $row IN $rows.rows');
      i++;
      const blk = parseBlock(['END']);
      if (blk.stop !== 'END') throw new Error('FOREACH 缺少 END');
      i++;
      return { k: 'foreach', name: m[1], expr: parseExpr(m[2]), body: blk.body };
    }

    if (/^(LET|SET)\s+\$/i.test(line)) {
      const m = /^(LET|SET)\s+(\$[A-Za-z0-9_]+)\s*=\s*([\s\S]+?)\s*;?\s*$/i.exec(line);
      if (!m) throw new Error('LET 写法：LET $x = QUERY ... ;');
      const rhs = m[3];
      const qm = /^(QUERY|EXEC)\s+([\s\S]+?)\s*;?\s*$/i.exec(rhs);
      if (qm) {
        i++;
        return { k: 'let', name: m[2].replace(/^\$/, ''), from: qm[1].toUpperCase() === 'QUERY' ? 'query' : 'exec', sql: qm[2] };
      }
      const tok = /^TOKEN\s+(NEW|GET)\s+([\s\S]+?)\s*;?\s*$/i.exec(rhs);
      if (tok) {
        i++;
        return { k: 'let', name: m[2].replace(/^\$/, ''), from: 'token', action: tok[1].toUpperCase(), expr: parseExpr(tok[2]) };
      }
      const hm = /^HTTP\s+(GET|POST|PUT|DELETE)\s+'([^']+)'\s*(.*?)\s*;?\s*$/i.exec(rhs);
      if (hm) {
        i++;
        return { k: 'let', name: m[2].replace(/^\$/, ''), from: 'http', method: hm[1].toUpperCase(), url: hm[2], bodyText: (hm[3] || '').trim() };
      }
      i++;
      return { k: 'let', name: m[2].replace(/^\$/, ''), expr: parseExpr(rhs.replace(/;\s*$/, '')) };
    }

    if (upper === 'QUERY' || upper === 'EXEC') {
      const sql = line.replace(/^(QUERY|EXEC)\s+/i, '').replace(/;\s*$/, '');
      i++;
      return { k: 'sql', mode: upper, sql };
    }

    if (upper === 'RETURN') {
      const rest = line.replace(/^RETURN\s*/i, '').replace(/;\s*$/, '');
      i++;
      if (!rest) return { k: 'return', status: 200, expr: null };
      const st = splitStatus(rest);
      return { k: 'return', status: st.status, expr: st.exprText ? parseExpr(st.exprText) : null };
    }

    if (upper === 'LOG') {
      const rest = line.replace(/^LOG\s*/i, '').replace(/;\s*$/, '');
      const lm = /^(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\s+([\s\S]+)$/i.exec(rest);
      i++;
      if (lm) return { k: 'log', level: lm[1].toUpperCase(), expr: parseExpr(lm[2]) };
      return { k: 'log', level: 'INFO', expr: parseExpr(rest) };
    }

    // 事务：TX BEGIN / COMMIT / ROLLBACK（服务器按路由自动开事务时也能手动提前提交）
    if (upper === 'TX') {
      const m = /^TX\s+(BEGIN|COMMIT|ROLLBACK)\b/i.exec(line);
      if (!m) throw new Error('TX 写法：TX BEGIN / TX COMMIT / TX ROLLBACK');
      i++;
      return { k: 'tx', action: m[1].toUpperCase() };
    }

    // 服务间调用：LET $x = HTTP GET 'http://127.0.0.1:18101/api/x' {json};
    {
      const hm = /^(LET|SET)\s+(\$[A-Za-z0-9_]+)\s*=\s*HTTP\s+(GET|POST|PUT|DELETE)\s+'([^']+)'\s*(.*?)\s*;\s*$/i.exec(line);
      if (hm) {
        i++;
        return {
          k: 'let', name: hm[2].replace(/^\$/, ''), from: 'http',
          method: hm[3].toUpperCase(), url: hm[4],
          bodyText: (hm[5] || '').trim(),
        };
      }
    }

    // Redis 发布（微服务之间默认用 Redis 通信）：PUBLISH 'orders:new' {json};
    if (upper === 'PUBLISH') {
      const m = /^PUBLISH\s+'([^']+)'\s+([\s\S]+?)\s*;?\s*$/i.exec(line);
      if (!m) throw new Error("PUBLISH 写法：PUBLISH '频道' {json};");
      i++;
      return { k: 'publish', channel: m[1], expr: parseExpr(m[2]) };
    }

    // 账号：LET $t = TOKEN NEW {user}; / LET $u = TOKEN GET $token; / TOKEN DEL $token;
    {
      const tm = /^(LET|SET)\s+(\$[A-Za-z0-9_]+)\s*=\s*TOKEN\s+(NEW|GET)\s+([\s\S]+?)\s*;\s*$/i.exec(line);
      if (tm) {
        i++;
        return { k: 'let', name: tm[2].replace(/^\$/, ''), from: 'token', action: tm[3].toUpperCase(), expr: parseExpr(tm[4]) };
      }
      const td = /^TOKEN\s+DEL\s+([\s\S]+?)\s*;\s*$/i.exec(line);
      if (td) { i++; return { k: 'tokenDel', expr: parseExpr(td[1]) }; }
    }

    throw new Error(`不认识的语句：${line.slice(0, 60)}`);
  }

  const root = parseBlock([]);
  if (root.stop) errors.push(`多余的 ${root.stop}`);
  return { ast: root.body, errors };
}

/* ---------------- 求值 ---------------- */

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return !!v && v !== 0 && v !== '';
}

function walkVar(env, name, path) {
  let cur = env.vars[name];
  for (const p of path || []) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur == null ? null : cur;
}

function evalExpr(node, env) {
  switch (node.k) {
    case 'lit': return node.v;
    case 'ph': {
      const v = render.valueOf(node.v, env.ctx, env.iface);
      return v == null ? null : v;
    }
    case 'var': return walkVar(env, node.name, node.path);
    case 'ident': {
      if (env.idents && Object.prototype.hasOwnProperty.call(env.idents, node.name)) return env.idents[node.name];
      throw new Error(`表达式里的 ${node.name} 既不是 $变量，也不是函数调用；自定义函数参数可以直接写名字`);
    }
    case 'array': return node.items.map((x) => evalExpr(x, env));
    case 'object': {
      const out = {};
      for (const e of node.entries) {
        const key = e.key.startsWith('__ph__') ? String(evalExpr({ k: 'ph', v: e.key.slice(6) }, env)) : e.key;
        out[key] = evalExpr(e.value, env);
      }
      return out;
    }
    case 'un': return node.op === '!' ? !truthy(evalExpr(node.a, env)) : -Number(evalExpr(node.a, env));
    case 'and': return truthy(evalExpr(node.a, env)) && truthy(evalExpr(node.b, env));
    case 'or': return truthy(evalExpr(node.a, env)) || truthy(evalExpr(node.b, env));
    case 'cmp': {
      const a = evalExpr(node.a, env);
      const b = evalExpr(node.b, env);
      switch (node.op) {
        case '==': return a == b; // eslint-disable-line eqeqeq
        case '!=': return a != b; // eslint-disable-line eqeqeq
        case '>': return Number(a) > Number(b);
        case '<': return Number(a) < Number(b);
        case '>=': return Number(a) >= Number(b);
        case '<=': return Number(a) <= Number(b);
        default: return false;
      }
    }
    case 'bin': {
      const a = evalExpr(node.a, env);
      const b = evalExpr(node.b, env);
      if (node.op === '+') {
        if (typeof a === 'string' || typeof b === 'string') return String(a == null ? '' : a) + String(b == null ? '' : b);
        return Number(a) + Number(b);
      }
      if (node.op === '-') return Number(a) - Number(b);
      if (node.op === '*') return Number(a) * Number(b);
      if (node.op === '/') return Number(b) === 0 ? null : Number(a) / Number(b);
      if (node.op === '%') return Number(b) === 0 ? null : Number(a) % Number(b);
      return null;
    }
    case 'call': return callFn(node.name, node.args, env);
    default: throw new Error('未知表达式节点：' + node.k);
  }
}

function callFn(name, argNodes, env) {
  const args = argNodes.map((x) => evalExpr(x, env));
  if (env.customFuncs && env.customFuncs[name]) {
    const def = env.customFuncs[name];
    const idents = {};
    def.params.forEach((p, idx) => { idents[p] = args[idx]; });
    return evalExpr(def.ast, { ...env, idents });
  }
  return funcs.call(name, args);
}

/* --------- SQL 里的扩展函数：执行前在本地算掉 ---------
   MariaDB 没有 HASH/SM4 这些函数，所以把 HASH('sha256', ?) 这类调用
   在发给数据库之前替换成一个 ?，并把算出来的值塞进参数列表。 */
// 数据库没有这些函数，必须在本地先算掉；其余交给 SQL 原生函数（LEFT/RIGHT/IN 等）
const SQL_EXPAND = ['HASH', 'SM3', 'SM4_ENC', 'SM4_DEC', 'MASK', 'URL_ENC', 'URL_DEC', 'RAND_INT'];

function isKnownSqlFunc(name, env) {
  if (!name) return false;
  const up = name.toUpperCase();
  if (SQL_EXPAND.includes(up)) return true;
  if (env.customFuncs && Object.prototype.hasOwnProperty.call(env.customFuncs, name)) return true;
  return false;
}

function splitArgs(text) {
  const out = [];
  let depth = 0; let cur = ''; let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === quote) {
        if (text[i + 1] === quote) { cur += text[i + 1]; i++; } else quote = null;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function literalValue(arg) {
  const t = arg.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).replace(/''/g, "'").replace(/""/g, '"');
  }
  if (t.toUpperCase() === 'NULL') return null;
  if (t.toUpperCase() === 'TRUE') return true;
  if (t.toUpperCase() === 'FALSE') return false;
  throw new Error(`SQL 函数参数只支持 ?、字符串、数字、NULL：${arg}`);
}

function expandSqlFunctions(sql, params, env) {
  const src = String(sql || '');
  let out = '';
  const args = Array.isArray(params) ? params.slice() : [];
  let pi = 0;
  const outParams = [];
  let i = 0;
  const readIdent = (at) => {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(at));
    return m ? m[0] : null;
  };
  const findClose = (openAt) => {
    let depth = 0; let quote = null;
    for (let k = openAt; k < src.length; k++) {
      const c = src[k];
      if (quote) {
        if (c === quote) {
          if (src[k + 1] === quote) k++; else quote = null;
        }
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) return k; }
    }
    return -1;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === c) {
          if (src[j + 1] === c) { j += 2; continue; }
          break;
        }
        if (src[j] === '\\' && c !== '`') { j += 2; continue; }
        j++;
      }
      out += src.slice(i, Math.min(j + 1, src.length));
      i = Math.min(j + 1, src.length);
      continue;
    }
    if (c === '?') { out += '?'; outParams.push(args[pi++]); i++; continue; }
    const ident = readIdent(i);
    if (ident) {
      let after = i + ident.length;
      while (src[after] === ' ' || src[after] === '\t') after++;
      if (src[after] === '(' && isKnownSqlFunc(ident, env)) {
        const close = findClose(after);
        if (close < 0) throw new Error(`SQL 函数 ${ident} 括号没闭合`);
        const inner = src.slice(after + 1, close);
        const rawArgs = inner.trim() === '' ? [] : splitArgs(inner);
        const vals = rawArgs.map((a) => {
          if (a === '?') {
            if (pi >= args.length) throw new Error(`SQL 函数 ${ident} 的参数比提供的值多`);
            return args[pi++];
          }
          return literalValue(a);
        });
        let value;
        try {
          value = callFn(ident, vals.map((v) => ({ k: 'lit', v })), env);
        } catch (e) {
          throw new Error(`SQL 函数 ${ident} 执行失败：${e.message}`);
        }
        out += '?';
        outParams.push(value);
        i = close + 1;
        continue;
      }
      out += ident;
      i += ident.length;
      continue;
    }
    out += c;
    i++;
  }
  return { sql: out, params: outParams };
}

async function runScript(ast, env) {
  let steps = 0;
  const logs = [];
  let result = null;

  async function execBlock(list, scope) {
    for (const st of list) {
      if (++steps > 5000) throw new Error('脚本执行步数超限（5000），检查一下循环');
      const r = await execStatement(st, scope);
      if (r && r.k === 'return') return r;
    }
    return null;
  }

  async function execStatement(st, scope) {
    if (env.ctx) {
      env.ctx.vars = scope.vars || {};
      env.ctx.last = scope.last || null;
    }
    if (st.k === 'let') {
      if (st.from === 'query' || st.from === 'exec') {
        const built = render.renderSqlText(st.sql, env.iface, env.ctx);
        const x = expandSqlFunctions(built.sql, built.params, env);
        scope.vars[st.name] = st.from === 'query'
          ? { rows: await env.db.query(x.sql, x.params), sql: x.sql, params: x.params }
          : { ...(await env.db.execute(x.sql, x.params)), sql: x.sql, params: x.params };
        scope.last = scope.vars[st.name];
      } else if (st.from === 'http') {
        if (typeof env.http !== 'function') throw new Error('HTTP 调用没有可用的执行器');
        const url = render.renderText(st.url, env.iface, env.ctx);
        const body = st.bodyText ? evalExpr(st.expr ? st.expr : parseExpr(st.bodyText), scope) : null;
        const r = await env.http(st.method, url, body);
        scope.vars[st.name] = r;
      } else if (st.from === 'token') {
        if (!env.token) throw new Error('TOKEN 没有可用的会话存储');
        const arg = evalExpr(st.expr, scope);
        scope.vars[st.name] = st.action === 'NEW' ? await env.token.mint(arg) : await env.token.get(arg);
      } else {
        scope.vars[st.name] = evalExpr(st.expr, scope);
      }
      return null;
    }
    if (st.k === 'sql') {
      const built = render.renderSqlText(st.sql, env.iface, env.ctx);
      const x = expandSqlFunctions(built.sql, built.params, env);
      scope.last = st.mode === 'query'
        ? { rows: await env.db.query(x.sql, x.params) }
        : await env.db.execute(x.sql, x.params);
      return null;
    }
    if (st.k === 'tx') {
      if (!env.db.tx) throw new Error('当前连接不支持事务');
      const r = await env.db.tx(st.action);
      logs.push({ level: 'INFO', message: `TX ${st.action}`, data: r || null });
      return null;
    }
    if (st.k === 'publish') {
      if (!env.publish) throw new Error('没有可用的 Redis 发布器');
      await env.publish(st.channel, evalExpr(st.expr, scope));
      logs.push({ level: 'INFO', message: `PUBLISH ${st.channel}` });
      return null;
    }
    if (st.k === 'tokenDel') {
      if (env.token && env.token.del) await env.token.del(evalExpr(st.expr, scope));
      return null;
    }
    if (st.k === 'if') {
      for (const br of st.branches) {
        if (truthy(evalExpr(br.cond, scope))) {
          const r = await execBlock(br.body, scope);
          if (r) return r;
          return null;
        }
      }
      if (st.elseBody) {
        const r = await execBlock(st.elseBody, scope);
        if (r) return r;
      }
      return null;
    }
    if (st.k === 'foreach') {
      const list = evalExpr(st.expr, scope);
      const arr = Array.isArray(list) ? list : (list && Array.isArray(list.rows) ? list.rows : []);
      const count = Math.min(arr.length, 500);
      for (let n = 0; n < count; n++) {
        scope.vars[st.name] = arr[n];
        const r = await execBlock(st.body, scope);
        if (r) return r;
      }
      return null;
    }
    if (st.k === 'log') {
      logs.push({ level: st.level || 'INFO', message: String(evalExpr(st.expr, scope)) });
      return null;
    }
    if (st.k === 'return') {
      result = { status: st.status, body: st.expr ? evalExpr(st.expr, scope) : null };
      return { k: 'return' };
    }
    throw new Error('未知语句：' + st.k);
  }

  const scope = { ...env, vars: env.vars || {}, last: null };
  const r = await execBlock(ast, scope);
  if (!result) result = { status: 200, body: scope.last || null };
  return { ...result, logs, vars: scope.vars };
}

/* ---------------- 校验 ---------------- */

function checkScript(text) {
  const { errors } = parseScript(text);
  const problems = errors.slice();
  const re = /\{\{\s*([A-Za-z0-9_.:]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const token = m[1];
    const base = render.splitToken(token)[0];
    if (render.STRUCT.has(base) || render.VALUES.has(token)) continue;
    if (/^(query|body|path|file|vars|user|token|env|req)\.[A-Za-z0-9_]+/.test(token)) continue;
    problems.push(`未知占位符：{{${token}}}`);
  }
  return { ok: problems.length === 0, problems };
}

/* ---------------- 转 JS（导出用） ---------------- */

function exprToJs(node) {
  switch (node.k) {
    case 'lit': return JSON.stringify(node.v);
    case 'ph': return `V('${node.v}', ctx)`;
    case 'var': return `$${node.name}${(node.path || []).map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)).join('')}`;
    case 'ident': return node.name;
    case 'array': return `[${node.items.map(exprToJs).join(', ')}]`;
    case 'object': return `{ ${node.entries.map((e) => `${JSON.stringify(e.key)}: ${exprToJs(e.value)}`).join(', ')} }`;
    case 'un': return `(${node.op}${exprToJs(node.a)})`;
    case 'and': return `(${exprToJs(node.a)} && ${exprToJs(node.b)})`;
    case 'or': return `(${exprToJs(node.a)} || ${exprToJs(node.b)})`;
    case 'cmp': return `(${exprToJs(node.a)} ${node.op} ${exprToJs(node.b)})`;
    case 'bin': return `(${exprToJs(node.a)} ${node.op} ${exprToJs(node.b)})`;
    case 'call': return `F('${node.name}', [${node.args.map(exprToJs).join(', ')}])`;
    default: return 'null';
  }
}

function scriptToJs(ast, indent) {
  const pad = '  '.repeat(indent || 0);
  return ast.map((st) => {
    if (st.k === 'let' && st.from === 'query') return `${pad}const $${st.name.replace('$', '')} = await Q('${String(st.sql).replace(/'/g, "\\'").replace(/\n/g, ' ')}', ctx);`;
    if (st.k === 'let' && st.from === 'exec') return `${pad}const $${st.name.replace('$', '')} = await X('${String(st.sql).replace(/'/g, "\\'").replace(/\n/g, ' ')}', ctx);`;
    if (st.k === 'let' && st.from === 'http') return `${pad}const $${st.name.replace('$', '')} = await H('${st.method}', '${st.url}', ${st.bodyText ? exprToJs(parseExpr(st.bodyText)) : 'null'}, ctx);`;
    if (st.k === 'let' && st.from === 'token') return `${pad}const $${st.name.replace('$', '')} = await T('${st.action}', ${exprToJs(st.expr)}, ctx);`;
    if (st.k === 'let') return `${pad}const $${st.name.replace('$', '')} = ${exprToJs(st.expr)};`;
    if (st.k === 'sql') return `${pad}${st.mode === 'query' ? 'await Q' : 'await X'}('${st.sql.replace(/'/g, "\\'").replace(/\n/g, ' ')}', ctx);`;
    if (st.k === 'tx') return `${pad}await TX('${st.action}', ctx);`;
    if (st.k === 'publish') return `${pad}await P('${st.channel}', ${exprToJs(st.expr)}, ctx);`;
    if (st.k === 'tokenDel') return `${pad}await TD(${exprToJs(st.expr)}, ctx);`;
    if (st.k === 'if') {
      const parts = st.branches.map((b, n) => `${n === 0 ? 'if' : '} else if'} (${exprToJs(b.cond)}) {\n${scriptToJs(b.body, (indent || 0) + 1)}\n${pad}}`);
      if (st.elseBody) parts.push(`else {\n${scriptToJs(st.elseBody, (indent || 0) + 1)}\n${pad}}`);
      return pad + parts.join(' ');
    }
    if (st.k === 'foreach') return `${pad}for (const ${st.name} of toList(${exprToJs(st.expr)})) {\n${scriptToJs(st.body, (indent || 0) + 1)}\n${pad}}`;
    if (st.k === 'log') return `${pad}L('${st.level || 'INFO'}', ${exprToJs(st.expr)}, ctx);`;
    if (st.k === 'return') return `${pad}return { status: ${st.status}, body: ${st.expr ? exprToJs(st.expr) : 'null'} };`;
    return `${pad}// 未知语句`;
  }).join('\n');
}

module.exports = { parseScript, parseExpr, runScript, checkScript, scriptToJs, exprToJs, evalExpr, expandSqlFunctions };
