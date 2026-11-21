// 作者：yxpil
package icb;

// 导出工程配置加载：系统环境变量 > config.json > 内置默认值。
// config.json 放在工程根目录；从 native/java 启动时会自动向上查找。

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

final class Config {
    private static final JsonObject ROOT = load();

    private Config() {}

    private static JsonObject load() {
        String[] candidates = new String[]{
            System.getenv("CBS_CONFIG"),
            "config.json",
            "../../config.json",
            "../../../config.json",
        };
        for (String file : candidates) {
            if (file == null || file.isEmpty()) continue;
            try {
                Path p = Paths.get(file);
                if (!Files.isRegularFile(p)) continue;
                String text = new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
                if (text.startsWith("\uFEFF")) text = text.substring(1);
                JsonElement el = JsonParser.parseString(text);
                if (el != null && el.isJsonObject()) {
                    System.out.println("[config] 已加载 " + p.toAbsolutePath());
                    return el.getAsJsonObject();
                }
            } catch (Exception e) {
                System.out.println("[config] 读取 " + file + " 失败：" + e.getMessage());
            }
        }
        return new JsonObject();
    }

    static String get(String key, String def) {
        String env = System.getenv(key);
        if (env != null && !env.isEmpty()) return env;
        JsonElement el = ROOT.get(key);
        if (el == null || el.isJsonNull()) return def;
        if (el.isJsonPrimitive()) {
            if (el.getAsJsonPrimitive().isBoolean()) return el.getAsBoolean() ? "true" : "false";
            return el.getAsString();
        }
        return el.toString();
    }
}
