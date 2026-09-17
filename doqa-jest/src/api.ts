import type { Runtime } from "doqa-js-commons-dev";
import { bridgeKey, metadataKey, templateKey } from "./bridge";
import type { Metadata } from "./types";

type TestCallback = (...args: unknown[]) => unknown;
interface JestTest {
  (name: string, fn: TestCallback, timeout?: number): void;
  only: JestTest;
  skip: JestTest;
  concurrent: JestTest;
  each(
    rows: readonly unknown[],
  ): (name: string, fn: TestCallback, timeout?: number) => void;
}
export interface DoqaTest {
  (name: string, metadata: Metadata, fn: () => unknown, timeout?: number): void;
  only: DoqaTest;
  skip: DoqaTest;
  concurrent: DoqaTest;
  each<T extends readonly unknown[]>(
    rows: readonly T[],
  ): (
    name: string,
    metadata: Metadata,
    fn: (...args: T) => unknown,
    timeout?: number,
  ) => void;
}
function runtime(): Runtime | undefined {
  return (globalThis as unknown as Record<string, Runtime>)[bridgeKey];
}
function testFacade(modifiers: string[] = []): DoqaTest {
  const runner = () => {
    let test = (globalThis as unknown as { test: JestTest }).test;
    for (const modifier of modifiers)
      test = test[modifier as "only" | "skip" | "concurrent"];
    if (!test) throw new Error("doqa.test must be called inside Jest");
    return test;
  };
  const register = ((
    name: string,
    metadata: Metadata,
    fn: TestCallback,
    timeout?: number,
  ) => {
    // A fresh wrapper avoids metadata leakage when the same callback is reused.
    const wrapped = Object.assign(
      function (this: unknown) {
        return fn.call(this);
      },
      { [metadataKey]: metadata },
    );
    runner()(name, wrapped, timeout);
  }) as DoqaTest;
  register.each = (rows) => (name, metadata, fn, timeout) => {
    // Register expanded titles through Jest itself; add_test copies metadata from
    // the active registration bridge to each generated invocation.
    const bridge = globalThis as unknown as Record<string, unknown>;
    bridge.__DOQA_REGISTRATION__ = { metadata, template: name, rows };
    try {
      const callback = Object.assign(
        (...args: unknown[]) => fn(...(args as never)),
        { [metadataKey]: metadata, [templateKey]: name },
      );
      runner().each(rows)(name, callback, timeout);
    } finally {
      delete bridge.__DOQA_REGISTRATION__;
    }
  };
  for (const key of ["only", "skip", "concurrent"] as const)
    Object.defineProperty(register, key, {
      get: () => testFacade([...modifiers, key]),
    });
  return register;
}
export const doqa = {
  test: testFacade(),
  metadata: (value: Metadata): void => runtime()?.metadata(value),
  parameter: (name: string, value: unknown): void =>
    runtime()?.metadata({
      parameters: [
        {
          name,
          value:
            typeof value === "string"
              ? value
              : (JSON.stringify(value) ?? String(value)),
        },
      ],
    }),
  step: <T>(title: string, fn: () => T): T => {
    const active = runtime();
    return active ? active.step(title, fn) : fn();
  },
  attach: (name: string, content: string | Uint8Array, type?: string): void =>
    runtime()?.attach(name, content, type),
  attachFile: (path: string, name?: string, type?: string): void =>
    runtime()?.attachFile(path, name, type),
};
