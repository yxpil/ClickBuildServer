// 作者：yxpil
'use strict';
/** Go 生成器模板：internal 层各包（config/db/cache/id/auth/query/crud/filesource/customsql） */

function goMod(ir) {
  const p = ir.project;
  return `module ${p.groupId}/${p.artifact}

go 1.23

require (
	github.com/go-sql-driver/mysql v1.8.1
	github.com/redis/go-redis/v9 v9.7.0
	github.com/xuri/excelize/v2 v2.9.0
)
`;
}

function configGo(ir) {
  const p = ir.project;
  return `package config

import (
	"os"
	"strconv"
)

type VerifyConfig struct {
	SmsProvider   string
	SmsEndpoint   string
	SmsSign       string
	SmsTemplate   string
	EmailProvider string
	EmailHost     string
	EmailFrom     string
}

type DBConfig struct {
	Host, User, Password, Name string
	Port, Pool                 int
	ReadHost                   string
	ReadPort                   int
	Clusters                   []DBCluster
	Routing                    RoutingConfig
	Failover                   FailoverConfig
}

// DBCluster：一个可路由的库（主库 / 从库，weight 决定分流比例）
type DBCluster struct {
	Name, Role, Host, Database string
	Port, Weight               int
	Readonly                   bool
	User, Password             string
}

type RoutingConfig struct {
	Strategy           string
	ReadWriteSplit     bool
	HealthCheckMs      int
	FailoverThreshold  int
}

type FailoverConfig struct {
	Enabled         bool
	Quorum          int
	LeaseSeconds    int
	SplitBrainGuard bool
}

type CorsConfig struct {
	Enabled     bool
	Origins     []string
	Methods     []string
	Headers     []string
	Credentials bool
}

type WafConfig struct {
	Enabled          bool
	SQLInjection     bool
	SQLInjectionBody bool
	Xss              bool
	PathTraversal    bool
	CCEnabled        bool
	CCRps            int
	CCBurst          int
	DdosEnabled      bool
	MaxConcurrent    int
	FrameOptions     string
	Nosniff          bool
	Hsts             bool
	Cors             CorsConfig
}

type RedisConfig struct {
	Enabled  bool
	Host     string
	Port     int
	Password string
	DB       int
}

type StorageConfig struct {
	Provider   string
	Bucket     string
	Endpoint   string
	AccessKey  string
	SecretKey  string
	LocalDir   string
	PublicBase string
}

type Config struct {
	Name        string
	Port        int
	ContextPath string
	CookieName  string
	TokenTTL    int
	KeyPrefix   string
	Secret      string
	InitAdmin   string
	InitPass    string
	LuidEnabled bool
	LuidTTL     int
	LuidHeader  string
	OwnerGuard  bool
	Verify      VerifyConfig
	WAF         WafConfig
	DB          DBConfig
	Redis       RedisConfig
	Storage     StorageConfig
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func Load() Config {
	return Config{
		Name:        ${JSON.stringify(p.name)},
		Port:        envInt("PORT", ${p.port || 8080}),
		ContextPath: ${JSON.stringify(p.contextPath || '/api')},
		CookieName:  ${JSON.stringify(p.cookieName || 'CB_TOKEN')},
		TokenTTL:    envInt("TOKEN_TTL", ${p.tokenTtl || 7200}),
		KeyPrefix:   ${JSON.stringify((p.cache && p.cache.keyPrefix) || 'cb')},
		Secret:      env("APP_SECRET", ${JSON.stringify(p.jwtSecret || 'clickbuild-server-secret-change-me')}),
		InitAdmin:   env("INIT_ADMIN", ${JSON.stringify((p.initAdmin && p.initAdmin.username) || 'admin')}),
		InitPass:    env("INIT_PASSWORD", ${JSON.stringify((p.initAdmin && p.initAdmin.password) || 'Admin@123456')}),
		LuidEnabled: ${ir.luid && ir.luid.enabled ? 'true' : 'false'},
		LuidTTL:     envInt("LUID_TTL", ${(ir.luid && ir.luid.ttlSeconds) || 3600}),
		LuidHeader:  ${JSON.stringify((ir.luid && ir.luid.headerName) || 'X-Luid')},
		OwnerGuard:  ${p.security && p.security.ownerGuard !== false ? 'true' : 'false'},
		Verify: VerifyConfig{
			SmsProvider:   env("SMS_PROVIDER", ${JSON.stringify(ir.verification.sms.provider)}),
			SmsEndpoint:   env("SMS_ENDPOINT", ${JSON.stringify(ir.verification.sms.endpoint)}),
			SmsSign:       env("SMS_SIGN", ${JSON.stringify(ir.verification.sms.signName)}),
			SmsTemplate:   env("SMS_TEMPLATE", ${JSON.stringify(ir.verification.sms.templateCode)}),
			EmailProvider: env("EMAIL_PROVIDER", ${JSON.stringify(ir.verification.email.provider)}),
			EmailHost:     env("EMAIL_HOST", ${JSON.stringify(ir.verification.email.host)}),
			EmailFrom:     env("EMAIL_FROM", ${JSON.stringify(ir.verification.email.from)}),
		},
		WAF: WafConfig{
			Enabled:          true,
			SQLInjection:     ${ir.waf.sqlInjection},
			SQLInjectionBody: ${ir.waf.sqlInjectionBody},
			Xss:              ${ir.waf.xss},
			PathTraversal:    ${ir.waf.pathTraversal},
			CCEnabled:        ${ir.waf.cc.enabled},
			CCRps:            ${ir.waf.cc.rps},
			CCBurst:          ${ir.waf.cc.burst},
			DdosEnabled:      ${ir.waf.ddos.enabled},
			MaxConcurrent:    ${ir.waf.ddos.maxConcurrent},
			FrameOptions:     ${JSON.stringify(ir.waf.headers.frameOptions)},
			Nosniff:          ${ir.waf.headers.contentTypeOptions},
			Hsts:             ${ir.waf.headers.hsts},
			Cors: CorsConfig{
				Enabled:     ${ir.waf.cors.enabled},
				Credentials: ${ir.waf.cors.credentials},
				Origins:     []string{${ir.waf.cors.origins.map((x) => JSON.stringify(x)).join(', ')}},
				Methods:     []string{${ir.waf.cors.methods.map((x) => JSON.stringify(x)).join(', ')}},
				Headers:     []string{${ir.waf.cors.headers.map((x) => JSON.stringify(x)).join(', ')}},
			},
		},
		DB: DBConfig{
			Host:     env("DB_HOST", ${JSON.stringify((p.database && p.database.host) || '127.0.0.1')}),
			Port:     envInt("DB_PORT", ${(p.database && p.database.port) || 3306}),
			User:     env("DB_USER", ${JSON.stringify((p.database && p.database.username) || 'root')}),
			Password: env("DB_PASSWORD", ${JSON.stringify((p.database && p.database.password) || 'root')}),
			Name:     env("DB_NAME", ${JSON.stringify((p.database && p.database.name) || 'click_server')}),
			Pool:     envInt("DB_POOL", 10),
			ReadHost: env("DB_READ_HOST", ${JSON.stringify((p.database && p.database.cluster && p.database.cluster.readHost) || '')}),
			ReadPort: envInt("DB_READ_PORT", ${(p.database && p.database.cluster && p.database.cluster.readPort) || 3306}),
			Clusters: []DBCluster{${(ir.clusters || []).map((c) => `
				{Name: ${JSON.stringify(c.name)}, Role: ${JSON.stringify(c.role)}, Host: ${JSON.stringify(c.host)}, Port: ${c.port}, Weight: ${c.weight}, Readonly: ${c.readonly}, Database: ${JSON.stringify(c.database || '')}, User: ${JSON.stringify(c.user || '')}, Password: ${JSON.stringify(c.password || '')}},`).join('')}
			},
			Routing: RoutingConfig{
				Strategy:          ${JSON.stringify(ir.project.database.routing.strategy)},
				ReadWriteSplit:    ${ir.project.database.routing.readWriteSplit},
				HealthCheckMs:     ${ir.project.database.routing.healthCheckMs},
				FailoverThreshold: ${ir.project.database.routing.failoverThreshold},
			},
			Failover: FailoverConfig{
				Enabled:         ${ir.project.database.failover.enabled},
				Quorum:          ${ir.project.database.failover.quorum},
				LeaseSeconds:    ${ir.project.database.failover.leaseSeconds},
				SplitBrainGuard: ${ir.project.database.failover.splitBrainGuard},
			},
		},
		Redis: RedisConfig{
			Enabled:  ${(p.redis && p.redis.enabled !== false) ? 'true' : 'false'},
			Host:     env("REDIS_HOST", ${JSON.stringify((p.redis && p.redis.host) || '127.0.0.1')}),
			Port:     envInt("REDIS_PORT", ${(p.redis && p.redis.port) || 6379}),
			Password: env("REDIS_PASSWORD", ${JSON.stringify((p.redis && p.redis.password) || '')}),
			DB:       envInt("REDIS_DB", ${(p.redis && p.redis.db) || 0}),
		},
		Storage: StorageConfig{
			Provider:   env("OSS_PROVIDER", ${JSON.stringify((p.storage && p.storage.provider) || 'local')}),
			Bucket:     env("OSS_BUCKET", ${JSON.stringify((p.storage && p.storage.bucket) || 'media')}),
			Endpoint:   env("OSS_ENDPOINT", ${JSON.stringify((p.storage && p.storage.endpoint) || '')}),
			AccessKey:  env("OSS_ACCESS_KEY", ""),
			SecretKey:  env("OSS_SECRET_KEY", ""),
			LocalDir:   env("OSS_LOCAL_DIR", ${JSON.stringify((p.storage && p.storage.localDir) || './uploads')}),
			PublicBase: env("OSS_PUBLIC_BASE", ""),
		},
	}
}

var C = Load()
`;
}

