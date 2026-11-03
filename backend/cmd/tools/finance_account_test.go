package tools

import "testing"

func TestFinanceAccountPath(t *testing.T) {
	cases := []struct {
		view, kind, symbol, from, to string
		limit                        int
		want                         string
	}{
		{"", "", "", "", "", 0, "/api/v1/ibkr/summary"},
		{"portfolio", "", "", "", "", 0, "/api/v1/ibkr/portfolio"},
		{"income", "", "", "2026-01-01", "", 0, "/api/v1/ibkr/income?from=2026-01-01"},
		{"transactions", "", "aapl", "", "", 0, "/api/v1/ibkr/transactions?kind=trades&limit=100&symbol=AAPL"},
		{"transactions", "cash", "", "2026-01-01", "2026-06-30", 20, "/api/v1/ibkr/transactions?from=2026-01-01&kind=cash&limit=20&to=2026-06-30"},
	}
	for _, c := range cases {
		got, err := financeAccountPath(c.view, c.kind, c.symbol, c.from, c.to, c.limit)
		if err != nil || got != c.want {
			t.Errorf("%+v: got %q, %v; want %q", c, got, err, c.want)
		}
	}
	for _, bad := range [][]string{{"nope", "", "", ""}, {"transactions", "evil", "", ""}, {"income", "", "2026/01/01", ""}, {"transactions", "", "", "A B"}} {
		if _, err := financeAccountPath(bad[0], bad[1], bad[3], bad[2], "", 0); err == nil {
			t.Errorf("expected error for %v", bad)
		}
	}
}
