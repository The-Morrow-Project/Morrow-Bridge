import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const EXTENSION_ID = "abeloclekioohahgedmjcdbpllfjfhko";
const CATALOG_PREFIX = `chrome-extension://${EXTENSION_ID}/`;

globalThis.fetch = async (input) => {
  const url = String(input);
  const name = url.startsWith(CATALOG_PREFIX) ? url.slice(CATALOG_PREFIX.length) : "";
  if (!name.startsWith("generated/")) throw new Error(`unexpected request to ${url}`);
  const body = readFileSync(new URL(`connector/extension/${name}`, root), "utf8");
  return new Response(body, { headers: { "content-type": "application/json" } });
};

class ClosedSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static attempts = 0;
  constructor() { this.readyState = ClosedSocket.CONNECTING; ClosedSocket.attempts += 1; }
  send() {}
  close() {}
}
globalThis.WebSocket = ClosedSocket;

function event() {
  return { addListener() {}, removeListener() {}, hasListener: () => false };
}

function storageArea(initial = {}) {
  const values = new Map(Object.entries(structuredClone(initial)));
  return {
    values,
    get: async (keys) => {
      const names = keys === undefined || keys === null
        ? [...values.keys()]
        : Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : Object.keys(keys);
      const result = {};
      for (const name of names) {
        if (values.has(name)) result[name] = structuredClone(values.get(name));
        else if (keys && typeof keys === "object" && !Array.isArray(keys) && Object.hasOwn(keys, name)) result[name] = structuredClone(keys[name]);
      }
      return result;
    },
    set: async (next) => {
      for (const [name, value] of Object.entries(next)) values.set(name, structuredClone(value));
    },
    remove: async (keys) => {
      for (const name of Array.isArray(keys) ? keys : [keys]) values.delete(name);
    },
  };
}

function fixture({ local = {}, session = {}, framesByTab = {}, canvasProfile = null } = {}) {
  const tab = { id: 9, windowId: 4, url: "https://school.instructure.com/courses/42" };
  const localArea = storageArea({ morrowCourseDataConsent: "morrow.course-data-consent.v1", ...local });
  const sessionArea = storageArea(session);
  const granted = new Set(["https://school.instructure.com/*"]);
  const records = { createdTabs: [], removedTabs: [], scripts: [], messages: [] };
  return {
    records,
    localArea,
    sessionArea,
    api: {
      runtime: {
        id: EXTENSION_ID,
        getURL: (path) => `${CATALOG_PREFIX}${path}`,
        getManifest: () => ({ version: "1.0.2" }),
        sendMessage: async () => undefined,
        openOptionsPage: async () => undefined,
        onMessage: { addListener: (handler) => { messageHandler = handler; } },
        onStartup: event(),
        onInstalled: event(),
      },
      storage: { local: localArea, session: sessionArea, onChanged: event() },
      management: { getSelf: async () => ({ id: EXTENSION_ID, version: "1.0.2", installType: "development" }) },
      alarms: { create: async () => undefined, clear: async () => true, onAlarm: event() },
      permissions: {
        contains: async ({ origins }) => origins.every((origin) => granted.has(origin)),
        remove: async () => true,
        getAll: async () => ({ origins: [...granted] }),
        onAdded: event(),
      },
      tabs: {
        get: async (id) => {
          if (id !== tab.id) throw new Error("missing tab");
          return { ...tab };
        },
        query: async () => [{ ...tab }],
        sendMessage: async (tabId, message) => {
          records.messages.push({ tabId, type: message?.type });
          return message?.type === "morrow_canvas_probe" && canvasProfile
            ? { ok: true, profile: canvasProfile }
            : { ok: false };
        },
        create: async (options) => {
          records.createdTabs.push(structuredClone(options));
          return { id: 101 };
        },
        update: async (id, options) => ({ id, ...options }),
        remove: async (id) => { records.removedTabs.push(id); },
        onRemoved: event(),
        onUpdated: event(),
      },
      scripting: {
        executeScript: async (injection) => {
          records.scripts.push({ files: injection.files ? [...injection.files] : null, world: injection.world || null });
          return injection.files ? [{ result: null }] : [{ result: { ok: false } }];
        },
      },
      webNavigation: {
        getAllFrames: async ({ tabId }) => structuredClone(framesByTab[tabId] || []),
        onCommitted: event(),
      },
      webRequest: { onBeforeSendHeaders: event(), onBeforeRequest: event(), onHeadersReceived: event() },
    },
  };
}