function dbGo() {
  return `package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/go-sql-driver/mysql"

	"REPLACE_MODULE/internal/config"
)

var (
	Write *sql.DB
	Read  *sql.DB
)

func dsn(host string, port int) string {
	c := config.C.DB
	return fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&parseTime=true&loc=Local",
		c.User, c.Password, host, port, c.Name)
}

func Init() error {
	var err error
	Write, err = sql.Open("mysql", dsn(config.C.DB.Host, config.C.DB.Port))
	if err != nil {
		return err
	}
	Write.SetMaxOpenConns(config.C.DB.Pool)
	Write.SetMaxIdleConns(config.C.DB.Pool)
	Write.SetConnMaxLifetime(time.Hour)
	if config.C.DB.ReadHost != "" {
		Read, err = sql.Open("mysql", dsn(config.C.DB.ReadHost, config.C.DB.ReadPort))
		if err == nil {
			Read.SetMaxOpenConns(config.C.DB.Pool)
		}
	} else {
		Read = Write
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return Write.PingContext(ctx)
}

func Ping() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return Write.PingContext(ctx)
}

/** Query 返回 []map[string]any，bigint 以字符串返回避免精度丢失。 */
func Query(ctx context.Context, sqlStr string, args ...any) ([]map[string]any, error) {
	return queryOn(ctx, Write, sqlStr, args...)
}

func QueryRead(ctx context.Context, sqlStr string, args ...any) ([]map[string]any, error) {
	return queryOn(ctx, Read, sqlStr, args...)
}

func queryOn(ctx context.Context, conn *sql.DB, sqlStr string, args ...any) ([]map[string]any, error) {
	rows, err := conn.QueryContext(ctx, sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var out []map[string]any
	for rows.Next() {
		raw := make([]sql.RawBytes, len(cols))
		dest := make([]any, len(cols))
		for i := range raw {
			dest[i] = &raw[i]
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		m := make(map[string]any, len(cols))
		for i, name := range cols {
			if raw[i] == nil {
				m[name] = nil
			} else {
				m[name] = string(raw[i])
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func Exec(ctx context.Context, sqlStr string, args ...any) (int64, error) {
	res, err := Write.ExecContext(ctx, sqlStr, args...)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func Tx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := Write.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
`;
}

