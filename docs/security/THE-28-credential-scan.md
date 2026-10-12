# THE-28 credential scan receipt

Result: no borrowed-credential code remains in the tracked tree.

A borrowed credential is a credential that Morrow was not given for its own use. Examples:
another app's OAuth client, a token that Morrow mints or scrapes for the user, or a session
cookie that Morrow copies out of the browser and replays elsewhere. A credential that the
institution registers for Morrow (the Blackboard REST application key) or that the user signs in
with in their own browser is not borrowed.

- Linear: THE-28
- Tree scanned: the commit that adds this file, on branch `chore/the-28-credential-scan`
- Scanned on: 2026-10-12, ripgrep 15.1.0, git grep, gitleaks 8.30.1

## Removed by PR #122

PR #122 (merged 2026-10-11 as `34cd1ac`) removed these files:

| File | Why |
|---|---|
| `morrow-for-muse/qr-proof/qr_proof.py`, `PROOF_LOG.md`, `crop_view.png` | It took Instructure's mobile OAuth client ID and secret from `mobile_verify.json` and exchanged a Canvas mobile QR code for tokens. |
| `morrow-for-muse/lanes/detect.py` | It scraped the Canvas settings page and the token list API to find out whether the user could mint a personal access token. |

## Removed by this PR

The scan below found one more borrowed-credential pattern: the rig session capture. It read the
Canvas session cookie out of the browser through CDP, wrote it to `~/.morrow/session.json`, and with
`--verify-direct` replayed it over raw HTTPS. The executor had already retired the cookie slot that it
fed. Production recovery is `reauth/state_machine.py resume`, which reads the live account inside
the helper's own tab and copies no cookie, so no working personal-mode flow used the capture.

| File | Change | Why |
|---|---|---|
| `morrow-for-muse/session/capture.py` | Deleted | Cookie capture and raw HTTPS replay. |
| `morrow-for-muse/session/cdp.py` | Deleted | Its CDP client. Only `capture.py` and `keepalive-canvas.sh` used it. |
| `morrow-for-muse/session/cdp_selftest.py`, `session/test_capture_redirect.py`, `session/__init__.py` | Deleted | Tests and package file for the deleted modules. |
| `morrow-for-muse/bin/keepalive-canvas.sh` | Deleted | Rig keepalive that needed the captured `session.json`. The product keepalive is `helper/keepalive.sh`. |
| `morrow-for-muse/helper/server.py` | `Network.getCookies` removed from the `/cdp/call` proxy allowlist | Any local process with the helper token could read full cookie values through the proxy. The helper's own expiry check reads only cookie expiry times on its private pipe, and is unchanged. |
| `morrow-for-muse/reauth/state_machine.py` | `reauth()`, `_complete_reauth()`, the `reauth` and `selftest` commands removed | They ran `capture.py`. `resume`, `pin`, `approve`, `notify`, and `status` are unchanged. Old `session.json.prev` files are still swept. |
| `morrow-for-muse/bin/scheduler.py` | Canvas entry removed | It ran `keepalive-canvas.sh`. The Moodle entry is unchanged. |
| `morrow-for-muse/reauth/wave5_resource_selftest.py`, `reauth/session_lifecycle_selftest.py`, `scripts/test_s4_install_lane.py` | Tests for the removed code removed | They tested `reauth()`, `_complete_reauth()`, and `keepalive-canvas.sh`. |
| `morrow-for-muse/transport/local_chromium_selftest.py` | New check | The proxy allowlist must not contain `Network.getCookies`. |
| `desktop/scripts/test/no-borrowed-credentials.test.mjs`, `.github/workflows/ci.yml` | New CI gate | Scans every tracked file for the markers below on every change, and fails if a removed path comes back. |
| `morrow-for-muse/scripts/carve.py`, `scripts/dev-suites.sh`, `scripts/test_package_shadowing.py`, `dispatch/integration_selftest.py`, `dispatch/executor.py`, `failures/catalog.json`, `DEPLOY.md`, `CHANGELOG.md`, `audit/*.md`, `moodle/session_selftest.py`, `desktop/scripts/test/ci-native-platforms.test.mjs` | References updated | They named the removed files. `carve.py` still denies `session/`, `lanes/`, and `qr-proof/`, so a restored copy cannot ship. |

## Scan commands and output

Run from the repository root. `X` excludes this receipt and the CI gate, because both name the
patterns.

```bash
X=(':!docs/security/THE-28-credential-scan.md' ':!desktop/scripts/test/no-borrowed-credentials.test.mjs')
```

### 1. Instructure mobile OAuth client and QR sign-in

```console
$ git grep -n -I -i -E -e 'mobile_verify' -e 'qr_mobile_login' -e 'sso\.(beta\.|test\.)?canvaslms\.com' -e 'QRCodeDetector' -e '\bcode_(ios|android)' -- . "${X[@]}"
$ echo $?
1
```

No output. The removed QR proof never held a literal mobile client ID: it read the ID and secret
from `mobile_verify.json` at run time. That broker is the marker.

### 2. PAT probe and token scraping

```console
$ git grep -n -I -i -E -e 'limit_personal_access_tokens' -e 'users/self/tokens' -- . "${X[@]}"
$ echo $?
1
```

No output.

### 3. Canvas access token values

```console
$ git grep -n -I -E -e '\b[0-9]{4,5}~[A-Za-z0-9]{64}\b' -- .
$ echo $?
1
```

No output.

### 4. Browser cookie store readers and the Moodle mobile app service

```console
$ git grep -n -I -i -E -e 'pycookiecheat|browser_cookie3|moodle_mobile_app|tool_mobile' -- . "${X[@]}"
$ echo $?
1
```

No output.

### 5. Hardcoded OAuth client IDs or secrets

