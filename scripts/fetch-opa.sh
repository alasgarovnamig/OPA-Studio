#!/bin/sh
# Download an official OPA release binary and verify its checksum.
#
#   scripts/fetch-opa.sh <version> <os> <arch> <dest>
#   scripts/fetch-opa.sh v1.21.1 linux amd64 ./bin/opa
#
# The static build is preferred where it exists. Releases older than the
# .sha256 convention (2016-2021) are downloaded over HTTPS without a checksum.
set -eu

VERSION=${1:?version}
OS=${2:?os}
ARCH=${3:?arch}
DEST=${4:?destination}
BASE="https://github.com/open-policy-agent/opa/releases/download/${VERSION}"

case "$OS" in
  windows) CANDIDATES="opa_windows_${ARCH}.exe" ;;
  *) CANDIDATES="opa_${OS}_${ARCH}_static opa_${OS}_${ARCH}" ;;
esac

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$2" "$1"
  else
    wget -q -O "$2" "$1"
  fi
}

mkdir -p "$(dirname "$DEST")"
for asset in $CANDIDATES; do
  if fetch "$BASE/$asset" "$DEST.tmp" 2>/dev/null; then
    if fetch "$BASE/$asset.sha256" "$DEST.sha256" 2>/dev/null; then
      expected=$(awk '{print $1}' "$DEST.sha256")
      if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "$DEST.tmp" | awk '{print $1}')
      else
        actual=$(shasum -a 256 "$DEST.tmp" | awk '{print $1}')
      fi
      rm -f "$DEST.sha256"
      if [ "$expected" != "$actual" ]; then
        echo "checksum mismatch for $asset: expected $expected, got $actual" >&2
        rm -f "$DEST.tmp"
        exit 1
      fi
      echo "verified sha256 $actual" >&2
    fi
    mv "$DEST.tmp" "$DEST"
    chmod +x "$DEST"
    echo "downloaded $asset to $DEST" >&2
    exit 0
  fi
done
rm -f "$DEST.tmp"
echo "no OPA ${VERSION} binary for ${OS}/${ARCH} on GitHub; tags without a GitHub release (v0.13.1, v0.29.0, v0.46.0) are only published as openpolicyagent/opa Docker images" >&2
exit 1
