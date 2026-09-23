import { createHash } from 'crypto';
import type { DeploymentSpec, ReleaseManifest } from '../types.js';
import { getResolvedImages, DEFAULT_MANIFEST } from '../manifest.js';
import { generateHeader } from './header.js';

export function deriveEndpoints(spec: DeploymentSpec): {
  appUrl: string;
  relayUrl: string;
  iceServers: string;
} {
  const isTls =
    spec.tls.mode === 'acme' || spec.tls.mode === 'acme-dns' || spec.tls.mode === 'provided';
  const httpScheme = isTls ? 'https' : 'http';
  const wsScheme = isTls ? 'wss' : 'ws';

  const editorHost = spec.tls.editorHost || spec.tls.domain || 'localhost';
  const relayHost = spec.tls.relayHost || editorHost;
  const isSingleHost = editorHost === relayHost;

  const rawEditorPath = spec.paths?.editor?.trim();
  const rawRelayPath = spec.paths?.relay?.trim();

  let editorPath = '';
  if (rawEditorPath && rawEditorPath !== '/') {
    editorPath = rawEditorPath.startsWith('/') ? rawEditorPath : `/${rawEditorPath}`;
    if (editorPath.endsWith('/')) editorPath = editorPath.slice(0, -1);
  }

  let relayPath = '';
  if (rawRelayPath && rawRelayPath !== '/') {
    relayPath = rawRelayPath.startsWith('/') ? rawRelayPath : `/${rawRelayPath}`;
    if (relayPath.endsWith('/')) relayPath = relayPath.slice(0, -1);
  } else if (isSingleHost && !rawRelayPath) {
    relayPath = '/relay';
  }

  let appUrl: string;
  let relayUrl: string;

  if (spec.tls.mode === 'none') {
    appUrl = `http://${editorHost === 'localhost' ? 'localhost:8080' : editorHost}${editorPath}`;
    relayUrl = `ws://${relayHost === 'localhost' ? 'localhost:4444' : `${relayHost}:4444`}${relayPath}`;
  } else if (isSingleHost) {
    appUrl = `${httpScheme}://${editorHost}${editorPath}`;
    relayUrl = `${wsScheme}://${editorHost}${relayPath}`;
  } else {
    appUrl = `${httpScheme}://${editorHost}${editorPath}`;
    relayUrl = `${wsScheme}://${relayHost}${relayPath}`;
  }

  // Derived ICE servers
  let iceServers = spec.iceServers;
  if (!iceServers) {
    if (spec.topology === 'lan') {
      iceServers = 'none';
    } else if (spec.turn?.enabled) {
      const turnHost = spec.turn?.externalIp || spec.tls.domain || editorHost;
      iceServers = `stun:${turnHost}:3478,turn:${turnHost}:3478|$$TURN_USERNAME|$$TURN_PASSWORD`;
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
  const hash =
    specHash || createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 16);
  const images = getResolvedImages(manifest, spec.registry?.prefix);
  const { appUrl, relayUrl, iceServers } = deriveEndpoints(spec);
  const hasProxy =
    spec.tls.mode === 'acme' || spec.tls.mode === 'acme-dns' || spec.tls.mode === 'provided';
  const proxyImage = spec.proxy?.image || images.proxy;

  const header = generateHeader('#');
  const lines: string[] = [header];

  lines.push('services:');

  // Editor service
  lines.push('  editor:');
  lines.push(`    image: ${images.editor}`);
  lines.push('    container_name: sdctl-editor');
  lines.push('    restart: unless-stopped');
  lines.push('    networks:');
  lines.push('      - sdctl-net');
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
  lines.push('    networks:');
  lines.push('      - sdctl-net');
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
    lines.push(`    image: ${proxyImage}`);
    lines.push('    container_name: sdctl-proxy');
    lines.push('    restart: unless-stopped');
    lines.push('    networks:');
    lines.push('      - sdctl-net');
    lines.push('    ports:');
    lines.push('      - "80:80"');
    lines.push('      - "443:443"');
    lines.push('      - "443:443/udp"');
    if (spec.tls.mode === 'acme-dns' || spec.tls.dnsProvider) {
      lines.push('    environment:');
      lines.push('      - ACME_AGREE=true');
      lines.push('    env_file:');
      lines.push('      - secrets.env');
    }
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
    lines.push('    command:');
    lines.push('      - -c');
    lines.push('      - /etc/coturn/turnserver.conf');
    lines.push('      - --user=$$TURN_USERNAME:$$TURN_PASSWORD');
    lines.push('      - --static-auth-secret=$$TURN_SECRET');
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

  // Networks definition
  lines.push('networks:');
  lines.push('  sdctl-net:');
  lines.push('    name: sdctl-net');
  lines.push('');

  return lines.join('\n');
}
