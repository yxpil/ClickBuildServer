// 作者：yxpil
package main

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

type Ctx struct {
	Query    map[string]any
	Body     map[string]any
	Path     map[string]any
	File     map[string]any
	User     map[string]any
	Env      map[string]any
	Vars     map[string]any
	Last     any
	ID       any
	Now      string
	UUID     string
	Token    string
	RemoteIP string
	TraceID  string
	MintedToken string
	MintedOnlyID string
	TokenDeleted bool
}

var tokenRe = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_.:]+)\s*\}\}`)
var varRe = regexp.MustCompile(`\$([A-Za-z_][A-Za-z0-9_]*(?:\[[0-9]+\]|\.[A-Za-z0-9_]+)*)`)

var structTokens = map[string]bool{
	"t": true, "table": true, "columns": true, "allColumns": true, "insertColumns": true, "insertValues": true,
	"updateSet": true, "where": true, "orderBy": true, "limit": true, "offset": true,
	"idColumn": true, "page": true, "pageSize": true, "schema": true, "tableComment": true,
	"bindColumn": true, "bucket": true,
}

func splitToken(token string) (string, string) {
	if i := strings.Index(token, ":"); i >= 0 {
		return token[:i], token[i+1:]
	}
	return token, ""
}

func bindingOf(root *Interface, key string) *Table {
	if len(root.Tables) == 0 {
		return nil
	}
	if key == "" {
		return &root.Tables[0]
	}
	for i := range root.Tables {
		if root.Tables[i].Key == key {
			return &root.Tables[i]
		}
	}
	return nil
}

func ident(v string) (string, error) {
	v = strings.TrimSpace(v)
	ok := regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`).MatchString(v)
	if !ok {
		return "", fmt.Errorf("非法标识符：%q", v)
	}
	return v, nil
}
func mustIdent(v string) string {
	s, err := ident(v)
	if err != nil {
		return v
	}
	return s
}

func columnsSQL(t *Table) string {
	var out []string
	for _, f := range t.Fields {
		if !f.Hidden {
			out = append(out, mustIdent(f.Name))
		}
	}
	return strings.Join(out, ", ")
}

func allColumnsSQL(t *Table) string {
	var out []string
	for _, f := range t.Fields {
		out = append(out, mustIdent(f.Name))
	}
	return strings.Join(out, ", ")
}

func idField(t *Table) Field {
	for _, f := range t.Fields {
		if f.PK {
			return f
		}
	}
	if len(t.Fields) > 0 {
		return t.Fields[0]
}
	return Field{Name: "id", Type: "bigint", PK: true}
}

func writableFields(t *Table) []Field {
	var out []Field
	for _, f := range t.Fields {
		if !f.PK && !f.Auto && f.Writable {
			out = append(out, f)
		}
	}
	return out
}

func castValue(f *Field, raw any) any {
	if raw == nil {
		return nil
	}
	typ := strings.ToLower(f.Type)
	numeric := map[string]bool{"bigint": true, "int": true, "smallint": true, "tinyint": true, "decimal": true, "float": true, "double": true, "bool": true, "boolean": true}
	if typ == "bool" || typ == "boolean" {
		switch v := raw.(type) {
		case bool:
			return v
		case string:
			return v == "1" || v == "true" || v == "TRUE"
		}
	}
	if numeric[typ] {
		if s, ok := raw.(string); ok {
			if n, err := strconv.ParseFloat(s, 64); err == nil {
				return n
			}
		}
		return raw
	}
	if arr, ok := raw.([]any); ok {
		parts := make([]string, 0, len(arr))
		for _, x := range arr {
			parts = append(parts, fmt.Sprint(x))
		}
		return strings.Join(parts, ",")
	}
	if s, ok := raw.(string); ok {
		return s
	}
	return fmt.Sprint(raw)
}

