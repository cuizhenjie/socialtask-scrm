#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
javac -encoding UTF-8 -d "$out" services/api/src/main/java/com/socialtask/sla/SlaClock.java \
  services/api/src/main/java/com/socialtask/wecom/WecomCrypto.java \
  services/api/src/test/java/com/socialtask/FeatureOfflineTest.java
java -ea -cp "$out" com.socialtask.FeatureOfflineTest
