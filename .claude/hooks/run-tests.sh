#!/bin/bash
# Run tests for modified screen/component files

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only run tests for src/screens/*.tsx or src/components/*.tsx files (not test files)
if [[ "$FILE_PATH" == src/screens/*.tsx || "$FILE_PATH" == src/components/*.tsx ]] && [[ "$FILE_PATH" != *test.tsx ]]; then
  TEST_NAME=$(basename "$FILE_PATH" .tsx)
  npm test -- "${TEST_NAME}.test.tsx" 2>&1 || true
fi

exit 0
