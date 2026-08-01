#!/bin/bash
# Block edits to .env files, credentials, and lock files

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

case "$FILE_PATH" in
  *.env*|*credentials*|*secret*)
    echo "BLOCKED: Do not edit env/secret files directly"
    exit 2
    ;;
  *package-lock.json|*yarn.lock|*pnpm-lock.yaml)
    echo "BLOCKED: Do not edit lock files directly — run the package manager instead"
    exit 2
    ;;
esac

exit 0
