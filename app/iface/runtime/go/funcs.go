package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/emmansun/gmsm/sm4"
)

func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }
func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

func ascii(v any) string {
	if v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return x
	case float64:
		if x == math.Trunc(x) {
			return strconv.FormatInt(int64(x), 10)
		}
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		return fmt.Sprint(v)
	}
}

func lengthOf(v any) int {
	if v == nil {
		return 0
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array || rv.Kind() == reflect.Map {
		return rv.Len()
	}
	return len([]rune(ascii(v)))
}

func hashWith(algo string, v any) string {
	var sum []byte
	switch strings.ToLower(algo) {
	case "md5":
		h := md5.Sum([]byte(ascii(v)))
		sum = h[:]
	case "sha1":
		h := sha1.Sum([]byte(ascii(v)))
		sum = h[:]
	case "sha256", "sm3":
		h := sha256.Sum256([]byte(ascii(v)))
		sum = h[:]
	default:
		h := sha256.Sum256([]byte(ascii(v)))
		sum = h[:]
	}
	return hex.EncodeToString(sum)
}

func sm4Key(key string) []byte {
	raw := []byte(key)
	if len(raw) == 16 {
		return raw
}
	h := sha256.Sum256(raw)
	return h[:16]
}

func sm4Encrypt(value, key string) (string, error) {
	block, err := sm4.NewCipher(sm4Key(key))
	if err != nil {
		return "", err
}
	padded := pkcs7Pad([]byte(value), block.BlockSize())
	out := make([]byte, len(padded))
	ecbEncrypt(block, out, padded)
	return base64.StdEncoding.EncodeToString(out), nil
}

func sm4Decrypt(value, key string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return "", err
	}
	block, err := sm4.NewCipher(sm4Key(key))
	if err != nil {
		return "", err
	}
	if len(raw)%block.BlockSize() != 0 {
		return "", fmt.Errorf("SM4 密文长度不是块大小的整数倍")
	}
	out := make([]byte, len(raw))
	ecbDecrypt(block, out, raw)
	unpadded, err := pkcs7Unpad(out, block.BlockSize())
	if err != nil {
		return "", err
	}
	return string(unpadded), nil
}

func pkcs7Pad(buf []byte, size int) []byte {
	n := size - len(buf)%size
	if n == 0 {
		n = size
	}
	return append(buf, bytes.Repeat([]byte{byte(n)}, n)...)
}

func pkcs7Unpad(buf []byte, size int) ([]byte, error) {
	if len(buf) == 0 || len(buf)%size != 0 {
		return nil, fmt.Errorf("无效的填充")
	}
	n := int(buf[len(buf)-1])
	if n <= 0 || n > size || n > len(buf) {
		return nil, fmt.Errorf("无效的填充")
	}
	for _, b := range buf[len(buf)-n:] {
		if int(b) != n {
			return nil, fmt.Errorf("无效的填充")
		}
	}
	return buf[:len(buf)-n], nil
}

func jsonGet(obj any, path string) any {
	cur := obj
	for _, p := range strings.Split(path, ".") {
		if cur == nil {
			return nil
		}
		switch v := cur.(type) {
		case map[string]any:
			cur = v[p]
		case []any:
			n, err := strconv.Atoi(p)
			if err == nil && n >= 0 && n < len(v) {
				cur = v[n]
			} else {
				return nil
			}
		default:
			return nil
		}
	}
	return cur
}

func toArray(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return nil
}

