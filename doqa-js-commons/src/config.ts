import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Config, Options } from "./types";

const defaults = {
  batchSize: 100,
  requestTimeoutMs: 30000,
  retries: 3,
  retryBackoffMs: 500,
  maxTraceLength: 100000,
  maxMessageLength: 10000,
  maxParameterLength: 2000,
};
export function resolveConfig(options: Options = {}): Config {
  const values: Record<string, unknown> = {};
  const path = options.config ?? process.env.DOQA_CONFIG ?? "doqa.properties";
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([^#!\s=]+)\s*=\s*(.*)$/);
      if (match) values[match[1]] = match[2];
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const keys = [
    "url",
    "token",
    "spaceId",
    "configurationId",
    "testRunId",
    "testRunName",
    "adapterMode",
    "reporting",
    "resultsDir",
    "ciRunId",
    "pipelineId",
    "branch",
    "environment",
    "importRealtime",
    "executionOrder",
    "projectId",
    "proxy",
    "certValidation",
    ...Object.keys(defaults),
  ];
  values.token = values.token ?? process.env.DOQA_PRIVATE_TOKEN;
  values.spaceId = values.spaceId ?? process.env.DOQA_PROJECT_ID;
  values.pipelineId =
    values.pipelineId ??
    process.env.CI_PIPELINE_ID ??
    process.env.GITHUB_RUN_ID;
  values.branch =
    values.branch ??
    process.env.CI_COMMIT_REF_NAME ??
    process.env.GITHUB_REF_NAME;
  for (const key of keys) {
    const env =
      process.env[
        "DOQA_" + key.replace(/[A-Z]/g, (c) => "_" + c).toUpperCase()
      ];
    if (env) values[key] = env;
  }
  Object.assign(values, options);
  for (const [key, fallback] of Object.entries(defaults)) {
    const number = Number(values[key] ?? fallback);
    if (
      !Number.isInteger(number) ||
      number < (key === "retries" || key === "retryBackoffMs" ? 0 : 1)
    ) {
      throw new Error(`Invalid DoQA option: ${key}`);
    }
    values[key] = number;
  }
  values.adapterMode = Number(values.adapterMode ?? (values.testRunId ? 1 : 2));
  if (![0, 1, 2].includes(values.adapterMode as number))
    throw new Error("Invalid DoQA adapterMode");
  values.reporting = values.reporting ?? "auto";
  if (values.reporting === "auto")
    values.reporting =
      values.url && values.token && values.spaceId ? "api" : "files";
  if (!["api", "files", "off"].includes(String(values.reporting)))
    throw new Error("Invalid DoQA reporting");
  if (
    values.reporting === "api" &&
    (!values.url || !values.token || !values.spaceId)
  )
    throw new Error("DoQA API requires url, token and spaceId");
  if (
    values.reporting !== "off" &&
    values.adapterMode !== 2 &&
    !values.testRunId
  )
    throw new Error("DoQA mode 0/1 requires testRunId");
  values.importRealtime =
    values.importRealtime === true || values.importRealtime === "true";
  values.certValidation =
    values.certValidation !== false && values.certValidation !== "false";
  values.resultsDir = resolve(String(values.resultsDir ?? "results"));
  return values as unknown as Config;
}
