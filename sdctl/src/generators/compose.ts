import { createHash } from 'crypto';
import type { DeploymentSpec, ReleaseManifest } from '../types.js';
import { getResolvedImages, DEFAULT_MANIFEST } from '../manifest.js';
import { generateHeader } from './header.js';

export function deriveEndpoints(spec: DeploymentSpec): { appUrl: string; relayUrl: string; iceServers: string } {
  const isTls = spec.tls.mode === 'acme' || spec.tls.mode === 'provided';
  const httpScheme = isTls ? 'https' : 'http';
  const wsScheme = isTls ? 'wss' : 'ws';

  const editorHost = spec.tls.editorHost || spec.tls.domain || 'localhost';
  const relayHost = spec.tls.relayHost || editorHost;
  const isSingleHost = editorHost === relayHost;

  let appUrl: string;
  let relayUrl: string;

  if (spec.tls.mode === 'none') {
    appUrl = `http://${editorHost === 'localhost' ? 'localhost:8080' : editorHost}`;
    relayUrl = `ws://${relayHost === 'localhost' ? 'localhost:4444' : `${relayHost}:4444`}`;
  } else if (isSingleHost) {
    appUrl = `${httpScheme}://${editorHost}`;
    relayUrl = `${wsScheme}://${editorHost}/relay`;
  } else {
    appUrl = `${httpScheme}://${editorHost}`;
    relayUrl = `${wsScheme}://${relayHost}`;
  }

  // Derived ICE servers
  let iceServers = spec.iceServers;
  if (!iceServers) {
    if (spec.topology === 'lan') {
      iceServers = 'none';
    } else if (spec.turn?.enabled) {
      const turnHost = spec.turn?.externalIp || spec.tls.domain || editorHost;
      iceServers = `stun:${turnHost}:3478,turn:${turnHost}:3478|$${'{TURN_USERNAME}'}|$${'{TURN_PASSWORD}'}`;
    } else if (spec.mode === 'public') {
      iceServers = 'stun:stun.l.google.com:19302,stun:global.stun.twilio.com:3478';
    } else {
      iceServers = 'none';
    }
  }

  return { appUrl, relayUrl, iceServers };
}

export function generateComposeYaml(
  spec: DeploymentSpec,
  manifest: ReleaseManifest = DEFAULT_MANIFEST,
  specHash?: string,
): string {
  const hash = specHash || createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 16);
  const images = getResolvedImages(manifest, spec.registry?.prefix);
  const { appUrl, relayUrl, iceServers } = deriveEndpoints(spec);
  const hasProxy = spec.tls.mode === 'acme' || spec.tls.mode === 'provided';

  const header = generateHeader('#');
  const lines: string[] = [header];

  lines.push('services:');

  // Editor service
  lines.push('  editor:');
  lines.push(`    image: ${images.editor}`);
  lines.push('    container_name: sdctl-editor');
  lines.push('    restart: unless-stopped');
  lines.push('    environment:');
  lines.push(`      - RELAY=${relayUrl}`);
  lines.push(`      - APP_URL=${appUrl}`);
  lines.push(`      - ICE_SERVERS=${iceServers}`);
  if (spec.turn?.enabled) {
    lines.push('    env_file:');
    lines.push('      - secrets.env');
  }
  if (!hasProxy) {
    lines.push('    ports:');
    lines.push(spec.tls.mode === 'none' ? '      - "8080:80"' : '      - "80:80"');
  }
  lines.push('    labels:');
  lines.push('      sdctl.managed: "true"');
  lines.push('      sdctl.component: "editor"');
  lines.push(`      sdctl.release: "${manifest.version}"`);
  lines.push(`      sdctl.spec_hash: "${hash}"`);
  lines.push('    depends_on:');
  lines.push('      - relay');
  lines.push('');

  // Relay service
  lines.push('  relay:');
  lines.push(`    image: ${images.relay}`);
  lines.push('    container_name: sdctl-relay');
  lines.push('    restart: unless-stopped');
  lines.push('    environment:');
  lines.push('      - PORT=4444');
  if (!hasProxy) {
    lines.push('    ports:');
    lines.push('      - "4444:4444"');
  }
  lines.push('    labels:');
  lines.push('      sdctl.managed: "true"');
  lines.push('      sdctl.component: "relay"');
  lines.push(`      sdctl.release: "${manifest.version}"`);
  lines.push(`      sdctl.spec_hash: "${hash}"`);
  lines.push('');

  // Proxy service (Caddy)
  if (hasProxy) {
    lines.push('  proxy:');
    lines.push(`    image: ${images.proxy}`);
    lines.push('    container_name: sdctl-proxy');
    lines.push('    restart: unless-stopped');
    lines.push('    ports:');
    lines.push('      - "80:80"');
    lines.push('      - "443:443"');
    lines.push('      - "443:443/udp"');
    lines.push('    volumes:');
    lines.push('      - ./Caddyfile:/etc/caddy/Caddyfile:ro');
    lines.push('      - caddy_data:/data');
    lines.push('      - caddy_config:/config');
    if (spec.tls.mode === 'provided') {
      const certDir = spec.tls.certificatePath ? './certs' : './certs';
      lines.push(`      - ${certDir}:/etc/caddy/certs:ro`);
    }
    lines.push('    labels:');
    lines.push('      sdctl.managed: "true"');
    lines.push('      sdctl.component: "proxy"');
    lines.push(`      sdctl.release: "${manifest.version}"`);
    lines.push(`      sdctl.spec_hash: "${hash}"`);
    lines.push('    depends_on:');
    lines.push('      - editor');
    lines.push('      - relay');
    lines.push('');
  }

  // Turn service (Coturn)
  if (spec.turn?.enabled) {
    lines.push('  turn:');
    lines.push(`    image: ${images.turn}`);
    lines.push('    container_name: sdctl-turn');
    lines.push('    restart: unless-stopped');
    lines.push('    network_mode: host');
    lines.push('    volumes:');
    lines.push('      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro');
    lines.push('    env_file:');
    lines.push('      - secrets.env');
    lines.push('    labels:');
    lines.push('      sdctl.managed: "true"');
    lines.push('      sdctl.component: "turn"');
    lines.push(`      sdctl.release: "${manifest.version}"`);
    lines.push(`      sdctl.spec_hash: "${hash}"`);
    lines.push('');
  }

  // Volumes block if proxy is used
  if (hasProxy) {
    lines.push('volumes:');
    lines.push('  caddy_data:');
    lines.push('  caddy_config:');
    lines.push('');
  }

  return lines.join('\n');
}
