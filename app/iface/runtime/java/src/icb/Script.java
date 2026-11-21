// 作者：yxpil
package icb;

import java.util.*;
import java.util.regex.*;

/** 脚本 AST 解释器，与 Node / Go 运行时使用同一份 service.json。 */
public class Script {
    static final Set<String> SQL_FUNCS = new HashSet<>(Arrays.asList(
        "HASH", "MD5", "SHA1", "SHA256", "SM3", "SM4_ENC", "SM4_DEC",
        "MASK", "URL_ENC", "URL_DEC", "RAND_INT"));

    public static class Env {
        final Server server;
        final Model.Iface iface;
        final Model.Route route;
        final Model.Ctx ctx;
        final Map<String, Object> vars;
        final Map<String, Object> idents = new LinkedHashMap<>();
        Object last;
        Db db;
        boolean inTx;

        Env(Server server, Model.Iface iface, Model.Route route, Model.Ctx ctx) {
            this.server = server;
            this.iface = iface;
            this.route = route;
            this.ctx = ctx;
            this.vars = ctx.vars;
        }

        Env subScope() {
            Env e = new Env(server, iface, route, ctx);
            e.db = db;
            return e;
        }

        @SuppressWarnings("unchecked")
        Object eval(Object node) {
            if (node == null) return null;
            if (!(node instanceof Map<?, ?> raw)) return node;
            Map<String, Object> m = (Map<String, Object>) raw;
            String k = Funcs.ascii(m.get("k"));
            switch (k) {
                case "lit": return m.get("v");
                case "ph": return Render.valueOf(Funcs.ascii(m.get("v")), ctx, iface);
                case "var": {
                    Object cur = vars.get(Funcs.ascii(m.get("name")));
                    if (m.get("path") instanceof List<?> path) for (Object p : path) cur = Render.walk(cur, Funcs.ascii(p));
                    return cur;
                }
                case "ident": {
                    String name = Funcs.ascii(m.get("name"));
                    if (idents.containsKey(name)) return idents.get(name);
                    if (name.equals("true")) return true;
                    if (name.equals("false")) return false;
                    if (name.equals("null")) return null;
                    return name;
                }
                case "array": {
                    List<Object> out = new ArrayList<>();
                    if (m.get("items") instanceof List<?> items) for (Object x : items) out.add(eval(x));
                    return out;
                }
                case "object": {
                    Map<String, Object> out = new LinkedHashMap<>();
                    if (m.get("entries") instanceof List<?> entries) {
                        for (Object e : entries) if (e instanceof Map<?, ?> entry) {
                            out.put(Funcs.ascii(entry.get("key")), eval(entry.get("value")));
                        }
                    }
                    return out;
                }
                case "un": {
                    Object v = eval(m.get("a"));
                    if (Funcs.ascii(m.get("op")).equals("!")) return !Funcs.truthy(v);
                    return -Funcs.num(v);
                }
                case "and": return Funcs.truthy(eval(m.get("a"))) && Funcs.truthy(eval(m.get("b")));
                case "or": return Funcs.truthy(eval(m.get("a"))) || Funcs.truthy(eval(m.get("b")));
                case "cmp": return Funcs.compare(eval(m.get("a")), eval(m.get("b")), Funcs.ascii(m.get("op")));
                case "bin": {
                    Object a = eval(m.get("a")), b = eval(m.get("b"));
                    String op = Funcs.ascii(m.get("op"));
                    if (op.equals("+")) {
                        if (a instanceof String || b instanceof String) return Funcs.ascii(a) + Funcs.ascii(b);
                        return Funcs.num(a) + Funcs.num(b);
                    }
                    if (op.equals("-")) return Funcs.num(a) - Funcs.num(b);
                    if (op.equals("*")) return Funcs.num(a) * Funcs.num(b);
                    if (op.equals("/")) return Funcs.num(b) == 0 ? Double.NaN : Funcs.num(a) / Funcs.num(b);
                    if (op.equals("%")) return Funcs.num(a) % Funcs.num(b);
                    return null;
                }
                case "call": {
                    List<Object> args = new ArrayList<>();
                    if (m.get("args") instanceof List<?> list) for (Object x : list) args.add(eval(x));
                    return Funcs.call(Funcs.ascii(m.get("name")), args, this);
                }
                default: return null;
            }
        }
    }

    interface Step { Model.ScriptResult run(Env e) throws Exception; }

