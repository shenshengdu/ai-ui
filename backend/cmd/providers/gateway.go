package providers

import (
	"context"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// isGatewayBaseURL reports whether the provider is the local free-model gateway
// (same hosts as STREAM_RETRY_HOSTS, default 127.0.0.1:4000 / localhost:4000).
func isGatewayBaseURL(baseURL string) bool {
	b := strings.ToLower(baseURL)
	for _, h := range streamRetryHosts() {
		if strings.Contains(b, h) {
			return true
		}
	}
	return false
}

// streamIdleTimeout: max silence between stream chunks before we give up on a
// gateway stream (env STREAM_IDLE_TIMEOUT seconds, default 120).
func streamIdleTimeout() time.Duration {
	if n, err := strconv.Atoi(strings.TrimSpace(os.Getenv("STREAM_IDLE_TIMEOUT"))); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	return 120 * time.Second
}

// idleWatchdog cancels a context when no Touch() happens within the timeout.
// All methods are nil-safe so callers can use it conditionally.
type idleWatchdog struct {
	timer  *time.Timer
	d      time.Duration
	fired  atomic.Bool
	once   sync.Once
	cancel context.CancelFunc
}

func newIdleWatchdog(parent context.Context, d time.Duration) (context.Context, *idleWatchdog) {
	ctx, cancel := context.WithCancel(parent)
	w := &idleWatchdog{d: d, cancel: cancel}
	w.timer = time.AfterFunc(d, func() {
		w.fired.Store(true)
		cancel()
	})
	return ctx, w
}

func (w *idleWatchdog) Touch() {
	if w != nil && !w.fired.Load() {
		w.timer.Reset(w.d)
	}
}

func (w *idleWatchdog) Fired() bool { return w != nil && w.fired.Load() }

func (w *idleWatchdog) Stop() {
	if w == nil {
		return
	}
	w.once.Do(func() {
		w.timer.Stop()
		w.cancel()
	})
}
