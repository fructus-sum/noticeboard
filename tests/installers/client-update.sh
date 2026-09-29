#!/usr/bin/env bash
# shellcheck disable=SC1090,SC2016,SC2034  # the variables set here are read by the command and stand-ins
# A Client only following its Server (SYSTEM_DESIGN §18.7 phase 3): installers/client/noticeboard-client
# against a stand-in Server (curl answering /api/client/…) with real ed25519 keys and signatures
# (Node makes them, openssl checks them), bundles whose installer records how it was run, a
# stand-in kiosk (sleep writes what the kiosk would, after a new version starts), and GitHub's
# Releases API (tests/helpers/github.sh) for reinstall-stable:
#   the same version: nothing; only the version differs: recorded, nothing installed; a new or older
#   version: verified, installed with --apply, kept for a rollback; a bad signature: refused; the
#   kiosk not coming back: the previous files put back and the version skipped; an install failing;
#   no earlier files: main's latest Release; no key pinned; a Client + Server; trust-server;
#   reinstall-stable; status.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T=$(mktemp -d); BIN="$T/bin"; export T MOCK="$T/mock"; mkdir -p "$BIN" "$MOCK"
export GITHUB_STANDIN="$REPO/tests/helpers/github.sh"
CMD="$REPO/installers/client/noticeboard-client"
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; [ -n "${2:-}" ] && sed 's/^/        /' <<<"$2" | head -12; }

# ── The Client: its files, answers and pinned key ──
export NOTICEBOARD_CLIENT_DIR="$T/client" NOTICEBOARD_CONFIG="$T/install.env" NOTICEBOARD_SERVER_KEY="$T/server.pub" \
  NOTICEBOARD_KIOSK_UP="$T/kiosk-up" NOTICEBOARD_ROOT_LIB="$REPO/installers/lib" NOTICEBOARD_ROLLBACK_SECONDS=20
mkdir -p "$T/client"
answers() { printf 'NOTICEBOARD_ROLE=%s\nNOTICEBOARD_PLATFORM=desktop\nNOTICEBOARD_SERVER_URL=http://server.test:3000/\n' "$1" > "$T/install.env"; }
answers client

# ── Keys and bundles: a bundle holds an installer that records its name ──
node -e "
const c = require('crypto'), fs = require('fs'), T = process.argv[1];
for (const name of ['server', 'other']) {
  const k = c.generateKeyPairSync('ed25519');
  fs.writeFileSync(T + '/' + name + '.key', k.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(T + '/' + name + '.pem', k.publicKey.export({ type: 'spki', format: 'pem' }));
}" "$T"
bundle() {   # bundle <name>: $MOCK/<name>.tar.gz, signed by the Server's key as <name>.sig (and by another as <name>.bad)
  local d="$T/b-$1"
  mkdir -p "$d/installers"
  printf '#!/usr/bin/env bash\necho "APPLY %s $* sha=$NOTICEBOARD_INSTALLER_SHA" >> "$MOCK/apply.log"\n[ -f "$MOCK/apply-fails" ] && exit 1\nexit 0\n' "$1" > "$d/installers/install.sh"
  tar -czf "$MOCK/$1.tar.gz" -C "$d" installers
  node -e "
const c = require('crypto'), fs = require('fs'), [T, M, n] = process.argv.slice(1);
const data = fs.readFileSync(M + '/' + n + '.tar.gz');
fs.writeFileSync(M + '/' + n + '.sig', c.sign(null, data, c.createPrivateKey(fs.readFileSync(T + '/server.key'))));
fs.writeFileSync(M + '/' + n + '.bad', c.sign(null, data, c.createPrivateKey(fs.readFileSync(T + '/other.key'))));" "$T" "$MOCK" "$1"
}
bundle v1; bundle v2; bundle v3
H1=$(printf 1%.0s {1..64}); H2=$(printf 2%.0s {1..64}); H3=$(printf 3%.0s {1..64})
C1=$(printf a%.0s {1..40}); C2=$(printf b%.0s {1..40}); C3=$(printf c%.0s {1..40})
offer() {   # offer <version> <commit> <hash> <bundle> [<signature: sig|bad>]: what the Server answers
  printf '{"version":"%s","commit":"%s","clientHash":"%s"}' "$1" "$2" "$3" > "$MOCK/version.json"
  cp "$MOCK/$4.tar.gz" "$MOCK/bundle.tar.gz"; cp "$MOCK/$4.${5:-sig}" "$MOCK/bundle.sig"
}

# ── Stand-ins ──
# curl: the stand-in Server, GitHub's Releases API and the Release's installer
cat > "$BIN/curl" <<'EOF'
#!/usr/bin/env bash
case "$*" in */releases/latest*) source "$GITHUB_STANDIN"; fake_latest_release "$@"; exit $? ;; esac
out=""; prev=""; for a; do [ "$prev" = -o ] && out=$a; prev=$a; done
send() { if [ -n "$out" ]; then cp "$1" "$out"; else cat "$1"; fi; }
[ -f "$MOCK/server-down" ] && case "$*" in *server.test*) exit 7 ;; esac
case "$*" in
  *server.test:3000/api/client/version*) send "$MOCK/version.json" ;;
  *server.test:3000/api/client/bundle.sig*) send "$MOCK/bundle.sig" ;;
  *server.test:3000/api/client/bundle*) send "$MOCK/bundle.tar.gz" ;;
  *server.test:3000/api/client/key*) send "$T/server.pem" ;;
  *raw.githubusercontent.com*/installers/install.sh*)
    printf '#!/usr/bin/env bash\necho "STABLE $* sha=$NOTICEBOARD_INSTALLER_SHA release=$NOTICEBOARD_INSTALLER_RELEASE" >> "$MOCK/apply.log"\n' > "$out" ;;
  *) exit 22 ;;
