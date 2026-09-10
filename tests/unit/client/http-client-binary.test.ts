import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { mockServer } from "../../setup.js";
import { HttpClient, MAX_ATTACHMENT_BYTES } from "../../../src/client/http-client.js";
import { CbAuthError, CbForbiddenError, CbNotFoundError } from "../../../src/client/errors.js";

const BASE = "https://test-cb.example.com/v3";
const client = new HttpClient({
  baseUrl: BASE,
  username: "testuser",
  password: "testpass",
  unsafeSsl: false,
});

describe("HttpClient binary downloads", () => {
  it("preserves bytes and uses authenticated binary requests", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
    mockServer.use(http.get(`${BASE}/image`, ({ request }) => {
      expect(request.headers.get("Authorization")).toBe(
        `Basic ${Buffer.from("testuser:testpass").toString("base64")}`,
      );
      expect(request.headers.get("Accept")).toBe("*/*");
      return new HttpResponse(bytes, { headers: { "Content-Type": "image/png; charset=binary" } });
    }));
    const result = await client.getBinary("/image");
    expect(result.data).toEqual(Buffer.from(bytes));
    expect(result.contentType).toBe("image/png");
  });

  it.each([
    [401, CbAuthError],
    [403, CbForbiddenError],
    [404, CbNotFoundError],
  ])("maps HTTP %s errors", async (status, errorType) => {
    mockServer.use(http.get(`${BASE}/image`, () =>
      HttpResponse.json({}, { status }),
    ));
    await expect(client.getBinary("/image")).rejects.toThrow(errorType);
  });

  it("rejects oversized content-length", async () => {
    mockServer.use(http.get(`${BASE}/image`, () => new HttpResponse("small", {
      headers: { "Content-Length": String(MAX_ATTACHMENT_BYTES + 1) },
    })));
    await expect(client.getBinary("/image")).rejects.toThrow("5 MiB");
  });

  it("enforces the limit even without content-length", async () => {
    mockServer.use(http.get(`${BASE}/image`, () =>
      new HttpResponse(new Uint8Array(MAX_ATTACHMENT_BYTES + 1)),
    ));
    await expect(client.getBinary("/image")).rejects.toThrow("5 MiB");
  });
});