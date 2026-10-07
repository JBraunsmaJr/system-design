#!/usr/bin/env node
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {
    backup,
    doctor,
    install,
    promoteAdmin,
    proxyReload,
    reconfigure,
    render,
    restore,
    rollback,
    status,
    upgrade,
} from './commands.ts';
import {type Ctx, INSTALLER_VERSION} from './deploy.ts';
import {InstallerError} from './lib/util.ts';
import {pc, ui} from './lib/ui.ts';

const HELP = `
${pc.bold(pc.cyan('System Design installer'))} ${pc.dim(INSTALLER_VERSION)}

${pc.bold('Usage')}
  docker run --rm -it \\
    -v /var/run/docker.sock:/var/run/docker.sock \\
    -v /opt/system-design:/opt/system-design -w /opt/system-design \\
    ghcr.io/jbraunsmajr/system-design-installer ${pc.cyan('<command>')} [options]

  The install directory must be mounted at the same path inside and out.

${pc.bold('Commands')}
  ${pc.cyan('install')}          First-time setup: asks what it needs, then deploys
  ${pc.cyan('upgrade')}          Back up, move to newer images, verify health, roll back on failure
  ${pc.cyan('reconfigure')}      Change earlier answers and redeploy
  ${pc.cyan('status')}           Versions, container health, available updates
  ${pc.cyan('backup')}           Dump databases and configuration   (--list to show them)
  ${pc.cyan('restore')} <id>     Put a backup's configuration back  (--with-data for databases too)
  ${pc.cyan('rollback')}         Undo the last install/upgrade/reconfigure
  ${pc.cyan('promote-admin')}    Add a store administrator (--username, or --subject issuer#sub)
  ${pc.cyan('proxy-reload')}     Validate and apply proxy config (after editing a shared Caddyfile)
  ${pc.cyan('render')}           Write configuration files only; start nothing
  ${pc.cyan('doctor')}           Check the environment without changing anything

${pc.bold('Options')}
  -m, --manifest <file>   Answers to use instead of asking (YAML)
      --non-interactive   Never prompt; fail on anything the manifest leaves open
  -y, --yes               Approve confirmations (non-interactive runs need this to apply)
      --dry-run           Show the plan and diffs; change nothing
      --to <version>      Image version for all three images: latest, 2026-10-03, sha256:…
      --editor/--relay/--store <version>   Per-image version
      --force             Replace hand-edited files (copies kept); allow DB password changes
      --with-data         restore/rollback: also restore the databases
      --no-diff           Don't print file diffs
      --dir <path>        Install directory (default: current directory)
      --skip-mount-check  Don't verify the same-path mount (Docker Desktop, rootless setups)
      --no-updates        status: don't check the registry
  -h, --help              This help
`;

async function main(): Promise<number> {
    const {values, positionals} = parseArgs({
        allowPositionals: true,
        options: {
            manifest: {type: 'string', short: 'm'},
            'non-interactive': {type: 'boolean'},
            yes: {type: 'boolean', short: 'y'},
            'dry-run': {type: 'boolean'},
            to: {type: 'string'},
            editor: {type: 'string'},
            relay: {type: 'string'},
            store: {type: 'string'},
            force: {type: 'boolean'},
            'with-data': {type: 'boolean'},
            'no-diff': {type: 'boolean'},
            dir: {type: 'string'},
            'skip-mount-check': {type: 'boolean'},
            'no-updates': {type: 'boolean'},
            list: {type: 'boolean'},
            username: {type: 'string'},
            subject: {type: 'string'},
            help: {type: 'boolean', short: 'h'},
            version: {type: 'boolean'},
        },
    });

    if (values.version) {
        console.log(INSTALLER_VERSION);
        return 0;
    }
    const [command, ...rest] = positionals;
    if (values.help || !command || command === 'help') {
        console.log(HELP);
        return command || values.help ? 0 : 1;
    }

    ui.interactive =
        !values['non-interactive'] && Boolean(process.stdin.isTTY && process.stdout.isTTY);
    ui.assumeYes = Boolean(values.yes);

    const ctx: Ctx = {
        dir: resolve(values.dir ?? process.env.SD_INSTALL_DIR ?? process.cwd()),
        yes: Boolean(values.yes),
        force: Boolean(values.force),
        dryRun: Boolean(values['dry-run']),
        diffs: !values['no-diff'],
        manifest: values.manifest ? resolve(values.manifest) : undefined,
    };
    const versions = {
        to: values.to,
        editor: values.editor,
        relay: values.relay,
        store: values.store,
    };
    const skipMount = Boolean(values['skip-mount-check']);

    switch (command) {
        case 'install':
            await install(ctx, versions, skipMount);
            break;
        case 'upgrade':
            await upgrade(ctx, versions, skipMount);
            break;
        case 'reconfigure':
            await reconfigure(ctx, versions, skipMount);
            break;
        case 'render':
            await render(ctx);
            break;
        case 'status':
            await status(ctx, !values['no-updates']);
            break;
        case 'backup':
            await backup(ctx, Boolean(values.list));
            break;
        case 'restore':
            await restore(ctx, rest[0], Boolean(values['with-data']));
            break;
        case 'rollback':
            await rollback(ctx, Boolean(values['with-data']));
            break;
        case 'doctor':
            return (await doctor(ctx, skipMount)) ? 0 : 1;
        case 'proxy-reload':
            await proxyReload(ctx);
            break;
        case 'promote-admin':
            await promoteAdmin(ctx, values.username, values.subject);
            break;
        default:
            console.error(`Unknown command "${command}".\n${HELP}`);
            return 1;
    }
    return 0;
}

main().then(
    (code) => process.exit(code),
    (error: unknown) => {
        if (error instanceof InstallerError) {
            ui.error(error.message);
            if (error.hint)
                console.error(
                    pc.dim(
                        error.hint
                            .split('\n')
                            .map((l) => `  ${l}`)
                            .join('\n'),
                    ),
                );
        } else if (error instanceof Error && error.name !== 'ExitPromptError') {
            ui.error(error.message);
            if (process.env.SD_DEBUG) console.error(error.stack);
        }
        process.exit(1);
    },
);
