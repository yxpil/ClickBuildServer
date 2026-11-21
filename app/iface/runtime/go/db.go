// 作者：yxpil
package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
)

type DBResult struct {
	Rows     []map[string]any `json:"rows"`
	InsertID int64            `json:"insertId"`
	Affected int64            `json:"affectedRows"`
	LastID   int64            `json:"lastInsertId"`
}

type queryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
}

type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func queryRows(q queryer, query string, params []any) ([]map[string]any, error) {
	if os.Getenv("DEBUG_SQL") != "" {
		log.Printf("[SQL] %s  params=%v", query, params)
	}
	rows, err := q.Query(query, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := map[string]any{}
		for i, c := range cols {
			switch v := vals[i].(type) {
			case []byte:
				m[c] = string(v)
			case nil:
				m[c] = nil
			default:
				m[c] = v
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func execRows(x execer, query string, params []any) (DBResult, error) {
	if os.Getenv("DEBUG_SQL") != "" {
		log.Printf("[EXEC] %s  params=%v", query, params)
	}
	res, err := x.Exec(query, params...)
	if err != nil {
		return DBResult{}, err
	}
	id, _ := res.LastInsertId()
	n, _ := res.RowsAffected()
	return DBResult{InsertID: id, LastID: id, Affected: n}, nil
}

func txAction(db *sql.DB, tx **sql.Tx, action string) (any, error) {
	switch strings.ToUpper(strings.TrimSpace(action)) {
	case "BEGIN":
		if *tx != nil {
			return map[string]any{"state": "BEGIN", "already": true}, nil
		}
		t, err := db.Begin()
		if err != nil {
			return nil, err
		}
		*tx = t
		return map[string]any{"state": "BEGIN"}, nil
	case "COMMIT":
		if *tx == nil {
			return nil, fmt.Errorf("该路由没有开启事务（tx=false）")
		}
		err := (*tx).Commit()
		*tx = nil
		return map[string]any{"state": "COMMIT", "ok": err == nil}, err
	case "ROLLBACK":
		if *tx == nil {
			return nil, fmt.Errorf("该路由没有开启事务（tx=false）")
		}
		err := (*tx).Rollback()
		*tx = nil
		return map[string]any{"state": "ROLLBACK", "ok": err == nil}, err
	}
	return nil, fmt.Errorf("不支持 TX %s", action)
}
