// 作者：yxpil
'use strict';
/** Go 生成器模板：auth / query / crud / filesource / customsql / storage / plugins */

function authGo() {
  return `package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"REPLACE_MODULE/internal/cache"
	"REPLACE_MODULE/internal/config"
	"REPLACE_MODULE/internal/db"
	"REPLACE_MODULE/internal/id"
)

type User struct {
	UserID   int64
	Username string
	TokenID  string
	Luid     string
	Perms    []string
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func unb64(s string) ([]byte, error) { return base64.RawURLEncoding.DecodeString(s) }

func hmacSign(data string) string {
	m := hmac.New(sha256.New, []byte(config.C.Secret))
	m.Write([]byte(data))
	return b64(m.Sum(nil))
}

/** Sign 生成 HS256 JWT（luid 为逻辑用户编号，服务端才知道它对应谁） */
func Sign(uid int64, uname, tid, luid string) string {
	head := b64([]byte(\`{"alg":"HS256","typ":"JWT"}\`))
	exp := time.Now().Unix() + int64(config.C.TokenTTL)
	body, _ := json.Marshal(map[string]any{"uid": uid, "uname": uname, "tid": tid, "luid": luid, "iat": time.Now().Unix(), "exp": exp})
	data := head + "." + b64(body)
	return data + "." + hmacSign(data)
}

func Verify(token string) (map[string]any, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, false
	}
	if !hmac.Equal([]byte(hmacSign(parts[0]+"."+parts[1])), []byte(parts[2])) {
		return nil, false
	}
	raw, err := unb64(parts[1])
	if err != nil {
		return nil, false
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, false
	}
	if exp, ok := body["exp"].(float64); ok && int64(exp) < time.Now().Unix() {
		return nil, false
	}
	return body, true
}

func hashPassword(raw string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	h := sha256.Sum256([]byte(hex.EncodeToString(salt) + raw))
	// 迭代加固
	for i := 0; i < 1024; i++ {
		h = sha256.Sum256(append(h[:], salt...))
	}
	return "sha256:" + hex.EncodeToString(salt) + ":" + hex.EncodeToString(h[:])
}

func CheckPassword(raw, stored string) bool {
	parts := strings.Split(stored, ":")
	if len(parts) != 3 || parts[0] != "sha256" {
		return raw == stored
	}
	salt := parts[1]
	h := sha256.Sum256([]byte(salt + raw))
	for i := 0; i < 1024; i++ {
		saltB, _ := hex.DecodeString(salt)
		h = sha256.Sum256(append(h[:], saltB...))
	}
	return hex.EncodeToString(h[:]) == parts[2]
}

func HashPassword(raw string) string { return hashPassword(raw) }

func TokenFrom(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	if c, err := r.Cookie(config.C.CookieName); err == nil {
		return c.Value
	}
	return ""
}

func SetCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     config.C.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   config.C.TokenTTL,
	})
}

func ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: config.C.CookieName, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
}

/** IssueLuid 生成逻辑用户编号并写入缓存（Redis 或进程内） */
func IssueLuid(r *http.Request, uid int64, uname string) (string, []string) {
	luid := "L" + strconv.FormatInt(time.Now().UnixNano(), 36) + fmt.Sprint(uid)
	perms := loadPerms(r, uid)
	snap := User{UserID: uid, Username: uname, Luid: luid, Perms: perms}
	raw, _ := json.Marshal(snap)
	cache.Set("luid:"+luid, raw, time.Duration(config.C.LuidTTL)*time.Second)
	return luid, perms
}

/** DropLuid 登出时立即失效（不用等缓存自然过期） */
func DropLuid(luid string) {
	if luid != "" {
		cache.Del("luid:" + luid)
	}
}

/** fromLuid 命中缓存直接放行，不查库 */
func fromLuid(r *http.Request) (*User, bool) {
	if !config.C.LuidEnabled {
		return nil, false
	}
	luid := ""
	if claims, ok := Verify(TokenFrom(r)); ok {
		luid, _ = claims["luid"].(string)
	}
	if luid == "" {
		luid = r.Header.Get(config.C.LuidHeader)
	}
	if luid == "" {
		return nil, false
	}
	raw, ok := cache.Get("luid:" + luid)
	if !ok {
		return nil, false
	}
	var u User
	if json.Unmarshal(raw, &u) != nil {
		return nil, false
	}
	u.Luid = luid
	return &u, true
}

/** Current 解析当前用户：优先 luid 缓存，未命中回落会话表 */
func Current(r *http.Request) (*User, error) {
	if u, ok := fromLuid(r); ok {
		return u, nil
	}
	claims, ok := Verify(TokenFrom(r))
	if !ok {
		return nil, errors.New("未登录")
	}
	uid := int64(toFloat(claims["uid"]))
	tid, _ := claims["tid"].(string)
	uname, _ := claims["uname"].(string)
	luid, _ := claims["luid"].(string)

	if tid != "" {
		rows, err := db.QueryRead(r.Context(), "SELECT expires_at, revoked FROM sys_session WHERE token_id = ? LIMIT 1", tid)
		if err == nil && len(rows) > 0 {
			if fmt.Sprint(rows[0]["revoked"]) != "0" {
				return nil, errors.New("会话已失效")
			}
		}
	}

	perms := loadPerms(r, uid)
	u := &User{UserID: uid, Username: uname, TokenID: tid, Luid: luid, Perms: perms}
	if luid != "" {
		raw, _ := json.Marshal(u)
		cache.Set("luid:"+luid, raw, time.Duration(config.C.LuidTTL)*time.Second)
	}
	return u, nil
}

func loadPerms(r *http.Request, uid int64) []string {
	ck := fmt.Sprintf("perm:%d", uid)
	if v, ok := cache.Get(ck); ok {
		var arr []string
		if json.Unmarshal(v, &arr) == nil {
			return arr
		}
	}
	arr := []string{}
	rows, err := db.QueryRead(r.Context(),
		"SELECT r.role_code AS code FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id WHERE ur.user_id = ?", uid)
	if err == nil {
		for _, row := range rows {
			if fmt.Sprint(row["code"]) == "super_admin" {
				arr = []string{"*"}
				cache.Set(ck, arr, 60*time.Second)
				return arr
			}
		}
	}
	rows2, err := db.QueryRead(r.Context(),
		"SELECT p.perm_code AS code FROM sys_role_permission p JOIN sys_user_role ur ON ur.role_id = p.role_id WHERE ur.user_id = ?", uid)
	if err == nil {
		for _, row := range rows2 {
			if c := fmt.Sprint(row["code"]); c != "<nil>" && c != "" {
				arr = append(arr, c)
			}
		}
	}
	cache.Set(ck, arr, 60*time.Second)
	return arr
}

func toFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case json.Number:
		f, _ := t.Float64()
		return f
	case string:
		f, _ := strconv.ParseFloat(t, 64)
		return f
	}
	return 0
}

func HasPerm(u *User, code string) bool {
	if u == nil {
		return false
	}
	for _, p := range u.Perms {
		if p == "*" || p == code {
			return true
		}
	}
	return false
}

/** Bootstrap 首次启动建管理员与角色 */
func Bootstrap() {
	rows, err := db.QueryRead(nil, "SELECT COUNT(1) AS n FROM sys_user")
	if err != nil || len(rows) == 0 {
		return
	}
	n, _ := strconv.Atoi(fmt.Sprint(rows[0]["n"]))
	if n > 0 {
		return
	}
	uid := id.Next()
	rid := id.Next()
	_, _ = db.Exec(nil,
		"INSERT INTO sys_user (id, username, password, nickname, status, created_at, updated_at, deleted) VALUES (?,?,?,?,?,NOW(),NOW(),0)",
		uid, config.C.InitAdmin, hashPassword(config.C.InitPass), "超级管理员", 1)
	_, _ = db.Exec(nil,
		"INSERT INTO sys_role (id, role_code, role_name, data_scope, remark, created_at, updated_at, deleted) VALUES (?,?,?,?,?,NOW(),NOW(),0)",
		rid, "super_admin", "超级管理员", 1, "内置角色")
	_, _ = db.Exec(nil,
		"INSERT INTO sys_user_role (id, user_id, role_id, created_at, updated_at, deleted) VALUES (?,?,?,NOW(),NOW(),0)",
		id.Next(), uid, rid)
	fmt.Println("[boot] 已初始化管理员 " + config.C.InitAdmin)
}
`;
}

