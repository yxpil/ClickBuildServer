// 作者：yxpil
package icb;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.*;

/** SQL 占位符、$变量与模板渲染。 */
public class Render {
    static final Pattern TOKEN_RE = Pattern.compile("\\{\\{\\s*([A-Za-z0-9_.:]+)\\s*\\}\\}");
    static final Pattern VAR_RE = Pattern.compile("\\$([A-Za-z_][A-Za-z0-9_]*(?:\\[[0-9]+\\]|\\.[A-Za-z0-9_]+)*)");
    static final Set<String> STRUCT = new HashSet<>(Arrays.asList(
        "t", "table", "columns", "allColumns", "insertColumns", "insertValues", "updateSet", "where",
        "orderBy", "limit", "offset", "idColumn", "page", "pageSize", "schema",
        "tableComment", "bindColumn", "bucket"));

    static String[] splitToken(String token) {
        int i = token.indexOf(':');
        return i >= 0 ? new String[]{token.substring(0, i), token.substring(i + 1)} : new String[]{token, ""};
    }

    static boolean tableRefMatch(Model.Table t, String key) {
        if (t == null) return false;
        if (key.equals(t.key) || key.equals(t.name)) return true;
        if (t.ref != null && !t.ref.isEmpty() && key.equals(t.ref)) return true;
        if (t.schema != null && !t.schema.isEmpty() && key.equals(t.schema + "." + t.name)) return true;
        return t.ifaceId != null && !t.ifaceId.isEmpty() && key.equals(t.ifaceId + "." + t.key);
    }

    static Model.Table bindingOf(Model.Iface root, String key) {
        if (root == null || root.tables.isEmpty()) return null;
        if (key == null || key.isEmpty()) return root.tables.get(0);
        for (Model.Table t : root.tables) if (t.key.equals(key)) return t;
        // 本接口没有这个表键时，按项目目录找其它接口的真实表名。
        for (Model.Table t : root.projectTables) if (tableRefMatch(t, key)) return t;
        return null;
    }

    static String ident(String v) throws Exception {
        v = v == null ? "" : v.trim();
        if (!v.matches("^[A-Za-z_][A-Za-z0-9_]{0,63}$")) throw new Exception("非法标识符：" + v);
        return v;
    }

    static String safeIdent(String v) {
        try { return ident(v); } catch (Exception e) { return v; }
    }

    static String columnsSQL(Model.Table t) {
        List<String> out = new ArrayList<>();
        for (Model.Field f : t.fields) if (!f.hidden) out.add(safeIdent(f.name));
        return String.join(", ", out);
    }

    static String allColumnsSQL(Model.Table t) {
        List<String> out = new ArrayList<>();
        for (Model.Field f : t.fields) out.add(safeIdent(f.name));
        return String.join(", ", out);
    }

    static Model.Field idField(Model.Table t) {
        for (Model.Field f : t.fields) if (f.pk) return f;
        if (!t.fields.isEmpty()) return t.fields.get(0);
        Model.Field f = new Model.Field(); f.name = "id"; f.type = "bigint"; f.pk = true; return f;
    }

    static List<Model.Field> writableFields(Model.Table t) {
        List<Model.Field> out = new ArrayList<>();
        for (Model.Field f : t.fields) if (!f.pk && !f.auto && f.writable) out.add(f);
        return out;
    }

    static Object castValue(Model.Field f, Object raw) {
        if (raw == null) return null;
        String typ = f.type == null ? "" : f.type.toLowerCase();
        if (typ.equals("bool") || typ.equals("boolean")) {
            if (raw instanceof Boolean) return raw;
            if (raw instanceof String s) return s.equals("1") || s.equalsIgnoreCase("true");
        }
        if (typ.equals("bigint") || typ.equals("int") || typ.equals("smallint") || typ.equals("tinyint")
            || typ.equals("decimal") || typ.equals("float") || typ.equals("double")) {
            if (raw instanceof String s) {
                try { return Double.parseDouble(s); } catch (Exception e) { return raw; }
            }
            return raw;
        }
        if (raw instanceof Collection<?> c) {
            List<String> parts = new ArrayList<>();
            for (Object x : c) parts.add(Funcs.ascii(x));
            return String.join(",", parts);
        }
        if (raw instanceof String) return raw;
        return Funcs.ascii(raw);
    }

