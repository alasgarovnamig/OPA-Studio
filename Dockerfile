# syntax=docker/dockerfile:1.7
#
# OPA Studio image: the Studio server plus the OPA release it targets.
#
#   docker build --build-arg OPA_VERSION=$(cat OPA_VERSION) -t opa-studio .
#
# For OPA tags that were only published as Docker images (v0.13.1, v0.29.0,
# v0.46.0) add --build-arg OPA_IMAGE=openpolicyagent/opa:<version without v>.

ARG OPA_VERSION=v0.53.0
ARG OPA_IMAGE=busybox:1.36.1

FROM --platform=$BUILDPLATFORM node:20.18.1-bookworm-slim AS ui
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.23-bookworm AS build
ARG TARGETOS
ARG TARGETARCH
ARG OPA_VERSION
ARG VERSION=dev
ARG COMMIT=unknown
ARG DATE=unknown
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=ui /src/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath \
      -ldflags "-s -w \
        -X github.com/alasgarovnamig/opa-studio/internal/buildinfo.Version=${VERSION} \
        -X github.com/alasgarovnamig/opa-studio/internal/buildinfo.OPAVersion=${OPA_VERSION} \
        -X github.com/alasgarovnamig/opa-studio/internal/buildinfo.Commit=${COMMIT} \
        -X github.com/alasgarovnamig/opa-studio/internal/buildinfo.Date=${DATE}" \
      -o /out/opa-studio ./cmd/opa-studio

FROM ${OPA_IMAGE} AS opaimage

FROM --platform=$BUILDPLATFORM debian:bookworm-slim AS opa
ARG OPA_VERSION
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
COPY scripts/fetch-opa.sh /usr/local/bin/fetch-opa.sh
COPY --from=opaimage / /opaimage/
RUN if [ -f /opaimage/opa ]; then cp /opaimage/opa /opa && chmod +x /opa; \
    else fetch-opa.sh "$OPA_VERSION" linux "$TARGETARCH" /opa; fi \
 && test -s /opa

FROM debian:bookworm-slim
ARG OPA_VERSION
ARG VERSION=dev
LABEL org.opencontainers.image.title="OPA Studio" \
      org.opencontainers.image.description="Web UI covering every Open Policy Agent operation" \
      org.opencontainers.image.source="https://github.com/alasgarovnamig/OPA-Studio" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      io.openpolicyagent.version="${OPA_VERSION}"
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 studio \
 && useradd -u 10001 -g studio -d /var/lib/opa-studio -s /usr/sbin/nologin studio \
 && mkdir -p /var/lib/opa-studio && chown studio:studio /var/lib/opa-studio
COPY --from=opa /opa /usr/local/bin/opa
COPY --from=build /out/opa-studio /usr/local/bin/opa-studio
ENV OPA_STUDIO_ADDR=:9080 \
    OPA_STUDIO_DATA_DIR=/var/lib/opa-studio \
    OPA_STUDIO_OPA_BINARY=/usr/local/bin/opa \
    OPA_STUDIO_LOCAL_OPA_ADDR=127.0.0.1:8181 \
    OPA_STUDIO_LOG_FORMAT=json
USER 10001:10001
WORKDIR /var/lib/opa-studio
VOLUME ["/var/lib/opa-studio"]
EXPOSE 9080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["opa-studio", "healthcheck"]
ENTRYPOINT ["/usr/bin/tini", "--", "opa-studio"]
