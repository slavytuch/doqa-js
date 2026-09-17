import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Config as JestConfig } from "jest";
import type { Options } from "./types";
import { resolveConfig } from "./config";
export { doqa } from "./api";
// Test files import this module inside Jest's VM (jsdom has no Node fetch globals).
// Load the environment implementation only when configuring an environment.
export const wrapEnvironment: typeof import("./environment").wrapEnvironment = (
  Base,
) =>
  (require("./environment") as typeof import("./environment")).wrapEnvironment(
    Base,
  );
export type { Options, Metadata, Parameter, Link } from "./types";
export function withDoqa(
  config: JestConfig = {},
  options: Options = {},
): JestConfig {
  if (config.projects?.some((p) => typeof p === "string"))
    throw new Error(
      "DoQA requires object project configurations, not string projects",
    );
  if (config.injectGlobals === false)
    throw new Error("DoQA requires injectGlobals=true");
  const sessionDir = resolve(".doqa", randomUUID());
  const opts = { ...options, sessionDir };
  const executionOrder = resolveConfig(options).executionOrder;
  const configure = (project: JestConfig): JestConfig => {
    if (project.injectGlobals === false)
      throw new Error("DoQA requires injectGlobals=true in every Jest project");
    const environment = project.testEnvironment ?? "node";
    const builtIn = [
      "node",
      "jest-environment-node",
      "jsdom",
      "jest-environment-jsdom",
    ].includes(environment);
    return {
      ...project,
      testEnvironment: builtIn
        ? join(
            __dirname,
            environment.includes("jsdom")
              ? "environment-jsdom.js"
              : "environment-node.js",
          )
        : environment,
      testEnvironmentOptions: { ...project.testEnvironmentOptions, doqa: opts },
    };
  };
  if (executionOrder === "plan" && config.testSequencer)
    throw new Error("DoQA plan order cannot replace a custom sequencer");
  return {
    ...configure(config),
    ...(config.projects
      ? {
          projects: config.projects.map((p) =>
            typeof p === "string" ? p : configure(p),
          ),
        }
      : {}),
    reporters: [
      ...(config.reporters ?? ["default"]),
      [join(__dirname, "reporter.js"), opts],
    ],
    ...(executionOrder === "plan"
      ? { maxWorkers: 1, testSequencer: join(__dirname, "sequencer.js") }
      : {}),
  };
}
