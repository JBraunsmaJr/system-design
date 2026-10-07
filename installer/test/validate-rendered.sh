#!/bin/sh
# Renders every example manifest and checks the output with the real tools:
# docker compose config, caddy adapt --validate, nginx -t.
#   COMPOSE=/path/to/docker-compose CADDY=/path/to/caddy NGINX=nginx sh test/validate-rendered.sh
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
COMPOSE=${COMPOSE:-docker compose}
CADDY=${CADDY:-caddy}
NGINX=${NGINX:-nginx}
export CLOUDFLARE_API_TOKEN=test-token TUNNEL_TOKEN=test-tunnel GITHUB_CLIENT_SECRET=test-gh
mkdir -p /run/secrets
printf 'oidc-secret\n' > /run/secrets/oidc-client-secret
printf -- '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n' > /run/secrets/recovery-public.pem

# Upstream names nginx resolves at load time.
grep -q 'sd-validate' /etc/hosts || printf '127.0.0.1 editor store relay keycloak sd-validate\n' >> /etc/hosts

certs=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=test -days 1 -keyout "$certs/privkey.pem" -out "$certs/fullchain.pem" >/dev/null 2>&1

fail=0
for manifest in "$here"/examples/*.yml; do
  name=$(basename "$manifest" .yml)
  dir=$(mktemp -d)
  printf '\n### %s\n' "$name"
  node "$here/src/main.ts" render --manifest "$manifest" --dir "$dir" --non-interactive --yes --no-diff >/dev/null
  ls -A "$dir" | tr '\n' ' '; echo

  (cd "$dir" && $COMPOSE -p "validate-$name" -f compose.yml --env-file .env config --quiet) && echo "compose: ok" || { echo "compose: FAILED"; fail=1; }

  for cf in "$dir/Caddyfile" "$dir/proxy-snippets/Caddyfile"; do
    [ -f "$cf" ] || continue
    # The stock binary lacks the Cloudflare DNS module; validate everything else.
    sed '/dns cloudflare/d' "$cf" > "$cf.check"
    $CADDY adapt --config "$cf.check" --adapter caddyfile --validate >/dev/null 2>"$cf.err" && echo "caddy $(basename "$(dirname "$cf")")/Caddyfile: ok" || { echo "caddy: FAILED"; cat "$cf.err"; fail=1; }
    rm -f "$cf.check" "$cf.err"
  done

  for nc in "$dir/nginx/default.conf" "$dir/proxy-snippets/nginx.conf"; do
    [ -f "$nc" ] || continue
    test_conf=$(mktemp)
    # nginx 1.24 here predates `http2 on;`; certificate paths point at a throwaway pair.
    sed -e '/http2 on;/d' \
        -e "s#ssl_certificate .*#ssl_certificate $certs/fullchain.pem;#" \
        -e "s#ssl_certificate_key .*#ssl_certificate_key $certs/privkey.pem;#" "$nc" > "$test_conf.inc"
    printf 'pid /tmp/nginx-validate.pid;\nevents {}\nhttp {\ninclude %s;\n}\n' "$test_conf.inc" > "$test_conf"
    $NGINX -t -q -c "$test_conf" && echo "nginx $(basename "$nc"): ok" || { echo "nginx: FAILED"; fail=1; }
  done
done
exit $fail
