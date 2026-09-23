import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { DeploymentSpec, PlanDifference, ReleaseManifest, StateRevision } from './types.js';
import { DEFAULT_MANIFEST, getResolvedImages } from './manifest.js';
import { loadState } from './state.js';
import { parseSimpleYaml } from './yaml.js';
import { colors } from './ui.js';

export function calculatePlan(options: {
  desiredSpec?: DeploymentSpec;
  manifest?: ReleaseManifest;
  workingDir?: string;
}): PlanDifference {
  const workingDir = options.workingDir || process.cwd();
  const manifest = options.manifest || DEFAULT_MANIFEST;

  let desiredSpec = options.desiredSpec;
  if (!desiredSpec) {
    const specPath = join(workingDir, 'deployment.yaml');
    if (existsSync(specPath)) {
      const rawYaml = readFileSync(specPath, 'utf8');
      desiredSpec = parseSimpleYaml(rawYaml) as unknown as DeploymentSpec;
    }
  }

  if (!desiredSpec) {
    return {
      hasChanges: false,
      componentsAdded: [],
      componentsRemoved: [],
      imageChanges: [],
      envChanges: [],
      portChanges: [],
      proxyChanges: [],
    };
  }

  const state = loadState(workingDir);
  const currentRevision: StateRevision | undefined =
    state.revisions.length > 0 ? state.revisions[state.revisions.length - 1] : undefined;

  const currentSpec = currentRevision?.spec;
  const currentImages: Record<string, string | undefined> = currentRevision?.resolvedDigests || {};

  const desiredImages = getResolvedImages(manifest, desiredSpec.registry?.prefix);

  const desiredComponents = new Set<string>(['editor', 'relay']);
  if (
    desiredSpec.tls.mode === 'acme' ||
    desiredSpec.tls.mode === 'acme-dns' ||
    desiredSpec.tls.mode === 'provided' ||
    desiredSpec.tls.mode === 'self-signed'
  ) {
    desiredComponents.add('proxy');
  }
  if (desiredSpec.turn?.enabled) {
    desiredComponents.add('turn');
  }

  const currentComponents = new Set<string>();
  if (currentRevision) {
    currentComponents.add('editor');
    currentComponents.add('relay');
    if (currentRevision.resolvedDigests.proxy) currentComponents.add('proxy');
    if (currentRevision.resolvedDigests.turn) currentComponents.add('turn');
  }

  const componentsAdded: string[] = [];
  const componentsRemoved: string[] = [];

  for (const comp of desiredComponents) {
    if (!currentComponents.has(comp)) {
      componentsAdded.push(comp);
    }
  }
  for (const comp of currentComponents) {
    if (!desiredComponents.has(comp)) {
      componentsRemoved.push(comp);
    }
  }

  // Image changes
  const imageChanges: Array<{ component: string; current: string; desired: string }> = [];
  for (const comp of desiredComponents) {
    const currentImg =
      comp === 'editor'
        ? currentImages.editor
        : comp === 'relay'
          ? currentImages.relay
          : comp === 'proxy'
            ? currentImages.proxy
            : comp === 'turn'
              ? currentImages.turn
              : undefined;

    const desiredImg =
      comp === 'editor'
        ? desiredImages.editor
        : comp === 'relay'
          ? desiredImages.relay
          : comp === 'proxy'
            ? desiredSpec.proxy?.image || desiredImages.proxy
            : comp === 'turn'
              ? desiredImages.turn
              : undefined;

    if (desiredImg && (!currentImg || currentImg !== desiredImg)) {
      imageChanges.push({
        component: comp,
        current: currentImg || '(none)',
        desired: desiredImg,
      });
    }
  }

  // Env changes
  const envChanges: Array<{ key: string; current: string; desired: string }> = [];
  const currentRelayUrl = currentSpec ? getEffectiveRelayUrl(currentSpec) : '';
  const desiredRelayUrl = getEffectiveRelayUrl(desiredSpec);
  if (currentRelayUrl !== desiredRelayUrl) {
    envChanges.push({
      key: 'PUBLIC_RELAY_URL',
      current: currentRelayUrl || '(default)',
      desired: desiredRelayUrl || '(default)',
    });
  }

  const currentIce = currentSpec?.iceServers || '';
  const desiredIce = desiredSpec.iceServers || '';
  if (currentIce !== desiredIce) {
    envChanges.push({
      key: 'PUBLIC_ICE_SERVERS',
      current: currentIce || '(default)',
      desired: desiredIce || '(default)',
    });
  }

  // Port changes
  const portChanges: Array<{ port: string; current: string; desired: string }> = [];
  const currentPorts = currentSpec ? getPortsSummary(currentSpec) : '';
  const desiredPorts = getPortsSummary(desiredSpec);
  if (currentPorts !== desiredPorts) {
    portChanges.push({
      port: 'Exposed Ports',
      current: currentPorts || '(none)',
      desired: desiredPorts,
    });
  }

  // Proxy changes
  const proxyChanges: Array<{ property: string; current: string; desired: string }> = [];
  const currentTls = currentSpec
    ? `${currentSpec.tls.mode} (${currentSpec.tls.domain || currentSpec.tls.editorHost || 'localhost'})`
    : '';
  const desiredTls = `${desiredSpec.tls.mode} (${desiredSpec.tls.domain || desiredSpec.tls.editorHost || 'localhost'})`;
  if (currentTls !== desiredTls) {
    proxyChanges.push({
      property: 'TLS Mode & Hostnames',
      current: currentTls || '(none)',
      desired: desiredTls,
    });
  }

  const currentCidrs = currentSpec?.relay?.allowedCidrs?.join(',') || '';
  const desiredCidrs = desiredSpec.relay?.allowedCidrs?.join(',') || '';
  if (currentCidrs !== desiredCidrs) {
    proxyChanges.push({
      property: 'Relay Allowed CIDRs',
      current: currentCidrs || '(all/open)',
      desired: desiredCidrs || '(all/open)',
    });
  }

  const currentPaths = `editor: ${currentSpec?.paths?.editor || '/'}, relay: ${currentSpec?.paths?.relay || (currentSpec?.tls.editorHost === currentSpec?.tls.relayHost ? '/relay' : '/')}`;
  const desiredPaths = `editor: ${desiredSpec.paths?.editor || '/'}, relay: ${desiredSpec.paths?.relay || (desiredSpec.tls.editorHost === desiredSpec.tls.relayHost ? '/relay' : '/')}`;
  if (currentPaths !== desiredPaths) {
    proxyChanges.push({
      property: 'Routing Subpaths',
      current: currentPaths,
      desired: desiredPaths,
    });
  }

  const hasChanges =
    !currentRevision ||
    componentsAdded.length > 0 ||
    componentsRemoved.length > 0 ||
    imageChanges.length > 0 ||
    envChanges.length > 0 ||
    portChanges.length > 0 ||
    proxyChanges.length > 0;

  return {
    hasChanges,
    componentsAdded,
    componentsRemoved,
    imageChanges,
    envChanges,
    portChanges,
    proxyChanges,
  };
}

