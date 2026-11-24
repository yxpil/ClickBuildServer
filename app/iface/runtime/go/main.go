// 作者：yxpil
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

type Field struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Comment  string `json:"comment"`
	Default  string `json:"default"`
	PK       bool   `json:"pk"`
	Auto     bool   `json:"auto"`
	Hidden   bool   `json:"hidden"`
	Query    bool   `json:"query"`
	Writable bool   `json:"writable"`
	Search   bool   `json:"search"`
}

type Table struct {
	Key       string  `json:"key"`
	Name      string  `json:"name"`
	Schema    string  `json:"schema"`
	Comment   string  `json:"comment"`
	Store     Store   `json:"store"`
	Fields    []Field `json:"fields"`
	IfaceID   string  `json:"ifaceId"`
	IfaceName string  `json:"ifaceName"`
	Ref       string  `json:"ref"`
}

type Cache struct {
	Enabled bool `json:"enabled"`
	TTL     int  `json:"ttl"`
}

type Store struct {
	Mode    string `json:"mode"`
	TTL     int    `json:"ttl"`
	Max     int    `json:"max"`
	FlushMs int    `json:"flushMs"`
}

type Route struct {
	ID          string   `json:"id"`
	Key         string   `json:"key"`
	Name        string   `json:"name"`
	Method      string   `json:"method"`
	Path        string   `json:"path"`
	Auth        bool     `json:"auth"`
	Tx          bool     `json:"tx"`
	Cache       Cache    `json:"cache"`
	Script      string   `json:"script"`
	AST         []any    `json:"ast"`
	ParseErrors []string `json:"parseErrors"`
}

type Interface struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Comment       string  `json:"comment"`
	BasePath      string  `json:"basePath"`
	Tables        []Table `json:"tables"`
	ProjectTables []Table `json:"projectTables"`
	Routes        []Route `json:"routes"`
}

type Function struct {
	Name   string   `json:"name"`
	Params []string `json:"params"`
	AST    any      `json:"ast"`
}

type Service struct {
	Format     string          `json:"format"`
	Name       string          `json:"name"`
	APIPrefix  string          `json:"apiPrefix"`
	Page       map[string]any  `json:"page"`
	Storage    map[string]any  `json:"storage"`
	Functions  []Function      `json:"functions"`
	Interfaces []Interface     `json:"interfaces"`
	Seen       map[string]bool `json:"-"`
}

func loadService(file string) (*Service, error) {
	b, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	var s Service
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, err
	}
	if s.APIPrefix == "" {
		s.APIPrefix = "/api"
	}
	if s.Page == nil {
		s.Page = map[string]any{"size": 20}
	}
	return &s, nil
}

func main() {
	svc, err := loadService("service.json")
	if err != nil {
		log.Fatalf("读取 service.json 失败：%v", err)
	}
	if v, ok := configValue("API_PREFIX"); ok && v != "" {
		svc.APIPrefix = v
	}
	for _, it := range svc.Interfaces {
		for _, t := range it.Tables {
			m := strings.ToLower(strings.TrimSpace(t.Store.Mode))
			if m != "" && m != "mysql" {
				log.Fatalf("表 %s 使用 %s 存储；Go 原生运行时目前只支持 mysql，请改用 Node 运行时或把该表改回直连 MySQL", t.Name, t.Store.Mode)
			}
		}
	}
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=true&loc=Local",
		env("MYSQL_USER", "root"), env("MYSQL_PASSWORD", ""),
		env("MYSQL_HOST", "127.0.0.1"), env("MYSQL_PORT", "3306"), env("MYSQL_DB", "clickbuild"))
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("连接 MySQL 失败：%v", err)
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	port := env("PORT", "18100")
	addr := ":" + port
	srv := &Server{svc: svc, db: db, tokens: newTokenStore(), started: time.Now()}
	httpSrv := &http.Server{Addr: addr, Handler: srv, ReadHeaderTimeout: 10 * time.Second}
	log.Printf("ClickBuild Go 原生服务已启动：http://127.0.0.1:%s  (接口 %d 个)", port, len(svc.Interfaces))
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	_ = strconv.Itoa
	_ = strings.TrimSpace
}
