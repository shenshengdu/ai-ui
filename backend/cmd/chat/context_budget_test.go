package chat

import (
	"reflect"
	"strings"
	"testing"
)

func roles(m map[int]string) func(int) string {
	return func(id int) string { return m[id] }
}

// u1 a2 u3 a4 u5 a6 u7  (ids double as positions)
var budgetRoles = roles(map[int]string{
	1: "user", 2: "assistant", 3: "user", 4: "assistant",
	5: "user", 6: "assistant", 7: "user",
})
var budgetPath = []int{1, 2, 3, 4, 5, 6, 7}

func TestTrimPathToTurns(t *testing.T) {
	cases := []struct {
		max  int
		want []int
	}{
		{0, []int{1, 2, 3, 4, 5, 6, 7}},
		{1, []int{7}},
		{2, []int{5, 6, 7}},
		{3, []int{3, 4, 5, 6, 7}},
		{10, []int{1, 2, 3, 4, 5, 6, 7}},
	}
	for _, c := range cases {
		got := trimPathToTurns(budgetPath, budgetRoles, c.max)
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("max=%d: got %v, want %v", c.max, got, c.want)
		}
	}
}

func TestTurnAgeFromEnd(t *testing.T) {
	got := turnAgeFromEnd(budgetPath, budgetRoles)
	want := []int{3, 3, 2, 2, 1, 1, 0}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestCompactToolOutput(t *testing.T) {
	short := "hello"
	if compactToolOutput(short) != short {
		t.Fatal("short output must be unchanged")
	}
	long := strings.Repeat("字", compactToolOutputRunes+50)
	got := compactToolOutput(long)
	if !strings.HasPrefix(got, strings.Repeat("字", compactToolOutputRunes)) {
		t.Fatal("must keep the first runes")
	}
	if !strings.Contains(got, "50 characters omitted") {
		t.Fatalf("missing omitted count: %q", got[len(got)-80:])
	}
}
