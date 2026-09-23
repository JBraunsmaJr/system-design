import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { StateFile, StateRevision, DeploymentSpec } from './types.js';
import { DEFAULT_MANIFEST, getResolvedImages } from './manifest.js';
import { calculateContentHash } from './generators/header.js';

export const STATE_FILE_DIR = '.sdctl';
export const STATE_FILE_NAME = 'state.json';
export const MIN_RETAINED_REVISIONS = 5;

export function getStateFilePath(workingDir: string = process.cwd()): string {
  return join(workingDir, STATE_FILE_DIR, STATE_FILE_NAME);
}

export function loadState(workingDir: string = process.cwd()): StateFile {
  const filePath = getStateFilePath(workingDir);
  if (!existsSync(filePath)) {
    return {
      version: '1',
      currentRevision: 0,
      revisions: [],
    };
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as StateFile;
    if (!Array.isArray(parsed.revisions)) {
      parsed.revisions = [];
    }
    return parsed;
  } catch {
    return {
      version: '1',
      currentRevision: 0,
      revisions: [],
    };
  }
}

export function saveState(state: StateFile, workingDir: string = process.cwd()): void {
  const filePath = getStateFilePath(workingDir);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function recordAppliedRevision(
  spec: DeploymentSpec,
  workingDir: string = process.cwd(),
  installerVersion: string = DEFAULT_MANIFEST.version,
  verified: boolean = false,
  verificationResults?: StateRevision['verificationResults'],
): StateRevision {
  const state = loadState(workingDir);
  const nextRev = (state.currentRevision || 0) + 1;
  const specHash = calculateContentHash(JSON.stringify(spec));
  const images = getResolvedImages(DEFAULT_MANIFEST, spec.registry?.prefix);

  const revision: StateRevision = {
    revision: nextRev,
    timestamp: new Date().toISOString(),
    installerVersion,
    specHash,
    spec,
    resolvedDigests: {
      editor: images.editor,
      relay: images.relay,
      proxy:
        spec.tls.mode === 'acme' || spec.tls.mode === 'acme-dns' || spec.tls.mode === 'provided'
          ? spec.proxy?.image || images.proxy
          : undefined,
      turn: spec.turn?.enabled ? images.turn : undefined,
    },
    verified,
    verificationResults,
  };

  state.revisions.push(revision);
  state.currentRevision = nextRev;

  // Retain at least MIN_RETAINED_REVISIONS (e.g. 5)
  if (state.revisions.length > MIN_RETAINED_REVISIONS) {
    state.revisions = state.revisions.slice(-MIN_RETAINED_REVISIONS);
  }

  saveState(state, workingDir);
  return revision;
}

export function getPreviousRevision(workingDir: string = process.cwd()): StateRevision | undefined {
  const state = loadState(workingDir);
  if (state.revisions.length < 2) return undefined;
  return state.revisions[state.revisions.length - 2];
}
