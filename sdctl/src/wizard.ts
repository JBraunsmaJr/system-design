import * as readline from 'readline';
import { existsSync, readFileSync } from 'fs';
import type { DeploymentSpec, WizardAnswers, DeploymentMode, Topology, TlsMode } from './types.js';
import { parseSimpleYaml } from './yaml.js';

export function buildDeploymentSpec(answers: WizardAnswers): DeploymentSpec {
  const mode: DeploymentMode = answers.mode || 'public';
  const topology: Topology = answers.topology || 'lan';
  const tlsMode: TlsMode = answers.tlsMode || (mode === 'isolated' ? 'provided' : 'acme');

  const editorHost =
    answers.editorHost ||
    (answers.domain && !answers.domain.startsWith('*.') ? answers.domain : 'localhost');
  const relayHost =
    answers.relayHost || (answers.singleHost !== false ? editorHost : `relay.${editorHost}`);

  let allowedCidrs: string[] | undefined;
  if (answers.allowedCidrs) {
    if (Array.isArray(answers.allowedCidrs)) {
      allowedCidrs = answers.allowedCidrs;
    } else if (typeof answers.allowedCidrs === 'string') {
      allowedCidrs = answers.allowedCidrs
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  const isNatOrMultisite = topology === 'nat' || topology === 'multisite';
  const turnEnabled = answers.enableTurn ?? isNatOrMultisite;

  let resolvers: string[] | undefined;
  if (answers.cloudflareResolvers) {
    if (Array.isArray(answers.cloudflareResolvers)) {
      resolvers = answers.cloudflareResolvers;
    } else if (typeof answers.cloudflareResolvers === 'string') {
      resolvers = answers.cloudflareResolvers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  const dnsProvider =
    tlsMode === 'acme-dns' || answers.dnsProviderName
      ? {
          name: answers.dnsProviderName || 'cloudflare',
          apiTokenEnvVar: answers.cloudflareApiTokenEnvVar,
          apiToken: answers.cloudflareApiToken,
          resolvers,
          propagationDelay: answers.cloudflarePropagationDelay,
          propagationTimeout: answers.cloudflarePropagationTimeout,
        }
      : undefined;

  let paths: { editor?: string; relay?: string } | undefined;
  if (answers.editorPath || answers.relayPath || answers.paths) {
    const editor = answers.editorPath || answers.paths?.editor;
    const relay = answers.relayPath || answers.paths?.relay;
    if (editor || relay) {
      paths = {
        editor: editor || undefined,
        relay: relay || undefined,
      };
    }
  }

  const spec: DeploymentSpec = {
    version: '1',
    mode,
    topology,
    proxy: answers.proxyImage ? { image: answers.proxyImage } : undefined,
    tls: {
      mode: tlsMode,
      domain: answers.domain || (editorHost.startsWith('*.') ? editorHost : undefined),
      editorHost: tlsMode !== 'none' ? editorHost : undefined,
      relayHost: tlsMode !== 'none' ? relayHost : undefined,
      certificatePath: answers.certificatePath,
      privateKeyPath: answers.privateKeyPath,
      caPath: answers.caPath,
      dnsProvider,
    },
    paths,
    registry: answers.registryPrefix ? { prefix: answers.registryPrefix } : undefined,
    relay: {
      allowedCidrs: allowedCidrs || [],
    },
    turn: turnEnabled
      ? {
          enabled: true,
          externalIp: answers.turnExternalIp,
          realm: editorHost,
        }
      : undefined,
    iceServers: answers.customIceServers,
  };

  return spec;
}

export function loadAnswersFile(filePath: string): WizardAnswers {
  if (!existsSync(filePath)) {
    throw new Error(`Answers file not found at: ${filePath}`);
  }
  const content = readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.json')) {
    return JSON.parse(content) as WizardAnswers;
  }
  return parseSimpleYaml(content) as WizardAnswers;
}

export async function promptQuestion(
  rl: readline.Interface,
  query: string,
  defaultValue?: string,
): Promise<string> {
  const prompt = defaultValue ? `${query} [${defaultValue}]: ` : `${query}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

export async function runInteractiveWizard(answers: WizardAnswers = {}): Promise<DeploymentSpec> {
  if (!process.stdin.isTTY) {
    throw new Error(
      'Interactive input requested but no TTY is attached. Use `--yes` or `--answers <file>` in non-interactive environments.',
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n=== System Design Editor Setup Wizard (`sdctl init`) ===\n');

  try {
    // 1. Mode
    console.log('1. Deployment Environment Mode:');
    console.log(
      '  [1] Public (Internet-connected registry, ACME certificates, public STUN permitted)',
    );
    console.log(
      '  [2] Isolated (Air-gapped / private network, internal registry, no outbound connections)',
    );
    const modeChoice = await promptQuestion(
      rl,
      'Select mode (1 or 2)',
      answers.mode === 'isolated' ? '2' : '1',
    );
    const mode: DeploymentMode =
      modeChoice === '2' || answers.mode === 'isolated' ? 'isolated' : 'public';

    // 2. Topology
    console.log('\n2. Network Topology between collaborating users:');
    console.log('  [1] LAN: All clients on the same flat local subnet (no ICE / STUN required)');
    console.log('  [2] Routed: Clients across corporate subnets with direct IP routing');
    console.log(
      '  [3] NAT: Clients behind NAT routers relative to each other (STUN + TURN required)',
    );
    console.log(
      '  [4] Multi-site: Clients across different physical branches or VPN tunnels (TURN required)',
    );
    const topoChoice = await promptQuestion(rl, 'Select topology (1-4)', '1');
    let topology: Topology = 'lan';
    if (topoChoice === '2') topology = 'routed';
    else if (topoChoice === '3') topology = 'nat';
    else if (topoChoice === '4') topology = 'multisite';

    // 3. TLS Mode
    console.log('\n3. TLS / HTTPS Configuration:');
    let tlsMode: TlsMode = 'none';
    let domain: string | undefined;
    let editorPath: string | undefined;
    let relayPath: string | undefined;
    let dnsProviderName: string | undefined;
    let cloudflareApiToken: string | undefined;
    let cloudflareResolvers: string[] | undefined;
    let proxyImage: string | undefined;

    if (mode === 'public') {
      console.log("  [1] Automatic HTTPS with Caddy HTTP-01 (ACME / Let's Encrypt)");
      console.log('  [2] Automatic HTTPS via Cloudflare DNS-01 (ACME / Wildcard domain)');
      console.log('  [3] Operator-supplied Custom Certificates (PEM cert + key)');
      console.log('  [4] External Reverse Proxy (Operator manages own TLS termination)');
      console.log('  [5] None (Plain HTTP/WS - local evaluation only)');
      const tlsChoice = await promptQuestion(rl, 'Select TLS mode (1-5)', '1');
      tlsMode = 'acme';
      if (tlsChoice === '2') {
        tlsMode = 'acme-dns';
        dnsProviderName = 'cloudflare';
      } else if (tlsChoice === '3') {
        tlsMode = 'provided';
      } else if (tlsChoice === '4') {
        tlsMode = 'external';
      } else if (tlsChoice === '5') {
        tlsMode = 'none';
      }
    } else {
      console.log('  [1] Operator-supplied Custom Certificates (Internal CA / PEM cert + key)');
      console.log('  [2] External Reverse Proxy (Operator manages own TLS termination)');
      console.log('  [3] None (Plain HTTP/WS - local evaluation only)');
      const tlsChoice = await promptQuestion(rl, 'Select TLS mode (1-3)', '1');
      tlsMode = 'provided';
      if (tlsChoice === '2') tlsMode = 'external';
      else if (tlsChoice === '3') tlsMode = 'none';
    }

    // 4. Hostnames
    let editorHost = 'localhost';
    let relayHost = 'localhost';
    if (tlsMode === 'acme-dns') {
      domain = await promptQuestion(
        rl,
        '\nPrimary or Wildcard Domain (e.g. *.home.example.com or editor.home.example.com)',
        '*.example.com',
      );
      const isWildcard = domain.startsWith('*.');
      const baseDomain = isWildcard ? domain.slice(2) : domain;
      if (isWildcard) {
        editorHost = await promptQuestion(
          rl,
          'Public domain / hostname for Editor',
          `design.${baseDomain}`,
        );
        relayHost = await promptQuestion(
          rl,
          'Public domain / hostname for Relay',
          `relay.${baseDomain}`,
        );
      } else {
        editorHost = domain;
        const singleHostAns = await promptQuestion(
          rl,
          `Serve Signaling Relay on same domain under subpath (${editorHost}/relay)? (y/n)`,
          'y',
        );
        if (singleHostAns.toLowerCase().startsWith('y')) {
          relayHost = editorHost;
          const editorPathAns = await promptQuestion(
            rl,
            'Subpath for Editor (leave blank or "/" for root, or e.g. /editor)',
            '/',
          );
          if (editorPathAns && editorPathAns !== '/') {
            editorPath = editorPathAns;
          }
          const relayPathAns = await promptQuestion(rl, 'Subpath for Signaling Relay', '/relay');
          if (relayPathAns) {
            relayPath = relayPathAns;
          }
        } else {
          relayHost = await promptQuestion(
            rl,
            'Public domain / hostname for Relay',
            `relay.${baseDomain}`,
          );
        }
      }

      cloudflareApiToken = await promptQuestion(
        rl,
        'Cloudflare API Token (optional, or set via CLOUDFLARE_API_TOKEN env)',
        '',
      );

      const resolversInput = await promptQuestion(
        rl,
        'Custom DNS Resolvers for Cloudflare ACME (optional, comma-separated e.g. 1.1.1.1, 1.0.0.1)',
        '',
      );
      if (resolversInput) {
        cloudflareResolvers = resolversInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }

      proxyImage = await promptQuestion(
        rl,
        'Custom Proxy Image (optional)',
        'slothcroissant/caddy-cloudflaredns:latest',
      );
    } else if (tlsMode !== 'none') {
      editorHost = await promptQuestion(
        rl,
        '\nPublic domain / hostname for Editor (e.g. design.example.com)',
        'design.example.com',
      );
      const singleHostAns = await promptQuestion(
        rl,
        'Serve Signaling Relay under subpath on same domain (/relay)? (y/n)',
        'y',
      );
      if (singleHostAns.toLowerCase().startsWith('y')) {
        relayHost = editorHost;
      } else {
        relayHost = await promptQuestion(
          rl,
          'Public domain / hostname for Relay (e.g. relay.example.com)',
          `relay.${editorHost}`,
        );
      }
    }

    let certificatePath: string | undefined;
    let privateKeyPath: string | undefined;
    if (tlsMode === 'provided') {
      certificatePath = await promptQuestion(
        rl,
        'Path to certificate PEM file',
        './certs/cert.pem',
      );
      privateKeyPath = await promptQuestion(rl, 'Path to private key PEM file', './certs/key.pem');
    }

    // 5. Access restriction (public mode)
    let allowedCidrs: string[] = [];
    if (mode === 'public') {
      console.log('\nNotice: The WebRTC signaling relay is unauthenticated by default.');
      const restrictAns = await promptQuestion(
        rl,
        'Would you like to restrict relay access to specific IP CIDRs? (y/n)',
        'n',
      );
      if (restrictAns.toLowerCase().startsWith('y')) {
        const cidrs = await promptQuestion(
          rl,
          'Comma-separated allowed CIDRs (e.g. 10.0.0.0/8, 192.168.1.0/24)',
          '',
        );
        allowedCidrs = cidrs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }

    // 6. TURN
    const enableTurn = topology === 'nat' || topology === 'multisite';
    let turnExternalIp: string | undefined;
    if (enableTurn) {
      console.log('\nTopology requires TURN server for reliable media relay.');
      turnExternalIp = await promptQuestion(
        rl,
        'Public / reachable IP address for TURN server (optional)',
        '',
      );
    }

    const compiledAnswers: WizardAnswers = {
      mode,
      topology,
      tlsMode,
      domain,
      dnsProviderName,
      cloudflareApiToken: cloudflareApiToken || undefined,
      cloudflareResolvers,
      proxyImage: proxyImage || undefined,
      editorHost,
      relayHost,
      singleHost: editorHost === relayHost,
      editorPath: editorPath || undefined,
      relayPath: relayPath || undefined,
      certificatePath,
      privateKeyPath,
      allowedCidrs,
      enableTurn,
      turnExternalIp: turnExternalIp || undefined,
    };

    const spec = buildDeploymentSpec(compiledAnswers);
    return spec;
  } finally {
    rl.close();
  }
}
