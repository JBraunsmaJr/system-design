import * as readline from 'readline';
import { existsSync, readFileSync } from 'fs';
import type { DeploymentSpec, WizardAnswers, DeploymentMode, Topology, TlsMode } from './types.js';
import { parseSimpleYaml } from './yaml.js';
import { ui } from './ui.js';

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

  let certificatePath = answers.certificatePath;
  let privateKeyPath = answers.privateKeyPath;
  if (tlsMode === 'self-signed') {
    certificatePath = certificatePath || './certs/cert.pem';
    privateKeyPath = privateKeyPath || './certs/key.pem';
  }

  const spec: DeploymentSpec = {
    version: '1',
    mode,
    topology,
    proxy: answers.proxyImage ? { image: answers.proxyImage } : undefined,
    tls: {
      mode: tlsMode,
      domain: answers.domain,
      editorHost: editorHost || undefined,
      relayHost: relayHost || undefined,
      certificatePath,
      privateKeyPath,
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
          realm: answers.turnRealm || editorHost || 'system-design.local',
        }
      : undefined,
  };

  return spec;
}

export function loadAnswersFile(path: string): WizardAnswers {
  if (!existsSync(path)) {
    throw new Error(`Answers file not found at ${path}`);
  }
  const content = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) {
    return JSON.parse(content) as WizardAnswers;
  }
  return parseSimpleYaml(content) as unknown as WizardAnswers;
}

function promptQuestion(
  rl: readline.Interface,
  question: string,
  defaultVal?: string,
): Promise<string> {
  const promptText = ui.prompt(question, defaultVal);
  return new Promise((resolve) => {
    rl.question(promptText, (ans) => {
      resolve(ans.trim() || defaultVal || '');
    });
  });
}