    static Model.ScriptResult execBlock(List<?> block, Env env) throws Exception {
        if (block == null) return null;
        for (Object raw : block) {
            if (!(raw instanceof Map<?, ?>)) continue;
            @SuppressWarnings("unchecked")
            Map<String, Object> st = (Map<String, Object>) raw;
            ctxSync(env);
            switch (Funcs.ascii(st.get("k"))) {
                case "let" -> execLet(st, env);
                case "sql" -> execSQL(st, env);
                case "if" -> {
                    Model.ScriptResult r = execIf(st, env);
                    if (r != null) return r;
                }
                case "foreach" -> {
                    Object list = env.eval(st.get("expr"));
                    Collection<?> arr = list instanceof Collection<?> c ? c : null;
                    if (list instanceof Map<?, ?> m && m.get("rows") instanceof Collection<?> rows) arr = rows;
                    if (arr != null) {
                        int i = 0;
                        for (Object item : arr) {
                            if (i++ >= 500) break;
                            env.vars.put(Funcs.ascii(st.get("name")), item);
                            Model.ScriptResult r = execBlock((List<?>) st.get("body"), env);
                            if (r != null) return r;
                        }
                    }
                }
                case "log" -> System.out.println("[" + Funcs.ascii(st.get("level")) + "] " + Funcs.ascii(env.eval(st.get("expr"))));
                case "return" -> {
                    Model.ScriptResult r = new Model.ScriptResult();
                    if (st.get("status") instanceof Number n) r.status = n.intValue();
                    if (st.containsKey("expr")) r.body = env.eval(st.get("expr"));
                    return r;
                }
                case "tx" -> env.last = txAction(Funcs.ascii(st.get("action")), env);
                case "publish" -> { }
                case "tokenDel" -> {
                    serverOf(env).tokens.remove(Funcs.ascii(env.eval(st.get("expr"))));
                    env.ctx.tokenDeleted = true;
                }
                default -> throw new Exception("未知脚本语句：" + Funcs.ascii(st.get("k")));
            }
        }
        return null;
    }

    static Server serverOf(Env env) { return env.server; }

    static void ctxSync(Env env) {
        env.ctx.vars = env.vars;
        env.ctx.last = env.last;
    }

    static Model.ScriptResult execIf(Map<String, Object> st, Env env) throws Exception {
        if (st.get("branches") instanceof List<?> branches) {
            for (Object raw : branches) {
                if (!(raw instanceof Map<?, ?> br)) continue;
                if (Funcs.truthy(env.eval(br.get("cond"))) ) {
                    return execBlock((List<?>) br.get("body"), env);
                }
            }
        }
        if (st.get("elseBody") instanceof List<?> body) return execBlock(body, env);
        return null;
    }

    static void execLet(Map<String, Object> st, Env env) throws Exception {
        String name = Funcs.ascii(st.get("name"));
        switch (Funcs.ascii(st.get("from"))) {
            case "query", "exec" -> {
                Object[] rendered = Render.renderSQL(Funcs.ascii(st.get("sql")), env.server.service, env.iface, env.ctx);
                @SuppressWarnings("unchecked")
                List<Object> params = (List<Object>) rendered[1];
                Object[] expanded = expandSQLFunctions((String) rendered[0], params, env);
                String sql = (String) expanded[0];
                @SuppressWarnings("unchecked")
                List<Object> ps = (List<Object>) expanded[1];
                if (Funcs.ascii(st.get("from")).equals("query")) {
                    List<Map<String, Object>> rows = env.db.query(sql, ps);
                    Map<String, Object> v = Funcs.obj("rows", rows, "sql", sql, "params", ps);
                    env.vars.put(name, v);
                    env.last = v;
                } else {
                    Model.DBResult r = env.db.exec(sql, ps);
                    Map<String, Object> v = Funcs.obj("insertId", (double) r.insertId, "lastInsertId", (double) r.lastInsertId,
                        "affectedRows", (double) r.affectedRows, "sql", sql, "params", ps);
                    env.vars.put(name, v);
                    env.last = v;
                }
            }
            case "http" -> throw new Exception("Java 原生运行时暂不支持脚本里的 HTTP 调用");
            case "token" -> {
                @SuppressWarnings("unchecked")
                Map<String, Object> claims = env.eval(st.get("expr")) instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>();
                if (Funcs.ascii(st.get("action")).equals("NEW")) {
                    Map<String, Object> v = env.server.tokens.mint(claims);
                    env.vars.put(name, v);
                    env.ctx.mintedToken = Funcs.ascii(v.get("token"));
                    env.ctx.mintedOnlyId = Funcs.ascii(v.get("onlyId"));
                } else {
                    Object v = env.server.tokens.get(Funcs.ascii(claims.get("token")));
                    env.vars.put(name, v);
                }
            }
            default -> env.vars.put(name, env.eval(st.get("expr")));
        }
    }

    static void execSQL(Map<String, Object> st, Env env) throws Exception {
        Object[] rendered = Render.renderSQL(Funcs.ascii(st.get("sql")), env.server.service, env.iface, env.ctx);
        @SuppressWarnings("unchecked")
        List<Object> params = (List<Object>) rendered[1];
        Object[] expanded = expandSQLFunctions((String) rendered[0], params, env);
        String sql = (String) expanded[0];
        @SuppressWarnings("unchecked")
        List<Object> ps = (List<Object>) expanded[1];
        if (Funcs.ascii(st.get("mode")).equalsIgnoreCase("QUERY")) {
            List<Map<String, Object>> rows = env.db.query(sql, ps);
            env.last = Funcs.obj("rows", rows, "sql", sql, "params", ps);
        } else {
            Model.DBResult r = env.db.exec(sql, ps);
            env.last = Funcs.obj("insertId", (double) r.insertId, "lastInsertId", (double) r.lastInsertId,
                "affectedRows", (double) r.affectedRows, "sql", sql, "params", ps);
        }
    }

