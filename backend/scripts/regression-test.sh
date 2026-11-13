#!/bin/bash
# Bash 3.2 compatible API regression tests (curl + node only).

BASE="${BASE:-http://localhost:3001}"
PASS=0
FAIL=0
CODE=""
BODY=""
TEMP_READER_ID=""
TEMP_PRODUCT_ID=""
INITIAL_PRODUCT_COUNT=""
INITIAL_ACCOUNT_COUNT=""
ADMIN_JAR=""
READER_JAR=""
RESPONSE_FILE=""

if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
  echo "Set ADMIN_EMAIL and ADMIN_PASSWORD in the environment, then run this script again."
  exit 2
fi

pass() {
  PASS=$((PASS + 1))
  echo "PASS: $1"
}

fail() {
  FAIL=$((FAIL + 1))
  echo "FAIL: $1"
  echo "  HTTP $CODE"
  if [ -n "$BODY" ]; then
    echo "  Response: $BODY"
  fi
}

check() {
  local name="$1"
  local expected="$2"
  local needle="${3:-}"
  if [ "$CODE" != "$expected" ]; then
    fail "$name (expected HTTP $expected, got $CODE)"
    return
  fi
  if [ -n "$needle" ]; then
    case "$BODY" in
      *"$needle"*) ;;
      *)
        fail "$name (body missing: $needle)"
        return
        ;;
    esac
  fi
  pass "$name"
}

req() {
  local method="$1"
  local path="$2"
  local json_body="$3"
  local jar="$4"
  local url="${BASE}${path}"
  local curl_args=( -sS -w "%{http_code}" -o "$RESPONSE_FILE" -X "$method" "$url" )

  if [ -n "$jar" ]; then
    curl_args+=( -b "$jar" -c "$jar" )
  fi

  if [ -n "$json_body" ]; then
    curl_args+=( -H "Content-Type: application/json" -d "$json_body" )
  fi

  CODE=$(curl "${curl_args[@]}")
  BODY=$(cat "$RESPONSE_FILE")
}

login() {
  local email="$1"
  local password="$2"
  local jar="$3"
  local payload
  payload=$(node -e 'console.log(JSON.stringify({ email: process.argv[1], password: process.argv[2] }))' "$email" "$password")
  req POST "/api/auth/login" "$payload" "$jar"
}

admin_session() {
  login "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$ADMIN_JAR"
}

cleanup() {
  if [ -z "$ADMIN_JAR" ] || [ -z "$RESPONSE_FILE" ]; then
    return
  fi
  admin_session >/dev/null 2>&1 || true
  if [ "$CODE" = "200" ] || [ "$CODE" = "204" ]; then
    if [ -n "$TEMP_READER_ID" ]; then
      req DELETE "/api/admin/accounts/${TEMP_READER_ID}" "" "$ADMIN_JAR"
    fi
    if [ -n "$TEMP_PRODUCT_ID" ]; then
      req DELETE "/api/delete_product/${TEMP_PRODUCT_ID}" "" "$ADMIN_JAR"
    fi
  fi
}

on_exit() {
  cleanup
  rm -f "$ADMIN_JAR" "$READER_JAR" "$RESPONSE_FILE"
  echo "Result: ${PASS} passed, ${FAIL} failed"
  if [ "$FAIL" -gt 0 ]; then
    exit 1
  fi
}

ADMIN_JAR=$(mktemp)
READER_JAR=$(mktemp)
RESPONSE_FILE=$(mktemp)
trap on_exit EXIT

echo "Regression tests against ${BASE}"

# Anonymous access
req GET "/api/health" "" ""
check "anonymous GET /api/health" 200

req GET "/api/get_products" "" ""
check "anonymous GET get_products" 401

req GET "/api/get_users" "" ""
check "anonymous GET get_users" 401

req GET "/api/get_orders" "" ""
check "anonymous GET get_orders" 401

req GET "/api/admin/accounts" "" ""
check "anonymous GET admin/accounts" 401

req POST "/api/add_product" '{"pname":"x","description":"","price":1,"qty":1}' ""
check "anonymous POST add_product" 401

req PUT "/api/update_product/1" '{"pname":"x","description":"","price":1,"qty":1}' ""
check "anonymous PUT update_product/1" 401

req DELETE "/api/delete_product/1" "" ""
check "anonymous DELETE delete_product/1" 401

# Failed logins (at most 3 in this script: unknown email + wrong password)
payload_unknown=$(node -e 'console.log(JSON.stringify({ email: "nobody-unknown@example.test", password: "wrong-password-value" }))')
req POST "/api/auth/login" "$payload_unknown" "$ADMIN_JAR"
check "login unknown email" 401 "Invalid email or password"

payload_wrong_pass=$(node -e 'console.log(JSON.stringify({ email: process.argv[1], password: "definitely-wrong-password" }))' "$ADMIN_EMAIL")
req POST "/api/auth/login" "$payload_wrong_pass" "$ADMIN_JAR"
check "login wrong password" 401 "Invalid email or password"

login "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$ADMIN_JAR"
check "admin login" 200

req GET "/api/auth/me" "" "$ADMIN_JAR"
check "admin GET /api/auth/me" 200 "admin"

ADMIN_ID=$(node -e 'const b=JSON.parse(process.argv[1]); console.log(b.account.account_id);' "$BODY")

req GET "/api/get_products" "" "$ADMIN_JAR"
check "admin GET get_products" 200
INITIAL_PRODUCT_COUNT=$(node -e 'console.log(JSON.parse(process.argv[1]).length)' "$BODY")

req GET "/api/admin/accounts" "" "$ADMIN_JAR"
check "admin GET admin/accounts" 200
INITIAL_ACCOUNT_COUNT=$(node -e 'console.log(JSON.parse(process.argv[1]).length)' "$BODY")

