import type { ValidationResult, ValidationError } from './types.js';

const VALID_MODES = ['public', 'isolated'];
const VALID_TOPOLOGIES = ['lan', 'routed', 'nat', 'multisite'];
const VALID_TLS_MODES = ['acme', 'acme-dns', 'provided', 'external', 'none'];

const CIDR_REGEX =
  /^(([0-9]{1,3}\.){3}[0-9]{1,3}\/([0-9]|[1-2][0-9]|3[0-2])|([a-fA-F0-9:]+)\/([0-9]|[1-9][0-9]|1[0-2][0-8]))$/;

export function validateDeploymentSpec(spec: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!spec || typeof spec !== 'object') {
    return {
      valid: false,
      errors: [
        {
          path: '',
          message: 'Deployment specification must be a non-empty object',
          suggestedFix: 'Provide a valid deployment.yaml configuration file.',
        },
      ],
    };
  }

  const s = spec as Record<string, unknown>;

  // Version
  if (!s.version || typeof s.version !== 'string') {
    errors.push({
      path: 'version',
      message: 'Spec version is required and must be a string (e.g., "1")',
      suggestedFix: 'Add `version: "1"` at the root of deployment.yaml.',
    });
  }

  // Mode
  if (!s.mode || typeof s.mode !== 'string' || !VALID_MODES.includes(s.mode)) {
    errors.push({
      path: 'mode',
      message: `Invalid deployment mode: "${s.mode}". Must be one of: ${VALID_MODES.join(', ')}`,
      suggestedFix: 'Set `mode: "public"` or `mode: "isolated"`.',
    });
  }

  // Topology
  if (!s.topology || typeof s.topology !== 'string' || !VALID_TOPOLOGIES.includes(s.topology)) {
    errors.push({
      path: 'topology',
      message: `Invalid network topology: "${s.topology}". Must be one of: ${VALID_TOPOLOGIES.join(', ')}`,
      suggestedFix: 'Set `topology` to "lan", "routed", "nat", or "multisite".',
    });
  }

  // Proxy override validation (optional)
  if (s.proxy !== undefined) {
    if (!s.proxy || typeof s.proxy !== 'object') {
      errors.push({
        path: 'proxy',
        message: '`proxy` configuration must be an object',
        suggestedFix: 'Provide a valid `proxy` object with an optional `image` field.',
      });
    } else {
      const proxy = s.proxy as Record<string, unknown>;
      if (proxy.image !== undefined && (typeof proxy.image !== 'string' || !proxy.image.trim())) {
        errors.push({
          path: 'proxy.image',
          message: '`proxy.image` must be a non-empty string',
          suggestedFix:
            'Specify a valid Docker image reference (e.g., "slothcroissant/caddy-cloudflaredns:latest").',
        });
      }
    }
  }

  // TLS
  if (!s.tls || typeof s.tls !== 'object') {
    errors.push({
      path: 'tls',
      message: '`tls` configuration object is required',
      suggestedFix:
        'Add a `tls` section with `mode: "acme"`, "acme-dns", "provided", "external", or "none".',
    });
  } else {
    const tls = s.tls as Record<string, unknown>;
    if (!tls.mode || typeof tls.mode !== 'string' || !VALID_TLS_MODES.includes(tls.mode)) {
      errors.push({
        path: 'tls.mode',
        message: `Invalid TLS mode: "${tls.mode}". Must be one of: ${VALID_TLS_MODES.join(', ')}`,
        suggestedFix: 'Set `tls.mode` to "acme", "acme-dns", "provided", "external", or "none".',
      });
    }

    // Cross-validation: Isolated mode cannot use ACME
    if (s.mode === 'isolated' && (tls.mode === 'acme' || tls.mode === 'acme-dns')) {
      errors.push({
        path: 'tls.mode',
        message:
          'ACME automatic certificates cannot be used in isolated mode without public internet access',
        suggestedFix:
          'Change `tls.mode` to "provided" (operator-supplied certs), "external", or "none".',
      });
    }

    // DNS-01 ACME validation
    if (tls.mode === 'acme-dns') {
      if (!tls.dnsProvider || typeof tls.dnsProvider !== 'object') {
        errors.push({
          path: 'tls.dnsProvider',
          message:
            '`tls.dnsProvider` configuration object is required when `tls.mode` is "acme-dns"',
          suggestedFix: 'Add `tls.dnsProvider` with `name: "cloudflare"` and provider settings.',
        });
      } else {
        const dns = tls.dnsProvider as Record<string, unknown>;
        if (!dns.name || typeof dns.name !== 'string') {
          errors.push({
            path: 'tls.dnsProvider.name',
            message: '`tls.dnsProvider.name` is required (e.g., "cloudflare")',
            suggestedFix: 'Set `tls.dnsProvider.name` to "cloudflare".',
          });
        }
        if (dns.resolvers !== undefined) {
          if (!Array.isArray(dns.resolvers) || !dns.resolvers.every((r) => typeof r === 'string')) {
            errors.push({
              path: 'tls.dnsProvider.resolvers',
              message:
                '`tls.dnsProvider.resolvers` must be an array of string resolver addresses or nameservers',
              suggestedFix: 'Provide an array of DNS resolvers (e.g., ["1.1.1.1", "1.0.0.1"]).',
            });
          }
        }
        if (dns.propagationDelay !== undefined && typeof dns.propagationDelay !== 'string') {
          errors.push({
            path: 'tls.dnsProvider.propagationDelay',
            message: '`tls.dnsProvider.propagationDelay` must be a duration string (e.g., "30s")',
            suggestedFix:
              'Set `tls.dnsProvider.propagationDelay` to a string such as "30s" or "1m".',
          });
        }
        if (dns.propagationTimeout !== undefined && typeof dns.propagationTimeout !== 'string') {
          errors.push({
            path: 'tls.dnsProvider.propagationTimeout',
            message: '`tls.dnsProvider.propagationTimeout` must be a duration string (e.g., "10m")',
            suggestedFix:
              'Set `tls.dnsProvider.propagationTimeout` to a string such as "10m" or "5m".',
          });
        }
      }
    }

    // Provided TLS requires certificate and key paths
    if (tls.mode === 'provided') {
      if (!tls.certificatePath || typeof tls.certificatePath !== 'string') {
        errors.push({
          path: 'tls.certificatePath',
          message: '`tls.certificatePath` is required when `tls.mode` is "provided"',
          suggestedFix: 'Specify the path to the PEM-encoded TLS certificate file.',
        });
      }
      if (!tls.privateKeyPath || typeof tls.privateKeyPath !== 'string') {
        errors.push({
          path: 'tls.privateKeyPath',
          message: '`tls.privateKeyPath` is required when `tls.mode` is "provided"',
          suggestedFix: 'Specify the path to the PEM-encoded private key file.',
        });
      }
    }

    // Hosts / domains
    if (tls.mode !== 'none' && !tls.domain && !tls.editorHost) {
      errors.push({
        path: 'tls.editorHost',
        message: '`tls.editorHost` (or `tls.domain`) is required for TLS configuration',
        suggestedFix: 'Specify the public FQDN or hostname for the editor.',
      });
    }
  }

  // Topology vs TURN
  const isNatOrMultisite = s.topology === 'nat' || s.topology === 'multisite';
  const turnObj = s.turn as Record<string, unknown> | undefined;
  const turnEnabled = Boolean(turnObj?.enabled);
  const iceServersStr = typeof s.iceServers === 'string' ? s.iceServers : '';
  const hasTurnInIceServers = iceServersStr.toLowerCase().includes('turn:');

  if (isNatOrMultisite && !turnEnabled && !hasTurnInIceServers) {
    errors.push({
      path: 'turn.enabled',
      message: `Network topology "${s.topology}" requires TURN to ensure peer connectivity across NAT/subnets`,
      suggestedFix:
        'Set `turn.enabled: true` to deploy coturn, or provide an external TURN server in `iceServers`.',
    });
  }

  // Isolated mode vs Public STUN
  if (s.mode === 'isolated') {
    const publicStunPatterns = [
      'google.com',
      'twilio.com',
      'cloudflare.com',
      'stun.stunprotocol.org',
    ];
    const lowerIce = iceServersStr.toLowerCase();
    const hasPublicStun = publicStunPatterns.some((pattern) => lowerIce.includes(pattern));
    if (hasPublicStun) {
      errors.push({
        path: 'iceServers',
        message:
          'Public STUN servers are configured in isolated mode, which will cause connection timeouts',
        suggestedFix:
          'Change `iceServers` to "none" for LAN or specify internal STUN/TURN server URLs.',
      });
    }
  }

  // Relay access CIDRs
  if (s.relay && typeof s.relay === 'object') {
    const relay = s.relay as Record<string, unknown>;
    if (relay.allowedCidrs !== undefined) {
      if (!Array.isArray(relay.allowedCidrs)) {
        errors.push({
          path: 'relay.allowedCidrs',
          message: '`relay.allowedCidrs` must be an array of CIDR strings',
          suggestedFix: 'Provide an array of CIDR blocks (e.g., ["10.0.0.0/8", "192.168.1.0/24"]).',
        });
      } else {
        relay.allowedCidrs.forEach((cidr, index) => {
          if (typeof cidr !== 'string' || !CIDR_REGEX.test(cidr.trim())) {
            errors.push({
              path: `relay.allowedCidrs[${index}]`,
              message: `Invalid CIDR notation: "${cidr}"`,
              suggestedFix:
                'Use valid IPv4 or IPv6 CIDR format (e.g., "192.168.1.0/24" or "10.0.0.1/32").',
            });
          }
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
