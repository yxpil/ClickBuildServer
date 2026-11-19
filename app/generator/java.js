'use strict';

const N = require('./naming');
const { supportFiles } = require('./javaSupport');
const { featuresFiles } = require('./javaFeatures');

const jstr = (s) => JSON.stringify(String(s == null ? '' : s));

function javaType(col) {
  const t = String(col.type).toLowerCase();
  if (t.startsWith('bigint')) return 'Long';
  if (t.startsWith('tinyint') || t.startsWith('smallint') || t.startsWith('mediumint') || /^int/.test(t)) return 'Integer';
  if (t.startsWith('decimal') || t.startsWith('numeric')) return 'BigDecimal';
  if (t.startsWith('double') || t.startsWith('float')) return 'Double';
  if (t.startsWith('datetime') || t.startsWith('timestamp')) return 'LocalDateTime';
  if (t.startsWith('date')) return 'LocalDate';
  if (t.startsWith('time')) return 'LocalTime';
  if (t.startsWith('blob') || t.startsWith('binary')) return 'byte[]';
  if (t === 'json') return 'String';
  return 'String';
}

const importsFor = (types) => {
  const list = [];
  if (types.includes('BigDecimal')) list.push('import java.math.BigDecimal;');
  if (types.some((t) => t.startsWith('Local'))) list.push('import java.time.*;');
  return list.join('\n');
};

