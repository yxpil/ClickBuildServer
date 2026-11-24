// 作者：yxpil
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

function scriptLines(text) {
  // 逐行去注释，但保留 /* ... */ 跨行状态；注释里的行号不会挪动。
  let block = false;
  return String(text || '').split(/\r?\n/).map((line) => {
    const s = String(line);
    let out = '';
    let quote = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      const n = s[i + 1];
      if (block) {
        if (c === '*' && n === '/') { block = false; i++; }
        continue;
      }
      if (quote) {
        out += c;
        if (c === '\\' && i + 1 < s.length) { out += s[++i]; continue; }
        if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'") { quote = c; out += c; continue; }
      if (c === '/' && n === '/') break;
      if (c === '/' && n === '*') { block = true; i++; continue; }
      if (c === '#') break;
      out += c;
    }
    return out;
  });
}

function splitStatus(rest) {
  const m = /^(\d{3})\s+(.*)$/.exec(rest);
  if (m) return { status: Number(m[1]), exprText: m[2] };
  return { status: 200, exprText: rest.trim() };
}

// 3xx 的响应体只要带这些字段，就自动变成 Location，脚本不用记新的语法。
function redirectTarget(body) {
  if (typeof body === 'string') return body.trim();
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  for (const key of ['location', 'Location', 'LOCATION', 'redirect', 'redirectUrl', 'url']) {
    const value = body[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

// 把脚本返回体整理成“响应体 + 响应头”，运行时和导出 JS 共用同一套规则。
function responseMeta(status, body) {
  const headers = {};
  let value = body;
  if (value && typeof value === 'object' && !Array.isArray(value) && value.__headers && typeof value.__headers === 'object' && !Array.isArray(value.__headers)) {
    Object.assign(headers, value.__headers);
    value = { ...value };
    delete value.__headers;
  }
  if (status >= 300 && status < 400 && status !== 304) {
    const location = redirectTarget(value);
    if (location && !Object.keys(headers).some((key) => key.toLowerCase() === 'location')) headers.Location = location;
  }
  return { status, body: value, headers };
}

function diagHint(message) {
  const m = String(message || '');
  if (/缺少 END/.test(m)) return '在这个 IF / FOREACH / FOR / WHILE / SWITCH 结束的位置补一行 END';
  if (/占位符没有闭合/.test(m)) return '写成 {{body.name}} 或 {{query.id}}，补全后面的 }}';
  if (/不认识的语句/.test(m)) return '语句必须以 LET / SET / ASSIGN / INC / APPEND / QUERY / EXEC / IF / FOREACH / FOR / WHILE / SWITCH / FUNC / RUN / RETURN / LOG / WAIT / TX / TOKEN / PUBLISH 开头';
  if (/表达式语法错误|表达式多出了内容|表达式在这里断了/.test(m)) return '检查括号、逗号、运算符和字符串引号是否成对';
  if (/变量未赋值/.test(m)) return '先在这一行之前用 LET $name = ... 赋值';
  if (/已赋值但未使用/.test(m)) return '不需要这个变量就删掉；需要排查就加 LOG DEBUG $name;';
  if (/未知占位符/.test(m)) return '可用 {{body.x}}、{{query.x}}、{{path.x}}、{{header.authorization}}、{{t:主表}} 等，参考右侧脚本助手';
  if (/对象占位符/.test(m)) return '对象占位符要取字段，例如 {{user.username}}，不要直接写 {{user}}';
  return '按提示修正这一行，保存前会持续自动检查';
}
function diagCode(message) {
  const m = String(message || '');
  if (/缺少 END/.test(m)) return 'MISSING_END';
  if (/占位符没有闭合/.test(m)) return 'UNCLOSED_PLACEHOLDER';
  if (/不认识的语句/.test(m)) return 'UNKNOWN_STATEMENT';
  if (/未知占位符/.test(m)) return 'UNKNOWN_PLACEHOLDER';
  if (/对象占位符/.test(m)) return 'OBJECT_PLACEHOLDER';
  if (/变量未赋值/.test(m)) return 'UNDEFINED_VARIABLE';
  if (/已赋值但未使用/.test(m)) return 'UNUSED_VARIABLE';
  return 'SYNTAX';
}
function firstColumn(line) {
  const i = String(line || '').search(/\S/);
  return i < 0 ? 1 : i + 1;
}
function spanEnd(line, column) {
  const text = String(line || '');
  const start = Math.max(0, (column || 1) - 1);
  const rest = text.slice(start);
  if (rest.startsWith('{{')) {
    const end = rest.indexOf('}}');
    return end < 0 ? text.length + 1 : start + end + 3;
  }
  if (rest.startsWith('$')) {
    const m = /^\$[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*|\s*\[[^\]]*\])*/.exec(rest);
    return start + (m ? m[0].length : 1) + 1;
  }
  if (rest.startsWith('"') || rest.startsWith("'")) {
    const q = rest[0];
    let i = 1;
    while (i < rest.length) {
      if (rest[i] === '\\') { i += 2; continue; }
      if (rest[i] === q) return start + i + 2;
      i++;
    }
    return text.length + 1;
  }
  const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
  if (m) return start + m[0].length + 1;
  return Math.min(text.length + 1, start + 2);
}
function throwAt(message, line, column, endColumn) {
  const e = new Error(message);
  e.line = line;
  e.column = column;
  e.endColumn = endColumn;
  return e;
}

function parseScript(text) {
  const lines = scriptLines(text);
  const errors = [];
  const diagnostics = [];
  let i = 0;
  const statementStart = /^(LET|SET|ASSIGN|INC|DEC|APPEND|PUSH|QUERY|EXEC|IF|ELSEIF|ELSE|END|FOREACH|FOR|WHILE|BREAK|CONTINUE|SWITCH|CASE|DEFAULT|FUNC|FUNCTION|RUN|INVOKE|RETURN|LOG|WAIT|THROW|TX|PUBLISH|TOKEN)\b/i;

  // 允许把一条 SQL / JSON 排成多行：只有下一行不是新语句时才续行，行号仍从语句首行算。
  function joinContinuation(line) {
    let out = line;
    while (!/;\s*$/.test(out) && i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (!next || statementStart.test(next)) break;
      i++;
      out += ' ' + next;
    }
    return out;
  }

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
        const ln = e.line || i + 1;
        const col = e.column || firstColumn(lines[ln - 1]);
        const msg = e.message;
        errors.push(`第 ${ln} 行：${msg}（${String(lines[ln - 1] || '').trim().slice(0, 60)}）`);
        diagnostics.push({ line: ln, column: col, endColumn: e.endColumn || undefined, severity: 'error', code: diagCode(msg), message: msg, hint: diagHint(msg) });
        i++;
      }
    }
    return { body, stop: null };
  }

  function parseStatement() {
    const startLine = i + 1;
    const startColumn = firstColumn(lines[i]);
    try {
      return parseStatementInner();
    } catch (e) {
      if (!e.line) e.line = startLine;
      if (!e.column) e.column = startColumn;
      throw e;
    }
  }

  function parseStatementInner() {
    const raw = lines[i];
    let line = raw.trim();
    const upper = ((line.match(/^([A-Za-z]+)/) || [])[1] || '').toUpperCase();
    if (/^(LET|SET|ASSIGN|INC|DEC|APPEND|PUSH|QUERY|EXEC|RETURN|LOG|WAIT|PUBLISH|TOKEN|THROW|RUN|INVOKE)\b/i.test(upper)) line = joinContinuation(line);

    // SQL 只能出现在 QUERY / EXEC 后面。把裸 SQL 开头的行直接指出来，
    // 避免 SELECT / UPDATE 被当成“自定义语句”吞掉，或者反过来把自定义关键字当 SQL。
    if (/^(SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|SHOW|DESCRIBE|EXPLAIN|WITH|GRANT|REVOKE|USE|LOCK|UNLOCK|ANALYZE|OPTIMIZE|RENAME|BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|CALL|EXECUTE|PREPARE|DEALLOCATE)\b/i.test(line)
      || (/^SET\s+/i.test(line) && !/^(SET)\s+\$/i.test(line))) {
      throw new Error('SQL 语句不能裸写：前面加 QUERY（要结果集）或 EXEC（执行写入），自定义语句只认 LET / SET / ASSIGN / IF / FOR / WHILE 等关键字');
    }

    if (upper === 'IF' || upper === 'ELSEIF') {
      const startLine = i + 1;
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
      if (blk.stop !== 'END') throw throwAt('IF 缺少 END', startLine, 1, String(lines[startLine - 1] || '').trimEnd().length + 1);
      i++;
      return { k: 'if', branches, elseBody };
    }

    if (upper === 'FOREACH') {
      const startLine = i + 1;
      const m = /^FOREACH\s+\$([A-Za-z0-9_]+)\s+IN\s+(.+)$/i.exec(line);
      if (!m) throw new Error('FOREACH 写法：FOREACH $row IN $rows.rows');
      i++;
      const blk = parseBlock(['END']);
      if (blk.stop !== 'END') throw throwAt('FOREACH 缺少 END', startLine, 1, String(lines[startLine - 1] || '').trimEnd().length + 1);
      i++;
      return { k: 'foreach', name: m[1], expr: parseExpr(m[2]), body: blk.body };
    }

    // 数字循环：FOR $i = 1 TO 10 STEP 2 ... END / FOR $i = 10 DOWNTO 1 ... END
    if (upper === 'FOR') {
      const startLine = i + 1;
      const m = /^FOR\s+\$([A-Za-z0-9_]+)\s*=\s*([\s\S]+?)\s+(TO|DOWNTO)\s+([\s\S]+?)(?:\s+STEP\s+([\s\S]+?))?\s*;?\s*$/i.exec(line);
      if (!m) throw new Error('FOR 写法：FOR $i = 1 TO 10 STEP 2 ... END');
      i++;
      const blk = parseBlock(['END']);
      if (blk.stop !== 'END') throw throwAt('FOR 缺少 END', startLine, 1, String(lines[startLine - 1] || '').trimEnd().length + 1);
      i++;
      return {
        k: 'for', name: m[1], from: parseExpr(m[2]), to: parseExpr(m[4]),
        direction: m[3].toUpperCase() === 'DOWNTO' ? -1 : 1,
        step: m[5] ? parseExpr(m[5]) : null, body: blk.body,
      };
    }

    // 条件循环：WHILE 条件 ... END
    if (upper === 'WHILE') {
      const startLine = i + 1;
      const cond = line.replace(/^WHILE\s*/i, '').replace(/;\s*$/, '').trim();
      if (!cond) throw new Error('WHILE 写法：WHILE $i < 10 ... END');
      i++;
      const blk = parseBlock(['END']);
      if (blk.stop !== 'END') throw throwAt('WHILE 缺少 END', startLine, 1, String(lines[startLine - 1] || '').trimEnd().length + 1);
      i++;
      return { k: 'while', cond: parseExpr(cond), body: blk.body };
    }

    // 多分支选择：SWITCH 表达式 / CASE 1,2 / DEFAULT / END
    if (upper === 'SWITCH') {
      const startLine = i + 1;
      const switchText = line.replace(/^SWITCH\s*/i, '').replace(/;\s*$/, '').trim();
      if (!switchText) throw new Error('SWITCH 写法：SWITCH $x / CASE 1 / DEFAULT / END');
      i++;
      const cases = [];
      let defaultBody = null;
      let blk = parseBlock(['CASE', 'DEFAULT', 'END']);
      while (blk.stop === 'CASE' || blk.stop === 'DEFAULT') {
        if (blk.stop === 'CASE') {
          const caseText = blk.line.replace(/^CASE\s*/i, '').replace(/;\s*$/, '').trim();
          if (!caseText) throw new Error('CASE 写法：CASE 1, 2 或 CASE \'paid\'');
          i++;
          const bodyBlk = parseBlock(['CASE', 'DEFAULT', 'END']);
          cases.push({ values: splitArgs(caseText).map((x) => parseExpr(x)), body: bodyBlk.body });
          blk = bodyBlk;
        } else {
          i++;
          const bodyBlk = parseBlock(['END']);
          defaultBody = bodyBlk.body;
          blk = bodyBlk;
        }
      }
      if (blk.stop !== 'END') throw throwAt('SWITCH 缺少 END', startLine, 1, String(lines[startLine - 1] || '').trimEnd().length + 1);
      i++;
      return { k: 'switch', expr: parseExpr(switchText), cases, defaultBody };
    }

    // 纯表达式函数：FUNC 名($a, $b) = $a + $b;  只做表达式，不做异步 SQL，避免和路由 RETURN 冲突。
    if (upper === 'FUNC' || upper === 'FUNCTION') {
      const m = /^(FUNC|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*=\s*([\s\S]+?)\s*;?\s*$/i.exec(line);
      if (!m) throw new Error('FUNC 写法：FUNC 名称($a, $b) = 表达式;');
      const params = m[3].trim() ? splitArgs(m[3]).map((x) => x.replace(/^\$/, '').trim()) : [];
      if (params.some((x) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(x))) throw new Error('FUNC 参数只能写成 $name');
      i++;
      return { k: 'func', name: m[2].toUpperCase(), params, expr: parseExpr(m[4].replace(/;\s*$/, '')) };
    }

    // 赋值：ASSIGN $x = 1; / $x = 1; / $x += 1; / SET $x -= 1;
    {
      const am = /^(ASSIGN\s+)?\$([A-Za-z0-9_]+)\s*(=|\+=|-=|\*=|\/=)\s*([\s\S]+?)\s*;?\s*$/i.exec(line);
      if (am && (upper === 'ASSIGN' || !upper)) {
        i++;
        return { k: 'assign', name: am[2], op: am[3], expr: parseExpr(am[4]) };
      }
    }

    // 自增/自减：INC $n; / INC $n BY 2; / DEC $n;
    if (upper === 'INC' || upper === 'DEC') {
      const m = /^(INC|DEC)\s+\$([A-Za-z0-9_]+)(?:\s+BY\s+([\s\S]+?))?\s*;?\s*$/i.exec(line);
      if (!m) throw new Error(`${upper} 写法：INC $n; / INC $n BY 2; / DEC $n;`);
      i++;
      return { k: 'assign', name: m[2], op: upper === 'INC' ? '+=' : '-=', expr: m[3] ? parseExpr(m[3]) : { k: 'lit', v: 1 } };
    }

    // 追加数组元素：APPEND $list, 值; / PUSH $list, 值;
    if (upper === 'APPEND' || upper === 'PUSH') {
      const m = /^(APPEND|PUSH)\s+\$([A-Za-z0-9_]+)\s*,\s*([\s\S]+?)\s*;?\s*$/i.exec(line);
      if (!m) throw new Error(`${upper} 写法：APPEND $list, 值;`);
      i++;
      return { k: 'append', name: m[2], expr: parseExpr(m[3]) };
    }

    if (upper === 'BREAK' || upper === 'CONTINUE') {
      i++;
      return { k: upper.toLowerCase() };
    }

    // 调用函数并丢弃返回值（只调用表达式函数，SQL 存储过程仍走 EXEC）
    if (upper === 'RUN' || upper === 'INVOKE') {
      const m = /^(RUN|INVOKE)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*;?\s*$/i.exec(line);
      if (!m) throw new Error(`${upper} 写法：RUN 函数名(参数);`);
      const args = m[3].trim() ? splitArgs(m[3]).map((x) => parseExpr(x)) : [];
      i++;
      return { k: 'run', name: m[2].toUpperCase(), args };
    }

    if (upper === 'THROW') {
      const rest = line.replace(/^THROW\s*/i, '').replace(/;\s*$/, '').trim();
      if (!rest) throw new Error('THROW 写法：THROW \'错误信息\';');
      i++;
      return { k: 'throw', expr: parseExpr(rest) };
    }

    if (/^(LET|SET)\s+\$/i.test(line)) {
      const m = /^(LET|SET)\s+(\$[A-Za-z0-9_]+)\s*(=|\+=|-=|\*=|\/=)\s*([\s\S]+?)\s*;?\s*$/i.exec(line);
      if (!m) throw new Error('LET 写法：LET $x = QUERY ... ;');
      if (m[3] !== '=') {
        i++;
        return { k: 'assign', name: m[2].replace(/^\$/, ''), op: m[3], expr: parseExpr(m[4]) };
      }
      const rhs = m[4];
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
      const cm = /^CRAWL\s+'([^']+)'\s*(.*?)\s*;?\s*$/i.exec(rhs);
      if (cm) {
        i++;
        return { k: 'let', name: m[2].replace(/^\$/, ''), from: 'crawl', url: cm[1], optionsText: (cm[2] || '').trim() };
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

    // 延时等待：WAIT 500;（毫秒，最长 60 秒）
    if (upper === 'WAIT') {
      const rest = line.replace(/^WAIT\s*/i, '').replace(/;\s*$/, '').trim();
      if (!rest) throw new Error('WAIT 写法：WAIT 500;（毫秒）');
      i++;
      return { k: 'wait', expr: parseExpr(rest) };
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
  if (root.stop) {
    const ln = Math.min(lines.length, i + 1);
    const msg = `多余的 ${root.stop}`;
    errors.push(`第 ${ln} 行：${msg}`);
    diagnostics.push({ line: ln, column: firstColumn(lines[ln - 1]), severity: 'error', code: diagCode(msg), message: msg, hint: diagHint(msg) });
  }
  return { ast: root.body, errors, diagnostics };
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
  const local = env.funcs && (env.funcs[name] || env.funcs[String(name).toUpperCase()]);
  if (local) {
    if (args.length !== local.params.length) throw new Error(`FUNC ${name} 需要 ${local.params.length} 个参数，实际 ${args.length} 个`);
    const vars = {};
    local.params.forEach((p, idx) => { vars[p] = args[idx]; });
    return evalExpr(local.expr, { ...env, vars, funcs: env.funcs });
  }
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
  if (typeof ast === 'string') {
    const parsed = parseScript(ast);
    if (parsed.errors && parsed.errors.length) throw new Error(parsed.errors.join('；'));
    ast = parsed.ast;
  }
  let steps = 0;
  const logs = [];
  let result = null;

  async function execBlock(list, scope) {
    for (const st of list) {
      if (++steps > 5000) throw new Error('脚本执行步数超限（5000），检查一下循环');
      const r = await execStatement(st, scope);
      if (r) return r;
    }
    return null;
  }

  async function execStatement(st, scope) {
    if (env.ctx) {
      env.ctx.vars = scope.vars || {};
      env.ctx.last = scope.last || null;
    }
    if (st.k === 'func') {
      scope.funcs[st.name] = { params: st.params, expr: st.expr };
      return null;
    }
    if (st.k === 'assign') {
      const value = evalExpr(st.expr, scope);
      if (st.op === '=') scope.vars[st.name] = value;
      else {
        const old = scope.vars[st.name];
        if (st.op === '+=') scope.vars[st.name] = (typeof old === 'string' || typeof value === 'string') ? String(old == null ? '' : old) + String(value == null ? '' : value) : Number(old || 0) + Number(value);
        else if (st.op === '-=') scope.vars[st.name] = Number(old || 0) - Number(value);
        else if (st.op === '*=') scope.vars[st.name] = Number(old || 0) * Number(value);
        else if (st.op === '/=') scope.vars[st.name] = Number(value) === 0 ? null : Number(old || 0) / Number(value);
      }
      return null;
    }
    if (st.k === 'append') {
      const cur = scope.vars[st.name];
      if (cur != null && !Array.isArray(cur)) throw new Error(`APPEND 只能追加到数组，$${st.name} 现在不是数组`);
      scope.vars[st.name] = (cur || []).concat([evalExpr(st.expr, scope)]);
      return null;
    }
    if (st.k === 'run') {
      callFn(st.name, st.args, scope);
      return null;
    }
    if (st.k === 'throw') throw new Error(String(evalExpr(st.expr, scope)));
    if (st.k === 'break') return { k: 'break' };
    if (st.k === 'continue') return { k: 'continue' };
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
      } else if (st.from === 'crawl') {
        if (typeof env.crawl !== 'function') throw new Error('当前运行时不支持 CRAWL 抓取');
        const url = render.renderText(st.url, env.iface, env.ctx);
        const options = st.optionsText ? evalExpr(parseExpr(st.optionsText), scope) : null;
        scope.vars[st.name] = await env.crawl(url, options || {});
      } else if (st.from === 'token') {
        if (!env.token) throw new Error('TOKEN 没有可用的会话存储');
        const arg = evalExpr(st.expr, scope);
        scope.vars[st.name] = st.action === 'NEW'
          ? await env.token.mint(arg, env.ctx && env.ctx.cookieStore)
          : await env.token.get(arg);
        // 让生成服务知道本次脚本签发了 token，可以在响应里自动种 cookie。
        if (st.action === 'NEW' && env.ctx) {
          env.ctx.mintedToken = scope.vars[st.name] && scope.vars[st.name].token;
          env.ctx.mintedOnlyId = scope.vars[st.name] && scope.vars[st.name].onlyId;
        }
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
    if (st.k === 'wait') {
      const ms = Math.max(0, Math.min(Number(evalExpr(st.expr, scope)) || 0, 60000));
      await new Promise((resolve) => setTimeout(resolve, ms));
      logs.push({ level: 'DEBUG', message: `WAIT ${ms}ms` });
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
      if (env.ctx) env.ctx.tokenDeleted = true;
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
        if (r && r.k === 'return') return r;
        if (r && r.k === 'break') break;
        if (r && r.k === 'continue') continue;
      }
      return null;
    }
    if (st.k === 'for') {
      const from = Number(evalExpr(st.from, scope));
      const to = Number(evalExpr(st.to, scope));
      const step = Math.abs(Number(st.step ? evalExpr(st.step, scope) : 1)) || 1;
      if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('FOR 的起点或终点不是数字');
      let n = from;
      let loops = 0;
      while ((st.direction > 0 ? n <= to : n >= to) && loops++ < 1000) {
        scope.vars[st.name] = n;
        const r = await execBlock(st.body, scope);
        if (r && r.k === 'return') return r;
        if (r && r.k === 'break') break;
        if (r && r.k === 'continue') { n += st.direction * step; continue; }
        n += st.direction * step;
      }
      return null;
    }
    if (st.k === 'while') {
      let loops = 0;
      while (truthy(evalExpr(st.cond, scope)) && loops++ < 1000) {
        const r = await execBlock(st.body, scope);
        if (r && r.k === 'return') return r;
        if (r && r.k === 'break') break;
        if (r && r.k === 'continue') continue;
      }
      return null;
    }
    if (st.k === 'switch') {
      const value = evalExpr(st.expr, scope);
      let matched = false;
      for (const c of st.cases) {
        if (c.values.some((v) => evalExpr(v, scope) == value)) { // eslint-disable-line eqeqeq
          matched = true;
          const r = await execBlock(c.body, scope);
          if (r && r.k === 'return') return r;
          if (r && r.k === 'continue') return r;
          break;
        }
      }
      if (!matched && st.defaultBody) {
        const r = await execBlock(st.defaultBody, scope);
        if (r && r.k === 'return') return r;
        if (r && r.k === 'continue') return r;
      }
      return null;
    }
    if (st.k === 'log') {
      logs.push({ level: st.level || 'INFO', message: String(evalExpr(st.expr, scope)) });
      return null;
    }
    if (st.k === 'return') {
      const meta = responseMeta(st.status, st.expr ? evalExpr(st.expr, scope) : null);
      result = { status: meta.status, body: meta.body, ...(Object.keys(meta.headers).length ? { headers: meta.headers } : {}) };
      return { k: 'return' };
    }
    throw new Error('未知语句：' + st.k);
  }

  const scope = { ...env, vars: env.vars || {}, last: null, funcs: {} };
  const r = await execBlock(ast, scope);
  if (r && (r.k === 'break' || r.k === 'continue')) throw new Error(`${r.k.toUpperCase()} 只能写在循环或 SWITCH 里`);
  if (!result) result = { status: 200, body: scope.last || null };
  return { ...result, logs, vars: scope.vars };
}

/* ---------------- 校验 ---------------- */

// 字节级语法扫描：括号、字符串、块注释、占位符。解析器只认识语句结构，
// 这里补上 IDE 需要精确定位的词法错误，避免整行都标红却不知道错在哪。
function lintRawSyntax(rawLines, add) {
  let block = false;
  let blockStart = null;
  let quote = '';
  let quoteStart = null;
  const stack = [];

  rawLines.forEach((line, idx) => {
    const lineNo = idx + 1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const n = line[i + 1];
      if (block) {
        if (c === '*' && n === '/') { block = false; blockStart = null; i++; }
        continue;
      }
      if (quote) {
        if (c === '\\' && i + 1 < line.length) { i++; continue; }
        if (c === quote) { quote = ''; quoteStart = null; }
        continue;
      }
      if (c === '/' && n === '/') break;
      if (c === '#') break;
      if (c === '/' && n === '*') { block = true; blockStart = { line: lineNo, column: i + 1 }; i++; continue; }
      if (c === '"' || c === "'") { quote = c; quoteStart = { line: lineNo, column: i + 1 }; continue; }
      if (c === '{' && n === '{') {
        const end = line.indexOf('}}', i + 2);
        if (end < 0) {
          add({
            line: lineNo, column: i + 1, endColumn: line.length + 1, severity: 'error', code: 'UNCLOSED_PLACEHOLDER',
            message: '占位符没有闭合', hint: '写成 {{body.name}} 或 {{query.id}}，补全后面的 }}',
          }, `第 ${lineNo} 行：占位符没有闭合`);
          break;
        }
        i = end + 1;
        continue;
      }
      if ('([{'.includes(c)) { stack.push({ ch: c, line: lineNo, column: i + 1 }); continue; }
      if (')]}'.includes(c)) {
        const open = c === ')' ? '(' : c === ']' ? '[' : '{';
        const top = stack[stack.length - 1];
        if (!top || top.ch !== open) {
          add({
            line: lineNo, column: i + 1, endColumn: i + 2, severity: 'error', code: 'BRACKET_MISMATCH',
            message: `括号不匹配：${c} 没有对应的 ${open}`,
            hint: '检查这一行和上一行的括号；字符串里的括号不参与配对',
          }, `第 ${lineNo} 行：括号不匹配 ${c}`);
        } else {
          stack.pop();
        }
      }
    }
  });

  if (block && blockStart) {
    add({
      line: blockStart.line, column: blockStart.column, endColumn: blockStart.column + 2, severity: 'error', code: 'UNCLOSED_COMMENT',
      message: '块注释没有闭合', hint: '补上 */；跨行注释不能一直不结束',
    }, `第 ${blockStart.line} 行：块注释没有闭合`);
  }
  if (quote && quoteStart) {
    add({
      line: quoteStart.line, column: quoteStart.column, endColumn: Math.min((rawLines[quoteStart.line - 1] || '').length + 1, quoteStart.column + 1), severity: 'error', code: 'UNCLOSED_STRING',
      message: '字符串引号没有闭合', hint: '检查这一行的单引号 / 双引号，补上结尾引号',
    }, `第 ${quoteStart.line} 行：字符串引号没有闭合`);
  }
  for (const item of stack) {
    add({
      line: item.line, column: item.column, endColumn: item.column + 1, severity: 'error', code: 'UNCLOSED_BRACKET',
      message: `括号没有闭合：${item.ch}`, hint: `给这个 ${item.ch} 补上对应的 ${item.ch === '(' ? ')' : item.ch === '[' ? ']' : '}'}`,
    }, `第 ${item.line} 行：括号没有闭合 ${item.ch}`);
  }
}

