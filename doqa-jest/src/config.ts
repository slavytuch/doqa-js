import { resolveConfig as resolveCommonConfig } from "../../doqa-js-commons/src/index";
import type { Config, Options } from "./types";
export function resolveConfig(options: Options = {}): Config {
  const config = resolveCommonConfig(options);
  if (
    config.executionOrder &&
    !["jest", "plan"].includes(config.executionOrder)
  )
    throw new Error("Invalid DoQA executionOrder for Jest");
  return config as Config;
}
