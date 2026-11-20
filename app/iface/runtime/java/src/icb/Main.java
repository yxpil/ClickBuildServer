package icb;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.sun.net.httpserver.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.*;

/** ClickBuild Java 原生服务入口：读取 service.json，不再调用 Node。 */
public class Main {
    public static void main(String[] args) throws Exception {
        String file = args.length > 0 ? args[0] : "service.json";
        Gson gson = new GsonBuilder().create();
        Model.Service svc;
        try (Reader r = Files.newBufferedReader(Paths.get(file), StandardCharsets.UTF_8)) {
            svc = gson.fromJson(r, Model.Service.class);
        }
        if (svc == null) throw new RuntimeException("service.json 解析为空");
        if (svc.apiPrefix == null || svc.apiPrefix.isEmpty()) svc.apiPrefix = "/api";
        if (svc.page == null) svc.page = new LinkedHashMap<>(Map.of("size", 20));
        if (svc.interfaces != null) {
            for (Model.Iface it : svc.interfaces) {
                if (it.tables == null) continue;
                for (Model.Table t : it.tables) {
                    String mode = t.store == null || t.store.mode == null ? "mysql" : t.store.mode.toLowerCase(Locale.ROOT).trim();
                    if (!mode.isEmpty() && !mode.equals("mysql")) {
                        throw new RuntimeException("表 " + t.name + " 使用 " + t.store.mode + " 存储；Java 原生运行时目前只支持 mysql，请改用 Node 运行时或把该表改回直连 MySQL");
                    }
                }
            }
        }

        Server server = new Server(svc);
        String port = env("PORT", "18100");
        HttpServer http = HttpServer.create(new InetSocketAddress("127.0.0.1", Integer.parseInt(port)), 0);
        http.createContext("/", server::handle);
        http.setExecutor(java.util.concurrent.Executors.newFixedThreadPool(24));
        http.start();
        System.out.println("ClickBuild Java 原生服务已启动：http://127.0.0.1:" + port + "  (接口 " + svc.interfaces.size() + " 个)");
    }

    static String env(String key, String def) {
        String v = System.getenv(key);
        return v == null || v.isEmpty() ? def : v;
    }
}

class Server {
    final Model.Service service;
    final Gson gson = new GsonBuilder().serializeNulls().create();
    final TokenStore tokens = new TokenStore();
    final List<RouteEntry> routes = new ArrayList<>();
    final String mysqlHost = Main.env("MYSQL_HOST", "127.0.0.1");
    final String mysqlPort = Main.env("MYSQL_PORT", "3306");
    final String mysqlUser = Main.env("MYSQL_USER", "root");
    final String mysqlPassword = Main.env("MYSQL_PASSWORD", "");
    final String mysqlDb = Main.env("MYSQL_DB", "clickbuild");

    Server(Model.Service svc) {
        this.service = svc;
        for (Model.Iface it : svc.interfaces) {
            String base = it.basePath == null ? "" : it.basePath.replaceAll("/+$", "");
            for (Model.Route r : it.routes) {
                String pattern = svc.apiPrefix + base + r.path;
                RouteEntry e = new RouteEntry(it, r, pattern);
                routes.add(e);
            }
        }
        routes.sort((a, b) -> Boolean.compare(b.specific, a.specific));
    }

    static class RouteEntry {
        final Model.Iface iface;
        final Model.Route route;
        final Pattern pattern;
        final List<String> keys = new ArrayList<>();
        final boolean specific;

        RouteEntry(Model.Iface iface, Model.Route route, String raw) {
            this.iface = iface;
            this.route = route;
            StringBuilder re = new StringBuilder("^");
            String[] parts = raw.split("/", -1);
            for (int i = 0; i < parts.length; i++) {
                if (i > 0) re.append("/");
                String seg = parts[i];
                if (seg.startsWith(":")) { keys.add(seg.substring(1)); re.append("([^/]+)"); }
                else if (seg.equals("*")) { keys.add("*"); re.append("(.*)"); }
                else re.append(Pattern.quote(seg));
            }
            re.append("/?$");
            pattern = Pattern.compile(re.toString());
            specific = !route.path.contains(":");
        }
    }

