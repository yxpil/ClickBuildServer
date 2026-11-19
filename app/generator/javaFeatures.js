'use strict';
/** Java 工程：认证、权限、缓存、搜索、存储、日志、任务、文件数据源、审核门面 */

const N = require('./naming');
const jstr = (s) => JSON.stringify(String(s == null ? '' : s));

function hasTable(ir, name) { return ir.tables.some((t) => t.name === name); }
function tableOf(ir, name) { return ir.tables.find((t) => t.name === name); }

function loginDtos(ir) {
  const pkg = `${ir.project.groupId}.auth`;
  const p = ir.project;
  return [
    {
      path: `src/main/java/${ir.pkgPath}/auth/LoginRequest.java`,
      content: `package ${pkg};

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class LoginRequest {
    @NotBlank(message = "用户名不能为空")
    private String username;
    @NotBlank(message = "密码不能为空")
    private String password;
    private boolean rememberMe = false;
${ir.tenant ? '    private String tenantCode;\n' : ''}}
`,
    },
    {
      path: `src/main/java/${ir.pkgPath}/auth/LoginResponse.java`,
      content: `package ${pkg};

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.Set;

@Data
@AllArgsConstructor
public class LoginResponse {
    private String token;
    private Long userId;
    private String username;
    private Set<String> perms;
    private long expiresIn;
    /** 逻辑用户编号：只有服务端知道它与真实用户的映射，可放进缓存做权限判定 */
    private String luid;
}
`,
    },
  ];
}

function authService(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.auth`;
  const usernameCol = tableOf(ir, 'sys_user');
  if (!usernameCol) return null;
  const session = hasTable(ir, 'sys_session');
  return `package ${pkg};

import ${p.groupId}.common.BizException;
import ${p.groupId}.common.IdGen;
import ${p.groupId}.config.AppProperties;
import ${p.groupId}.modules.account.SysUserEntity;
import ${p.groupId}.modules.account.SysUserService;${session ? `
import ${p.groupId}.modules.auth.SysSessionEntity;
import ${p.groupId}.modules.auth.SysSessionService;` : ''}
import ${p.groupId}.security.CookieUtil;
import ${p.groupId}.security.JwtUtil;
import ${p.groupId}.security.LoginUser;
import ${p.groupId}.support.RbacService;
${p.redis.enabled ? 'import org.springframework.data.redis.core.StringRedisTemplate;\n' : ''}import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final SysUserService userService;
${session ? '    private final SysSessionService sessionService;\n' : ''}    private final RbacService rbacService;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;
    private final CookieUtil cookieUtil;
    private final AppProperties props;
    private final ${p.groupId}.security.LuidCache luidCache;
${p.redis.enabled ? '    private final StringRedisTemplate redis;\n' : ''}
    @Transactional
    public LoginResponse login(LoginRequest req, HttpServletResponse response) {
        SysUserEntity user = userService.lambdaQuery()
                .eq(SysUserEntity::getUsername, req.getUsername())
                .last("limit 1")
                .one();
        if (user == null || !passwordEncoder.matches(req.getPassword(), user.getPassword())) {
            throw new BizException(401, "账号或密码错误");
        }
        if (user.getStatus() != null && user.getStatus() == 0) {
            throw new BizException(403, "账号已被禁用");
        }
        Long userId = user.getId();
        String tokenId = UUID.randomUUID().toString().replace("-", "");
        Set<String> perms = rbacService.permsOf(userId);
        String luid = luidCache.issue(userId, user.getUsername(), perms);
        String token = jwtUtil.create(userId, user.getUsername(), tokenId, 0L, luid);
        long ttl = props.getSecurity().getTtlSeconds();
        if (req.isRememberMe()) ttl = ttl * 7;
${session ? `        SysSessionEntity session = new SysSessionEntity();
        session.setId(IdGen.nextId());
        session.setTokenId(tokenId);
        session.setUserId(userId);
        session.setDevice(trim(response == null ? "" : "web"));
        session.setExpiresAt(LocalDateTime.now().plusSeconds(ttl));
        session.setRevoked(0);
        sessionService.save(session);
` : ''}${p.redis.enabled ? `        redis.opsForValue().set(key("session", tokenId), String.valueOf(userId), Duration.ofSeconds(ttl));
` : ''}        userService.lambdaUpdate().eq(SysUserEntity::getId, userId)
                .set(SysUserEntity::getLastLoginAt, LocalDateTime.now())
                .update();
        cookieUtil.write(response, token);
        return new LoginResponse(token, userId, user.getUsername(), perms, ttl, luid);
    }

    public LoginUser current(String token) {
        var claims = jwtUtil.parse(token);
        Long userId = Long.valueOf(claims.getSubject());
        Set<String> perms = rbacService.permsOf(userId);
        return new LoginUser(userId, String.valueOf(claims.get("username")), String.valueOf(claims.get("tid")), perms);
    }

    @Transactional
    public void logout(String tokenId, HttpServletResponse response) {
        if (tokenId != null) {
${session ? `            sessionService.lambdaUpdate().eq(SysSessionEntity::getTokenId, tokenId).set(SysSessionEntity::getRevoked, 1).update();
` : ''}${p.redis.enabled ? `            redis.delete(key("session", tokenId));
` : ''}        }
        cookieUtil.clear(response);
    }

    private String trim(String s) { return s == null || s.isBlank() ? "web" : s.substring(0, Math.min(60, s.length())); }

    private String key(String ns, String id) { return "${p.redis.keyPrefix}:" + ns + ":" + id; }
}
`;
}

function authController(ir) {
  const pkg = `${ir.project.groupId}.auth`;
  const p = ir.project;
  return `package ${pkg};

