import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Attachment,
  Config,
  RecordResult,
  Step,
  FrameworkInfo,
} from "./types";
import { atomic, hash } from "./storage";

export function writeAllure(
  result: RecordResult,
  config: Config,
  sessionDir: string,
  framework: FrameworkInfo,
): void {
  mkdirSync(config.resultsDir, { recursive: true });
  const attachments = (items: Attachment[]) =>
    items.map((item) => {
      copyFileSync(
        join(sessionDir, item.source),
        join(config.resultsDir, item.source),
      );
      return item;
    });
  const steps = (items: Step[]): unknown[] =>
    items.map((s) => ({
      name: s.title,
      status: s.outcome,
      start: s.started_on,
      stop: s.completed_on,
      statusDetails: { message: s.message },
      steps: steps(s.steps),
      attachments: attachments(s.attachments),
    }));
  const meta = result.metadata;
  const labels = Object.entries({
    ...meta.labels,
    framework: framework.name,
    language: framework.language,
    package: result.namespace,
    testClass: result.classname,
    suite: result.classname,
    doqa_id: result.external_id,
    AS_ID: result.external_id,
    ...(meta.title ? { doqa_title: meta.title } : {}),
    ...(meta.caseIds?.length
      ? {
          doqa_work_items: meta.caseIds.join(","),
          doqa_cases: meta.caseIds.join(","),
        }
      : {}),
    ...(meta.createManualCase ? { doqa_create_manual_case: "true" } : {}),
  }).map(([name, value]) => ({ name, value }));
  for (const tag of meta.tags ?? []) labels.push({ name: "tag", value: tag });
  atomic(join(config.resultsDir, `${result.uuid}-container.json`), {
    uuid: result.uuid + "-fixtures",
    children: [result.uuid],
    befores: steps(result.setup_results),
    afters: steps(result.teardown_results),
  });
  atomic(join(config.resultsDir, `${result.uuid}-result.json`), {
    uuid: result.uuid,
    historyId: hash([result.external_id, result.parameters]),
    testCaseId: result.external_id,
    name: result.name,
    fullName: [result.namespace, result.classname, result.runner_method]
      .filter(Boolean)
      .join("#"),
    status: result.outcome,
    start: result.started_on,
    stop: result.completed_on,
    statusDetails: { message: result.message, trace: result.traces },
    description: meta.description,
    labels,
    links: meta.links ?? [],
    parameters: result.parameters,
    steps: steps(result.step_results),
    attachments: attachments(result.attachments),
  });
  if (config.environment)
    writeFileSync(
      join(config.resultsDir, "environment.properties"),
      `environment=${config.environment.replace(/[\r\n]/g, " ")}\n`,
    );
}
