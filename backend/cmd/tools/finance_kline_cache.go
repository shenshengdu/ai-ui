package tools

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

// K 线结果缓存：日线一天只变一次，同一只、同一范围 10 分钟内直接给（切换回来、刷新、对话里反复画都快）。
// 存好 JSON 和 gzip 两份，浏览器要压缩就给压缩的（全部历史几百 KB → 几十 KB）。
const klineCacheTTL = 10 * time.Minute
const klineCacheMax = 128

type klineCached struct {
	body, gz []byte
	at       time.Time
	ttl      time.Duration // 0 = klineCacheTTL
}

var (
	klineCacheMu sync.Mutex
	klineCache   = map[string]klineCached{}
)

func klineCacheGet(key string) (klineCached, bool) {
	klineCacheMu.Lock()
	defer klineCacheMu.Unlock()
	c, ok := klineCache[key]
	ttl := c.ttl
	if ttl == 0 {
		ttl = klineCacheTTL
	}
	if !ok || time.Since(c.at) > ttl {
		return klineCached{}, false
	}
	return c, true
}

func klineCachePut(key string, c klineCached) {
	klineCacheMu.Lock()
	defer klineCacheMu.Unlock()
	if len(klineCache) >= klineCacheMax {
		oldK, oldT := "", time.Now()
		for k, v := range klineCache {
			if v.at.Before(oldT) {
				oldK, oldT = k, v.at
			}
		}
		delete(klineCache, oldK)
	}
	klineCache[key] = c
}

func klineEncode(v klineResp) klineCached {
	body, _ := json.Marshal(v)
	return gzipCached(body)
}

// gzipCached 存 JSON 原文和 gzip 两份
func gzipCached(body []byte) klineCached {
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
	_, _ = zw.Write(body)
	_ = zw.Close()
	return klineCached{body: body, gz: buf.Bytes(), at: time.Now()}
}

func klineWrite(w http.ResponseWriter, r *http.Request, c klineCached, hit bool) {
	w.Header().Set("Content-Type", "application/json")
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "private, max-age=300")
	}
	w.Header().Set("Vary", "Accept-Encoding")
	if hit {
		w.Header().Set("X-Kline-Cache", "hit")
	}
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") && len(c.gz) > 0 && len(c.body) > 1024 {
		w.Header().Set("Content-Encoding", "gzip")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(c.gz)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(c.body)
}
