#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"

  # Home Assistant writes /data/options.json as root with mode 0600. Make the
  # whole persistent directory writable before dropping to the node user.
  chown -R node:node "$DATA_DIR"

  exec gosu node "$@"
fi

exec "$@"
