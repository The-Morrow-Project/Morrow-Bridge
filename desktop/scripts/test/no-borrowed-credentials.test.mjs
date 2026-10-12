import assert from "node:assert/strict";
import { isUtf8 } from "node:buffer";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * No tracked file carries code that signs in with a credential Morrow was not given: another
 * app's OAuth client, a scraped or self-minted token, or a session cookie copied out of the
 * browser. Each marker below names one such mechanism; none has a legitimate use in this
 * repository. CI runs this file on every change (ci.yml `check-repository`).
 *
 * Failure mode pinned down: Morrow for Muse carried a QR proof that took
 * Instructure's mobile OAuth client from its broker, a probe that scraped the Canvas token page,
 * and a rig script that read the Canvas session cookie and replayed it over raw HTTPS.
 * docs/security/THE-28-credential-scan.md is the receipt and lists the same patterns, so this
 * file and the receipt are the two exceptions.
 *
 * The scan matches text line by line in UTF-8 files. It does not see a marker built at run time,
 * split across lines, or inside a binary file, so it guards against a restored or copied
 * mechanism, not against deliberate evasion; code review covers the rest.
 */
const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const SELF = "desktop/scripts/test/no-borrowed-credentials.test.mjs";
const RECEIPT = "docs/security/THE-28-credential-scan.md";

const BORROWED_CREDENTIAL_MARKERS = Object.freeze([
  ["Instructure mobile OAuth broker", /mobile_verify/i],
  ["Canvas mobile QR sign-in", /qr_mobile_login|sso\.(?:beta\.|test\.)?canvaslms\.com|QRCodeDetector|\bcode_(?:ios|android)/i],
  ["Canvas token page scraping", /limit_personal_access_tokens|users\/self\/tokens/i],
  ["Canvas access token value", /\b\d{4,5}~[A-Za-z0-9]{64}\b/],
  ["browser cookie store reader", /pycookiecheat|browser_cookie3/i],
  ["Moodle mobile app web service", /moodle_mobile_app|tool_mobile/i],
  ["browser cookie capture or replay", /Network\.getAllCookies|Storage\.getCookies|Network\.getCookies|cookie_header|["']Cookie["']\s*:\s*cookie/i],
]);

/**
 * Files allowed one marker, each for a reason that is not credential capture. The login helper
 * reads cookie expiry times on its private pipe for the session-expiry warning, and returns no
 * cookie name or value; the other files are its tests and the proxy check that keeps the method
 * off the proxy.
 */
const ALLOWED = Object.freeze({
  "browser cookie capture or replay": Object.freeze([
    "morrow-for-muse/helper/server.py",
    "morrow-for-muse/helper/cookie_expiry_selftest.py",
    "morrow-for-muse/helper/helper_selftest.py",
    "morrow-for-muse/scripts/test_install_after_use.py",
    "morrow-for-muse/transport/local_chromium_selftest.py",
  ]),
});

/** Prefixes of removed borrowed-credential code that must stay out of the tree. */
const REMOVED_PATHS = Object.freeze([
  "morrow-for-muse/lanes/",
  "morrow-for-muse/qr-proof/",
  "morrow-for-muse/session/",
]);

/** Each `path:line marker` among `files` whose text carries a marker. */
function borrowedCredentialHits(files, read) {
  const found = [];
  for (const path of files) {
    if (path === SELF || path === RECEIPT) continue;
    for (const prefix of REMOVED_PATHS) {
      if (path.startsWith(prefix)) found.push(`${path} removed path`);
    }
    const contents = read(path);
    if (!isUtf8(contents) || contents.includes(0)) continue;
    const lines = contents.toString("utf8").split("\n");
    for (const [name, pattern] of BORROWED_CREDENTIAL_MARKERS) {
      if (ALLOWED[name]?.includes(path)) continue;
      for (const [index, line] of lines.entries()) {
        if (pattern.test(line)) found.push(`${path}:${index + 1} ${name}`);
      }
    }
  }
  return found;
}

test("the scan finds each marker and a removed path, and passes ordinary credential code and an allowed use", () => {
  const files = {
    "a.py": 'url = base + "/api/v1/mobile_verify.json"\n',
    "b.py": 'page = "/profile/qr_mobile_login"\n',
    "c.js": 'fetch("/api/v1/users/self/tokens")\n',
    "d.txt": `token=1234~${"a".repeat(64)}\n`,
    "e.py": "import browser_cookie3\n",
    "f.php": "service=moodle_mobile_app\n",
    // The deleted rig capture's own lines, moved to a path the removed-path check does not cover.
    "morrow-for-muse/transport/probe.py":
      '    res = cdp_call(target_id, "Network.getCookies", {"urls": [base + "/"]})\n'
      + '        headers={"Cookie": cookie_header,\n',
    "morrow-for-muse/helper/server.py": '    res = self.cdp.call(self.tab, "Network.getCookies", {"urls": [base]})\n',
    "morrow-for-muse/session/capture.py": "pass\n",
    "ok.ts": 'const body = { grant_type: "client_credentials", client_id: config.applicationKey };\n',
  };
  const hits = borrowedCredentialHits(Object.keys(files), (path) => Buffer.from(files[path]));
  assert.deepEqual(hits, [
    "a.py:1 Instructure mobile OAuth broker",
    "b.py:1 Canvas mobile QR sign-in",
    "c.js:1 Canvas token page scraping",
    "d.txt:1 Canvas access token value",
    "e.py:1 browser cookie store reader",
    "f.php:1 Moodle mobile app web service",
    "morrow-for-muse/transport/probe.py:1 browser cookie capture or replay",
    "morrow-for-muse/transport/probe.py:2 browser cookie capture or replay",
    "morrow-for-muse/session/capture.py removed path",
  ]);
});

test("no tracked file carries borrowed-credential code", () => {
  const listed = spawnSync("git", ["-C", repositoryRoot, "ls-files", "-z"], { encoding: "buffer" });
  assert.equal(listed.status, 0, listed.stderr.toString("utf8"));
  const files = listed.stdout.toString("utf8").split("\0").filter(Boolean);
  assert.ok(files.length > 100, "git ls-files must list the repository");
  assert.deepEqual(borrowedCredentialHits(files, (path) => readFileSync(join(repositoryRoot, path))), []);
});
