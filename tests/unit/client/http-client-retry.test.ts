import { beforeEach, describe, expect, it, vi } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { http, HttpResponse } from "msw";
import { mockServer } from "../../setup.js";
import { HttpClient } from "../../../src/client/http-client.js";
import { CbRateLimitError } from "../../../src/client/errors.js";

vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

const BASE = "https://test-cb.example.com/v3";
const client = new HttpClient({
  baseUrl: BASE,
  username: "testuser",
  password: "testpass",
  unsafeSsl: false,
});

beforeEach(() => {
  vi.mocked(delay).mockClear();
});

describe("HttpClient rate limit retries", () => {
  it("waits before retrying and preserves authentication and query parameters", async () => {
    let calls = 0;
    mockServer.use(http.get(`${BASE}/limited`, ({ request }) => {
      calls++;
      expect(request.headers.get("Authorization")).toBe(`Basic ${Buffer.from("testuser:testpass").toString("base64")}`);
      expect(new URL(request.url).searchParams.get("page")).toBe("2");
      if (calls === 1) {
        return HttpResponse.json({}, { status: 429, headers: { "Retry-After": "2" } });
      }
      expect(delay).toHaveBeenCalledWith(2000);
      return HttpResponse.json({ ok: true });
    }));
    expect(await client.get("/limited", { params: { page: 2 } })).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "invalid", "-1", "1.5"])("uses bounded exponential backoff for Retry-After %s", async (header) => {
    let calls = 0;
    mockServer.use(http.get(`${BASE}/limited`, () => {
      calls++;
      return HttpResponse.json({}, {
        status: 429,
        headers: header === undefined ? {} : { "Retry-After": header },
      });
    }));
    await expect(client.get("/limited")).rejects.toThrow(CbRateLimitError);
    expect(calls).toBe(4);
    expect(vi.mocked(delay).mock.calls.map(([waitMs]) => waitMs)).toEqual([1000, 2000, 4000]);
  });

  it.each([5000, -5000])("honors HTTP-date Retry-After with offset %s", async (offset) => {
    const now = Date.parse("Thu, 10 Sep 2026 00:00:00 GMT");
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    let calls = 0;
    mockServer.use(http.get(`${BASE}/limited`, () => {
      calls++;
      return calls === 1
        ? HttpResponse.json({}, { status: 429, headers: { "Retry-After": new Date(now + offset).toUTCString() } })
        : HttpResponse.json({ ok: true });
    }));
    try {
      await client.get("/limited");
      expect(delay).toHaveBeenCalledWith(Math.max(0, offset));
      expect(calls).toBe(2);
    } finally {
      clock.mockRestore();
    }
  });

  it.each(["31", "999999999999999999999999999999"])("does not retry early when the requested wait %s exceeds the budget", async (header) => {
    let calls = 0;
    mockServer.use(http.get(`${BASE}/limited`, () => {
      calls++;
      return HttpResponse.json({}, { status: 429, headers: { "Retry-After": header } });
    }));
    await expect(client.get("/limited")).rejects.toThrow(CbRateLimitError);
    expect(calls).toBe(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("limits total waiting across retries to 30 seconds", async () => {
    let calls = 0;
    mockServer.use(http.get(`${BASE}/limited`, () => {
      calls++;
      return HttpResponse.json({}, { status: 429, headers: { "Retry-After": "15" } });
    }));
    await expect(client.get("/limited")).rejects.toThrow(CbRateLimitError);
    expect(calls).toBe(3);
    expect(vi.mocked(delay).mock.calls.map(([waitMs]) => waitMs)).toEqual([15000, 15000]);
  });

  it("retries binary downloads without altering the image bytes", async () => {
    let calls = 0;
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
    mockServer.use(http.get(`${BASE}/image`, ({ request }) => {
      calls++;
      expect(request.headers.get("Accept")).toBe("*/*");
      return calls === 1
        ? HttpResponse.json({}, { status: 429, headers: { "Retry-After": "0" } })
        : new HttpResponse(bytes, { headers: { "Content-Type": "image/png" } });
    }));
    expect(await client.getBinary("/image")).toEqual({ data: Buffer.from(bytes), contentType: "image/png" });
    expect(calls).toBe(2);
    expect(delay).toHaveBeenCalledWith(0);
  });

  it.each(["post", "put"] as const)("does not retry %s writes", async (method) => {
    let calls = 0;
    mockServer.use(http[method](`${BASE}/limited`, () => {
      calls++;
      return HttpResponse.json({}, { status: 429, headers: { "Retry-After": "0" } });
    }));
    await expect(client[method]("/limited", { body: { name: "Example" } })).rejects.toThrow(CbRateLimitError);
    expect(calls).toBe(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 500, 503])("does not retry HTTP %s", async (status) => {
    let calls = 0;
    mockServer.use(http.get(`${BASE}/limited`, () => {
      calls++;
      return HttpResponse.json({}, { status, headers: { "Retry-After": "0" } });
    }));
    await expect(client.get("/limited")).rejects.toMatchObject({ status });
    expect(calls).toBe(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("does not retry connection failures", async () => {
    let calls = 0;
    mockServer.use(http.get(`${BASE}/limited`, () => {
      calls++;
      return HttpResponse.error();
    }));
    await expect(client.get("/limited")).rejects.toThrow("Cannot connect to Codebeamer");
    expect(calls).toBe(1);
    expect(delay).not.toHaveBeenCalled();
  });
});