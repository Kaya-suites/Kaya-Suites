#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/backend"
DEFAULT_CONFIG="$BACKEND_DIR/kaya.yaml"
CALLER_DIR="$(pwd)"

usage() {
  cat <<'EOF'
Generate embeddings for every document in the Kaya OSS database.

Usage:
  scripts/embed-all-documents.sh [--database-url URL] [--config PATH] [--inspect]

Options:
  --database-url URL  SQLite database URL. Falls back to DATABASE_URL.
  --config PATH       Path to kaya.yaml. Defaults to apps/backend/kaya.yaml.
  --inspect           Show embedding coverage before and after reindexing.
  -h, --help          Show this help text.

Notes:
  - This wrapper uses `cargo run -p kaya-oss --bin kaya-vec -- reindex`.
  - The underlying `kaya-vec` tool currently supports SQLite databases only.
  - You still need a valid embedding provider configured in kaya.yaml and the
    corresponding API credentials in your environment or .env file.
EOF
}

DATABASE_URL_VALUE="${DATABASE_URL:-}"
CONFIG_PATH="$DEFAULT_CONFIG"
INSPECT=0

make_abs_path() {
  local input="$1"
  local dir base

  if [[ "$input" = /* ]]; then
    printf '%s\n' "$input"
    return
  fi

  dir="$(dirname "$input")"
  base="$(basename "$input")"
  printf '%s/%s\n' "$(cd "$CALLER_DIR/$dir" && pwd)" "$base"
}

normalize_database_url() {
  local raw="$1"
  local prefix path

  if [[ "$raw" != sqlite:* ]]; then
    printf '%s\n' "$raw"
    return
  fi

  if [[ "$raw" == sqlite:///* ]]; then
    printf '%s\n' "$raw"
    return
  fi

  prefix="sqlite:///"
  path="${raw#sqlite://}"
  path="${path#sqlite:}"

  if [[ "$path" = /* ]]; then
    printf '%s%s\n' "$prefix" "$path"
    return
  fi

  printf '%s%s\n' "$prefix" "$(make_abs_path "$path")"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database-url)
      [[ $# -ge 2 ]] || { echo "missing value for --database-url" >&2; exit 1; }
      DATABASE_URL_VALUE="$2"
      shift 2
      ;;
    --config)
      [[ $# -ge 2 ]] || { echo "missing value for --config" >&2; exit 1; }
      CONFIG_PATH="$2"
      shift 2
      ;;
    --inspect)
      INSPECT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$DATABASE_URL_VALUE" ]]; then
  echo "DATABASE_URL is required. Pass --database-url or export DATABASE_URL." >&2
  exit 1
fi

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "config file not found: $CONFIG_PATH" >&2
  exit 1
fi

if [[ "$DATABASE_URL_VALUE" != sqlite:* ]]; then
  echo "Only SQLite DATABASE_URL values are supported by kaya-vec: $DATABASE_URL_VALUE" >&2
  exit 1
fi

DATABASE_URL_VALUE="$(normalize_database_url "$DATABASE_URL_VALUE")"

run_kaya_vec() {
  (
    cd "$BACKEND_DIR"
    DATABASE_URL="$DATABASE_URL_VALUE" \
    KAYA_CONFIG="$CONFIG_PATH" \
    cargo run -p kaya-oss --bin kaya-vec -- "$@"
  )
}

if [[ "$INSPECT" -eq 1 ]]; then
  echo "Inspecting embedding coverage before reindex..."
  run_kaya_vec inspect
fi

echo "Reindexing all documents..."
run_kaya_vec reindex

if [[ "$INSPECT" -eq 1 ]]; then
  echo
  echo "Inspecting embedding coverage after reindex..."
  run_kaya_vec inspect
fi
