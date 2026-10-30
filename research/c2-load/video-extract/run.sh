#!/bin/bash
# Runs the P8 video extractor inside WSL (see README.md).
#
#   research/c2-load/video-extract/run.sh test        # unit tests
#   research/c2-load/video-extract/run.sh typecheck   # tsc over the extractor and the app files it uses
#   research/c2-load/video-extract/run.sh [extractor options]
#
# The repo is the source of truth. This script mirrors the extractor and the
# app files it reuses into a Linux work folder (default ~/c2-video-extract),
# with the same relative layout, and installs node_modules there: tfjs-node's
# native TensorFlow is several hundred MB and must not land in OneDrive.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
WORK="${C2_VIDEO_WORK:-$HOME/c2-video-extract}"
# Node 22 LTS, not 24: tfjs-node 4.22.0 calls util.isNullOrUndefined, which
# Node 23 removed ("util_1.isNullOrUndefined is not a function", 30 Oct 2026).
export PATH="$HOME/.local/node22/bin:$PATH"

mkdir -p "$WORK/research/c2-load/video-extract" "$WORK/packages/load-sensor/scripts" \
  "$WORK/packages/load-sensor/src" "$WORK/packages/load-sensor/public/models"
rsync -a --delete "$HERE/src/" "$WORK/research/c2-load/video-extract/src/"
rsync -a --delete "$HERE/test/" "$WORK/research/c2-load/video-extract/test/"
rsync -a --delete "$REPO/packages/load-sensor/src/core/" "$WORK/packages/load-sensor/src/core/"
cp "$REPO/packages/load-sensor/scripts/extract-landmarks-lib.ts" "$WORK/packages/load-sensor/scripts/"
rsync -a --delete "$REPO/packages/load-sensor/public/models/facemesh/" \
  "$WORK/packages/load-sensor/public/models/facemesh/"
# -p keeps the source timestamps, so package.json only looks newer than the
# install stamp when it really changed (plain cp reinstalled on every run).
cp -p "$HERE/package.json" "$HERE/tsconfig.wsl.json" "$WORK/"

cd "$WORK"
if [ ! -f node_modules/.install-stamp ] || [ package.json -nt node_modules/.install-stamp ]; then
  if [ -f "$HERE/package-lock.json" ]; then
    cp -p "$HERE/package-lock.json" .
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
    cp package-lock.json "$HERE/"
  fi
  touch node_modules/.install-stamp
fi

case "${1:-}" in
  test)
    shift
    exec node --import tsx --test research/c2-load/video-extract/test/*.test.ts
    ;;
  typecheck)
    exec npx tsc -p tsconfig.wsl.json
    ;;
  *)
    exec node --import tsx research/c2-load/video-extract/src/extract-video.ts "$@"
    ;;
esac