func buildWhere(t *Table, ctx *Ctx, params *[]any) string {
	var parts []string
	byName := map[string]Field{}
	for _, f := range t.Fields {
		if f.Query && !f.Hidden {
			byName[f.Name] = f
		}
	}
	keys := make([]string, 0, len(ctx.Query))
	for k := range ctx.Query {
		keys = append(keys, k)
	}
	for _, key := range keys {
		if key == "page" || key == "pageSize" || key == "sort" || key == "keyword" || key == "keywordRegex" || key == "keyword_regex" {
			continue
		}
		base, op := key, "eq"
		for _, suffix := range []string{"__gte", "__lte", "__gt", "__lt", "__like", "__in", "__between", "__ne", "__regex", "__iregex", "__notregex", "__contains", "__startswith", "__endswith", "__isnull", "__notnull"} {
			if strings.HasSuffix(key, suffix) {
				base = strings.TrimSuffix(key, suffix)
				op = strings.TrimPrefix(suffix, "__")
				break
			}
		}
		f, ok := byName[base]
		if !ok {
			continue
		}
		raw := ctx.Query[key]
		if raw == nil || raw == "" {
			continue
		}
		switch op {
		case "eq":
			parts = append(parts, mustIdent(f.Name)+" = ?")
			*params = append(*params, castValue(&f, raw))
		case "ne":
			parts = append(parts, mustIdent(f.Name)+" <> ?")
			*params = append(*params, castValue(&f, raw))
		case "gte", "gt", "lte", "lt":
			sign := map[string]string{"gte": ">=", "gt": ">", "lte": "<=", "lt": "<"}[op]
			parts = append(parts, mustIdent(f.Name)+" "+sign+" ?")
			*params = append(*params, castValue(&f, raw))
		case "like":
			parts = append(parts, mustIdent(f.Name)+" LIKE ?")
			*params = append(*params, "%"+fmt.Sprint(raw)+"%")
		case "regex", "iregex", "notregex":
			pattern := fmt.Sprint(raw)
			if len(pattern) > 500 {
				pattern = pattern[:500]
			}
			if op == "iregex" && !strings.HasPrefix(pattern, "(?") {
				pattern = "(?i)" + pattern
			}
			neg := ""
			if op == "notregex" {
				neg = "NOT "
			}
			parts = append(parts, mustIdent(f.Name)+" "+neg+"REGEXP ?")
			*params = append(*params, pattern)
		case "contains", "startswith", "endswith":
			v := strings.NewReplacer("\\", "\\\\", "%", "\\%", "_", "\\_").Replace(fmt.Sprint(raw))
			parts = append(parts, mustIdent(f.Name)+" LIKE ?")
			if op == "contains" {
				*params = append(*params, "%"+v+"%")
			} else if op == "startswith" {
				*params = append(*params, v+"%")
			} else {
				*params = append(*params, "%"+v)
			}
		case "isnull":
			yes := regexp.MustCompile(`^(1|true|yes|y)$`).MatchString(strings.ToLower(strings.TrimSpace(fmt.Sprint(raw))))
			if yes {
				parts = append(parts, mustIdent(f.Name)+" IS NULL")
			} else {
				parts = append(parts, mustIdent(f.Name)+" IS NOT NULL")
			}
		case "notnull":
			parts = append(parts, mustIdent(f.Name)+" IS NOT NULL")
		case "in":
			list := splitList(raw)
			if len(list) == 0 {
				continue
			}
			var marks []string
			for _, v := range list {
				marks = append(marks, "?")
				*params = append(*params, castValue(&f, v))
			}
			parts = append(parts, mustIdent(f.Name)+" IN ("+strings.Join(marks, ", ")+")")
		case "between":
			list := splitList(raw)
			if len(list) < 2 {
				continue
			}
			parts = append(parts, mustIdent(f.Name)+" BETWEEN ? AND ?")
			*params = append(*params, castValue(&f, list[0]), castValue(&f, list[1]))
		}
	}
	kw := strings.TrimSpace(fmt.Sprint(ctx.Query["keyword"]))
	var search []Field
	for _, f := range t.Fields {
		if f.Search && regexp.MustCompile(`char|text|varchar`).MatchString(strings.ToLower(f.Type)) {
			search = append(search, f)
		}
	}
	if kw != "" && kw != "<nil>" && len(search) > 0 {
		var likes []string
		for _, f := range search {
			likes = append(likes, mustIdent(f.Name)+" LIKE ?")
			*params = append(*params, "%"+kw+"%")
		}
		parts = append(parts, "("+strings.Join(likes, " OR ")+")")
	}
	kwRegex := strings.TrimSpace(fmt.Sprint(ctx.Query["keywordRegex"]))
	if kwRegex == "" || kwRegex == "<nil>" {
		kwRegex = strings.TrimSpace(fmt.Sprint(ctx.Query["keyword_regex"]))
	}
	if kwRegex != "" && kwRegex != "<nil>" && len(search) > 0 {
		if len(kwRegex) > 500 {
			kwRegex = kwRegex[:500]
		}
		var rx []string
		for _, f := range search {
			rx = append(rx, mustIdent(f.Name)+" REGEXP ?")
			*params = append(*params, kwRegex)
		}
		parts = append(parts, "("+strings.Join(rx, " OR ")+")")
	}
	if len(parts) == 0 {
		return "1 = 1"
	}
	return strings.Join(parts, " AND ")
}