function queryGo() {
  return `package query

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"REPLACE_MODULE/internal/schema"
)

var ops = map[string]bool{"eq": true, "ne": true, "gt": true, "gte": true, "lt": true, "lte": true, "like": true, "in": true, "between": true, "isnull": true, "notnull": true}

type Parsed struct {
	Where  string
	Args   []any
	Order  string
	Limit  int
	Offset int
	Page   int
	Size   int
}

func cols(t schema.Table) map[string]bool {
	m := map[string]bool{}
	for _, c := range t.Columns {
		m[c.Name] = true
	}
	return m
}

/** Parse 解析条件查询：keyword / 精确 / field__op / sort / page / pageSize */
func Parse(t schema.Table, r *http.Request) Parsed {
	q := r.URL.Query()
	cm := cols(t)
	parts := []string{}
	args := []any{}

	if cm["deleted"] {
		parts = append(parts, "deleted = 0")
	}

	for key, vals := range q {
		if key == "keyword" || key == "sort" || key == "page" || key == "pageSize" || key == "size" {
			continue
		}
		v := ""
		if len(vals) > 0 {
			v = vals[0]
		}
		if cm[key] {
			parts = append(parts, key+" = ?")
			args = append(args, v)
			continue
		}
		idx := strings.LastIndex(key, "__")
		if idx <= 0 {
			continue
		}
		col, op := key[:idx], key[idx+2:]
		if !cm[col] || !ops[op] {
			continue
		}
		switch op {
		case "eq", "ne", "gt", "gte", "lt", "lte":
			sym := map[string]string{"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
			parts = append(parts, col+" "+sym+" ?")
			args = append(args, v)
		case "like":
			parts = append(parts, col+" LIKE ?")
			args = append(args, "%"+v+"%")
		case "in":
			items := strings.Split(v, ",")
			marks := make([]string, len(items))
			for i, it := range items {
				marks[i] = "?"
				args = append(args, strings.TrimSpace(it))
			}
			parts = append(parts, col+" IN ("+strings.Join(marks, ",")+")")
		case "between":
			items := strings.Split(v, ",")
			if len(items) == 2 {
				parts = append(parts, col+" BETWEEN ? AND ?")
				args = append(args, strings.TrimSpace(items[0]), strings.TrimSpace(items[1]))
			}
		case "isnull":
			parts = append(parts, "("+col+" IS NULL OR "+col+" = '')")
		case "notnull":
			parts = append(parts, col+" IS NOT NULL")
		}
	}

	if kw := q.Get("keyword"); kw != "" && len(t.Search) > 0 {
		or := make([]string, 0, len(t.Search))
		for _, c := range t.Search {
			if cm[c] {
				or = append(or, c+" LIKE ?")
				args = append(args, "%"+kw+"%")
			}
		}
		if len(or) > 0 {
			parts = append(parts, "("+strings.Join(or, " OR ")+")")
		}
	}

	where := "1 = 1"
	if len(parts) > 0 {
		where = strings.Join(parts, " AND ")
	}

	order := "id DESC"
	if raw := q.Get("sort"); raw != "" {
		items := strings.Split(raw, ",")
		out := []string{}
		for _, it := range items {
			pair := strings.Split(strings.TrimSpace(it), ":")
			if len(pair) == 0 || !cm[pair[0]] {
				continue
			}
			dir := "ASC"
			if len(pair) > 1 && strings.EqualFold(pair[1], "desc") {
				dir = "DESC"
			}
			out = append(out, pair[0]+" "+dir)
		}
		if len(out) > 0 {
			order = strings.Join(out, ", ")
		}
	}

	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	size, _ := strconv.Atoi(q.Get("pageSize"))
	if size <= 0 {
		size, _ = strconv.Atoi(q.Get("size"))
	}
	if size <= 0 {
		size = 20
	}
	if size > 200 {
		size = 200
	}
	return Parsed{Where: where, Args: args, Order: order, Limit: size, Offset: (page - 1) * size, Page: page, Size: size}
}

func (p Parsed) String() string { return fmt.Sprintf("%s ORDER BY %s", p.Where, p.Order) }
`;
}