esac
EOF
# sleep: plays the kiosk, which starts again after new files and says so (unless MOCK/kiosk-down)
cat > "$BIN/sleep" <<'EOF'
#!/usr/bin/env bash
if [ ! -f "$MOCK/kiosk-down" ]; then cat "$NOTICEBOARD_CLIENT_DIR/version" > "$NOTICEBOARD_KIOSK_UP" 2>/dev/null; fi
exit 0
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/logger"
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

run() { rm -f "$MOCK/apply.log"; OUT=$(bash "$CMD" "$@" 2>&1); RC=$?; }
version() { cat "$T/client/version" 2>/dev/null; }
applied() { cat "$MOCK/apply.log" 2>/dev/null; }

# ── No key pinned yet ──
echo "v1" > "$T/client/version"; echo "$H1" > "$T/client/hash"
offer v2 "$C2" "$H2" v2
run check
[ $RC -ne 0 ] && grep -q "trust-server" <<<"$OUT" && [ -z "$(applied)" ] && ok "no key pinned: nothing installed, says to run trust-server" || bad "no key" "$OUT"

# ── trust-server ──
run trust-server
[ $RC -ne 0 ] && [ ! -f "$T/server.pub" ] && ok "trust-server without a yes (no keyboard here): nothing pinned" || bad "trust no" "$OUT"
run trust-server --yes
fp=$(openssl pkey -pubin -in "$T/server.pem" -outform DER | sha256sum | cut -c1-64)
[ $RC -eq 0 ] && cmp -s "$T/server.pub" "$T/server.pem" && grep -q "SHA256:$fp" <<<"$OUT" && ok "trust-server --yes: shows the fingerprint and pins the Server's key" || bad "trust yes" "$OUT"

# ── Following the Server ──
offer v1 "$C1" "$H1" v1
run check
[ $RC -eq 0 ] && [ -z "$(applied)" ] && grep -q "Up to date" <<<"$OUT" && ok "the same version: nothing" || bad "same" "$OUT"
offer v1b "$C1" "$H1" v1
run check
[ $RC -eq 0 ] && [ -z "$(applied)" ] && [ "$(version)" = v1b ] && ok "only the version differs (the same files): recorded, nothing installed, no restart" || bad "hash only" "$OUT"
offer v2 "$C2" "$H2" v2 bad
run check
[ $RC -ne 0 ] && [ -z "$(applied)" ] && [ "$(version)" = v1b ] && grep -q "aren't signed with the key" <<<"$OUT" && ok "a bundle not signed with the pinned key: refused, never unpacked" || bad "bad signature" "$OUT"
offer v2 "$C2" "$H2" v2
run check
[ $RC -eq 0 ] && grep -q "^APPLY v2 --apply sha=local" <<<"$(applied)" && [ "$(version)" = v2 ] && [ "$(cat "$T/client/hash")" = "$H2" ] \
  && cmp -s "$T/client/installed.tar.gz" "$MOCK/v2.tar.gz" && ok "a new version: verified, its installer run with --apply, recorded and kept" || bad "new" "$OUT"
