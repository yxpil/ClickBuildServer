// 作者：yxpil
'use strict';
const N = require('./naming');
const { goMod, configGo, dbGo, cacheGo, idGo } = require('./goData');
const { authGo, queryGo, crudGo, filesourceGo, customsqlGo, storageGo, pluginsGo } = require('./goData2');

/** 生成 schema.go：表 / 查询 / 权限的字面量 */
function schemaGo(ir) {
  const colLit = (c) => `{Name: ${JSON.stringify(c.name)}, Type: ${JSON.stringify(c.type || 'varchar(64)')}, Required: ${!!c.required}, Unique: ${!!c.unique}, PK: ${!!c.pk}, Auto: ${!!c.auto}}`;
  const tableLit = (t) => `\t{
\t\tName: ${JSON.stringify(t.name)}, Module: ${JSON.stringify(t.moduleId)}, Dir: ${JSON.stringify(t.moduleDir)},
\t\tRoute: ${JSON.stringify(t.route)}, Engine: ${JSON.stringify(t.engine)}, Path: ${JSON.stringify(t.filePath || t.path || '')},
\t\tComment: ${JSON.stringify(t.comment || '')}, Search: []string{${(t.search || []).map((s) => JSON.stringify(s)).join(', ')}},
\t\tCache: ${t.cache !== false}, CacheTTL: ${t.cacheTtl || 300}, PK: ${JSON.stringify(t.pk || 'id')},
\t\tOwnerField: ${JSON.stringify(t.ownerField || '')},
\t\tColumns: []Column{${(t.columns || []).map(colLit).join(', ')}},
\t},`;
  const queryLit = (q) => `\t{Name: ${JSON.stringify(q.name)}, Method: ${JSON.stringify(q.method)}, Perm: ${JSON.stringify(q.perm)}, SQL: ${JSON.stringify(q.sql)}, Params: []string{${(q.params || []).map((s) => JSON.stringify(s)).join(', ')}}, Comment: ${JSON.stringify(q.comment || '')}},`;

  return `package schema

type Column struct {
	Name     string
	Type     string
	Required bool
	Unique   bool
	PK       bool
	Auto     bool
}

type Table struct {
	Name       string
	Module     string
	Dir        string
	Route      string
	Engine     string
	Path       string
	Comment    string
	Search     []string
	Cache      bool
	CacheTTL   int
	PK         string
	OwnerField string
	Columns    []Column
}

type Query struct {
	Name    string
	Method  string
	Perm    string
	SQL     string
	Params  []string
	Comment string
}

var Tables = []Table{
${ir.tables.map(tableLit).join('\n')}
}

var Queries = []Query{
${(ir.queries || []).map(queryLit).join('\n')}
}
`;
}