func splitList(raw any) []string {
	var list []string
	if arr, ok := raw.([]any); ok {
		for _, v := range arr {
			list = append(list, strings.TrimSpace(fmt.Sprint(v)))
		}
	} else {
		for _, v := range strings.Split(fmt.Sprint(raw), ",") {
			list = append(list, strings.TrimSpace(v))
		}
	}
	var out []string
	for _, v := range list {
		if v != "" {
			out = append(out, v)
		}
	}
	if len(out) > 50 {
		out = out[:50]
	}
	return out
}

func orderBySQL(t *Table, ctx *Ctx) string {
	raw := strings.TrimSpace(fmt.Sprint(ctx.Query["sort"]))
	if raw != "" && raw != "<nil>" {
		var built []string
		for _, p := range strings.Split(raw, ",") {
			p = strings.TrimSpace(p)
			if p == "" {
				continue
			}
			parts := strings.Split(p, ":")
			name := parts[0]
			dir := "ASC"
			if len(parts) > 1 && strings.EqualFold(parts[1], "desc") {
				dir = "DESC"
			}
			found := false
			for _, f := range t.Fields {
				if f.Name == name {
					found = true
					break
				}
			}
			if found {
				built = append(built, mustIdent(name)+" "+dir)
			}
			if len(built) >= 3 {
				break
			}
		}
		if len(built) > 0 {
			return strings.Join(built, ", ")
		}
	}
	return mustIdent(idField(t).Name) + " DESC"
}

func intIn(v any, def, min, max int) int {
	var n int
	switch x := v.(type) {
	case float64:
		n = int(x)
	case int:
		n = x
	case string:
		n, _ = strconv.Atoi(x)
	default:
		return def
	}
	if n < min {
		return min
}
	if n > max {
		return max
	}
	return n
}

func pageSizeOf(root *Service) int {
	if v, ok := root.Page["size"]; ok {
		if n, ok := v.(float64); ok && n > 0 {
			return int(n)
		}
	}
	return 20
}

func queryHash(ctx *Ctx) string {
	body, _ := json.Marshal(map[string]any{"q": ctx.Query, "p": ctx.Path, "id": ctx.ID})
	h := sha1.Sum(body)
	return hex.EncodeToString(h[:])[:16]
}

func structValue(token string, root *Service, iface *Interface, ctx *Ctx, params *[]any) (string, error) {
	base, key := splitToken(token)
	if base == "bucket" || base == "bindColumn" {
		if base == "bucket" {
			return strings.ReplaceAll(fmt.Sprint(root.Storage["bucket"]), "'", ""), nil
		}
		return fmt.Sprint(root.Storage["bindField"]), nil
	}
	t := bindingOf(iface, key)
	if t == nil {
		return "", fmt.Errorf("未知表键：%s", key)
	}
	switch base {
	case "t", "table":
		return mustIdent(t.Name), nil
	case "schema":
		if t.Schema != "" {
			return mustIdent(t.Schema) + ".", nil
		}
		return "", nil
	case "tableComment":
		return t.Comment, nil
	case "columns":
		return columnsSQL(t), nil
	case "allColumns":
		return allColumnsSQL(t), nil
	case "insertColumns":
		var names []string
		for _, f := range writableFields(t) {
			names = append(names, mustIdent(f.Name))
		}
		return strings.Join(names, ", "), nil
	case "insertValues":
		var marks []string
		for _, f := range writableFields(t) {
			v, ok := ctx.Body[f.Name]
			if !ok {
				if f.Default != "" {
					v = f.Default
				} else {
					v = nil
				}
			}
			*params = append(*params, castValue(&f, v))
			marks = append(marks, "?")
		}
		return strings.Join(marks, ", "), nil
	case "updateSet":
		var sets []string
		for _, f := range writableFields(t) {
			if v, ok := ctx.Body[f.Name]; ok {
				*params = append(*params, castValue(&f, v))
				sets = append(sets, mustIdent(f.Name)+" = ?")
			}
		}
		if len(sets) == 0 {
			return "", fmt.Errorf("更新语句没有可写字段")
		}
		return strings.Join(sets, ", "), nil
	case "where":
		return buildWhere(t, ctx, params), nil
	case "orderBy":
		return orderBySQL(t, ctx), nil
	case "limit":
		return strconv.Itoa(intIn(firstOf(ctx.Query, "pageSize", "limit"), pageSizeOf(root), 1, 500)), nil
	case "offset":
		size := intIn(firstOf(ctx.Query, "pageSize", "limit"), pageSizeOf(root), 1, 500)
		page := intIn(ctx.Query["page"], 1, 1, 100000)
		return strconv.Itoa((page - 1) * size), nil
	case "page":
		return strconv.Itoa(intIn(ctx.Query["page"], 1, 1, 100000)), nil
	case "pageSize":
		return strconv.Itoa(intIn(ctx.Query["pageSize"], pageSizeOf(root), 1, 500)), nil
	case "idColumn":
		return mustIdent(idField(t).Name), nil
	default:
		return "", nil
	}
}

