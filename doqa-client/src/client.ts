import { fetch, Agent, ProxyAgent, FormData } from "undici";
import type { ClientConfig } from "./types";

export class Client {
  private failures = 0;
  private openUntil = 0;
  private dispatcher: Agent | ProxyAgent;
  constructor(readonly config: ClientConfig) {
    const tls = { rejectUnauthorized: config.certValidation !== false };
    this.dispatcher = config.proxy
      ? new ProxyAgent({
          uri: config.proxy,
          requestTls: tls,
          proxyTls: tls,
          connectTimeout: config.requestTimeoutMs,
        })
      : new Agent({ connect: { ...tls, timeout: config.requestTimeoutMs } });
  }
  async close(): Promise<void> {
    await this.dispatcher.close();
  }
  async request(
    path: string,
    data: Record<string, unknown> = {},
    method = "POST",
    safe = false,
    form?: FormData,
  ): Promise<Record<string, unknown>> {
    if (Date.now() < this.openUntil)
      throw new Error("DoQA circuit breaker is open");
    const url = new URL(
      `${String(this.config.url).replace(/\/$/, "")}/api/autotests/${path}`,
    );
    const body = {
      token: this.config.token,
      space_id: this.config.spaceId,
      ...data,
    };
    if (method === "GET")
      for (const [k, v] of Object.entries(body))
        if (v != null) url.searchParams.set(k, String(v));
    if (form) {
      form.set("token", String(this.config.token));
      form.set("space_id", String(this.config.spaceId));
    }
    for (let attempt = 0; ; attempt++) {
      let retry = safe || method === "GET";
      try {
        const response = await fetch(url, {
          method,
          dispatcher: this.dispatcher,
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
          headers:
            form || method === "GET"
              ? { Accept: "application/json" }
              : {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
          body: method === "GET" ? undefined : (form ?? JSON.stringify(body)),
          redirect: "error",
        });
        if (!response.ok) {
          retry = response.status === 429 || (retry && response.status >= 500);
          throw new Error(`DoQA HTTP ${response.status}`);
        }
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
          throw new Error("Invalid DoQA response");
        this.failures = 0;
        return payload as Record<string, unknown>;
      } catch (error) {
        if (attempt < this.config.retries && retry) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.config.retryBackoffMs * 2 ** attempt),
          );
          continue;
        }
        if (++this.failures >= 5) this.openUntil = Date.now() + 30000;
        // Never include fetch URLs, server bodies or tokens in diagnostics.
        throw new Error(
          error instanceof Error && /^DoQA HTTP \d+$/.test(error.message)
            ? error.message
            : "DoQA transport failed",
        );
      }
    }
  }
}