    void handle(HttpExchange ex) throws IOException {
        try (ex) {
            String path = ex.getRequestURI().getPath();
            cors(ex);
            if (ex.getRequestMethod().equalsIgnoreCase("OPTIONS")) { ex.sendResponseHeaders(204, -1); return; }
            if (!(path.startsWith(service.apiPrefix + "/") || path.equals(service.apiPrefix))) {
                serveStatic(ex, path);
                return;
            }
            List<RouteEntry> matched = new ArrayList<>();
            for (RouteEntry it : routes) {
                Matcher m = it.pattern.matcher(path);
                if (!m.matches()) continue;
                matched.add(it);
                if (it.route.method.equalsIgnoreCase(ex.getRequestMethod()) ||
                    (ex.getRequestMethod().equalsIgnoreCase("HEAD") && it.route.method.equalsIgnoreCase("GET"))) {
                    Map<String, Object> params = new LinkedHashMap<>();
                    for (int i = 0; i < it.keys.size(); i++) {
                        if (!it.keys.get(i).equals("*")) params.put(it.keys.get(i), m.group(i + 1));
                    }
                    handleRoute(ex, it, params);
                    return;
                }
            }
            if (!matched.isEmpty()) {
                List<String> allow = new ArrayList<>();
                for (RouteEntry e : matched) allow.add(e.route.method);
                ex.getResponseHeaders().set("Allow", String.join(", ", allow));
                sendJson(ex, 405, Map.of("ok", false, "error", "METHOD_NOT_ALLOWED"));
                return;
            }
            sendJson(ex, 404, Map.of("ok", false, "error", "NOT_FOUND", "path", path));
        } catch (Exception e) {
            e.printStackTrace();
            try { sendJson(ex, 500, Map.of("ok", false, "error", "SERVER_ERROR", "message", String.valueOf(e.getMessage()))); }
            catch (Exception ignored) { }
        }
    }

    void cors(HttpExchange ex) {
        Headers h = ex.getResponseHeaders();
        h.set("Access-Control-Allow-Origin", "*");
        h.set("Access-Control-Allow-Headers", "content-type,x-filename,x-content-type,authorization");
        h.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
        h.set("Cache-Control", "no-store");
    }

    void serveStatic(HttpExchange ex, String path) throws IOException {
        if (path.equals("/")) {
            Path f = Paths.get("public", "index.html");
            if (Files.exists(f)) { sendBytes(ex, 200, Files.readAllBytes(f), "text/html; charset=utf-8"); return; }
            sendBytes(ex, 200, ("<h1>ClickBuild Java 原生服务</h1><p>接口前缀 <code>" + service.apiPrefix + "</code></p>").getBytes(StandardCharsets.UTF_8), "text/html; charset=utf-8");
            return;
        }
        if (path.startsWith("/uploads/")) {
            Path f = Paths.get("uploads", path.substring("/uploads/".length())).normalize();
            if (f.startsWith("uploads") && Files.exists(f)) {
                sendBytes(ex, 200, Files.readAllBytes(f), "application/octet-stream");
                return;
            }
        }
        sendJson(ex, 404, Map.of("ok", false, "error", "NOT_FOUND"));
    }

