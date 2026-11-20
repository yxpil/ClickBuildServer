package main

import (
	"database/sql"
	"errors"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
)

type Scope struct {
	Vars   map[string]any
	Last   any
	Idents map[string]any
}

type ScriptResult struct {
	Status int
	Body   any
}

type ExecEnv struct {
	server *Server
	iface  *Interface
	route  *Route
	ctx    *Ctx
	scope  *Scope
	tx     *sql.Tx
}

func (e *ExecEnv) query(sqlText string, params []any) ([]map[string]any, error) {
	if e.tx != nil {
		return queryRows(e.tx, sqlText, params)
	}
	return queryRows(e.server.db, sqlText, params)
}

func (e *ExecEnv) exec(sqlText string, params []any) (DBResult, error) {
	if e.tx != nil {
		return execRows(e.tx, sqlText, params)
	}
	return execRows(e.server.db, sqlText, params)
}

func (s *Server) runScript(iface *Interface, route *Route, ctx *Ctx) (ScriptResult, error) {
	if len(route.ParseErrors) > 0 {
		return ScriptResult{}, fmt.Errorf("脚本解析失败：%s", strings.Join(route.ParseErrors, "；"))
	}
	scope := &Scope{Vars: ctx.Vars}
	env := &ExecEnv{server: s, iface: iface, route: route, ctx: ctx, scope: scope}
	if route.Tx {
		tx, err := s.db.Begin()
		if err != nil {
			return ScriptResult{}, err
		}
		env.tx = tx
		defer func() {
			if env.tx != nil {
				_ = env.tx.Rollback()
				env.tx = nil
			}
		}()
	}
	res, err := env.execBlock(route.AST)
	if err != nil {
		return ScriptResult{}, err
	}
	if env.tx != nil {
		if err := env.tx.Commit(); err != nil {
			return ScriptResult{}, err
		}
		env.tx = nil
	}
	if res == nil {
		return ScriptResult{Status: 200, Body: scope.Last}, nil
	}
	return *res, nil
}

func (e *ExecEnv) execBlock(block []any) (*ScriptResult, error) {
	for _, raw := range block {
		st, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		e.ctx.Vars = e.scope.Vars
		e.ctx.Last = e.scope.Last
		switch str(st["k"]) {
		case "let":
			if err := e.execLet(st); err != nil {
				return nil, err
			}
		case "sql":
			if err := e.execSQL(st); err != nil {
				return nil, err
			}
		case "if":
			r, err := e.execIf(st)
			if err != nil || r != nil {
				return r, err
			}
		case "foreach":
			list := e.eval(st["expr"])
			var arr []any
			if a, ok := list.([]any); ok {
				arr = a
			} else if m, ok := list.(map[string]any); ok {
				if a, ok := m["rows"].([]any); ok {
					arr = a
				}
			}
			if len(arr) > 500 {
				arr = arr[:500]
			}
			for _, item := range arr {
				e.scope.Vars[str(st["name"])] = item
				r, err := e.execBlock(asBlock(st["body"]))
				if err != nil || r != nil {
					return r, err
				}
			}
		case "log":
			fmt.Printf("[%s] %v\n", str(st["level"]), e.eval(st["expr"]))
		case "return":
			status := 200
			if v, ok := st["status"].(float64); ok {
				status = int(v)
			}
			var body any
			if st["expr"] != nil {
				body = e.eval(st["expr"])
			}
			return &ScriptResult{Status: status, Body: body}, nil
		case "tx":
			v, err := txAction(e.server.db, &e.tx, str(st["action"]))
			if err != nil {
				return nil, err
			}
			e.scope.Last = v
		case "publish":
			// 原生运行时先不接 Redis 发布；脚本不会因为缺少订阅者而失败。
		case "tokenDel":
			tok := fmt.Sprint(e.eval(st["expr"]))
			e.server.tokens.del(tok)
			e.ctx.TokenDeleted = true
		default:
			return nil, fmt.Errorf("未知脚本语句：%v", st["k"])
		}
	}
	return nil, nil
}

