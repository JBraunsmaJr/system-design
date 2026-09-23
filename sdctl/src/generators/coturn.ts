import type { DeploymentSpec } from '../types.js';
import { generateHeader } from './header.js';

export function generateCoturnConfig(spec: DeploymentSpec): string {
  const header = generateHeader('#');
  const lines: string[] = [header];

  const realm = spec.turn?.realm || spec.tls.domain || spec.tls.editorHost || 'turn.system-design.local';
  const listeningPort = spec.turn?.listeningPort || 3478;
  const tlsListeningPort = spec.turn?.tlsListeningPort || 5349;

  lines.push(`listening-port=${listeningPort}`);
  lines.push(`tls-listening-port=${tlsListeningPort}`);
  lines.push(`realm=${realm}`);
  lines.push('fingerprint');
  lines.push('lt-cred-mech');
  lines.push('use-auth-secret');
  lines.push('static-auth-secret=${TURN_SECRET}');
  lines.push('user=${TURN_USERNAME}:${TURN_PASSWORD}');
  lines.push('no-cli');
  lines.push('no-multicast-peers');
  lines.push('no-loopback-peers');
  lines.push('min-port=49152');
  lines.push('max-port=65535');

  if (spec.turn?.externalIp) {
    lines.push(`external-ip=${spec.turn.externalIp}`);
  }

  return lines.join('\n') + '\n';
}
