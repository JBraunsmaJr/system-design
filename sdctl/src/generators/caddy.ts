import type { DeploymentSpec } from '../types.js';
import { generateHeader } from './header.js';

export function generateCaddyfile(spec: DeploymentSpec): string {
  const header = generateHeader('#');
  const lines: string[] = [header];

  const editorHost = spec.tls.editorHost || spec.tls.domain || 'localhost';
  const relayHost = spec.tls.relayHost || editorHost;
  const isSingleHost = editorHost === relayHost;

  const tlsDirective =
    spec.tls.mode === 'provided'
      ? '    tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem'
      : '';

  const cidrList =
    spec.relay?.allowedCidrs && spec.relay.allowedCidrs.length > 0
      ? spec.relay.allowedCidrs.join(' ')
      : null;

  if (isSingleHost) {
    // Single host deployment: editor at root, relay at /relay or direct port
    lines.push(`${editorHost} {`);
    if (tlsDirective) lines.push(tlsDirective);

    lines.push('');
    lines.push('    @relay_path path /relay*');
    if (cidrList) {
      lines.push(
        `    @relay_blocked {\n        path /relay*\n        not client_ip ${cidrList}\n    }`,
      );
      lines.push('    respond @relay_blocked "Access Denied: Relay restricted by source CIDR" 403');
    }
    lines.push('    handle @relay_path {');
    lines.push('        uri strip_prefix /relay');
    lines.push('        reverse_proxy relay:4444');
    lines.push('    }');

    lines.push('');
    lines.push('    handle {');
    lines.push('        reverse_proxy editor:80');
    lines.push('    }');
    lines.push('}');
  } else {
    // Separate editor and relay hostnames
    // 1. Editor site block
    lines.push(`${editorHost} {`);
    if (tlsDirective) lines.push(tlsDirective);
    lines.push('    reverse_proxy editor:80');
    lines.push('}');
    lines.push('');

    // 2. Relay site block
    lines.push(`${relayHost} {`);
    if (tlsDirective) lines.push(tlsDirective);

    if (cidrList) {
      lines.push(`    @relay_blocked not client_ip ${cidrList}`);
      lines.push('    respond @relay_blocked "Access Denied: Relay restricted by source CIDR" 403');
    }

    lines.push('    reverse_proxy relay:4444');
    lines.push('}');
  }

  return lines.join('\n') + '\n';
}
