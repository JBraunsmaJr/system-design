import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_MANIFEST } from './manifest.js';
import { validateDeploymentSpec } from './schema.js';
import { dumpDeploymentSpecYaml, parseSimpleYaml } from './yaml.js';
import { generateComposeYaml } from './generators/compose.js';
import { generateCaddyfile } from './generators/caddy.js';
import { generateCoturnConfig } from './generators/coturn.js';
import { loadOrCreateSecrets } from './generators/secrets.js';
import { isManuallyModified } from './generators/header.js';
import { runInteractiveWizard, loadAnswersFile, buildDeploymentSpec } from './wizard.js';
import type { DeploymentSpec } from './types.js';

export interface CliOptions {
  command: string;
  args: string[];
  flags: {
    version?: boolean;
    help?: boolean;
    registry?: string;
    answers?: string;
    yes?: boolean;
    output?: 'json' | 'text';
    force?: boolean;
    spec?: string;
  };
}

export function parseArgs(argv: string[]): CliOptions {
  const flags: CliOptions['flags'] = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--version' || arg === '-v') {
      flags.version = true;
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg === '--yes' || arg === '-y') {
      flags.yes = true;
    } else if (arg === '--force') {
      flags.force = true;
    } else if (arg === '--registry' && i + 1 < argv.length) {
      flags.registry = argv[++i];
    } else if (arg.startsWith('--registry=')) {
      flags.registry = arg.slice('--registry='.length);
    } else if (arg === '--answers' && i + 1 < argv.length) {
      flags.answers = argv[++i];
    } else if (arg.startsWith('--answers=')) {
      flags.answers = arg.slice('--answers='.length);
    } else if (arg === '--output' && i + 1 < argv.length) {
      flags.output = argv[++i] as 'json' | 'text';
    } else if (arg.startsWith('--output=')) {
      flags.output = arg.slice('--output='.length) as 'json' | 'text';
    } else if (arg === '--spec' && i + 1 < argv.length) {
      flags.spec = argv[++i];
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  const command = positional[0] || '';
  const args = positional.slice(1);

  return { command, args, flags };
}

