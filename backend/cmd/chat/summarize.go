package chat

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/Bajahaw/ai-ui/cmd/providers"
	"github.com/Bajahaw/ai-ui/cmd/utils"
)

// POST /api/chat/summarize
//
// Compresses the active branch of a conversation into a short summary that the
// user can carry into a new chat ("compress & start new chat"). Nothing is
// written to the conversation; the summary is only returned.

type SummarizeRequest struct {
	ConversationID string `json:"conversationId"`
	// LeafMessageID is the last message of the branch to summarize.
	LeafMessageID int    `json:"leafMessageId"`
	Model         string `json:"model"`
}

type SummarizeResponse struct {
	Summary string `json:"summary"`
	Turns   int    `json:"turns"`
}

const (
	summaryToolOutputRunes = 300     // per tool result, in the transcript
	summaryTranscriptRunes = 120_000 // transcript cap; the newest part is kept
)

const summarizeInstruction = `You compress a chat history so the user can continue it in a NEW conversation without losing important context.

Rules:
- Write in the same language the user mostly used in the conversation.
- Keep concrete details: names, numbers, versions, file paths, commands, code identifiers, URLs, decisions and the user's stated preferences.
- Drop greetings, repetition, abandoned ideas and long code bodies (mention what the code does and where it lives instead).
- Use these sections as short bullet lists (omit a section if empty), translated into the conversation's language:
  1. Background & goal
  2. Key facts and conclusions
  3. Decisions and preferences
  4. Open items / next steps
- Aim for under 400 words. Output only the summary, no preamble.`

func summarizeConversation(w http.ResponseWriter, r *http.Request) {
	user := utils.ExtractContextUser(r)
	var req SummarizeRequest
	if err := utils.ExtractJSONBody(r, &req); err != nil ||
		req.ConversationID == "" || req.LeafMessageID <= 0 || req.Model == "" {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if _, err := conversations.GetByID(req.ConversationID, user); err != nil {
		http.Error(w, "Conversation not found", http.StatusNotFound)
		return
	}

	transcript, turns := buildSummaryTranscript(
		getAllConversationMessages(req.ConversationID, user),
		req.LeafMessageID,
	)
	if strings.TrimSpace(transcript) == "" {
		http.Error(w, "Nothing to summarize", http.StatusBadRequest)
		return
	}

	resp, err := provider.SendChatCompletionRequest(providers.RequestParams{
		Messages: []providers.SimpleMessage{
			{Role: "system", Content: summarizeInstruction},
			{Role: "user", Content: "<conversation>\n" + transcript + "\n</conversation>"},
		},
		Model: req.Model,
		User:  user,
	})
	if err != nil {
		log.Error("Error summarizing conversation", "err", err)
		http.Error(w, fmt.Sprintf("Summarize failed: %v", err), http.StatusBadGateway)
		return
	}
	summary := strings.TrimSpace(resp.Content)
	if summary == "" {
		http.Error(w, "Summarize failed: empty response", http.StatusBadGateway)
		return
	}

	utils.RespondWithJSON(w, SummarizeResponse{Summary: summary, Turns: turns}, http.StatusOK)
}

// buildSummaryTranscript renders the branch ending at leafID as plain text
// (oldest first) and returns it with the number of user turns.
func buildSummaryTranscript(msgs map[int]*Message, leafID int) (string, int) {
	var path []*Message
	seen := map[int]bool{}
	for id := leafID; id != 0 && !seen[id]; {
		m, ok := msgs[id]
		if !ok {
			break
		}
		seen[id] = true
		path = append(path, m)
		id = m.ParentID
	}

	var sb strings.Builder
	turns := 0
	for i := len(path) - 1; i >= 0; i-- {
		m := path[i]
		if m.Error != "" && strings.TrimSpace(m.Content) == "" {
			continue
		}
		switch m.Role {
		case "user":
			turns++
			sb.WriteString("[User]\n")
		case "assistant":
			sb.WriteString("[Assistant]\n")
		default:
			continue
		}
		if c := strings.TrimSpace(m.Content); c != "" {
			sb.WriteString(c)
			sb.WriteString("\n")
		}
		for _, a := range m.Attachments {
			if a.File.Name != "" {
				sb.WriteString("(attached file: ")
				sb.WriteString(a.File.Name)
				sb.WriteString(")\n")
			}
		}
		for _, t := range m.Tools {
			if t == nil {
				continue
			}
			sb.WriteString("(tool ")
			sb.WriteString(t.Name)
			sb.WriteString(": ")
			sb.WriteString(truncateForSummary(strings.TrimSpace(t.Output), summaryToolOutputRunes))
			sb.WriteString(")\n")
		}
		sb.WriteString("\n")
	}

	text := sb.String()
	if r := []rune(text); len(r) > summaryTranscriptRunes {
		text = "…[earliest part omitted]\n" + string(r[len(r)-summaryTranscriptRunes:])
	}
	return text, turns
}

func truncateForSummary(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
