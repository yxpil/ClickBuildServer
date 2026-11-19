'use strict';
/** Java 工程：公共基础设施 + 配置 + 安全 */

const N = require('./naming');

const jstr = (s) => JSON.stringify(String(s == null ? '' : s));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function baseEntity(ir) {
  const p = ir.project;
  const idType = p.idStrategy === 'ulid' || p.idStrategy === 'uuid' ? 'String' : 'Long';
  const t = ir.tenant;
  return `package ${p.groupId}.common;

import com.baomidou.mybatisplus.annotation.*;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.Data;

import java.io.Serializable;
import java.time.LocalDateTime;

/**
 * 统一基类：所有业务表共享同一套主键 / 审计 / 租户 / 乐观锁 / 逻辑删除字段。
 * ID 策略：${p.idStrategy}
 */
@Data
public class BaseEntity implements Serializable {

    @TableId(type = IdType.${p.idStrategy === 'auto' ? 'AUTO' : 'ASSIGN_ID'})
    private ${idType} id;

${t ? `    @TableField(fill = FieldFill.INSERT)
    private Long tenantId;

` : ''}    @Version
    @TableField(fill = FieldFill.INSERT)
    private Integer version;

    @TableField(value = "created_at", fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(value = "updated_at", fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableField(value = "created_by", fill = FieldFill.INSERT)
    private Long createdBy;

    @TableField(value = "updated_by", fill = FieldFill.INSERT_UPDATE)
    private Long updatedBy;

    @TableLogic
    @JsonIgnore
    @TableField(fill = FieldFill.INSERT)
    private Integer deleted;
}
`;
}

function idGen(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.common`;
  if (p.idStrategy === 'auto') {
    return `package ${pkg};

/** 数据库自增模式：无需应用侧生成 ID。 */
public final class IdGen {
    private IdGen() {}
    public static Long nextId() {
        throw new UnsupportedOperationException("idStrategy=auto 由数据库自增");
    }
}
`;
  }
  if (p.idStrategy === 'ulid' || p.idStrategy === 'uuid') {
    return `package ${pkg};

import java.util.UUID;

/** 统一 ID：${p.idStrategy.toUpperCase()}。全局唯一、可直接暴露给前端。 */
public final class IdGen {
    private IdGen() {}

    public static String nextId() {
        return UUID.randomUUID().toString().replace("-", "");
    }
}
`;
  }
  return `package ${pkg};

/**
 * 统一 ID：雪花算法（64 位，趋势递增，含 workerId 与毫秒时间戳）。
 * 所有业务表统一使用该生成器，避免自增 ID 暴露数据量。
 */
public final class IdGen {
    private static final long EPOCH = 1704067200000L; // 2024-01-01
    private static final long WORKER_BITS = 10L;
    private static final long SEQ_BITS = 12L;
    private static final long MAX_WORKER = ~(-1L << WORKER_BITS);
    private static final long MAX_SEQ = ~(-1L << SEQ_BITS);
    private static final long WORKER_ID = Math.max(0, Math.min(MAX_WORKER, ${Number(p.port) % 1024}L));
    private static long lastTs = -1L;
    private static long seq = 0L;

    private IdGen() {}

    public static synchronized long nextId() {
        long ts = System.currentTimeMillis();
        if (ts < lastTs) { ts = lastTs; }
        if (ts == lastTs) {
            seq = (seq + 1) & MAX_SEQ;
            if (seq == 0) {
                while (ts <= lastTs) { ts = System.currentTimeMillis(); }
            }
        } else {
            seq = 0;
        }
        lastTs = ts;
        return ((ts - EPOCH) << (WORKER_BITS + SEQ_BITS)) | (WORKER_ID << SEQ_BITS) | seq;
    }
}
`;
  }

function apiResult(ir) {
  const pkg = `${ir.project.groupId}.common`;
  return `package ${pkg};

import lombok.Data;

@Data
public class ApiResult<T> {
    private int code;
    private String message;
    private T data;
    private long timestamp = System.currentTimeMillis();

    public static <T> ApiResult<T> ok(T data) {
        ApiResult<T> r = new ApiResult<>();
        r.code = 0;
        r.message = "ok";
        r.data = data;
        return r;
    }

    public static <T> ApiResult<T> ok() { return ok(null); }

    public static <T> ApiResult<T> fail(int code, String message) {
        ApiResult<T> r = new ApiResult<>();
        r.code = code;
        r.message = message;
        return r;
    }
}
`;
}

function pageResult(ir) {
  const pkg = `${ir.project.groupId}.common`;
  return `package ${pkg};

import com.baomidou.mybatisplus.core.metadata.IPage;
import lombok.Data;

import java.util.List;

@Data
public class PageResult<T> {
    private long page;
    private long size;
    private long total;
    private List<T> records;

    public static <T> PageResult<T> of(IPage<T> p) {
        PageResult<T> r = new PageResult<>();
        r.page = p.getCurrent();
        r.size = p.getSize();
        r.total = p.getTotal();
        r.records = p.getRecords();
        return r;
    }

    public static <T> PageResult<T> of(long page, long size, long total, List<T> records) {
        PageResult<T> r = new PageResult<>();
        r.page = page;
        r.size = size;
        r.total = total;
        r.records = records;
        return r;
    }
}
`;
}

function exceptionFiles(ir) {
  const pkg = `${ir.project.groupId}.common`;
  return [
    {
      path: `src/main/java/${ir.pkgPath}/common/BizException.java`,
      content: `package ${pkg};

public class BizException extends RuntimeException {
    private final int code;

    public BizException(String message) { this(400, message); }

    public BizException(int code, String message) {
        super(message);
        this.code = code;
    }

    public int getCode() { return code; }
}
`,
    },
    {
      path: `src/main/java/${ir.pkgPath}/common/GlobalExceptionHandler.java`,
      content: `package ${pkg};

import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BizException.class)
    public ApiResult<Void> biz(BizException e) {
        return ApiResult.fail(e.getCode(), e.getMessage());
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, ConstraintViolationException.class})
    public ApiResult<Void> invalid(Exception e) {
        String msg = e instanceof MethodArgumentNotValidException m
                ? (m.getBindingResult().getFieldError() == null ? "参数不合法" : m.getBindingResult().getFieldError().getDefaultMessage())
                : e.getMessage();
        return ApiResult.fail(400, msg);
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ApiResult<Void> other(Exception e) {
        log.error("unhandled error", e);
        return ApiResult.fail(500, "服务内部错误");
    }
}
`,
    },
  ];
}

function loginUser(ir) {
  const pkg = `${ir.project.groupId}.security`;
  return `package ${pkg};

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.Set;

