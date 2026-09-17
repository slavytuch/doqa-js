import type {
  Options as CommonOptions,
  Config as CommonConfig,
} from "doqa-js-commons-dev";
export type {
  Metadata,
  Parameter,
  Link,
  RecordResult,
  Session,
  Step,
} from "doqa-js-commons-dev";
export interface Options extends Omit<CommonOptions, "executionOrder"> {
  executionOrder?: "jest" | "plan";
}
export interface Config extends CommonConfig {
  executionOrder?: "jest" | "plan";
}