func firstOf(m map[string]any, keys ...string) any {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil && v != "" {
			return v
		}
	}
	return nil
}

func pick(ctx *Ctx, token string) any {
	dot := strings.Index(token, ".")
	scope := ""
	key := token
	if dot > 0 {
		scope = token[:dot]
		key = token[dot+1:]
	}
	if scope == "vars" || scope == "last" {
		var cur any
		if scope == "vars" {
			cur = ctx.Vars
		} else {
			cur = ctx.Last
		}
		for _, seg := range strings.Split(key, ".") {
			cur = walkAny(cur, seg)
		}
		return cur
	}
	var bag map[string]any
	switch scope {
	case "query":
		bag = ctx.Query
	case "body":
		bag = ctx.Body
	case "path":
		bag = ctx.Path
	case "file":
		bag = ctx.File
	case "user":
		bag = ctx.User
	case "env":
		bag = ctx.Env
	}
	if bag == nil {
		return nil
	}
	return bag[key]
}

func walkAny(cur any, seg string) any {
	if cur == nil {
		return nil
	}
	switch v := cur.(type) {
	case map[string]any:
		return v[seg]
	case []any:
		n, err := strconv.Atoi(seg)
		if err == nil && n >= 0 && n < len(v) {
			return v[n]
		}
	}
	return nil
}

func valueOf(token string, ctx *Ctx, iface *Interface) any {
	switch token {
	case "id":
		if ctx.ID != nil {
			return ctx.ID
		}
		if v, ok := ctx.Query["id"]; ok {
			return v
		}
		return ctx.Path["id"]
	case "now":
		return ctx.Now
	case "uuid", "onlyId":
		return ctx.UUID
	case "token":
		return ctx.Token
	case "remoteIp":
		return ctx.RemoteIP
	case "traceId":
		return ctx.TraceID
	case "queryHash":
		return queryHash(ctx)
	case "filename":
		return mapStr(ctx.File, "filename")
	case "contentType":
		return mapStr(ctx.File, "contentType")
	case "size":
		return ctx.File["size"]
	case "objectKey":
		return mapStr(ctx.File, "objectKey")
	case "objectUrl":
		return mapStr(ctx.File, "objectUrl")
	}
	v := pick(ctx, token)
	last := token
	if i := strings.LastIndex(token, "."); i >= 0 {
		last = token[i+1:]
	}
	if t := bindingOf(iface, ""); t != nil {
		for _, f := range t.Fields {
			if f.Name == last {
				return castValue(&f, v)
			}
		}
	}
	return v
}

func mapStr(m map[string]any, key string) any {
	if m == nil {
		return ""
	}
	if v, ok := m[key]; ok {
		return v
	}
	return ""
}

func renderText(tpl string, root *Service, iface *Interface, ctx *Ctx) string {
	return tokenRe.ReplaceAllStringFunc(tpl, func(all string) string {
		token := strings.TrimSpace(all[2 : len(all)-2])
		base, _ := splitToken(token)
		if structTokens[base] {
			if base == "where" {
				return "1 = 1"
			}
			if base == "orderBy" {
				return "id DESC"
			}
			p := []any{}
			v, err := structValue(token, root, iface, ctx, &p)
			if err != nil {
				return ""
			}
			return v
		}
		v := valueOf(token, ctx, iface)
		if v == nil {
			return ""
		}
		return fmt.Sprint(v)
	})
}

func renderSQLText(text string, root *Service, iface *Interface, ctx *Ctx) (string, []any, error) {
	params := []any{}
	// $变量 先转成 {{vars.x}}，和编辑器里的规则一致
	text = varRe.ReplaceAllStringFunc(text, func(all string) string {
		m := varRe.FindStringSubmatch(all)
		if len(m) < 2 {
			return all
		}
		path := strings.ReplaceAll(m[1], "[", ".")
		path = strings.ReplaceAll(path, "]", "")
		v := pick(ctx, "vars."+path)
		if v == nil {
			return all
		}
		return "{{vars." + path + "}}"
	})
	var out strings.Builder
	last := 0
	for _, loc := range tokenRe.FindAllStringIndex(text, -1) {
		out.WriteString(text[last:loc[0]])
		token := strings.TrimSpace(text[loc[0]+2 : loc[1]-2])
		base, _ := splitToken(token)
		if structTokens[base] {
			v, err := structValue(token, root, iface, ctx, &params)
			if err != nil {
				return "", nil, err
			}
			out.WriteString(v)
		} else {
			params = append(params, valueOf(token, ctx, iface))
			out.WriteString("?")
		}
		last = loc[1]
	}
	out.WriteString(text[last:])
	return out.String(), params, nil
}
