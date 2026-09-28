#!/bin/sh
# Fallback observer used when the Node CLI is unavailable.
# Prefer: `node /path/to/todash/dist/cli.js hook capture`
input=$(cat)
home="${TODASH_HOME:-$HOME/.todash}"
mkdir -p "$home/incoming"
stamp=$(date +%s)
file="$home/incoming/${stamp}-$$.json"
printf '%s' "$input" > "$file"
echo '{}'
exit 0