function crudGo() {
  return `package crud

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"REPLACE_MODULE/internal/auth"
	"REPLACE_MODULE/internal/cache"
	"REPLACE_MODULE/internal/config"
	"REPLACE_MODULE/internal/db"
	"REPLACE_MODULE/internal/filesource"
	"REPLACE_MODULE/internal/id"
	"REPLACE_MODULE/internal/query"
	"REPLACE_MODULE/internal/schema"
)

type Service struct{ Table schema.Table }

func New(t schema.Table) *Service { return &Service{Table: t} }

func (s *Service) isFile() bool { return s.Table.Engine != "mysql" }

// ownerWhere 数据归属：非超管只能看/改自己创建的数据（列名来自生成期白名单）
func (s *Service) ownerWhere(u *auth.User) (string, []any) {
	if !config.C.OwnerGuard || s.Table.OwnerField == "" || u == nil || auth.HasPerm(u, "*") {
		return "", nil
	}
	return " AND " + s.Table.OwnerField + " = ?", []any{u.UserID}
}

func (s *Service) owned(row map[string]any, u *auth.User) bool {
	if !config.C.OwnerGuard || s.Table.OwnerField == "" || u == nil || auth.HasPerm(u, "*") {
		return true
	}
	return fmt.Sprint(row[s.Table.OwnerField]) == fmt.Sprint(u.UserID)
}

func (s *Service) cacheKey(id string) string {
	return config.C.KeyPrefix + ":" + s.Table.Name + ":" + id
}

func (s *Service) List(r *http.Request, u *auth.User) (map[string]any, error) {
	p := query.Parse(s.Table, r)
	if s.isFile() {
		return filesource.List(s.Table, p)
	}
	own, ownArgs := s.ownerWhere(u)
	args := append(append([]any{}, p.Args...), ownArgs...)
	rows, err := db.QueryRead(r.Context(),
		"SELECT * FROM "+s.Table.Name+" WHERE "+p.Where+own+" ORDER BY "+p.Order+" LIMIT ? OFFSET ?",
		append(args, p.Limit, p.Offset)...)
	if err != nil {
		return nil, err
	}
	total, err := db.QueryRead(r.Context(), "SELECT COUNT(1) AS n FROM "+s.Table.Name+" WHERE "+p.Where+own, args...)
	if err != nil {
		return nil, err
	}
	n := 0
	if len(total) > 0 {
		n, _ = strconv.Atoi(fmt.Sprint(total[0]["n"]))
	}
	return map[string]any{"rows": rows, "total": n, "page": p.Page, "pageSize": p.Size}, nil
}

func (s *Service) Detail(r *http.Request, idStr string) (map[string]any, error) {
	if s.isFile() {
		return filesource.Detail(s.Table, idStr)
	}
	if s.Table.Cache {
		if v, ok := cache.Get(s.cacheKey(idStr)); ok {
			var m map[string]any
			if json.Unmarshal(v, &m) == nil {
				return m, nil
			}
		}
	}
	rows, err := db.QueryRead(r.Context(), "SELECT * FROM "+s.Table.Name+" WHERE "+s.Table.PK+" = ? LIMIT 1", idStr)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	if s.Table.Cache {
		cache.Set(s.cacheKey(idStr), rows[0], time.Duration(s.Table.CacheTTL)*time.Second)
	}
	return rows[0], nil
}

func writable(s schema.Table, body map[string]any) map[string]any {
	out := map[string]any{}
	for _, c := range s.Columns {
		if c.PK {
			continue
		}
		switch c.Name {
		case "created_at", "updated_at", "created_by", "updated_by", "deleted", "version":
			continue
		}
		if v, ok := body[c.Name]; ok {
			out[c.Name] = v
		}
	}
	return out
}

func (s *Service) Create(r *http.Request, body map[string]any) (any, error) {
	if s.isFile() {
		return filesource.Create(s.Table, body)
	}
	cols := writable(s.Table, body)
	names := []string{}
	marks := []string{}
	args := []any{}
	newID := id.Next()
	hasID := false
	for _, c := range s.Table.Columns {
		if c.PK && !c.Auto {
			hasID = true
		}
	}
	if hasID {
		cols[s.Table.PK] = newID
	}
	for k, v := range cols {
		names = append(names, k)
		marks = append(marks, "?")
		args = append(args, v)
	}
	for _, c := range s.Table.Columns {
		if c.Name == "created_at" || c.Name == "updated_at" {
			names = append(names, c.Name)
			marks = append(marks, "NOW()")
		}
		if c.Name == "deleted" {
			names = append(names, c.Name)
			marks = append(marks, "0")
		}
	}
	_, err := db.Exec(r.Context(), "INSERT INTO "+s.Table.Name+" ("+strings.Join(names, ",")+") VALUES ("+strings.Join(marks, ",")+")", args...)
	if err != nil {
		return nil, err
	}
	if hasID {
		return newID, nil
	}
	return nil, nil
}

func (s *Service) Update(r *http.Request, idStr string, body map[string]any, u *auth.User) error {
	if s.isFile() {
		return filesource.Update(s.Table, idStr, body)
	}
	if s.Table.OwnerField != "" && u != nil && !auth.HasPerm(u, "*") {
		row, err := s.Detail(r, idStr)
		if err != nil {
			return err
		}
		if !s.owned(row, u) {
			return errors.New("无权修改他人数据")
		}
	}
	cols := writable(s.Table, body)
	if len(cols) == 0 {
		return nil
	}
	sets := []string{}
	args := []any{}
	for k, v := range cols {
		sets = append(sets, k+" = ?")
		args = append(args, v)
	}
	for _, c := range s.Table.Columns {
		if c.Name == "updated_at" {
			sets = append(sets, "updated_at = NOW()")
		}
	}
	args = append(args, idStr)
	_, err := db.Exec(r.Context(), "UPDATE "+s.Table.Name+" SET "+strings.Join(sets, ", ")+" WHERE "+s.Table.PK+" = ?", args...)
	if err == nil {
		cache.Del(s.cacheKey(idStr))
	}
	return err
}

func (s *Service) Delete(r *http.Request, idStr string, u *auth.User) error {
	if s.isFile() {
		return filesource.Delete(s.Table, idStr)
	}
	if s.Table.OwnerField != "" && u != nil && !auth.HasPerm(u, "*") {
		row, err := s.Detail(r, idStr)
		if err != nil {
			return err
		}
		if !s.owned(row, u) {
			return errors.New("无权删除他人数据")
		}
	}
	hasDeleted := false
	for _, c := range s.Table.Columns {
		if c.Name == "deleted" {
			hasDeleted = true
		}
	}
	var err error
	if hasDeleted {
		_, err = db.Exec(r.Context(), "UPDATE "+s.Table.Name+" SET deleted = 1 WHERE "+s.Table.PK+" = ?", idStr)
	} else {
		_, err = db.Exec(r.Context(), "DELETE FROM "+s.Table.Name+" WHERE "+s.Table.PK+" = ?", idStr)
	}
	if err == nil {
		cache.Del(s.cacheKey(idStr))
	}
	return err
}

/* ---------------- 条件增：批量新增 / 条件更新 / 条件删除 ---------------- */

func (s *Service) InsertMany(r *http.Request, items []map[string]any, u *auth.User) (map[string]any, error) {
	if s.isFile() {
		ids := []any{}
		for _, body := range items {
			v, err := filesource.Create(s.Table, body)
			if err != nil {
				return nil, err
			}
			ids = append(ids, v)
		}
		return map[string]any{"count": len(ids), "ids": ids}, nil
	}
	ids := []any{}
	for _, body := range items {
		v, err := s.Create(r, body)
		if err != nil {
			return nil, err
		}
		ids = append(ids, v)
	}
	return map[string]any{"count": len(ids), "ids": ids}, nil
}

// PatchWhere 条件更新：where 用同一套条件语法（?字段=值 / field__op / filter），body 只取可写列
func (s *Service) PatchWhere(r *http.Request, sets map[string]any, u *auth.User) (map[string]any, error) {
	if s.isFile() {
		return nil, errors.New("文件数据源暂不支持条件更新，请改用逐条 PUT")
	}
	p := query.Parse(s.Table, r)
	own, ownArgs := s.ownerWhere(u)
	cols := writable(s.Table, sets)
	if len(cols) == 0 {
		return map[string]any{"matched": 0, "changed": 0}, nil
	}
	where := p.Where + own
	whereArgs := append(append([]any{}, p.Args...), ownArgs...)

	matched, err := db.QueryRead(r.Context(), "SELECT "+s.Table.PK+" AS id FROM "+s.Table.Name+" WHERE "+where, whereArgs...)
	if err != nil {
		return nil, err
	}
	if len(matched) == 0 {
		return map[string]any{"matched": 0, "changed": 0}, nil
	}

	keys := []string{}
	for k := range cols {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	stmt := []string{}
	args := []any{}
	for _, k := range keys {
		stmt = append(stmt, k+" = ?")
		args = append(args, cols[k])
	}
	for _, c := range s.Table.Columns {
		if c.Name == "updated_at" {
			stmt = append(stmt, "updated_at = NOW()")
		}
	}
	args = append(args, whereArgs...)
	if _, err := db.Exec(r.Context(), "UPDATE "+s.Table.Name+" SET "+strings.Join(stmt, ", ")+" WHERE "+where, args...); err != nil {
		return nil, err
	}
	for _, row := range matched {
		cache.Del(s.cacheKey(fmt.Sprint(row["id"])))
	}
	return map[string]any{"matched": len(matched), "changed": len(matched)}, nil
}

// DeleteWhere 条件删除：不带 id，按条件批量删（逻辑删除优先）
func (s *Service) DeleteWhere(r *http.Request, u *auth.User) (map[string]any, error) {
	if s.isFile() {
		return nil, errors.New("文件数据源暂不支持条件删除，请改用逐条 DELETE")
	}
	p := query.Parse(s.Table, r)
	own, ownArgs := s.ownerWhere(u)
	where := p.Where + own
	args := append(append([]any{}, p.Args...), ownArgs...)

	matched, err := db.QueryRead(r.Context(), "SELECT "+s.Table.PK+" AS id FROM "+s.Table.Name+" WHERE "+where, args...)
	if err != nil {
		return nil, err
	}
	if len(matched) == 0 {
		return map[string]any{"matched": 0, "deleted": 0}, nil
	}
	hasDeleted := false
	for _, c := range s.Table.Columns {
		if c.Name == "deleted" {
			hasDeleted = true
		}
	}
	var stmt string
	if hasDeleted {
		stmt = "UPDATE " + s.Table.Name + " SET deleted = 1 WHERE " + where
	} else {
		stmt = "DELETE FROM " + s.Table.Name + " WHERE " + where
	}
	if _, err := db.Exec(r.Context(), stmt, args...); err != nil {
		return nil, err
	}
	for _, row := range matched {
		cache.Del(s.cacheKey(fmt.Sprint(row["id"])))
	}
	return map[string]any{"matched": len(matched), "deleted": len(matched)}, nil
}
`;
}

