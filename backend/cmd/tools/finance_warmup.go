package tools

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"sync"
	"time"
)

// 自动预热:同一 symbol 在 TTL 内只预热一次(单飞),其余并发调用等待同一结果。
// 预热失败/超时只记日志,不阻断工具调用(平台侧通常仍会继续算完)。
// 环境变量:FINANCE_AUTO_WARMUP=0 关闭;FINANCE_WARMUP_TTL_MIN(默认 10)。

type financeWarmEntry struct {
	done    chan struct{}
	started time.Time
}

var (
	financeWarmMu sync.Mutex
	financeWarm   = map[string]*financeWarmEntry{}
)

func financeWarmTTL() time.Duration {
	if v, err := strconv.Atoi(os.Getenv("FINANCE_WARMUP_TTL_MIN")); err == nil && v > 0 {
		return time.Duration(v) * time.Minute
	}
	return 10 * time.Minute
}

func financeWarmReset(sym string) {
	financeWarmMu.Lock()
	delete(financeWarm, sym)
	financeWarmMu.Unlock()
}

// financeWarmEnsure 阻塞直到该 symbol 预热完成(最长 11 分钟,平台侧最多等 10 分钟),或 ctx 取消。
func financeWarmEnsure(ctx context.Context, base, key, sym string) {
	if os.Getenv("FINANCE_AUTO_WARMUP") == "0" {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	financeWarmMu.Lock()
	e, ok := financeWarm[sym]
	if !ok || time.Since(e.started) > financeWarmTTL() {
		e = &financeWarmEntry{done: make(chan struct{}), started: time.Now()}
		financeWarm[sym] = e
		go func() {
			defer close(e.done)
			wctx, cancel := context.WithTimeout(context.Background(), 11*time.Minute)
			defer cancel()
			req, err := http.NewRequestWithContext(wctx, http.MethodGet,
				base+"/api/v1/peer-warmup/"+url.PathEscape(sym)+"?wait=true", nil)
			if err != nil {
				log.Error("Finance warmup request build failed", "symbol", sym, "err", err)
				return
			}
			req.Header.Set("X-API-Key", key)
			req.Header.Set("Accept", "application/json")
			start := time.Now()
			resp, err := financeHTTPClient.Do(req)
			if err != nil {
				log.Error("Finance warmup failed", "symbol", sym, "err", err, "duration", time.Since(start))
				financeWarmReset(sym)
				return
			}
			defer resp.Body.Close()
			io.Copy(io.Discard, io.LimitReader(resp.Body, financeMaxBody))
			log.Info("Finance warmup", "symbol", sym, "status", resp.StatusCode, "duration", time.Since(start))
			if resp.StatusCode >= 400 && resp.StatusCode < 500 {
				financeWarmReset(sym)
			}
		}()
	}
	financeWarmMu.Unlock()
	select {
	case <-e.done:
	case <-ctx.Done():
	}
}