import ${p.groupId}.common.ApiResult;
import ${p.groupId}.common.UserContext;
import ${p.groupId}.security.CookieUtil;
import ${p.groupId}.security.LoginUser;
import io.jsonwebtoken.Claims;
import ${p.groupId}.security.JwtUtil;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;
    private final CookieUtil cookieUtil;
    private final JwtUtil jwtUtil;
    private final ${p.groupId}.security.LuidCache luidCache;

    @PostMapping("/login")
    public ApiResult<LoginResponse> login(@RequestBody @Valid LoginRequest req, HttpServletResponse response) {
        return ApiResult.ok(authService.login(req, response));
    }

    @GetMapping("/me")
    public ApiResult<Map<String, Object>> me() {
        LoginUser user = UserContext.get();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("userId", user.getUserId());
        data.put("username", user.getUsername());
        data.put("perms", user.getPerms());
        data.put("luid", UserContext.luid());
        return ApiResult.ok(data);
    }

    @PostMapping("/logout")
    public ApiResult<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        String token = resolve(request);
        if (token != null) {
            try {
                Claims claims = jwtUtil.parse(token);
                authService.logout(String.valueOf(claims.get("tid")), response);
                luidCache.drop(String.valueOf(claims.get("luid")));
            } catch (Exception ignored) { }
        }
        cookieUtil.clear(response);
        return ApiResult.ok();
    }

    @PostMapping("/refresh")
    public ApiResult<LoginResponse> refresh(HttpServletRequest request, HttpServletResponse response) {
        String token = resolve(request);
        if (token == null) throw new ${p.groupId}.common.BizException(401, "缺少令牌");
        Claims claims = jwtUtil.parse(token);
        LoginUser u = authService.current(token);
        String luid = String.valueOf(claims.get("luid"));
        if (luid == null || luid.isBlank() || "null".equals(luid)) luid = luidCache.issue(u.getUserId(), u.getUsername(), u.getPerms());
        String newToken = jwtUtil.create(u.getUserId(), u.getUsername(), u.getTokenId(), 0L, luid);
        cookieUtil.write(response, newToken);
        return ApiResult.ok(new LoginResponse(newToken, u.getUserId(), u.getUsername(), u.getPerms(),
                ${p.security.ttlSeconds}L * 1000, luid));
    }

    private String resolve(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) return header.substring(7);
        return cookieUtil.read(request);
    }
}
`;
}

function rbacService(ir) {
  const pkg = `${ir.project.groupId}.support`;
  const p = ir.project;
  const hasRbac = hasTable(ir, 'sys_role') && hasTable(ir, 'sys_user_role') && hasTable(ir, 'sys_role_permission');
  return `package ${pkg};

import lombok.RequiredArgsConstructor;
${p.redis.enabled ? 'import org.springframework.data.redis.core.StringRedisTemplate;\n' : ''}import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.*;

@Service
@RequiredArgsConstructor
public class RbacService {

    private final JdbcTemplate jdbc;
${p.redis.enabled ? '    private final StringRedisTemplate redis;\n' : ''}
    /** 用户权限集合：super_admin 直接返回 *。 */
    public Set<String> permsOf(Long userId) {
${hasRbac ? `        if (userId == null) return Collections.emptySet();
        try {
            List<String> roles = jdbc.queryForList(
                    "SELECT r.role_code FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id " +
                    "WHERE ur.user_id = ? AND ur.deleted = 0 AND r.deleted = 0", String.class, userId);
            if (roles.contains("super_admin")) return Set.of("*");
${p.redis.enabled ? `            String cacheKey = "${p.redis.keyPrefix}:perm:" + userId;
            String cached = redis.opsForValue().get(cacheKey);
            if (cached != null && !cached.isBlank()) return new LinkedHashSet<>(Arrays.asList(cached.split(",")));
` : ''}            List<String> codes = jdbc.queryForList(
                    "SELECT rp.perm_code FROM sys_user_role ur JOIN sys_role_permission rp ON rp.role_id = ur.role_id " +
                    "WHERE ur.user_id = ? AND ur.deleted = 0 AND rp.deleted = 0", String.class, userId);
            Set<String> set = new LinkedHashSet<>(codes);
${p.redis.enabled ? `            redis.opsForValue().set("${p.redis.keyPrefix}:perm:" + userId, String.join(",", set), Duration.ofMinutes(10));
` : ''}            return set;
        } catch (Exception e) {
            return Collections.emptySet();
        }
` : '        return Set.of("*");\n'}    }
}
`;
}

function cacheService(ir) {
  const p = ir.project;
  if (!p.redis.enabled) return null;
  return `package ${ir.project.groupId}.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Set;
import java.util.function.Supplier;