func (e *ExecEnv) execLet(st map[string]any) error {
	name := str(st["name"])
	switch str(st["from"]) {
	case "query", "exec":
		sqlText, params, err := renderSQLText(str(st["sql"]), e.server.svc, e.iface, e.ctx)
		if err != nil {
			return err
		}
		sqlText, params, err = expandSQLFunctions(sqlText, params, e)
		if err != nil {
			return err
		}
		if str(st["from"]) == "query" {
			rows, err := e.query(sqlText, params)
			if err != nil {
				return err
			}
			if os.Getenv("DEBUG_SQL") != "" {
				fmt.Printf("[QUERY] %s → %d rows\n", sqlText, len(rows))
			}
			v := map[string]any{"rows": toAnySlice(rows), "sql": sqlText, "params": params}
			e.scope.Vars[name] = v
			e.scope.Last = v
		} else {
			r, err := e.exec(sqlText, params)
			if err != nil {
				return err
			}
			v := map[string]any{"insertId": r.InsertID, "lastInsertId": r.LastID, "affectedRows": r.Affected, "sql": sqlText, "params": params}
			e.scope.Vars[name] = v
			e.scope.Last = v
		}
	case "http":
		// 原生运行时暂不发起外部 HTTP；返回清晰错误而不是静默假数据。
		return errors.New("Go 原生运行时暂不支持脚本里的 HTTP 调用")
	case "token":
		claims, _ := e.eval(st["expr"]).(map[string]any)
		if claims == nil {
			claims = map[string]any{}
		}
		if str(st["action"]) == "NEW" {
			v := e.server.tokens.mint(claims)
			e.scope.Vars[name] = v
			e.ctx.MintedToken = fmt.Sprint(v["token"])
			e.ctx.MintedOnlyID = fmt.Sprint(v["onlyId"])
		} else {
			tok := fmt.Sprint(claims["token"])
			v := e.server.tokens.get(tok)
			if v == nil {
				e.scope.Vars[name] = nil
			} else {
				e.scope.Vars[name] = v
			}
		}
	default:
		e.scope.Vars[name] = e.eval(st["expr"])
	}
	return nil
}

func (e *ExecEnv) execSQL(st map[string]any) error {
	sqlText, params, err := renderSQLText(str(st["sql"]), e.server.svc, e.iface, e.ctx)
	if err != nil {
		return err
	}
	sqlText, params, err = expandSQLFunctions(sqlText, params, e)
	if err != nil {
		return err
	}
	if strings.EqualFold(str(st["mode"]), "QUERY") {
		rows, err := e.query(sqlText, params)
		if err != nil {
			return err
		}
		e.scope.Last = map[string]any{"rows": toAnySlice(rows), "sql": sqlText, "params": params}
	} else {
		r, err := e.exec(sqlText, params)
		if err != nil {
			return err
		}
		e.scope.Last = map[string]any{"insertId": r.InsertID, "lastInsertId": r.LastID, "affectedRows": r.Affected, "sql": sqlText, "params": params}
	}
	return nil
}

func (e *ExecEnv) execIf(st map[string]any) (*ScriptResult, error) {
	branches := asSlice(st["branches"])
	for _, raw := range branches {
		br, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if truthy(e.eval(br["cond"])) {
			return e.execBlock(asBlock(br["body"]))
		}
	}
	if st["elseBody"] != nil {
		return e.execBlock(asBlock(st["elseBody"]))
	}
	return nil, nil
}

func asBlock(v any) []any {
	if a, ok := v.([]any); ok {
		return a
}
	return nil
}

func asSlice(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return nil
}

func str(v any) string {
	if v == nil {
		return ""
}
	return fmt.Sprint(v)
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0
	case int:
		return x != 0
	case string:
		return x != ""
	case []any:
		return len(x) > 0
	case map[string]any:
		return true
	}
	return true
}

func toAnySlice(rows []map[string]any) []any {
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = r
	}
	return out
}

