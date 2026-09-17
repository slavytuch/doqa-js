import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { Metadata, RecordResult, Step } from "./types";
import { warn } from "./storage";

export interface Context {
  result: RecordResult;
  step?: Step;
}
export class Runtime {
  readonly context = new AsyncLocalStorage<Context>();
  constructor(private dir: string) {}
  metadata(value: Metadata): void {
    const current = this.context.getStore();
    if (!current) {
      warn("Metadata called outside a running test or hook.");
      return;
    }
    Object.assign(current.result.metadata, value);
    if (value.parameters) current.result.parameters.push(...value.parameters);
    if (value.id) current.result.external_id = value.id;
  }
  step<T>(title: string, fn: () => T): T {
    const current = this.context.getStore();
    if (!current) return fn();
    const start = Date.now();
    const step: Step = {
      title,
      outcome: "passed",
      started_on: start,
      completed_on: start,
      duration_ms: 0,
      steps: [],
      attachments: [],
    };
    (current.step?.steps ?? current.result.step_results).push(step);
    const finish = (error?: unknown) => {
      step.completed_on = Date.now();
      step.duration_ms = step.completed_on - start;
      if (error) {
        step.outcome = "failed";
        step.message = String(error);
      }
    };
    return this.context.run({ ...current, step }, () => {
      try {
        const value = fn();
        if (value && typeof (value as { then?: unknown }).then === "function") {
          return Promise.resolve(value).then(
            (v) => {
              finish();
              return v;
            },
            (e) => {
              finish(e);
              throw e;
            },
          ) as T;
        }
        finish();
        return value;
      } catch (error) {
        finish(error);
        throw error;
      }
    });
  }
  attach(
    name: string,
    content: string | Uint8Array,
    type = "text/plain",
  ): void {
    const current = this.context.getStore();
    if (!current) {
      warn("Attachment called outside a running test or hook.");
      return;
    }
    try {
      const source = randomUUID() + "-attachment";
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      writeFileSync(join(this.dir, source), content, { mode: 0o600 });
      (current.step?.attachments ?? current.result.attachments).push({
        name,
        source,
        type,
      });
    } catch {
      warn("Cannot save attachment.");
    }
  }
  attachFile(
    path: string,
    name = basename(path),
    type = "application/octet-stream",
  ): void {
    try {
      this.attach(name, readFileSync(path), type);
    } catch {
      warn("Cannot read attachment file.");
    }
  }
}
