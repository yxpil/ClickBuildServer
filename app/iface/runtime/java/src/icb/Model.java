package icb;

import com.google.gson.annotations.SerializedName;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class Model {
    public static class Field {
        public String name = "";
        public String type = "varchar";
        public String comment = "";
        public boolean pk;
        public boolean auto;
        public boolean hidden;
        public boolean query = true;
        public boolean writable = true;
        public boolean search;

        @SerializedName("default")
        public String def = "";
    }

    public static class Store {
        public String mode = "mysql";
        public int ttl;
        public int max = 10000;
        public int flushMs = 5000;
    }

    public static class Table {
        public String key = "main";
        public String name = "";
        public String schema = "";
        public String comment = "";
        public Store store = new Store();
        public List<Field> fields = new ArrayList<>();
    }

    public static class Cache {
        public boolean enabled;
        public int ttl = 60;
    }

    public static class Route {
        public String id = "";
        public String key = "";
        public String name = "";
        public String method = "GET";
        public String path = "/";
        public boolean auth;
        public boolean tx;
        public Cache cache = new Cache();
        public String script = "";
        public List<Object> ast = new ArrayList<>();
        public List<String> parseErrors = new ArrayList<>();
    }

    public static class Iface {
        public String id = "";
        public String name = "";
        public String comment = "";
        public String basePath = "";
        public List<Table> tables = new ArrayList<>();
        public List<Route> routes = new ArrayList<>();
    }

    public static class FunctionDef {
        public String name = "";
        public List<String> params = new ArrayList<>();
        public Object ast;
    }

    public static class Service {
        public String format = "";
        public int version;
        public String name = "";
        public String apiPrefix = "/api";
        public Map<String, Object> page = new LinkedHashMap<>();
        public Map<String, Object> storage = new LinkedHashMap<>();
        public List<FunctionDef> functions = new ArrayList<>();
        public List<Iface> interfaces = new ArrayList<>();
    }

    public static class Ctx {
        public Map<String, Object> query = new LinkedHashMap<>();
        public Map<String, Object> body = new LinkedHashMap<>();
        public Map<String, Object> path = new LinkedHashMap<>();
        public Map<String, Object> file;
        public Map<String, Object> user = new LinkedHashMap<>();
        public Map<String, Object> env = new LinkedHashMap<>();
        public Map<String, Object> vars = new LinkedHashMap<>();
        public Object last;
        public Object id;
        public String now = "";
        public String uuid = "";
        public String token = "";
        public String remoteIp = "";
        public String traceId = "";
        public String mintedToken = "";
        public String mintedOnlyId = "";
        public boolean tokenDeleted;
    }

    public static class ScriptResult {
        public int status = 200;
        public Object body;
    }

    public static class DBResult {
        public long insertId;
        public long affectedRows;
        public long lastInsertId;
    }
}
