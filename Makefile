# OPA Studio — build, test and release helpers.
#
# Every Studio release targets exactly one OPA release, recorded in OPA_VERSION.

OPA_VERSION ?= $(shell cat OPA_VERSION)
VERSION     ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT      ?= $(shell git rev-parse HEAD 2>/dev/null || echo unknown)
DATE        ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
GOOS        ?= $(shell go env GOOS)
GOARCH      ?= $(shell go env GOARCH)
IMAGE       ?= ghcr.io/alasgarovnamig/opa-studio
PKG         := github.com/alasgarovnamig/opa-studio/internal/buildinfo
LDFLAGS     := -s -w -X $(PKG).Version=$(VERSION) -X $(PKG).OPAVersion=$(OPA_VERSION) -X $(PKG).Commit=$(COMMIT) -X $(PKG).Date=$(DATE)

.PHONY: all
all: ui build

.PHONY: ui
ui: ## Build the web UI into web/dist
	cd web && npm ci --no-audit --no-fund && npm run build

.PHONY: build
build: ## Build bin/opa-studio (embeds web/dist)
	CGO_ENABLED=0 GOOS=$(GOOS) GOARCH=$(GOARCH) go build -trimpath -ldflags "$(LDFLAGS)" -o bin/opa-studio ./cmd/opa-studio

.PHONY: opa
opa: ## Download the targeted OPA release to bin/opa
	scripts/fetch-opa.sh $(OPA_VERSION) $(GOOS) $(GOARCH) bin/opa

.PHONY: run
run: build opa ## Run Studio with the targeted OPA release
	OPA_STUDIO_OPA_BINARY=bin/opa OPA_STUDIO_DATA_DIR=data ./bin/opa-studio

.PHONY: dev
dev: ## Run the UI dev server (proxying to a running backend on :9080)
	cd web && npm run dev

.PHONY: test
test: ## Unit tests (Go + UI type check + UI unit tests)
	go vet ./...
	go test -race ./...
	cd web && npm run typecheck && npm test

.PHONY: test-integration
test-integration: opa ## Integration tests against the targeted OPA binary
	OPA_BIN=$(CURDIR)/bin/opa go test -v ./test/...

.PHONY: docker
docker: ## Build the container image for the targeted OPA release
	docker build --build-arg OPA_VERSION=$(OPA_VERSION) --build-arg VERSION=$(VERSION) \
	  --build-arg COMMIT=$(COMMIT) --build-arg DATE=$(DATE) -t $(IMAGE):$(OPA_VERSION) .

.PHONY: versions
versions: ## Refresh versions/opa-versions.json from GitHub
	python3 tools/introspect/list_versions.py versions/opa-versions.json

.PHONY: manifests
manifests: ## Introspect every OPA release (needs Docker; ~1h on first run)
	python3 tools/introspect/run_all.py --versions versions/opa-versions.json --cache .cache/opa --out versions/manifests

.PHONY: validate-templates
validate-templates: ## Prove the example workspace works on every OPA release
	python3 tools/introspect/validate_all.py --cache .cache/opa --out .cache/template-validation.json

.PHONY: clean
clean:
	rm -rf bin dist data web/node_modules
	find web/dist -mindepth 1 ! -name .gitkeep -delete

.PHONY: help
help:
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'
