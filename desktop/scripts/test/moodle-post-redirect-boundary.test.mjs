import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import ts from "@typescript/typescript6";
import { launchTestChromium } from "./lib/chromium-launch.mjs";

const providerFiles = [
  "moodle-executor.js",
  "moodle-qbank-executor.js",
  "moodle-qbank-question-executor.js",
  "moodle-lesson-executor.js",
  "moodle-privacy.js",
];

async function followedPosts() {
  const posts = [];
  let postCount = 0;
  for (const name of providerFiles) {
    const source = await readFile(new URL(`../../connector/extension/src/${name}`, import.meta.url), "utf8");
    const syntax = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["fetch", "nativeFetch"].includes(node.expression.text)) {
        const options = node.arguments[1];
        assert.ok(options && ts.isObjectLiteralExpression(options), `${name}: inspect nonliteral fetch options`);
        if (options && ts.isObjectLiteralExpression(options)) {
          const property = (key) => options.properties.find((entry) => entry.name?.getText(syntax) === key);
          const method = property("method");
          const redirect = property("redirect");
          const followed = !redirect || (ts.isPropertyAssignment(redirect) && redirect.initializer.getText(syntax) === '"follow"');
          const post = method && (ts.isShorthandPropertyAssignment(method)
            || (ts.isPropertyAssignment(method) && method.initializer.getText(syntax) === '"POST"'));
          if (post) {
            postCount += 1;
            assert.ok(followed || (ts.isPropertyAssignment(redirect)
              && ['"error"', '"manual"'].includes(redirect.initializer.getText(syntax))), `${name}: inspect dynamic redirect mode`);
          }
          if (followed && post) {
            const mode = property("mode");
            const line = syntax.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            assert.ok(mode && ts.isPropertyAssignment(mode) && mode.initializer.getText(syntax) === '"same-origin"', `${name}:${line}`);
            let owner = node.parent;
            while (owner && !ts.isVariableDeclaration(owner)) owner = owner.parent;
            const unguardedOptions = ts.factory.updateObjectLiteralExpression(options, options.properties.filter((entry) => entry !== mode));
            const unguarded = ts.factory.updateCallExpression(node, node.expression, node.typeArguments, [node.arguments[0], unguardedOptions]);
            posts.push({ name, line, helper: owner?.name.getText(syntax), helperSource: owner?.getText(syntax), expression: node.getText(syntax),
              unguardedExpression: ts.createPrinter().printNode(ts.EmitHint.Expression, unguarded, syntax) });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(syntax);
  }
  assert.equal(postCount, 12, "inspect every possible Moodle POST in the provider files");
  assert.equal(posts.length, 9, "inspect explicit and default-follow Moodle POSTs");
  return posts;
}

async function callPost(page, post, action, unguarded = false) {
  return page.evaluate(async ({ expression, helper, target }) => {
    const params = helper === "draftFilesAction"
      ? { itemid: "888", filepath: "/", title: "private-body-value" }
      : new URLSearchParams({ sesskey: "fake-session-key", title: "private-body-value" });
    const context = { origin: location.origin, siteUrl: `${location.origin}/`, basePath: "", sesskey: "fake-session-key" };
    const urlFor = (_context, path, query) => {
      const url = new URL(target);
      url.pathname = path;
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
      return url;
    };
    const fixture = {
      form: { action: target }, params, context, urlFor, action: "list", methodName: "core_courseformat_get_state",
      requestUrl: (method) => urlFor(context, "/lib/ajax/service.php", { sesskey: context.sesskey, info: method }).toString(),
      requestSignal: () => AbortSignal.timeout(2_000), input: { expiresAt: Date.now() + 2_000 },
      requestController: { signal: AbortSignal.timeout(2_000) }, body: params,
      creationBody: () => params, args: { courseid: 2, title: "private-body-value" },
      endpoint: target, url: new URL(target),
      method: helper === "requestAjax" ? "core_table_get_dynamic_table_content" : "POST", expiresAt: Date.now() + 2_000,
    };
    const execute = new Function("fixture", `const { form, params, context, urlFor, action, methodName, requestUrl, requestSignal, input, requestController, body, creationBody, args, endpoint, url, method, expiresAt } = fixture; return ${expression};`);
    try {
      const response = await execute(fixture);
      return { status: response.status, redirected: response.redirected, url: response.url, body: await response.text() };
    } catch (error) {
      return { error: error.name };
    }
  }, { expression: unguarded ? post.unguardedExpression : post.expression, helper: post.helper, target: action });
}

async function callHelper(page, post, action, write = true) {
  return page.evaluate(async ({ helper, helperSource, target, write }) => {
    const context = { origin: location.origin, siteUrl: `${location.origin}/`, basePath: "", sesskey: "fake-session-key" };
    const urlFor = (_context, path, query) => {
      const url = new URL(target);
      url.pathname = path;
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
      return url;
    };
    const fixture = {
      context, urlFor, executionExpired: () => false,
      requestSignal: () => AbortSignal.timeout(2_000), input: { expiresAt: Date.now() + 2_000 }, expiresAt: Date.now() + 2_000,
      readText: (response) => response.text(), isObject: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
      sanitize: (value) => value, error: (error) => ({ ok: false, sent: false, error }),
      requestUrl: (method) => urlFor(context, "/lib/ajax/service.php", { sesskey: context.sesskey, info: method }).toString(),
      responseIsSameOrigin: (response, expected) => new URL(response.url).origin === expected.origin,
      sameContext: (left, right) => left === right, currentContext: () => context,
      readBoundedResponse: async (response) => ({ raw: await response.text() }),
    };
    const execute = new Function("fixture", `const { context, urlFor, executionExpired, requestSignal, input, expiresAt, readText, isObject, sanitize, error, requestUrl, responseIsSameOrigin, sameContext, currentContext, readBoundedResponse } = fixture; const ${helperSource}; return ${helper};`)(fixture);
    if (helper === "draftFilesAction") return execute(context, "list", { itemid: "888", filepath: "/" });
    if (helper === "ajax") return execute(context, "core_courseformat_get_state", { courseid: 2 }, write);
    return execute("core_table_get_dynamic_table_content", { courseid: 2 });
  }, { helper: post.helper, helperSource: post.helperSource, target: action, write });
}

async function listen(server) {
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("all followed Moodle POSTs keep session keys and request bodies inside their origin", async () => {
  const posts = await followedPosts();
  const foreignRequests = [];
  const nativeRequests = [];
  const foreign = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    foreignRequests.push({ method: request.method, body });
    response.writeHead(request.method === "OPTIONS" ? 204 : 200, {
      "access-control-allow-origin": request.headers.origin || "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "POST, GET, OPTIONS",
      "access-control-allow-headers": request.headers["access-control-request-headers"] || "content-type",
    });
    response.end("foreign");
  });
  const foreignOrigin = await listen(foreign);
  const native = createServer(async (request, response) => {
    const url = new URL(request.url, "http://fixture");
    let body = "";
    for await (const chunk of request) body += chunk;
    nativeRequests.push({ path: url.pathname, method: request.method, body });
    if (url.searchParams.has("status")) {
      const status = Number(url.searchParams.get("status"));
      const location = url.searchParams.get("foreign") === "1" ? `${foreignOrigin}/sink` : `/saved?kind=${url.searchParams.get("kind") || "form"}`;
      response.writeHead(status, { location });
      response.end();
      return;
    }
    const kind = url.searchParams.get("kind");
    response.writeHead(200, { "content-type": kind ? "application/json" : "text/html" });
    response.end(kind === "draftFilesAction" ? JSON.stringify({ filecount: 0, list: [] })
      : kind === "ajax" || kind === "requestAjax" ? JSON.stringify([{ data: { title: "saved" } }]) : "saved");
  });
  const nativeOrigin = await listen(native);
  let browser;
  try {
    browser = await launchTestChromium();
    const page = await browser.newPage();
    await page.goto(nativeOrigin);
    for (const post of posts) {
      for (const status of [307, 308]) {
        const action = `${nativeOrigin}/form?status=${status}&foreign=1`;
        const result = await callPost(page, post, action);
        assert.deepEqual(result, { error: "TypeError" }, `${post.name}:${post.line} status ${status}`);
        assert.deepEqual(foreignRequests, [], `${post.name}:${post.line} must send no foreign request`);

        await callPost(page, post, action, true);
        const leaked = foreignRequests.filter((entry) => entry.method === "POST");
        assert.equal(leaked.length, 1, `${post.name}:${post.line} negative control must reach the foreign POST sink`);
        assert.ok(leaked[0].body.includes("fake-session-key") || leaked[0].body.includes("private-body-value"));
        foreignRequests.length = 0;
      }
      for (const status of [303, 307]) {
        const action = `${nativeOrigin}/form?status=${status}`;
        const result = await callPost(page, post, action);
        assert.deepEqual(result, { status: 200, redirected: true, url: `${nativeOrigin}/saved?kind=form`, body: "saved" });
        assert.equal(nativeRequests.at(-1).method, status === 303 ? "GET" : "POST");
      }
    }
    const helpers = posts.filter((post) => ["draftFilesAction", "ajax", "requestAjax"].includes(post.helper));
    assert.equal(helpers.length, 3, "exercise all default-follow request helpers");
    for (const post of helpers) {
      for (const status of [307, 308]) {
        const action = `${nativeOrigin}/form?status=${status}&foreign=1&kind=${post.helper}`;
        const result = await callHelper(page, post, action);
        if (post.helper === "draftFilesAction") assert.equal(result, null);
        else if (post.helper === "ajax") {
          assert.deepEqual(result, { ok: false, sent: true, outcomeUnknown: true, error: "moodle_ajax_request_failed" });
          assert.deepEqual(await callHelper(page, post, action, false), { ok: false, sent: false, outcomeUnknown: false, error: "moodle_ajax_request_failed" });
        } else assert.deepEqual(result, { error: "moodle_roster_request_failed" });
        assert.deepEqual(foreignRequests, [], `${post.helper}: failure must precede foreign dispatch`);
      }
      for (const status of [303, 307]) {
        const action = `${nativeOrigin}/form?status=${status}&kind=${post.helper}`;
        const result = await callHelper(page, post, action);
        if (post.helper === "draftFilesAction") assert.deepEqual(result, { filecount: 0, list: [] });
        else if (post.helper === "ajax") assert.deepEqual(result, { ok: true, sent: true, status: 200, data: { title: "saved" } });
        else assert.deepEqual(result, { data: { title: "saved" } });
        assert.equal(nativeRequests.at(-1).method, status === 303 ? "GET" : "POST");
      }
    }
    const source = await readFile(new URL("../../connector/extension/src/moodle-executor.js", import.meta.url), "utf8");
    const start = source.indexOf("  const postForm = async (form) => {");
    const end = source.indexOf("\n  const courseTarget = ", start);
    const result = await page.evaluate(async ({ source, action }) => {
      const context = {};
      const form = { context, action, nativeSesskey: "fake-session-key", snapshot_digest: "same", submit: { name: "submitbutton", value: "Save" }, fileManagers: [], formData: new Map([["sesskey", "fake-session-key"], ["title", "Reviewed title"]]) };
      const postForm = new Function("currentContext", "sameContext", "loadForm", "error", "executionExpired", "requestSignal", "input", "readText", "isSameFormValidation", `${source}\nreturn postForm;`)(() => context, () => true, async () => ({ ...form, ok: true }), (error) => ({ ok: false, sent: false, error }), () => false, () => AbortSignal.timeout(2_000), {}, (response) => response.text(), () => false);
      return postForm(form);
    }, { source: source.slice(start, end), action: `${nativeOrigin}/form?status=307&foreign=1` });
    assert.equal(result.ok, false);
    assert.equal(result.sent, true);
    assert.equal(result.outcomeUnknown, true);
    assert.equal(result.verification.status, "unconfirmed");
    assert.deepEqual(foreignRequests, []);
  } finally {
    await browser?.close();
    await close(native);
    await close(foreign);
  }
});
