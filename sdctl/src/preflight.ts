import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type {
  PreflightOptions,
  PreflightReport,
  CheckResult,
  DeploymentSpec,
  ReleaseManifest,
} from './types.js';
import { checkDockerSocket, checkMountPathParity } from './host.js';
import { validateDeploymentSpec } from './schema.js';
import { parseSimpleYaml } from './yaml.js';
import { DEFAULT_MANIFEST } from './manifest.js';
import { validateCertificates } from './cert.js';

export function runPreflightChecks(options: PreflightOptions = {}): PreflightReport {
  const workingDir = options.workingDir || process.cwd();
  const forceList = new Set((options.force || []).map((id) => id.trim().toUpperCase()));
  const checks: CheckResult[] = [];
  const forcedCheckIds: string[] = [];

  const manifest: ReleaseManifest = options.manifest || DEFAULT_MANIFEST;

  // 1. Host Docker Socket (PRE-HOST-SOCK)
  const sockCheck = checkDockerSocket();
  const sockId = 'PRE-HOST-SOCK';
  if (sockCheck.valid) {
    checks.push({
      id: sockId,
      name: 'Docker Socket Accessibility',
      status: 'pass',
      expected: 'Accessible Docker/Podman socket',
      observed: `Socket accessible at ${sockCheck.socketPath}`,
    });
  } else if (forceList.has(sockId)) {
    forcedCheckIds.push(sockId);
    checks.push({
      id: sockId,
      name: 'Docker Socket Accessibility',
      status: 'skip',
      expected: 'Accessible Docker/Podman socket',
      observed: `Bypassed by --force (${sockCheck.error})`,
      cause: 'Docker socket check bypassed by operator',
      remediation: sockCheck.remediation,
    });
  } else {
    checks.push({
      id: sockId,
      name: 'Docker Socket Accessibility',
      status: 'fail',
      expected: 'Accessible Docker/Podman socket',
      observed: sockCheck.error || 'Docker socket not found',
      cause: 'Host Docker socket not mounted into container or daemon not running',
      remediation: sockCheck.remediation,
    });
  }

  // 2. Working Directory Mount Parity (PRE-HOST-MOUNT)
  const mountCheck = checkMountPathParity(workingDir);
  const mountId = 'PRE-HOST-MOUNT';
  if (mountCheck.valid) {
    checks.push({
      id: mountId,
      name: 'Mount Path Parity',
      status: 'pass',
      expected: 'Working directory path matches host mount path',
      observed: `Directory '${workingDir}' matches host mount`,
    });
  } else if (forceList.has(mountId)) {
    forcedCheckIds.push(mountId);
    checks.push({
      id: mountId,
      name: 'Mount Path Parity',
      status: 'skip',
      expected: 'Working directory path matches host mount path',
      observed: `Bypassed by --force (${mountCheck.error})`,
      cause: 'Mount path parity check bypassed by operator',
      remediation: mountCheck.remediation,
    });
  } else {
    checks.push({
      id: mountId,
      name: 'Mount Path Parity',
      status: 'fail',
      expected: 'Working directory path matches host mount path',
      observed: mountCheck.error || 'Mount mismatch detected',
      cause:
        'Bind-mount paths in Docker containers must have identical absolute paths on host and container',
      remediation: mountCheck.remediation,
    });
  }

  // 3. Deployment Spec Validity (PRE-CFG-SPEC)
  let spec: DeploymentSpec | null = options.spec || null;
  const specId = 'PRE-CFG-SPEC';
  if (!spec) {
    const specPath = join(workingDir, 'deployment.yaml');
    if (!existsSync(specPath)) {
      if (forceList.has(specId)) {
        forcedCheckIds.push(specId);
        checks.push({
          id: specId,
          name: 'Deployment Spec Schema',
          status: 'skip',
          expected: 'Valid deployment.yaml in working directory',
          observed: `deployment.yaml not found (bypassed by --force)`,
          cause: 'Spec file missing',
          remediation: "Run 'sdctl init' to generate a deployment.yaml spec",
        });
      } else {
        checks.push({
          id: specId,
          name: 'Deployment Spec Schema',
          status: 'fail',
          expected: 'Valid deployment.yaml in working directory',
          observed: `File '${specPath}' does not exist`,
          cause: 'No deployment.yaml found',
          remediation: "Run 'sdctl init' to create a deployment configuration",
        });
      }
    } else {
      try {
        const rawYaml = readFileSync(specPath, 'utf8');
        spec = parseSimpleYaml(rawYaml) as unknown as DeploymentSpec;
      } catch (err) {
        if (forceList.has(specId)) {
          forcedCheckIds.push(specId);
          checks.push({
            id: specId,
            name: 'Deployment Spec Schema',
            status: 'skip',
            expected: 'Valid YAML deployment.yaml',
            observed: `YAML parse error bypassed: ${(err as Error).message}`,
          });
        } else {
          checks.push({
            id: specId,
            name: 'Deployment Spec Schema',
            status: 'fail',
            expected: 'Valid YAML deployment.yaml',
            observed: `YAML parse error: ${(err as Error).message}`,
            cause: 'Syntax error in deployment.yaml',
            remediation: 'Check deployment.yaml for valid YAML indentation and syntax',
          });
        }
      }
    }
  }

  if (spec) {
    const validation = validateDeploymentSpec(spec);
    if (validation.valid) {
      checks.push({
        id: specId,
        name: 'Deployment Spec Schema',
        status: 'pass',
        expected: 'Valid schema adhering to specification',
        observed: `Deployment spec v${spec.version} (${spec.mode} mode, ${spec.topology} topology) is valid`,
      });
    } else if (forceList.has(specId)) {
      forcedCheckIds.push(specId);
      checks.push({
        id: specId,
        name: 'Deployment Spec Schema',
        status: 'skip',
        expected: 'Valid schema adhering to specification',
        observed: `Validation errors bypassed (${validation.errors.length} errors)`,
        cause: validation.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
        remediation: validation.errors.map((e) => `${e.path}: ${e.suggestedFix}`).join('; '),
      });
    } else {
      const errDetails = validation.errors.map((e) => `${e.path}: ${e.message}`).join(', ');
      const fixDetails = validation.errors.map((e) => e.suggestedFix).join(', ');
      checks.push({
        id: specId,
        name: 'Deployment Spec Schema',
        status: 'fail',
        expected: 'Valid schema adhering to specification',
        observed: errDetails,
        cause: `Deployment spec contains ${validation.errors.length} validation errors`,
        remediation: fixDetails,
      });
    }
  }

  // 4. Manifest Image Digests (PRE-REG-DIGESTS)
  const regId = 'PRE-REG-DIGESTS';
  const images = manifest.images;
  const invalidDigests: string[] = [];
  for (const [comp, img] of Object.entries(images)) {
    if (!img.digest || !img.digest.startsWith('sha256:') || img.digest.length < 10) {
      invalidDigests.push(`${comp} (${img.digest || 'missing'})`);
    }
  }

  if (invalidDigests.length === 0) {
    checks.push({
      id: regId,
      name: 'Release Manifest Image Pinning',
      status: 'pass',
      expected: 'All release images pinned by immutable sha256 digest',
      observed: `All ${Object.keys(images).length} component images pinned by sha256 digest in manifest v${manifest.version}`,
    });
  } else if (forceList.has(regId)) {
    forcedCheckIds.push(regId);
    checks.push({
      id: regId,
      name: 'Release Manifest Image Pinning',
      status: 'skip',
      expected: 'All release images pinned by immutable sha256 digest',
      observed: `Bypassed by --force (${invalidDigests.join(', ')})`,
    });
  } else {
    checks.push({
      id: regId,
      name: 'Release Manifest Image Pinning',
      status: 'fail',
      expected: 'All release images pinned by immutable sha256 digest',
      observed: `Invalid or missing image digests: ${invalidDigests.join(', ')}`,
      cause: 'Release manifest does not contain pinned SHA-256 digests for all components',
      remediation:
        'Ensure release-manifest.json specifies a valid sha256:<hex> digest for each image',
    });
  }

  // 5. TLS Certificate Validation (PRE-TLS-CERTS)
  if (spec && spec.tls && spec.tls.mode === 'provided') {
    const certId = 'PRE-TLS-CERTS';
    const certPath = spec.tls.certificatePath || join(workingDir, 'certs', 'cert.pem');
    const keyPath = spec.tls.privateKeyPath || join(workingDir, 'certs', 'key.pem');
    const caPath = spec.tls.caPath ? spec.tls.caPath : undefined;

    const expectedHosts: string[] = [];
    if (spec.tls.domain) expectedHosts.push(spec.tls.domain);
    if (spec.tls.editorHost) expectedHosts.push(spec.tls.editorHost);
    if (spec.tls.relayHost) expectedHosts.push(spec.tls.relayHost);

    const certResult = validateCertificates({
      certPath,
      keyPath,
      caPath,
      expectedHostnames: expectedHosts,
    });

    if (certResult.valid) {
      if (certResult.warnings.length > 0) {
        checks.push({
          id: certId,
          name: 'TLS Certificate and Key Validation',
          status: 'warn',
          expected: 'Valid, unexpired certificate matching hostnames and key',
          observed: `Certificate is valid. Warnings: ${certResult.warnings.join('; ')}`,
          cause: 'Certificate close to expiration',
          remediation: 'Consider renewing the certificate before expiration',
        });
      } else {
        checks.push({
          id: certId,
          name: 'TLS Certificate and Key Validation',
          status: 'pass',
          expected: 'Valid, unexpired certificate matching hostnames and key',
          observed: `Certificate valid for ${certResult.details.daysRemaining ?? 'unknown'} days, SANs: [${(certResult.details.sans || []).join(', ')}]`,
        });
      }
    } else if (forceList.has(certId)) {
      forcedCheckIds.push(certId);
      checks.push({
        id: certId,
        name: 'TLS Certificate and Key Validation',
        status: 'skip',
        expected: 'Valid certificate and matching private key',
        observed: `Bypassed by --force (${certResult.errors.join('; ')})`,
        cause: certResult.errors.join('; '),
        remediation: 'Provide valid PEM encoded certificate and private key files',
      });
    } else {
      checks.push({
        id: certId,
        name: 'TLS Certificate and Key Validation',
        status: 'fail',
        expected: 'Valid certificate and matching private key',
        observed: certResult.errors.join('; '),
        cause: 'Certificate parsing failed, key mismatch, hostname mismatch, or cert expired',
        remediation:
          'Verify certificate/key files exist, match each other, and cover configured hostnames',
      });
    }
  }

  // 6. DNS-01 ACME Provider Validation (PRE-TLS-DNS)
  if (spec && spec.tls && spec.tls.mode === 'acme-dns') {
    const dnsId = 'PRE-TLS-DNS';
    const dns = spec.tls.dnsProvider;
    const tokenVar = dns?.apiTokenEnvVar || 'CLOUDFLARE_API_TOKEN';
    const envToken = process.env[tokenVar];
    const secretsPath = join(workingDir, 'secrets.env');
    let fileToken: string | undefined;
    if (existsSync(secretsPath)) {
      try {
        const parsed = readFileSync(secretsPath, 'utf8');
        const tokenMatch = parsed.match(new RegExp(`^${tokenVar}=(.*)$`, 'm'));
        if (tokenMatch) fileToken = tokenMatch[1].trim();
      } catch {
        // ignore
      }
    }
    const hasToken = Boolean(dns?.apiToken || envToken || fileToken);
    if (hasToken) {
      checks.push({
        id: dnsId,
        name: 'DNS-01 ACME Provider Configuration',
        status: 'pass',
        expected: `Valid DNS-01 provider configuration with ${tokenVar}`,
        observed: `DNS provider '${dns?.name || 'cloudflare'}' configured with API token`,
      });
    } else if (forceList.has(dnsId)) {
      forcedCheckIds.push(dnsId);
      checks.push({
        id: dnsId,
        name: 'DNS-01 ACME Provider Configuration',
        status: 'skip',
        expected: `Valid DNS-01 provider configuration with ${tokenVar}`,
        observed: `Bypassed by --force (Token ${tokenVar} not detected in environment or secrets.env)`,
      });
    } else {
      checks.push({
        id: dnsId,
        name: 'DNS-01 ACME Provider Configuration',
        status: 'warn',
        expected: `API token in environment variable ${tokenVar} or secrets.env`,
        observed: `No ${tokenVar} found in environment or secrets.env`,
        cause: `Caddy ACME DNS-01 challenge for Cloudflare requires ${tokenVar}`,
        remediation: `Set ${tokenVar} in environment or secrets.env`,
      });
    }
  }

  const passed = checks.filter((c) => c.status === 'pass').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  const skipped = checks.filter((c) => c.status === 'skip').length;

  return {
    valid: failed === 0,
    checks,
    forcedCheckIds,
    summary: {
      passed,
      failed,
      warned,
      skipped,
    },
  };
}