let messageHandler = null;
function install(value) {
  globalThis.chrome = value.api;
  return value;
}

install(fixture());
await import("../../connector/extension/src/service-worker.js");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(typeof messageHandler, "function");

function send(message, sender = { id: EXTENSION_ID, url: `${CATALOG_PREFIX}popup/popup.html` }) {
  return new Promise((resolve, reject) => {
    if (messageHandler(message, sender, resolve) !== true) reject(new Error(`no response for ${message.type}`));
  });
}

test("only a consented popup can retry a saved Bridge connection", async () => {
  const popup = { id: EXTENSION_ID, url: `${CATALOG_PREFIX}popup/popup.html` };
  const otherPage = { id: EXTENSION_ID, url: `${CATALOG_PREFIX}settings/settings.html` };
  install(fixture({ local: { token: "saved-pairing", morrowCourseDataConsent: null } }));
  const before = ClosedSocket.attempts;
  const noConsent = await send({ type: "morrow_reconnect" }, popup);
  assert.equal(noConsent.ok, false);
  assert.equal(noConsent.code, "course_data_consent_required");
  assert.equal(ClosedSocket.attempts, before);

  install(fixture({ local: { token: "saved-pairing" } }));
  const wrongSender = await send({ type: "morrow_reconnect" }, otherPage);
  assert.equal(wrongSender.ok, false);
  assert.equal(ClosedSocket.attempts, before);
  const allowed = await send({ type: "morrow_reconnect" }, popup);
  assert.equal(allowed.ok, true);
  assert.equal(ClosedSocket.attempts, before + 1);
});

test("course permission preparation never opens an optional Item Banks launch", async () => {
  const value = install(fixture({
    framesByTab: {
      9: [
        { frameId: 0, url: "https://school.instructure.com/courses/42/external_tools/71234" },
        { frameId: 7, url: "https://school.quiz-lti-iad-prod.instructure.com/lti/launch" },
      ],
      101: [
        { frameId: 0, url: "https://school.instructure.com/courses/42/external_tools/71234" },
        { frameId: 7, url: "https://school.quiz-lti-iad-prod.instructure.com/lti/launch" },
      ],
    },
  }));

  const answer = await send({ type: "morrow_connect_course_prepare", tabId: 9 });

  assert.equal(answer.ok, true);
  assert.deepEqual(answer.result.origins, [
    "https://school.instructure.com/*",
    "https://school.quiz-lti-iad-prod.instructure.com/*",
    "https://school.quiz-api-iad-prod.instructure.com/*",
  ]);
  assert.deepEqual(value.records.createdTabs, []);
  assert.deepEqual(value.records.removedTabs, []);
});

