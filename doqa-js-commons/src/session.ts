import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "../../doqa-client/src/index";
import type { Config, Session, PlanItem } from "./types";
import { atomic, warn } from "./storage";

export async function prepareSession(
  dir: string,
  config: Config,
): Promise<Session> {
  try {
    return JSON.parse(
      readFileSync(join(dir, "session.json"), "utf8"),
    ) as Session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const session: Session = { reportId: randomUUID(), runId: config.testRunId };
  const client = new Client(config);
  if (config.adapterMode === 0 && config.reporting !== "off") {
    try {
      if (!config.url || !config.token)
        throw new Error("Missing plan credentials");
      const result = await client.request(
        `test-runs/${config.testRunId}/autotests`,
        {
          configuration_id: config.configurationId,
          ciRunId: config.ciRunId,
        },
        "GET",
      );
      if (!Array.isArray(result.autotests)) throw new Error("Invalid plan");
      session.plan = result.autotests.map(
        (entry: Record<string, unknown>): PlanItem => {
          const externalId = entry.externalId ?? entry.external_id;
          if (typeof externalId !== "string")
            throw new Error("Invalid plan identity");
          return {
            externalId,
            namespace: entry.namespace as string | undefined,
            classname: entry.classname as string | undefined,
            runnerMethod: (entry.runnerMethod ?? entry.runner_method) as
              | string
              | undefined,
          };
        },
      );
    } catch {
      warn("Cannot load test plan; running the original test selection.");
    }
  }
  atomic(join(dir, "session.json"), session);
  await client.close();
  return session;
}
