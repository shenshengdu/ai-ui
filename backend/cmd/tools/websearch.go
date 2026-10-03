package tools

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Bajahaw/ai-ui/cmd/providers"
)

type searxSearchResponse struct {
	Query   string `json:"query"`
	Results []struct {
		URL     string `json:"url"`
		Title   string `json:"title"`
		Content string `json:"content"`
		Engine  string `json:"engine"`
	} `json:"results"`
}

func webSearchTool(args string) providers.ToolOutput {
	var params struct {
		Query string `json:"query"`
	}

	if err := json.Unmarshal([]byte(args), &params); err != nil {
		return providers.ToolOutput{
			Content: fmt.Sprintf("error decoding arguments: %v", err),
		}
	}

	params.Query = strings.TrimSpace(params.Query)
	if params.Query == "" {
		return providers.ToolOutput{
			Content: "error: query is required",
		}
	}

	searchURL := "http://127.0.0.1:8888/search?q=" +
		url.QueryEscape(params.Query) +
		"&format=json"

	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	req, err := http.NewRequest(http.MethodGet, searchURL, nil)
	if err != nil {
		return providers.ToolOutput{
			Content: fmt.Sprintf("error creating search request: %v", err),
		}
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "SSD-AI-WebSearch/1.0")
	req.Header.Set("X-Real-IP", "127.0.0.1")

	resp, err := client.Do(req)
	if err != nil {
		return providers.ToolOutput{
			Content: fmt.Sprintf("web search request failed: %v", err),
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return providers.ToolOutput{
			Content: fmt.Sprintf("web search returned HTTP %d", resp.StatusCode),
		}
	}

	var result searxSearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return providers.ToolOutput{
			Content: fmt.Sprintf("error decoding search response: %v", err),
		}
	}

	if len(result.Results) == 0 {
		return providers.ToolOutput{
			Content: fmt.Sprintf("No web search results found for: %s", params.Query),
		}
	}

	var out strings.Builder

	out.WriteString(fmt.Sprintf("Web search results for: %s\n\n", result.Query))

	maxResults := 8
	if len(result.Results) < maxResults {
		maxResults = len(result.Results)
	}

	for i := 0; i < maxResults; i++ {
		item := result.Results[i]

		title := strings.TrimSpace(item.Title)
		content := strings.TrimSpace(item.Content)
		resultURL := strings.TrimSpace(item.URL)

		out.WriteString(fmt.Sprintf("%d. %s\n", i+1, title))

		if resultURL != "" {
			out.WriteString(fmt.Sprintf("URL: %s\n", resultURL))
		}

		if content != "" {
			out.WriteString(fmt.Sprintf("Snippet: %s\n", content))
		}

		if item.Engine != "" {
			out.WriteString(fmt.Sprintf("Source: %s\n", item.Engine))
		}

		out.WriteString("\n")
	}

	return providers.ToolOutput{
		Content: out.String(),
	}
}
