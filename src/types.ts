import type { Environment } from "contentful-management";

export enum EventNames {
  pullRequest = "pull_request",
}

export interface BranchNames {
  headRef: null | string;
  baseRef: string;
  defaultBranch: string;
}

export interface EnvironmentNames {
  base: string;
  head: string | null;
}

export type EnvironmentType = "master" | "feature";

/**
 * The `environment_type` input. "auto" infers the type from the event, which is
 * the historical behaviour; the other two state it outright.
 */
export type EnvironmentTypeInput = EnvironmentType | "auto";

export interface EnvironmentProps {
  environmentType: EnvironmentType;
  environmentNames: EnvironmentNames;
  environmentId: string;
  environment: Environment;
}

export interface NameFromPatternArgs {
  branchName?: string;
}

/**
 * The resolved action inputs.
 *
 * Read once via `getConfig()` and passed down explicitly rather than being
 * imported as module-level constants, so that reading an input can never be an
 * import-time side effect.
 */
export interface Config {
  spaceId: string;
  managementApiKey: string;
  versionContentType: string;
  versionField: string;
  /**
   * An explicit feature branch, overriding whatever the event payload says.
   * Null when the input was not set. See `getBranchNames()`.
   */
  headRef: string | null;
  featurePattern: string;
  masterPattern: string;
  /**
   * Which environment the run targets. "auto" (the default) infers it from the
   * event: a merged pull request into the default branch is "master" and
   * everything else — including a plain push to the default branch — is
   * "feature". Set it explicitly when the workflow knows better than the
   * event does, e.g. a push-triggered deploy that promotes to the alias.
   */
  environmentType: EnvironmentTypeInput;
  deleteFeature: boolean;
  setAlias: boolean;
  flushPreviewEnv: boolean;
  migrationsDir: string;
}