/** 旁路缓存：读走 Redis，未命中回源，写后精准失效。表级 TTL 由生成器配置。 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CacheService {

    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    public <T> T get(String key, long ttlSeconds, Class<T> type, Supplier<T> loader) {
        try {
            String json = redis.opsForValue().get(key);
            if (json != null) return mapper.readValue(json, type);
        } catch (Exception e) {
            log.warn("cache read failed: {}", key);
        }
        T value = loader.get();
        if (value != null) {
            try {
                redis.opsForValue().set(key, mapper.writeValueAsString(value), Duration.ofSeconds(ttlSeconds));
            } catch (Exception e) {
                log.warn("cache write failed: {}", key);
            }
        }
        return value;
    }

    public void evict(String key) {
        try { redis.delete(key); } catch (Exception ignored) { }
    }

    public void evictPrefix(String prefix) {
        try {
            Set<String> keys = redis.keys(prefix + "*");
            if (keys != null && !keys.isEmpty()) redis.delete(keys);
        } catch (Exception ignored) { }
    }
}
`;
}

function searchFiles(ir) {
  const p = ir.project;
  if (p.search.engine !== 'elasticsearch' && !p.redis.enabled) return [];
  const pkg = `${p.groupId}.support`;
  const files = [
    {
      path: `src/main/java/${ir.pkgPath}/support/SearchService.java`,
      content: `package ${pkg};

import java.util.List;
import java.util.Map;

public interface SearchService {
    void index(String table, String id, String text);
    void remove(String table, String id);
    List<Map<String, String>> search(String table, String keyword, int limit);
    void rebuild(String table);
}
`,
    },
    {
      path: `src/main/java/${ir.pkgPath}/support/Tokens.java`,
      content: `package ${pkg};

import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/** 极简分词：英文按词，中文按 2-gram，足够支撑站内搜索。 */
public final class Tokens {
    private Tokens() {}

    public static Set<String> of(String text) {
        Set<String> out = new LinkedHashSet<>();
        if (text == null) return out;
        String norm = text.toLowerCase(Locale.ROOT).replaceAll("[\\\\p{Punct}&&[^\\\\u4e00-\\\\u9fa5]]", " ").trim();
        for (String w : norm.split("\\\\s+")) {
            if (w.isBlank()) continue;
            out.add(w);
            if (w.length() > 2 && w.matches("[\\\\u4e00-\\\\u9fa5]+")) {
                for (int i = 0; i + 2 <= w.length(); i++) out.add(w.substring(i, i + 2));
            }
        }
        return out;
    }
}
`,
    },
  ];
  if (p.redis.enabled) {
    files.push({
      path: `src/main/java/${ir.pkgPath}/support/RedisSearchService.java`,
      content: `package ${pkg};

import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/** Redis 倒排索引：SADD token->ids，Hash 存原文，SINTER 求交，零外部依赖。 */
@Service
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.search.engine", havingValue = "redis", matchIfMissing = true)
public class RedisSearchService implements SearchService {

    private final StringRedisTemplate redis;
    private final ${p.groupId}.config.AppProperties props;

    private String tok(String table, String token) { return props.getSearch().getIndexPrefix() + ":idx:" + table + ":tok:" + token; }
    private String doc(String table) { return props.getSearch().getIndexPrefix() + ":idx:" + table + ":doc"; }
    private String all(String table) { return props.getSearch().getIndexPrefix() + ":idx:" + table + ":all"; }

    @Override
    public void index(String table, String id, String text) {
        remove(table, id);
        redis.opsForHash().put(doc(table), id, text == null ? "" : text);
        redis.opsForSet().add(all(table), id);
        for (String t : Tokens.of(text)) redis.opsForSet().add(tok(table, t), id);
    }

    @Override
    public void remove(String table, String id) {
        redis.opsForHash().delete(doc(table), id);
        redis.opsForSet().remove(all(table), id);
    }

    @Override
    public List<Map<String, String>> search(String table, String keyword, int limit) {
        Set<String> tokens = Tokens.of(keyword);
        if (tokens.isEmpty()) return List.of();
        List<String> keys = new ArrayList<>();
        tokens.forEach(t -> keys.add(tok(table, t)));
        Set<String> ids = keys.size() == 1
                ? redis.opsForSet().members(keys.get(0))
                : redis.opsForSet().intersect(keys);
        if (ids == null || ids.isEmpty()) return List.of();
        List<Map<String, String>> out = new ArrayList<>();
        for (String id : ids) {
            if (out.size() >= limit) break;
            Object text = redis.opsForHash().get(doc(table), id);
            Map<String, String> row = new LinkedHashMap<>();
            row.put("id", id);
            row.put("text", text == null ? "" : String.valueOf(text));
            out.add(row);
        }
        return out;
    }

    @Override
    public void rebuild(String table) {
        // 由业务侧调用：分页读取数据后 index()
    }
}
`,
    });
  }
  if (p.search.engine === 'elasticsearch') {
    files.push({
      path: `src/main/java/${ir.pkgPath}/support/EsSearchService.java`,
      content: `package ${pkg};

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.*;

/** Elasticsearch 实现：索引按表划分，字段全量写入 _source。 */
@Service
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.search.engine", havingValue = "elasticsearch")
public class EsSearchService implements SearchService {

    private final RestClient.Builder builder;
    private final ObjectMapper mapper;
    private final ${p.groupId}.config.AppProperties props;

    private RestClient client() { return builder.baseUrl(props.getSearch().getEsNodes().get(0)).build(); }

    @Override
    public void index(String table, String id, String text) {
        Map<String, Object> doc = Map.of("text", text == null ? "" : text);
        client().put().uri("/" + table + "/_doc/" + id).body(doc).retrieve().toBodilessEntity();
    }

    @Override
    public void remove(String table, String id) {
        client().delete().uri("/" + table + "/_doc/" + id).retrieve().toBodilessEntity();
    }

    @Override
    public List<Map<String, String>> search(String table, String keyword, int limit) {
        Map<String, Object> body = Map.of("size", limit,
                "query", Map.of("match", Map.of("text", keyword)));
        String json = client().post().uri("/" + table + "/_search").body(body).retrieve().body(String.class);
        try {
            Map<String, Object> root = mapper.readValue(json, Map.class);
            List<Map<String, Object>> hits = (List<Map<String, Object>>) ((Map<String, Object>) root.get("hits")).get("hits");
            List<Map<String, String>> out = new ArrayList<>();
            for (Map<String, Object> h : hits) {
                Map<String, String> row = new LinkedHashMap<>();
                row.put("id", String.valueOf(h.get("_id")));
                row.put("text", String.valueOf(((Map<String, Object>) h.get("_source")).get("text")));
                out.add(row);
            }
            return out;
        } catch (Exception e) {
            return List.of();
        }
    }