/** 生成 main.go：路由装配 + 鉴权 + 上传 + 播放 */
function mainGo(ir) {
  const p = ir.project;
  const hasMedia = ir.modules.some((m) => m.id === 'media-upload');
  const hasPlay = ir.modules.some((m) => m.id === 'media-play');
  const hasVerify = ir.modules.some((m) => m.id === 'verify-code');
  const hasBlocks = (ir.blocks || []).length > 0;
  const hasLog = ir.modules.some((m) => m.id === 'audit-log');

  const tableRoutes = ir.tables.map((t) => {
    const base = `/api${t.route}`;
    const mod = t.moduleId;
    return `
	{
		svc := crud.New(schema.Tables[${ir.tables.indexOf(t)}])
		mux.HandleFunc("GET ${base}", guard("${mod}:list", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
			data, err := svc.List(r, u)
			if err != nil { fail(w, 500, err.Error()); return }
			okJSON(w, data)
		}))
		mux.HandleFunc("GET ${base}/{id}", guard("${mod}:detail", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
			data, err := svc.Detail(r, r.PathValue("id"))
			if err != nil { fail(w, 500, err.Error()); return }
			okJSON(w, data)
		}))
		mux.HandleFunc("POST ${base}", guard("${mod}:create", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
			body := map[string]any{}
			if err := readJSON(r, &body); err != nil { fail(w, 400, "请求体不是合法 JSON"); return }
			idv, err := svc.Create(r, body)
			if err != nil { fail(w, 500, err.Error()); return }
			${hasLog ? `go logOp(r, "${mod}", "create", fmt.Sprint(idv))` : ''}
			okJSON(w, map[string]any{"id": idv})
		}))
		mux.HandleFunc("PUT ${base}/{id}", guard("${mod}:update", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
			body := map[string]any{}
			if err := readJSON(r, &body); err != nil { fail(w, 400, "请求体不是合法 JSON"); return }
			if err := svc.Update(r, r.PathValue("id"), body, u); err != nil { fail(w, 500, err.Error()); return }
			okJSON(w, true)
		}))
		mux.HandleFunc("DELETE ${base}/{id}", guard("${mod}:delete", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
			if err := svc.Delete(r, r.PathValue("id"), u); err != nil { fail(w, 500, err.Error()); return }
			okJSON(w, true)
		}))
		// 条件新增：批量插入
		mux.HandleFunc("POST ${base}/batch", guard("${mod}:create", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
			var items []map[string]any
			if err := json.NewDecoder(r.Body).Decode(&items); err != nil { fail(w, 400, "body 需要 JSON 数组"); return }
			res, err := svc.InsertMany(r, items, u)
			if err != nil { fail(w, 500, err.Error()); return }
			okJSON(w, res)
		}))
		// 条件更新：PATCH ?条件 + body.set
		mux.HandleFunc("PATCH ${base}", guard("${mod}:update", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
			body := map[string]any{}
			if err := readJSON(r, &body); err != nil { fail(w, 400, "请求体不是合法 JSON"); return }
			sets, ok := body["set"].(map[string]any)
			if !ok || sets == nil { sets = body }
			res, err := svc.PatchWhere(r, sets, u)
			if err != nil { fail(w, 500, err.Error()); return }
			okJSON(w, res)
		}))
		// 条件删除：不带 id，按条件批量删
		mux.HandleFunc("DELETE ${base}", guard("${mod}:delete", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
			res, err := svc.DeleteWhere(r, u)
			if err != nil { fail(w, 500, err.Error()); return }
			okJSON(w, res)
		}))
	}`;
  }).join('\n');

  const queryRoutes = (ir.queries || []).map((q) => `
	mux.HandleFunc("${q.method} /api/query/${q.name}", guard("${q.perm}", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
		extra := map[string]any{"userId": u.UserID, "username": u.Username}
		if r.Method == "POST" {
			body := map[string]any{}
			if err := readJSON(r, &body); err != nil { fail(w, 400, "请求体不是合法 JSON"); return }
			for k, v := range body { extra[k] = v }
		}
		res, err := customsql.Run(r, "${q.name}", extra)
		if err != nil { fail(w, 500, err.Error()); return }
		okJSON(w, res)
	}))
`).join('\n');

  const hasQueries = (ir.queries || []).length > 0;
  const imports = [
    '"encoding/json"',
    '"fmt"',
    '"io"',
    '"log"',
    '"net/http"',
    '"os"',
    '"path/filepath"',
    '"strings"',
    '"time"',
    '',
    '"REPLACE_MODULE/internal/auth"',
    hasBlocks ? '"REPLACE_MODULE/internal/blocks"' : '',
    '"REPLACE_MODULE/internal/config"',
    '"REPLACE_MODULE/internal/crud"',
    hasQueries ? '"REPLACE_MODULE/internal/customsql"' : '',
    '"REPLACE_MODULE/internal/db"',
    '"REPLACE_MODULE/internal/id"',
    hasPlay ? '"REPLACE_MODULE/internal/plugins"' : '',
    '"REPLACE_MODULE/internal/schema"',
    hasMedia ? '"REPLACE_MODULE/internal/storage"' : '',
    hasVerify ? '"REPLACE_MODULE/internal/verifycode"' : '',
    '"REPLACE_MODULE/internal/waf"',
  ].filter((x) => x !== '').join('\n\t');

  return `package main

import (
	${imports}
)

const prefix = "/api"

func okJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "message": "ok", "data": data})
}

func fail(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"code": status, "message": msg})
}

// readJSON 读请求体：空 body 视为 {}，坏 JSON 报错交给调用方回 400
func readJSON(r *http.Request, dst any) error {
	err := json.NewDecoder(r.Body).Decode(dst)
	if err == io.EOF {
		return nil
	}
	return err
}

func guard(perm string, h func(http.ResponseWriter, *http.Request, *auth.User)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := auth.Current(r)
		if err != nil {
			fail(w, 401, err.Error())
			return
		}
		if perm != "" && !auth.HasPerm(u, perm) {
			fail(w, 403, "无权限："+perm)
			return
		}
		h(w, r, u)
	}
}

${hasLog ? `func logOp(r *http.Request, module, action, detail string) {
	go func() {
		// id 是雪花主键（无自增），module 在 DDL 里避关键字成了 module_x
		_, _ = db.Exec(nil, "INSERT INTO sys_operation_log (id, module_x, action, user_id, username, params, ip, created_at) VALUES (?,?,?,?,?,?,?,NOW())",
			id.Next(), module, action, 0, "", detail, r.RemoteAddr)
	}()
}` : ''}

func trimPath(p string) string {
	p = strings.TrimPrefix(p, prefix)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

func main() {
	id.Init(config.C.Port)
	if len(os.Args) > 1 && os.Args[1] == "--selfcheck" {
		fmt.Printf("[selfcheck] 表 %d / 查询 %d / 模块 %d\\n", len(schema.Tables), len(schema.Queries), ${ir.stats.modules})
		for _, t := range schema.Tables {
			fmt.Printf("  %-8s %s%s\\n", t.Engine, prefix, t.Route)
		}
		return
	}

	if err := db.Init(); err != nil {
		log.Printf("[boot] MySQL 未连接：%v（接口首次查询会报错）", err)
	} else {
		auth.Bootstrap()
	}

	mux := http.NewServeMux()
	// 兜底：未匹配路由统一回 JSON 404，别吐 net/http 的纯文本
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "接口不存在："+r.URL.Path) })

	// 健康检查：不鉴权，容器/网关探活用
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		state := "UP"
		dbOK := true
		if err := db.Ping(); err != nil { state, dbOK = "DEGRADED", false }
		okJSON(w, map[string]any{
			"status": state,
			"app":    config.C.Name,
			"db":     dbOK,
			"time":   time.Now().Format(time.RFC3339),
		})
	})

	// 认证
	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		body := map[string]any{}
		if err := readJSON(r, &body); err != nil { fail(w, 400, "请求体不是合法 JSON"); return }
		uname := fmt.Sprint(body["username"])
		rows, err := db.QueryRead(r.Context(), "SELECT id, username, password FROM sys_user WHERE username = ? AND deleted = 0 LIMIT 1", uname)
		if err != nil || len(rows) == 0 {
			fail(w, 401, "账号或密码错误")
			return
		}
		if !auth.CheckPassword(fmt.Sprint(body["password"]), fmt.Sprint(rows[0]["password"])) {
			fail(w, 401, "账号或密码错误")
			return
		}
		uid := fmt.Sprint(rows[0]["id"])
		tid := fmt.Sprintf("%d", time.Now().UnixNano())
		luid, perms := auth.IssueLuid(r, toInt(uid), uname)
		token := auth.Sign(toInt(uid), uname, tid, luid)
		_, _ = db.Exec(r.Context(), "INSERT INTO sys_session (id, token_id, user_id, device, ip, expires_at, revoked, created_at, updated_at, deleted) VALUES (?,?,?,?,?,DATE_ADD(NOW(), INTERVAL ? SECOND),0,NOW(),NOW(),0)",
			id.Next(), tid, uid, r.UserAgent(), r.RemoteAddr, config.C.TokenTTL)
		auth.SetCookie(w, token)
		okJSON(w, map[string]any{"token": token, "userId": uid, "username": uname, "luid": luid, "perms": perms})
	})

	mux.HandleFunc("POST /api/auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if c, ok := auth.Verify(auth.TokenFrom(r)); ok {
			_, _ = db.Exec(r.Context(), "UPDATE sys_session SET revoked = 1 WHERE token_id = ?", fmt.Sprint(c["tid"]))
			luid, _ := c["luid"].(string)
			auth.DropLuid(luid)
		}
		auth.ClearCookie(w)
		okJSON(w, true)
	})

	mux.HandleFunc("GET /api/auth/me", guard("", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
		okJSON(w, map[string]any{"userId": u.UserID, "username": u.Username, "luid": u.Luid, "perms": u.Perms})
	}))

	mux.HandleFunc("POST /api/auth/refresh", guard("", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
		luid := u.Luid
		if luid == "" {
			luid, _ = auth.IssueLuid(r, u.UserID, u.Username)
		}
		token := auth.Sign(u.UserID, u.Username, u.TokenID, luid)
		auth.SetCookie(w, token)
		okJSON(w, map[string]any{"token": token, "luid": luid})
	}))

${tableRoutes}

${queryRoutes}

${hasBlocks ? `// 自定义积木：用户自己写的工具，一个积木一条路由
	for _, b := range blocks.List {
		b := b
		mux.HandleFunc(b.Method+" /api"+b.Path, guard(b.Perm, func(w http.ResponseWriter, r *http.Request, u *auth.User) {
			body := map[string]any{}
			if r.Method == "POST" {
				if err := readJSON(r, &body); err != nil { fail(w, 400, "请求体不是合法 JSON"); return }
			}
			c := &blocks.Ctx{R: r, User: u, Params: map[string]string{}, Query: r.URL.Query(), Body: body}
			res, err := b.Handler(c)
			if err != nil { fail(w, 500, err.Error()); return }
			okJSON(w, res)
		}))
	}
	mux.HandleFunc("GET /api/blocks", guard("", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
		okJSON(w, blocks.List)
	}))
