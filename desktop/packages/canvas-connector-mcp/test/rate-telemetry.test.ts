import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import { loadCanvasApiCatalog } from "@morrow/canvas-api-catalog";
import type { JsonObject } from "@morrow/contracts";
import { INTERNAL_SOURCE_CAPABILITY_META, normalizeUpstreamResult } from "@morrow/gateway-core";
import { createCanvasConnectorMcpServer } from "../src/server.js";
import type { CanvasConnectorRuntime } from "../src/runtime.js";

const toolName = "canvas_get_single_assignment";
const sourceCapability = "a".repeat(64);
const catalog = loadCanvasApiCatalog(resolve("../../artifacts/canvas-api/canvas-api-catalog.json"));

async function connectorResult(value: JsonObject): Promise<JsonObject> {
  const handlers = new Map<string, (...args: any[]) => Promise<JsonObject>>();
  vi.spyOn(McpServer.prototype, "registerTool").mockImplementation(((name: string, _config: unknown, callback: (...args: any[]) => Promise<JsonObject>) => {
    handlers.set(name, callback);
    return {};
  }) as any);
  const runtime = {
    catalog: { ...catalog, operations: catalog.operations.filter((operation) => operation.toolName === toolName) },
    canvasBrowserCatalog: { operations: [] }, moodleCatalog: { operations: [] },
    bindings: () => [], canvasBindings: () => [], call: vi.fn(async () => value), privacyRoster: async () => [],
  } as unknown as CanvasConnectorRuntime;
  createCanvasConnectorMcpServer(runtime, { internalSourceCapability: sourceCapability });
  return handlers.get(toolName)!({ course_id: "42", id: "88" }, {
    mcpReq: { _meta: { [INTERNAL_SOURCE_CAPABILITY_META]: sourceCapability }, signal: new AbortController().signal },
  });
}

function browserResponse(requestCost: unknown, rateLimitRemaining: unknown, provider = "canvas"): JsonObject {
  return {
    schema: "morrow.canvas-connector.result.v1", ok: true, provider, toolName, commandKind: "invoke_read",
    result: {
      schema: "morrow.canvas-browser-result.v1", ok: true, sent: true, status: 200,
      data: { id: "88", name: "Assignment" }, requestCost, rateLimitRemaining,
    },
  } as JsonObject;
}

afterEach(() => vi.restoreAllMocks());

describe("Canvas response rate telemetry", () => {
  it("promotes browser header strings to bounded numeric gateway metadata and retains the source result", async () => {
    const value = browserResponse("0.087", "699.5");
    const result = await connectorResult(value);
    expect(result.structuredContent).toEqual(value);
    const normalized = normalizeUpstreamResult(result, {
      mapping: { publicName: toolName, upstreamId: "canvas-session", upstreamLabel: "Canvas", upstreamName: toolName, inputSchema: {} },
      catalogDigest: "b".repeat(64),
      privacy: { descriptor: {
        allowedFields: [], fieldPolicy: "scrub-sensitive", dataClass: "course", maxRecords: 100, maxBytes: 10_000,
        freeText: "allow", learnerTokens: false, artifactInspection: "deny", aiClientAdmission: "allow",
      } },
    });
    expect(normalized.structuredContent).toEqual(value);
    expect(normalized._meta).toMatchObject({
      "io.morrow/gateway": { upstreamId: "canvas-session", upstreamToolName: toolName },
      "io.morrow/canvas-rate": { schema: "morrow.canvas-rate.v1", requestCost: 0.087, rateLimitRemaining: 699.5 },
    });
  });

  it.each([["0", "0", 0, 0], [" 1.25 ", "1000000", 1.25, 1_000_000], [0.5, 2, 0.5, 2]])(
    "accepts finite rate values %s and %s including an exhausted budget",
    async (requestCost, remaining, expectedCost, expectedRemaining) => {
      const result = await connectorResult(browserResponse(requestCost, remaining));
      expect(result._meta).toEqual({
        "io.morrow/canvas-rate": { schema: "morrow.canvas-rate.v1", requestCost: expectedCost, rateLimitRemaining: expectedRemaining },
      });
    },
  );

  it.each([null, "", " ", "bad", "NaN", "Infinity", "-1", "1000001", "1e309", "0x10", true, {}, -1, 1_000_001, NaN, Infinity])(
    "does not promote invalid rate values %s",
    async (invalid) => {
      const value = browserResponse(invalid, invalid);
      const result = await connectorResult(value);
      expect(result._meta).toBeUndefined();
      expect(result.structuredContent).toEqual(value);
    },
  );

  it("retains a valid budget when the request cost header is invalid", async () => {
    const result = await connectorResult(browserResponse("bad", "0"));
    expect(result._meta).toEqual({ "io.morrow/canvas-rate": { schema: "morrow.canvas-rate.v1", rateLimitRemaining: 0 } });
  });

  it("does not promote another provider's browser fields to Canvas telemetry", async () => {
    const result = await connectorResult(browserResponse("1", "100", "moodle"));
    expect(result._meta).toBeUndefined();
  });
});
