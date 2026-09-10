import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mockServer } from "../../setup.js";
import { HttpClient } from "../../../src/client/http-client.js";
import { CodebeamerClient } from "../../../src/client/codebeamer-client.js";
import { registerAttachmentTools } from "../../../src/tools/attachments.js";

const BASE = "https://test-cb.example.com/v3";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1sAAAAASUVORK5CYII=";
let server: McpServer;
let mcpClient: Client;

beforeEach(async () => {
  server = new McpServer({ name: "attachment-test", version: "1.0.0" });
  registerAttachmentTools(server, new CodebeamerClient(new HttpClient({
    baseUrl: BASE,
    username: "testuser",
    password: "testpass",
    unsafeSsl: false,
  })));
  mcpClient = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
});

afterEach(async () => {
  await mcpClient.close();
  await server.close();
});

describe("attachment MCP tools", () => {
  it("registers both tools as read-only", async () => {
    const { tools } = await mcpClient.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(["list_item_attachments", "get_item_image"]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
  });

  it.each(["array", "items", "attachments"])("lists attachments from %s responses", async (shape) => {
    const attachments = [{ id: 12, name: "diagram.png", fileSize: 68, mimeType: "image/png" }];
    mockServer.use(http.get(`${BASE}/items/500/attachments`, () =>
      HttpResponse.json(shape === "array" ? attachments : { [shape]: attachments }),
    ));
    const result = await mcpClient.callTool({ name: "list_item_attachments", arguments: { itemId: 500 } });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{
      type: "text",
      text: "## Attachments for item 500\n\n- [12] diagram.png (image/png, 68 bytes)",
    }]);
  });

  it("handles items without attachments", async () => {
    mockServer.use(http.get(`${BASE}/items/500/attachments`, () => HttpResponse.json([])));
    const result = await mcpClient.callTool({ name: "list_item_attachments", arguments: { itemId: 500 } });
    expect(result.content).toEqual([{ type: "text", text: "No attachments found for item 500." }]);
  });

  it.each(["image/png", "application/octet-stream", "text/plain"])(
    "returns MCP image content based on bytes when the server sends %s", async (contentType) => {
      mockServer.use(http.get(`${BASE}/items/500/attachments/12/content`, () =>
        new HttpResponse(new Uint8Array(Buffer.from(PNG, "base64")), {
          headers: { "Content-Type": contentType },
        }),
      ));
      const result = await mcpClient.callTool({ name: "get_item_image", arguments: { itemId: 500, attachmentId: 12 } });
      expect(result.isError).not.toBe(true);
      expect(result.content).toContainEqual({ type: "image", data: PNG, mimeType: "image/png" });
    },
  );

  it.each(["<svg xmlns='http://www.w3.org/2000/svg'></svg>", "<html>Login required</html>", ""])(
    "rejects unsupported or empty content instead of returning an image", async (body) => {
      mockServer.use(http.get(`${BASE}/items/500/attachments/12/content`, () =>
        new HttpResponse(body, { headers: { "Content-Type": "image/png" } }),
      ));
      const result = await mcpClient.callTool({ name: "get_item_image", arguments: { itemId: 500, attachmentId: 12 } });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([{ type: "text", text: expect.stringContaining("not a supported image") }]);
    },
  );

  it.each([401, 403, 404])("reports HTTP %s failures as MCP tool errors", async (status) => {
    mockServer.use(http.get(`${BASE}/items/500/attachments/12/content`, () =>
      HttpResponse.json({ message: "Download failed" }, { status }),
    ));
    const result = await mcpClient.callTool({ name: "get_item_image", arguments: { itemId: 500, attachmentId: 12 } });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: expect.any(String) }]);
  });

  it.each([
    { itemId: -1, attachmentId: 12 },
    { itemId: 500, attachmentId: 1.5 },
    { itemId: 500, attachmentId: "https://example.com/image.png" },
  ])("rejects invalid IDs before downloading", async (args) => {
    const result = await mcpClient.callTool({ name: "get_item_image", arguments: args });
    expect(result.isError).toBe(true);
  });
});