    static Object txAction(String action, Env env) throws Exception {
        switch (action.trim().toUpperCase()) {
            case "BEGIN":
                if (env.inTx) return Funcs.obj("state", "BEGIN", "already", true);
                env.db.begin();
                env.inTx = true;
                return Funcs.obj("state", "BEGIN");
            case "COMMIT":
                if (!env.inTx) throw new Exception("该路由没有开启事务（tx=false）");
                env.db.commit();
                env.inTx = false;
                return Funcs.obj("state", "COMMIT", "ok", true);
            case "ROLLBACK":
                if (!env.inTx) throw new Exception("该路由没有开启事务（tx=false）");
                env.db.rollback();
                env.inTx = false;
                return Funcs.obj("state", "ROLLBACK", "ok", true);
            default:
                throw new Exception("不支持 TX " + action);
        }
    }

    /** SQL 里的 SM4_ENC(?, 'key') 等先本地算掉，避免依赖数据库自定义函数。 */
    static Object[] expandSQLFunctions(String sql, List<Object> params, Env env) {
        StringBuilder out = new StringBuilder();
        List<Object> rest = new ArrayList<>();
        int[] pindex = {0};
        int i = 0;
        while (i < sql.length()) {
            char c = sql.charAt(i);
            if (c == '\'' || c == '"' || c == '`') {
                int j = i + 1;
                while (j < sql.length()) {
                    if (sql.charAt(j) == c) {
                        if (j + 1 < sql.length() && sql.charAt(j + 1) == c) j += 2;
                        else { j++; break; }
                    } else if (sql.charAt(j) == '\\') j += 2;
                    else j++;
                }
                out.append(sql, i, Math.min(j, sql.length()));
                i = Math.min(j, sql.length());
                continue;
            }
            if (Character.isLetter(c) || c == '_') {
                int j = i;
                while (j < sql.length() && (Character.isLetterOrDigit(sql.charAt(j)) || sql.charAt(j) == '_')) j++;
                String word = sql.substring(i, j);
                int k = j;
                while (k < sql.length() && Character.isWhitespace(sql.charAt(k))) k++;
                if (k < sql.length() && sql.charAt(k) == '(' && SQL_FUNCS.contains(word.toUpperCase())) {
                    int depth = 1, x = k + 1;
                    List<String> args = new ArrayList<>();
                    StringBuilder cur = new StringBuilder();
                    boolean quote = false;
                    char qc = 0;
                    while (x < sql.length() && depth > 0) {
                        char ch = sql.charAt(x);
                        if (quote) {
                            cur.append(ch);
                            if (ch == qc) quote = false;
                        } else if (ch == '\'' || ch == '"') { quote = true; qc = ch; cur.append(ch); }
                        else if (ch == '(') { depth++; cur.append(ch); }
                        else if (ch == ')') {
                            depth--;
                            if (depth == 0) { args.add(cur.toString().trim()); break; }
                            cur.append(ch);
                        } else if (ch == ',' && depth == 1) { args.add(cur.toString().trim()); cur.setLength(0); }
                        else cur.append(ch);
                        x++;
                    }
                    if (depth == 0) {
                        List<Object> vals = new ArrayList<>();
                        for (String a : args) {
                            if (a.equals("?")) vals.add(pindex[0] < params.size() ? params.get(pindex[0]++) : null);
                            else if ((a.startsWith("'") && a.endsWith("'")) || (a.startsWith("\"") && a.endsWith("\""))) {
                                vals.add(a.substring(1, a.length() - 1).replace("''", "'"));
                            } else {
                                try { vals.add(Double.parseDouble(a)); } catch (Exception e) { vals.add(a); }
                            }
                        }
                        Object computed = Funcs.call(word, vals, env);
                        out.append(sqlLiteral(computed));
                        i = x + 1;
                        continue;
                    }
                }
                out.append(word);
                i = j;
                continue;
            }
            if (c == '?') {
                out.append('?');
                if (pindex[0] < params.size()) rest.add(params.get(pindex[0]++));
                i++;
                continue;
            }
            out.append(c);
            i++;
        }
        return new Object[]{out.toString(), rest};
    }

    static String sqlLiteral(Object v) {
        if (v == null) return "NULL";
        if (v instanceof Number n) return String.valueOf(n);
        return "'" + Funcs.ascii(v).replace("\\", "\\\\").replace("'", "''") + "'";
    }
}