` : ''}

${hasVerify ? `// 验证码：发送 / 校验，通道由 config 里接第三方服务
	mux.HandleFunc("POST /api/captcha/send", guard("verify-code:create", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
		body := map[string]any{}
		if err := readJSON(r, &body); err != nil { fail(w, 400, "请求体不是合法 JSON"); return }
		res, err := verifycode.Send(r.Context(), fmt.Sprint(body["channel"]), fmt.Sprint(body["target"]), fmt.Sprint(body["scene"]), r.RemoteAddr)
		if err != nil { fail(w, 500, err.Error()); return }
		okJSON(w, res)
	}))
	mux.HandleFunc("POST /api/captcha/verify", guard("verify-code:list", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
		body := map[string]any{}
		if err := readJSON(r, &body); err != nil { fail(w, 400, "请求体不是合法 JSON"); return }
		pass, err := verifycode.Verify(r.Context(), fmt.Sprint(body["channel"]), fmt.Sprint(body["target"]), fmt.Sprint(body["code"]), fmt.Sprint(body["scene"]))
		if err != nil { fail(w, 500, err.Error()); return }
		okJSON(w, map[string]any{"verified": pass})
	}))
	mux.HandleFunc("GET /api/captcha/channels", guard("verify-code:list", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
		okJSON(w, verifycode.Channels())
	}))
