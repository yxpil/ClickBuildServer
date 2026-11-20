package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type tokenStore struct {
	data map[string]map[string]any
}

func newTokenStore() *tokenStore {
	return &tokenStore{data: map[string]map[string]any{}}
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (t *tokenStore) mint(claims map[string]any) map[string]any {
	token := randomHex(24)
	ttl := 7200
	if v, ok := claims["ttl"].(float64); ok && v > 0 {
		ttl = int(v)
	}
	claims["iat"] = time.Now().Unix()
	claims["exp"] = time.Now().Unix() + int64(ttl)
	t.data[token] = claims
	return map[string]any{"token": token, "ttl": ttl, "onlyId": claims["onlyId"]}
}

func (t *tokenStore) get(token string) map[string]any {
	c, ok := t.data[token]
	if !ok {
		return nil
	}
	if exp, ok := c["exp"].(int64); ok && time.Now().Unix() > exp {
		delete(t.data, token)
		return nil
	}
	return c
}

func (t *tokenStore) del(token string) {
	delete(t.data, token)
}

type Server struct {
	svc     *Service
	db      *sql.DB
	tokens  *tokenStore
	started time.Time
}

type routeEntry struct {
	iface  *Interface
	route  *Route
	re     *regexp.Regexp
	keys   []string
	specific bool
}

func (s *Server) routeTable() []routeEntry {
	var table []routeEntry
	for i := range s.svc.Interfaces {
		it := &s.svc.Interfaces[i]
		for j := range it.Routes {
			r := &it.Routes[j]
			base := strings.TrimSuffix(it.BasePath, "/")
			pattern := s.svc.APIPrefix + base + r.Path
			re, keys := routeRegex(pattern)
			table = append(table, routeEntry{iface: it, route: r, re: re, keys: keys, specific: !strings.Contains(r.Path, ":")})
		}
	}
	sort.Slice(table, func(a, b int) bool {
		if table[a].specific != table[b].specific {
			return table[a].specific
		}
		return false
	})
	return table
}

func routeRegex(pattern string) (*regexp.Regexp, []string) {
	var keys []string
	parts := strings.Split(pattern, "/")
	for i, seg := range parts {
		if strings.HasPrefix(seg, ":") {
			keys = append(keys, seg[1:])
			parts[i] = "([^/]+)"
		} else if seg == "*" {
			keys = append(keys, "*")
			parts[i] = "(.*)"
		} else {
			parts[i] = regexp.QuoteMeta(seg)
		}
	}
	re := regexp.MustCompile("^" + strings.Join(parts, "/") + "/?$")
	return re, keys
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		s.cors(w)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !strings.HasPrefix(r.URL.Path, s.svc.APIPrefix+"/") && r.URL.Path != s.svc.APIPrefix {
		s.serveStatic(w, r)
		return
	}
	s.serveAPI(w, r)
}

func (s *Server) cors(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "content-type,x-filename,x-content-type,authorization")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
	w.Header().Set("Cache-Control", "no-store")
}

func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" {
		if b, err := os.ReadFile("public/index.html"); err == nil {
			w.Header().Set("content-type", "text/html; charset=utf-8")
			_, _ = w.Write(b)
			return
		}
		w.Header().Set("content-type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<h1>ClickBuild Go 原生服务</h1><p>接口前缀 <code>" + s.svc.APIPrefix + "</code></p>"))
		return
	}
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "NOT_FOUND"})
}

func (s *Server) serveAPI(w http.ResponseWriter, r *http.Request) {
	s.cors(w)
	table := s.routeTable()
	var matched []routeEntry
	for _, it := range table {
		if it.re.MatchString(r.URL.Path) {
			matched = append(matched, it)
			if it.route.Method == r.Method || (r.Method == http.MethodHead && it.route.Method == http.MethodGet) {
				params := map[string]any{}
				sub := it.re.FindStringSubmatch(r.URL.Path)
				for i, k := range it.keys {
					if k != "*" {
						params[k] = sub[i+1]
					}
				}
				s.handleRoute(w, r, &it, params)
				return
			}
		}
	}
	if len(matched) > 0 {
		var allow []string
		for _, it := range matched {
			allow = append(allow, it.route.Method)
		}
		w.Header().Set("Allow", strings.Join(allow, ", "))
		http.Error(w, `{"ok":false,"error":"METHOD_NOT_ALLOWED"}`, http.StatusMethodNotAllowed)
		return
	}
	w.WriteHeader(http.StatusNotFound)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "NOT_FOUND", "path": r.URL.Path})
}

