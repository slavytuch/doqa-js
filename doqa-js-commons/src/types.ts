export type Outcome = "passed" | "failed" | "broken" | "skipped";
export interface Parameter {
  name: string;
  value: string;
}
export interface Link {
  url: string;
  title?: string;
  type?: string;
}
export interface Metadata {
  id?: string;
  title?: string;
  description?: string;
  caseIds?: number[];
  labels?: Record<string, string>;
  tags?: string[];
  links?: Link[];
  parameters?: Parameter[];
  createManualCase?: boolean;
}
export interface Attachment {
  name: string;
  source: string;
  type: string;
}
export interface Step {
  title: string;
  outcome: Outcome;
  started_on: number;
  completed_on: number;
  duration_ms: number;
  message?: string;
  steps: Step[];
  attachments: Attachment[];
}
export interface RecordResult {
  uuid: string;
  external_id: string;
  name: string;
  namespace: string;
  classname: string;
  runner_method: string;
  metadata: Metadata;
  parameters: Parameter[];
  outcome: Outcome;
  started_on: number;
  completed_on: number;
  duration_ms: number;
  message?: string;
  traces?: string;
  step_results: Step[];
  setup_results: Step[];
  teardown_results: Step[];
  attachments: Attachment[];
}
export interface Options {
  url?: string;
  token?: string;
  spaceId?: string | number;
  configurationId?: string | number;
  testRunId?: string | number;
  testRunName?: string;
  adapterMode?: 0 | 1 | 2;
  reporting?: "auto" | "api" | "files" | "off";
  resultsDir?: string;
  ciRunId?: string | number;
  pipelineId?: string | number;
  branch?: string;
  environment?: string;
  importRealtime?: boolean;
  batchSize?: number;
  requestTimeoutMs?: number;
  retries?: number;
  retryBackoffMs?: number;
  maxTraceLength?: number;
  maxMessageLength?: number;
  maxParameterLength?: number;
  /** Runner-specific default order, or the shared plan order. */
  executionOrder?: string;
  config?: string;
  proxy?: string;
  certValidation?: boolean;
  /** Stable disambiguator when several test projects share the same root. */
  projectId?: string;
}
export interface Config extends Options {
  reporting: "api" | "files" | "off";
  adapterMode: 0 | 1 | 2;
  resultsDir: string;
  batchSize: number;
  requestTimeoutMs: number;
  retries: number;
  retryBackoffMs: number;
  maxTraceLength: number;
  maxMessageLength: number;
  maxParameterLength: number;
}
export interface PlanItem {
  externalId: string;
  namespace?: string;
  classname?: string;
  runnerMethod?: string;
}
export interface Session {
  reportId: string;
  runId?: string | number;
  plan?: PlanItem[];
}

export interface FrameworkInfo {
  name: string;
  language: string;
  displayName: string;
}
