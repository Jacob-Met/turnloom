#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd)
exec "$ROOT/runtime/bin/node" "$ROOT/app/server.mjs" "$@"