function entityFile(table) {
  const cls = `${table.class}Entity`;
  const p = table.javaPackage;
  const commonNames = new Set(['id', 'tenantId', 'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'deleted']);
  const fields = table.columns.filter((c) => !commonNames.has(N.camel(c.name)));
  const types = fields.map(javaType);
  return `package ${p};

import com.baomidou.mybatisplus.annotation.*;
import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.Data;
import lombok.EqualsAndHashCode;
import ${table.javaPackage.replace(`.modules.${table.moduleDir}`, '.common')}.BaseEntity;

${importsFor(types)}

/** ${table.comment}（表 ${table.name}） */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("${table.name}")
public class ${cls} extends BaseEntity {
${fields.map((c) => `
    /** ${c.comment || c.name} */
    @TableField("${c.name}")
${javaType(c) === 'LocalDateTime' || javaType(c) === 'LocalDate' ? '    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")\n' : ''}    private ${javaType(c)} ${N.camel(c.name)};
`).join('')}}
`;
}

function mapperFile(table) {
  return `package ${table.javaPackage};

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface ${table.class}Mapper extends BaseMapper<${table.class}Entity> {
}
`;
}

function serviceFile(table) {
  const cls = table.class;
  const fields = table.search;
  const conditions = fields.length
    ? `        if (keyword != null && !keyword.isBlank()) {
            w.and(q -> q.like(${jstr(fields[0])}, keyword)${fields.slice(1).map((f) => `
                    .or().like(${jstr(f)}, keyword)`).join('')});
        }`
    : '        // 未配置可搜索字段：keyword 忽略';
  const colList = table.columns.map((c) => jstr(c.name)).join(', ');
  const owner = table.ownerField || '';
  return `package ${table.javaPackage};

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import ${table.javaPackage.replace(/\.modules\.[^.]+$/, '')}.common.UserContext;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class ${cls}Service extends ServiceImpl<${cls}Mapper, ${cls}Entity> {

    /** 可条件查询的列白名单（生成期固定，运行期不接受任意字段名） */
    public static final Set<String> COLUMNS = Set.of(${colList});

    /** 数据归属列：非超管只能看到/修改自己创建的数据 */
    public static final String OWNER_FIELD = ${jstr(owner)};

    /** 统一搜索条件：由生成器按表配置的可搜字段拼装。 */
    public QueryWrapper<${cls}Entity> wrapper(String keyword) {
        QueryWrapper<${cls}Entity> w = new QueryWrapper<>();
${conditions}
        return w;
    }

    /**
     * 条件查询：keyword + 白名单列 + 操作符 + 数据归属 + 排序。
     * ?field=值 / ?field__ne|gt|gte|lt|lte|like|in|between|isnull|notnull=值 / ?sort=field:desc
     */
    public QueryWrapper<${cls}Entity> wrapper(String keyword, Map<String, String[]> params) {
        QueryWrapper<${cls}Entity> w = wrapper(keyword);
        if (params != null) {
            for (Map.Entry<String, String[]> e : params.entrySet()) {
                String key = e.getKey();
                if (key.equals("keyword") || key.equals("page") || key.equals("size") || key.equals("sort")) continue;
                String[] vals = e.getValue();
                if (vals == null || vals.length == 0 || vals[0] == null || vals[0].isEmpty()) continue;
                String[] kv = key.split("__", 2);
                String field = kv[0];
                String op = kv.length > 1 ? kv[1] : "eq";
                if (!COLUMNS.contains(field)) continue;
                String val = vals[0];
                switch (op) {
                    case "eq" -> w.eq(field, val);
                    case "ne" -> w.ne(field, val);
                    case "gt" -> w.gt(field, val);
                    case "gte" -> w.ge(field, val);
                    case "lt" -> w.lt(field, val);
                    case "lte" -> w.le(field, val);
                    case "like" -> w.like(field, val);
                    case "in" -> w.in(field, Arrays.asList(val.split(",")));
                    case "between" -> {
                        String[] r = val.split(",");
                        if (r.length == 2) w.between(field, r[0], r[1]);
                    }
                    case "isnull" -> w.isNull(field);
                    case "notnull" -> w.isNotNull(field);
                    default -> { }
                }
            }
        }
        applyOwner(w);
        applySort(w, params);
        return w;
    }

    /** 数据归属过滤：非超管只看自己的数据 */
    public void applyOwner(QueryWrapper<${cls}Entity> w) {
        if (!OWNER_FIELD.isBlank() && !UserContext.isSuper()) {
            w.eq(OWNER_FIELD, UserContext.userId());
        }
    }

    /** 排序：?sort=field:desc,other:asc，列名走白名单 */
    private void applySort(QueryWrapper<${cls}Entity> w, Map<String, String[]> params) {
        if (params == null) return;
        String[] sort = params.get("sort");
        if (sort == null || sort.length == 0 || sort[0] == null || sort[0].isEmpty()) return;
        List<String> parts = Arrays.stream(sort[0].split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toList());
        for (String part : parts) {
            String[] fd = part.split(":", 2);
            if (!COLUMNS.contains(fd[0])) continue;
            if (fd.length > 1 && fd[1].equalsIgnoreCase("desc")) w.orderByDesc(fd[0]);
            else w.orderByAsc(fd[0]);
        }
    }
}
`;
}

function searchTextExpr(table, varName = 'e') {
  const fields = table.search.map((f) => {
    const getter = `get${N.pascal(f)}()`;
    return `Objects.toString(${varName}.${getter}, "")`;
  });
  return fields.length ? fields.join(' + " " + ') : '""';
}

function controllerFile(table, ir) {
  const p = ir.project;
  const cls = table.class;
  const pkg = table.javaPackage;
  const idType = p.idStrategy === 'ulid' || p.idStrategy === 'uuid' ? 'String' : 'Long';
  const idPath = idType === 'String' ? 'String' : 'Long';
  const moduleId = table.moduleId;
  const cache = table.cache && p.redis.enabled;
  const searchable = table.search.length > 0 && (p.redis.enabled || p.search.engine === 'elasticsearch');
  const audit = table.features && table.features.audit && ir.tables.some((t) => t.name === 'sys_approval');
  const exportable = table.features && table.features.export;
  const imports = [
    'import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;',
    'import com.baomidou.mybatisplus.extension.plugins.pagination.Page;',
    `import ${p.groupId}.common.ApiResult;`,
    `import ${p.groupId}.common.PageResult;`,
    `import ${p.groupId}.common.BizException;`,
    `import ${p.groupId}.common.UserContext;`,
    `import ${p.groupId}.security.RequirePerm;`,
    `import ${p.groupId}.security.OpLog;`,
  ];
  if (cache) imports.push(`import ${p.groupId}.support.CacheService;`);
  if (searchable) imports.push(`import ${p.groupId}.support.SearchService;`);
  if (audit) imports.push(`import ${p.groupId}.modules.approval.ApprovalFacade;`);
  imports.push(
    'import lombok.RequiredArgsConstructor;',
    'import org.springframework.web.bind.annotation.*;',
    'import jakarta.servlet.http.HttpServletResponse;',
    'import java.io.IOException;',
    'import java.io.PrintWriter;',
    'import java.util.List;',
    'import java.util.Objects;',
  );

  const fields = [
    cache ? '    private final CacheService cache;' : '',
    searchable ? '    private final SearchService searchService;' : '',
    audit ? '    private final ApprovalFacade approvalFacade;' : '',
  ].filter(Boolean).join('\n');

  const cacheKey = `"${p.redis.keyPrefix}:${table.name}:" + id`;

  return `package ${pkg};

${imports.join('\n')}

/** ${table.comment} · 由 ClickBuildServer 生成 */
@RestController
@RequestMapping("${table.route}")
@RequiredArgsConstructor
public class ${cls}Controller {

    private final ${cls}Service service;
${fields}
    @GetMapping
    @RequirePerm("${moduleId}:list")
    public ApiResult<PageResult<${cls}Entity>> list(
            @RequestParam(defaultValue = "1") long page,
            @RequestParam(defaultValue = "20") long size,
            @RequestParam(required = false) String keyword,
            jakarta.servlet.http.HttpServletRequest request) {
        return ApiResult.ok(PageResult.of(service.page(new Page<>(page, size), service.wrapper(keyword, request.getParameterMap()))));
    }

    @GetMapping("/{id}")
    @RequirePerm("${moduleId}:detail")
    public ApiResult<${cls}Entity> detail(@PathVariable ${idPath} id) {
${cache ? `        return ApiResult.ok(cache.get(${cacheKey}, ${table.cacheTtl}L, ${cls}Entity.class, () -> service.getById(id)));` : '        return ApiResult.ok(service.getById(id));'}
    }

    @PostMapping
    @RequirePerm("${moduleId}:create")
    @OpLog(module = "${moduleId}", action = "create")
    public ApiResult<${idType}> create(@RequestBody ${cls}Entity entity) {
        service.save(entity);
${cache ? `        cache.evict("${p.redis.keyPrefix}:${table.name}:" + entity.getId());` : ''}${searchable ? `
        if (entity.getId() != null) searchService.index("${table.name}", String.valueOf(entity.getId()), ${searchTextExpr(table, 'entity')});` : ''}
        return ApiResult.ok(entity.getId());
    }

    @PutMapping("/{id}")
    @RequirePerm("${moduleId}:update")
    @OpLog(module = "${moduleId}", action = "update")
    public ApiResult<Void> update(@PathVariable ${idPath} id, @RequestBody ${cls}Entity entity) {
        entity.setId(id);
        service.updateById(entity);
${cache ? `        cache.evict("${p.redis.keyPrefix}:${table.name}:" + id);` : ''}${searchable ? `
        searchService.index("${table.name}", String.valueOf(id), ${searchTextExpr(table, 'entity')});` : ''}
        return ApiResult.ok();
    }

    @DeleteMapping("/{id}")
    @RequirePerm("${moduleId}:delete")
    @OpLog(module = "${moduleId}", action = "delete")
    public ApiResult<Void> delete(@PathVariable ${idPath} id) {
        service.removeById(id);
${cache ? `        cache.evict("${p.redis.keyPrefix}:${table.name}:" + id);` : ''}${searchable ? `
        searchService.remove("${table.name}", String.valueOf(id));` : ''}
        return ApiResult.ok();
    }

    /** 条件新增：一次插入多条，body 是数组 */
    @PostMapping("/batch")
    @RequirePerm("${moduleId}:create")
    @OpLog(module = "${moduleId}", action = "create-batch")
    public ApiResult<Integer> createBatch(@RequestBody List<${cls}Entity> items) {
        service.saveBatch(items);
        return ApiResult.ok(items.size());
    }

    /** 条件更新：URL 带条件（同列表查询语法），body 只写要改的字段 */
    @PatchMapping
    @RequirePerm("${moduleId}:update")
    @OpLog(module = "${moduleId}", action = "update-where")
    public ApiResult<Boolean> updateWhere(@RequestBody ${cls}Entity entity,
            jakarta.servlet.http.HttpServletRequest request) {
        return ApiResult.ok(service.update(entity, service.wrapper(null, request.getParameterMap())));
    }

    /** 条件删除：不带 id，按条件批量删（逻辑删除优先） */
    @DeleteMapping
    @RequirePerm("${moduleId}:delete")
    @OpLog(module = "${moduleId}", action = "delete-where")
    public ApiResult<Boolean> deleteWhere(jakarta.servlet.http.HttpServletRequest request) {
        return ApiResult.ok(service.remove(service.wrapper(null, request.getParameterMap())));
    }
${audit ? `
    /** 提交审核：任意业务表都能挂到通用审核流。 */
    @PostMapping("/{id}/submit-audit")
    @RequirePerm("${moduleId}:audit")
    @OpLog(module = "${moduleId}", action = "submit-audit")
    public ApiResult<Long> submitAudit(@PathVariable ${idPath} id) {
        ${cls}Entity entity = service.getById(id);
        if (entity == null) throw new BizException("数据不存在");
        Long approvalId = approvalFacade.submit("${moduleId}", ${idType === 'String' ? 'id' : 'id'}, "${table.comment} " + id);
        return ApiResult.ok(approvalId);
    }
` : ''}${exportable ? `
    @GetMapping("/export")
    @RequirePerm("${moduleId}:export")
    public void export(HttpServletResponse response) throws IOException {
        response.setContentType("text/csv;charset=UTF-8");
        response.setHeader("Content-Disposition", "attachment;filename=${table.name}.csv");
        PrintWriter writer = response.getWriter();
        writer.println("${table.columns.filter((c) => !['deleted'].includes(c.name)).map((c) => c.name).join(',')}");
        List<${cls}Entity> list = service.list(new QueryWrapper<>());
        for (${cls}Entity e : list) {
            writer.println(String.join(",",
${table.columns.filter((c) => !['deleted'].includes(c.name)).map((c) => `                    safe(e.get${N.pascal(c.name)}())`).join(',\n')}
            ));
        }
        writer.flush();
    }

    private String safe(Object v) {
        String s = Objects.toString(v, "");
        return s.contains(",") || s.contains("\\"") ? "\\"" + s.replace("\\"", "\\"\\"") + "\\"" : s;
    }
` : ''}}
`;
}

function fileController(table, ir) {
  const p = ir.project;
  const cls = table.class;
  const moduleId = table.moduleId;
  const cols = table.columns.map((c) => c.name);
  const search = table.search;
  const cond = search.length
    ? `store().list(keyword, (int) page, (int) size)`
    : `store().list(null, (int) page, (int) size)`;
  return `package ${table.javaPackage};

import ${p.groupId}.common.ApiResult;
import ${p.groupId}.common.PageResult;
import ${p.groupId}.common.BizException;
import ${p.groupId}.security.RequirePerm;
import ${p.groupId}.common.UserContext;
import ${p.groupId}.support.FileStoreRegistry;
import ${p.groupId}.support.FileTableStore;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/** ${table.comment} · 文件即数据库（${table.engine.toUpperCase()}） */
@RestController
@RequestMapping("${table.route}")
@RequiredArgsConstructor
public class ${cls}Controller {

    private final FileStoreRegistry registry;

    private FileTableStore store() { return registry.get("${table.name}"); }

    @GetMapping
    @RequirePerm("${moduleId}:list")
    public ApiResult<PageResult<Map<String, String>>> list(
            @RequestParam(defaultValue = "1") long page,
            @RequestParam(defaultValue = "20") long size,
            @RequestParam(required = false) String keyword) {
        return ApiResult.ok(PageResult.of(page, size, store().count(keyword), ${cond}));
    }

    @GetMapping("/{id}")
    @RequirePerm("${moduleId}:detail")
    public ApiResult<Map<String, String>> detail(@PathVariable String id) {
        Map<String, String> row = store().get(id);
        if (row == null) throw new BizException("记录不存在");
        return ApiResult.ok(row);
    }

    @PostMapping
    @RequirePerm("${moduleId}:create")
    public ApiResult<Map<String, String>> create(@RequestBody Map<String, String> body) {
        return ApiResult.ok(store().save(body));
    }

    @PutMapping("/{id}")
    @RequirePerm("${moduleId}:update")
    public ApiResult<Void> update(@PathVariable String id, @RequestBody Map<String, String> body) {
        if (!store().update(id, body)) throw new BizException("记录不存在");
        return ApiResult.ok();
    }

    @DeleteMapping("/{id}")
    @RequirePerm("${moduleId}:delete")
    public ApiResult<Void> delete(@PathVariable String id) {
        store().delete(id);
        return ApiResult.ok();
    }
}
`;
}

function approvalController(ir) {
  if (!ir.tables.some((t) => t.name === 'sys_approval')) return null;
  return `package ${ir.project.groupId}.modules.approval;

import ${ir.project.groupId}.common.ApiResult;
import ${ir.project.groupId}.common.BizException;
import ${ir.project.groupId}.security.RequirePerm;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/** 通用审核动作：业务侧只负责 submit，这里负责通过 / 驳回 / 待办。 */
@RestController
@RequestMapping("/approval/task")
@RequiredArgsConstructor
public class ApprovalController {

    private final ApprovalFacade facade;
    private final SysApprovalService service;

    @GetMapping("/todo")
    @RequirePerm("approval:list")
    public ApiResult<List<SysApprovalEntity>> todo() {
        return ApiResult.ok(service.lambdaQuery().eq(SysApprovalEntity::getStatus, 0)
                .orderByDesc(SysApprovalEntity::getId).last("limit 200").list());
    }

    @PostMapping("/{id}/pass")
    @RequirePerm("approval:audit")
    public ApiResult<Void> pass(@PathVariable Long id, @RequestBody(required = false) Map<String, String> body) {
        facade.pass(id, body == null ? "" : body.getOrDefault("opinion", ""));
        return ApiResult.ok();
    }

    @PostMapping("/{id}/reject")
    @RequirePerm("approval:audit")
    public ApiResult<Void> reject(@PathVariable Long id, @RequestBody(required = false) Map<String, String> body) {
        facade.reject(id, body == null ? "" : body.getOrDefault("opinion", ""));
        return ApiResult.ok();
    }
}
`;
}

function pom(ir) {
  const p = ir.project;
  const deps = [];
  const add = (g, a, v, extra = '') => deps.push(`        <dependency>
            <groupId>${g}</groupId>
            <artifactId>${a}</artifactId>${v ? `\n            <version>${v}</version>` : ''}${extra}
        </dependency>`);
  add('org.springframework.boot', 'spring-boot-starter-web');
  add('org.springframework.boot', 'spring-boot-starter-validation');
  add('org.springframework.boot', 'spring-boot-starter-aop');
  add('org.springframework.security', 'spring-security-crypto');
  add('com.baomidou', 'mybatis-plus-spring-boot3-starter', '3.5.7');
  add('com.mysql', 'mysql-connector-j', '', '\n            <scope>runtime</scope>');
  add('org.projectlombok', 'lombok', '', '\n            <optional>true</optional>');
  add('io.jsonwebtoken', 'jjwt-api', '0.12.6');
  add('io.jsonwebtoken', 'jjwt-impl', '0.12.6', '\n            <scope>runtime</scope>');
  add('io.jsonwebtoken', 'jjwt-jackson', '0.12.6', '\n            <scope>runtime</scope>');
  if (p.redis.enabled) add('org.springframework.boot', 'spring-boot-starter-data-redis');
  if (p.storage.provider === 'minio' || p.storage.provider === 's3') add('io.minio', 'minio', '8.5.12');
  if (p.integrations.swagger) add('org.springdoc', 'springdoc-openapi-starter-webmvc-ui', '2.6.0');
  if (ir.fileTables.some((t) => t.engine === 'excel')) add('org.apache.poi', 'poi-ooxml', '5.3.0');
  if (p.database.cluster && p.database.cluster.enabled) add('com.baomidou', 'dynamic-datasource-spring-boot3-starter', '4.3.0');
  if (p.integrations.actuator || p.integrations.prometheus) add('org.springframework.boot', 'spring-boot-starter-actuator');
  if (p.integrations.prometheus) add('io.micrometer', 'micrometer-registry-prometheus');
  if (p.integrations.kafka) add('org.springframework.kafka', 'spring-kafka');
  if (p.integrations.rabbitmq) add('org.springframework.boot', 'spring-boot-starter-amqp');
  if (p.integrations.mail) add('org.springframework.boot', 'spring-boot-starter-mail');
  if (p.integrations.websocket) add('org.springframework.boot', 'spring-boot-starter-websocket');
  if (p.packageType === 'war') add('org.springframework.boot', 'spring-boot-starter-tomcat', '', '\n            <scope>provided</scope>');
  deps.push(`        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.3.5</version>
        <relativePath/>
    </parent>

    <groupId>${p.groupId}</groupId>
    <artifactId>${p.artifact}</artifactId>
    <version>${p.version}</version>
    <packaging>${p.packageType}</packaging>
    <name>${p.name}</name>
    <description>Generated by ClickBuildServer · ${ir.stats.tables} tables · ${ir.stats.modules} modules</description>

    <properties>
        <java.version>17</java.version>
        <lombok.version>1.18.48</lombok.version>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencies>
${deps.join('\n')}
    </dependencies>

    <build>
        <finalName>${p.artifact}</finalName>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <configuration>
                    <annotationProcessorPaths>
                        <path>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                            <version>${'${'}lombok.version}</version>
                        </path>
                    </annotationProcessorPaths>
                </configuration>
            </plugin>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
`;
}

/** 自定义积木：每个积木一个方法，用户继续在方法体里写自己的工具 */
function blockRegistry(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.modules.blocks`;
  const blocks = ir.blocks || [];
  const cases = blocks.map((b) => `            case ${jstr(b.id)}: return ${N.camel(b.id)}(params, body, user);`).join('\n');

  const methods = blocks.map((b) => {
    const ref = b.code && b.code.trim()
      ? '\n' + b.code.trim().split('\n').map((l) => '        //   ' + l).join('\n')
      : '';
    return `
    /** 积木 ${b.id} · ${b.name || ''}
     * 权限：${b.perm || '（无）'}；参数：${(b.params || []).join(', ') || '（无）'}
     * 在这里写你自己的逻辑，可用 ${p.groupId}.common.UserContext / 任意注入的 Service。${ref}
     */
    private Map<String, Object> ${N.camel(b.id)}(Map<String, String> params, Map<String, Object> body, LoginUser user) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("block", ${jstr(b.id)});
        out.put("params", params);
        return out;
    }`;
  }).join('\n');

  const perms = blocks.map((b) => `            case ${jstr(b.id)}: return ${jstr(b.perm || '')};`).join('\n');

  return `package ${pkg};

import ${p.groupId}.common.BizException;
import ${p.groupId}.security.LoginUser;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 积木注册表：由 ${blocks.length} 个自定义积木渲染而来，改方法体就是加自己的工具 */
@Component
public class BlockRegistry {

    public static final List<String> IDS = List.of(${blocks.map((b) => jstr(b.id)).join(', ')});

    /** 每个积木声明的权限码（空串表示登录即可） */
    public String permOf(String id) {
        switch (id) {
${perms}
            default: return "";
        }
    }

    public List<Map<String, Object>> list() {
        List<Map<String, Object>> out = new ArrayList<>();
${blocks.map((b) => `        out.add(block(${jstr(b.id)}, ${jstr(b.name || b.id)}, ${jstr(b.method)}, ${jstr(b.path)}, ${jstr(b.perm || '')}, List.of(${(b.params || []).map((x) => jstr(x)).join(', ')})));`).join('\n')}
        return out;
    }

    public Map<String, Object> run(String id, Map<String, String> params, Map<String, Object> body, LoginUser user) {
        String perm = permOf(id);
        if (!perm.isBlank() && (user == null || !user.hasPerm(perm))) {
            throw new BizException(403, "无权限执行该积木: " + id);
        }
        switch (id) {
${cases}
            default: throw new BizException(404, "积木不存在: " + id);
        }
    }

    private Map<String, Object> block(String id, String name, String method, String path, String perm, List<String> params) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("name", name);
        m.put("method", method);
        m.put("path", path);
        m.put("perm", perm);
        m.put("params", params);
        return m;
    }
${methods}
}
`;
}

function blockController(ir) {
  const pkg = `${ir.project.groupId}.modules.blocks`;
  return `package ${pkg};

import ${ir.project.groupId}.common.ApiResult;
import ${ir.project.groupId}.common.UserContext;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 积木路由：GET/POST /blocks/{id}，另有 GET /blocks 列出全部积木 */
@RestController
@RequestMapping("/blocks")
@RequiredArgsConstructor
public class BlockController {

    private final BlockRegistry registry;

    @GetMapping
    public ApiResult<List<Map<String, Object>>> list() {
        return ApiResult.ok(registry.list());
    }

    @GetMapping("/{id}")
    public ApiResult<Map<String, Object>> get(@PathVariable String id, @RequestParam Map<String, String> params) {
        return ApiResult.ok(registry.run(id, params, new LinkedHashMap<>(), UserContext.get()));
    }

    @PostMapping("/{id}")
    public ApiResult<Map<String, Object>> post(@PathVariable String id,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam Map<String, String> params) {
        return ApiResult.ok(registry.run(id, params, body == null ? new LinkedHashMap<>() : body, UserContext.get()));
    }
}
`;
}

/** 验证码：只做对接骨架，真正发送交给你配置的第三方通道 */
function verifyCodeService(ir) {
  const p = ir.project;
  const pkg = `${p.groupId}.modules.verifycode`;
  const v = ir.verification || {};
  const sms = v.sms || {};
  const email = v.email || {};
  return `package ${pkg};

import ${p.groupId}.common.BizException;
import ${p.groupId}.common.IdGen;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/** 验证码服务：生成 → 落库 → 交给通道发；通道为 none 时只打日志（dry-run） */
@Service
@RequiredArgsConstructor
public class VerifyCodeService {

    public static final String SMS_PROVIDER = ${jstr(sms.provider || 'none')};
    public static final String SMS_ENDPOINT = ${jstr(sms.endpoint || '')};
    public static final String SMS_SIGN = ${jstr(sms.signName || '')};
    public static final String SMS_TEMPLATE = ${jstr(sms.templateCode || '')};
    public static final String EMAIL_PROVIDER = ${jstr(email.provider || 'none')};
    public static final String EMAIL_HOST = ${jstr(email.host || '')};
    public static final String EMAIL_FROM = ${jstr(email.from || '')};

    private final SysVerifyCodeService codeService;

    public Map<String, Object> send(String channel, String target, String scene, String ip) {
        if (target == null || target.isBlank()) throw new BizException(400, "缺少接收方");
        if (!"sms".equals(channel) && !"email".equals(channel)) throw new BizException(400, "通道只支持 sms / email");
        String sc = (scene == null || scene.isBlank()) ? "default" : scene;
        String code = String.format("%06d", ThreadLocalRandom.current().nextInt(1000000));

        SysVerifyCodeEntity e = new SysVerifyCodeEntity();
        e.setId(IdGen.nextId());
        e.setChannel(channel);
        e.setTarget(target);
        e.setCode(code);
        e.setScene(sc);
        e.setExpireAt(LocalDateTime.now().plusMinutes(5));
        e.setUsed(0);
        e.setSentAt(LocalDateTime.now());
        e.setIp(ip);
        codeService.save(e);

        Map<String, Object> out = "sms".equals(channel)
                ? sendSms(target, code, sc)
                : sendEmail(target, code, sc);
        out.put("expireAt", e.getExpireAt().toString());
        return out;
    }

    public boolean verify(String channel, String target, String code, String scene) {
        if (code == null || code.isBlank()) return false;
        String sc = (scene == null || scene.isBlank()) ? "default" : scene;
        SysVerifyCodeEntity e = codeService.lambdaQuery()
                .eq(SysVerifyCodeEntity::getTarget, target)
                .eq(SysVerifyCodeEntity::getCode, code)
                .eq(SysVerifyCodeEntity::getUsed, 0)
                .orderByDesc(SysVerifyCodeEntity::getId)
                .last("limit 1")
                .one();
        if (e == null) return false;
        if (e.getExpireAt() != null && e.getExpireAt().isBefore(LocalDateTime.now())) return false;
        codeService.lambdaUpdate().eq(SysVerifyCodeEntity::getId, e.getId())
                .set(SysVerifyCodeEntity::getUsed, 1).update();
        return true;
    }

    public Map<String, Object> channels() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sms", Map.of("provider", SMS_PROVIDER, "endpoint", SMS_ENDPOINT));
        out.put("email", Map.of("provider", EMAIL_PROVIDER, "host", EMAIL_HOST));
        return out;
    }

    private Map<String, Object> sendSms(String target, String code, String scene) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("channel", "sms");
        out.put("provider", SMS_PROVIDER);
        if (SMS_PROVIDER.isBlank() || "none".equals(SMS_PROVIDER)) {
            System.out.println("[sms:dry-run] " + target + " " + code + " " + scene);
            out.put("sent", false);
            out.put("dryRun", true);
            return out;
        }
        if ("http".equals(SMS_PROVIDER)) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("target", target);
            payload.put("code", code);
            payload.put("scene", scene);
            payload.put("signName", SMS_SIGN);
            payload.put("templateCode", SMS_TEMPLATE);
            post(SMS_ENDPOINT, payload);
            out.put("sent", true);
            return out;
        }
        throw new BizException("未实现的短信通道: " + SMS_PROVIDER + "（支持 none / http）");
    }

    private Map<String, Object> sendEmail(String target, String code, String scene) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("channel", "email");
        out.put("provider", EMAIL_PROVIDER);
        if (EMAIL_PROVIDER.isBlank() || "none".equals(EMAIL_PROVIDER)) {
            System.out.println("[email:dry-run] " + target + " " + code + " " + scene);
            out.put("sent", false);
            out.put("dryRun", true);
            return out;
        }
        if ("http".equals(EMAIL_PROVIDER)) {
            String endpoint = EMAIL_HOST.startsWith("http") ? EMAIL_HOST : "http://" + EMAIL_HOST;
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("target", target);
            payload.put("code", code);
            payload.put("scene", scene);
            payload.put("from", EMAIL_FROM);
            post(endpoint, payload);
            out.put("sent", true);
            return out;
        }
        throw new BizException("email provider 仅支持 http 网关");
    }

    /** 把验证码 POST 到你自己的网关（我们不做短信/邮件服务，只做对接） */
    private void post(String endpoint, Map<String, Object> payload) {
        if (endpoint == null || endpoint.isBlank()) throw new BizException("通道 endpoint 未配置");
        try {
            String json = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(payload);
            HttpRequest req = HttpRequest.newBuilder(URI.create(endpoint))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            HttpResponse<String> resp = HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() >= 300) throw new BizException("通道返回 " + resp.statusCode());
        } catch (BizException e) {
            throw e;
        } catch (Exception e) {
            throw new BizException("调用通道失败: " + e.getMessage());
        }
    }
}
`;
}

function verifyCodeController(ir) {
  const pkg = `${ir.project.groupId}.modules.verifycode`;
  return `package ${pkg};