    static List<String> splitList(Object raw) {
        List<String> list = new ArrayList<>();
        if (raw instanceof Collection<?> c) {
            for (Object v : c) list.add(Funcs.ascii(v).trim());
        } else {
            for (String v : Funcs.ascii(raw).split(",")) list.add(v.trim());
        }
        List<String> out = new ArrayList<>();
        for (String v : list) if (!v.isEmpty()) out.add(v);
        if (out.size() > 50) out = out.subList(0, 50);
        return out;
    }

    static String buildWhere(Model.Table t, Model.Ctx ctx, List<Object> params) {
        List<String> parts = new ArrayList<>();
        Map<String, Model.Field> byName = new LinkedHashMap<>();
        for (Model.Field f : t.fields) if (f.query && !f.hidden) byName.put(f.name, f);
        for (Map.Entry<String, Object> e : ctx.query.entrySet()) {
            String key = e.getKey();
            if (Arrays.asList("page", "pageSize", "sort", "keyword", "keywordRegex", "keyword_regex").contains(key)) continue;
            String base = key, op = "eq";
            String[] suffixes = {"__gte", "__lte", "__gt", "__lt", "__like", "__in", "__between", "__ne",
                "__regex", "__iregex", "__notregex", "__contains", "__startswith", "__endswith", "__isnull", "__notnull"};
            for (String suf : suffixes) {
                if (key.endsWith(suf)) { base = key.substring(0, key.length() - suf.length()); op = suf.substring(2); break; }
            }
            Model.Field f = byName.get(base);
            if (f == null) continue;
            Object raw = e.getValue();
            if (raw == null || Funcs.ascii(raw).isEmpty()) continue;
            String col = safeIdent(f.name);
            switch (op) {
                case "eq" -> { parts.add(col + " = ?"); params.add(castValue(f, raw)); }
                case "ne" -> { parts.add(col + " <> ?"); params.add(castValue(f, raw)); }
                case "gte", "gt", "lte", "lt" -> {
                    String sign = Map.of("gte", ">=", "gt", ">", "lte", "<=", "lt", "<").get(op);
                    parts.add(col + " " + sign + " ?"); params.add(castValue(f, raw));
                }
                case "like" -> { parts.add(col + " LIKE ?"); params.add("%" + Funcs.ascii(raw) + "%"); }
                case "regex", "iregex", "notregex" -> {
                    String pattern = Funcs.ascii(raw);
                    if (pattern.length() > 500) pattern = pattern.substring(0, 500);
                    if (op.equals("iregex") && !pattern.startsWith("(?")) pattern = "(?i)" + pattern;
                    parts.add(col + (op.equals("notregex") ? " NOT REGEXP ?" : " REGEXP ?"));
                    params.add(pattern);
                }
                case "contains", "startswith", "endswith" -> {
                    String v = Funcs.ascii(raw).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
                    parts.add(col + " LIKE ?");
                    params.add(op.equals("contains") ? "%" + v + "%" : op.equals("startswith") ? v + "%" : "%" + v);
                }
                case "isnull" -> {
                    String low = Funcs.ascii(raw).trim().toLowerCase();
                    boolean yes = low.matches("^(1|true|yes|y)$");
                    parts.add(col + (yes ? " IS NULL" : " IS NOT NULL"));
                }
                case "notnull" -> parts.add(col + " IS NOT NULL");
                case "in" -> {
                    List<String> list = splitList(raw);
                    if (list.isEmpty()) continue;
                    List<String> marks = new ArrayList<>();
                    for (String v : list) { marks.add("?"); params.add(castValue(f, v)); }
                    parts.add(col + " IN (" + String.join(", ", marks) + ")");
                }
                case "between" -> {
                    List<String> list = splitList(raw);
                    if (list.size() < 2) continue;
                    parts.add(col + " BETWEEN ? AND ?");
                    params.add(castValue(f, list.get(0)));
                    params.add(castValue(f, list.get(1)));
                }
                default -> { }
            }
        }
        String kw = valueStr(ctx.query.get("keyword"));
        List<Model.Field> search = new ArrayList<>();
        for (Model.Field f : t.fields) if (f.search && f.type != null && f.type.toLowerCase().matches(".*(char|text|varchar).*")) search.add(f);
        if (!kw.isEmpty() && !search.isEmpty()) {
            List<String> likes = new ArrayList<>();
            for (Model.Field f : search) { likes.add(safeIdent(f.name) + " LIKE ?"); params.add("%" + kw + "%"); }
            parts.add("(" + String.join(" OR ", likes) + ")");
        }
        String kwRegex = valueStr(ctx.query.get("keywordRegex"));
        if (kwRegex.isEmpty()) kwRegex = valueStr(ctx.query.get("keyword_regex"));
        if (!kwRegex.isEmpty() && !search.isEmpty()) {
            if (kwRegex.length() > 500) kwRegex = kwRegex.substring(0, 500);
            List<String> rx = new ArrayList<>();
            for (Model.Field f : search) { rx.add(safeIdent(f.name) + " REGEXP ?"); params.add(kwRegex); }
            parts.add("(" + String.join(" OR ", rx) + ")");
        }
        return parts.isEmpty() ? "1 = 1" : String.join(" AND ", parts);
    }