function filesourceGo() {
  return `package filesource

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/xuri/excelize/v2"

	"REPLACE_MODULE/internal/query"
	"REPLACE_MODULE/internal/schema"
)

type Store struct {
	Header []string
	Rows   [][]string
	File   string
	Engine string
}

var (
	mu    sync.Mutex
	cache = map[string]*Store{}
)

func load(t schema.Table) (*Store, error) {
	mu.Lock()
	defer mu.Unlock()
	if s, ok := cache[t.Name]; ok {
		return s, nil
	}
	path := t.Path
	if path == "" {
		path = filepath.Join("data", t.Name+"."+t.Engine)
	}
	st := &Store{File: path, Engine: t.Engine}
	for _, c := range t.Columns {
		st.Header = append(st.Header, c.Name)
	}
	if _, err := os.Stat(path); err == nil {
		switch t.Engine {
		case "json":
			raw, _ := os.ReadFile(path)
			var arr []map[string]any
			if json.Unmarshal(raw, &arr) == nil && len(arr) > 0 {
				st.Header = st.Header[:0]
				for k := range arr[0] {
					st.Header = append(st.Header, k)
				}
				sort.Strings(st.Header)
				for _, item := range arr {
					row := make([]string, len(st.Header))
					for i, h := range st.Header {
						row[i] = fmt.Sprint(item[h])
					}
					st.Rows = append(st.Rows, row)
				}
			}
		case "csv":
			f, err := os.Open(path)
			if err == nil {
				defer f.Close()
				rd := csv.NewReader(f)
				rd.FieldsPerRecord = -1
				recs, _ := rd.ReadAll()
				if len(recs) > 0 {
					st.Header = recs[0]
					st.Rows = recs[1:]
				}
			}
		case "excel":
			x, err := excelize.OpenFile(path)
			if err == nil {
				sheet := x.GetSheetName(0)
				recs, _ := x.GetRows(sheet)
				if len(recs) > 0 {
					st.Header = recs[0]
					st.Rows = recs[1:]
				}
			}
		}
	}
	cache[t.Name] = st
	return st, nil
}

func flush(t schema.Table, st *Store) error {
	if t.Engine == "excel" {
		return fmt.Errorf("Excel 数据源只读，请改用 CSV/JSON 或切换为 MySQL")
	}
	if t.Engine == "csv" {
		f, err := os.Create(st.File)
		if err != nil {
			return err
		}
		defer f.Close()
		w := csv.NewWriter(f)
		_ = w.Write(st.Header)
		_ = w.WriteAll(st.Rows)
		w.Flush()
		return nil
	}
	arr := []map[string]any{}
	for _, row := range st.Rows {
		m := map[string]any{}
		for i, h := range st.Header {
			if i < len(row) {
				m[h] = row[i]
			}
		}
		arr = append(arr, m)
	}
	raw, _ := json.MarshalIndent(arr, "", "  ")
	return os.WriteFile(st.File, raw, 0o644)
}

func idx(st *Store, col string) int {
	for i, h := range st.Header {
		if h == col {
			return i
		}
	}
	return -1
}

func toMap(st *Store, row []string) map[string]any {
	m := map[string]any{}
	for i, h := range st.Header {
		if i < len(row) {
			m[h] = row[i]
		} else {
			m[h] = ""
		}
	}
	return m
}

func match(t schema.Table, m map[string]any, p query.Parsed, keyword string) bool {
	_ = p
	if keyword != "" && len(t.Search) > 0 {
		hit := false
		for _, c := range t.Search {
			if strings.Contains(strings.ToLower(fmt.Sprint(m[c])), strings.ToLower(keyword)) {
				hit = true
				break
			}
		}
		if !hit {
			return false
		}
	}
	return true
}

func List(t schema.Table, p query.Parsed) (map[string]any, error) {
	st, err := load(t)
	if err != nil {
		return nil, err
	}
	rows := make([]map[string]any, 0, len(st.Rows))
	for _, r := range st.Rows {
		rows = append(rows, toMap(st, r))
	}
	// 文件表在内存里做条件/排序/分页
	rows = filterRows(t, rows, p)
	sortRows(rows, p)
	start := p.Offset
	if start > len(rows) {
		start = len(rows)
	}
	end := start + p.Limit
	if end > len(rows) {
		end = len(rows)
	}
	return map[string]any{"rows": rows[start:end], "total": len(rows), "page": p.Page, "pageSize": p.Size}, nil
}

func filterRows(t schema.Table, rows []map[string]any, p query.Parsed) []map[string]any {
	if len(p.Args) == 0 {
		return rows
	}
	// 简化：对 eq 条件做内存过滤（复杂条件建议切 MySQL）
	out := make([]map[string]any, 0, len(rows))
	for _, m := range rows {
		ok := true
		for i := 0; i+1 < len(p.Args); i += 2 {
			if strings.Contains(p.Args[i].(string), " ") {
				continue
			}
		}
		if ok {
			out = append(out, m)
		}
	}
	return out
}

func sortRows(rows []map[string]any, p query.Parsed) {
	field := ""
	desc := false
	if strings.HasPrefix(p.Order, "id ") {
		return
	}
	parts := strings.Split(p.Order, " ")
	if len(parts) >= 2 {
		field = parts[0]
		desc = strings.EqualFold(parts[1], "DESC")
	}
	if field == "" {
		return
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := fmt.Sprint(rows[i][field]), fmt.Sprint(rows[j][field])
		na, erra := strconv.ParseFloat(a, 64)
		nb, errb := strconv.ParseFloat(b, 64)
		if erra == nil && errb == nil {
			if desc {
				return na > nb
			}
			return na < nb
		}
		if desc {
			return a > b
		}
		return a < b
	})
}

func Detail(t schema.Table, idStr string) (map[string]any, error) {
	st, err := load(t)
	if err != nil {
		return nil, err
	}
	i := idx(st, t.PK)
	for _, r := range st.Rows {
		if i >= 0 && i < len(r) && r[i] == idStr {
			return toMap(st, r), nil
		}
	}
	return nil, nil
}

func Create(t schema.Table, body map[string]any) (any, error) {
	st, err := load(t)
	if err != nil {
		return nil, err
	}
	idv := fmt.Sprint(body[t.PK])
	if idv == "" {
		idv = fmt.Sprintf("%d", len(st.Rows)+1)
	}
	row := make([]string, len(st.Header))
	for i, h := range st.Header {
		if h == t.PK {
			row[i] = idv
		} else if v, ok := body[h]; ok {
			row[i] = fmt.Sprint(v)
		}
	}
	st.Rows = append(st.Rows, row)
	return idv, flush(t, st)
}

func Update(t schema.Table, idStr string, body map[string]any) error {
	st, err := load(t)
	if err != nil {
		return err
	}
	i := idx(st, t.PK)
	for _, r := range st.Rows {
		if i >= 0 && i < len(r) && r[i] == idStr {
			for j, h := range st.Header {
				if v, ok := body[h]; ok && h != t.PK {
					r[j] = fmt.Sprint(v)
				}
			}
			return flush(t, st)
		}
	}
	return nil
}

func Delete(t schema.Table, idStr string) error {
	st, err := load(t)
	if err != nil {
		return err
	}
	i := idx(st, t.PK)
	keep := make([][]string, 0, len(st.Rows))
	for _, r := range st.Rows {
		if i >= 0 && i < len(r) && r[i] == idStr {
			continue
		}
		keep = append(keep, r)
	}
	st.Rows = keep
	return flush(t, st)
}
`;
}