@Data
@AllArgsConstructor
public class LoginUser {
    private Long userId;
    private String username;
    private String tokenId;
    private Set<String> perms;

    public boolean hasPerm(String code) {
        return perms != null && (perms.contains("*") || perms.contains(code));
    }
}
`;
}

function contextHolder(ir) {
  const pkg = `${ir.project.groupId}.common`;
  return `package ${pkg};

import ${ir.project.groupId}.security.LoginUser;

/** 请求级上下文：登录用户 + 租户。由拦截器写入，业务代码直接读取。 */
public final class UserContext {
    private static final ThreadLocal<LoginUser> USER = new ThreadLocal<>();
    private static final ThreadLocal<String> LUID = new ThreadLocal<>();

    private UserContext() {}

    public static void set(LoginUser u) { USER.set(u); }
    public static LoginUser get() { return USER.get(); }
    public static void setLuid(String luid) { LUID.set(luid); }
    public static String luid() { return LUID.get() == null ? "" : LUID.get(); }
    public static Long userId() {
        LoginUser u = USER.get();
        return u == null ? 0L : u.getUserId();
    }
    public static String username() {
        LoginUser u = USER.get();
        return u == null ? "anonymous" : u.getUsername();
    }
    /** 是否超管（拥有 * 权限）：超管不受数据归属限制 */
    public static boolean isSuper() {
        LoginUser u = USER.get();
        return u != null && u.hasPerm("*");
    }
    public static void clear() { USER.remove(); LUID.remove(); }
}
`;
}

function tenantHolder(ir) {
  const pkg = `${ir.project.groupId}.common`;
  return `package ${pkg};

/** 多租户上下文（由登录令牌中的 tenantId 写入）。 */
public final class TenantContext {
    private static final ThreadLocal<Long> TENANT = new ThreadLocal<>();

    private TenantContext() {}

    public static void set(Long t) { TENANT.set(t); }
    public static Long get() { return TENANT.get(); }
    public static long current() { return TENANT.get() == null ? 0L : TENANT.get(); }
    public static void clear() { TENANT.remove(); }
}
`;
}

function metaHandler(ir) {
  const pkg = `${ir.project.groupId}.common`;
  const t = ir.tenant;
  return `package ${pkg};

import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import ${ir.project.groupId}.common.TenantContext;
import org.apache.ibatis.reflection.MetaObject;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/** 统一填充审计字段 / 租户 / 版本 / 逻辑删除标记。 */
@Component
public class MetaHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject meta) {
        LocalDateTime now = LocalDateTime.now();
        strictInsertFill(meta, "createdAt", LocalDateTime.class, now);
        strictInsertFill(meta, "updatedAt", LocalDateTime.class, now);
        strictInsertFill(meta, "createdBy", Long.class, UserContext.userId());
        strictInsertFill(meta, "updatedBy", Long.class, UserContext.userId());
        strictInsertFill(meta, "version", Integer.class, 0);
        strictInsertFill(meta, "deleted", Integer.class, 0);
${t ? '        strictInsertFill(meta, "tenantId", Long.class, TenantContext.current());\n' : ''}    }

    @Override
    public void updateFill(MetaObject meta) {
        strictUpdateFill(meta, "updatedAt", LocalDateTime.class, LocalDateTime.now());
        strictUpdateFill(meta, "updatedBy", Long.class, UserContext.userId());
    }
}
`;
}

function appProps(ir) {
  const p = ir.project;
  return `package ${p.groupId}.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.ArrayList;
import java.util.List;

@Data
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private Security security = new Security();
    private Storage storage = new Storage();
    private Search search = new Search();

    @Data
    public static class Security {
        private String jwtSecret = "${p.security.jwtSecret}";
        private String cookieName = "${p.security.cookieName}";
        private long ttlSeconds = ${p.security.ttlSeconds};
        private String initAdmin = "${p.security.initAdmin}";
        private String initPassword = "${p.security.initPassword}";
    }

    @Data
    public static class Storage {
        private String provider = "${p.storage.provider}";
        private String endpoint = "${p.storage.endpoint}";
        private String publicBase = "${p.storage.publicBase}";
        private String bucket = "${p.storage.bucket}";
        private String accessKey = "${p.storage.accessKey}";
        private String secretKey = "${p.storage.secretKey}";
        private String localDir = "${p.storage.localDir}";
    }

    @Data
    public static class Search {
        private String engine = "${p.search.engine}";
        private List<String> esNodes = new ArrayList<>();
        private String indexPrefix = "cb";
    }
}
`;
}

function mybatisConfig(ir) {
  const pkg = `${ir.project.groupId}.config`;
  const t = ir.tenant;
  const tenantImports = t
    ? `import com.baomidou.mybatisplus.extension.plugins.inner.TenantLineInnerInterceptor;\nimport ${ir.project.groupId}.common.TenantContext;\nimport net.sf.jsqlparser.expression.Expression;\nimport net.sf.jsqlparser.expression.LongValue;\nimport com.baomidou.mybatisplus.extension.plugins.handler.TenantLineHandler;\n`
    : '';
  const tenantBean = t ? `        TenantLineInnerInterceptor tenant = new TenantLineInnerInterceptor(new TenantLineHandler() {
            @Override
            public Expression getTenantId() { return new LongValue(TenantContext.current()); }

            @Override
            public String getTenantIdColumn() { return "tenant_id"; }

            @Override
            public boolean ignoreTable(String tableName) {
                return tableName.startsWith("sys_tenant") || tableName.startsWith("sys_permission")
                        || tableName.startsWith("sys_role") || tableName.startsWith("sys_user_role");
            }
        });
        interceptor.addInnerInterceptor(tenant);