test("a same-origin Moodle login tab yields to a tab that proves the saved account", async () => {
  const origin = "https://moodle.example.edu";
  const anchor = {
    siteAnchorId: "moodle:site-recovery", provider: "moodle", origin, siteUrl: `${origin}/`,
    principalId: "7", principalFingerprint: "f".repeat(64), sessionGeneration: 3,
    tabId: 1, lastSeenAt: Date.now(),
  };
  const binding = { ...anchor, sourceBindingId: `${anchor.siteAnchorId}:c42`, courseId: "42", courseName: "Anatomy", runtimeVerified: true };
  const cases = [
    { label: "the saved account", profile: { siteUrl: anchor.siteUrl, principalId: anchor.principalId }, verified: true },
    { label: "another account", profile: { siteUrl: anchor.siteUrl, principalId: "8" }, verified: false },
    { label: "another Moodle site on the same host", profile: { siteUrl: `${origin}/other/`, principalId: anchor.principalId }, verified: false },
  ];
  for (const { label, profile, verified } of cases) {
    const value = install(fixture({ local: { siteAnchors: [anchor], bindings: [binding] } }));
    const tabs = [
      { id: 1, url: `${origin}/login/index.php` },
      { id: 2, url: `${origin}/course/view.php?id=42`, active: true },
    ];
    const probes = [];
    value.api.permissions.contains = async () => true;
    value.api.tabs.get = async (id) => ({ ...tabs.find((tab) => tab.id === id) });
    value.api.tabs.query = async () => tabs.map((tab) => ({ ...tab }));
    value.api.scripting.executeScript = async (injection) => {
      probes.push(injection.target.tabId);
      return [{ result: injection.target.tabId === 1 ? { ok: false } : { ok: true, profile } }];
    };
    const answer = await send({ type: "morrow_status" });
    assert.equal(answer.ok, true, label);
    assert.equal(answer.result.bindings[0].runtimeVerified, verified, label);
    assert.equal(value.localArea.values.get("siteAnchors")[0].tabId, verified ? 2 : 1, label);
    assert.ok(probes.includes(2), `${label}: the signed-in candidate was never probed`);
    assert.deepEqual(value.records.createdTabs, [], label);
  }
});

test("a Moodle reattachment refuses an anchor replaced while its account probe is pending", async () => {
  const origin = "https://moodle.example.edu";
  for (const changed of [{ siteUrl: `${origin}/other/` }, { principalFingerprint: "e".repeat(64) }, { sessionGeneration: 4 }]) {
    const anchor = {
      siteAnchorId: "moodle:site-replaced", provider: "moodle", origin, siteUrl: `${origin}/`,
      principalId: "7", principalFingerprint: "f".repeat(64), sessionGeneration: 3, tabId: 1, lastSeenAt: Date.now(),
    };
    const binding = { ...anchor, sourceBindingId: `${anchor.siteAnchorId}:c42`, courseId: "42", runtimeVerified: true };
    const value = install(fixture({ local: { siteAnchors: [anchor], bindings: [binding] } }));
    value.api.permissions.contains = async () => true;
    value.api.tabs.get = async () => ({ id: 1, url: `${origin}/login/index.php` });
    value.api.tabs.query = async () => [{ id: 2, url: `${origin}/course/view.php?id=42`, active: true }];
    value.api.scripting.executeScript = async ({ target }) => {
      if (target.tabId === 1) return [{ result: { ok: false } }];
      await value.localArea.set({ siteAnchors: [{ ...anchor, ...changed }] });
      return [{ result: { ok: true, profile: { siteUrl: anchor.siteUrl, principalId: anchor.principalId } } }];
    };
    const answer = await send({ type: "morrow_status" });
    assert.equal(answer.ok, true);
    assert.equal(answer.result.bindings[0].runtimeVerified, false);
    assert.deepEqual(value.localArea.values.get("siteAnchors"), [{ ...anchor, ...changed }]);
  }
});

test("a same-origin Moodle anchor without host permission never probes or reattaches", async () => {
  const origin = "https://moodle.example.edu";
  const anchor = {
    siteAnchorId: "moodle:site-no-permission", provider: "moodle", origin, siteUrl: `${origin}/`,
    principalId: "7", principalFingerprint: "f".repeat(64), sessionGeneration: 3, tabId: 1, lastSeenAt: Date.now(),
  };
  const binding = { ...anchor, sourceBindingId: `${anchor.siteAnchorId}:c42`, courseId: "42", runtimeVerified: true };
  const value = install(fixture({ local: { siteAnchors: [anchor], bindings: [binding] } }));
  value.api.permissions.contains = async () => false;
  value.api.tabs.query = async () => { throw new Error("permission must be checked before querying candidates"); };
  value.api.scripting.executeScript = async () => { throw new Error("permission must be checked before probing"); };
  const answer = await send({ type: "morrow_status" });
  assert.equal(answer.ok, true);
  assert.equal(answer.result.bindings[0].runtimeVerified, false);
  assert.equal(value.localArea.values.get("siteAnchors")[0].tabId, 1);
});