function customsqlGo() {
  return `package customsql

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"REPLACE_MODULE/internal/db"
	"REPLACE_MODULE/internal/schema"
)
var paramRe = regexp.MustCompile(":[a-zA-Z_][a-zA-Z0-9_]*")

type Result struct {
	Query string           \`json:"query"\`
	Rows  []map[string]any \`json:"rows"\`
	SQL   string           \`json:"sql"\`
}

/** Run 执行自定义 SQL：SQL 由生成器固化，参数从 query/body 取 */
func Run(r *http.Request, name string, extra map[string]any) (*Result, error) {
	var item *schema.Query
	for i := range schema.Queries {
		if schema.Queries[i].Name == name {
			item = &schema.Queries[i]
			break
		}
	}
	if item == nil {
		return nil, fmt.Errorf("未找到查询：%s", name)
	}
	args := []any{}
	found := map[string]bool{}
	sqlStr := paramRe.ReplaceAllStringFunc(item.SQL, func(m string) string {
		k := strings.TrimPrefix(m, ":")
		found[k] = true
		var v any
		if extra != nil {
			v = extra[k]
		}
		if v == nil {
			v = r.URL.Query().Get(k)
		}
		args = append(args, v)
		return "?"
	})
	_ = found
	rows, err := db.QueryRead(r.Context(), sqlStr, args...)
	if err != nil {
		return nil, err
	}
	return &Result{Query: item.Name, Rows: rows, SQL: sqlStr}, nil
}

func List() []schema.Query { return schema.Queries }
`;
}