func (e *ExecEnv) eval(node any) any {
	if node == nil {
		return nil
	}
	m, ok := node.(map[string]any)
	if !ok {
		return node
	}
	switch str(m["k"]) {
	case "lit":
		return m["v"]
	case "ph":
		return valueOf(str(m["v"]), e.ctx, e.iface)
	case "var":
		cur, ok := e.scope.Vars[str(m["name"])]
		if !ok {
			return nil
		}
		for _, p := range asSlice(m["path"]) {
			cur = walkAny(cur, fmt.Sprint(p))
		}
		return cur
	case "ident":
		if e.scope.Idents != nil {
			if v, ok := e.scope.Idents[str(m["name"])]; ok {
				return v
			}
		}
		switch str(m["name"]) {
		case "true":
			return true
		case "false":
			return false
		case "null":
			return nil
		}
		return m["name"]
	case "array":
		var out []any
		for _, x := range asSlice(m["items"]) {
			out = append(out, e.eval(x))
		}
		return out
	case "object":
		out := map[string]any{}
		for _, raw := range asSlice(m["entries"]) {
			entry, ok := raw.(map[string]any)
			if ok {
				out[str(entry["key"])] = e.eval(entry["value"])
			}
		}
		return out
	case "un":
		v := e.eval(m["a"])
		if str(m["op"]) == "!" {
			return !truthy(v)
		}
		return -toFloat(v)
	case "and":
		return truthy(e.eval(m["a"])) && truthy(e.eval(m["b"]))
	case "or":
		return truthy(e.eval(m["a"])) || truthy(e.eval(m["b"]))
	case "cmp":
		return compare(e.eval(m["a"]), e.eval(m["b"]), str(m["op"]))
	case "bin":
		a, b := e.eval(m["a"]), e.eval(m["b"])
		switch str(m["op"]) {
		case "+":
			if sa, ok := a.(string); ok {
				return sa + fmt.Sprint(b)
			}
			if sb, ok := b.(string); ok {
				return fmt.Sprint(a) + sb
			}
			return toFloat(a) + toFloat(b)
		case "-":
			return toFloat(a) - toFloat(b)
		case "*":
			return toFloat(a) * toFloat(b)
		case "/":
			if toFloat(b) == 0 {
				return math.NaN()
			}
			return toFloat(a) / toFloat(b)
		case "%":
			return math.Mod(toFloat(a), toFloat(b))
		}
	case "call":
		var args []any
		for _, x := range asSlice(m["args"]) {
			args = append(args, e.eval(x))
		}
		v, err := callFunc(str(m["name"]), args, e)
		if err != nil {
			fmt.Printf("[WARN] 函数 %s 执行失败：%v\n", str(m["name"]), err)
			return nil
		}
		return v
	}
	return nil
}

func compare(a, b any, op string) bool {
	switch op {
	case "==":
		return looseEqual(a, b)
	case "!=":
		return !looseEqual(a, b)
	case ">":
		return toFloat(a) > toFloat(b)
	case "<":
		return toFloat(a) < toFloat(b)
	case ">=":
		return toFloat(a) >= toFloat(b)
	case "<=":
		return toFloat(a) <= toFloat(b)
	}
	return false
}

func looseEqual(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	if fa, ok := toNum(a); ok {
		if fb, ok := toNum(b); ok {
			return fa == fb
		}
	}
	return fmt.Sprint(a) == fmt.Sprint(b)
}

func toNum(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case string:
		n, err := strconv.ParseFloat(x, 64)
		return n, err == nil
	case bool:
		if x {
			return 1, true
		}
		return 0, true
	}
	return 0, false
}

func toFloat(v any) float64 {
	if n, ok := toNum(v); ok {
		return n
	}
	return 0
}

/* ---------- SQL 内置函数：发送数据库前在本地算掉 ---------- */

var sqlExpandNames = map[string]bool{"HASH": true, "SM3": true, "SM4_ENC": true, "SM4_DEC": true, "MASK": true, "URL_ENC": true, "URL_DEC": true, "RAND_INT": true}

