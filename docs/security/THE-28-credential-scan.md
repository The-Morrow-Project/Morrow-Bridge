# THE-28 credential scan receipt

Result: the QR OAuth proof, the PAT probe, and the Canvas session-cookie capture are gone, and
Morrow sends none of the 12 Canvas writes that mint, regenerate, or return a credential, and none of
the 6 writes that carry a password or shared secret the person types (held until THE-87 keeps typed
credentials out of Morrow's records). One borrowed credential remains, by decision: both
products reuse the Item Banks app's own token for Morrow's Item Bank calls. It stays in personal
mode until Linear THE-85 replaces or removes it, and the CI gate allows it only at the sites listed
below.

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

## Remaining borrowed credential: the Item Banks app token (THE-85)

Morrow reaches Canvas Item Banks and New Quiz bank draws with a token that Canvas issued to
Instructure's Item Banks (quiz LTI) app, not to Morrow. Morrow takes it from that app's requests or
storage and sends it on its own Item Bank calls. There is no public Item Banks API for third parties.

Morrow PM decided on 2026-10-12 to keep this in personal mode, not to turn it off by default, and not
to remove it in THE-28. Institutional mode must not ship with it (BRIDGE-INSTITUTIONAL-PLAN §3).
Linear THE-85, owned by Braden, tracks replacing or removing it.

| Site | What it does |
|---|---|
| `desktop/connector/extension/src/item-bank-credential.js:128` | Reads the `Authorization` header from the Item Banks app's `/api/banks` request (`webRequest.onBeforeSendHeaders` in `service-worker.js`) |
| `desktop/connector/extension/src/item-bank-executor.js:118` | Reads `banks.build_token` from the app's sessionStorage |
| `desktop/connector/extension/src/quiz-bank-draw-executor.js:66` | Reads `quiz.build_token` from the New Quiz builder's storage |
| `morrow-for-muse/transport/local_chromium.py:932` | `capture_request_headers`, the CDP primitive that records a request's headers |
| `morrow-for-muse/transport/item_bank_sdk.py:789-834` | Captures the quiz-api `Authorization` header and sends it on later requests |
| `morrow-for-muse/provision/launch_driver.py:396` | Captures the same header during launch |
| `morrow-for-muse/dispatch/executor.py` (draw path), `provision/manifests/morrow_check_new_quiz.json` | Reuse `quiz.build_token` and the `banks_build_token` transient |
| `morrow-for-muse/failures/live_verify.py:219` | Dev-only live check; reads `banks.build_token` |

The CI gate's `Item Banks app token capture` marker fails on any other file that captures a request
header or reads a build token.

## Removed or held by this PR

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
| `morrow-for-muse/dispatch/executor.py` | `inject_cookie_header` removed; a non-string credential slot now fails closed | The rig HTTPS lane could still send a dict in `canvas.pat` as a `Cookie` header. |
| `desktop/packages/canvas-api-catalog/src/operation-admission.ts` (+ generated `connector/extension/generated/canvas-operation-admission.js`, `artifacts/canvas-api/canvas-admission-report.json`) | 12 credential routes held with reason `mints_a_credential` (listed below) | Morrow does not send a write that mints, regenerates, or returns a credential. The Bridge no longer offers these changes and the connector sends no command for them; the result redaction stays as defense in depth. The 6 credential-input writes are held the same way with reason `receives_a_credential`. Tests and the admission documents are updated to the new 28 held / 531 admitted split. The generated admission file is Bridge source, so Morrow Bridge Extension moves to 1.0.140 with a new `connector/release-ledger.json` seal (1.0.139 shipped in Desktop 1.0.15 and stays sealed as released). |
| `desktop/scripts/test/no-borrowed-credentials.test.mjs`, `.github/workflows/ci.yml` | New CI gate | Scans every tracked UTF-8 file, line by line, for the markers in this receipt, for CDP cookie reads and `Cookie` header replay, and for Item Banks token capture. The only allowed matches are the exact existing lines, each once: the helper's expiry read and its tests, and the THE-85 sites. Any other match, including a new one inside an allowed file, fails. and fails if a removed path comes back. It does not see a marker built at run time, split across lines, or inside a binary file. |
| `morrow-for-muse/scripts/carve.py`, `scripts/dev-suites.sh`, `scripts/test_package_shadowing.py`, `dispatch/integration_selftest.py`, `dispatch/executor.py`, `failures/catalog.json`, `DEPLOY.md`, `CHANGELOG.md`, `audit/*.md`, `moodle/session_selftest.py`, `desktop/scripts/test/ci-native-platforms.test.mjs` | References updated | They named the removed files. `carve.py` still denies `session/`, `lanes/`, and `qr-proof/`, so a restored copy cannot ship. |

### Canvas writes held because they mint, regenerate, or return a credential

No shipped Morrow feature calls any of these. They were generic catalog operations. Morrow PM decided on 2026-10-12 to hold all of them. `canvas_add_observee_with_credentials` stays admitted: it checks credentials the person supplies and mints none.

| Group | Tool | Route |
|---|---|---|
| Person's access token | `canvas_create_access_token` | `POST /v1/users/{user_id}/tokens` |
| Person's access token | `canvas_update_access_token` (`token_regenerate`) | `PUT /v1/users/{user_id}/tokens/{id}` |
| Sign-in or service token | `canvas_create_jwt` | `POST /v1/jwts` |
| Sign-in or service token | `canvas_refresh_jwt` | `POST /v1/jwts/refresh` |
| Sign-in or service token | `canvas_deprecated_create_instaccess_token` | `POST /v1/inst_access_tokens` |
| Sign-in or service token | `canvas_get_pandata_events_jwt_token_and_its_expiration_date` | `POST /v1/users/self/pandata_events_token` |
| Sign-in or service token | `canvas_start_kaltura_session` | `POST /v1/services/kaltura_session` |
| Pairing credential | `canvas_create_observer_pairing_code` | `POST /v1/users/{user_id}/observer_pairing_codes` |
| Application secret | `canvas_regenerate_developer_key_secret` | `POST /v1/developer_keys/{id}/regenerate_secret` |
| Application secret | `canvas_create_developer_key` | `POST /v1/accounts/{account_id}/developer_keys` |
| Application secret | `canvas_create_lti_registration_lti_registrations` | `POST /v1/accounts/{account_id}/lti_registrations` |
| Application secret | `canvas_create_lti_registration_apps` | `POST /v1/accounts/{account_id}/apps` |

The last three were offered for standing Edit access before this change. Administrators create developer keys and LTI registrations in Canvas itself.

### Canvas writes held because they carry a typed credential (THE-87)

These writes mint nothing and borrow nothing: the person types a credential that Canvas itself requires. They were going to stay admitted. An independent review (Codex, round 3b, at `2902860b`) then found that Morrow keeps copies of the typed value outside the one Canvas request, so Morrow PM decided on 2026-10-12 to hold them until Linear THE-87 fixes that, then re-admit them with an administrator category. No shipped flow uses them: Morrow Bridge for Muse only lists and launches existing external tools.

| Tool | Credential it carries |
|---|---|
| `canvas_add_observee_with_credentials` | The student's `observee[password]`, or an `access_token` |
| `canvas_create_user` | `pseudonym[password]` |
| `canvas_create_user_login` | `login[password]` |
| `canvas_edit_user_login` | `login[password]`, `login[old_password]` |
| `canvas_create_external_tool_accounts` | LTI 1.1 `consumer_key` and `shared_secret` |
| `canvas_create_external_tool_courses` | LTI 1.1 `consumer_key` and `shared_secret` |

Where the typed value leaked (code at `2902860b`, proved with fake values against the real functions; no real credential is known to have leaked):

| Surface | Where |
|---|---|
| Assistant tool result and operation journal | Recovery read-back assertions copy every input as `expected` (`desktop/packages/canvas-api-catalog/src/readback-plan.ts:405,1112`), which field-name redaction does not catch |
| Operation journal, plain text | `plan_json` and `forwarded_request_json` (`desktop/packages/operation-journal/src/effect-broker.ts:796,858-860`); batch state keeps them encrypted |
| Approval page, before and after the run | `desktop/packages/mcp-server/src/approval-server.ts:672,1238` |
| Error text | A Canvas error that quotes the value passes through (`service-worker.js:6261`; Muse `failures/translator.py:100`) |
| Morrow Bridge for Muse, `canvas_create_external_tool_courses` | Approval display and 0600 plan and approval files keep all three fields; receipts redact `shared_secret` but not `consumer_key` or `client_id` |

The desktop admission holds all 6 with reason `receives_a_credential`. Morrow Bridge for Muse adds `canvas_create_external_tool_courses` to its never-dispatch list (`dispatch/admission_policy.json`); its catalog does not carry the other 5, so they are already refused. Follow-up: THE-87.

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
$ git grep -n -I -E -e 'access_token=' -- . "${X[@]}"
morrow-for-muse/dispatch/executor.py:1407:    # query-string / form-ish: ?token=abc, &access_token=abc, ;session=abc
```

A comment on the redaction rule that removes tokens from logged URLs.

```console
$ git grep -n -I -F -e 'Network.getCookies' -- morrow-for-muse/helper/server.py
morrow-for-muse/helper/server.py:1327:        Uses cookie METADATA ONLY (Network.getCookies scoped to the tenant
morrow-for-muse/helper/server.py:1348:                    self.tab, "Network.getCookies", {"urls": [base]},
```

The helper's session-expiry warning, on its private pipe. CDP returns full cookie objects into
the helper's memory; the helper uses only the `expires` times and the count, and logs, stores, or
returns no cookie name or value. The proxy allowlist no longer contains this method.

`git grep -i -F 'New Access Token' -- . "${X[@]}"` hits 4 files: the Canvas API catalog description of
`POST /v1/users/{user_id}/tokens` (2 generated copies) and Blackboard comments about OAuth token
renewal. This PR holds that Canvas route, the token update route (`token_regenerate`), and the other
credential routes listed above before dispatch with reason `mints_a_credential`.

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

Morrow Bridge for Muse is the personal-mode product these removals touch. Its CI steps ran on ORNACIA
(Python 3.12.12, hash-locked requirements), on this branch and on `origin/main` (`1b0bb8b`) as the
baseline.

| Step | Baseline `main` | This branch |
|---|---|---|
| `python -m pytest -q` | 2433 passed, 1 failed, 1 skipped | 2421 passed, 2 failed, 1 skipped |
| `bash scripts/dev-suites.sh` | 22/22 suites pass | 21/21 suites pass (`session/cdp_selftest.py` removed) |
| `carve.py` then `install-suites.sh` | 23/23 suites pass | 23/23 suites pass |
| Repository gates (`check-repository` job, plus `ci-native-platforms.test.mjs` and `pre-commit-hook.test.mjs`), at `2902860b` | not run | 47/47 pass |
| Desktop `canvas-api-catalog` vitest | not run | 108/108 pass |
| Connector runtime: no Bridge command for any held credential route | not run | pass (18 routes, 0 commands; the refusal echoes no typed value) |
| Desktop browser harness `canvas-connector-browser.mjs` | not run | pass |
| Desktop `pnpm scripts:test` | 3 fail locally (below) | 1450 pass, the same 3 fail locally |

The branch collects 11 fewer pytest tests (2424 against 2435, skipped tests included): the deleted tests for the removed code. No failure comes from the
removal:

- Baseline `scripts/test_install_after_use.py::test_rerun_after_connecting_and_signing_in` timed out
  waiting for a keepalive lock while both runs shared the host. It passed in the branch run.
- Branch `bin/test_morrow.py::test_doctor_reads_no_auth_material` and
  `test_failure_reads_no_auth_material` assert that no opened path contains the word
  `credential`. The branch worktree directory was named `chore-the-28-credential-scan`. From a
  checkout of the same commit at a neutral path, `bin/test_morrow.py` passes 53/53.

The 3 local desktop script failures (`desktop-package-provenance` payload seal, offline dependency materialization `ERR_PNPM_NO_OFFLINE_TARBALL`, `desktop-update-harness`) fail the same way on a clean `origin/main` checkout on this host, so they come from the local package store, not this change. CI runs them on clean runners.

Recovery after a Canvas sign-out stays on `reauth/state_machine.py resume`. Its tests
(`reauth/test_principal_pin.py`, `reauth/test_approve_refusals.py`, `transport/test_principal_check.py`,
`reauth/session_lifecycle_selftest.py` `t_resume_cmd`) pass on the branch.

## Limits

- The scan covers tracked files. Untracked local files and other repositories are not in scope.
- Git history still contains the removed scripts. They held no secret value: the QR proof read
  the mobile client credentials at run time and never stored them, so a history rewrite is not
  needed.
- A rig host that ran `capture.py` before this change can still hold a captured cookie in
  `~/.morrow/session.json`. The operator of that host should delete the `canvas.cookies` entry.
  `session.json.prev` copies older than 7 days are swept automatically.
- `desktop/packages/mcp-server/src/meridian-runtime-adapter.ts` can pass `CANVAS_SESSION_PATH` to
  the private Meridian runtime. That file's format is defined outside this repository, so this scan
  cannot classify it.