test("checking the same Canvas account rotates its session and migrates selected courses and Edit policy", async () => {
  const encoder = new TextEncoder();
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode("canvas\0https://school.instructure.com\0principal-7"));
  const fingerprint = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const siteAnchorId = `canvas:${fingerprint.slice(0, 20)}:g3`;
  const anchor = {
    siteAnchorId,
    provider: "canvas",
    origin: "https://school.instructure.com",
    principalFingerprint: fingerprint,
    principalId: "principal-7",
    sessionGeneration: 3,
    runtimeVerified: true,
    lastSeenAt: 1_000,
    tabId: 9,
  };
  const binding = {
    sourceBindingId: `${siteAnchorId}:c42`,
    siteAnchorId,
    provider: "canvas",
    origin: anchor.origin,
    principalFingerprint: fingerprint,
    principalId: anchor.principalId,
    sessionGeneration: 3,
    courseId: "42",
    courseName: "Biology",
    runtimeVerified: true,
    lastSeenAt: 1_000,
  };
  const discovery = {
    schema: "morrow.course-discovery.v1",
    siteAnchorId,
    provider: "canvas",
    origin: anchor.origin,
    principalFingerprint: fingerprint,
    sessionGeneration: 3,
    marker: "old-session",
  };
  const value = install(fixture({
    local: { siteAnchors: [anchor], bindings: [binding], editPolicies: {}, editPolicyRevisions: {} },
    canvasProfile: { id: "principal-7", origin: anchor.origin },
  }));
  const settingsSender = { id: EXTENSION_ID, url: `${CATALOG_PREFIX}settings/settings.html` };
  const options = await send({ type: "morrow_edit_policy_options", sourceBindingId: binding.sourceBindingId }, settingsSender);
  const category = options.result.options.find((candidate) => candidate.availability === "edit");
  assert.ok(category, "the Canvas binding exposes no Edit category for this regression");
  const savedPolicy = await send({
    type: "morrow_edit_policy_save",
    sourceBindingId: binding.sourceBindingId,
    enabledCategories: [category.id],
  }, settingsSender);
  assert.equal(savedPolicy.ok, true);
  await value.sessionArea.set({ courseDiscoveries: { "discovery:old-session": discovery } });

  const answer = await send({ type: "morrow_connect_course", tabId: 9 });

  assert.equal(answer.ok, true);
  assert.notEqual(answer.result.siteAnchorId, siteAnchorId);
  assert.equal(answer.result.sessionGeneration, 4);
  const savedAnchors = value.localArea.values.get("siteAnchors");
  const savedBindings = value.localArea.values.get("bindings");
  const migratedBindingId = `${answer.result.siteAnchorId}:c42`;
  assert.equal(savedAnchors.length, 1);
  assert.equal(savedAnchors[0].tabId, 9);
  assert.equal(savedAnchors[0].sessionGeneration, 4);
  assert.equal(savedBindings.length, 1);
  assert.equal(savedBindings[0].sourceBindingId, migratedBindingId);
  assert.equal(savedBindings[0].sessionGeneration, 4);
  assert.equal(savedBindings[0].courseId, "42");
  assert.equal(savedBindings[0].courseName, "Biology");
  const policies = value.localArea.values.get("editPolicies");
  assert.equal(Object.hasOwn(policies, binding.sourceBindingId), false);
  assert.deepEqual(policies[migratedBindingId].enabledCategories, [category.id]);
  assert.equal(policies[migratedBindingId].revision, savedPolicy.result.editPermission.revision);
  assert.equal(policies[migratedBindingId].expiresAt, savedPolicy.result.editPermission.expiresAt);
  assert.deepEqual(value.sessionArea.values.get("courseDiscoveries"), {});
  const migratedOptions = await send({ type: "morrow_edit_policy_options", sourceBindingId: migratedBindingId }, settingsSender);
  assert.deepEqual(migratedOptions.result.editPermission, policies[migratedBindingId]);
});