function getEffectiveRelayUrl(spec: DeploymentSpec): string {
  const isDirect = spec.tls.mode === 'none' || spec.tls.mode === 'external';
  const proto = spec.tls.mode === 'none' ? 'ws://' : 'wss://';
  if (isDirect) {
    const host = spec.tls.relayHost || spec.tls.domain || 'localhost';
    const port = spec.relay?.port || 4444;
    return `${proto}${host}:${port}`;
  }
  const isSingle =
    (spec.tls.editorHost || spec.tls.domain || 'localhost') ===
    (spec.tls.relayHost || spec.tls.domain || 'localhost');
  if (isSingle) {
    return `${proto}${spec.tls.domain || spec.tls.editorHost || 'localhost'}/relay`;
  }
  return `${proto}${spec.tls.relayHost}`;
}

function getPortsSummary(spec: DeploymentSpec): string {
  const ports: string[] = [];
  if (spec.tls.mode === 'acme' || spec.tls.mode === 'acme-dns' || spec.tls.mode === 'provided') {
    ports.push('80/tcp', '443/tcp');
  } else {
    ports.push('8080/tcp (editor)', `${spec.relay?.port || 4444}/tcp (relay)`);
  }
  if (spec.turn?.enabled) {
    ports.push(
      `${spec.turn.listeningPort || 3478}/tcp`,
      `${spec.turn.listeningPort || 3478}/udp`,
      `${spec.turn.tlsListeningPort || 5349}/tcp`,
      '49152-49200/udp',
    );
  }
  return ports.join(', ');
}

export function formatPlanText(plan: PlanDifference): string {
  if (!plan.hasChanges) {
    return colors.dim(
      'No changes detected. The running deployment matches the desired specification and release manifest.',
    );
  }

  const lines: string[] = [colors.bold(colors.brightCyan('Deployment Plan:'))];

  if (plan.componentsAdded.length > 0) {
    lines.push(
      `  ${colors.brightGreen('+')} ${colors.bold('Components Added:')} ${colors.green(plan.componentsAdded.join(', '))}`,
    );
  }
  if (plan.componentsRemoved.length > 0) {
    lines.push(
      `  ${colors.brightRed('-')} ${colors.bold('Components Removed:')} ${colors.red(plan.componentsRemoved.join(', '))}`,
    );
  }

  if (plan.imageChanges.length > 0) {
    lines.push(`  ${colors.brightYellow('~')} ${colors.bold('Image Changes:')}`);
    for (const img of plan.imageChanges) {
      lines.push(
        `      * ${colors.cyan(img.component)}: ${colors.dim(img.current)} -> ${colors.brightGreen(img.desired)}`,
      );
    }
  }

  if (plan.envChanges.length > 0) {
    lines.push(`  ${colors.brightYellow('~')} ${colors.bold('Environment Variables:')}`);
    for (const env of plan.envChanges) {
      lines.push(
        `      * ${colors.cyan(env.key)}: ${colors.dim(env.current)} -> ${colors.brightGreen(env.desired)}`,
      );
    }
  }

  if (plan.portChanges.length > 0) {
    lines.push(`  ${colors.brightYellow('~')} ${colors.bold('Port Mappings:')}`);
    for (const p of plan.portChanges) {
      lines.push(
        `      * ${colors.cyan(p.port)}: ${colors.dim(p.current)} -> ${colors.brightGreen(p.desired)}`,
      );
    }
  }

  if (plan.proxyChanges.length > 0) {
    lines.push(`  ${colors.brightYellow('~')} ${colors.bold('Proxy Configuration:')}`);
    for (const px of plan.proxyChanges) {
      lines.push(
        `      * ${colors.cyan(px.property)}: ${colors.dim(px.current)} -> ${colors.brightGreen(px.desired)}`,
      );
    }
  }

  return lines.join('\n');
}