` : ''}

${hasMedia ? `// 上传：按扩展名判定 audio/video/doc/image
	mux.HandleFunc("POST /api/media/upload", guard("file:upload", func(w http.ResponseWriter, r *http.Request, u *auth.User) {
		if err := r.ParseMultipartForm(200 << 20); err != nil {
			fail(w, 400, "解析上传失败")
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			fail(w, 400, "缺少文件")
			return
		}
		defer file.Close()
		buf, _ := io.ReadAll(file)
		objectKey, url, err := storage.Save(buf, header.Filename)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		okJSON(w, map[string]any{"objectKey": objectKey, "url": url, "size": len(buf), "filename": header.Filename, "assetType": detectType(header.Filename)})
	}))
` : ''}

${hasPlay ? `// 播放：按分区解析插件
	mux.HandleFunc("GET /api/media/play/{partition}/{id}", func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.QueryRead(r.Context(), "SELECT * FROM media_asset WHERE id = ? LIMIT 1", r.PathValue("id"))
		if err != nil || len(rows) == 0 {
			fail(w, 404, "资产不存在")
			return
		}
		res, err := plugins.Play(r, r.PathValue("partition"), rows[0])
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		okJSON(w, res)
	})
` : ''}

	// 静态：本地上传目录
	uploads := config.C.Storage.LocalDir
	if uploads == "" {
		uploads = "./uploads"
	}
	mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploads))))

	addr := fmt.Sprintf(":%d", config.C.Port)
	log.Printf("[boot] %s listening on http://localhost%s%s", config.C.Name, addr, config.C.ContextPath)
	log.Fatal(http.ListenAndServe(addr, waf.Wrap(mux)))
}

func toInt(s string) int64 {
	var v int64
	fmt.Sscan(s, &v)
	return v
}

func detectType(name string) string {
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".mp4", ".mov", ".mkv", ".avi", ".webm", ".flv":
		return "video"
	case ".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a":
		return "audio"
	case ".doc", ".docx", ".ppt", ".pptx", ".pdf", ".xls", ".xlsx", ".txt", ".md":
		return "doc"
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		return "image"
	case ".zip", ".rar", ".7z", ".tar", ".gz":
		return "archive"
	}
	return "other"
}
`;
}

