/**
 * The file changes behind .github/workflows/release.yml.
 *
 *   npx tsx scripts/release.ts prepare --notes-file <path> [--dry-run]
 *     Reads the [Unreleased] section of CHANGELOG.md, works out the next
 *     version from its highest [MAJOR]/[MINOR]/[PATCH] marker, writes the
 *     release notes (markers stripped) to <path>, and - unless --dry-run -
 *     renames the section to the version and today's date and sets that
 *     version in every package.json and lockfile. Fails if no line in the
 *     section carries a marker.
 *
 *   npx tsx scripts/release.ts open-unreleased
 *     Adds an empty [Unreleased] section back to CHANGELOG.md, for after
 *     the GitHub release is published.
 *
 * When run inside GitHub Actions, `prepare` also writes `version`, `tag`
 * and `bump` to $GITHUB_OUTPUT.
 */
import {appendFileSync, readFileSync, writeFileSync} from 'fs';
import {cutRelease, openUnreleased, type Release, setPackageVersion, VERSIONED_FILES,} from './lib/changelog';

const CHANGELOG = 'CHANGELOG.md';

function fail(message: string): never {
    console.error(`release: ${message}`);
    process.exit(1);
}

function option(args: string[], name: string): string | undefined {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
}

function prepare(args: string[]) {
    const notesFile = option(args, '--notes-file');
    if (!notesFile) fail('prepare needs --notes-file <path>.');
    const dryRun = args.includes('--dry-run');

    const current = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
    // Dates are UTC, the same clock the runner and GitHub's release page use.
    const date = process.env.RELEASE_DATE ?? new Date().toISOString().slice(0, 10);

    let release: Release;
    try {
        release = cutRelease(readFileSync(CHANGELOG, 'utf8'), current, date);
    } catch (error) {
        fail((error as Error).message);
    }

    writeFileSync(notesFile, release.notes);
    console.log(`${current} -> ${release.version} (${release.bump})\n`);
    console.log(release.notes);

    if (!dryRun) {
        writeFileSync(CHANGELOG, release.changelog);
        for (const file of VERSIONED_FILES) {
            try {
                writeFileSync(file, setPackageVersion(readFileSync(file, 'utf8'), release.version));
            } catch (error) {
                fail(`${file}: ${(error as Error).message}`);
            }
        }
        console.log(`Updated ${CHANGELOG} and ${VERSIONED_FILES.join(', ')}.`);
    }

    if (process.env.GITHUB_OUTPUT) {
        appendFileSync(
            process.env.GITHUB_OUTPUT,
            `version=${release.version}\ntag=v${release.version}\nbump=${release.bump}\n`,
        );
    }
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'prepare') prepare(rest);
else if (command === 'open-unreleased') {
    writeFileSync(CHANGELOG, openUnreleased(readFileSync(CHANGELOG, 'utf8')));
    console.log(`Opened a new [Unreleased] section in ${CHANGELOG}.`);
} else {
    fail('usage: release.ts prepare --notes-file <path> [--dry-run] | open-unreleased');
}