    void handleRoute(HttpExchange ex, RouteEntry it, Map<String, Object> params) throws Exception {
        Model.Ctx ctx = new Model.Ctx();
        ctx.query = queryMap(ex.getRequestURI().getRawQuery());
        ctx.path = params;
        ctx.remoteIp = String.valueOf(ex.getRemoteAddress());
        ctx.traceId = Funcs.randomHex(8);
        ctx.now = ZonedDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        ctx.uuid = Funcs.randomHex(16);
        if (params.get("id") != null) ctx.id = params.get("id");
        else if (ctx.query.containsKey("id")) ctx.id = ctx.query.get("id");

        String ctype = ex.getRequestHeaders().getFirst("Content-Type");
        if (ctype == null) ctype = "";
        byte[] body = readAll(ex.getRequestBody());
        if (ctype.startsWith("multipart/form-data")) {
            Multipart mp = Multipart.parse(body, ctype);
            ctx.body = mp.fields;
            if (mp.file != null) ctx.file = saveUpload(mp.file);
        } else if (ctype.contains("application/json") && body.length > 0) {
            Object parsed = gson.fromJson(new String(body, StandardCharsets.UTF_8), Object.class);
            if (parsed instanceof Map<?, ?> m) {
                @SuppressWarnings("unchecked")
                Map<String, Object> mm = (Map<String, Object>) m;
                ctx.body = mm;
            }
        }

        String token = requestToken(ex);
        ctx.token = token;
        if (!token.isEmpty()) {
            Map<String, Object> user = tokens.get(token);
            if (user != null) {
                ctx.user = user;
                ctx.vars.put("user", user);
            }
        }
        if (it.route.auth && ctx.user.isEmpty()) {
            sendJson(ex, 401, Map.of("ok", false, "error", "UNAUTHORIZED"));
            return;
        }

        Model.ScriptResult res;
        Db db = new Db(mysqlHost, mysqlPort, mysqlUser, mysqlPassword, mysqlDb);
        try {
            if (!it.route.parseErrors.isEmpty()) throw new Exception("脚本解析失败：" + String.join("；", it.route.parseErrors));
            Script.Env env = new Script.Env(this, it.iface, it.route, ctx);
            env.db = db;
            if (it.route.tx) { db.begin(); env.inTx = true; }
            try {
                res = Script.execBlock(it.route.ast, env);
                if (env.inTx) { db.commit(); env.inTx = false; }
            } catch (Exception e) {
                if (env.inTx) { db.rollback(); env.inTx = false; }
                throw e;
            }
            if (res == null) { res = new Model.ScriptResult(); res.body = env.last; }
        } catch (Exception e) {
            e.printStackTrace();
            sendJson(ex, 500, Map.of("ok", false, "error", "SERVER_ERROR", "message", String.valueOf(e.getMessage()), "traceId", ctx.traceId));
            return;
        } finally {
            db.close();
        }
        if (res.status == 0) res.status = 200;
        if (!ctx.mintedToken.isEmpty()) {
            ex.getResponseHeaders().add("Set-Cookie", "icb_token=" + ctx.mintedToken + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200");
        }
        if (ctx.tokenDeleted) {
            ex.getResponseHeaders().add("Set-Cookie", "icb_token=; Path=/; HttpOnly; Max-Age=0");
        }
        sendJson(ex, res.status, res.body);
    }

    Map<String, Object> saveUpload(Multipart.FilePart fp) throws IOException {
        String ext = "";
        int dot = fp.filename.lastIndexOf('.');
        if (dot >= 0) ext = fp.filename.substring(dot);
        String key = Funcs.randomHex(8) + ext;
        String dir = Main.env("UPLOAD_DIR", "uploads");
        Files.createDirectories(Paths.get(dir));
        Files.write(Paths.get(dir, key), fp.data);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("filename", fp.filename);
        out.put("size", (double) fp.data.length);
        out.put("objectKey", key);
        out.put("objectUrl", "/uploads/" + key);
        out.put("contentType", fp.contentType);
        return out;
    }

    static String requestToken(HttpExchange ex) {
        String a = ex.getRequestHeaders().getFirst("Authorization");
        if (a != null && a.startsWith("Bearer ")) return a.substring(7).trim();
        String cookie = ex.getRequestHeaders().getFirst("Cookie");
        if (cookie != null) {
            for (String p : cookie.split(";")) {
                String[] kv = p.trim().split("=", 2);
                if (kv.length == 2 && kv[0].equals("icb_token")) return kv[1];
            }
        }
        return "";
    }

    static Map<String, Object> queryMap(String raw) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (raw == null || raw.isEmpty()) return out;
        for (String part : raw.split("&")) {
            String[] kv = part.split("=", 2);
            String k = decode(kv[0]);
            String v = kv.length > 1 ? decode(kv[1]) : "";
            if (out.containsKey(k)) {
                Object old = out.get(k);
                if (old instanceof List<?> list) {
                    @SuppressWarnings("unchecked") List<Object> l = (List<Object>) list;
                    l.add(v);
                } else {
                    List<Object> l = new ArrayList<>(); l.add(old); l.add(v); out.put(k, l);
                }
            } else out.put(k, v);
        }
        return out;
    }