/** 自定义积木：一个积木一个 Handler，用户可在这里继续写自己的工具 */
function blocksGo(ir) {
  const list = (ir.blocks || []).map((b) => {
    const ref = b.code && b.code.trim()
      ? '\t\t\t// 原 JS 片段（Go 里请按下面 Handler 的写法重写）:\n' +
        b.code.trim().split('\n').map((line) => '\t\t\t//   ' + line).join('\n')
      : '';
    return `\t{
\t\tID: ${JSON.stringify(b.id)}, Name: ${JSON.stringify(b.name)}, Method: ${JSON.stringify(b.method)},
\t\tPath: ${JSON.stringify(b.path)}, Perm: ${JSON.stringify(b.perm)}, Params: []string{${(b.params || []).map((x) => JSON.stringify(x)).join(', ')}},
\t\tHandler: func(c *Ctx) (any, error) {
${ref}
\t\t\treturn map[string]any{"block": ${JSON.stringify(b.id)}, "params": c.Params}, nil
\t\t},
\t},`;
  });

  return `package blocks

import (
	"net/http"
	"net/url"

	"REPLACE_MODULE/internal/auth"
	"REPLACE_MODULE/internal/cache"
	"REPLACE_MODULE/internal/db"
	"REPLACE_MODULE/internal/id"
)

// Ctx 是积木拿到的上下文：请求、当前用户、参数、查询串、请求体
type Ctx struct {
	R      *http.Request
	User   *auth.User
	Params map[string]string
	Query  url.Values
	Body   map[string]any
}

type Block struct {
	ID      string
	Name    string
	Method  string
	Path    string
	Perm    string
	Params  []string
	Handler func(c *Ctx) (any, error)
}

// List 由项目里的自定义积木渲染而来：改 Handler 就是加你自己的工具
var List = []Block{
${list.join('\n')}
}

// 供积木直接使用的公共依赖（避免每个 Handler 再写 import）
var (
	DB    = db.Exec
	Cache = cache.Set
	NextID = id.Next
)
`;
}

