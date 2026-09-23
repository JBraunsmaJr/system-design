import type { DeploymentSpec } from './types.js';

export function dumpDeploymentSpecYaml(spec: DeploymentSpec): string {
  const lines: string[] = [];
  lines.push(`version: "${spec.version || '1'}"`);
  lines.push(`mode: "${spec.mode}"`);
  lines.push(`topology: "${spec.topology}"`);
  lines.push('');
  lines.push('tls:');
  lines.push(`  mode: "${spec.tls.mode}"`);
  if (spec.tls.domain) lines.push(`  domain: "${spec.tls.domain}"`);
  if (spec.tls.editorHost) lines.push(`  editorHost: "${spec.tls.editorHost}"`);
  if (spec.tls.relayHost) lines.push(`  relayHost: "${spec.tls.relayHost}"`);
  if (spec.tls.certificatePath) lines.push(`  certificatePath: "${spec.tls.certificatePath}"`);
  if (spec.tls.privateKeyPath) lines.push(`  privateKeyPath: "${spec.tls.privateKeyPath}"`);
  if (spec.tls.caPath) lines.push(`  caPath: "${spec.tls.caPath}"`);

  if (spec.registry?.prefix) {
    lines.push('');
    lines.push('registry:');
    lines.push(`  prefix: "${spec.registry.prefix}"`);
  }

  lines.push('');
  lines.push('relay:');
  if (spec.relay.allowedCidrs && spec.relay.allowedCidrs.length > 0) {
    lines.push('  allowedCidrs:');
    for (const cidr of spec.relay.allowedCidrs) {
      lines.push(`    - "${cidr}"`);
    }
  } else {
    lines.push('  allowedCidrs: []');
  }
  if (spec.relay.port) lines.push(`  port: ${spec.relay.port}`);

  if (spec.turn) {
    lines.push('');
    lines.push('turn:');
    lines.push(`  enabled: ${spec.turn.enabled}`);
    if (spec.turn.realm) lines.push(`  realm: "${spec.turn.realm}"`);
    if (spec.turn.externalIp) lines.push(`  externalIp: "${spec.turn.externalIp}"`);
    if (spec.turn.listeningPort) lines.push(`  listeningPort: ${spec.turn.listeningPort}`);
  }

  if (spec.iceServers) {
    lines.push('');
    lines.push(`iceServers: "${spec.iceServers}"`);
  }

  return lines.join('\n') + '\n';
}

export function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  let currentParent: { key: string; obj: Record<string, unknown> } | null = null;
  let currentArray: { key: string; arr: unknown[] } | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = raw.length - raw.trimStart().length;

    if (indent === 0) {
      currentParent = null;
      currentArray = null;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        if (!value) {
          const childObj: Record<string, unknown> = {};
          result[key] = childObj;
          currentParent = { key, obj: childObj };
        } else {
          result[key] = parseValue(value);
        }
      }
    } else if (indent === 2 && currentParent) {
      currentArray = null;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();
        if (!value) {
          const childArr: unknown[] = [];
          currentParent.obj[key] = childArr;
          currentArray = { key, arr: childArr };
        } else {
          currentParent.obj[key] = parseValue(value);
        }
      }
    } else if (indent >= 4 && currentArray && trimmed.startsWith('- ')) {
      const itemVal = trimmed.slice(2).trim();
      currentArray.arr.push(parseValue(itemVal));
    }
  }

  return result;
}

function parseValue(val: string): unknown {
  val = val.trim();
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === '[]') return [];
  if (val === '{}') return {};
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}