function lintSqlStatements(codeLines, add) {
  const start = /^(LET|SET|ASSIGN|INC|DEC|APPEND|PUSH|QUERY|EXEC|IF|ELSEIF|ELSE|END|FOREACH|FOR|WHILE|BREAK|CONTINUE|SWITCH|CASE|DEFAULT|FUNC|FUNCTION|RUN|INVOKE|RETURN|LOG|WAIT|THROW|TX|PUBLISH|TOKEN)\b/i;
  codeLines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const m = /^\s*(?:(?:LET|SET)\s+\$[A-Za-z0-9_]+\s*=\s*)?(QUERY|EXEC)\b(.*)$/i.exec(line);
    if (!m) return;
    const rest = String(m[2] || '').replace(/;\s*$/, '').trim();
    if (rest) return;
    let next = '';
    for (let k = idx + 1; k < codeLines.length; k++) {
      if (codeLines[k].trim()) { next = codeLines[k].trim(); break; }
    }
    if (next && !start.test(next)) return; // 下一行是 SQL 续行
    const column = line.toUpperCase().indexOf(m[1].toUpperCase()) + 1;
    add({
      line: lineNo, column, endColumn: column + m[1].length, severity: 'error', code: 'EMPTY_SQL',
      message: `${m[1].toUpperCase()} 后面没有 SQL`, hint: '补上 SELECT … 或 INSERT / UPDATE / DELETE …',
    }, `第 ${lineNo} 行：${m[1].toUpperCase()} 后面没有 SQL`);
  });
}

