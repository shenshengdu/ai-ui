package version

import (
	"encoding/json"
	"net/http"
)

var AppVersion = "1.0.0"
var BuildID = ""

type VersionResponse struct {
	Version string `json:"version"`
	Build   string `json:"build"`
}

func HandleGetVersion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(VersionResponse{Version: AppVersion, Build: BuildID})
}