    static String orderBySQL(Model.Table t, Model.Ctx ctx) {
        String raw = valueStr(ctx.query.get("sort"));
        if (!raw.isEmpty()) {
            List<String> built = new ArrayList<>();
            for (String p : raw.split(",")) {
                p = p.trim(); if (p.isEmpty()) continue;
                String[] bits = p.split(":");
                String name = bits[0], dir = bits.length > 1 && bits[1].equalsIgnoreCase("desc") ? "DESC" : "ASC";
                boolean found = false;
                for (Model.Field f : t.fields) if (f.name.equals(name)) { found = true; break; }
                if (found) built.add(safeIdent(name) + " " + dir);
                if (built.size() >= 3) break;
            }
            if (!built.isEmpty()) return String.join(", ", built);
        }
        return safeIdent(idField(t).name) + " DESC";
    }

    static int pageSizeOf(Model.Service svc) {
        Object v = svc.page.get("size");
        if (v instanceof Number n && n.doubleValue() > 0) return n.intValue();
        return 20;
    }

    static Object firstOf(Map<String, Object> m, String... keys) {
        for (String k : keys) {
            Object v = m.get(k);
            if (v != null && !Funcs.ascii(v).isEmpty()) return v;
        }
        return null;
    }

    static String valueStr(Object v) {
        if (v == null) return "";
        String s = Funcs.ascii(v);
        return s.equals("null") ? "" : s;
    }

