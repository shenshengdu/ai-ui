package chat

import (
	"fmt"
	"strconv"
	"strings"
)

// Context budget: keeps long conversations from re-sending everything.
//
// Settings (per user, editable in Settings → General):
//
//	contextMaxTurns     Only the most recent N user turns (each user message
//	                    plus the replies/tool calls that followed it) are sent
//	                    to the model. "0" or empty = unlimited (default).
//	compactToolResults  "true" (default) shortens tool outputs from turns older
//	                    than the last recentToolTurns, and drops their inline
//	                    images/files. The most recent turns are sent in full.
const (
	recentToolTurns         = 2   // user turns whose tool results are kept verbatim
	compactToolOutputRunes  = 600 // characters kept from an old tool result
	compactToolOutputNotice = "\n…[older tool output truncated to save context]"
)

type contextBudget struct {
	maxTurns     int  // 0 = unlimited
	compactTools bool // shorten tool outputs of older turns
}

func loadContextBudget(user string) contextBudget {
	b := contextBudget{compactTools: true}
	if v, err := settings.Get("contextMaxTurns", user); err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil && n > 0 {
			b.maxTurns = n
		}
	}
	if v, err := settings.Get("compactToolResults", user); err == nil && strings.TrimSpace(v) == "false" {
		b.compactTools = false
	}
	return b
}

// trimPathToTurns takes a root→leaf list of message ids and the roles of those
// messages, and returns the suffix that starts at the maxTurns-th user message
// from the end. Cutting only at user messages keeps assistant/tool sequences
// intact. With maxTurns <= 0 the list is returned unchanged.
func trimPathToTurns(ordered []int, roleOf func(id int) string, maxTurns int) []int {
	if maxTurns <= 0 {
		return ordered
	}
	seen := 0
	for i := len(ordered) - 1; i >= 0; i-- {
		if roleOf(ordered[i]) == "user" {
			seen++
			if seen == maxTurns {
				return ordered[i:]
			}
		}
	}
	return ordered
}

// turnAgeFromEnd returns, for each position in ordered, how many user messages
// come after it. A user message and the replies that follow it share the same
// value; 0 means the latest turn.
func turnAgeFromEnd(ordered []int, roleOf func(id int) string) []int {
	ages := make([]int, len(ordered))
	users := 0
	for i := len(ordered) - 1; i >= 0; i-- {
		ages[i] = users
		if roleOf(ordered[i]) == "user" {
			users++
		}
	}
	return ages
}

// compactToolOutput shortens a long tool result, keeping the beginning.
func compactToolOutput(s string) string {
	r := []rune(s)
	if len(r) <= compactToolOutputRunes {
		return s
	}
	return string(r[:compactToolOutputRunes]) +
		fmt.Sprintf("%s (%d characters omitted)", compactToolOutputNotice, len(r)-compactToolOutputRunes)
}