/** 验证码：发送 / 校验 + 通道适配（只对接，不代发） */
function verifyGo() {
  return `package verifycode

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"REPLACE_MODULE/internal/cache"
	"REPLACE_MODULE/internal/config"
	"REPLACE_MODULE/internal/db"
	"REPLACE_MODULE/internal/id"
)

func randomCode(n int) string {
	out := ""
	for i := 0; i < n; i++ {
		out += fmt.Sprint(rand.Intn(10))
	}
	return out
}

func post(ctx context.Context, endpoint string, payload map[string]any) error {
	if endpoint == "" {
		return fmt.Errorf("通道 endpoint 未配置")
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("通道返回 %d", resp.StatusCode)
	}
	return nil
}

func sendSms(ctx context.Context, target, code, scene string) (map[string]any, error) {
	v := config.C.Verify
	if v.SmsProvider == "" || v.SmsProvider == "none" {
		fmt.Println("[sms:dry-run]", target, code, scene)
		return map[string]any{"channel": "sms", "provider": "none", "sent": false, "dryRun": true}, nil
	}
	if v.SmsProvider == "http" {
		if err := post(ctx, v.SmsEndpoint, map[string]any{"target": target, "code": code, "scene": scene, "signName": v.SmsSign, "templateCode": v.SmsTemplate}); err != nil {
			return nil, err
		}
		return map[string]any{"channel": "sms", "provider": "http", "sent": true}, nil
	}
	return nil, fmt.Errorf("未实现的短信通道：%s（支持 none / http", v.SmsProvider)
}

func sendEmail(ctx context.Context, target, code, scene string) (map[string]any, error) {
	v := config.C.Verify
	if v.EmailProvider == "" || v.EmailProvider == "none" {
		fmt.Println("[email:dry-run]", target, code, scene)
		return map[string]any{"channel": "email", "provider": "none", "sent": false, "dryRun": true}, nil
	}
	if v.EmailProvider == "http" {
		endpoint := v.EmailHost
		if !strings.HasPrefix(endpoint, "http") {
			endpoint = "http://" + endpoint
		}
		if err := post(ctx, endpoint, map[string]any{"target": target, "code": code, "scene": scene, "from": v.EmailFrom}); err != nil {
			return nil, err
		}
		return map[string]any{"channel": "email", "provider": "http", "sent": true}, nil
	}
	return nil, fmt.Errorf("email provider 仅支持 http 网关")
}

// Send 生成验证码、落库、写缓存，再交给通道发出去
func Send(ctx context.Context, channel, target, scene, ip string) (map[string]any, error) {
	if target == "" {
		return nil, fmt.Errorf("缺少接收方")
	}
	if channel != "sms" && channel != "email" {
		return nil, fmt.Errorf("通道只支持 sms / email")
	}
	if scene == "" {
		scene = "default"
	}
	code := randomCode(6)
	expireAt := time.Now().Add(5 * time.Minute)
	_, _ = db.Exec(ctx, "INSERT INTO sys_verify_code (id, channel, target, code, scene, expire_at, used, sent_at, ip, created_at, updated_at, deleted) VALUES (?,?,?,?,?,?,0,NOW(),?,NOW(),NOW(),0)",
		id.Next(), channel, target, code, scene, expireAt, ip)

	cache.Set("vcode:"+channel+":"+target+":"+scene, []byte(code), 5*time.Minute)

	var res map[string]any
	var err error
	if channel == "sms" {
		res, err = sendSms(ctx, target, code, scene)
	} else {
		res, err = sendEmail(ctx, target, code, scene)
	}
	if err != nil {
		return nil, err
	}
	res["expireAt"] = expireAt.Format("2006-01-02 15:04:05")
	return res, nil
}

// Verify 校验并消费验证码（缓存优先，回落库表）
func Verify(ctx context.Context, channel, target, code, scene string) (bool, error) {
	if code == "" {
		return false, nil
	}
	if scene == "" {
		scene = "default"
	}
	key := "vcode:" + channel + ":" + target + ":" + scene
	if raw, ok := cache.Get(key); ok && string(raw) == code {
		cache.Del(key)
		_, _ = db.Exec(ctx, "UPDATE sys_verify_code SET used = 1 WHERE target = ? AND code = ? AND used = 0", target, code)
		return true, nil
	}
	rows, err := db.QueryRead(ctx, "SELECT id FROM sys_verify_code WHERE target = ? AND code = ? AND used = 0 ORDER BY id DESC LIMIT 1", target, code)
	if err != nil || len(rows) == 0 {
		return false, nil
	}
	_, _ = db.Exec(ctx, "UPDATE sys_verify_code SET used = 1 WHERE id = ?", rows[0]["id"])
	return true, nil
}

func Channels() map[string]any {
	return map[string]any{
		"sms":   map[string]any{"provider": config.C.Verify.SmsProvider, "endpoint": config.C.Verify.SmsEndpoint},
		"email": map[string]any{"provider": config.C.Verify.EmailProvider, "host": config.C.Verify.EmailHost},
	}
}
`;
}

