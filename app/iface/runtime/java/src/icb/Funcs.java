package icb;

import com.google.gson.Gson;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.bouncycastle.crypto.engines.SM4Engine;
import org.bouncycastle.crypto.params.KeyParameter;

/** 表达式求值、类型转换与内置函数。 */
public class Funcs {
    static final Gson GSON = new Gson();
    static final SecureRandom RANDOM = new SecureRandom();

    public static String ascii(Object v) {
        if (v == null) return "";
        if (v instanceof String s) return s;
        if (v instanceof Double d) {
            if (d == Math.rint(d) && Math.abs(d) < 1e15) return String.valueOf(d.longValue());
            return String.valueOf(d);
        }
        if (v instanceof Float f) {
            if (f == Math.rint(f)) return String.valueOf(f.longValue());
            return String.valueOf(f);
        }
        if (v instanceof Boolean b) return b ? "true" : "false";
        return String.valueOf(v);
    }

    public static boolean truthy(Object v) {
        if (v == null) return false;
        if (v instanceof Boolean b) return b;
        if (v instanceof Number n) return n.doubleValue() != 0;
        if (v instanceof String s) return !s.isEmpty();
        if (v instanceof Collection<?> c) return !c.isEmpty();
        if (v instanceof Map<?, ?> m) return !m.isEmpty();
        return true;
    }

    public static double num(Object v) {
        if (v == null) return 0;
        if (v instanceof Number n) return n.doubleValue();
        if (v instanceof Boolean b) return b ? 1 : 0;
        try { return Double.parseDouble(ascii(v)); } catch (Exception e) { return 0; }
    }

    public static int toInt(Object v, int def, int min, int max) {
        double d;
        if (v instanceof Number n) d = n.doubleValue();
        else if (v instanceof String s && !s.isEmpty()) {
            try { d = Double.parseDouble(s); } catch (Exception e) { return def; }
        } else return def;
        int n = (int) d;
        if (n < min) return min;
        if (n > max) return max;
        return n;
    }

    public static int lengthOf(Object v) {
        if (v == null) return 0;
        if (v instanceof Collection<?> c) return c.size();
        if (v instanceof Map<?, ?> m) {
            if (m.containsKey("rows") && m.get("rows") instanceof Collection<?> rows) return rows.size();
            return m.size();
        }
        return ascii(v).codePointCount(0, ascii(v).length());
    }

    public static boolean looseEqual(Object a, Object b) {
        if (a == null || b == null) return a == null && b == null;
        if (a instanceof Number || b instanceof Number || a instanceof Boolean || b instanceof Boolean) {
            return num(a) == num(b);
        }
        return ascii(a).equals(ascii(b));
    }

    public static boolean compare(Object a, Object b, String op) {
        switch (op) {
            case "==": return looseEqual(a, b);
            case "!=": return !looseEqual(a, b);
            case ">": return num(a) > num(b);
            case "<": return num(a) < num(b);
            case ">=": return num(a) >= num(b);
            case "<=": return num(a) <= num(b);
            default: return false;
        }
    }

