package tools

import "testing"

func TestFinanceJudgementPath(t *testing.T) {
	cases := map[[3]string]string{
		{"adbe", "", ""}:              "/api/v1/judgement/ADBE",
		{"NOW", "levels", ""}:         "/api/v1/judgement/NOW/levels",
		{"NOW", "full", "2027-01-28"}: "/api/v1/judgement/NOW?earnings_date=2027-01-28",
	}
	for in, want := range cases {
		got, err := financeJudgementPath(in[0], in[1], in[2])
		if err != nil || got != want {
			t.Fatalf("%v: got %q %v, want %q", in, got, err, want)
		}
	}
	for _, in := range [][3]string{{"NOW", "x", ""}, {"NOW", "", "soon"}, {"", "", ""}} {
		if _, err := financeJudgementPath(in[0], in[1], in[2]); err == nil {
			t.Fatalf("%v: want error", in)
		}
	}
}