func expandSQLFunctions(sqlText string, params []any, env *ExecEnv) (string, []any, error) {
	var out strings.Builder
	args := params
	pi := 0
	outParams := []any{}
	i := 0
	for i < len(sqlText) {
		c := sqlText[i]
		if c == '\'' || c == '"' || c == '`' {
			j := i + 1
			for j < len(sqlText) {
				if sqlText[j] == c {
					if j+1 < len(sqlText) && sqlText[j+1] == c {
						j += 2
						continue
					}
					break
				}
				if sqlText[j] == '\\' && c != '`' {
					j++
				}
				j++
			}
			if j >= len(sqlText) {
				j = len(sqlText) - 1
			}
			out.WriteString(sqlText[i : j+1])
			i = j + 1
			continue
		}
		if c == '?' {
			out.WriteByte('?')
			if pi < len(args) {
				outParams = append(outParams, args[pi])
			}
			pi++
			i++
			continue
		}
		if (c >= 'A' && c <= 'Z') || c == '_' {
			start := i
			for i < len(sqlText) && ((sqlText[i] >= 'A' && sqlText[i] <= 'Z') || (sqlText[i] >= 'a' && sqlText[i] <= 'z') || (sqlText[i] >= '0' && sqlText[i] <= '9') || sqlText[i] == '_') {
				i++
			}
			name := sqlText[start:i]
			j := i
			for j < len(sqlText) && (sqlText[j] == ' ' || sqlText[j] == '\t') {
				j++
			}
			if j < len(sqlText) && sqlText[j] == '(' && sqlExpandNames[strings.ToUpper(name)] {
				close, inner, err := findCall(sqlText, j)
				if err != nil {
					return "", nil, err
				}
				rawArgs := splitSQLArgs(inner)
				var vals []any
				for _, a := range rawArgs {
					a = strings.TrimSpace(a)
					if a == "?" {
						if pi >= len(args) {
							return "", nil, fmt.Errorf("SQL 函数 %s 参数不足", name)
						}
						vals = append(vals, args[pi])
						pi++
					} else {
						v, err := literalValue(a)
						if err != nil {
							return "", nil, err
						}
						vals = append(vals, v)
					}
				}
				v, err := callFunc(name, vals, env)
				if err != nil {
					return "", nil, fmt.Errorf("SQL 函数 %s 执行失败：%w", name, err)
				}
				out.WriteByte('?')
				outParams = append(outParams, v)
				i = close + 1
				continue
			}
			out.WriteString(name)
			continue
		}
		out.WriteByte(c)
		i++
	}
	return out.String(), outParams, nil
}

func findCall(s string, open int) (int, string, error) {
	depth := 0
	quote := byte(0)
	for i := open; i < len(s); i++ {
		c := s[i]
		if quote != 0 {
			if c == quote {
				if i+1 < len(s) && s[i+1] == quote {
					i++
				} else {
					quote = 0
				}
			}
			continue
		}
		if c == '\'' || c == '"' || c == '`' {
			quote = c
			continue
		}
		if c == '(' {
			depth++
		} else if c == ')' {
			depth--
			if depth == 0 {
				return i, s[open+1 : i], nil
			}
		}
	}
	return 0, "", fmt.Errorf("SQL 函数括号没有闭合")
}

func splitSQLArgs(s string) []string {
	var out []string
	depth := 0
	quote := byte(0)
	cur := strings.Builder{}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if quote != 0 {
			cur.WriteByte(c)
			if c == quote {
				if i+1 < len(s) && s[i+1] == quote {
					cur.WriteByte(s[i+1])
					i++
				} else {
					quote = 0
				}
			}
			continue
		}
		if c == '\'' || c == '"' || c == '`' {
			quote = c
			cur.WriteByte(c)
			continue
		}
		if c == '(' {
			depth++
		} else if c == ')' {
			depth--
		}
		if c == ',' && depth == 0 {
			out = append(out, strings.TrimSpace(cur.String()))
			cur.Reset()
			continue
		}
		cur.WriteByte(c)
	}
	if strings.TrimSpace(cur.String()) != "" {
		out = append(out, strings.TrimSpace(cur.String()))
	}
	return out
}

func literalValue(s string) (any, error) {
	s = strings.TrimSpace(s)
	if n, err := strconv.ParseFloat(s, 64); err == nil {
		return n, nil
	}
	if (strings.HasPrefix(s, "'") && strings.HasSuffix(s, "'")) || (strings.HasPrefix(s, `"`) && strings.HasSuffix(s, `"`)) {
		q := s[:1]
		v := strings.ReplaceAll(s[1:len(s)-1], q+q, q)
		return v, nil
	}
	up := strings.ToUpper(s)
	if up == "NULL" {
		return nil, nil
	}
	if up == "TRUE" {
		return true, nil
	}
	if up == "FALSE" {
		return false, nil
	}
	return nil, fmt.Errorf("SQL 函数参数只支持 ?、字符串、数字、NULL：%s", s)
}

/* 自定义函数：项目里的函数体是表达式，沿用同一套 AST */
func (e *ExecEnv) callCustom(def Function, args []any) (any, error) {
	sub := &ExecEnv{server: e.server, iface: e.iface, route: e.route, ctx: e.ctx, scope: &Scope{Vars: map[string]any{}, Idents: map[string]any{}}}
	for i, name := range def.Params {
		if i < len(args) {
			sub.scope.Idents[name] = args[i]
		}
	}
	return nil, fmt.Errorf("自定义函数 %s 暂未在 Go 原生运行时启用", def.Name)
}
