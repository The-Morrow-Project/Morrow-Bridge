import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInThisContext } from "node:vm";
import { canvasOperationAdmission } from "../../connector/extension/generated/canvas-operation-admission.js";

const ORIGIN = "https://school.instructure.com";
const SOURCE = readFileSync(new URL("../../connector/extension/src/canvas-content.js", import.meta.url), "utf8");
const CATALOG = JSON.parse(readFileSync(new URL("../../artifacts/canvas-api/canvas-api-catalog.json", import.meta.url), "utf8"));
const TOOLS = ["canvas_create_single_rubric", "canvas_update_single_rubric"];
const courseJoin = { id: "98", rubric_id: "77", association_type: "Course", association_id: "42" };
const assignmentJoin = { id: "99", rubric_id: "77", association_type: "Assignment", association_id: "888" };

function savedRubric(overrides = {}) {
  return { id: "77", context_type: "Course", context_id: "42", title: "Reviewed rubric", associations: [courseJoin, assignmentJoin], ...overrides };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function execute(toolName, {
  args = {}, rubric = savedRubric(), rubricStatus = 200,
  assignment = { id: "888", course_id: "42" }, assignmentStatus = 200,
  principalChanged = false, courseUnavailable = false,
} = {}) {
  const keys = ["location", "document", "fetch", "chrome", "__morrowCanvasConnectorInstalled"];
  const descriptors = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const operation = CATALOG.operations.find((entry) => entry.toolName === toolName);
  assert.ok(operation);
  const admission = canvasOperationAdmission(operation);
  assert.equal(admission.authority, "course");
  const requests = [];
  const listeners = [];
  let profiles = 0;
  let courses = 0;
  const values = {
    location: { origin: ORIGIN, pathname: "/courses/42/rubrics" },
    document: { cookie: "_csrf_token=csrf-value" },
    fetch: async (input, options = {}) => {
      const url = new URL(String(input?.href ?? input), ORIGIN);
      const request = { pathname: url.pathname, search: url.search, method: options.method || "GET", options };
      requests.push(request);
      if (url.pathname === "/api/v1/users/self/profile") {
        profiles += 1;
        return jsonResponse({ id: principalChanged && profiles > 1 ? "8" : "7", name: "Teacher" });
      }
      if (url.pathname === "/api/v1/courses/42") {
        courses += 1;
        return jsonResponse({ id: "42", name: "Biology" }, courseUnavailable && courses > 1 ? 403 : 200);
      }
      if (request.method !== "GET") return jsonResponse({ rubric: savedRubric(), rubric_association: assignmentJoin });
      if (url.pathname === "/api/v1/courses/42/rubrics/77") return jsonResponse(rubric, rubricStatus);
      if (url.pathname === "/api/v1/courses/42/assignments/888") return jsonResponse(assignment, assignmentStatus);
      throw new Error(`Unexpected request: ${request.method} ${url.pathname}`);
    },
    chrome: { runtime: { onMessage: { addListener: (listener) => listeners.push(listener) } } },
    __morrowCanvasConnectorInstalled: undefined,
  };
  try {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    delete globalThis.__morrowCanvasConnectorInstalled;
    runInThisContext(SOURCE, { filename: "canvas-content.js" });
    assert.equal(listeners.length, 1);
    const result = await new Promise((resolve, reject) => {
      const handled = listeners[0]({
        type: "morrow_canvas_execute",
        operation: { ...operation, morrowCourseTarget: admission.courseTarget },
        arguments: { course_id: "42", ...(operation.method === "PUT" ? { id: "77" } : {}), rubric_title: "Reviewed rubric", ...args },
        principalId: "7", expiresAt: Date.now() + 60_000, courseId: "42",
      }, null, resolve);
      if (handled !== true) reject(new Error("Execute message was not accepted"));
    });
    return { result, requests, writes: requests.filter((request) => request.method !== "GET") };
  } finally {
    for (const key of keys) {
      const descriptor = descriptors.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test("rubric writes preserve valid same-course targets and refresh authority after preflight", async () => {
  for (const toolName of TOOLS) {
    for (const association of [
      { rubric_association_association_type: "Course", rubric_association_association_id: "42" },
      { rubric_association_association_type: "Assignment", rubric_association_association_id: "888" },
      { id: "77", rubric_association_id: "99" },
    ]) {
      const { result, requests, writes } = await execute(toolName, { args: association });
      assert.equal(result.ok, true, `${toolName} ${JSON.stringify(association)}`);
      assert.equal(writes.length, 1);
      assert.deepEqual(requests.slice(-3).map((request) => request.pathname), [
        "/api/v1/users/self/profile", "/api/v1/courses/42", writes[0].pathname,
      ]);
      for (const request of requests.filter((request) => request.method === "GET")) {
        assert.equal(request.options.cache, "no-store");
        assert.equal(request.options.redirect, "error");
        assert.equal(request.options.credentials, "include");
      }
      const rubricRead = requests.find((request) => request.method === "GET" && request.pathname.endsWith("/rubrics/77"));
      if (rubricRead) assert.equal(new URLSearchParams(rubricRead.search).get("include[]"), "associations");
    }
  }
});

test("rubric free-form comment booleans use Canvas's checkbox values", async () => {
  for (const toolName of TOOLS) {
    for (const [approved, expected] of [[true, "1"], [false, "0"]]) {
      const { result, writes } = await execute(toolName, { args: { rubric_free_form_criterion_comments: approved } });
      assert.equal(result.ok, true);
      assert.equal(new URLSearchParams(writes[0].options.body).get("rubric[free_form_criterion_comments]"), expected);
    }
  }
});

test("rubric explicit targets outside the selected course stop before any write", async () => {
  for (const toolName of TOOLS) {
    for (const options of [
      { args: { rubric_association_association_type: "Course", rubric_association_association_id: "43" } },
      { args: { rubric_association_association_type: "Assignment", rubric_association_association_id: "888" }, assignment: { id: "888", course_id: "43" } },
      { args: { rubric_association_association_type: "Assignment", rubric_association_association_id: "888" }, assignment: { id: "889", course_id: "42" } },
      { args: { rubric_association_association_type: "Assignment", rubric_association_association_id: "888" }, assignment: { id: "888" } },
    ]) {
      const { result, writes } = await execute(toolName, options);
      assert.deepEqual(result, { ok: false, sent: false, error: "canvas_rubric_course_mismatch" });
      assert.equal(writes.length, 0);
    }
  }
});

test("rubric ownership read failures stop before any write", async () => {
  for (const toolName of TOOLS) {
    for (const options of [
      { args: { rubric_association_association_type: "Assignment", rubric_association_association_id: "888" }, assignmentStatus: 403 },
      { args: { id: "77" }, rubricStatus: 404 },
      { args: { id: "77" }, rubric: savedRubric({ associations: undefined }) },
    ]) {
      const { result, writes } = await execute(toolName, options);
      assert.deepEqual(result, { ok: false, sent: false, error: "canvas_rubric_scope_unconfirmed" });
      assert.equal(writes.length, 0);
    }
  }
});

test("rubric edits cannot affect existing associations in another course", async () => {
  for (const toolName of TOOLS) {
    for (const options of [
      { rubric: savedRubric({ context_id: "43" }) },
      { rubric: savedRubric({ context_type: "Account" }) },
      { rubric: savedRubric({ associations: [assignmentJoin, { ...courseJoin, association_id: "43" }] }) },
      { assignment: { id: "888", course_id: "43" } },
    ]) {
      const { result, writes } = await execute(toolName, { ...options, args: { id: "77" } });
      assert.deepEqual(result, { ok: false, sent: false, error: "canvas_rubric_course_mismatch" });
      assert.equal(writes.length, 0);
    }
  }
});

test("rubric join records must resolve once on the exact fresh rubric", async () => {
  for (const toolName of TOOLS) {
    for (const options of [
      { args: { id: "77", rubric_association_id: "100" } },
      { args: { id: "77", rubric_association_id: "99" }, rubric: savedRubric({ associations: [assignmentJoin, assignmentJoin] }) },
      { args: { id: "77", rubric_association_id: "99" }, rubric: savedRubric({ associations: [{ ...assignmentJoin, rubric_id: "78" }] }) },
      { args: { rubric_association_association_type: "Account", rubric_association_association_id: "42" } },
      { args: { rubric_association_association_id: "888" } },
    ]) {
      const { result, writes } = await execute(toolName, options);
      assert.deepEqual(result, { ok: false, sent: false, error: "canvas_rubric_association_unresolved" });
      assert.equal(writes.length, 0);
    }
  }
  const { result, writes } = await execute(TOOLS[0], { args: { rubric_association_id: "99" } });
  assert.deepEqual(result, { ok: false, sent: false, error: "canvas_rubric_association_unresolved" });
  assert.equal(writes.length, 0);
});

test("rubric writes stop if principal or course access changes after preflight", async () => {
  for (const toolName of TOOLS) {
    for (const [options, error] of [[{ principalChanged: true }, "canvas_principal_changed"], [{ courseUnavailable: true }, "canvas_course_http_403"]]) {
      const { result, writes } = await execute(toolName, options);
      assert.deepEqual(result, { ok: false, sent: false, error });
      assert.equal(writes.length, 0);
    }
  }
});
