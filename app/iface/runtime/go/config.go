package main

// 导出工程配置加载：系统环境变量 > config.json > 内置默认值。
// config.json 放在工程根目录；从 native/go 启动时会自动向上查找。

import (
	"bytes"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

var appConfig = loadConfig()

func loadConfig() map[string]any {
	candidates := []string{}
	if v := os.Getenv("CBS_CONFIG"); v != "" {
		candidates = append(candidates, v)
	}
	candidates = append(candidates,
		"config.json",
		filepath.Join("..", "..", "config.json"),
		filepath.Join("..", "..", "..", "config.json"),
	)
	for _, file := range candidates {
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		var out map[string]any
		data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
		if err := json.Unmarshal(data, &out); err != nil {
			log.Printf("[config] 读取 %s 失败：%v", file, err)
			continue
		}
		abs, _ := filepath.Abs(file)
		log.Printf("[config] 已加载 %s", abs)
		return out
	}
	return map[string]any{}
}

func configValue(key string) (string, bool) {
	v, ok := appConfig[key]
	if !ok || v == nil {
		return "", false
	}
	switch x := v.(type) {
	case string:
		return x, true
	case bool:
		if x {
			return "true", true
		}
		return "false", true
	case float64:
		if x == float64(int64(x)) {
			return strconv.FormatInt(int64(x), 10), true
		}
		return strconv.FormatFloat(x, 'f', -1, 64), true
	default:
		return strings.TrimSpace(strings.Trim(strings.TrimSpace(toJSON(x)), `"`)), true
	}
}

func toJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

// env 保持原有调用方式，但把 config.json 作为系统环境变量之后的第二优先级。
func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	if v, ok := configValue(key); ok {
		return v
	}
	return fallback
}