function normalizeDiagnostics(diagnostics, rawLines) {
  const out = [];
  for (const d of diagnostics || []) {
    const lineNo = Math.min(Math.max(1, Number(d.line) || 1), Math.max(1, rawLines.length));
    const text = String(rawLines[lineNo - 1] || '');
    const column = Math.min(Math.max(1, Number(d.column) || 1), text.length + 1);
    let end = Number(d.endColumn) || 0;
    if (!end || end <= column) {
      end = d.code === 'MISSING_END' ? text.trimEnd().length + 1 : spanEnd(text, column);
    }
    out.push({ ...d, line: lineNo, column, endColumn: Math.max(column + 1, Math.min(text.length + 1, end)) });
  }
  return out;
}

function checkScript(text) {
  const parsed = parseScript(text);
  const problems = parsed.errors.slice();
  const diagnostics = (parsed.diagnostics || []).slice();
  const rawLines = String(text || '').split(/\r?\n/);
  const lines = scriptLines(text);
  const seen = new Set();

  const add = (d, legacy) => {
    const key = `${d.code}|${d.line}|${d.column}|${d.message}`;
    if (seen.has(key)) return;
    const bracketLike = d.code === 'UNCLOSED_BRACKET' || d.code === 'BRACKET_MISMATCH';
    const placeholderLike = d.code === 'UNCLOSED_PLACEHOLDER';
    const alreadyIdx = diagnostics.findIndex((x) => x.line === d.line && x.code === 'SYNTAX' && (
      bracketLike ? /[()\[\]{}]|表达式/.test(x.message || '') : placeholderLike && /占位符/.test(x.message || '')
    ));
    if (alreadyIdx >= 0) {
      // 解析器只知道“表达式错了”，词法扫描知道具体是哪个括号/占位符；
      // 用精确范围替换泛化错误，IDEA 的波浪线才不会整行糊成一片。
      diagnostics[alreadyIdx] = d;
      seen.add(key);
      return;
    }
    seen.add(key);
    diagnostics.push(d);
    if (legacy && d.severity === 'error') problems.push(legacy);
  };

  lintRawSyntax(rawLines, add);
  lintSqlStatements(lines, add);

  const re = /\{\{\s*([A-Za-z0-9_.:]+)\s*\}\}/g;
  lines.forEach((line, idx) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const token = m[1];
      const base = render.splitToken(token)[0];
      const lineNo = idx + 1;
      const column = m.index + 1;
      if (render.STRUCT.has(base) || render.VALUES.has(token)) continue;
      if (/^(query|body|path|file|vars|user|token|env|req|header|headers)\.[A-Za-z0-9_]+/.test(token)) continue;
      if (['user', 'token', 'req', 'env', 'vars'].includes(token)) {
        add({
          line: lineNo, column, endColumn: column + m[0].length, severity: 'error', code: 'OBJECT_PLACEHOLDER',
          message: `对象占位符 {{${token}}} 不能直接使用，取不到字段`,
          hint: `改成 {{${token}.username}} 这类具体字段；不确定对象结构就先 LOG DEBUG '${token}';`,
        }, `第 ${lineNo} 行：对象占位符 {{${token}}} 不能直接使用`);
        continue;
      }
      add({
        line: lineNo, column, endColumn: column + m[0].length, severity: 'error', code: 'UNKNOWN_PLACEHOLDER',
        message: `未知占位符：{{${token}}}`,
        hint: diagHint('未知占位符'),
      }, `第 ${lineNo} 行：未知占位符 {{${token}}}`);
    }
  });

  // 变量检查：声明前使用、声明后从未使用。注释里的内容已经剔除，不会误报。
  const declared = new Map();
  const uses = [];
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    let work = line;
    const lm = /^(\s*)(LET|SET|ASSIGN|FOR|FOREACH)\s+\$([A-Za-z0-9_]+)/i.exec(line);
    if (lm) {
      const name = lm[3];
      const column = lm[0].indexOf('$') + 1;
      if (!declared.has(name)) declared.set(name, { line: lineNo, column, used: false });
      work = work.replace(`$${name}`, ' '.repeat(name.length + 1));
    }
    const pm = /^(\s*)(FUNC|FUNCTION)\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)/i.exec(line);
    if (pm) {
      splitArgs(pm[3]).forEach((raw) => {
        const name = raw.replace(/^\$/, '').trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
        if (!declared.has(name)) declared.set(name, { line: lineNo, column: pm[0].indexOf('$') + 1, used: false });
        work = work.replace(new RegExp(`\\$${name}\\b`), ' '.repeat(name.length + 1));
      });
    }
    // 裸赋值 $x = ... 也视为声明；+= / -= 等要求变量已经存在。
    const am = /^(\s*)\$([A-Za-z0-9_]+)\s*=(?!=)/.exec(line);
    if (am) {
      const name = am[2];
      const column = am[0].indexOf('$') + 1;
      if (!declared.has(name)) declared.set(name, { line: lineNo, column, used: false });
      work = work.replace(`$${name}`, ' '.repeat(name.length + 1));
    }
    const vr = /\$([A-Za-z0-9_]+)/g;
    let vm;
    while ((vm = vr.exec(work))) uses.push({ name: vm[1], line: lineNo, column: vm.index + 1 });
  });

  for (const u of uses) {
    const d = declared.get(u.name);
    if (!d) {
      add({
        line: u.line, column: u.column, endColumn: u.column + u.name.length + 1, severity: 'warning', code: 'UNDEFINED_VARIABLE',
        message: `变量 $${u.name} 没有声明就使用了`,
        hint: diagHint('变量未赋值'),
      });
    } else {
      d.used = true;
    }
  }
  for (const [name, d] of declared) {
    if (!d.used) {
      add({
        line: d.line, column: d.column, endColumn: d.column + name.length + 1, severity: 'warning', code: 'UNUSED_VARIABLE',
        message: `变量 $${name} 赋值后没有使用`,
        hint: diagHint('已赋值但未使用'),
      });
    }
  }

  // 注释/空行上的提示不参与工程校验，但会让面板更干净。
  const normalized = normalizeDiagnostics(diagnostics, rawLines);
  diagnostics.length = 0;
  diagnostics.push(...normalized);
  const severityRank = { error: 0, warning: 1, info: 2 };
  diagnostics.sort((a, b) => (severityRank[a.severity] - severityRank[b.severity]) || (a.line - b.line) || (a.column - b.column));
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  return { ok: problems.length === 0, problems, diagnostics, errorCount, warningCount, lines: rawLines.length };
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
    case 'call': return `F('${String(node.name).toUpperCase()}', [${node.args.map(exprToJs).join(', ')}])`;
    default: return 'null';
  }
}