    static String decode(String s) {
        try { return java.net.URLDecoder.decode(s, StandardCharsets.UTF_8); }
        catch (Exception e) { return s; }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0 && out.size() < 64 * 1024 * 1024) out.write(buf, 0, n);
        return out.toByteArray();
    }

    void sendJson(HttpExchange ex, int status, Object body) throws IOException {
        byte[] raw = gson.toJson(body).getBytes(StandardCharsets.UTF_8);
        sendBytes(ex, status, raw, "application/json; charset=utf-8");
    }

    void sendBytes(HttpExchange ex, int status, byte[] raw, String ctype) throws IOException {
        ex.getResponseHeaders().set("Content-Type", ctype);
        ex.sendResponseHeaders(status, raw.length == 0 ? -1 : raw.length);
        if (raw.length > 0) try (OutputStream os = ex.getResponseBody()) { os.write(raw); }
    }
}

class TokenStore {
    final Map<String, Map<String, Object>> data = new ConcurrentHashMap<>();

    Map<String, Object> mint(Map<String, Object> claims) {
        String token = Funcs.randomHex(24);
        int ttl = claims.get("ttl") instanceof Number n && n.doubleValue() > 0 ? n.intValue() : 7200;
        claims.put("iat", System.currentTimeMillis() / 1000);
        claims.put("exp", System.currentTimeMillis() / 1000 + ttl);
        data.put(token, claims);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("token", token);
        out.put("ttl", (long) ttl);
        out.put("onlyId", claims.get("onlyId"));
        return out;
    }

    Map<String, Object> get(String token) {
        if (token == null || token.isEmpty()) return null;
        Map<String, Object> c = data.get(token);
        if (c == null) return null;
        Object exp = c.get("exp");
        if (exp instanceof Number n && System.currentTimeMillis() / 1000 > n.doubleValue()) {
            data.remove(token);
            return null;
        }
        return c;
    }

    void remove(String token) { data.remove(token); }
}

class Multipart {
    Map<String, Object> fields = new LinkedHashMap<>();
    FilePart file;

    static class FilePart {
        String filename, contentType;
        byte[] data;
    }

    static Multipart parse(byte[] body, String ctype) {
        Multipart mp = new Multipart();
        String boundary = null;
        for (String p : ctype.split(";")) {
            p = p.trim();
            if (p.startsWith("boundary=")) boundary = p.substring(9).replace("\"", "");
        }
        if (boundary == null) return mp;
        byte[] delim = ("--" + boundary).getBytes(StandardCharsets.ISO_8859_1);
        int start = indexOf(body, delim, 0);
        while (start >= 0) {
            int headStart = start + delim.length;
            if (headStart + 1 < body.length && body[headStart] == '\r' && body[headStart + 1] == '\n') headStart += 2;
            int next = indexOf(body, delim, headStart);
            if (next < 0) break;
            int end = next;
            if (end >= 2 && body[end - 2] == '\r' && body[end - 1] == '\n') end -= 2;
            int sep = indexOf(body, "\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1), headStart);
            if (sep >= 0 && sep < end) {
                String headers = new String(body, headStart, sep - headStart, StandardCharsets.ISO_8859_1);
                byte[] data = Arrays.copyOfRange(body, sep + 4, end);
                String name = null, filename = null, contentType = "application/octet-stream";
                for (String line : headers.split("\r\n")) {
                    String low = line.toLowerCase();
                    if (low.startsWith("content-disposition:")) {
                        for (String piece : line.split(";")) {
                            piece = piece.trim();
                            if (piece.startsWith("name=")) name = piece.substring(5).replace("\"", "");
                            if (piece.startsWith("filename=")) filename = piece.substring(9).replace("\"", "");
                            try { if (filename != null) filename = java.net.URLDecoder.decode(filename, StandardCharsets.UTF_8); }
                            catch (Exception ignored) { }
                        }
                    } else if (low.startsWith("content-type:")) contentType = line.substring(13).trim();
                }
                if (filename != null) {
                    FilePart fp = new FilePart(); fp.filename = filename; fp.contentType = contentType; fp.data = data;
                    mp.file = fp;
                } else if (name != null) {
                    mp.fields.put(name, new String(data, StandardCharsets.UTF_8));
                }
            }
            start = next;
        }
        return mp;
    }

    static int indexOf(byte[] data, byte[] needle, int from) {
        outer:
        for (int i = Math.max(0, from); i <= data.length - needle.length; i++) {
            for (int j = 0; j < needle.length; j++) if (data[i + j] != needle[j]) continue outer;
            return i;
        }
        return -1;
    }
}