import ${ir.project.groupId}.common.ApiResult;
import ${ir.project.groupId}.security.RequirePerm;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** 验证码接口：发送 / 校验 / 通道列表 */
@RestController
@RequestMapping("/captcha")
@RequiredArgsConstructor
public class VerifyCodeController {

    private final VerifyCodeService service;

    /** 发送验证码通常用于注册/登录，公开接口（拦截器放行 /captcha） */
    @PostMapping("/send")
    public ApiResult<Map<String, Object>> send(@RequestBody Map<String, Object> body) {
        return ApiResult.ok(service.send(
                String.valueOf(body.get("channel")),
                String.valueOf(body.get("target")),
                String.valueOf(body.get("scene")),
                String.valueOf(body.getOrDefault("ip", ""))));
    }

    @PostMapping("/verify")
    @RequirePerm("verify-code:list")
    public ApiResult<Map<String, Object>> verify(@RequestBody Map<String, Object> body) {
        boolean ok = service.verify(
                String.valueOf(body.get("channel")),
                String.valueOf(body.get("target")),
                String.valueOf(body.get("code")),
                String.valueOf(body.get("scene")));
        return ApiResult.ok(Map.of("verified", ok));
    }

    @GetMapping("/channels")
    @RequirePerm("verify-code:list")
    public ApiResult<Map<String, Object>> channels() {
        return ApiResult.ok(service.channels());
    }
}
`;
}

function generateJava(ir) {
  const files = [
    { path: 'pom.xml', content: pom(ir) },
    ...supportFiles(ir),
    ...featuresFiles(ir),
  ];

  ir.mysqlTables.forEach((t) => {
    files.push({ path: `src/main/java/${ir.pkgPath}/modules/${t.moduleDir}/${t.class}Entity.java`, content: entityFile(t) });
    files.push({ path: `src/main/java/${ir.pkgPath}/modules/${t.moduleDir}/${t.class}Mapper.java`, content: mapperFile(t) });
    files.push({ path: `src/main/java/${ir.pkgPath}/modules/${t.moduleDir}/${t.class}Service.java`, content: serviceFile(t) });
    files.push({ path: `src/main/java/${ir.pkgPath}/modules/${t.moduleDir}/${t.class}Controller.java`, content: controllerFile(t, ir) });
  });
  ir.fileTables.forEach((t) => {
    files.push({ path: `src/main/java/${ir.pkgPath}/modules/${t.moduleDir}/${t.class}Controller.java`, content: fileController(t, ir) });
  });

  const ap = approvalController(ir);
  if (ap) files.push({ path: `src/main/java/${ir.pkgPath}/modules/approval/ApprovalController.java`, content: ap });

  if ((ir.blocks || []).length) {
    files.push({ path: `src/main/java/${ir.pkgPath}/modules/blocks/BlockRegistry.java`, content: blockRegistry(ir) });
    files.push({ path: `src/main/java/${ir.pkgPath}/modules/blocks/BlockController.java`, content: blockController(ir) });
  }
  if (ir.modules.some((m) => m.id === 'verify-code')) {
    files.push({ path: `src/main/java/${ir.pkgPath}/modules/verifycode/VerifyCodeService.java`, content: verifyCodeService(ir) });
    files.push({ path: `src/main/java/${ir.pkgPath}/modules/verifycode/VerifyCodeController.java`, content: verifyCodeController(ir) });
  }

  // 文件数据源目录占位
  ir.fileTables.forEach((t) => {
    const file = t.filePath || `data/${t.name}.${t.engine === 'excel' ? 'xlsx' : t.engine}`;
    if (t.engine === 'csv') {
      files.push({ path: file, content: t.columns.map((c) => c.name).join(',') + '\n' });
    } else if (t.engine === 'json') {
      files.push({ path: file, content: '[\n]\n' });
    }
  });

  return files;
}

module.exports = { generateJava, javaType };
