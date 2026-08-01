#!/bin/bash
# Type-check after editing TypeScript files

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only run for .ts/.tsx files (not node_modules, not .d.ts)
if [[ "$FILE_PATH" == *.ts || "$FILE_PATH" == *.tsx ]] && [[ "$FILE_PATH" != *.d.ts ]] && [[ "$FILE_PATH" != *node_modules* ]]; then
  npx tsc --noEmit --pretty 2>&1 | head -30 || true
fi

exit 0
