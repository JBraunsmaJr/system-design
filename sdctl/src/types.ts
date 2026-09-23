export type DeploymentMode = 'public' | 'isolated';
export type Topology = 'lan' | 'routed' | 'nat' | 'multisite';
export type TlsMode = 'acme' | 'provided' | 'external' | 'none';

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
  tls: {
    mode: TlsMode;
    domain?: string;
    editorHost?: string;
    relayHost?: string;
    certificatePath?: string;
    privateKeyPath?: string;
    caPath?: string;
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
  certificatePath?: string;
  privateKeyPath?: string;
  caPath?: string;
  allowedCidrs?: string[] | string;
  enableTurn?: boolean;
  turnExternalIp?: string;
  registryPrefix?: string;
  customIceServers?: string;
}
