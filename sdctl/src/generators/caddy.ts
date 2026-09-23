import type { DeploymentSpec } from '../types.js';
import { generateHeader } from './header.js';

export function buildTlsDirectives(spec: DeploymentSpec): string[] {
  if (spec.tls.mode === 'provided') {
    return ['    tls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem'];
  }

  if (spec.tls.mode === 'acme-dns' && spec.tls.dnsProvider) {
    const dns = spec.tls.dnsProvider;
    if (dns.name === 'cloudflare') {
      const tokenVar = dns.apiTokenEnvVar || 'CLOUDFLARE_API_TOKEN';
      const lines = ['    tls {', `        dns cloudflare {env.${tokenVar}}`];
      if (dns.resolvers && dns.resolvers.length > 0) {
        lines.push(`        resolvers ${dns.resolvers.join(' ')}`);
      }
      if (dns.propagationDelay) {
        lines.push(`        propagation_delay ${dns.propagationDelay}`);
      }
      if (dns.propagationTimeout) {
        lines.push(`        propagation_timeout ${dns.propagationTimeout}`);
      }
      lines.push('    }');
      return lines;
    }
  }

  return [];
}

export function generateCaddyfile(spec: DeploymentSpec): string {
  const header = generateHeader('#');
  const lines: string[] = [header];

  const editorHost = spec.tls.editorHost || spec.tls.domain || 'localhost';
  const relayHost = spec.tls.relayHost || editorHost;
  const isSingleHost = editorHost === relayHost;
  const isWildcard = Boolean(spec.tls.domain && spec.tls.domain.startsWith('*.'));

  const tlsDirectives = buildTlsDirectives(spec);

  const cidrList =
    spec.relay?.allowedCidrs && spec.relay.allowedCidrs.length > 0
      ? spec.relay.allowedCidrs.join(' ')
      : null;

  if (isWildcard && spec.tls.domain) {
    // Wildcard domain deployment (e.g., *.home.jbraunsma.dev)
    lines.push(`${spec.tls.domain} {`);
    if (tlsDirectives.length > 0) {
      lines.push(...tlsDirectives);
    }

    lines.push('');
    if (!isSingleHost) {
      lines.push(`    @relay host ${relayHost}`);
      if (cidrList) {
        lines.push(
          `    @relay_blocked {\n        host ${relayHost}\n        not client_ip ${cidrList}\n    }`,
        );
        lines.push(
          '    respond @relay_blocked "Access Denied: Relay restricted by source CIDR" 403',
        );
      }
      lines.push('    handle @relay {');
      lines.push('        reverse_proxy relay:4444');
      lines.push('    }');
    } else {
      lines.push('    @relay_path path /relay*');
      if (cidrList) {
        lines.push(
          `    @relay_blocked {\n        path /relay*\n        not client_ip ${cidrList}\n    }`,
        );
        lines.push(
          '    respond @relay_blocked "Access Denied: Relay restricted by source CIDR" 403',
        );
      }
      lines.push('    handle @relay_path {');
      lines.push('        uri strip_prefix /relay');
      lines.push('        reverse_proxy relay:4444');
      lines.push('    }');
    }

    lines.push('');
    lines.push('    handle {');
    lines.push('        reverse_proxy editor:80');
    lines.push('    }');
    lines.push('}');
  } else if (isSingleHost) {
    // Single host deployment: editor at root, relay at /relay or direct port
    lines.push(`${editorHost} {`);
    if (tlsDirectives.length > 0) {
      lines.push(...tlsDirectives);
    }

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
    if (tlsDirectives.length > 0) {
      lines.push(...tlsDirectives);
    }
    lines.push('    reverse_proxy editor:80');
    lines.push('}');
    lines.push('');

    // 2. Relay site block
    lines.push(`${relayHost} {`);
    if (tlsDirectives.length > 0) {
      lines.push(...tlsDirectives);
    }

    if (cidrList) {
      lines.push(`    @relay_blocked not client_ip ${cidrList}`);
      lines.push('    respond @relay_blocked "Access Denied: Relay restricted by source CIDR" 403');
    }

    lines.push('    reverse_proxy relay:4444');
    lines.push('}');
  }

  return lines.join('\n') + '\n';
}