` : '';
  return `package ${pkg};

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.core.incrementer.IdentifierGenerator;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import ${ir.project.groupId}.common.IdGen;
${tenantImports}import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MybatisConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
${tenantBean}        interceptor.addInnerInterceptor(new PaginationInnerInterceptor(DbType.MYSQL));
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
        return interceptor;
    }

    @Bean
    public IdentifierGenerator identifierGenerator() {
        return entity -> IdGen.nextId();
    }
}
`;
}

function redisConfig(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.config`;
  const mode = p.redis.mode;
  if (mode === 'cluster') {
    return `package ${pkg};

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.List;

@Configuration
public class RedisConfig {

    @Bean
    public RedisConnectionFactory redisConnectionFactory() {
        RedisClusterConfiguration cluster = new RedisClusterConfiguration(List.of(${p.redis.nodes.map((n) => jstr(n)).join(', ')}));
${p.redis.password ? `        cluster.setPassword("${p.redis.password}");\n` : ''}        LettuceConnectionFactory factory = new LettuceConnectionFactory(cluster);
        factory.afterPropertiesSet();
        return factory;
    }

    @Bean
    public StringRedisTemplate stringRedisTemplate(RedisConnectionFactory factory) {
        return new StringRedisTemplate(factory);
    }
}
`;
  }
  if (mode === 'sentinel') {
    return `package ${pkg};

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisSentinelConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.List;

@Configuration
public class RedisConfig {

    @Bean
    public LettuceConnectionFactory redisConnectionFactory() {
        RedisSentinelConfiguration sentinel = new RedisSentinelConfiguration("mymaster", new java.util.HashSet<>(List.of(${p.redis.nodes.map((n) => jstr(n)).join(', ')})));
${p.redis.password ? `        sentinel.setPassword("${p.redis.password}");\n` : ''}        LettuceConnectionFactory factory = new LettuceConnectionFactory(sentinel);
        factory.afterPropertiesSet();
        return factory;
    }

    @Bean
    public StringRedisTemplate stringRedisTemplate(LettuceConnectionFactory factory) {
        return new StringRedisTemplate(factory);
    }
}
`;
  }
  return `package ${pkg};

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

@Configuration
public class RedisConfig {

    @Bean
    public LettuceConnectionFactory redisConnectionFactory() {
        String node = "${p.redis.nodes[0] || '127.0.0.1:6379'}";
        String[] parts = node.split(":");
        RedisStandaloneConfiguration cfg = new RedisStandaloneConfiguration(parts[0], Integer.parseInt(parts[1]));
        cfg.setDatabase(${p.redis.db});
${p.redis.password ? `        cfg.setPassword("${p.redis.password}");\n` : ''}        LettuceConnectionFactory factory = new LettuceConnectionFactory(cfg);
        factory.afterPropertiesSet();
        return factory;
    }

    @Bean
    public StringRedisTemplate stringRedisTemplate(LettuceConnectionFactory factory) {
        return new StringRedisTemplate(factory);
    }
}
`;
}

function securityConfig(ir) {
  const pkg = `${ir.project.groupId}.config`;
  return `package ${pkg};

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class SecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
`;
}

