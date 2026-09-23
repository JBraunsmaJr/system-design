import type { DeploymentSpec } from './types.js';

export function dumpDeploymentSpecYaml(spec: DeploymentSpec): string {
  const lines: string[] = [];
  lines.push(`version: "${spec.version || '1'}"`);
  lines.push(`mode: "${spec.mode}"`);
  lines.push(`topology: "${spec.topology}"`);

  if (spec.proxy?.image) {
    lines.push('');
    lines.push('proxy:');
    lines.push(`  image: "${spec.proxy.image}"`);
  }

  lines.push('');
  lines.push('tls:');
  lines.push(`  mode: "${spec.tls.mode}"`);
  if (spec.tls.domain) lines.push(`  domain: "${spec.tls.domain}"`);
  if (spec.tls.editorHost) lines.push(`  editorHost: "${spec.tls.editorHost}"`);
  if (spec.tls.relayHost) lines.push(`  relayHost: "${spec.tls.relayHost}"`);
  if (spec.tls.certificatePath) lines.push(`  certificatePath: "${spec.tls.certificatePath}"`);
  if (spec.tls.privateKeyPath) lines.push(`  privateKeyPath: "${spec.tls.privateKeyPath}"`);
  if (spec.tls.caPath) lines.push(`  caPath: "${spec.tls.caPath}"`);

  if (spec.tls.dnsProvider) {
    lines.push('  dnsProvider:');
    lines.push(`    name: "${spec.tls.dnsProvider.name}"`);
    if (spec.tls.dnsProvider.apiTokenEnvVar) {
      lines.push(`    apiTokenEnvVar: "${spec.tls.dnsProvider.apiTokenEnvVar}"`);
    }
    if (spec.tls.dnsProvider.resolvers && spec.tls.dnsProvider.resolvers.length > 0) {
      lines.push('    resolvers:');
      for (const res of spec.tls.dnsProvider.resolvers) {
        lines.push(`      - "${res}"`);
      }
    }
    if (spec.tls.dnsProvider.propagationDelay) {
      lines.push(`    propagationDelay: "${spec.tls.dnsProvider.propagationDelay}"`);
    }
    if (spec.tls.dnsProvider.propagationTimeout) {
      lines.push(`    propagationTimeout: "${spec.tls.dnsProvider.propagationTimeout}"`);
    }
  }

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

interface StackFrame {
  indent: number;
  node: Record<string, unknown> | unknown[];
  key?: string;
  parent?: Record<string, unknown> | unknown[];
}

export function parseSimpleYaml(content: string): Record<string, unknown> {
  const trimmedContent = content.trim();
  if (trimmedContent.startsWith('{')) {
    try {
      return JSON.parse(trimmedContent) as Record<string, unknown>;
    } catch {
      // Fall through to YAML parser
    }
  }

  const root: Record<string, unknown> = {};
  const stack: StackFrame[] = [{ indent: -1, node: root }];

  const lines = content.split('\n');

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = raw.length - raw.trimStart().length;

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1];

    if (trimmed.startsWith('- ')) {
      const itemVal = parseValue(trimmed.slice(2).trim());
      if (Array.isArray(current.node)) {
        current.node.push(itemVal);
      } else if (
        current.parent &&
        current.key &&
        typeof current.node === 'object' &&
        Object.keys(current.node).length === 0
      ) {
        const newArr: unknown[] = [itemVal];
        if (Array.isArray(current.parent)) {
          const idx = current.parent.indexOf(current.node);
          if (idx >= 0) current.parent[idx] = newArr;
        } else {
          (current.parent as Record<string, unknown>)[current.key] = newArr;
        }
        current.node = newArr;
      }
    } else {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        const value = trimmed.slice(colonIdx + 1).trim();

        if (Array.isArray(current.node)) {
          // Object item inside array
          const childObj: Record<string, unknown> = {};
          if (!value) {
            current.node.push(childObj);
            stack.push({ indent, node: childObj, key, parent: current.node });
          } else {
            childObj[key] = parseValue(value);
            current.node.push(childObj);
          }
        } else {
          const targetObj = current.node as Record<string, unknown>;
          if (!value) {
            const childObj: Record<string, unknown> = {};
            targetObj[key] = childObj;
            stack.push({ indent, node: childObj, key, parent: targetObj });
          } else {
            targetObj[key] = parseValue(value);
          }
        }
      }
    }
  }

  return root;
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