    @Override
    public void rebuild(String table) { }
}
`,
    });
  }
  return files;
}

function storageFiles(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.support`;
  const cfg = `${p.groupId}.config`;
  const files = [];
  if (p.storage.provider === 'minio' || p.storage.provider === 's3') {
    files.push({
      path: `src/main/java/${ir.pkgPath}/config/StorageConfig.java`,
      content: `package ${cfg};

import io.minio.MinioClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class StorageConfig {

    @Bean
    public MinioClient minioClient(AppProperties props) {
        return MinioClient.builder()
                .endpoint(props.getStorage().getEndpoint())
                .credentials(props.getStorage().getAccessKey(), props.getStorage().getSecretKey())
                .build();
    }
}
`,
    });
    files.push({
      path: `src/main/java/${ir.pkgPath}/support/StorageService.java`,
      content: `package ${pkg};

import ${cfg}.AppProperties;
import io.minio.GetPresignedObjectUrlArgs;
import io.minio.MinioClient;
import io.minio.RemoveObjectArgs;
import io.minio.http.Method;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

/** 对象存储：预签名直传/下载，业务侧只拿 URL，不中转文件流。 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StorageService {

    private final MinioClient minio;
    private final AppProperties props;

    public String presignPut(String objectKey, String contentType, int minutes) {
        try {
            return minio.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
                    .method(Method.PUT)
                    .bucket(props.getStorage().getBucket())
                    .object(objectKey)
                    .expiry(minutes, TimeUnit.MINUTES)
                    .build());
        } catch (Exception e) {
            throw new IllegalStateException("生成上传地址失败", e);
        }
    }

    public String presignGet(String objectKey, int minutes) {
        try {
            return minio.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
                    .method(Method.GET)
                    .bucket(props.getStorage().getBucket())
                    .object(objectKey)
                    .expiry(minutes, TimeUnit.MINUTES)
                    .build());
        } catch (Exception e) {
            throw new IllegalStateException("生成下载地址失败", e);
        }
    }

    public String publicUrl(String objectKey) {
        return props.getStorage().getPublicBase().replaceAll("/$", "") + "/" + props.getStorage().getBucket() + "/" + objectKey;
    }

    public void remove(String objectKey) {
        try {
            minio.removeObject(RemoveObjectArgs.builder().bucket(props.getStorage().getBucket()).object(objectKey).build());
        } catch (Exception e) {
            log.warn("remove object failed: {}", objectKey);
        }
    }
}
`,
    });
  } else {
    files.push({
      path: `src/main/java/${ir.pkgPath}/support/LocalStorageService.java`,
      content: `package ${pkg};

import ${cfg}.AppProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;

/** 本地磁盘存储：零外部依赖，适合单机部署。 */
@Service
@RequiredArgsConstructor
public class LocalStorageService extends StorageServiceSupport {

    private final AppProperties props;

    @Override
    public String presignPut(String objectKey, String contentType, int minutes) {
        return "/api/storage/local-put/" + objectKey;
    }

    @Override
    public String presignGet(String objectKey, int minutes) {
        return "/api/storage/local-get/" + objectKey;
    }

    @Override
    public String publicUrl(String objectKey) {
        return "/api/storage/local-get/" + objectKey;
    }

    @Override
    public void remove(String objectKey) {
        try { Files.deleteIfExists(Path.of(props.getStorage().getLocalDir(), objectKey)); } catch (Exception ignored) { }
    }
}

abstract class StorageServiceSupport implements StorageServiceApi { }

interface StorageServiceApi {
    String presignPut(String objectKey, String contentType, int minutes);
    String presignGet(String objectKey, int minutes);
    String publicUrl(String objectKey);
    void remove(String objectKey);
}
`,
    });
  }

  files.push({
    path: `src/main/java/${ir.pkgPath}/support/StorageController.java`,
    content: `package ${pkg};

import ${p.groupId}.common.ApiResult;
import ${p.groupId}.security.RequirePerm;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/storage")
@RequiredArgsConstructor
public class StorageController {

    private final StorageService${p.storage.provider === 'minio' || p.storage.provider === 's3' ? '' : 'Support'} storage;

    @PostMapping("/presign-put")
    @RequirePerm("file:upload")
    public ApiResult<Map<String, String>> presignPut(@RequestBody Map<String, String> body) {
        String key = body.getOrDefault("objectKey", System.currentTimeMillis() + "-" + body.getOrDefault("fileName", "file"));
        return ApiResult.ok(Map.of("url", storage.presignPut(key, body.getOrDefault("contentType", "application/octet-stream"), 15),
                "objectKey", key));
    }

    @GetMapping("/presign-get")
    @RequirePerm("file:download")
    public ApiResult<Map<String, String>> presignGet(@RequestParam String objectKey) {
        return ApiResult.ok(Map.of("url", storage.presignGet(objectKey, 30)));
    }
}
`,
  });
  return files;
}