    static String structValue(String token, Model.Service svc, Model.Iface iface, Model.Ctx ctx, List<Object> params) throws Exception {
        String[] split = splitToken(token);
        String base = split[0], key = split[1];
        if (base.equals("bucket")) return Funcs.ascii(svc.storage.get("bucket")).replace("'", "");
        if (base.equals("bindColumn")) return Funcs.ascii(svc.storage.get("bindField"));
        Model.Table t = bindingOf(iface, key);
        if (t == null) throw new Exception("未知表键：" + key);
        switch (base) {
            case "t": case "table": return safeIdent(t.name);
            case "schema": return t.schema != null && !t.schema.isEmpty() ? safeIdent(t.schema) + "." : "";
            case "tableComment": return t.comment;
            case "columns": return columnsSQL(t);
            case "allColumns": return allColumnsSQL(t);
            case "insertColumns": {
                List<String> names = new ArrayList<>();
                for (Model.Field f : writableFields(t)) names.add(safeIdent(f.name));
                return String.join(", ", names);
            }
            case "insertValues": {
                List<String> marks = new ArrayList<>();
                for (Model.Field f : writableFields(t)) {
                    Object v = ctx.body.containsKey(f.name) ? ctx.body.get(f.name) : (f.def != null && !f.def.isEmpty() ? f.def : null);
                    params.add(castValue(f, v));
                    marks.add("?");
                }
                return String.join(", ", marks);
            }
            case "updateSet": {
                List<String> sets = new ArrayList<>();
                for (Model.Field f : writableFields(t)) {
                    if (ctx.body.containsKey(f.name)) {
                        params.add(castValue(f, ctx.body.get(f.name)));
                        sets.add(safeIdent(f.name) + " = ?");
                    }
                }
                if (sets.isEmpty()) throw new Exception("更新语句没有可写字段");
                return String.join(", ", sets);
            }
            case "where": return buildWhere(t, ctx, params);
            case "orderBy": return orderBySQL(t, ctx);
            case "limit": return String.valueOf(Funcs.toInt(firstOf(ctx.query, "pageSize", "limit"), pageSizeOf(svc), 1, 500));
            case "offset": {
                int size = Funcs.toInt(firstOf(ctx.query, "pageSize", "limit"), pageSizeOf(svc), 1, 500);
                int page = Funcs.toInt(ctx.query.get("page"), 1, 1, 100000);
                return String.valueOf((page - 1) * size);
            }
            case "page": return String.valueOf(Funcs.toInt(ctx.query.get("page"), 1, 1, 100000));
            case "pageSize": return String.valueOf(Funcs.toInt(ctx.query.get("pageSize"), pageSizeOf(svc), 1, 500));
            case "idColumn": return safeIdent(idField(t).name);
            default: return "";
        }
    }

    static Object walk(Object cur, String seg) {
        if (cur == null) return null;
        if (cur instanceof Map<?, ?> m) return m.get(seg);
        if (cur instanceof List<?> l) {
            try {
                int n = Integer.parseInt(seg);
                return n >= 0 && n < l.size() ? l.get(n) : null;
            } catch (Exception e) { return null; }
        }
        return null;
    }

    static Object pick(Model.Ctx ctx, String token) {
        int dot = token.indexOf('.');
        String scope = "", key = token;
        if (dot > 0) { scope = token.substring(0, dot); key = token.substring(dot + 1); }
        if (scope.equals("vars") || scope.equals("last")) {
            Object cur = scope.equals("vars") ? ctx.vars : ctx.last;
            for (String seg : key.split(".")) cur = walk(cur, seg);
            return cur;
        }
        Map<String, Object> bag = switch (scope) {
            case "query" -> ctx.query;
            case "body" -> ctx.body;
            case "path" -> ctx.path;
            case "file" -> ctx.file;
            case "user" -> ctx.user;
            case "env" -> ctx.env;
            default -> null;
        };
        return bag == null ? null : bag.get(key);
    }

    static Object valueOf(String token, Model.Ctx ctx, Model.Iface iface) {
        switch (token) {
            case "id":
                if (ctx.id != null) return ctx.id;
                if (ctx.query.containsKey("id")) return ctx.query.get("id");
                return ctx.path.get("id");
            case "now": return ctx.now;
            case "uuid": case "onlyId": return ctx.uuid;
            case "token": return ctx.token;
            case "remoteIp": return ctx.remoteIp;
            case "traceId": return ctx.traceId;
            case "queryHash": return queryHash(ctx);
            case "filename": return mapStr(ctx.file, "filename");
            case "contentType": return mapStr(ctx.file, "contentType");
            case "size": return ctx.file == null ? null : ctx.file.get("size");
            case "objectKey": return mapStr(ctx.file, "objectKey");
            case "objectUrl": return mapStr(ctx.file, "objectUrl");
            default: break;
        }
        Object v = pick(ctx, token);
        String last = token;
        int i = token.lastIndexOf('.');
        if (i >= 0) last = token.substring(i + 1);
        Model.Table t = bindingOf(iface, "");
        if (t != null) for (Model.Field f : t.fields) if (f.name.equals(last)) return castValue(f, v);
        return v;
    }

    static Object mapStr(Map<String, Object> m, String key) {
        if (m == null) return "";
        return m.containsKey(key) ? m.get(key) : "";
    }