READER_EMAIL="reader-test-$(date +%s)-$RANDOM@example.test"
READER_PASSWORD=$(openssl rand -hex 12)
READER_PASSWORD_NEW=$(openssl rand -hex 12)

reader_payload=$(node -e 'console.log(JSON.stringify({
  name: "Regression Reader",
  email: process.argv[1],
  password: process.argv[2],
  role: "reader"
}))' "$READER_EMAIL" "$READER_PASSWORD")
req POST "/api/admin/accounts" "$reader_payload" "$ADMIN_JAR"
check "admin create reader account" 201
TEMP_READER_ID=$(node -e 'console.log(JSON.parse(process.argv[1]).account_id);' "$BODY")

product_payload=$(node -e 'console.log(JSON.stringify({
  pname: "Regression Product",
  description: "temp",
  price: 9.99,
  qty: 3
}))')
req POST "/api/add_product" "$product_payload" "$ADMIN_JAR"
check "admin create product" 201
TEMP_PRODUCT_ID=$(node -e 'console.log(JSON.parse(process.argv[1]).pid);' "$BODY")

update_payload='{"pname":"Regression Product Updated","description":"temp2","price":10.5,"qty":4}'
req PUT "/api/update_product/${TEMP_PRODUCT_ID}" "$update_payload" "$ADMIN_JAR"
check "admin update product" 200

req DELETE "/api/delete_product/${TEMP_PRODUCT_ID}" "" "$ADMIN_JAR"
check "admin delete product" 204
TEMP_PRODUCT_ID=""

req POST "/api/add_product" '{}' "$ADMIN_JAR"
check "admin add_product empty body" 400

req DELETE "/api/delete_product/99999" "" "$ADMIN_JAR"
check "admin delete missing product" 404

req DELETE "/api/admin/accounts/${ADMIN_ID}" "" "$ADMIN_JAR"
check "admin cannot delete own account" 400

req PUT "/api/admin/accounts/${ADMIN_ID}" '{"role":"reader"}' "$ADMIN_JAR"
if [ "$CODE" = "400" ] || [ "$CODE" = "409" ]; then
  case "$BODY" in
    *"cannot change your own"*|*"At least one administrator must remain"*)
      pass "admin cannot change own role"
      ;;
    *)
      fail "admin cannot change own role (body missing expected message)"
      ;;
  esac
else
  fail "admin cannot change own role (expected HTTP 400 or 409, got $CODE)"
fi

short_pw_payload=$(node -e 'console.log(JSON.stringify({
  name: "Short Password",
  email: "short-pw-'$RANDOM'@example.test",
  password: "short",
  role: "reader"
}))')
req POST "/api/admin/accounts" "$short_pw_payload" "$ADMIN_JAR"
check "password shorter than 12 characters" 400

# Reader session
login "$READER_EMAIL" "$READER_PASSWORD" "$READER_JAR"
check "reader login" 200

req GET "/api/get_products" "" "$READER_JAR"
check "reader GET get_products" 200

req GET "/api/get_users" "" "$READER_JAR"
check "reader GET get_users" 200

req GET "/api/get_orders" "" "$READER_JAR"
check "reader GET get_orders" 200

req GET "/api/admin/accounts" "" "$READER_JAR"
check "reader GET admin/accounts" 403

req POST "/api/add_product" "$product_payload" "$READER_JAR"
check "reader POST add_product" 403

req PUT "/api/update_product/99999" "$update_payload" "$READER_JAR"
check "reader PUT update_product/99999" 403

req DELETE "/api/delete_product/99999" "" "$READER_JAR"
check "reader DELETE delete_product/99999" 403

req POST "/api/admin/accounts" "$reader_payload" "$READER_JAR"
check "reader POST admin/accounts" 403

# Admin changes reader password; old reader session must fail
new_pw_payload=$(node -e 'console.log(JSON.stringify({ password: process.argv[1] }))' "$READER_PASSWORD_NEW")
req PUT "/api/admin/accounts/${TEMP_READER_ID}" "$new_pw_payload" "$ADMIN_JAR"
check "admin change reader password" 200

req GET "/api/auth/me" "" "$READER_JAR"
check "reader session invalid after password change" 401

req POST "/api/auth/logout" "" "$ADMIN_JAR"
check "admin logout" 204

req GET "/api/auth/me" "" "$ADMIN_JAR"
check "admin /api/auth/me after logout" 401

# Re-login for cleanup and count verification
login "$ADMIN_EMAIL" "$ADMIN_PASSWORD" "$ADMIN_JAR"
check "admin re-login for cleanup" 200

cleanup

req GET "/api/get_products" "" "$ADMIN_JAR"
FINAL_PRODUCT_COUNT=$(node -e 'console.log(JSON.parse(process.argv[1]).length)' "$BODY")
if [ "$FINAL_PRODUCT_COUNT" = "$INITIAL_PRODUCT_COUNT" ]; then
  pass "product count restored"
else
  fail "product count restored (expected $INITIAL_PRODUCT_COUNT, got $FINAL_PRODUCT_COUNT)"
fi

req GET "/api/admin/accounts" "" "$ADMIN_JAR"
FINAL_ACCOUNT_COUNT=$(node -e 'console.log(JSON.parse(process.argv[1]).length)' "$BODY")
if [ "$FINAL_ACCOUNT_COUNT" = "$INITIAL_ACCOUNT_COUNT" ]; then
  pass "account count restored"
else
  fail "account count restored (expected $INITIAL_ACCOUNT_COUNT, got $FINAL_ACCOUNT_COUNT)"
fi

TEMP_READER_ID=""
TEMP_PRODUCT_ID=""
