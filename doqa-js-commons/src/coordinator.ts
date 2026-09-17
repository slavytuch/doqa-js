import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Config,
  Options,
  RecordResult,
  Session,
  Step,
  Attachment,
  FrameworkInfo,
} from "./types";
import { resolveConfig } from "./config";
import { Client, FormData } from "doqa-js-client-dev";
import { prepareSession } from "./session";
import { atomic, warn } from "./storage";
import { writeAllure } from "./files";

export class Coordinator {
  readonly config: Config;
  private client: Client;
  private session!: Session;
  private timer?: NodeJS.Timeout;
  private pending = Promise.resolve();
  private chunk = 0;
  private seen = new Set<string>();
  private failed = false;
  constructor(
    private options: Options & { sessionDir: string },
    private framework: FrameworkInfo,
  ) {
    this.config = resolveConfig(options);
    this.client = new Client(this.config);
  }
  async start(): Promise<void> {
    this.session = await prepareSession(this.options.sessionDir, this.config);
    if (this.config.reporting === "off") return;
    if (this.config.reporting === "api" && !this.session.runId) {
      try {
        const response = await this.client.request(
          "test-runs",
          {
            name: this.config.testRunName ?? this.framework.displayName,
            external_key: this.session.reportId,
            configuration_id: this.config.configurationId,
            pipeline_id: this.config.pipelineId,
            branch: this.config.branch,
            environment: this.config.environment,
          },
          "POST",
          true,
        );
        if (
          typeof response.runId !== "number" &&
          typeof response.runId !== "string"
        )
          throw new Error("Missing runId");
        this.session.runId = response.runId;
        atomic(join(this.options.sessionDir, "session.json"), this.session);
      } catch {
        this.failed = true;
        this.diagnostic();
      }
    }
    if (this.config.importRealtime)
      this.timer = setInterval(() => this.enqueue(false), 200);
  }
  private diagnostic(): void {
    warn(`Reporting incomplete; recovery files: ${this.options.sessionDir}`);
  }
  private enqueue(final: boolean): void {
    this.pending = this.pending
      .then(() => this.flush(final))
      .catch(() => {
        this.failed = true;
        this.diagnostic();
      });
  }
  async complete(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.enqueue(true);
    await this.pending;
    await this.client.close();
  }
  private async uploadAttachments(items: Attachment[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const item of items) {
      const form = new FormData();
      form.set(
        "file",
        new Blob([readFileSync(join(this.options.sessionDir, item.source))], {
          type: item.type,
        }),
        item.name,
      );
      const response = await this.client.request(
        "attachments",
        {},
        "POST",
        false,
        form,
      );
      if (!response.mediaFileId) throw new Error("Missing mediaFileId");
      results.push({ media_file_id: response.mediaFileId, name: item.name });
    }
    return results;
  }
  private async steps(items: Step[]): Promise<unknown[]> {
    return Promise.all(
      items.map(async (s) => ({
        ...s,
        attachments: await this.uploadAttachments(s.attachments),
        steps: await this.steps(s.steps),
      })),
    );
  }
  private async flush(final: boolean): Promise<void> {
    if (this.config.reporting === "off") return;
    const dir = this.options.sessionDir;
    const files = existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".record.json") && !this.seen.has(f))
          .sort()
      : [];
    const records = files.map(
      (f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as RecordResult,
    );
    for (const record of records)
      writeAllure(record, this.config, dir, this.framework);
    if (this.config.reporting === "files") {
      files.forEach((f) => this.seen.add(f));
      return;
    }
    if (this.failed) return;
    const batches: RecordResult[][] = [];
    for (let i = 0; i < records.length; i += this.config.batchSize)
      batches.push(records.slice(i, i + this.config.batchSize));
    if (final && !batches.length) batches.push([]);
    for (let index = 0; index < batches.length; index++) {
      const batch = batches[index];
      if (batch.length)
        await this.client.request("upsert", {
          autotests: batch.map((r) => ({
            external_id: r.external_id,
            name: r.name,
            title: r.metadata.title,
            description: r.metadata.description,
            namespace: r.namespace,
            classname: r.classname,
            runner_method: r.runner_method,
            labels: Object.entries(r.metadata.labels ?? {}).map(
              ([name, value]) => `${name}:${value}`,
            ),
            tags: r.metadata.tags,
            links: r.metadata.links,
            case_ids: r.metadata.caseIds,
          })),
        });
      const results = await Promise.all(
        batch.map(async (r) => ({
          external_id: r.external_id,
          name: r.name,
          outcome: r.outcome,
          started_on: r.started_on,
          completed_on: r.completed_on,
          duration_ms: r.duration_ms,
          message: r.message,
          traces: r.traces,
          parameters: r.parameters,
          step_results: await this.steps(r.step_results),
          setup_results: await this.steps(r.setup_results),
          teardown_results: await this.steps(r.teardown_results),
          attachments: await this.uploadAttachments(r.attachments),
          links: r.metadata.links,
          create_manual_case: r.metadata.createManualCase || undefined,
          properties: {
            framework: this.framework.name,
            language: this.framework.language,
          },
          runner_name: r.name,
          runner_method: r.runner_method,
        })),
      );
      const payload = {
        test_run_id: this.session.runId,
        configuration_id: this.config.configurationId,
        ci_run_id: this.config.ciRunId,
        pipeline_id: this.config.pipelineId,
        report_id: this.session.reportId,
        chunk_index: this.chunk,
        is_final_chunk: final && index === batches.length - 1,
        results,
      };
      const delivery = join(dir, `chunk-${this.chunk}.json`);
      atomic(delivery, payload);
      const response = await this.client.request("results", payload);
      atomic(join(dir, `chunk-${this.chunk}.receipt.json`), response);
      if (typeof response.accepted !== "number")
        throw new Error("Invalid results receipt");
      if (response.accepted < batch.length)
        warn(
          `Chunk ${this.chunk}: accepted ${response.accepted}/${batch.length}; see receipt in recovery directory.`,
        );
      this.chunk++;
      batch.forEach((r) => this.seen.add(files[records.indexOf(r)]));
    }
  }
}
