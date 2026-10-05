import { setTimeout as delay } from "node:timers/promises";
import type { Config } from "../config.js";
import { mapHttpError } from "./errors.js";

export interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  resource?: string;
}

export interface BodyRequestOptions extends RequestOptions {
  body?: unknown;
  formData?: Record<string, string>;
}

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 30_000;

function retryDelayMs(header: string | null, retry: number): number {
  const value = header?.trim();
  if (value && /^\d+$/.test(value)) {
    return Number(value) * 1000;
  }
  if (value && /^[A-Za-z]/.test(value)) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return Math.max(0, timestamp - Date.now());
  }
  return 1000 * 2 ** retry;
}

export interface BinaryResponse {
  data: Buffer;
  contentType: string;
}

export class HttpClient {
  private readonly authHeader: string;

  constructor(private readonly config: Config) {
    const encoded = Buffer.from(
      `${config.username}:${config.password}`,
    ).toString("base64");
    this.authHeader = `Basic ${encoded}`;
  }

  async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  async getBinary(path: string, options: RequestOptions = {}): Promise<BinaryResponse> {
    const response = await this.requestResponse("GET", path, options, "*/*");
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (Number(response.headers.get("content-length")) > MAX_ATTACHMENT_BYTES) {
        throw new Error("Attachment exceeds the 50 MiB download limit.");
      }
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_ATTACHMENT_BYTES) {
            throw new Error("Attachment exceeds the 50 MiB download limit.");
          }
          chunks.push(value);
        }
      }
    } finally {
      if (reader) {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    return {
      data: Buffer.concat(chunks),
      contentType: (response.headers.get("content-type") ?? "application/octet-stream")
        .split(";")[0].trim().toLowerCase(),
    };
  }

  async post<T>(path: string, options: BodyRequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  async put<T>(path: string, options: BodyRequestOptions = {}): Promise<T> {
    return this.request<T>("PUT", path, options);
  }

  private async request<T>(
    method: string,
    path: string,
    options: BodyRequestOptions = {},
  ): Promise<T> {
    const response = await this.requestResponse(method, path, options);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (text === "") return undefined as T;
    return JSON.parse(text) as T;
  }

  private async requestResponse(
    method: string,
    path: string,
    options: BodyRequestOptions,
    accept = "application/json",
  ): Promise<Response> {
    const url = new URL(`${this.config.baseUrl}${path}`);

    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: accept,
      "User-Agent": "codebeamer-mcp/0.1.0",
    };

    const init: RequestInit = { method, headers };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    } else if (options.formData !== undefined) {
      const fd = new FormData();
      for (const [key, value] of Object.entries(options.formData)) {
        fd.append(key, value);
      }
      init.body = fd;
    }

    let totalWaitMs = 0;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url.toString(), init);
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        const nested =
          err instanceof Error &&
          err.cause instanceof Error
            ? ` (${err.cause.message})`
            : "";
        throw new Error(
          `Cannot connect to Codebeamer at ${this.config.baseUrl}. ` +
            `Check that CB_URL is correct and the server is reachable. Cause: ${cause}${nested}`,
        );
      }

      if (response.ok) return response;

      if (method === "GET" && response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const waitMs = retryDelayMs(response.headers.get("Retry-After"), attempt);
        if (waitMs <= MAX_RETRY_WAIT_MS - totalWaitMs) {
          void response.body?.cancel().catch(() => {});
          totalWaitMs += waitMs;
          await delay(waitMs);
          continue;
        }
      }

      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      throw mapHttpError(response.status, body, options.resource ?? path);
    }
  }
}