function cacheGo() {
  return `package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"REPLACE_MODULE/internal/config"
)

type memoryItem struct {
	value  []byte
	expire time.Time
}

var (
	rdb  *redis.Client
	mu   sync.RWMutex
	mem  = map[string]memoryItem{}
	ctx  = context.Background()
	once sync.Once
)

func Init() {
	once.Do(func() {
		if !config.C.Redis.Enabled {
			return
		}
		rdb = redis.NewClient(&redis.Options{
			Addr:     fmt.Sprintf("%s:%d", config.C.Redis.Host, config.C.Redis.Port),
			Password: config.C.Redis.Password,
			DB:       config.C.Redis.DB,
		})
		if err := rdb.Ping(ctx).Err(); err != nil {
			rdb = nil
		}
	})
}

func key(k string) string { return config.C.KeyPrefix + ":" + k }

func Get(k string) ([]byte, bool) {
	Init()
	if rdb != nil {
		v, err := rdb.Get(ctx, key(k)).Bytes()
		if err == nil && v != nil {
			return v, true
		}
	}
	mu.RLock()
	defer mu.RUnlock()
	it, ok := mem[key(k)]
	if !ok {
		return nil, false
	}
	if !it.expire.IsZero() && time.Now().After(it.expire) {
		return nil, false
	}
	return it.value, true
}

func Set(k string, v any, ttl time.Duration) {
	Init()
	b, _ := json.Marshal(v)
	if rdb != nil {
		if err := rdb.Set(ctx, key(k), b, ttl).Err(); err == nil {
			return
		}
	}
	mu.Lock()
	defer mu.Unlock()
	var exp time.Time
	if ttl > 0 {
		exp = time.Now().Add(ttl)
	}
	mem[key(k)] = memoryItem{value: b, expire: exp}
}

func Del(k string) {
	Init()
	if rdb != nil {
		_ = rdb.Del(ctx, key(k)).Err()
	}
	mu.Lock()
	defer mu.Unlock()
	delete(mem, key(k))
}

func SAdd(k string, members ...string) {
	Init()
	if rdb != nil {
		_ = rdb.SAdd(ctx, key(k), members).Err()
		return
	}
	// 内存模式用 JSON 数组模拟集合
	cur := []string{}
	if v, ok := Get(k); ok {
		_ = json.Unmarshal(v, &cur)
	}
	set := map[string]bool{}
	for _, s := range cur {
		set[s] = true
	}
	for _, m := range members {
		set[m] = true
	}
	next := make([]string, 0, len(set))
	for s := range set {
		next = append(next, s)
	}
	Set(k, next, 0)
}

func SInter(keys ...string) []string {
	Init()
	if rdb != nil {
		v, err := rdb.SInter(ctx, prefixAll(keys)...).Result()
		if err != nil {
			return nil
		}
		return v
	}
	// 内存模式求交集
	sets := make([]map[string]bool, 0, len(keys))
	for _, k := range keys {
		s := map[string]bool{}
		if v, ok := Get(k); ok {
			var arr []string
			_ = json.Unmarshal(v, &arr)
			for _, x := range arr {
				s[x] = true
			}
		}
		sets = append(sets, s)
	}
	if len(sets) == 0 {
		return nil
	}
	var out []string
	for x := range sets[0] {
		ok := true
		for _, s := range sets[1:] {
			if !s[x] {
				ok = false
				break
			}
		}
		if ok {
			out = append(out, x)
		}
	}
	return out
}

func prefixAll(keys []string) []string {
	out := make([]string, len(keys))
	for i, k := range keys {
		out[i] = key(k)
	}
	return out
}
`;
}

function idGo() {
  return `package id

import (
	"sync"
	"time"
)

const (
	workerBits = 10
	seqBits    = 12
	epoch      = int64(1735660800000) // 2025-01-01
)

var (
	mu     sync.Mutex
	lastTs int64 = -1
	seq    int64
	worker int64
)

func Init(port int) { worker = int64(port % 1024) }

func Next() int64 {
	mu.Lock()
	defer mu.Unlock()
	ts := time.Now().UnixMilli()
	if ts == lastTs {
		seq = (seq + 1) & ((1 << seqBits) - 1)
		if seq == 0 {
			for time.Now().UnixMilli() <= ts {
			}
			ts = time.Now().UnixMilli()
		}
	} else if ts < lastTs {
		ts = lastTs
	} else {
		seq = 0
	}
	lastTs = ts
	return ((ts - epoch) << (workerBits + seqBits)) | (worker << seqBits) | seq
}

func NextString() string {
	return fmtInt(Next())
}

func fmtInt(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
`;
}

module.exports = { goMod, configGo, dbGo, cacheGo, idGo };