function logFiles(ir) {
  const p = ir.project;
  if (!hasTable(ir, 'sys_operation_log')) return [];
  return [{
    path: `src/main/java/${ir.pkgPath}/support/OperationLogAspect.java`,
    content: `package ${ir.project.groupId}.support;

import ${ir.project.groupId}.common.UserContext;
import ${ir.project.groupId}.security.OpLog;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

@Slf4j
@Aspect
@Component
@RequiredArgsConstructor
public class OperationLogAspect {

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    @Around("@annotation(opLog)")
    public Object around(ProceedingJoinPoint pjp, OpLog opLog) throws Throwable {
        long start = System.currentTimeMillis();
        Object result = null;
        String error = null;
        try {
            result = pjp.proceed();
            return result;
        } catch (Throwable t) {
            error = t.getMessage();
            throw t;
        } finally {
            try {
                HttpServletRequest req = ((ServletRequestAttributes) RequestContextHolder.getRequestAttributes()).getRequest();
                String params = mapper.writeValueAsString(pjp.getArgs());
                if (params.length() > 2000) params = params.substring(0, 2000);
                jdbc.update("INSERT INTO sys_operation_log (id, trace_id, module, action, user_id, username, ip, method, path, params, result, error, cost_ms, created_at, updated_at, created_by, updated_by, deleted, version) " +
                        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW(),?,?,0,0)",
                        ${ir.project.idStrategy === 'ulid' || ir.project.idStrategy === 'uuid' ? 'java.util.UUID.randomUUID().toString().replace("-","")' : `${ir.project.groupId}.common.IdGen.nextId()`},
                        req.getHeader("X-Trace-Id"), opLog.module(), opLog.action(),
                        UserContext.userId(), UserContext.username(),
                        req.getRemoteAddr(), req.getMethod(), req.getRequestURI(),
                        params, error == null ? 1 : 0, error == null ? null : error.substring(0, Math.min(900, error.length())),
                        System.currentTimeMillis() - start, UserContext.userId(), UserContext.userId());
            } catch (Exception e) {
                log.warn("write operation log failed: {}", e.getMessage());
            }
        }
    }
}
`,
  }];
}

function jobFiles(ir) {
  const p = ir.project;
  const hasSession = hasTable(ir, 'sys_session');
  if (!hasSession) return [];
  return [{
    path: `src/main/java/${ir.pkgPath}/support/JobScheduler.java`,
    content: `package ${ir.project.groupId}.support;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class JobScheduler {

    private final JdbcTemplate jdbc;

    /** 每小时清理过期会话。 */
    @Scheduled(cron = "0 0 * * * ?")
    public void cleanSession() {
        try {
            int n = jdbc.update("DELETE FROM sys_session WHERE expires_at < NOW()");
            log.info("cleaned {} expired sessions", n);
        } catch (Exception e) {
            log.warn("clean session failed: {}", e.getMessage());
        }
    }
}
`,
  }];
}

function dataInitializer(ir) {
  const p = ir.project;
  if (!hasTable(ir, 'sys_user')) return null;
  const tenant = ir.tenant ? 'sys_tenant' : null;
  return `package ${ir.project.groupId}.support;

import ${ir.project.groupId}.common.IdGen;
import ${ir.project.groupId}.config.AppProperties;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 启动自举：创建管理员账号、补齐权限点、建立默认角色。
 * 即使没有执行 99_seed.sql，服务也能直接登录。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DataInitializer implements ApplicationRunner {

    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;
    private final AppProperties props;

    @Override
    public void run(ApplicationArguments args) {
        try {
            seedPermissions();
            seedAdmin();
${tenant ? '            seedTenant();\n' : ''}        } catch (Exception e) {
            log.warn("bootstrap failed: {}", e.getMessage());
        }
    }

    private void seedPermissions() {
        List<String[]> perms = List.of(
${ir.perms.map((x) => `                new String[]{${jstr(x.code)}, ${jstr(x.name)}, ${jstr(x.moduleId)}}`).join(',\n')}
        );
        for (String[] perm : perms) {
            Integer exists = jdbc.queryForObject("SELECT COUNT(1) FROM sys_permission WHERE perm_code = ?", Integer.class, perm[0]);
            if (exists == null || exists == 0) {
                jdbc.update("INSERT INTO sys_permission (id, perm_code, perm_name, module_id, kind, created_at, updated_at, created_by, updated_by, deleted, version) " +
                        "VALUES (?,?,?,?,?,NOW(),NOW(),0,0,0,0)", IdGen.nextId(), perm[0], perm[1], perm[2], "api");
            }
        }
    }

    private void seedAdmin() {
        List<String[]> roles = List.of(
                new String[]{"super_admin", "超级管理员"},
                new String[]{"operator", "业务操作员"},
                new String[]{"auditor", "审核员"});
        for (String[] role : roles) {
            Integer exists = jdbc.queryForObject("SELECT COUNT(1) FROM sys_role WHERE role_code = ?", Integer.class, role[0]);
            if (exists == null || exists == 0) {
                jdbc.update("INSERT INTO sys_role (id, role_code, role_name, data_scope, remark, created_at, updated_at, created_by, updated_by, deleted, version) " +
                        "VALUES (?,?,?,?,?,NOW(),NOW(),0,0,0,0)", IdGen.nextId(), role[0], role[1], 1, "bootstrap");
            }
        }
        Integer users = jdbc.queryForObject("SELECT COUNT(1) FROM sys_user", Integer.class);
        if (users != null && users > 0) return;
        Long adminId = IdGen.nextId();
        jdbc.update("INSERT INTO sys_user (id, username, password, nickname, status, created_at, updated_at, created_by, updated_by, deleted, version) " +
                "VALUES (?,?,?,?,?,NOW(),NOW(),0,0,0,0)",
                adminId, props.getSecurity().getInitAdmin(),
                encoder.encode(props.getSecurity().getInitPassword()), "管理员", 1);
        Long roleId = jdbc.queryForObject("SELECT id FROM sys_role WHERE role_code = 'super_admin' LIMIT 1", Long.class);
        jdbc.update("INSERT INTO sys_user_role (id, user_id, role_id, created_at, updated_at, created_by, updated_by, deleted, version) " +
                "VALUES (?,?,?,NOW(),NOW(),0,0,0,0)", IdGen.nextId(), adminId, roleId);
        log.info("initial admin created: {}", props.getSecurity().getInitAdmin());
    }
${tenant ? `    private void seedTenant() {
        Integer exists = jdbc.queryForObject("SELECT COUNT(1) FROM sys_tenant", Integer.class);
        if (exists != null && exists > 0) return;
        jdbc.update("INSERT INTO sys_tenant (id, tenant_code, tenant_name, status, created_at, updated_at, created_by, updated_by, deleted, version) " +
                "VALUES (?,?,?,?,NOW(),NOW(),0,0,0,0)", IdGen.nextId(), "default", "默认租户", 1);
    }
` : ''}}
`;
}