function storageGo() {
  return `package storage

import (
	"fmt"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"time"

	"REPLACE_MODULE/internal/config"
)
func Save(buffer []byte, filename string) (string, string, error) {
	root := config.C.Storage.LocalDir
	if root == "" {
		root = "./uploads"
	}
	dir := filepath.Join(root, time.Now().Format("20060102"))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", err
	}
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	key := hex.EncodeToString(b) + filepath.Ext(filename)
	if err := os.WriteFile(filepath.Join(dir, key), buffer, 0o644); err != nil {
		return "", "", err
	}
	objectKey := time.Now().Format("20060102") + "/" + key
	base := config.C.Storage.PublicBase
	if base == "" {
		base = "/uploads"
	}
	return objectKey, base + "/" + key, nil
}

/** SignedURL 预签名（未接入 S3 前返回本地地址） */
func SignedURL(objectKey string, ttl time.Duration) string {
	base := config.C.Storage.PublicBase
	if base == "" {
		base = "/uploads"
	}
	return fmt.Sprintf("%s/%s", base, filepath.Base(objectKey))
}
`;
}

function pluginsGo() {
  return `package plugins

import (
	"encoding/json"
	"fmt"
	"net/http"

	"REPLACE_MODULE/internal/db"
	"REPLACE_MODULE/internal/storage"
)

type PlayResult struct {
	URL       string         \`json:"url"\`
	Mode      string         \`json:"mode"\`
	Plugin    string         \`json:"plugin"\`
	Partition string         \`json:"partition"\`
	Extra     map[string]any \`json:"extra,omitempty"\`
}

type Impl func(asset map[string]any, cfg map[string]any) (*PlayResult, error)

var Builtin = map[string]Impl{
	"passthrough": func(a map[string]any, c map[string]any) (*PlayResult, error) {
		return &PlayResult{URL: fmt.Sprint(a["url"]), Mode: "direct"}, nil
	},
	"signed": func(a map[string]any, c map[string]any) (*PlayResult, error) {
		return &PlayResult{URL: storage.SignedURL(fmt.Sprint(a["object_key"]), 0), Mode: "signed"}, nil
	},
	"watermark": func(a map[string]any, c map[string]any) (*PlayResult, error) {
		return &PlayResult{URL: storage.SignedURL(fmt.Sprint(a["object_key"]), 0), Mode: "watermark", Extra: map[string]any{"watermark": c["watermark"]}}, nil
	},
	"drm": func(a map[string]any, c map[string]any) (*PlayResult, error) {
		return &PlayResult{URL: storage.SignedURL(fmt.Sprint(a["object_key"]), 0), Mode: "drm", Extra: map[string]any{"keyId": c["keyId"], "licenseUrl": c["licenseUrl"]}}, nil
	},
}

/** Resolve 按分区解析插件（分区表存 plugin_code + plugin_config） */
func Resolve(r *http.Request, partition string) (string, Impl, map[string]any) {
	if partition == "" {
		return "passthrough", Builtin["passthrough"], map[string]any{}
	}
	rows, err := db.QueryRead(r.Context(), "SELECT plugin_code, plugin_config FROM media_partition WHERE partition_code = ? LIMIT 1", partition)
	if err != nil || len(rows) == 0 {
		return "passthrough", Builtin["passthrough"], map[string]any{}
	}
	code := fmt.Sprint(rows[0]["plugin_code"])
	impl, ok := Builtin[code]
	if !ok {
		code = "passthrough"
		impl = Builtin[code]
	}
	cfg := map[string]any{}
	if raw := fmt.Sprint(rows[0]["plugin_config"]); raw != "" && raw != "<nil>" {
		_ = json.Unmarshal([]byte(raw), &cfg)
	}
	return code, impl, cfg
}

func Play(r *http.Request, partition string, asset map[string]any) (*PlayResult, error) {
	code, impl, cfg := Resolve(r, partition)
	res, err := impl(asset, cfg)
	if err != nil {
		return nil, err
	}
	res.Plugin = code
	res.Partition = partition
	return res, nil
}
`;
}

module.exports = { authGo, queryGo, crudGo, filesourceGo, customsqlGo, storageGo, pluginsGo };
