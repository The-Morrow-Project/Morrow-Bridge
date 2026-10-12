import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInThisContext } from "node:vm";
import { canvasOperationAdmission, canvasReadbackAssessment } from "../../connector/extension/generated/canvas-operation-admission.js";
import { categoriesForBinding } from "../../connector/extension/src/edit-policy.js";

const WORKER_SOURCE = readFileSync(new URL("../../connector/extension/src/service-worker.js", import.meta.url), "utf8");
const CATALOG = JSON.parse(readFileSync(new URL("../../connector/extension/generated/canvas-api-catalog.json", import.meta.url), "utf8"));
const canvasOperations = CATALOG.operations.map((operation) => ({ ...operation, provider: "canvas" }));

function operation(toolName) {
  const value = canvasOperations.find((entry) => entry.toolName === toolName);
  assert.ok(value, `missing Canvas operation ${toolName}`);
  return value;
}

// The worker redacts bearer secrets from session-credential results before they are handed back.
// The region runs here with the real admission classifier, so the test proves the wiring: the
// same classifier that names the operation also triggers the redaction.
function redactor() {
  const start = WORKER_SOURCE.indexOf("function withoutTokenSecretFields(value) {");
  const mid = WORKER_SOURCE.indexOf("function withoutSessionCredentialSecrets(result, operation) {");
  const end = WORKER_SOURCE.indexOf("\n}", mid) + 3;
  assert.ok(start > 0 && mid > start && end > mid, "the credential redaction moved in service-worker.js");
  const body = WORKER_SOURCE.slice(start, end);
  const script = [
    "globalThis.__morrowCredentialRedaction = (() => {",
    "const canvasOperationAdmission = globalThis.__morrowRealAdmission;",
    body,
    "return { withoutSessionCredentialSecrets };",
    "})();",
  ].join("\n");
  globalThis.__morrowRealAdmission = canvasOperationAdmission;
  try {
    runInThisContext(script, { filename: "service-worker-credential-region.js" });
    const value = globalThis.__morrowCredentialRedaction;
    delete globalThis.__morrowCredentialRedaction;
    return value;
  } finally {
    delete globalThis.__morrowRealAdmission;
  }
}

test("every write that mints, regenerates, or returns a credential is held before dispatch and never offered", () => {
  const options = categoriesForBinding({ provider: "canvas" }, canvasOperations);
  const minting = [
    "canvas_create_access_token", "canvas_update_access_token", "canvas_create_jwt", "canvas_refresh_jwt",
    "canvas_deprecated_create_instaccess_token", "canvas_get_pandata_events_jwt_token_and_its_expiration_date",
    "canvas_start_kaltura_session", "canvas_create_observer_pairing_code", "canvas_regenerate_developer_key_secret",
    "canvas_create_developer_key", "canvas_create_lti_registration_lti_registrations", "canvas_create_lti_registration_apps",
  ];
  assert.deepEqual(canvasOperations.filter((entry) => canvasOperationAdmission(entry).write.reason === "mints_a_credential")
    .map((entry) => entry.toolName).sort(), [...minting].sort());
  for (const toolName of minting) {
    const admission = canvasOperationAdmission(operation(toolName));
    assert.deepEqual(admission.write, { state: "held", reason: "mints_a_credential" }, toolName);
    assert.deepEqual(canvasReadbackAssessment(canvasOperations, operation(toolName)), { state: "not_applicable", reason: "write_held" }, toolName);
    assert.equal(options.find((entry) => entry.id === `action:canvas:${toolName}`), undefined, toolName);
  }
  assert.equal(canvasOperationAdmission(operation("canvas_create_access_token")).siteClass, "session_credential");
});

test("a minted bearer secret never reaches a result handed back", () => {
  const { withoutSessionCredentialSecrets } = redactor();
  const minted = {
    ok: true,
    data: {
      id: "9", user_id: "7", purpose: "morrow", expires_at: null,
      token: "1~Op9a2wX0H6pQ bearer secret",
      nested: { token: "nested secret", id: "9" },
      list: [{ token: "listed secret" }, { id: "1" }],
    },
  };
  for (const toolName of ["canvas_create_access_token", "canvas_create_jwt", "canvas_refresh_jwt"]) {
    const redacted = withoutSessionCredentialSecrets(minted, operation(toolName));
    assert.equal(JSON.stringify(redacted).includes("secret"), false, toolName);
    assert.equal(redacted.data.id, "9", toolName);
    assert.deepEqual(redacted.data.nested, { id: "9" }, toolName);
    assert.deepEqual(redacted.data.list, [{}, { id: "1" }], toolName);
  }
});

test("redaction touches only session-credential results", () => {
  const { withoutSessionCredentialSecrets } = redactor();
  const data = { id: "9", token: "not-a-credential-context" };
  const kept = withoutSessionCredentialSecrets({ ok: true, data }, operation("canvas_create_assignment"));
  assert.equal(kept.data.token, "not-a-credential-context");
  const moodle = withoutSessionCredentialSecrets({ ok: true, data }, { provider: "moodle", toolName: "moodle_update_assignment" });
  assert.equal(moodle.data.token, "not-a-credential-context");
  const noData = withoutSessionCredentialSecrets({ ok: false, error: "x" }, operation("canvas_create_access_token"));
  assert.deepEqual(noData, { ok: false, error: "x" });
});