function jwtUtil(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.security`;
  return `package ${pkg};

import ${p.groupId}.config.AppProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

@Component
public class JwtUtil {

    private final AppProperties props;
    private final SecretKey key;

    public JwtUtil(AppProperties props) {
        this.props = props;
        this.key = Keys.hmacShaKeyFor(props.getSecurity().getJwtSecret().getBytes(StandardCharsets.UTF_8));
    }

    public String create(Long userId, String username, String tokenId, Long tenantId) {
        return create(userId, username, tokenId, tenantId, "");
    }

    /** luid：逻辑用户编号（只有服务端知道它映射到谁），随令牌下发并写入缓存 */
    public String create(Long userId, String username, String tokenId, Long tenantId, String luid) {
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .claim("username", username)
                .claim("tid", tokenId)
                .claim("luid", luid == null ? "" : luid)
${ir.tenant ? '                .claim("tenantId", tenantId)\n' : ''}                .issuedAt(new Date(now))
                .expiration(new Date(now + props.getSecurity().getTtlSeconds() * 1000))
                .signWith(key)
                .compact();
    }

    public Claims parse(String token) {
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    }
}
`;
}

function cookieUtil(ir) {
  const pkg = `${ir.project.groupId}.security`;
  return `package ${pkg};

import ${ir.project.groupId}.config.AppProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

@Component
public class CookieUtil {

    private final AppProperties props;

    public CookieUtil(AppProperties props) { this.props = props; }

    public void write(HttpServletResponse response, String token) {
        ResponseCookie cookie = ResponseCookie.from(props.getSecurity().getCookieName(), token)
                .httpOnly(true)
                .secure(false)
                .path("/")
                .maxAge(props.getSecurity().getTtlSeconds())
                .sameSite("Lax")
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    public void clear(HttpServletResponse response) {
        ResponseCookie cookie = ResponseCookie.from(props.getSecurity().getCookieName(), "")
                .httpOnly(true).path("/").maxAge(0).build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    public String read(HttpServletRequest request) {
        if (request.getCookies() == null) return null;
        for (Cookie c : request.getCookies()) {
            if (props.getSecurity().getCookieName().equals(c.getName())) return c.getValue();
        }
        return null;
    }
}
`;
}

function requirePerm(ir) {
  const pkg = `${ir.project.groupId}.security`;
  return `package ${pkg};

import java.lang.annotation.*;

/** 声明式权限校验：@RequirePerm("order:create")，值为 * 表示仅需登录。 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface RequirePerm {
    String value();
}
`;
}

function opLog(ir) {
  const pkg = `${ir.project.groupId}.security`;
  return `package ${pkg};

import java.lang.annotation.*;

/** 操作日志注解，由 OperationLogAspect 统一落库。 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface OpLog {
    String module();
    String action();
}
`;
}

function authInterceptor(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.security`;
  const tenant = ir.tenant;
  return `package ${pkg};

import ${p.groupId}.common.BizException;
import ${p.groupId}.common.TenantContext;
import ${p.groupId}.common.UserContext;
import io.jsonwebtoken.Claims;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Set;

@Component
@RequiredArgsConstructor
public class AuthInterceptor implements HandlerInterceptor {

    private final JwtUtil jwtUtil;
    private final CookieUtil cookieUtil;
    private final ${ir.project.groupId}.security.LuidCache luidCache;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (HttpMethod.OPTIONS.matches(request.getMethod())) return true;
        String path = request.getRequestURI();
        if (path.contains("/auth/login") || path.contains("/captcha") || path.contains("/v3/api-docs")
                || path.contains("/swagger-ui") || path.contains("/actuator")) {
            return true;
        }
        // 逻辑用户编号优先：命中缓存就不再查库，登出即失效
        String headerLuid = request.getHeader("X-Luid");
        if (headerLuid != null && !headerLuid.isBlank()) {
            var cached = luidCache.load(headerLuid);
            if (cached != null) {
                UserContext.set(cached);
                UserContext.setLuid(headerLuid);
                return true;
            }
        }
        String token = resolveToken(request);
        if (token == null) throw new BizException(401, "未登录或登录已过期");
        Claims claims;
        try {
            claims = jwtUtil.parse(token);
        } catch (Exception e) {
            throw new BizException(401, "令牌无效或已过期");
        }
        Object luidObj = claims.get("luid");
        String luid = luidObj == null ? "" : String.valueOf(luidObj);
        if (!luid.isBlank()) {
            var cached = luidCache.load(luid);
            if (cached != null) {
                UserContext.set(cached);
                UserContext.setLuid(luid);
                return true;
            }
        }
        Long userId = Long.valueOf(claims.getSubject());
        Set<String> perms = PermCache.get(userId);
        UserContext.set(new LoginUser(userId, String.valueOf(claims.get("username")), String.valueOf(claims.get("tid")), perms));
        UserContext.setLuid(luid);
${tenant ? `        Object tid = claims.get("tenantId");
        TenantContext.set(tid == null ? 0L : Long.valueOf(String.valueOf(tid)));
` : ''}        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        UserContext.clear();${tenant ? '\n        TenantContext.clear();' : ''}
    }

    private String resolveToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) return header.substring(7);
        String xToken = request.getHeader("X-Token");
        if (xToken != null && !xToken.isBlank()) return xToken;
        return cookieUtil.read(request);
    }
}
`;
}

function permCache(ir) {
  const pkg = `${ir.project.groupId}.security`;
  return `package ${pkg};

import ${ir.project.groupId}.support.RbacService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Set;

/** 权限读取的静态桥：供拦截器使用（避免拦截器与 Service 循环依赖）。 */
@Component
public class PermCache {

    private static RbacService rbacService;

    @Autowired
    public void setRbacService(RbacService service) { PermCache.rbacService = service; }

    public static Set<String> get(Long userId) {
        if (rbacService == null) return Collections.emptySet();
        return rbacService.permsOf(userId);
    }
}
`;
}

function permissionInterceptor(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.security`;
  return `package ${pkg};

import ${p.groupId}.common.BizException;
import ${p.groupId}.common.UserContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

@Component
public class PermissionInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(handler instanceof HandlerMethod method)) return true;
        RequirePerm perm = method.getMethodAnnotation(RequirePerm.class);
        if (perm == null) perm = method.getBeanType().getAnnotation(RequirePerm.class);
        if (perm == null) return true;
        LoginUser user = UserContext.get();
        if (user == null) throw new BizException(401, "未登录");
        if ("*".equals(perm.value())) return true;
        if (!user.hasPerm(perm.value())) throw new BizException(403, "无权限：" + perm.value());
        return true;
    }
}
`;
}

function webConfig(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.config`;
  const extra = [];
  if (p.integrations.rateLimit) extra.push(`        registry.addInterceptor(new RateLimitInterceptor(stringRedisTemplate)).addPathPatterns("/**");`);
  const cors = ir.waf.cors;
  const originExpr = cors.origins.includes('*')
    ? '.allowedOriginPatterns("*")'
    : (cors.credentials
      ? `.allowedOriginPatterns(${cors.origins.map((o) => `"${o}"`).join(', ')})`
      : `.allowedOrigins(${cors.origins.map((o) => `"${o}"`).join(', ')})`);
  const corsBody = cors.enabled
    ? `        registry.addMapping("/**")
                ${originExpr}
                .allowedMethods(${cors.methods.map((m) => `"${m}"`).join(', ')})
                .allowedHeaders(${cors.headers.map((h) => `"${h}"`).join(', ')})
                .exposedHeaders("X-Luid")
                .allowCredentials(${cors.credentials})
                .maxAge(3600);`
    : `        // CORS 已关闭：只有同源请求可用（网关 / Nginx 层负责跨域时从这里打开）`;
  return `package ${pkg};

${p.redis.enabled ? 'import org.springframework.data.redis.core.StringRedisTemplate;\n' : ''}import ${p.groupId}.security.AuthInterceptor;
import ${p.groupId}.security.PermissionInterceptor;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@RequiredArgsConstructor
public class WebConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;
    private final PermissionInterceptor permissionInterceptor;
${p.redis.enabled && p.integrations.rateLimit ? '    private final StringRedisTemplate stringRedisTemplate;\n' : ''}
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor).addPathPatterns("/**")
                .excludePathPatterns("/health", "/healthz");
        registry.addInterceptor(permissionInterceptor).addPathPatterns("/**")
                .excludePathPatterns("/health", "/healthz");
${extra.join('\n')}
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
${corsBody}
    }
}
`;
}

/** 多库多集群注册表：连接池 / 健康检查 / 权重分流 / 写租约（防脑裂）。 */
function dbClusterRegistry(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.config`;
  const db = p.database;
  const routing = db.routing;
  const fail = db.failover;
  const jdbc = (c) => `jdbc:mysql://${c.host}:${c.port}/${c.database}?useUnicode=true&characterEncoding=utf8&useSSL=false&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true`;
  const nodes = (ir.clusters || []).map((c) => `        nodes.add(new Node(${JSON.stringify(c.name)}, ${JSON.stringify(c.role)}, ${JSON.stringify(jdbc(c))}, ${JSON.stringify(c.user || '')}, ${JSON.stringify(c.password || '')}, ${c.weight}, ${c.readonly}));`).join('\n');
  const primary = (ir.clusters || []).find((c) => c.role === 'primary' && !c.readonly) || (ir.clusters || [])[0];
  return `package ${pkg};

import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 多库多集群注册表（生成期固化配置）：
 *  - 每个集群一个 Hikari 池，按 weight 做分流
 *  - 健康检查失败 {@code FAILOVER_THRESHOLD} 次摘除节点，恢复后自动加回
 *  - 写操作前抢 Redis 租约，租约被别的实例持有就拒写 —— 这是防脑裂的那道闸
 */
@Slf4j
@Component
public class DbClusterRegistry {

    public static final class Node {
        public final String name;
        public final String role;
        public final String jdbcUrl;
        public final String user;
        public final String password;
        public final int weight;
        public final boolean readonly;

        public Node(String name, String role, String jdbcUrl, String user, String password, int weight, boolean readonly) {
            this.name = name;
            this.role = role;
            this.jdbcUrl = jdbcUrl;
            this.user = user;
            this.password = password;
            this.weight = weight;
            this.readonly = readonly;
        }
    }

    private static final String ROUTING = "${routing.strategy}";
    private static final boolean READ_WRITE_SPLIT = ${routing.readWriteSplit};
    private static final int FAILOVER_THRESHOLD = ${routing.failoverThreshold};
    private static final boolean FAILOVER = ${fail.enabled};
    private static final boolean SPLIT_BRAIN_GUARD = ${fail.splitBrainGuard};
    private static final int LEASE_SECONDS = ${fail.leaseSeconds};
    private static final int POOL_MAX = ${(db.pool && db.pool.max) || 20};

    private final List<Node> nodes = new ArrayList<>();
    private final Map<String, HikariDataSource> pools = new ConcurrentHashMap<>();
    private final Map<String, Integer> fails = new ConcurrentHashMap<>();
    private final Map<String, Boolean> healthy = new ConcurrentHashMap<>();
    private final AtomicInteger roundRobin = new AtomicInteger();
    private final StringRedisTemplate redis;
    private final String appName = ${JSON.stringify(p.name)};

    private volatile long leaseUntil = 0L;

    public DbClusterRegistry(ObjectProvider<StringRedisTemplate> redisProvider) {
        this.redis = redisProvider.getIfAvailable();
${nodes}
    }

    @PostConstruct
    public void init() {
        log.info("数据库集群：{} 个节点，路由={}，读写分离={}，防脑裂={}", nodes.size(), ROUTING, READ_WRITE_SPLIT, SPLIT_BRAIN_GUARD);
    }

    public List<String> nodeNames() {
        List<String> names = new ArrayList<>();
        nodes.forEach((n) -> names.add(n.name));
        return names;
    }

    public String defaultName() {
        return ${JSON.stringify(primary ? primary.name : 'primary')};
    }

    public Map<Object, Object> targets() {
        Map<Object, Object> map = new LinkedHashMap<>();
        for (Node n : nodes) map.put(n.name, pool(n.name));
        return map;
    }

    public DataSource pool(String name) {
        return pools.computeIfAbsent(name, (k) -> {
            Node n = nodes.stream().filter((x) -> x.name.equals(k)).findFirst()
                    .orElseThrow(() -> new IllegalStateException("未知数据库节点：" + k));
            HikariDataSource ds = new HikariDataSource();
            ds.setJdbcUrl(n.jdbcUrl);
            ds.setUsername(n.user);
            ds.setPassword(n.password);
            ds.setMaximumPoolSize(POOL_MAX);
            // 库挂了要快失败，别让请求挂着等 TCP 超时
            ds.setConnectionTimeout(5000);
            ds.setValidationTimeout(3000);
            ds.setPoolName("cb-" + n.name);
            return ds;
        });
    }

    /** 后台健康检查。 */
    @Scheduled(fixedDelayString = "\${app.db.health-check-ms:5000}")
    public void check() {
        for (Node n : nodes) {
            try (Connection c = pool(n.name).getConnection(); Statement st = c.createStatement()) {
                st.execute("SELECT 1");
                healthy.put(n.name, true);
                fails.put(n.name, 0);
            } catch (Exception e) {
                int f = fails.merge(n.name, 1, Integer::sum);
                if (f >= FAILOVER_THRESHOLD) {
                    boolean was = Boolean.TRUE.equals(healthy.put(n.name, false));
                    if (was) log.warn("摘除数据库节点 {}（{}）", n.name, e.getMessage());
                }
            }
        }
    }

    /** 所有节点都挂了就算降级（健康检查接口用）。 */
    public boolean anyHealthy() {
        for (Node n : nodes) if (healthy.getOrDefault(n.name, true)) return true;
        return false;
    }

    public String pickWrite() {
        if (!ensureLeader()) {
            throw new IllegalStateException("当前实例不是写主库（租约被其它实例持有）");
        }
        return choose(nodes.stream().filter((n) -> "primary".equals(n.role) && !n.readonly).toList());
    }

    public String pickRead() {
        if (!READ_WRITE_SPLIT) return pickWrite();
        return choose(nodes.stream().filter((n) -> n.readonly || "replica".equals(n.role)).toList());
    }

    private String choose(List<Node> list) {
        if (list.isEmpty()) return defaultName();
        List<Node> alive = new ArrayList<>();
        for (Node n : list) if (healthy.getOrDefault(n.name, true)) alive.add(n);
        if (alive.isEmpty()) alive = list;
        if (alive.size() == 1) return alive.get(0).name;
        if ("weighted".equals(ROUTING)) {
            int total = 0;
            for (Node n : alive) total += Math.max(1, n.weight);
            int r = (int) (Math.random() * total);
            for (Node n : alive) {
                r -= Math.max(1, n.weight);
                if (r <= 0) return n.name;
            }
        }
        int i = Math.abs(roundRobin.getAndIncrement()) % alive.size();
        return alive.get(i).name;
    }

    /** 写租约：只有持有租约的实例才允许写主库。 */
    private boolean ensureLeader() {
        if (!FAILOVER || !SPLIT_BRAIN_GUARD) return true;
        if (System.currentTimeMillis() < leaseUntil) return true;
        if (redis == null) return true;
        String key = "db:leader:" + appName;
        Boolean ok = redis.opsForValue().setIfAbsent(key, appName, Duration.ofSeconds(Math.max(1, LEASE_SECONDS)));
        if (Boolean.TRUE.equals(ok)) {
            leaseUntil = System.currentTimeMillis() + Math.max(1, LEASE_SECONDS - 1) * 1000L;
            return true;
        }
        String holder = redis.opsForValue().get(key);
        return appName.equals(holder);
    }
}
`;
}

/** 路由数据源：GET / 只读事务走从库，其它走主库；未启用的集群只有一个节点。 */
function clusterRoutingDataSource(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.config`;
  return `package ${pkg};

import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.datasource.lookup.AbstractRoutingDataSource;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.Map;

/**
 * 路由数据源：写走主库（需持租约），读走从库。
 * 需要强制指定时：ClusterRoutingDataSource.force("replica1") / clear()。
 */
@Component
@Primary
public class ClusterRoutingDataSource extends AbstractRoutingDataSource {

    private static final ThreadLocal<String> FORCE = new ThreadLocal<>();

    private final DbClusterRegistry registry;

    public ClusterRoutingDataSource(DbClusterRegistry registry) {
        this.registry = registry;
        Map<Object, Object> targets = registry.targets();
        super.setTargetDataSources(targets);
        super.setDefaultTargetDataSource(targets.get(registry.defaultName()));
        super.afterPropertiesSet();
    }

    public static void force(String node) {
        FORCE.set(node);
    }

    public static void clear() {
        FORCE.remove();
    }

    @Override
    protected Object determineCurrentLookupKey() {
        String forced = FORCE.get();
        if (forced != null) return forced;
        if (TransactionSynchronizationManager.isCurrentTransactionReadOnly()) {
            return registry.pickRead();
        }
        ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attrs != null && "GET".equalsIgnoreCase(attrs.getRequest().getMethod())) {
            return registry.pickRead();
        }
        return registry.pickWrite();
    }
}
`;
}
function wafFilter(ir) {
  const p = ir.project;
  const w = ir.waf;
  const pkg = `${p.groupId}.config`;
  return `package ${pkg};

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.util.ContentCachingRequestWrapper;

import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;

/**
 * 生成期固化的基础防护：不依赖外部 WAF，进程内即可挡掉最常见的扫描与灌流量。
 * 真上生产建议再在前面挂一层 Nginx / ONRouter，这里是最低成本的第一道闸。
 */
@Component
@Order(1)
public class WafFilter implements Filter {

    private static final Logger log = LoggerFactory.getLogger(WafFilter.class);

    private static final boolean SQLI = ${w.sqlInjection};
    private static final boolean SQLI_BODY = ${w.sqlInjectionBody};
    private static final boolean XSS = ${w.xss};
    private static final boolean TRAVERSAL = ${w.pathTraversal};
    private static final boolean CC = ${w.cc.enabled};
    private static final double CC_RPS = ${w.cc.rps};
    private static final double CC_BURST = ${w.cc.burst};
    private static final boolean DDOS = ${w.ddos.enabled};
    private static final int MAX_CONCURRENT = ${w.ddos.maxConcurrent};
    private static final String FRAME_OPTIONS = "${w.headers.frameOptions}";
    private static final boolean NOSNIFF = ${w.headers.contentTypeOptions};
    private static final boolean HSTS = ${w.headers.hsts};

    private static final Pattern SQLI_PATTERN = Pattern.compile(
            "(?i)(union\\\\s+select|select\\\\s+[\\\\w,\\\\s*]+\\\\s+from|insert\\\\s+into|delete\\\\s+from|drop\\\\s+table|'\\\\s*or\\\\s*'|\\\\bor\\\\s+1\\\\s*=\\\\s*1|;\\\\s*--|\\\\bsleep\\\\s*\\\\(|benchmark\\\\s*\\\\()");
    private static final Pattern XSS_PATTERN = Pattern.compile(
            "(?i)(<script|javascript:\\\\s|onerror\\\\s*=|onload\\\\s*=|<iframe|document\\\\.cookie)");

    private final AtomicInteger inFlight = new AtomicInteger();
    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        if (NOSNIFF) response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("X-Frame-Options", FRAME_OPTIONS);
        response.setHeader("Referrer-Policy", "no-referrer");
        if (HSTS) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

        if (DDOS) {
            if (inFlight.incrementAndGet() > MAX_CONCURRENT) {
                inFlight.decrementAndGet();
                deny(response, "服务器繁忙，请稍后再试");
                return;
            }
        }
        try {
            if (buckets.size() > 20000) buckets.clear();
            String ip = clientIp(request);
            if (CC && !allow(ip)) {
                deny(response, "请求过于频繁");
                return;
            }
            String raw = request.getRequestURI() + "?" + (request.getQueryString() == null ? "" : request.getQueryString());
            String probe = decode(decode(raw));
            if (TRAVERSAL && (probe.contains("../") || probe.contains("..\\\\") || probe.contains("%2e%2e") || probe.contains("%252e"))) {
                deny(response, "非法路径");
                return;
            }
            if (SQLI && SQLI_PATTERN.matcher(probe).find()) {
                deny(response, "非法参数");
                return;
            }
            if (XSS && XSS_PATTERN.matcher(probe).find()) {
                deny(response, "非法内容");
                return;
            }

            ServletRequest next = req;
            if (SQLI_BODY && bodyLike(request)) {
                ContentCachingRequestWrapper wrapper = new ContentCachingRequestWrapper(request);
                String payload = new String(wrapper.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                if (SQLI_PATTERN.matcher(payload).find()) {
                    deny(response, "非法内容");
                    return;
                }
                next = wrapper;
            }
            chain.doFilter(next, res);
        } finally {
            if (DDOS) inFlight.decrementAndGet();
        }
    }

    private static boolean bodyLike(HttpServletRequest request) {
        String type = request.getContentType();
        return type != null && (type.contains("application/json") || type.contains("x-www-form-urlencoded"));
    }

    private boolean allow(String ip) {
        Bucket b = buckets.computeIfAbsent(ip, k -> new Bucket());
        synchronized (b) {
            long now = System.currentTimeMillis();
            double add = (now - b.last) / 1000.0 * CC_RPS;
            b.tokens = Math.min(CC_BURST, b.tokens + add);
            b.last = now;
            if (b.tokens < 1) return false;
            b.tokens -= 1;
            return true;
        }
    }

    private static String clientIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isBlank()) ip = request.getHeader("X-Real-IP");
        if (ip == null || ip.isBlank()) ip = request.getRemoteAddr();
        int comma = ip.indexOf(',');
        return comma > 0 ? ip.substring(0, comma).trim() : ip.trim();
    }

    private static String decode(String s) {
        try {
            return URLDecoder.decode(s, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return s;
        }
    }

    private static void deny(HttpServletResponse response, String msg) throws IOException {
        log.warn("WAF blocked: {}", msg);
        response.setStatus(403);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\\"code\\":403,\\"msg\\":\\"" + msg + "\\",\\"data\\":null}");
    }

    static final class Bucket {
        double tokens = CC_BURST;
        long last = System.currentTimeMillis();
    }
}
`;
}

function rateLimitInterceptor(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.config`;
  if (!p.redis.enabled || !p.integrations.rateLimit) return null;
  return `package ${pkg};

import ${p.groupId}.common.BizException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.time.Duration;

/** 简单的 Redis 令牌桶（每 IP 每分钟 600 次）。 */
@Component
@RequiredArgsConstructor
public class RateLimitInterceptor implements HandlerInterceptor {

    private final StringRedisTemplate redis;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isBlank()) ip = request.getRemoteAddr();
        String key = "rl:" + ip + ":" + (System.currentTimeMillis() / 60000);
        Long count = redis.opsForValue().increment(key);
        if (count != null && count == 1L) redis.expire(key, Duration.ofMinutes(2));
        if (count != null && count > 600) throw new BizException(429, "请求过于频繁");
        return true;
    }
}
`;
}