export async function runCli(argv: string[], workingDir: string = process.cwd()): Promise<number> {
  const { command, flags } = parseArgs(argv);

  if (flags.version) {
    if (flags.output === 'json') {
      console.log(JSON.stringify(DEFAULT_MANIFEST, null, 2));
    } else {
      console.log(`sdctl version ${DEFAULT_MANIFEST.version} (released ${DEFAULT_MANIFEST.releaseDate})`);
      console.log('\nRelease Manifest:');
      for (const [comp, img] of Object.entries(DEFAULT_MANIFEST.images)) {
        console.log(`  - ${comp}: ${img.image}@${img.digest}`);
      }
    }
    return 0;
  }

  if (flags.help || (!command && !flags.version)) {
    console.log(`
sdctl - System Design Editor Installer & Operations Tool

Usage:
  sdctl <command> [flags]

Commands:
  init       Initialize a new deployment interactively or from an answers file
  validate   Validate deployment.yaml against specification schema
  generate   Generate all derived configuration files (compose.yaml, Caddyfile, turnserver.conf)
  plan       Preview configuration and container diff before apply
  version    Show version and carried release manifest

Flags:
  --version, -v        Print version information and release manifest
  --help, -h           Print this help message
  --registry <prefix>  Override container registry prefix across all components
  --answers <file>     Provide answers file for non-interactive initialization
  --yes, -y            Non-interactive mode; accept defaults without prompting
  --output json|text   Output format (default: text)
  --spec <file>        Path to deployment spec (default: ./deployment.yaml)
`);
    return 0;
  }

  const specPath = flags.spec || join(workingDir, 'deployment.yaml');

  if (command === 'init') {
    let spec: DeploymentSpec;

    if (flags.answers) {
      const answers = loadAnswersFile(flags.answers);
      spec = buildDeploymentSpec(answers);
    } else if (flags.yes) {
      spec = buildDeploymentSpec({ mode: 'public', topology: 'lan', tlsMode: 'none' });
    } else {
      spec = await runInteractiveWizard();
    }

    if (flags.registry) {
      spec.registry = { prefix: flags.registry };
    }

    const validation = validateDeploymentSpec(spec);
    if (!validation.valid) {
      if (flags.output === 'json') {
        console.error(JSON.stringify(validation, null, 2));
      } else {
        console.error('Configuration validation failed during init:');
        for (const err of validation.errors) {
          console.error(`  - [${err.path}] ${err.message}`);
          console.error(`    Suggested fix: ${err.suggestedFix}`);
        }
      }
      return 1;
    }

    const yamlStr = dumpDeploymentSpecYaml(spec);
    writeFileSync(specPath, yamlStr, 'utf8');

    if (flags.output === 'json') {
      console.log(JSON.stringify({ status: 'success', path: specPath, spec }, null, 2));
    } else {
      console.log(`\n✓ Written deployment specification to ${specPath}`);
      console.log('Run `sdctl generate` or `sdctl apply` to create configuration and start services.');
    }
    return 0;
  }

  if (command === 'validate') {
    if (!existsSync(specPath)) {
      console.error(`Error: Deployment spec not found at ${specPath}`);
      return 1;
    }
    const rawYaml = readFileSync(specPath, 'utf8');
    const parsed = parseSimpleYaml(rawYaml);
    const validation = validateDeploymentSpec(parsed);

    if (flags.output === 'json') {
      console.log(JSON.stringify(validation, null, 2));
      return validation.valid ? 0 : 1;
    }

    if (!validation.valid) {
      console.error(`\nValidation failed for ${specPath}:`);
      for (const err of validation.errors) {
        console.error(`  - Path: "${err.path}"`);
        console.error(`    Error: ${err.message}`);
        console.error(`    Suggested fix: ${err.suggestedFix}\n`);
      }
      return 1;
    }

    console.log(`\n✓ Deployment specification ${specPath} is valid.`);
    return 0;
  }

  if (command === 'generate') {
    if (!existsSync(specPath)) {
      console.error(`Error: Deployment spec not found at ${specPath}`);
      return 1;
    }
    const rawYaml = readFileSync(specPath, 'utf8');
    const spec = parseSimpleYaml(rawYaml) as unknown as DeploymentSpec;
    const validation = validateDeploymentSpec(spec);
    if (!validation.valid) {
      console.error('Cannot generate artifacts from invalid deployment.yaml');
      return 1;
    }

    // Check secrets
    const secretsPath = join(workingDir, 'secrets.env');
    loadOrCreateSecrets(secretsPath, Boolean(spec.turn?.enabled));

    // Compose yaml
    const composeContent = generateComposeYaml(spec, DEFAULT_MANIFEST);
    const composePath = join(workingDir, 'compose.yaml');
    if (existsSync(composePath)) {
      const existing = readFileSync(composePath, 'utf8');
      if (isManuallyModified(existing, composeContent)) {
        console.warn('Warning: compose.yaml had manual edits which will be overwritten.');
      }
    }
    writeFileSync(composePath, composeContent, 'utf8');

    // Caddyfile if proxy needed
    if (spec.tls.mode === 'acme' || spec.tls.mode === 'provided') {
      const caddyContent = generateCaddyfile(spec);
      const caddyPath = join(workingDir, 'Caddyfile');
      if (existsSync(caddyPath)) {
        const existing = readFileSync(caddyPath, 'utf8');
        if (isManuallyModified(existing, caddyContent)) {
          console.warn('Warning: Caddyfile had manual edits which will be overwritten.');
        }
      }
      writeFileSync(caddyPath, caddyContent, 'utf8');
    }

    // Coturn config if turn enabled
    if (spec.turn?.enabled) {
      const coturnContent = generateCoturnConfig(spec);
      const coturnPath = join(workingDir, 'turnserver.conf');
      if (existsSync(coturnPath)) {
        const existing = readFileSync(coturnPath, 'utf8');
        if (isManuallyModified(existing, coturnContent)) {
          console.warn('Warning: turnserver.conf had manual edits which will be overwritten.');
        }
      }
      writeFileSync(coturnPath, coturnContent, 'utf8');
    }

    if (flags.output === 'json') {
      console.log(JSON.stringify({ status: 'generated', artifacts: ['compose.yaml', 'secrets.env'] }, null, 2));
    } else {
      console.log('✓ Successfully generated deployment artifacts.');
    }
    return 0;
  }

  console.error(`Unknown command: "${command}". Run \`sdctl --help\` for usage.`);
  return 1;
}
