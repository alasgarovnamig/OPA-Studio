package api

import (
	"errors"
	"net/http"
	"os"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/localopa"
	"github.com/alasgarovnamig/opa-studio/internal/opacli"
)

var errNoLocal = errors.New("the managed local OPA server is disabled (OPA_STUDIO_LOCAL_OPA=false)")

// ---- local OPA -------------------------------------------------------------

func (a *API) localState(w http.ResponseWriter, r *http.Request) {
	if a.LocalOPA == nil {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	args, argErr := a.LocalOPA.Args()
	resp := map[string]any{
		"enabled":  true,
		"state":    a.LocalOPA.State(),
		"settings": a.LocalOPA.Settings(),
		"preview":  append([]string{"opa"}, args...),
	}
	if argErr != nil {
		resp["previewError"] = argErr.Error()
	}
	writeJSON(w, http.StatusOK, resp)
}

func (a *API) localSettings(w http.ResponseWriter, r *http.Request) {
	if a.LocalOPA == nil {
		writeError(w, http.StatusNotFound, errNoLocal)
		return
	}
	if a.Cfg.ReadOnly {
		writeError(w, http.StatusForbidden, errReadOnly)
		return
	}
	var s localopa.Settings
	if !a.decode(w, r, &s) {
		return
	}
	if s.Workspace != "" {
		if _, err := a.Workspaces.Dir(s.Workspace); err != nil {
			fail(w, err)
			return
		}
	}
	if err := a.LocalOPA.SetSettings(s); err != nil {
		fail(w, err)
		return
	}
	a.localState(w, r)
}

func (a *API) localAction(w http.ResponseWriter, r *http.Request) {
	if a.LocalOPA == nil {
		writeError(w, http.StatusNotFound, errNoLocal)
		return
	}
	if a.Cfg.ReadOnly {
		writeError(w, http.StatusForbidden, errReadOnly)
		return
	}
	var err error
	switch r.PathValue("action") {
	case "start":
		err = a.LocalOPA.Start()
	case "stop":
		err = a.LocalOPA.Stop()
	case "restart":
		err = a.LocalOPA.Restart()
	default:
		writeError(w, http.StatusNotFound, errors.New("unknown action"))
		return
	}
	if err != nil {
		fail(w, err)
		return
	}
	// Give the process a moment so the UI shows a meaningful state.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && a.LocalOPA.State().Status == "starting" {
		time.Sleep(100 * time.Millisecond)
	}
	a.localState(w, r)
}

func (a *API) localLogs(w http.ResponseWriter, r *http.Request) {
	if a.LocalOPA == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, a.LocalOPA.Logs(int64(queryInt(r, "after", 0))))
}

func (a *API) localClearLogs(w http.ResponseWriter, r *http.Request) {
	if a.LocalOPA != nil {
		a.LocalOPA.ClearLogs()
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) localLogStream(w http.ResponseWriter, r *http.Request) {
	if a.LocalOPA == nil {
		writeError(w, http.StatusNotFound, errNoLocal)
		return
	}
	f, ok := sse(w)
	if !ok {
		return
	}
	ch, cancel := a.LocalOPA.Subscribe()
	defer cancel()
	for _, l := range a.LocalOPA.Logs(int64(queryInt(r, "after", 0))) {
		if sseSend(w, f, l) != nil {
			return
		}
	}
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case l := <-ch:
			if sseSend(w, f, l) != nil {
				return
			}
		case <-ping.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			f.Flush()
		}
	}
}

// ---- REPL ------------------------------------------------------------------

func (a *API) replList(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.REPL.List())
}

type replStartRequest struct {
	Workspace string   `json:"workspace"`
	Args      []string `json:"args"`
	Files     map[string]string
}

func (a *API) replStart(w http.ResponseWriter, r *http.Request) {
	var req replStartRequest
	if !a.decode(w, r, &req) {
		return
	}
	// The REPL runs `opa run [flags] [files]`; flags are validated like any CLI call.
	if err := a.CLI.ValidateFlags(req.Args); err != nil {
		fail(w, err)
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
	dir, err := a.CLI.Prepare(&opacli.Request{Files: req.Files}, src)
	if err != nil {
		fail(w, err)
		return
	}
	args := req.Args
	if src != "" || len(req.Files) > 0 {
		load, err := localopa.LoadArgs(dir, a.Manifest == nil || a.Manifest.HasFlag("run", "ignore"))
		if err != nil {
			os.RemoveAll(dir)
			fail(w, err)
			return
		}
		args = append(append([]string{}, args...), load...)
	}
	s, err := a.REPL.Start(dir, req.Workspace, args)
	if err != nil {
		os.RemoveAll(dir)
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, s)
}

func (a *API) replInput(w http.ResponseWriter, r *http.Request) {
	s, ok := a.REPL.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("session not found"))
		return
	}
	var req struct {
		Line string `json:"line"`
	}
	if !a.decode(w, r, &req) {
		return
	}
	if err := s.Input(req.Line); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) replEvents(w http.ResponseWriter, r *http.Request) {
	s, ok := a.REPL.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("session not found"))
		return
	}
	writeJSON(w, http.StatusOK, s.Events(int64(queryInt(r, "after", 0))))
}

func (a *API) replStream(w http.ResponseWriter, r *http.Request) {
	s, ok := a.REPL.Get(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("session not found"))
		return
	}
	f, ok := sse(w)
	if !ok {
		return
	}
	ch, cancel := s.Subscribe()
	defer cancel()
	for _, e := range s.Events(int64(queryInt(r, "after", 0))) {
		if sseSend(w, f, e) != nil {
			return
		}
	}
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case e := <-ch:
			if sseSend(w, f, e) != nil {
				return
			}
		case <-ping.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			f.Flush()
		}
	}
}

func (a *API) replClose(w http.ResponseWriter, r *http.Request) {
	if err := a.REPL.Close(r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
