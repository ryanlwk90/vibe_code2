#!/bin/bash
# Upload backend/test/fixtures product images (admin). Resizes to 200x200 with sips.

set -e

BASE="${BASE:-http://localhost:3001}"
FIXTURES="$(cd "$(dirname "$0")/../test/fixtures" && pwd)"
if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
  echo "Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment, then run again."
  exit 2
fi

JAR=$(mktemp)
UPLOAD_DIR=$(mktemp -d)
trap 'rm -f "$JAR"; rm -rf "$UPLOAD_DIR"' EXIT

payload=$(node -e 'console.log(JSON.stringify({ email: process.argv[1], password: process.argv[2] }))' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
CODE=$(curl -sS -w "%{http_code}" -o /dev/null -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" -d "$payload")
if [ "$CODE" != "200" ]; then
  echo "Login failed HTTP $CODE"
  exit 1
fi

PRODUCTS=$(curl -sS -b "$JAR" "$BASE/api/get_products")

upload_one() {
  local file="$1"
  local pname="$2"
  local mime="$3"
  local src="${FIXTURES}/${file}"
  if [ ! -f "$src" ]; then
    echo "Missing file: $src"
    exit 1
  fi
  local pid
  pid=$(node -e '
    const pname = process.argv[1];
    const products = JSON.parse(process.argv[2]);
    const row = products.find((p) => p.pname === pname);
    if (!row) process.exit(2);
    console.log(row.pid);
  ' "$pname" "$PRODUCTS")
  local out="${UPLOAD_DIR}/${pid}.bin"
  local mime_upload="$mime"
  if [ "$mime" = "image/webp" ]; then
    sips -z 200 200 -s format jpeg "$src" --out "$out" >/dev/null
    mime_upload="image/jpeg"
  else
    sips -z 200 200 "$src" --out "$out" >/dev/null
  fi
  CODE=$(curl -sS -w "%{http_code}" -o "${UPLOAD_DIR}/resp.json" -b "$JAR" \
    -X PUT "$BASE/api/products/${pid}/image" \
    -H "Content-Type: ${mime_upload}" \
    --data-binary @"$out")
  if [ "$CODE" != "200" ]; then
    echo "FAIL $pname (pid $pid) HTTP $CODE: $(cat "${UPLOAD_DIR}/resp.json")"
    exit 1
  fi
  local bytes
  bytes=$(wc -c < "$out" | tr -d ' ')
  echo "OK $pname (pid $pid) $mime_upload $bytes bytes"
}

upload_one "wireless mouse.jpeg" "Wireless Mouse" "image/jpeg"
upload_one "mechanical keybroad.jpeg" "Mechanical Keyboard" "image/jpeg"
upload_one "USB-C Hub.webp" "USB-C Hub" "image/webp"
upload_one "27 inch Monitor.jpeg" "27-inch Monitor" "image/jpeg"
upload_one "laptop_stand.jpeg" "Laptop Stand" "image/jpeg"

echo "All fixture images uploaded."