echo v2 > "$T/kiosk-up"
offer v3 "$C3" "$H3" v3
run check
[ $RC -eq 0 ] && grep -q "^APPLY v3" <<<"$(applied)" && [ "$(version)" = v3 ] && [ "$(cat "$T/kiosk-up")" = v3 ] && cmp -s "$T/client/previous.tar.gz" "$MOCK/v2.tar.gz" \
  && ok "the kiosk was up: it comes back with the new version; the one before is kept for a rollback" || bad "kiosk back" "$OUT"
offer v1 "$C1" "$H1" v1
run check
[ $RC -eq 0 ] && grep -q "^APPLY v1" <<<"$(applied)" && [ "$(version)" = v1 ] && ok "an older version (the Server went back): followed too" || bad "older" "$OUT"

# ── Rollback ──
offer v2 "$C2" "$H2" v2; touch "$MOCK/kiosk-down"
run check
[ $RC -ne 0 ] && [ "$(applied | head -n 1)" = "APPLY v2 --apply sha=local" ] && [ "$(applied | sed -n 2p)" = "APPLY v1 --apply sha=local" ] \
  && [ "$(version)" = v1 ] && [ "$(cat "$T/client/skip")" = "$C2" ] && grep -q "putting the previous Client back" <<<"$OUT" \
  && ok "the kiosk doesn't come back: the previous files put back, that version skipped" || bad "rollback" "$OUT"
rm -f "$MOCK/kiosk-down"
run check
[ $RC -eq 0 ] && [ -z "$(applied)" ] && grep -q "put back before" <<<"$OUT" && ok "  … and not tried again while the Server offers it" || bad "skip" "$OUT"
offer v3 "$C3" "$H3" v3; touch "$MOCK/apply-fails"
run check
[ $RC -ne 0 ] && [ "$(cat "$T/client/skip")" = "$C3" ] && [ "$(version)" = v1 ] && ok "its installer fails: skipped, the files before it put back" || bad "apply fails" "$OUT"
rm -f "$MOCK/apply-fails" "$T/client/installed.tar.gz" "$T/client/previous.tar.gz"
echo v1 > "$T/kiosk-up"; echo v0.9.0 > "$MOCK/release"; touch "$MOCK/kiosk-down"
offer v2b "$(printf d%.0s {1..40})" "$(printf 4%.0s {1..64})" v2
run check
grep -q "STABLE --apply sha=v0.9.0 release=v0.9.0" <<<"$(applied)" && [ "$(version)" = "v0.9.0 (stable)" ] \
  && ok "no earlier files to put back: main's latest Release from GitHub" || bad "no earlier" "$OUT"
rm -f "$MOCK/kiosk-down"

# ── Out of reach, other roles, the other commands ──
touch "$MOCK/server-down"
run check
[ $RC -eq 0 ] && [ -z "$(applied)" ] && grep -q "Couldn't reach the Server" <<<"$OUT" && ok "the Server out of reach: nothing changes, tried again later" || bad "server down" "$OUT"
rm -f "$MOCK/server-down"
answers both
run check
[ $RC -eq 0 ] && [ -z "$(applied)" ] && grep -q "updated with its Server" <<<"$OUT" && ok "a Client + Server: doesn't follow this way (root would run what the app's user signed)" || bad "both" "$OUT"
answers client
run reinstall-stable
[ $RC -eq 0 ] && grep -q "STABLE --apply sha=v0.9.0" <<<"$(applied)" && [ "$(version)" = "v0.9.0 (stable)" ] && ok "reinstall-stable: main's latest Release from GitHub, not the Server" || bad "stable" "$OUT"
run status
grep -q "Client files : v0.9.0 (stable)" <<<"$OUT" && grep -q "Server key   : SHA256:$fp" <<<"$OUT" && ok "status: the version, the Server and its key" || bad "status" "$OUT"
chmod 555 "$T/client"
if [ -w "$T/client" ]; then
  echo "SKIP  without the rights: this system (Windows) can't make a folder read-only with chmod"
else
  run check
  [ $RC -ne 0 ] && grep -q "sudo noticeboard-client check" <<<"$OUT" && ok "without the rights (not root): says to use sudo" || bad "not root" "$OUT"
fi
chmod 755 "$T/client"

rm -rf "$T"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
