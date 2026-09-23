export type DeploymentMode = 'public' | 'isolated';
export type Topology = 'lan' | 'routed' | 'nat' | 'multisite';
export type TlsMode = 'acme' | 'acme-dns' | 'provided' | 'external' | 'none';

export interface DnsProviderConfig {
  name: 'cloudflare' | string;
  apiTokenEnvVar?: string;
  apiToken?: string;
  resolvers?: string[];
  propagationDelay?: string;
  propagationTimeout?: string;
}

export interface ComponentImages {
  editor: string;
  relay: string;
  proxy: string;
  turn: string;
  installer: string;
}

export interface ReleaseManifest {
  version: string;
  releaseDate: string;
  minUpgradeFrom?: string;
  images: {
    editor: { image: string; digest: string };
    relay: { image: string; digest: string };
    proxy: { image: string; digest: string };
    turn: { image: string; digest: string };
    installer: { image: string; digest: string };
  };
}

export interface DeploymentSpec {
  version: string;
  mode: DeploymentMode;
  topology: Topology;
  proxy?: {
    image?: string;
  };
  tls: {
    mode: TlsMode;
    domain?: string;
    editorHost?: string;
    relayHost?: string;
    certificatePath?: string;
    privateKeyPath?: string;
    caPath?: string;
    dnsProvider?: DnsProviderConfig;
  };
  registry?: {
    prefix?: string;
  };
  relay: {
    allowedCidrs?: string[];
    port?: number;
  };
  turn?: {
    enabled: boolean;
    realm?: string;
    listeningPort?: number;
    tlsListeningPort?: number;
    externalIp?: string;
  };
  iceServers?: string;
}

export interface StateRevision {
  revision: number;
  timestamp: string;
  installerVersion: string;
  specHash: string;
  spec: DeploymentSpec;
  resolvedDigests: {
    editor: string;
    relay: string;
    proxy?: string;
    turn?: string;
  };
  verified: boolean;
  verificationResults?: Array<{
    id: string;
    status: 'pass' | 'fail' | 'warn';
    message?: string;
  }>;
}

export interface StateFile {
  version: string;
  currentRevision: number;
  revisions: StateRevision[];
}

export interface ValidationError {
  path: string;
  message: string;
  suggestedFix: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface WizardAnswers {
  mode?: DeploymentMode;
  topology?: Topology;
  tlsMode?: TlsMode;
  editorHost?: string;
  relayHost?: string;
  singleHost?: boolean;
  domain?: string;
  certificatePath?: string;
  privateKeyPath?: string;
  caPath?: string;
  dnsProviderName?: string;
  cloudflareApiToken?: string;
  cloudflareApiTokenEnvVar?: string;
  cloudflareResolvers?: string[] | string;
  cloudflarePropagationDelay?: string;
  cloudflarePropagationTimeout?: string;
  proxyImage?: string;
  allowedCidrs?: string[] | string;
  enableTurn?: boolean;
  turnExternalIp?: string;
  registryPrefix?: string;
  customIceServers?: string;
}

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface CheckResult {
  id: string;
  layer?: number;
  name: string;
  status: CheckStatus;
  expected: string;
  observed: string;
  cause?: string;
  remediation?: string;
  durationMs?: number;
}

export interface PreflightOptions {
  workingDir?: string;
  spec?: DeploymentSpec;
  manifest?: ReleaseManifest;
  force?: string[];
}

export interface PreflightReport {
  valid: boolean;
  checks: CheckResult[];
  forcedCheckIds: string[];
  summary: {
    passed: number;
    failed: number;
    warned: number;
    skipped: number;
  };
}

export interface VerifyOptions {
  workingDir?: string;
  spec?: DeploymentSpec;
  all?: boolean;
  awaitClients?: number;
  clientTimeoutSec?: number;
  editorUrl?: string;
  relayUrl?: string;
}

export interface ClientDiagReport {
  clientId: string;
  testCode: string;
  timestamp: string;
  effectiveRelay: string;
  effectiveIce: string;
  hasOverrides: boolean;
  mixedContentRisk: boolean;
  relayReachable: boolean;
  relayLatencyMs?: number;
  candidateTypesFound: string[];
  p2pConnected?: boolean;
  timeToConnectMs?: number;
  selectedCandidatePair?: string;
  errors: string[];
}

export interface VerifyReport {
  valid: boolean;
  checks: CheckResult[];
  clientReports?: ClientDiagReport[];
  summary: {
    passed: number;
    failed: number;
    warned: number;
    skipped: number;
  };
}

export interface PlanDifference {
  hasChanges: boolean;
  componentsAdded: string[];
  componentsRemoved: string[];
  imageChanges: Array<{ component: string; current: string; desired: string }>;
  envChanges: Array<{ key: string; current: string; desired: string }>;
  portChanges: Array<{ port: string; current: string; desired: string }>;
  proxyChanges: Array<{ property: string; current: string; desired: string }>;
}

export interface ApplyOptions {
  workingDir?: string;
  spec?: DeploymentSpec;
  manifest?: ReleaseManifest;
  force?: string[];
  autoRollback?: boolean;
  skipVerify?: boolean;
  editorUrl?: string;
  relayUrl?: string;
  executeDocker?: boolean;
}

export interface ApplyResult {
  success: boolean;
  revision: StateRevision;
  plan?: PlanDifference;
  verifyReport?: VerifyReport;
  diagnosticsUrl: string;
  testCode: string;
  rolledBack?: boolean;
  rollbackReason?: string;
}

export interface UpgradeOptions {
  workingDir?: string;
  manifest?: ReleaseManifest;
  force?: string[];
  autoRollback?: boolean;
  editorUrl?: string;
  relayUrl?: string;
  executeDocker?: boolean;
}

export interface UpgradeResult {
  success: boolean;
  oldVersion: string;
  newVersion: string;
  appliedRevision?: StateRevision;
  backupPath?: string;
  overrideWarnings?: string[];
  plan?: PlanDifference;
  verifyReport?: VerifyReport;
  rolledBack?: boolean;
  rollbackReason?: string;
}

export interface RollbackOptions {
  workingDir?: string;
  toRevision?: number;
  manifest?: ReleaseManifest;
  executeDocker?: boolean;
}

export interface RollbackResult {
  success: boolean;
  restoredRevision: StateRevision;
  verifyReport?: VerifyReport;
}