func (s *Server) handleRoute(w http.ResponseWriter, r *http.Request, it *routeEntry, params map[string]any) {
	ctx := &Ctx{
		Query: queryMap(r.URL.Query()),
		Path:  params,
		Body:  map[string]any{},
		User:  map[string]any{},
		Env:   map[string]any{},
		Vars:  map[string]any{},
		RemoteIP: r.RemoteAddr,
		TraceID: randomHex(8),
		Now: time.Now().Format("2006-01-02 15:04:05"),
		UUID: randomHex(16),
	}
	if v := ctx.Path["id"]; v != nil {
		ctx.ID = v
	} else if _, ok := ctx.Query["id"]; ok {
		ctx.ID = ctx.Query["id"]
	}

	// 请求体：JSON 或 multipart
	ctype := r.Header.Get("Content-Type")
	if strings.HasPrefix(ctype, "multipart/form-data") {
		if err := r.ParseMultipartForm(64 << 20); err == nil {
			ctx.Body = formMap(r.MultipartForm)
			if fh := firstFile(r.MultipartForm); fh != nil {
				ctx.File = s.saveUpload(fh)
			}
		}
	} else if strings.Contains(ctype, "application/json") {
		raw, _ := io.ReadAll(io.LimitReader(r.Body, 64<<20))
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &ctx.Body)
		}
	}

	token := requestToken(r)
	ctx.Token = token
	if token != "" {
		if user := s.tokens.get(token); user != nil {
			ctx.User = user
			ctx.Vars["user"] = user
		}
	}

	if it.route.Auth && len(ctx.User) == 0 {
		w.WriteHeader(http.StatusUnauthorized)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "UNAUTHORIZED"})
		return
	}

	res, err := s.runScript(it.iface, it.route, ctx)
	if err != nil {
		logf("[ERROR] %s %s %v", it.route.Method, r.URL.Path, err)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "SERVER_ERROR", "message": err.Error(), "traceId": ctx.TraceID})
		return
	}
	if ctx.MintedToken != "" {
		http.SetCookie(w, &http.Cookie{Name: "icb_token", Value: ctx.MintedToken, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: 7200})
	}
	if ctx.TokenDeleted {
		http.SetCookie(w, &http.Cookie{Name: "icb_token", Value: "", Path: "/", HttpOnly: true, MaxAge: -1})
	}
	if res.Status == 0 {
		res.Status = 200
	}
	w.WriteHeader(res.Status)
	_ = json.NewEncoder(w).Encode(res.Body)
}

func requestToken(r *http.Request) string {
	if a := r.Header.Get("Authorization"); strings.HasPrefix(a, "Bearer ") {
		return strings.TrimSpace(a[7:])
	}
	if c, err := r.Cookie("icb_token"); err == nil {
		return c.Value
	}
	return ""
}

func (s *Server) saveUpload(fh *multipart.FileHeader) map[string]any {
	key := randomHex(8) + filepath.Ext(fh.Filename)
	dir := env("UPLOAD_DIR", "uploads")
	_ = os.MkdirAll(dir, 0o755)
	if src, err := fh.Open(); err == nil {
		defer src.Close()
		if dst, err := os.Create(filepath.Join(dir, key)); err == nil {
			_, _ = io.Copy(dst, src)
			dst.Close()
		}
	}
	return map[string]any{
		"filename": fh.Filename, "size": fh.Size, "objectKey": key,
		"objectUrl": "/uploads/" + key, "contentType": fh.Header.Get("Content-Type"),
	}
}

func firstFile(f *multipart.Form) *multipart.FileHeader {
	if f == nil {
		return nil
	}
	for _, files := range f.File {
		if len(files) > 0 {
			return files[0]
		}
	}
	return nil
}

func formMap(f *multipart.Form) map[string]any {
	out := map[string]any{}
	if f == nil {
		return out
	}
	for k, v := range f.Value {
		if len(v) == 1 {
			out[k] = v[0]
		} else {
			out[k] = v
		}
	}
	return out
}

func queryMap(v map[string][]string) map[string]any {
	out := map[string]any{}
	for k, list := range v {
		if len(list) == 1 {
			out[k] = list[0]
		} else {
			out[k] = list
		}
	}
	return out
}

func logf(format string, args ...any) {
	fmt.Printf(format+"\n", args...)
}