function scriptToJs(ast, indent) {
  const pad = '  '.repeat(indent || 0);
  const funcs = ast.filter((st) => st.k === 'func');
  const body = ast.filter((st) => st.k !== 'func');
  const lines = [];
  if (funcs.length) {
    lines.push(`${pad}var LOCAL_FUNCS = {`);
    funcs.forEach((st) => {
      lines.push(`${pad}  ${st.name}: (${(st.params || []).map((p) => '$' + p).join(', ')}) => ${exprToJs(st.expr)},`);
    });
    lines.push(`${pad}};`);
  }
  lines.push(body.map((st) => {
    if (st.k === 'let' && st.from === 'query') return `${pad}let $${st.name.replace('$', '')} = await Q('${String(st.sql).replace(/'/g, "\\'").replace(/\n/g, ' ')}', ctx);`;
    if (st.k === 'let' && st.from === 'exec') return `${pad}let $${st.name.replace('$', '')} = await X('${String(st.sql).replace(/'/g, "\\'").replace(/\n/g, ' ')}', ctx);`;
    if (st.k === 'let' && st.from === 'http') return `${pad}let $${st.name.replace('$', '')} = await H('${st.method}', '${st.url}', ${st.bodyText ? exprToJs(parseExpr(st.bodyText)) : 'null'}, ctx);`;
    if (st.k === 'let' && st.from === 'crawl') return `${pad}let $${st.name.replace('$', '')} = await CR('${st.url}', ${st.optionsText ? exprToJs(parseExpr(st.optionsText)) : '{}'});`;
    if (st.k === 'let' && st.from === 'token') return `${pad}let $${st.name.replace('$', '')} = await T('${st.action}', ${exprToJs(st.expr)}, ctx);`;
    if (st.k === 'let') return `${pad}let $${st.name.replace('$', '')} = ${exprToJs(st.expr)};`;
    if (st.k === 'assign') return `${pad}$${st.name} ${st.op} ${exprToJs(st.expr)};`;
    if (st.k === 'append') return `${pad}$${st.name} = toList($${st.name}).concat([${exprToJs(st.expr)}]);`;
    if (st.k === 'run') return `${pad}F('${st.name}', [${st.args.map(exprToJs).join(', ')}]);`;
    if (st.k === 'throw') return `${pad}throw new Error(String(${exprToJs(st.expr)}));`;
    if (st.k === 'break') return `${pad}break;`;
    if (st.k === 'continue') return `${pad}continue;`;
    if (st.k === 'sql') return `${pad}${st.mode === 'query' ? 'await Q' : 'await X'}('${st.sql.replace(/'/g, "\\'").replace(/\n/g, ' ')}', ctx);`;
    if (st.k === 'tx') return `${pad}await TX('${st.action}', ctx);`;
    if (st.k === 'wait') return `${pad}await new Promise((r) => setTimeout(r, Math.max(0, Math.min(Number(${exprToJs(st.expr)}) || 0, 60000))));`;
    if (st.k === 'publish') return `${pad}await P('${st.channel}', ${exprToJs(st.expr)}, ctx);`;
    if (st.k === 'tokenDel') return `${pad}await TD(${exprToJs(st.expr)}, ctx);`;
    if (st.k === 'if') {
      const parts = st.branches.map((b, n) => `${n === 0 ? 'if' : '} else if'} (${exprToJs(b.cond)}) {\n${scriptToJs(b.body, (indent || 0) + 1)}\n${pad}}`);
      if (st.elseBody) parts.push(`else {\n${scriptToJs(st.elseBody, (indent || 0) + 1)}\n${pad}}`);
      return pad + parts.join(' ');
    }
    if (st.k === 'foreach') return `${pad}for (const $${st.name} of toList(${exprToJs(st.expr)})) {\n${scriptToJs(st.body, (indent || 0) + 1)}\n${pad}}`;
    if (st.k === 'for') {
      const step = st.step ? exprToJs(st.step) : '1';
      const cmp = st.direction > 0 ? '<=' : '>=';
      const inc = st.direction > 0 ? '+=' : '-=';
      return `${pad}for (let $${st.name} = ${exprToJs(st.from)}; $${st.name} ${cmp} ${exprToJs(st.to)}; $${st.name} ${inc} Math.abs(${step}) || 1) {\n${scriptToJs(st.body, (indent || 0) + 1)}\n${pad}}`;
    }
    if (st.k === 'while') return `${pad}for (let __guard = 0; (${exprToJs(st.cond)}) && __guard++ < 1000;) {\n${scriptToJs(st.body, (indent || 0) + 1)}\n${pad}}`;
    if (st.k === 'switch') {
      const cases = st.cases.map((c) => c.values.map((v) => `${pad}  case ${exprToJs(v)}:`).join('\n') + `\n${pad}    ${scriptToJs(c.body, (indent || 0) + 2).trim().replace(/\n/g, '\n' + pad + '    ')}\n${pad}    break;`).join('\n');
      const dft = st.defaultBody ? `\n${pad}  default:\n${pad}    ${scriptToJs(st.defaultBody, (indent || 0) + 2).trim().replace(/\n/g, '\n' + pad + '    ')}` : '';
      return `${pad}switch (${exprToJs(st.expr)}) {\n${cases}${dft}\n${pad}}`;
    }
    if (st.k === 'log') return `${pad}L('${st.level || 'INFO'}', ${exprToJs(st.expr)}, ctx);`;
    if (st.k === 'return') return `${pad}return responseMeta(${st.status}, ${st.expr ? exprToJs(st.expr) : 'null'});`;
    return `${pad}// 未知语句`;
  }).join('\n'));
  return lines.join('\n');
}

module.exports = { parseScript, parseExpr, runScript, checkScript, scriptToJs, exprToJs, evalExpr, expandSqlFunctions, responseMeta };