func callFunc(name string, args []any, env *ExecEnv) (any, error) {
	up := strings.ToUpper(strings.TrimSpace(name))
	for _, def := range env.server.svc.Functions {
		if strings.EqualFold(def.Name, name) {
			sub := &ExecEnv{server: env.server, iface: env.iface, route: env.route, ctx: env.ctx, scope: &Scope{Vars: map[string]any{}, Idents: map[string]any{}}}
			for i, p := range def.Params {
				if i < len(args) {
					sub.scope.Idents[p] = args[i]
				}
			}
			if def.AST == nil {
				return nil, fmt.Errorf("自定义函数 %s 的函数体为空", def.Name)
			}
			return sub.eval(def.AST), nil
		}
	}
	arg := func(i int) any {
		if i < len(args) {
			return args[i]
		}
		return nil
	}
	switch up {
	case "HASH":
		return hashWith(ascii(arg(0)), arg(1)), nil
	case "MD5":
		return hashWith("md5", arg(0)), nil
	case "SHA1":
		return hashWith("sha1", arg(0)), nil
	case "SHA256":
		return hashWith("sha256", arg(0)), nil
	case "SM3":
		return hashWith("sha256", arg(0)), nil
	case "SM4_ENC":
		return sm4Encrypt(ascii(arg(0)), ascii(arg(1)))
	case "SM4_DEC":
		return sm4Decrypt(ascii(arg(0)), ascii(arg(1)))
	case "SUBSTR":
		s := []rune(ascii(arg(0)))
		start := int(toFloat(arg(1)))
		if start < 0 {
			start = len(s) + start
		}
		if start < 0 {
			start = 0
		}
		if start > len(s) {
			start = len(s)
		}
		if len(args) < 3 || arg(2) == nil {
			return string(s[start:]), nil
		}
		end := start + int(toFloat(arg(2)))
		if end > len(s) {
			end = len(s)
		}
		return string(s[start:end]), nil
	case "LEFT":
		s := []rune(ascii(arg(0)))
		n := int(toFloat(arg(1)))
		if n < 0 {
			n = 0
		}
		if n > len(s) {
			n = len(s)
		}
		return string(s[:n]), nil
	case "RIGHT":
		s := []rune(ascii(arg(0)))
		n := int(toFloat(arg(1)))
		if n <= 0 {
			return "", nil
		}
		if n > len(s) {
			n = len(s)
		}
		return string(s[len(s)-n:]), nil
	case "LEN", "COUNT":
		if up == "COUNT" {
			if a := toArray(arg(0)); a != nil {
				return float64(len(a)), nil
			}
			if m, ok := arg(0).(map[string]any); ok {
				if rows, ok := m["rows"].([]any); ok {
					return float64(len(rows)), nil
				}
			}
			}
			if a := toArray(arg(0)); a != nil {
				return float64(len(a)), nil
			}
			return float64(len(ascii(arg(0)))), nil
	case "UPPER":
		return strings.ToUpper(ascii(arg(0))), nil
	case "LOWER":
		return strings.ToLower(ascii(arg(0))), nil
	case "TRIM":
		return strings.TrimSpace(ascii(arg(0))), nil
	case "CONCAT":
		var b strings.Builder
		for _, a := range args {
			b.WriteString(ascii(a))
		}
		return b.String(), nil
	case "REPLACE":
		return strings.ReplaceAll(ascii(arg(0)), ascii(arg(1)), ascii(arg(2))), nil
	case "SPLIT":
		sep := ","
		if len(args) > 1 {
			sep = ascii(arg(1))
		}
		var out []any
		for _, s := range strings.Split(ascii(arg(0)), sep) {
			out = append(out, s)
		}
		return out, nil
	case "JOIN":
		sep := ","
		if len(args) > 1 {
			sep = ascii(arg(1))
		}
		parts := []string{}
		for _, a := range toArray(arg(0)) {
			parts = append(parts, ascii(a))
		}
		return strings.Join(parts, sep), nil
	case "NOW":
		return time.Now().Format("2006-01-02 15:04:05"), nil
	case "TODAY":
		return time.Now().Format("2006-01-02"), nil
	case "UUID":
		return randomHex(8) + "-" + randomHex(4) + "-" + randomHex(4) + "-" + randomHex(4) + "-" + randomHex(12), nil
	case "BASE64_ENC":
		return base64.StdEncoding.EncodeToString([]byte(ascii(arg(0)))), nil
	case "BASE64_DEC":
		b, err := base64.StdEncoding.DecodeString(ascii(arg(0)))
		if err != nil {
			return "", err
		}
		return string(b), nil
	case "URL_ENC":
		return url.QueryEscape(ascii(arg(0))), nil
	case "URL_DEC":
		s, err := url.QueryUnescape(ascii(arg(0)))
		return s, err
	case "MASK":
		s := []rune(ascii(arg(0)))
		if len(s) <= 2 {
			return strings.Repeat("*", len(s)), nil
		}
		return string(s[:1]) + strings.Repeat("*", len(s)-2) + string(s[len(s)-1]), nil
	case "RAND_INT":
		lo := int(toFloat(arg(0)))
		hi := int(toFloat(arg(1)))
		if hi <= lo {
			return float64(lo), nil
		}
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(hi-lo+1)))
		return float64(lo + int(n.Int64())), nil
	case "ABS":
		return math.Abs(toFloat(arg(0))), nil
	case "ROUND":
		digits := 0
		if len(args) > 1 {
			digits = int(toFloat(arg(1)))
		}
		p := math.Pow(10, float64(digits))
		return math.Round(toFloat(arg(0))*p) / p, nil
	case "INT":
		return float64(int(toFloat(arg(0)))), nil
	case "FLOAT":
		return toFloat(arg(0)), nil
	case "STR":
		return ascii(arg(0)), nil
	case "IF":
		if truthy(arg(0)) {
			return arg(1), nil
		}
		return arg(2), nil
	case "COALESCE":
		for _, a := range args {
			if a != nil {
				return a, nil
			}
		}
		return nil, nil
	case "JSON_GET":
		return jsonGet(arg(0), ascii(arg(1))), nil
	case "JSON_ENC":
		b, err := jsonMarshal(arg(0))
		return string(b), err
	case "JSON_DEC":
		var v any
		err := jsonUnmarshal([]byte(ascii(arg(0))), &v)
		return v, err
	case "SUM", "MIN", "MAX":
		arr := toArray(arg(0))
		if arr == nil {
			if m, ok := arg(0).(map[string]any); ok {
				arr = toArray(m["rows"])
			}
		}
		if len(arr) == 0 {
			return float64(0), nil
		}
		if up == "SUM" {
			sum := 0.0
			for _, a := range arr {
				sum += toFloat(a)
			}
			return sum, nil
		}
		best := toFloat(arr[0])
		for _, a := range arr {
			n := toFloat(a)
			if (up == "MIN" && n < best) || (up == "MAX" && n > best) {
				best = n
			}
		}
		return best, nil
	case "HMAC":
		mac := hmac.New(sha256.New, []byte(ascii(arg(1))))
		mac.Write([]byte(ascii(arg(0))))
		return hex.EncodeToString(mac.Sum(nil)), nil
	case "AES_ENC":
		return aesEncrypt(ascii(arg(0)), ascii(arg(1)))
	case "AES_DEC":
		return aesDecrypt(ascii(arg(0)), ascii(arg(1)))
	}
	return nil, fmt.Errorf("未知函数：%s", name)
}

func ecbEncrypt(block cipher.Block, dst, src []byte) {
	bs := block.BlockSize()
	for i := 0; i+bs <= len(src); i += bs {
		block.Encrypt(dst[i:i+bs], src[i:i+bs])
	}
}

func ecbDecrypt(block cipher.Block, dst, src []byte) {
	bs := block.BlockSize()
	for i := 0; i+bs <= len(src); i += bs {
		block.Decrypt(dst[i:i+bs], src[i:i+bs])
	}
}

func aesEncrypt(value, key string) (string, error) {	k := sha256.Sum256([]byte(key))
	block, err := aes.NewCipher(k[:])
	if err != nil {
		return "", err
}
	p := pkcs7Pad([]byte(value), block.BlockSize())
	out := make([]byte, len(p))
	ecbEncrypt(block, out, p)
	return base64.StdEncoding.EncodeToString(out), nil
}

func aesDecrypt(value, key string) (string, error) {
	k := sha256.Sum256([]byte(key))
	raw, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(k[:])
	if err != nil {
		return "", err
}
	out := make([]byte, len(raw))
	ecbDecrypt(block, out, raw)
	u, err := pkcs7Unpad(out, block.BlockSize())
	if err != nil {
		return "", err
	}
	return string(u), nil
}