    static String queryHash(Model.Ctx ctx) {
        try {
            String raw = Funcs.GSON.toJson(Map.of("q", ctx.query, "p", ctx.path, "id", ctx.id == null ? "" : ctx.id));
            byte[] d = MessageDigest.getInstance("SHA-1").digest(raw.getBytes(StandardCharsets.UTF_8));
            return Funcs.hex(d).substring(0, 16);
        } catch (Exception e) { return ""; }
    }

    static String renderText(String tpl, Model.Service svc, Model.Iface iface, Model.Ctx ctx) {
        Matcher m = TOKEN_RE.matcher(tpl);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String token = m.group(1).trim();
            String[] split = splitToken(token);
            String rep;
            if (STRUCT.contains(split[0])) {
                if (split[0].equals("where")) rep = "1 = 1";
                else if (split[0].equals("orderBy")) rep = "id DESC";
                else {
                    try { rep = structValue(token, svc, iface, ctx, new ArrayList<>()); } catch (Exception e) { rep = ""; }
                }
            } else {
                Object v = valueOf(token, ctx, iface);
                rep = v == null ? "" : Funcs.ascii(v);
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(rep));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    public static String[] renderSQLText(String text, Model.Service svc, Model.Iface iface, Model.Ctx ctx) throws Exception {
        List<Object> params = new ArrayList<>();
        Matcher vm = VAR_RE.matcher(text);
        StringBuilder vars = new StringBuilder();
        while (vm.find()) {
            String path = vm.group(1).replace("[", ".").replace("]", "");
            Object v = pick(ctx, "vars." + path);
            String rep = v == null ? vm.group(0) : "{{vars." + path + "}}";
            vm.appendReplacement(vars, Matcher.quoteReplacement(rep));
        }
        vm.appendTail(vars);
        text = vars.toString();

        Matcher m = TOKEN_RE.matcher(text);
        StringBuilder out = new StringBuilder();
        int last = 0;
        while (m.find()) {
            out.append(text, last, m.start());
            String token = m.group(1).trim();
            String[] split = splitToken(token);
            if (STRUCT.contains(split[0])) {
                out.append(structValue(token, svc, iface, ctx, params));
            } else {
                params.add(valueOf(token, ctx, iface));
                out.append("?");
            }
            last = m.end();
        }
        out.append(text.substring(last));
        Object[] p = params.toArray();
        String[] result = new String[p.length + 1];
        result[0] = out.toString();
        for (int i = 0; i < p.length; i++) result[i + 1] = p[i] == null ? null : p[i].toString();
        return result;
    }

    /** 返回 SQL 与原始参数对象，避免把所有值都转成字符串。 */
    public static Object[] renderSQL(String text, Model.Service svc, Model.Iface iface, Model.Ctx ctx) throws Exception {
        List<Object> params = new ArrayList<>();
        String sql = renderSQLWithParams(text, svc, iface, ctx, params);
        return new Object[]{sql, params};
    }

    static String renderSQLWithParams(String text, Model.Service svc, Model.Iface iface, Model.Ctx ctx, List<Object> params) throws Exception {
        Matcher vm = VAR_RE.matcher(text);
        StringBuilder vars = new StringBuilder();
        while (vm.find()) {
            String path = vm.group(1).replace("[", ".").replace("]", "");
            Object v = pick(ctx, "vars." + path);
            String rep = v == null ? vm.group(0) : "{{vars." + path + "}}";
            vm.appendReplacement(vars, Matcher.quoteReplacement(rep));
        }
        vm.appendTail(vars);
        text = vars.toString();

        Matcher m = TOKEN_RE.matcher(text);
        StringBuilder out = new StringBuilder();
        int last = 0;
        while (m.find()) {
            out.append(text, last, m.start());
            String token = m.group(1).trim();
            String[] split = splitToken(token);
            if (STRUCT.contains(split[0])) out.append(structValue(token, svc, iface, ctx, params));
            else { params.add(valueOf(token, ctx, iface)); out.append("?"); }
            last = m.end();
        }
        out.append(text.substring(last));
        return out.toString();
    }
}
