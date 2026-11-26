#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
javac -d "$tmp" services/api/src/main/java/com/socialtask/auth/WecomOAuthPolicy.java scripts/WecomOAuthPolicyOfflineTest.java
java -cp "$tmp" WecomOAuthPolicyOfflineTest
