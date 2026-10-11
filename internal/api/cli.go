package api

import (
	"net/http"

	"github.com/alasgarovnamig/opa-studio/internal/opacli"
)

func (a *API) cliCommands(w http.ResponseWriter, r *http.Request) {
	if a.Manifest == nil {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	writeJSON(w, http.StatusOK, a.Manifest.CLI.Commands)
}

type cliRunRequest struct {
	opacli.Request
	// Workspace copies the workspace files into the working directory first.
	Workspace string `json:"workspace,omitempty"`
	// WriteBack saves files modified by the command (e.g. `opa fmt -w`) back
	// into the workspace.
	WriteBack bool `json:"writeBack,omitempty"`
}

// cliRun executes one OPA CLI command. Together with the command builder in
// the UI this exposes every command and flag of the bundled OPA version.
func (a *API) cliRun(w http.ResponseWriter, r *http.Request) {
	var req cliRunRequest
	if !a.decode(w, r, &req) {
		return
	}
	src := ""
	if req.Workspace != "" {
		d, err := a.Workspaces.Dir(req.Workspace)
		if err != nil {
			fail(w, err)
			return
		}
		src = d
	}
	if req.WriteBack && a.Cfg.ReadOnly {
		writeError(w, http.StatusForbidden, errReadOnly)
		return
	}
	res, err := a.CLI.Run(r.Context(), &req.Request, src)
	if err != nil {
		fail(w, err)
		return
	}
	if req.WriteBack && req.Workspace != "" {
		for name, content := range res.Changed {
			if err := a.Workspaces.WriteFile(req.Workspace, name, []byte(content)); err != nil {
				fail(w, err)
				return
			}
		}
	}
	writeJSON(w, http.StatusOK, res)
}