function approvalFacade(ir) {
  if (!hasTable(ir, 'sys_approval') || !hasTable(ir, 'sys_approval_node')) return null;
  return `package ${ir.project.groupId}.modules.approval;

import ${ir.project.groupId}.common.UserContext;
import ${ir.project.groupId}.common.BizException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/** 通用审核门面：任何业务表都能 submit / pass / reject。 */
@Service
@RequiredArgsConstructor
public class ApprovalFacade {

    private final SysApprovalService approvalService;
    private final SysApprovalNodeService nodeService;

    @Transactional
    public Long submit(String bizModule, Long bizId, String title) {
        SysApprovalEntity e = new SysApprovalEntity();
        e.setBizModule(bizModule);
        e.setBizId(bizId);
        e.setTitle(title);
        e.setStatus(0);
        e.setCurrentNode(1);
        e.setApplicantId(UserContext.userId());
        e.setApplicantName(UserContext.username());
        approvalService.save(e);
        SysApprovalNodeEntity node = new SysApprovalNodeEntity();
        node.setApprovalId(e.getId());
        node.setNodeNo(1);
        node.setAuditorId(0L);
        node.setAuditorName("");
        node.setAction("submit");
        node.setOpinion("");
        node.setActedAt(LocalDateTime.now());
        nodeService.save(node);
        return e.getId();
    }

    @Transactional
    public void pass(Long approvalId, String opinion) {
        SysApprovalEntity e = require(approvalId);
        if (e.getStatus() != 0) throw new BizException("该审核单已结束");
        e.setStatus(1);
        e.setFinishedAt(LocalDateTime.now());
        approvalService.updateById(e);
        record(e, "pass", opinion);
    }

    @Transactional
    public void reject(Long approvalId, String opinion) {
        SysApprovalEntity e = require(approvalId);
        if (e.getStatus() != 0) throw new BizException("该审核单已结束");
        e.setStatus(2);
        e.setFinishedAt(LocalDateTime.now());
        approvalService.updateById(e);
        record(e, "reject", opinion);
    }

    private SysApprovalEntity require(Long id) {
        SysApprovalEntity e = approvalService.getById(id);
        if (e == null) throw new BizException("审核单不存在");
        return e;
    }

    private void record(SysApprovalEntity e, String action, String opinion) {
        SysApprovalNodeEntity node = new SysApprovalNodeEntity();
        node.setApprovalId(e.getId());
        node.setNodeNo(e.getCurrentNode() == null ? 1 : e.getCurrentNode());
        node.setAuditorId(UserContext.userId());
        node.setAuditorName(UserContext.username());
        node.setAction(action);
        node.setOpinion(opinion);
        node.setActedAt(LocalDateTime.now());
        nodeService.save(node);
    }
}
`;
}

