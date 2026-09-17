import Sequencer from "@jest/test-sequencer";
import type { Test } from "@jest/test-result";
import { relative } from "node:path";
import { resolveConfig } from "./config";
import { prepareSession } from "doqa-js-commons-dev/session";
import type { Options } from "./types";
export default class PlanSequencer extends Sequencer {
  async sort(tests: Test[]): Promise<Test[]> {
    if (!tests.length) return tests;
    const options = tests[0].context.config.testEnvironmentOptions
      .doqa as Options & { sessionDir: string };
    const session = await prepareSession(
      options.sessionDir,
      resolveConfig(options),
    );
    if (!session.plan)
      throw new Error("DoQA strict order requires an available selective plan");
    const files = session.plan.map((p) => p.namespace);
    const closed = new Set<string>();
    let previous: string | undefined;
    for (const file of files) {
      if (!file)
        throw new Error(
          "DoQA strict order requires file identity in every plan entry",
        );
      if (file !== previous && closed.has(file))
        throw new Error("DoQA plan order interleaves test files");
      if (previous) closed.add(previous);
      previous = file;
    }
    const rank = (test: Test) => {
      const index = files.indexOf(
        relative(test.context.config.rootDir, test.path).replace(/\\/g, "/"),
      );
      return index < 0 ? Infinity : index;
    };
    return [...tests].sort((a, b) => rank(a) - rank(b));
  }
}
