#!/bin/bash
set -eu
ROOT=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd -P)
exec "$ROOT/runtime/bin/node" "$ROOT/app/server.mjs" "$@"