function fileStore(ir) {
  if (!ir.fileTables.length) return [];
  const p = ir.project;
  const excel = ir.fileTables.some((t) => t.engine === 'excel');
  return [
    {
      path: `src/main/java/${ir.pkgPath}/support/FileTableStore.java`,
      content: `package ${p.groupId}.support;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;${excel ? `
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;` : ''}
import lombok.extern.slf4j.Slf4j;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * 把 CSV / JSON / Excel 文件当数据库用：
 * 启动加载进内存，按字段建索引，写入后回写原文件。
 */
@Slf4j
public class FileTableStore {

    private final String table;
    private final String engine;
    private final Path path;
    private final List<String> columns;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, Map<String, String>> rows = new LinkedHashMap<>();
    private final Map<String, Set<String>> index = new HashMap<>();

    public FileTableStore(String table, String engine, String file, List<String> columns) {
        this.table = table;
        this.engine = engine;
        this.path = Path.of(file).toAbsolutePath();
        this.columns = columns;
        load();
    }

    public synchronized List<Map<String, String>> list(String keyword, int page, int size) {
        List<Map<String, String>> all = new ArrayList<>();
        for (Map<String, String> row : rows.values()) {
            if (keyword == null || keyword.isBlank() || matches(row, keyword)) all.add(row);
        }
        int from = Math.max(0, (page - 1) * size);
        int to = Math.min(all.size(), from + size);
        if (from >= all.size()) return List.of();
        return all.subList(from, to);
    }

    public synchronized long count(String keyword) {
        if (keyword == null || keyword.isBlank()) return rows.size();
        return rows.values().stream().filter(r -> matches(r, keyword)).count();
    }

    public synchronized Map<String, String> get(String id) { return rows.get(id); }

    public synchronized Map<String, String> save(Map<String, String> body) {
        String id = body.get("id");
        if (id == null || id.isBlank()) id = UUID.randomUUID().toString().replace("-", "").substring(0, 24);
        Map<String, String> row = new LinkedHashMap<>();
        for (String col : columns) row.put(col, body.getOrDefault(col, ""));
        row.put("id", id);
        row.putIfAbsent("created_at", LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));
        rows.put(id, row);
        persist();
        return row;
    }

    public synchronized boolean update(String id, Map<String, String> body) {
        Map<String, String> row = rows.get(id);
        if (row == null) return false;
        for (String col : columns) if (body.containsKey(col) && !"id".equals(col)) row.put(col, body.get(col));
        row.put("updated_at", LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")));
        persist();
        return true;
    }

    public synchronized boolean delete(String id) {
        if (rows.remove(id) == null) return false;
        persist();
        return true;
    }

    private boolean matches(Map<String, String> row, String keyword) {
        String k = keyword.toLowerCase();
        for (String col : columns) {
            String v = row.get(col);
            if (v != null && v.toLowerCase().contains(k)) return true;
        }
        return false;
    }

    private void load() {
        try {
            if (!Files.exists(path)) {
                Files.createDirectories(path.getParent());
                persist();
                return;
            }
            if ("json".equals(engine)) {
                List<Map<String, String>> list = mapper.readValue(path.toFile(), new TypeReference<List<Map<String, String>>>() {});
                for (Map<String, String> row : list) rows.put(row.get("id"), row);
            }${excel ? ` else if ("excel".equals(engine)) {
                loadExcel();
            }` : ''} else {
                loadCsv();
            }
        } catch (Exception e) {
            log.warn("load {} failed: {}", table, e.getMessage());
        }
    }

    private void loadCsv() throws IOException {
        List<String> lines = Files.readAllLines(path, StandardCharsets.UTF_8);
        if (lines.isEmpty()) return;
        String header = lines.get(0);
        String[] cols = splitCsv(header);
        for (int i = 1; i < lines.size(); i++) {
            if (lines.get(i).isBlank()) continue;
            String[] vals = splitCsv(lines.get(i));
            Map<String, String> row = new LinkedHashMap<>();
            for (int c = 0; c < cols.length; c++) row.put(cols[c], c < vals.length ? vals[c] : "");
            rows.put(row.getOrDefault("id", UUID.randomUUID().toString()), row);
        }
    }

    private String[] splitCsv(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder sb = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char ch = line.charAt(i);
            if (ch == '"') {
                if (quoted && i + 1 < line.length() && line.charAt(i + 1) == '"') { sb.append('"'); i++; }
                else quoted = !quoted;
            } else if (ch == ',' && !quoted) { out.add(sb.toString()); sb.setLength(0); }
            else sb.append(ch);
        }
        out.add(sb.toString());
        return out.toArray(new String[0]);
    }

${excel ? `    private void loadExcel() {
        try (InputStream in = Files.newInputStream(path); Workbook wb = new XSSFWorkbook(in)) {
            Sheet sheet = wb.getSheetAt(0);
            Row header = sheet.getRow(0);
            List<String> cols = new ArrayList<>();
            for (int c = 0; c < header.getLastCellNum(); c++) cols.add(cell(header.getCell(c)));
            for (int r = 1; r <= sheet.getLastRowNum(); r++) {
                Row row = sheet.getRow(r);
                if (row == null) continue;
                Map<String, String> data = new LinkedHashMap<>();
                for (int c = 0; c < cols.size(); c++) data.put(cols.get(c), cell(row.getCell(c)));
                rows.put(data.getOrDefault("id", UUID.randomUUID().toString()), data);
            }
        } catch (Exception e) {
            log.warn("load excel failed: {}", e.getMessage());
        }
    }

    private String cell(Cell cell) {
        if (cell == null) return "";
        DataFormatter fmt = new DataFormatter();
        return fmt.formatCellValue(cell);
    }
` : ''}

    private void persist() {
        try {
            Files.createDirectories(path.getParent());
            if ("json".equals(engine)) {
                mapper.writerWithDefaultPrettyPrinter().writeValue(path.toFile(), new ArrayList<>(rows.values()));
            }${excel ? ` else if ("excel".equals(engine)) {
                try (Workbook wb = new XSSFWorkbook()) {
                    Sheet sheet = wb.createSheet(table);
                    Row head = sheet.createRow(0);
                    for (int c = 0; c < columns.size(); c++) head.createCell(c).setCellValue(columns.get(c));
                    int r = 1;
                    for (Map<String, String> row : rows.values()) {
                        Row line = sheet.createRow(r++);
                        for (int c = 0; c < columns.size(); c++) line.createCell(c).setCellValue(row.getOrDefault(columns.get(c), ""));
                    }
                    try (OutputStream out = Files.newOutputStream(path)) { wb.write(out); }
                }
            }` : ''} else {
                StringBuilder sb = new StringBuilder(String.join(",", columns)).append("\\n");
                for (Map<String, String> row : rows.values()) {
                    for (int c = 0; c < columns.size(); c++) {
                        if (c > 0) sb.append(',');
                        String v = row.getOrDefault(columns.get(c), "");
                        if (v.contains(",") || v.contains("\\"") || v.contains("\\n")) {
                            sb.append('"').append(v.replace("\\"", "\\"\\"")).append('"');
                        } else sb.append(v);
                    }
                    sb.append('\\n');
                }
                Files.writeString(path, sb.toString(), StandardCharsets.UTF_8);
            }
        } catch (Exception e) {
            log.warn("persist {} failed: {}", table, e.getMessage());
        }
    }
}
`,
    },
    {
      path: `src/main/java/${ir.pkgPath}/support/FileStoreRegistry.java`,
      content: `package ${p.groupId}.support;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 文件数据源注册表：一张表一个 store。 */
@Component
public class FileStoreRegistry {

    private final Map<String, FileTableStore> stores = new LinkedHashMap<>();

    public FileStoreRegistry() {
${ir.fileTables.map((t) => `        stores.put(${jstr(t.name)}, new FileTableStore(${jstr(t.name)}, ${jstr(t.engine)}, ${jstr(t.filePath || 'data/' + t.name + '.' + (t.engine === 'excel' ? 'xlsx' : t.engine))}, List.of(${t.columns.map((c) => jstr(c.name)).join(', ')})));`).join('\n')}
    }

    public FileTableStore get(String table) {
        FileTableStore store = stores.get(table);
        if (store == null) throw new IllegalArgumentException("未知文件表：" + table);
        return store;
    }
}
`,
    },
  ];
}

