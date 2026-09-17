import { relative, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { JestEnvironment, EnvironmentContext } from "@jest/environment";
import type { JestEnvironmentConfig } from "@jest/environment";
import type { Circus } from "@jest/types";
import type {
  Config,
  Metadata,
  RecordResult,
  Session,
  Options,
  Step,
} from "./types";
import { Runtime } from "doqa-js-commons-dev";
import { bridgeKey, metadataKey, templateKey } from "./bridge";
import { resolveConfig } from "./config";
import { prepareSession } from "doqa-js-commons-dev/session";
import { atomic, hash, warn } from "doqa-js-commons-dev";

type EnvironmentConstructor = new (
  config: JestEnvironmentConfig,
  context: EnvironmentContext,
) => JestEnvironment;
type Annotated = Circus.TestFn & {
  [metadataKey]?: Metadata;
  [templateKey]?: string;
  doqaParameters?: { name: string; value: string }[];
};
export function wrapEnvironment(
  Base: EnvironmentConstructor,
): EnvironmentConstructor {
  return class DoqaEnvironment extends Base {
    private baseHandler?: (
      event: Circus.Event,
      state: Circus.State,
    ) => void | Promise<void>;
    private config: Config;
    private dir: string;
    private runtime: Runtime;
    private session!: Session;
    private file: string;
    private project: string;
    private records = new Map<Circus.TestEntry, RecordResult>();
    private excluded = new Set<Circus.TestEntry>();
    private fixtures = new Map<
      Circus.DescribeBlock,
      { before: Step[]; after: Step[] }
    >();
    private attemptRecords: { test: Circus.TestEntry; result: RecordResult }[] =
      [];
    private registeredRow = 0;
    private registration?: unknown;
    constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
      super(config, context);
      this.baseHandler = this.handleTestEvent?.bind(
        this,
      ) as typeof this.baseHandler;
      this.handleTestEvent = this.onEvent.bind(this);
      const options = config.projectConfig.testEnvironmentOptions
        .doqa as Options & { sessionDir: string };
      if (!options?.sessionDir)
        throw new Error("Configure DoQA with withDoqa(jestConfig, options)");
      this.config = resolveConfig(options);
      this.dir = options.sessionDir;
      this.runtime = new Runtime(this.dir);
      this.file = relative(
        config.projectConfig.rootDir,
        context.testPath,
      ).replace(/\\/g, "/");
      this.project =
        options.projectId ?? config.projectConfig.displayName?.name ?? "";
    }
    async setup(): Promise<void> {
      await super.setup();
      (this.global as unknown as Record<string, unknown>)[bridgeKey] =
        this.runtime;
      this.session = await prepareSession(this.dir, this.config);
    }
    private parents(test: Circus.TestEntry): Circus.DescribeBlock[] {
      const parents: Circus.DescribeBlock[] = [];
      for (
        let block: Circus.DescribeBlock | undefined = test.parent;
        block;
        block = block.parent
      )
        parents.unshift(block);
      return parents;
    }
    private makeRecord(test: Circus.TestEntry): RecordResult {
      const fn = test.fn as Annotated | undefined;
      const metadata: Metadata = structuredClone(fn?.[metadataKey] ?? {});
      const classname = this.parents(test)
        .slice(1)
        .map((b) => b.name)
        .join(" ");
      const template = fn?.[templateKey] ?? test.name;
      const titleId = test.name.match(/(?:\[|@)DOQA[-:](\d+)\]?/);
      const id =
        metadata.id ??
        (titleId ? "DOQA-" + titleId[1] : undefined) ??
        "jest:" + hash([this.project, this.file, classname, template]);
      const now = Date.now();
      return {
        uuid: randomUUID(),
        external_id: id,
        name: [classname, test.name].filter(Boolean).join(" ").slice(0, 255),
        namespace: this.file,
        classname,
        runner_method: template,
        metadata,
        parameters: [
          ...(metadata.parameters ?? []),
          ...(fn?.doqaParameters ?? []),
        ],
        outcome: "passed",
        started_on: now,
        completed_on: now,
        duration_ms: 0,
        step_results: [],
        setup_results: [],
        teardown_results: [],
        attachments: [],
      };
    }
    private record(test: Circus.TestEntry): RecordResult {
      let record = this.records.get(test);
      if (!record) {
        record = this.makeRecord(test);
        this.records.set(test, record);
      }
      return record;
    }
    private rank(test: Circus.TestEntry): number {
      const r = this.record(test);
      const rank = this.session.plan?.findIndex(
        (p) =>
          p.externalId === r.external_id ||
          (p.namespace === r.namespace &&
            p.classname === r.classname &&
            p.runnerMethod === r.runner_method),
      );
      return rank === undefined || rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
    }
    private prepare(block: Circus.DescribeBlock): void {
      for (const child of block.children) {
        if (child.type === "describeBlock") {
          this.prepare(child);
          continue;
        }
        if (this.config.executionOrder === "plan" && child.concurrent)
          throw new Error("DoQA plan order does not support test.concurrent");
        const r = this.record(child);
        if (this.session.plan && this.rank(child) === Number.MAX_SAFE_INTEGER) {
          child.mode = "skip";
          this.excluded.add(child);
        }
        const original = child.fn;
        if (original) {
          const environment = this;
          const invoke = function (this: unknown, ...args: unknown[]) {
            return environment.runtime.context.run(
              { result: environment.record(child) },
              () => Reflect.apply(original, this, args),
            );
          };
          // Jest distinguishes done-callback tests by function.length.
          Object.defineProperty(invoke, "length", { value: original.length });
          child.fn = Object.assign(invoke, {
            [metadataKey]: (original as Annotated)[metadataKey],
            [templateKey]: (original as Annotated)[templateKey],
            doqaParameters: (original as Annotated).doqaParameters,
          }) as Circus.TestFn;
        }
      }
      for (const hook of block.hooks) {
        const original = hook.fn;
        const environment = this;
        const wrapped = function (this: unknown, ...args: unknown[]) {
          const active = environment.hookContext.get(hook);
          return active
            ? environment.runtime.context.run(active, () =>
                Reflect.apply(original, this, args),
              )
            : Reflect.apply(original, this, args);
        };
        Object.defineProperty(wrapped, "length", { value: original.length });
        hook.fn = wrapped as Circus.TestFn;
      }
      if (this.config.executionOrder === "plan" && this.session.plan) {
        const ranks = (
          entry: Circus.TestEntry | Circus.DescribeBlock,
        ): number[] =>
          entry.type === "test"
            ? this.excluded.has(entry)
              ? []
              : [this.rank(entry)]
            : entry.children.flatMap(ranks);
        block.children.sort(
          (a, b) => Math.min(...ranks(a)) - Math.min(...ranks(b)),
        );
        let last = -1;
        for (const child of block.children) {
          const values = ranks(child).filter(
            (n) => n !== Number.MAX_SAFE_INTEGER,
          );
          if (values.length && Math.min(...values) < last)
            throw new Error("DoQA plan order interleaves describe blocks");
          if (values.length) last = Math.max(...values);
        }
      }
    }
    private hookContext = new Map<
      Circus.Hook,
      { result: RecordResult; step: Step }
    >();
    private async onEvent(
      event: Circus.Event,
      state: Circus.State,
    ): Promise<void> {
      if (this.config.reporting === "off") {
        await this.baseHandler?.(event, state);
        return;
      }
      if (event.name === "add_test") {
        const registration = (this.global as unknown as Record<string, unknown>)
          .__DOQA_REGISTRATION__ as
          | { metadata: Metadata; template: string; rows: readonly unknown[] }
          | undefined;
        if (registration) {
          if (this.registration !== registration) {
            this.registration = registration;
            this.registeredRow = 0;
          }
          const fn = event.fn as Annotated;
          fn[metadataKey] = registration.metadata;
          fn[templateKey] = registration.template;
          const row = registration.rows[this.registeredRow++];
          fn.doqaParameters = (Array.isArray(row) ? row : [row]).map(
            (v, i) => ({
              name: `arg${i}`,
              value: JSON.stringify(v) ?? String(v),
            }),
          );
        }
      }
      await this.baseHandler?.(event, state);
      if (event.name === "run_start") this.prepare(state.rootDescribeBlock);
      if (event.name === "test_start") {
        const r = this.record(event.test);
        r.started_on = Date.now();
      }
      if (event.name === "hook_start") {
        const hook = event.hook;
        const test =
          hook.type === "beforeAll" || hook.type === "afterAll"
            ? null
            : state.currentlyRunningTest;
        const record = test ? this.record(test) : this.makeFixtureRecord();
        const start = Date.now();
        const step: Step = {
          title: hook.type,
          outcome: "passed",
          started_on: start,
          completed_on: start,
          duration_ms: 0,
          steps: [],
          attachments: [],
        };
        this.hookContext.set(hook, { result: record, step });
        if (test)
          (hook.type === "beforeEach"
            ? record.setup_results
            : record.teardown_results
          ).push(step);
        else {
          let fixtures = this.fixtures.get(hook.parent);
          if (!fixtures) {
            fixtures = { before: [], after: [] };
            this.fixtures.set(hook.parent, fixtures);
          }
          (hook.type === "beforeAll" ? fixtures.before : fixtures.after).push(
            step,
          );
        }
      }
      if (event.name === "hook_success" || event.name === "hook_failure") {
        const context = this.hookContext.get(event.hook);
        if (context) {
          const step = context.step;
          step.completed_on = Date.now();
          step.duration_ms = step.completed_on - step.started_on;
          if (event.name === "hook_failure") {
            step.outcome = "broken";
            step.message = String(event.error);
          }
          this.hookContext.delete(event.hook);
        }
      }
      if (
        event.name === "test_done" ||
        event.name === "test_skip" ||
        event.name === "test_todo"
      ) {
        if (this.excluded.has(event.test)) return;
        const r = this.record(event.test);
        r.completed_on = Date.now();
        r.duration_ms = r.completed_on - r.started_on;
        if (event.name !== "test_done") r.outcome = "skipped";
        else if (event.test.errors.length) {
          r.outcome =
            r.setup_results.some((s) => s.outcome === "broken") ||
            r.teardown_results.some((s) => s.outcome === "broken")
              ? "broken"
              : "failed";
          const errors = event.test.errors.flatMap((e) =>
            Array.isArray(e) ? e : [e],
          );
          r.message = errors
            .map((e) => String(e))
            .join("\n")
            .slice(0, this.config.maxMessageLength);
          r.traces = errors
            .map((e) =>
              e && typeof e === "object" && "stack" in e
                ? String(e.stack)
                : String(e),
            )
            .join("\n")
            .slice(0, this.config.maxTraceLength);
        }
        this.attemptRecords.push({ test: event.test, result: r });
      }
      if (event.name === "test_retry") this.records.delete(event.test);
      if (event.name === "run_finish") {
        for (const { test, result } of this.attemptRecords) {
          const fixtures = this.parents(test).map((b) => this.fixtures.get(b));
          result.setup_results.unshift(
            ...fixtures.flatMap((f) => f?.before ?? []),
          );
          result.teardown_results.push(
            ...fixtures.reverse().flatMap((f) => f?.after ?? []),
          );
          if (
            [...result.setup_results, ...result.teardown_results].some(
              (s) => s.outcome === "broken",
            )
          )
            result.outcome = "broken";
          result.parameters = result.parameters.map((p) => ({
            ...p,
            value: p.value.slice(0, this.config.maxParameterLength),
          }));
          if (
            this.session.plan &&
            !this.session.plan.some((p) => p.externalId === result.external_id)
          )
            continue;
          try {
            atomic(
              join(this.dir, `${result.started_on}-${result.uuid}.record.json`),
              result,
            );
          } catch {
            warn("Cannot persist a test result.");
          }
        }
      }
    }
    private makeFixtureRecord(): RecordResult {
      const now = Date.now();
      return {
        uuid: randomUUID(),
        external_id: "",
        name: "",
        namespace: this.file,
        classname: "",
        runner_method: "",
        metadata: {},
        parameters: [],
        outcome: "passed",
        started_on: now,
        completed_on: now,
        duration_ms: 0,
        step_results: [],
        setup_results: [],
        teardown_results: [],
        attachments: [],
      };
    }
  };
}