export async function runInteractiveWizard(
  answers: WizardAnswers = {},
  defaultsOnly = false,
): Promise<DeploymentSpec> {
  if (defaultsOnly) {
    return buildDeploymentSpec(answers);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(
    '\n' +
      ui.banner('System Design Stack Control (sdctl)', 'Interactive Setup & Deployment Wizard') +
      '\n',
  );

  try {
    // 1. Mode
    console.log(
      ui.sectionHeader(
        '1/6',
        'Deployment Environment Mode',
        'Choose how this instance connects to networks and registries.',
      ),
    );
    console.log(
      ui.menuOption(
        '1',
        'Public Mode',
        'Internet-connected registry, public ACME certificates, public STUN',
        true,
      ),
    );
    console.log(
      ui.menuOption(
        '2',
        'Isolated Mode',
        'Air-gapped / private network, internal registry, no outbound connections',
      ),
    );

    const modeChoice = await promptQuestion(
      rl,
      'Select mode (1 or 2)',
      answers.mode === 'isolated' ? '2' : '1',
    );
    const mode: DeploymentMode =
      modeChoice === '2' || answers.mode === 'isolated' ? 'isolated' : 'public';

    // 2. Topology
    console.log(
      ui.sectionHeader(
        '2/6',
        'Network Topology',
        'Select the network layout between collaborating browser clients.',
      ),
    );
    console.log(
      ui.menuOption(
        '1',
        'LAN (Flat Subnet)',
        'All clients on same subnet (no STUN / TURN required)',
        true,
      ),
    );
    console.log(
      ui.menuOption(
        '2',
        'Routed Subnets',
        'Clients across corporate subnets with direct IP routing',
      ),
    );
    console.log(
      ui.menuOption(
        '3',
        'NAT Routers',
        'Clients behind NAT routers relative to each other (STUN + TURN required)',
      ),
    );
    console.log(
      ui.menuOption(
        '4',
        'Multi-site / VPN',
        'Clients across branches or WAN/VPN connections (TURN required)',
      ),
    );

    const topoChoice = await promptQuestion(rl, 'Select topology (1-4)', '1');
    let topology: Topology = 'lan';
    if (topoChoice === '2') topology = 'routed';
    else if (topoChoice === '3') topology = 'nat';
    else if (topoChoice === '4') topology = 'multisite';

    // 3. TLS Mode
    console.log(
      ui.sectionHeader(
        '3/6',
        'TLS / HTTPS Configuration',
        'Configure HTTPS encryption and certificate management for edge proxy.',
      ),
    );
    let tlsMode: TlsMode = 'none';
    let domain: string | undefined;
    let editorPath: string | undefined;
    let relayPath: string | undefined;
    let dnsProviderName: string | undefined;
    let cloudflareApiToken: string | undefined;
    let cloudflareResolvers: string[] | undefined;
    let proxyImage: string | undefined;

    if (mode === 'public') {
      console.log(
        ui.menuOption(
          '1',
          'Automatic HTTPS with Caddy HTTP-01',
          "Public Let's Encrypt / ZeroSSL ACME",
          true,
        ),
      );
      console.log(
        ui.menuOption(
          '2',
          'Automatic HTTPS via Cloudflare DNS-01',
          'ACME DNS challenge for wildcard domains & private IPs',
        ),
      );
      console.log(
        ui.menuOption(
          '3',
          'Self-Signed Certificate (Auto-generated)',
          'Generates local X.509 cert with hostname as Common Name & SANs',
        ),
      );
      console.log(
        ui.menuOption(
          '4',
          'Operator-supplied Custom Certificates',
          'Existing PEM cert and private key files',
        ),
      );
      console.log(
        ui.menuOption(
          '5',
          'External Reverse Proxy',
          'Operator manages TLS termination (NGINX, Traefik, etc.)',
        ),
      );
      console.log(
        ui.menuOption(
          '6',
          'None (Plain HTTP / WS)',
          'Local evaluation / unencrypted development only',
        ),
      );

      const tlsChoice = await promptQuestion(rl, 'Select TLS mode (1-6)', '1');
      tlsMode = 'acme';
      if (tlsChoice === '2') {
        tlsMode = 'acme-dns';
        dnsProviderName = 'cloudflare';
      } else if (tlsChoice === '3') {
        tlsMode = 'self-signed';
      } else if (tlsChoice === '4') {
        tlsMode = 'provided';
      } else if (tlsChoice === '5') {
        tlsMode = 'external';
      } else if (tlsChoice === '6') {
        tlsMode = 'none';
      }
    } else {
      console.log(
        ui.menuOption(
          '1',
          'Self-Signed Certificate (Auto-generated)',
          'Generates local X.509 cert with hostname as Common Name & SANs',
          true,
        ),
      );
      console.log(
        ui.menuOption(
          '2',
          'Operator-supplied Custom Certificates',
          'Internal CA / existing PEM cert + key files',
        ),
      );
      console.log(
        ui.menuOption(
          '3',
          'External Reverse Proxy',
          'Operator manages TLS termination (NGINX, Traefik, etc.)',
        ),
      );
      console.log(
        ui.menuOption(
          '4',
          'None (Plain HTTP / WS)',
          'Local evaluation / unencrypted development only',
        ),
      );

      const tlsChoice = await promptQuestion(rl, 'Select TLS mode (1-4)', '1');
      tlsMode = 'self-signed';
      if (tlsChoice === '2') tlsMode = 'provided';
      else if (tlsChoice === '3') tlsMode = 'external';
      else if (tlsChoice === '4') tlsMode = 'none';
    }

    // 4. Hostnames
    console.log(
      ui.sectionHeader(
        '4/6',
        'Hostnames & URL Routing',
        'Specify domains, hostnames, and optional subpaths for services.',
      ),
    );
    let editorHost = 'localhost';
    let relayHost = 'localhost';
    if (tlsMode === 'acme-dns') {
      domain = await promptQuestion(
        rl,
        'Primary or Wildcard Domain (e.g. *.home.example.com or editor.home.example.com)',
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
        'Custom Cloudflare DNS Resolvers (optional, comma-separated IPs or NS)',
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
      const defaultHost = tlsMode === 'self-signed' ? 'editor.local' : 'design.example.com';
      editorHost = await promptQuestion(
        rl,
        `Hostname / Domain for Editor (${tlsMode === 'self-signed' ? 'Used as Certificate Common Name' : 'e.g. design.example.com'})`,
        defaultHost,
      );
      const singleHostAns = await promptQuestion(
        rl,
        'Serve Signaling Relay under subpath on same domain (/relay)? (y/n)',
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
    } else if (tlsMode === 'self-signed') {
      certificatePath = './certs/cert.pem';
      privateKeyPath = './certs/key.pem';
      console.log(
        ui.info(
          `Self-signed certificates will be generated automatically at '${certificatePath}' and '${privateKeyPath}'.`,
        ),
      );
    }

    // 5. Access restriction (public mode)
    let allowedCidrs: string[] = [];
    if (mode === 'public') {
      console.log(
        ui.sectionHeader(
          '5/6',
          'Access Restriction',
          'Optionally restrict WebSocket signaling relay access to trusted CIDRs.',
        ),
      );
      console.log(ui.info('Notice: The WebRTC signaling relay is unauthenticated by default.'));
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
    console.log(
      ui.sectionHeader(
        '6/6',
        'NAT Traversal & TURN',
        'Configure media relay for clients behind symmetric NATs or firewalls.',
      ),
    );
    const enableTurn = topology === 'nat' || topology === 'multisite';
    let turnExternalIp: string | undefined;
    if (enableTurn) {
      console.log(ui.warning('Topology requires TURN server for reliable media relay.'));
      turnExternalIp = await promptQuestion(
        rl,
        'Public / reachable IP address for TURN server (optional)',
        '',
      );
    } else {
      console.log(ui.info('Topology does not require dedicated TURN server.'));
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
    console.log('\n' + ui.success('Configuration compiled successfully.') + '\n');
    return spec;
  } finally {
    rl.close();
  }
}