function yml(ir) {
  const p = ir.project;
  const cluster = p.database.cluster && p.database.cluster.enabled;
  const datasource = cluster
    ? `spring:
  datasource:
    dynamic:
      primary: master
      strict: false
      datasource:
        master:
          url: jdbc:mysql://${p.database.host}:${p.database.port}/${p.database.name}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
          username: ${p.database.user}
          password: ${p.database.password}
        slave_1:
          url: jdbc:mysql://${(p.database.cluster.readHosts[0] || p.database.host)}:${p.database.port}/${p.database.name}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false
          username: ${p.database.user}
          password: ${p.database.password}
`
    : `spring:
  datasource:
    driver-class-name: com.mysql.cj.jdbc.Driver
    url: jdbc:mysql://${p.database.host}:${p.database.port}/${p.database.name}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
    username: ${p.database.user}
    password: ${p.database.password}
    hikari:
      maximum-pool-size: ${p.database.pool.max}
      minimum-idle: ${p.database.pool.min}
`;
  const redis = p.redis.enabled ? `
  data:
    redis:
${p.redis.mode === 'cluster'
    ? `      cluster:
        nodes: ${p.redis.nodes.join(', ')}`
    : p.redis.mode === 'sentinel'
      ? `      sentinel:
        master: mymaster
        nodes: ${p.redis.nodes.join(', ')}`
      : `      host: ${(p.redis.nodes[0] || '127.0.0.1:6379').split(':')[0]}
      port: ${(p.redis.nodes[0] || '127.0.0.1:6379').split(':')[1] || 6379}
      database: ${p.redis.db}`}
      password: ${p.redis.password || ''}
      timeout: 3s
` : '';
  return `server:
  port: ${p.port}
  servlet:
    context-path: ${p.contextPath}
  tomcat:
    threads:
      max: 200

spring:
  application:
    name: ${p.artifact}
  profiles:
    active: dev
  jackson:
    date-format: yyyy-MM-dd HH:mm:ss
    time-zone: Asia/Shanghai
    default-property-inclusion: non_null
${datasource}${redis}
mybatis-plus:
  mapper-locations: classpath*:/mapper/**/*.xml
  type-aliases-package: ${p.groupId}.modules
  configuration:
    map-underscore-to-camel-case: true
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl
  global-config:
    banner: false
    db-config:
      id-type: ${p.idStrategy === 'auto' ? 'auto' : 'assign_id'}
      logic-delete-field: deleted
      logic-delete-value: 1
      logic-not-delete-value: 0

app:
  security:
    jwt-secret: ${p.security.jwtSecret}
    cookie-name: ${p.security.cookieName}
    ttl-seconds: ${p.security.ttlSeconds}
    init-admin: ${p.security.initAdmin}
    init-password: ${p.security.initPassword}
  storage:
    provider: ${p.storage.provider}
    endpoint: ${p.storage.endpoint}
    public-base: ${p.storage.publicBase}
    bucket: ${p.storage.bucket}
    access-key: ${p.storage.accessKey}
    secret-key: ${p.storage.secretKey}
    local-dir: ${p.storage.localDir}
  search:
    engine: ${p.search.engine}
    index-prefix: ${p.redis.keyPrefix}
    es-nodes: ${p.search.esNodes.join(', ')}

springdoc:
  api-docs:
    path: /v3/api-docs
  swagger-ui:
    path: /swagger-ui.html
    tags-sorter: alpha

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics${p.integrations.prometheus ? ',prometheus' : ''}
  endpoint:
    health:
      show-details: always

logging:
  level:
    root: info
    ${p.groupId}: debug
`;
}

function featuresFiles(ir) {
  const files = [];
  const auth = authService(ir);
  if (auth) {
    files.push({ path: `src/main/java/${ir.pkgPath}/auth/AuthService.java`, content: auth });
    files.push({ path: `src/main/java/${ir.pkgPath}/auth/AuthController.java`, content: authController(ir) });
    files.push(...loginDtos(ir));
  }
  files.push({ path: `src/main/java/${ir.pkgPath}/support/RbacService.java`, content: rbacService(ir) });
  const cache = cacheService(ir);
  if (cache) files.push({ path: `src/main/java/${ir.pkgPath}/support/CacheService.java`, content: cache });
  files.push(...searchFiles(ir));
  files.push(...storageFiles(ir));
  files.push(...logFiles(ir));
  files.push(...jobFiles(ir));
  const init = dataInitializer(ir);
  if (init) files.push({ path: `src/main/java/${ir.pkgPath}/support/DataInitializer.java`, content: init });
  const ap = approvalFacade(ir);
  if (ap) files.push({ path: `src/main/java/${ir.pkgPath}/modules/approval/ApprovalFacade.java`, content: ap });
  files.push(...fileStore(ir));
  files.push({ path: `src/main/resources/application.yml`, content: yml(ir) });
  return files;
}

module.exports = { featuresFiles, hasTable, tableOf };