/** 基础 WAF：注入 / XSS / 穿越 / CC / 并发上限 / CORS / 安全头。 */
function wafGo() {
  return `package waf

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"REPLACE_MODULE/internal/config"
)

var (
	sqli = regexp.MustCompile(\`(?i)(union\\s+select|select\\s+[\\w,\\s*]+\\s+from|insert\\s+into|delete\\s+from|drop\\s+table|'\\s*or\\s*'|\\bor\\s+1\\s*=\\s*1|;\\s*--|\\bsleep\\s*\\(|benchmark\\s*\\()\`)
	xss  = regexp.MustCompile(\`(?i)(<script|javascript:\\s|onerror\\s*=|onload\\s*=|<iframe|document\\.cookie)\`)
)

type bucket struct {
	tokens float64
	last   time.Time
}

var (
	buckets  sync.Map
	inFlight int64
)

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		parts := strings.Split(fwd, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func decode2(s string) string {
	v, err := url.QueryUnescape(s)
	if err != nil {
		return s
	}
	v2, err := url.QueryUnescape(v)
	if err != nil {
		return v
	}
	return v2
}

func allow(ip string) bool {
	c := config.C.WAF
	burst := float64(c.CCBurst)
	rps := float64(c.CCRps)
	var b *bucket
	if v, ok := buckets.Load(ip); ok {
		b = v.(*bucket)
	} else {
		b = &bucket{tokens: burst, last: time.Now()}
		buckets.Store(ip, b)
	}
	now := time.Now()
	b.tokens += now.Sub(b.last).Seconds() * rps
	if b.tokens > burst {
		b.tokens = burst
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens -= 1
	return true
}

func deny(w http.ResponseWriter, status int, msg string) {
	body := fmt.Sprintf(\`{"code":%d,"message":%q,"data":null}\`, status, msg)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

func setCors(w http.ResponseWriter, r *http.Request) {
	c := config.C.WAF.Cors
	if !c.Enabled {
		return
	}
	origin := r.Header.Get("Origin")
	allowed := false
	for _, o := range c.Origins {
		if o == "*" || o == origin {
			allowed = true
			break
		}
	}
	if origin != "" && allowed {
		if c.Credentials {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		} else if len(c.Origins) > 0 && c.Origins[0] == "*" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", strings.Join(c.Methods, ", "))
		w.Header().Set("Access-Control-Allow-Headers", strings.Join(c.Headers, ", "))
		w.Header().Set("Access-Control-Expose-Headers", "X-Luid")
		if c.Credentials {
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		w.Header().Set("Access-Control-Max-Age", "3600")
	}
}

// Wrap 包住整个 mux：所有请求先过这一层。
func Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := config.C.WAF
		if !c.Enabled {
			next.ServeHTTP(w, r)
			return
		}
		if c.Nosniff {
			w.Header().Set("X-Content-Type-Options", "nosniff")
		}
		w.Header().Set("X-Frame-Options", c.FrameOptions)
		w.Header().Set("Referrer-Policy", "no-referrer")
		if c.Hsts {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		setCors(w, r)
		if r.Method == http.MethodOptions && c.Cors.Enabled {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if c.DdosEnabled {
			cur := atomic.AddInt64(&inFlight, 1)
			defer atomic.AddInt64(&inFlight, -1)
			if cur > int64(c.MaxConcurrent) {
				deny(w, http.StatusServiceUnavailable, "服务器繁忙，请稍后再试")
				return
			}
		}
		ip := clientIP(r)
		if c.CCEnabled && !allow(ip) {
			deny(w, http.StatusTooManyRequests, "请求过于频繁")
			return
		}
		probe := decode2(r.URL.Path + "?" + r.URL.RawQuery)
		if c.PathTraversal && (strings.Contains(probe, "../") || strings.Contains(probe, "..\\\\") || strings.Contains(probe, "%2e%2e")) {
			deny(w, http.StatusForbidden, "非法路径")
			return
		}
		if c.SQLInjection && sqli.MatchString(probe) {
			deny(w, http.StatusForbidden, "非法参数")
			return
		}
		if c.Xss && xss.MatchString(probe) {
			deny(w, http.StatusForbidden, "非法内容")
			return
		}
		next.ServeHTTP(w, r)
	})
}
`;
}

function generateGo(ir) {
  const p = ir.project;
  const module = `${p.groupId}/${p.artifact}`;
  const sub = (s) => s.replace(/REPLACE_MODULE/g, module);
  return [
    { path: 'go.mod', content: goMod(ir) },
    { path: 'main.go', content: sub(mainGo(ir)) },
    { path: 'internal/config/config.go', content: sub(configGo(ir)) },
    { path: 'internal/schema/schema.go', content: sub(schemaGo(ir)) },
    { path: 'internal/db/db.go', content: sub(dbGo()) },
    { path: 'internal/cache/cache.go', content: sub(cacheGo()) },
    { path: 'internal/id/id.go', content: sub(idGo()) },
    { path: 'internal/auth/auth.go', content: sub(authGo()) },
    { path: 'internal/query/query.go', content: sub(queryGo()) },
    { path: 'internal/crud/crud.go', content: sub(crudGo()) },
    { path: 'internal/filesource/filesource.go', content: sub(filesourceGo()) },
    { path: 'internal/customsql/customsql.go', content: sub(customsqlGo()) },
    { path: 'internal/storage/storage.go', content: sub(storageGo()) },
    { path: 'internal/plugins/plugins.go', content: sub(pluginsGo()) },
    { path: 'internal/waf/waf.go', content: sub(wafGo()) },
  ].concat(
    (ir.blocks || []).length ? [{ path: 'internal/blocks/blocks.go', content: sub(blocksGo(ir)) }] : [],
    ir.modules.some((m) => m.id === 'verify-code') ? [{ path: 'internal/verifycode/verifycode.go', content: sub(verifyGo()) }] : [],
  );
}

module.exports = { generateGo };