function openApiConfig(ir) {
  const p = ir.project;
  if (!p.integrations.swagger) return null;
  return `package ${p.groupId}.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI openAPI() {
        return new OpenAPI().info(new Info()
                .title("${p.name} API")
                .description("由 ClickBuildServer 生成 · ${ir.stats.tables} 张表 · ${ir.stats.permissions} 个权限点")
                .version("${p.version}"));
    }
}
`;
}

function application(ir) {
  const p = ir.project;
  const war = p.packageType === 'war';
  const extra = [];
  const cls = `${p.groupId}.Application`;
  return `package ${p.groupId};

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@ConfigurationPropertiesScan("${p.groupId}.config")
@MapperScan("${p.groupId}.modules")
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
`;
}

function servletInitializer(ir) {
  const p = ir.project;
  if (p.packageType !== 'war') return null;
  return `package ${p.groupId};

import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.support.SpringBootServletInitializer;

/** WAR 部署入口。 */
public class ServletInitializer extends SpringBootServletInitializer {

    @Override
    protected SpringApplicationBuilder configure(SpringApplicationBuilder builder) {
        return builder.sources(Application.class);
    }
}
`;
}

/** 逻辑用户编号（LUID）：服务端私有 ID → 登录用户，Redis 或进程内缓存 */
function luidCache(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.security`;
  const luid = (p.security && p.security.luid) || {};
  const ttl = Number(luid.ttlSeconds || 7200);
  const prefix = `${p.redis.keyPrefix}:luid:`;
  const redis = p.redis.enabled;

  return `package ${pkg};

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;
${redis ? 'import java.time.Duration;\nimport org.springframework.data.redis.core.StringRedisTemplate;\n' : ''}
/**
 * 逻辑用户编号（LUID）缓存。
 * 前端只拿到 LUID，真实 userId 与权限只存在服务端；命中缓存即放行，登出立即失效。
 * ${redis ? '当前实现用 Redis 共享（多实例部署可用）。' : '当前实现为进程内缓存（单实例；多实例请换 Redis）。'}
 */
@Component
@RequiredArgsConstructor
public class LuidCache {

    private static final String PREFIX = "${prefix}";
    private final long ttlSeconds = ${ttl}L;
${redis ? '\n    private final StringRedisTemplate redis;\n' : ''}
    private final Map<String, Entry> local = new ConcurrentHashMap<>();

    static class Entry {
        LoginUser user;
        long expireAt;
        Entry(LoginUser user, long expireAt) { this.user = user; this.expireAt = expireAt; }
    }

    /** 登录后签发一个 LUID（L + 时间戳36进制 + 随机） */
    public String issue(Long userId, String username, Set<String> perms) {
        String luid = "L" + Long.toString(System.currentTimeMillis(), 36)
                + Integer.toHexString(ThreadLocalRandom.current().nextInt(1 << 24));
        save(luid, userId, username, perms);
        return luid;
    }

    public LoginUser load(String luid) {
        if (luid == null || luid.isBlank()) return null;
${redis ? `        try {
            String v = redis.opsForValue().get(PREFIX + luid);
            if (v == null) return null;
            String[] p = v.split("\\\\|", 3);
            if (p.length < 2) return null;
            Set<String> perms = new java.util.HashSet<>();
            if (p.length > 2 && !p[2].isBlank()) for (String s : p[2].split(",")) perms.add(s);
            return new LoginUser(Long.valueOf(p[0]), p[1], "", perms);
        } catch (Exception e) {
            return null;
        }` : `        Entry e = local.get(luid);
        if (e == null) return null;
        if (e.expireAt < System.currentTimeMillis()) { local.remove(luid); return null; }
        return e.user;`}
    }

    public void drop(String luid) {
        if (luid == null || luid.isBlank()) return;
${redis ? `        try { redis.delete(PREFIX + luid); } catch (Exception ignored) { }` : `        local.remove(luid);`}
    }

    private void save(String luid, Long userId, String username, Set<String> perms) {
${redis ? `        try {
            String v = userId + "|" + username + "|" + String.join(",", perms == null ? java.util.Collections.<String>emptySet() : perms);
            redis.opsForValue().set(PREFIX + luid, v, Duration.ofSeconds(ttlSeconds));
        } catch (Exception ignored) { }` : `        local.put(luid, new Entry(new LoginUser(userId, username, "", perms), System.currentTimeMillis() + ttlSeconds * 1000));`}
    }
}
`;
}

/** 健康检查：容器 / 网关探活用，不鉴权、不进权限拦截。 */
function healthController(ir) {
  const pkg = `${ir.project.groupId}.common`;
  const cfgPkg = `${ir.project.groupId}.config`;
  return `package ${pkg};

import ${cfgPkg}.DbClusterRegistry;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 健康检查。给 Docker / ONRouter 做探活：不鉴权、不查业务表。
 * 数据库节点全部被摘除时返回 DEGRADED，但仍然回 200，避免容器被反复重启。
 */
@RestController
@RequestMapping({"/health", "/healthz"})
public class HealthController {

    private final DbClusterRegistry clusters;

    public HealthController(DbClusterRegistry clusters) {
        this.clusters = clusters;
    }

    @GetMapping
    public Map<String, Object> health() {
        boolean dbUp = clusters.anyHealthy();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", dbUp ? "UP" : "DEGRADED");
        m.put("app", "${ir.project.name}");
        m.put("db", dbUp);
        m.put("time", OffsetDateTime.now().toString());
        return m;
    }
}
`;
}

function supportFiles(ir) {
  const p = ir.project;
  const files = [
    { path: `src/main/java/${ir.pkgPath}/Application.java`, content: application(ir) },
    { path: `src/main/java/${ir.pkgPath}/common/HealthController.java`, content: healthController(ir) },
    { path: `src/main/java/${ir.pkgPath}/common/BaseEntity.java`, content: baseEntity(ir) },
    { path: `src/main/java/${ir.pkgPath}/common/IdGen.java`, content: idGen(ir) },
    { path: `src/main/java/${ir.pkgPath}/common/ApiResult.java`, content: apiResult(ir) },
    { path: `src/main/java/${ir.pkgPath}/common/PageResult.java`, content: pageResult(ir) },
    { path: `src/main/java/${ir.pkgPath}/common/MetaHandler.java`, content: metaHandler(ir) },
    { path: `src/main/java/${ir.pkgPath}/common/UserContext.java`, content: contextHolder(ir) },
    ...exceptionFiles(ir),
    { path: `src/main/java/${ir.pkgPath}/config/AppProperties.java`, content: appProps(ir) },
    { path: `src/main/java/${ir.pkgPath}/config/MybatisConfig.java`, content: mybatisConfig(ir) },
    { path: `src/main/java/${ir.pkgPath}/config/SecurityConfig.java`, content: securityConfig(ir) },
    { path: `src/main/java/${ir.pkgPath}/config/WebConfig.java`, content: webConfig(ir) },
    { path: `src/main/java/${ir.pkgPath}/security/LoginUser.java`, content: loginUser(ir) },
    { path: `src/main/java/${ir.pkgPath}/security/JwtUtil.java`, content: jwtUtil(ir) },
    { path: `src/main/java/${ir.pkgPath}/security/CookieUtil.java`, content: cookieUtil(ir) },
    { path: `src/main/java/${ir.pkgPath}/security/RequirePerm.java`, content: requirePerm(ir) },
    { path: `src/main/java/${ir.pkgPath}/security/OpLog.java`, content: opLog(ir) },
    { path: `src/main/java/${ir.pkgPath}/security/AuthInterceptor.java`, content: authInterceptor(ir) },
    { path: `src/main/java/${ir.pkgPath}/security/PermissionInterceptor.java`, content: permissionInterceptor(ir) },
    { path: `src/main/java/${ir.pkgPath}/security/PermCache.java`, content: permCache(ir) },
    { path: `src/main/java/${ir.pkgPath}/security/LuidCache.java`, content: luidCache(ir) },
    { path: `src/main/java/${ir.pkgPath}/config/WafFilter.java`, content: wafFilter(ir) },
    { path: `src/main/java/${ir.pkgPath}/config/DbClusterRegistry.java`, content: dbClusterRegistry(ir) },
    { path: `src/main/java/${ir.pkgPath}/config/ClusterRoutingDataSource.java`, content: clusterRoutingDataSource(ir) },
  ];
  files.push({ path: `src/main/java/${ir.pkgPath}/common/TenantContext.java`, content: tenantHolder(ir) });
  if (ir.project.redis.enabled) {
    files.push({ path: `src/main/java/${ir.pkgPath}/config/RedisConfig.java`, content: redisConfig(ir) });
    const rate = rateLimitInterceptor(ir);
    if (rate) files.push({ path: `src/main/java/${ir.pkgPath}/config/RateLimitInterceptor.java`, content: rate });
  }
  const oa = openApiConfig(ir);
  if (oa) files.push({ path: `src/main/java/${ir.pkgPath}/config/OpenApiConfig.java`, content: oa });
  const si = servletInitializer(ir);
  if (si) files.push({ path: `src/main/java/${ir.pkgPath}/ServletInitializer.java`, content: si });
  return files;
}

module.exports = { supportFiles };
