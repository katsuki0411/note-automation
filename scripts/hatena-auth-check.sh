#!/usr/bin/env bash
# はてなブログ AtomPub の認証だけを確認する（GET のみ。投稿しない）
#
# 使い方:
#   HATENA_ID=t3zztwzmay BLOG_DOMAIN=xxxxx.hatenablog.com API_KEY=xxxxxxxxxxxx \
#     bash scripts/hatena-auth-check.sh
#
# 期待される出力:
#   - HTTP/2 200 + <service> 形式の XML → 認証OK
#   - HTTP/2 401 → 認証NG（ID か APIキーが違う）
#   - HTTP/2 302 + Location: login → 認証NG
#   - HTTP/2 404 → URL の組み合わせが違う（ブログ未存在 / ID違い）

set -e

: "${HATENA_ID:?HATENA_ID required}"
: "${BLOG_DOMAIN:?BLOG_DOMAIN required}"
: "${API_KEY:?API_KEY required}"

NONCE_BIN=$(openssl rand 16)
NONCE_B64=$(printf '%s' "$NONCE_BIN" | base64)
CREATED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# PasswordDigest = base64(sha1(nonce_bytes + created + api_key))
PW_DIGEST=$(
  { printf '%s' "$NONCE_BIN"; printf '%s%s' "$CREATED" "$API_KEY"; } \
    | openssl dgst -sha1 -binary | base64
)

WSSE="UsernameToken Username=\"${HATENA_ID}\", PasswordDigest=\"${PW_DIGEST}\", Nonce=\"${NONCE_B64}\", Created=\"${CREATED}\""
URL="https://blog.hatena.ne.jp/${HATENA_ID}/${BLOG_DOMAIN}/atom"

echo ">>> GET ${URL}"
echo ">>> X-WSSE: ${WSSE}"
echo "---"
curl -sS -i \
  -H "X-WSSE: ${WSSE}" \
  "${URL}" \
  | head -40
