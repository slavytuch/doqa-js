import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { atomic, hash } from "../../doqa-js-commons/src/index";
import { Coordinator } from "../../doqa-js-commons/src/coordinator";
import type { Options } from "./types";

export default class Reporter {
  private coordinator: Coordinator;
  constructor(
    private global: { rootDir?: string; watch?: boolean; watchAll?: boolean },
    private options: Options & { sessionDir: string },
  ) {
    if (global.watch || global.watchAll)
      throw new Error(
        "DoQA v1 requires a separate Jest process per run; watch mode is not supported",
      );
    this.coordinator = new Coordinator(options, {
      name: "jest",
      language: "javascript",
      displayName: "Jest",
    });
  }
  private get config() {
    return this.coordinator.config;
  }
  onRunStart(): Promise<void> {
    return this.coordinator.start();
  }
  onRunComplete(): Promise<void> {
    return this.coordinator.complete();
  }
  // Compilation / import failures never reach environment test_done.
  onTestResult(
    _test: unknown,
    result: {
      testFilePath: string;
      testExecError?: { message?: string; stack?: string };
      testResults: unknown[];
    },
  ): void {
    if (
      !result.testExecError ||
      result.testResults.length ||
      this.config.reporting === "off"
    )
      return;
    const now = Date.now();
    const uuid = randomUUID();
    const file = relative(
      this.global.rootDir ?? process.cwd(),
      result.testFilePath,
    ).replace(/\\/g, "/");
    atomic(join(this.options.sessionDir, `${uuid}.record.json`), {
      uuid,
      external_id: "jest:" + hash([file, "<load>"]),
      name: "Test file could not run",
      namespace: file,
      classname: "",
      runner_method: "<load>",
      metadata: {},
      parameters: [],
      outcome: "broken",
      started_on: now,
      completed_on: now,
      duration_ms: 0,
      message: result.testExecError.message?.slice(
        0,
        this.config.maxMessageLength,
      ),
      traces: result.testExecError.stack?.slice(0, this.config.maxTraceLength),
      step_results: [],
      setup_results: [],
      teardown_results: [],
      attachments: [],
    });
  }
}
