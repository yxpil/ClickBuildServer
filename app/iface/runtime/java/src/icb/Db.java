package icb;

import java.sql.*;
import java.util.*;

/** MySQL 访问：查询、写入与事务。每个请求持有一条连接。 */
public class Db {
    final Connection conn;

    Db(String host, String port, String user, String password, String database) throws Exception {
        Class.forName("com.mysql.cj.jdbc.Driver");
        String url = "jdbc:mysql://" + host + ":" + port + "/" + database +
            "?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true";
        conn = DriverManager.getConnection(url, user, password);
        conn.setAutoCommit(true);
    }

    void begin() throws SQLException { conn.setAutoCommit(false); }
    void commit() throws SQLException { conn.commit(); conn.setAutoCommit(true); }
    void rollback() throws SQLException { if (!conn.getAutoCommit()) conn.rollback(); conn.setAutoCommit(true); }
    void close() { try { conn.close(); } catch (Exception ignored) { } }

    public List<Map<String, Object>> query(String sql, List<Object> params) throws SQLException {
        if (System.getenv("DEBUG_SQL") != null) System.out.println("[SQL] " + sql + " params=" + params);
        try (PreparedStatement ps = prepare(sql, params); ResultSet rs = ps.executeQuery()) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            List<Map<String, Object>> rows = new ArrayList<>();
            while (rs.next()) {
                Map<String, Object> row = new LinkedHashMap<>();
                for (int i = 1; i <= n; i++) {
                    Object v = rs.getObject(i);
                    if (v instanceof byte[] b) v = new String(b, java.nio.charset.StandardCharsets.UTF_8);
                    else if (v instanceof java.sql.Timestamp ts) v = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(ts);
                    else if (v instanceof java.sql.Date d) v = d.toString();
                    else if (v instanceof java.time.LocalDateTime dt) v = dt.format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
                    else if (v instanceof java.time.LocalDate d) v = d.toString();
                    else if (v instanceof java.time.LocalTime t) v = t.toString();
                    else if (v instanceof java.math.BigDecimal bd) v = bd.doubleValue();
                    else if (v instanceof java.math.BigInteger bi) v = bi.doubleValue();
                    row.put(md.getColumnLabel(i), v);
                }
                rows.add(row);
            }
            return rows;
        }
    }

    public Model.DBResult exec(String sql, List<Object> params) throws SQLException {
        if (System.getenv("DEBUG_SQL") != null) System.out.println("[EXEC] " + sql + " params=" + params);
        try (PreparedStatement ps = prepare(sql, params)) {
            Model.DBResult r = new Model.DBResult();
            r.affectedRows = ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                if (keys.next()) { r.insertId = keys.getLong(1); r.lastInsertId = r.insertId; }
            }
            return r;
        }
    }

    PreparedStatement prepare(String sql, List<Object> params) throws SQLException {
        PreparedStatement ps = conn.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
        if (params != null) {
            for (int i = 0; i < params.size(); i++) {
                Object v = params.get(i);
                if (v == null) ps.setNull(i + 1, Types.NULL);
                else if (v instanceof Double d) {
                    if (d == Math.rint(d)) ps.setLong(i + 1, d.longValue());
                    else ps.setDouble(i + 1, d);
                } else if (v instanceof Number n) ps.setDouble(i + 1, n.doubleValue());
                else if (v instanceof Boolean b) ps.setBoolean(i + 1, b);
                else ps.setString(i + 1, Funcs.ascii(v));
            }
        }
        return ps;
    }
}
