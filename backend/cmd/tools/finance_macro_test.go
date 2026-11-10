package tools

import (
	"encoding/json"
	"testing"
)

func TestFinanceMacroTool(t *testing.T) {
	if !isFinanceTool("finance_macro") {
		t.Fatal("finance_macro should be a finance tool")
	}
	var found *Tool
	for _, tl := range financeBuiltInTools() {
		if tl.Name == "finance_macro" {
			found = tl
		}
	}
	if found == nil {
		t.Fatal("finance_macro not in built-in tools")
	}
	var schema map[string]any
	if err := json.Unmarshal([]byte(found.InputSchema), &schema); err != nil {
		t.Fatalf("bad schema: %v", err)
	}
}
