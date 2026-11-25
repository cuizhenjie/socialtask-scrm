#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
classes=$(mktemp -d)
trap 'rm -rf "$classes"' EXIT
javac -d "$classes" scripts/CheckJavaSyntax.java
mapfile -d '' sources < <(find services/api/src/main/java services/api/src/test/java -type f -name '*.java' -print0)
java -cp "$classes" CheckJavaSyntax "${sources[@]}"
