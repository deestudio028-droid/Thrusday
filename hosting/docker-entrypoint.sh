#!/bin/sh
set -eu
umask 077
mkdir -p "$THURSDAY_HOME"
chown node:node "$THURSDAY_HOME"
exec gosu node "$@"
