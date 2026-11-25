#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
javac -d "$OUT" "$ROOT/services/api/src/main/java/com/socialtask/common/Rules.java" "$ROOT/services/api/src/test/java/com/socialtask/rules/RulesOfflineTest.java"
java -ea -cp "$OUT" com.socialtask.rules.RulesOfflineTest