    public static Map<String, Object> obj(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    public static String randomHex(int bytes) {
        byte[] b = new byte[bytes];
        RANDOM.nextBytes(b);
        return hex(b);
    }

    static byte[] sha256(byte[] raw) {
        try { return MessageDigest.getInstance("SHA-256").digest(raw); }
        catch (Exception e) { throw new RuntimeException(e); }
    }

    public static String hashWith(String algo, Object v) {
        try {
            String name = algo.toLowerCase();
            MessageDigest md;
            if (name.equals("md5")) md = MessageDigest.getInstance("MD5");
            else if (name.equals("sha1")) md = MessageDigest.getInstance("SHA-1");
            else md = MessageDigest.getInstance("SHA-256");
            return hex(md.digest(ascii(v).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            return "";
        }
    }

    static byte[] key16(String key) {
        byte[] raw = key.getBytes(StandardCharsets.UTF_8);
        if (raw.length == 16) return raw;
        return Arrays.copyOf(sha256(raw), 16);
    }

    static byte[] pkcs7Pad(byte[] buf, int size) {
        int n = size - buf.length % size;
        if (n == 0) n = size;
        byte[] out = Arrays.copyOf(buf, buf.length + n);
        Arrays.fill(out, buf.length, out.length, (byte) n);
        return out;
    }

    static byte[] pkcs7Unpad(byte[] buf, int size) {
        if (buf.length == 0 || buf.length % size != 0) throw new RuntimeException("无效的填充");
        int n = buf[buf.length - 1] & 0xff;
        if (n <= 0 || n > size || n > buf.length) throw new RuntimeException("无效的填充");
        for (int i = buf.length - n; i < buf.length; i++) if ((buf[i] & 0xff) != n) throw new RuntimeException("无效的填充");
        return Arrays.copyOf(buf, buf.length - n);
    }

    public static String sm4Encrypt(String value, String key) {
        SM4Engine engine = new SM4Engine();
        engine.init(true, new KeyParameter(key16(key)));
        byte[] in = pkcs7Pad(value.getBytes(StandardCharsets.UTF_8), 16);
        byte[] out = new byte[in.length];
        for (int i = 0; i < in.length; i += 16) engine.processBlock(in, i, out, i);
        return Base64.getEncoder().encodeToString(out);
    }

    public static String sm4Decrypt(String value, String key) {
        SM4Engine engine = new SM4Engine();
        engine.init(false, new KeyParameter(key16(key)));
        byte[] in = Base64.getDecoder().decode(value);
        byte[] out = new byte[in.length];
        for (int i = 0; i < in.length; i += 16) engine.processBlock(in, i, out, i);
        return new String(pkcs7Unpad(out, 16), StandardCharsets.UTF_8);
    }

    static Cipher aesCipher(boolean enc, String key) throws Exception {
        Cipher c = Cipher.getInstance("AES/ECB/PKCS5Padding");
        c.init(enc ? Cipher.ENCRYPT_MODE : Cipher.DECRYPT_MODE, new SecretKeySpec(sha256(key.getBytes(StandardCharsets.UTF_8)), "AES"));
        return c;
    }

    public static String aesEncrypt(String value, String key) throws Exception {
        return Base64.getEncoder().encodeToString(aesCipher(true, key).doFinal(value.getBytes(StandardCharsets.UTF_8)));
    }

    public static String aesDecrypt(String value, String key) throws Exception {
        return new String(aesCipher(false, key).doFinal(Base64.getDecoder().decode(value)), StandardCharsets.UTF_8);
    }

    public static String hmac(String value, String key) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return hex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
    }

    @SuppressWarnings("unchecked")
    public static Object call(String name, List<Object> args, Script.Env env) {
        String up = name == null ? "" : name.trim().toUpperCase();
        for (Model.FunctionDef def : env.server.service.functions) {
            if (def.name != null && def.name.equalsIgnoreCase(name)) {
                Script.Env sub = env.subScope();
                for (int i = 0; i < def.params.size(); i++) sub.idents.put(def.params.get(i), i < args.size() ? args.get(i) : null);
                return sub.eval(def.ast);
            }
        }
        java.util.function.IntFunction<Object> arg = i -> i < args.size() ? args.get(i) : null;
        try {
            switch (up) {
                case "HASH": return hashWith(ascii(arg.apply(1)), arg.apply(0));
                case "MD5": return hashWith("md5", arg.apply(0));
                case "SHA1": return hashWith("sha1", arg.apply(0));
                case "SHA256": case "SM3": return hashWith("sha256", arg.apply(0));
                case "SM4_ENC": return sm4Encrypt(ascii(arg.apply(0)), ascii(arg.apply(1)));
                case "SM4_DEC": return sm4Decrypt(ascii(arg.apply(0)), ascii(arg.apply(1)));
                case "SUBSTR": {
                    String s = ascii(arg.apply(0));
                    int start = (int) num(arg.apply(1));
                    if (start < 0) start = s.length() + start;
                    if (start < 0) start = 0;
                    if (start > s.length()) start = s.length();
                    if (args.size() < 3 || arg.apply(2) == null) return s.substring(start);
                    int end = start + (int) num(arg.apply(2));
                    if (end > s.length()) end = s.length();
                    return s.substring(start, Math.max(start, end));
                }
                case "LEFT": {
                    String s = ascii(arg.apply(0)); int n = (int) num(arg.apply(1));
                    return s.substring(0, Math.max(0, Math.min(n, s.length())));
                }
                case "RIGHT": {
                    String s = ascii(arg.apply(0)); int n = (int) num(arg.apply(1));
                    if (n <= 0) return "";
                    if (n > s.length()) n = s.length();
                    return s.substring(s.length() - n);
                }
                case "LEN": case "COUNT": return (double) lengthOf(arg.apply(0));
                case "UPPER": return ascii(arg.apply(0)).toUpperCase();
                case "LOWER": return ascii(arg.apply(0)).toLowerCase();
                case "TRIM": return ascii(arg.apply(0)).trim();
                case "CONCAT": {
                    StringBuilder sb = new StringBuilder();
                    for (Object a : args) sb.append(ascii(a));
                    return sb.toString();
                }
                case "REPLACE": return ascii(arg.apply(0)).replace(ascii(arg.apply(1)), ascii(arg.apply(2)));
                case "SPLIT": {
                    String sep = args.size() > 1 ? ascii(arg.apply(1)) : ",";
                    List<Object> out = new ArrayList<>();
                    out.addAll(Arrays.asList(ascii(arg.apply(0)).split(java.util.regex.Pattern.quote(sep), -1)));
                    return out;
                }
                case "JOIN": {
                    String sep = args.size() > 1 ? ascii(arg.apply(1)) : ",";
                    List<String> parts = new ArrayList<>();
                    if (arg.apply(0) instanceof Collection<?> c) for (Object x : c) parts.add(ascii(x));
                    return String.join(sep, parts);
                }
                case "NOW": return new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new Date());
                case "TODAY": return new java.text.SimpleDateFormat("yyyy-MM-dd").format(new Date());
                case "UUID": return randomHex(8) + "-" + randomHex(4) + "-" + randomHex(4) + "-" + randomHex(4) + "-" + randomHex(12);
                case "BASE64_ENC": return Base64.getEncoder().encodeToString(ascii(arg.apply(0)).getBytes(StandardCharsets.UTF_8));
                case "BASE64_DEC": return new String(Base64.getDecoder().decode(ascii(arg.apply(0))), StandardCharsets.UTF_8);
                case "URL_ENC": return java.net.URLEncoder.encode(ascii(arg.apply(0)), "UTF-8");
                case "URL_DEC": return java.net.URLDecoder.decode(ascii(arg.apply(0)), "UTF-8");
                case "MASK": {
                    String s = ascii(arg.apply(0));
                    if (s.length() <= 2) return "*".repeat(s.length());
                    return s.substring(0, 1) + "*".repeat(s.length() - 2) + s.substring(s.length() - 1);
                }
                case "RAND_INT": {
                    int lo = (int) num(arg.apply(0)), hi = (int) num(arg.apply(1));
                    if (hi <= lo) return (double) lo;
                    return (double) (lo + RANDOM.nextInt(hi - lo + 1));
                }
                case "ABS": return Math.abs(num(arg.apply(0)));
                case "ROUND": {
                    int digits = args.size() > 1 ? (int) num(arg.apply(1)) : 0;
                    return BigDecimal.valueOf(num(arg.apply(0))).setScale(digits, java.math.RoundingMode.HALF_UP).doubleValue();
                }
                case "INT": return (double) (long) num(arg.apply(0));
                case "FLOAT": return num(arg.apply(0));
                case "STR": return ascii(arg.apply(0));
                case "IF": return truthy(arg.apply(0)) ? arg.apply(1) : arg.apply(2);
                case "COALESCE": for (Object a : args) if (a != null) return a; return null;
                case "JSON_GET": return jsonGet(arg.apply(0), ascii(arg.apply(1)));
                case "JSON_ENC": return GSON.toJson(arg.apply(0));
                case "JSON_DEC": return GSON.fromJson(ascii(arg.apply(0)), Object.class);
                case "SUM": case "MIN": case "MAX": {
                    Collection<?> arr = arg.apply(0) instanceof Collection<?> c ? c : null;
                    if (arg.apply(0) instanceof Map<?, ?> m && m.get("rows") instanceof Collection<?> r) arr = r;
                    if (arr == null || arr.isEmpty()) return 0.0;
                    double sum = 0, best = num(arr.iterator().next());
                    for (Object a : arr) {
                        double n = num(a); sum += n;
                        if (up.equals("MIN") && n < best) best = n;
                        if (up.equals("MAX") && n > best) best = n;
                    }
                    return up.equals("SUM") ? sum : best;
                }
                case "HMAC": return hmac(ascii(arg.apply(0)), ascii(arg.apply(1)));
                case "AES_ENC": return aesEncrypt(ascii(arg.apply(0)), ascii(arg.apply(1)));
                case "AES_DEC": return aesDecrypt(ascii(arg.apply(0)), ascii(arg.apply(1)));
                default: return null;
            }
        } catch (Exception e) {
            System.out.println("[WARN] 函数 " + name + " 执行失败：" + e.getMessage());
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    public static Object jsonGet(Object obj, String path) {
        Object cur = obj;
        for (String p : path.split(".")) {
            if (cur == null) return null;
            if (cur instanceof Map<?, ?> m) cur = m.get(p);
            else if (cur instanceof List<?> l) {
                try {
                    int n = Integer.parseInt(p);
                    cur = n >= 0 && n < l.size() ? l.get(n) : null;
                } catch (Exception e) { return null; }
            } else return null;
        }
        return cur;
    }
}