```console
$ git grep -n -I -E -e "client_(id|secret)\s*[:=]\s*[\"'][A-Za-z0-9._~-]{8,}" -- .
$ echo $?
1
```

No output. Blackboard reads its application key and secret from the administrator's private
configuration (`desktop/packages/blackboard-learn-api/src/config.ts`).

### 6. Removed paths

```console
$ git ls-files -- morrow-for-muse/lanes morrow-for-muse/qr-proof morrow-for-muse/session
```

No output.

### 7. Patterns that hit, and why each hit is not a borrowed credential

```console
$ git grep -n -I -E -e 'access_token=' -- .
morrow-for-muse/dispatch/executor.py:1407:    # query-string / form-ish: ?token=abc, &access_token=abc, ;session=abc
```

A comment on the redaction rule that removes tokens from logged URLs.

```console
$ git grep -n -I -F -e 'Network.getCookies' -- morrow-for-muse/helper/server.py
morrow-for-muse/helper/server.py:1327:        Reads cookie METADATA ONLY through CDP (Network.getCookies scoped
morrow-for-muse/helper/server.py:1346:                    self.tab, "Network.getCookies", {"urls": [base]},
```

The helper's session-expiry warning. It reads only the `expires` times on its private pipe and
returns no cookie name or value. The proxy allowlist no longer contains this method.

`git grep -i -F 'New Access Token'` hits 4 files: the Canvas API catalog description of
`POST /v1/users/{user_id}/tokens` (2 generated copies) and Blackboard comments about OAuth token
renewal. That Canvas route is an official API write in the user's own signed-in session. Admission
classes it as a `session_credential` site-authority write (`operation-admission.ts`,
`NO_READABLE_PROVIDER_EFFECT_ROUTE`), and the Bridge removes the returned token from the result
(`withoutSessionCredentialSecrets` in `service-worker.js`). It uses the user's own Canvas
permission, so it is not a borrowed credential.

The remaining references to `lanes/detect.py`, `qr-proof/`, `session/capture.py`, and
`keepalive-canvas.sh` are removal notes (`DEPLOY.md`, `audit/`), history (`config/paths.py`,
`scripts/test_dev_suites.py`, proof-battery evidence citations), and guards that keep the paths out
of a release (`scripts/carve.py`, `scripts/test_carve.py`).

### 8. Classification of broader patterns

These patterns have many hits. Each hit was read and classified. None is a borrowed credential.

| Pattern | Hits are |
|---|---|
| `\bPAT\b`, `"pat"` | The rig HTTPS lane reads a token that the operator puts in `~/.morrow/session.json` for their own account. No code mints, scrapes, or writes a token. Also a loop variable that means "pattern", and fake test values. |
| `canvas_session`, `_csrf_token`, `document.cookie` | Same-origin requests inside the user's signed-in tab read the page's own CSRF token. The executor refuses the retired `canvas_session` slot. Redaction lists and fake test values. |
| `MoodleSession`, `wstoken` | Morrow's own Moodle class, which signs in through the standard login form with the user's own password and keeps the cookie jar in memory. Redaction rules and fake test values. |
| `client_secret`, `refresh_token`, `oauth2/token` | Blackboard `client_credentials` with the institution's registered key, redaction lists, mock servers, and a guard that keeps browser token exchange out of the Bridge extension. |
| `developer_key`, `client_id` | Canvas API route names and parameter schemas. No values. |
| `User-Agent` | Honest Morrow user agents (`morrow-moodle-lane/0.1`). No official mobile app impersonation. |

### 9. gitleaks

gitleaks 8.30.1 (release binary, checksum verified) ran on an export of the committed tree, so
untracked local files were not scanned, and on the full git history.

```console
$ git archive HEAD | tar -x -C "$TREE" && gitleaks dir "$TREE" --redact
WRN leaks found: 17
$ gitleaks git . --redact
WRN leaks found: 24
```

Each finding was read. None is a real or borrowed credential.

| Finding | What it is |
|---|---|
| `desktop/connector/extension/manifest.json:6` `"key"` | The extension's public key, which pins the extension ID. Public by design. |
| `desktop/packages/mcp-server/test/blackboard-*.test.ts` (7), `blackboard-learn-api/test/config.test.ts:128` | Fixture credential revision UUIDs and the value `file-secret`. |
| `desktop/packages/gateway-core/test/privacy.test.ts:1035-1042` | Fake keys (`prod-consumer-91af`, `ak_live_9d2f81`) that prove the redactor removes them. |
| `desktop/scripts/test/release-signing-preflight.test.mjs:44,49` | Fake signing passwords. The test checks that no receipt copies an input value. |
| `desktop/scripts/test/canvas-file-access-token.test.mjs:34` | A fake JWT. Its payload is `{"resource":"/files"}` and its signature decodes to `signature-value`. |
| `morrow-for-muse/failures/selftest_smoke.py:204` | A fake key that proves the redactor removes it. |
| History only: `morrow-for-muse/pack/carve-manifest.json` (5) | File hashes, not keys. |
| History only: `packages/mcp-server/test/fixtures/blackboard-test-key.pem` | A local TLS key for fake test servers. Removed in the 2026-09-22 monorepo restructure. |
| History: the same fixture files at earlier paths | Same as above. |

## Personal-mode tests

PERSONAL_MODE_TESTS

## Limits

- The scan covers tracked files. Untracked local files and other repositories are not in scope.
- Git history still contains the removed scripts. They held no secret value: the QR proof read
  the mobile client credentials at run time and never stored them, so a history rewrite is not
  needed.
- A rig host that ran `capture.py` before this change can still hold a captured cookie in
  `~/.morrow/session.json`. The operator of that host should delete the `canvas.cookies` entry.
  `session.json.prev` copies older than 7 days are swept automatically.
