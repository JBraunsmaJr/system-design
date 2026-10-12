/**
 * CHANGELOG.md drives the version, and releases are cut from it.
 *
 * Developers mark Unreleased items [MAJOR], [MINOR] or [PATCH]; the release
 * workflow bumps by the highest marker, turns the section into the release
 * notes, and opens a new one. These checks cover the rules that decide the
 * version, and keep the real changelog, the package versions and the
 * release workflow in a state the next release can run from.
 */
import {readdirSync, readFileSync} from 'fs';
import {
  bumpVersion,
  cutRelease,
  highestBump,
  latestReleasedVersion,
  openUnreleased,
  setPackageVersion,
  stripMarkers,
  unreleasedBody,
  VERSIONED_FILES,
} from './lib/changelog';

let failures = 0;
function check(condition: boolean, message: string) {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

function throws(fn: () => unknown, pattern: RegExp): boolean {
  try {
    fn();
    return false;
  } catch (error) {
    return pattern.test((error as Error).message);
  }
}

console.log('=== Bumping the version ===');
check(bumpVersion('0.97.3', 'patch') === '0.97.4', 'a patch bump moves only the patch');
check(bumpVersion('0.97.3', 'minor') === '0.98.0', 'a minor bump resets the patch');
check(bumpVersion('0.97.3', 'major') === '1.0.0', 'a major bump resets minor and patch');
check(bumpVersion('1.9.9', 'minor') === '1.10.0', 'parts are numbers, not digits');
check(
    throws(() => bumpVersion('0.97', 'patch'), /not a MAJOR\.MINOR\.PATCH/),
    'a malformed version is refused',
);

console.log('=== Reading the markers ===');
check(
    highestBump(['- [PATCH] a', '- [MINOR] b', '- [PATCH] c']) === 'minor',
    'the highest marker wins',
);
check(highestBump(['- [MINOR] a', '* [MAJOR] b']) === 'major', 'any list bullet carries a marker');
check(highestBump(['- plain item', '- another']) === null, 'items without markers ask for no bump');
check(
    highestBump(['- mentions [MAJOR] mid-line']) === null,
    'a marker counts only at the start of an item',
);
check(highestBump(['- [major] lower case']) === null, 'markers are upper case');
check(
    stripMarkers(['- [MINOR] Sprint markers', '  - [PATCH] nested', '- plain']).join('|') ===
    '- Sprint markers|  - nested|- plain',
    'stripping removes the marker and keeps the bullet and indentation',
);

console.log('=== Markers on subheadings ===');
const grouped = [
  '### [MAJOR]',
  '',
  '- Drop the v1 store API',
  '',
  '### [PATCH] Fixes',
  '',
  '- Fix PDF font fallback',
  '',
  '### Notes',
  '',
  '- Docs tidy-up',
];
check(highestBump(grouped) === 'major', 'a marker on a subheading counts');
check(
    highestBump(['#### [MINOR] Deeper']) === 'minor',
    'any subheading level from ### down counts',
);
check(
    highestBump(['# [MAJOR] Title', '## [MAJOR] x']) === null,
    'top-level and ## headings do not',
);
check(highestBump(['### Breaking [MAJOR]']) === null, 'the marker must start the heading text');
check(
    stripMarkers(grouped).join('|') ===
    '### Major||- Drop the v1 store API||### Fixes||- Fix PDF font fallback||### Notes||- Docs tidy-up',
    'stripping keeps a heading title, and names a heading that was only a marker',
);
const groupedRelease = cutRelease(
    `# Changelog\n\n## [Unreleased]\n\n${grouped.join('\n')}\n\n## [0.97.0] - 2026-10-12\n\n- Baseline.\n`,
    '0.97.0',
    '2026-10-20',
);
check(groupedRelease.version === '1.0.0', 'a release can be driven by a subheading marker alone');
check(
    groupedRelease.changelog.includes('## [1.0.0] - 2026-10-20\n\n### Major\n') &&
    groupedRelease.changelog.includes('### Notes\n\n- Docs tidy-up\n\n## [0.97.0]'),
    'subheadings stay inside the released section',
);

console.log('=== Cutting a release ===');
const sample = `# Changelog

Intro text.

## [Unreleased]

- [PATCH] Fix PDF font fallback
- [MINOR] Timeline supports sprint markers
- Docs tidy-up

## [0.97.0] - 2026-10-12

- Baseline.
`;
const release = cutRelease(sample, '0.97.0', '2026-10-20');
check(
    release.version === '0.98.0' && release.bump === 'minor',
    'the highest marker sets the version',
);
check(
    release.notes === '- Fix PDF font fallback\n- Timeline supports sprint markers\n- Docs tidy-up\n',
    'the notes are the Unreleased items, markers stripped, unmarked items kept',
);
check(!release.changelog.includes('[Unreleased]'), 'the Unreleased section becomes the release');
check(
    release.changelog.includes(
        '## [0.98.0] - 2026-10-20\n\n- Fix PDF font fallback\n- Timeline supports sprint markers\n- Docs tidy-up\n\n## [0.97.0] - 2026-10-12',
    ),
    'the release is headed with its version and date, above the previous one',
);
check(
    release.changelog.startsWith('# Changelog\n\nIntro text.\n\n'),
    'text above the section is untouched',
);
check(
    latestReleasedVersion(release.changelog) === '0.98.0',
    'the new release reads back as the latest',
);

check(
    throws(
        () => cutRelease(sample.replace(/\[(PATCH|MINOR)\] /g, ''), '0.97.0', '2026-10-20'),
        /no line .* is marked/,
    ),
    'a section with items but no marker is refused',
);
check(
    throws(
        () => cutRelease('# Changelog\n\n## [Unreleased]\n\n## [0.97.0] - x\n', '0.97.0', 'd'),
        /no line/,
    ),
    'an empty section is refused',
);
check(
    throws(() => cutRelease('# Changelog\n', '0.97.0', 'd'), /has no/),
    'a missing section is refused',
);
check(
    throws(() => cutRelease(`${sample}\n## [Unreleased]\n`, '0.97.0', 'd'), /expected one/),
    'two Unreleased sections are refused',
);

console.log('=== Opening the next Unreleased section ===');
const reopened = openUnreleased(release.changelog);
check(
    reopened.includes('Intro text.\n\n## [Unreleased]\n\n## [0.98.0] - 2026-10-20'),
    'a new, empty section goes above the latest release',
);
check(openUnreleased(reopened) === reopened, 'opening it again changes nothing');
check(unreleasedBody(reopened).length === 0, 'the new section is empty');

console.log('=== Setting package versions ===');
const pkg =
    '{\n  "name": "x",\n  "version": "0.97.0",\n  "dependencies": {\n    "y": "^1.0.0"\n  }\n}\n';
check(
    setPackageVersion(pkg, '0.98.0') === pkg.replace('0.97.0', '0.98.0'),
    'package.json changes only on its version line',
);
const lock =
    '{\n  "name": "x",\n  "version": "0.97.0",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n' +
    '      "name": "x",\n      "version": "0.97.0",\n      "dependencies": {\n        "y": "^1.0.0"\n      }\n' +
    '    },\n    "node_modules/y": {\n      "version": "1.2.3"\n    }\n  }\n}\n';
const lockNext = setPackageVersion(lock, '0.98.0');
check(
    lockNext === lock.replace(/0\.97\.0/g, '0.98.0'),
    'a lockfile changes at the top and under packages[""], not its dependencies',
);

console.log('=== The repository as it stands ===');
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const rootVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string })
    .version;
let body: string[] = [];
check(
    !throws(() => (body = unreleasedBody(changelog)), /./),
    'CHANGELOG.md has exactly one [Unreleased] section',
);
check(
    changelog.split('\n').find((line) => line.startsWith('## ')) === '## [Unreleased]',
    '[Unreleased] is the first section',
);
check(
    latestReleasedVersion(changelog) === rootVersion,
    `the latest release in CHANGELOG.md matches package.json (${latestReleasedVersion(changelog)} vs ${rootVersion})`,
);
const unmarked =
    body.filter((line) => /^\s*[-*+]\s/.test(line)).length > 0 && highestBump(body) === null;
if (unmarked)
  console.log('  note: [Unreleased] has items but no marker yet; a release would be refused');
for (const file of VERSIONED_FILES) {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
  };
  const versions = [parsed.version, ...(parsed.packages ? [parsed.packages['']?.version] : [])];
  check(
      versions.every((v) => v === rootVersion),
      `${file} is at ${rootVersion}`,
  );
}

console.log('=== The release workflow reaches every release-triggered workflow ===');
// A release published by the workflow's own token does not fire `release`
// events, so release.yml dispatches each of these itself. A new workflow
// that listens for releases has to be added to its list, or it never runs.
const workflowDir = '.github/workflows';
const releaseWorkflow = readFileSync(`${workflowDir}/release.yml`, 'utf8');
const dispatched = (/^\s*DOWNSTREAM_WORKFLOWS:\s*(.+)$/m.exec(releaseWorkflow)?.[1] ?? '')
    .trim()
    .split(/\s+/);
for (const name of readdirSync(workflowDir).filter((n) => /\.ya?ml$/.test(n))) {
  if (name === 'release.yml') continue;
  const text = readFileSync(`${workflowDir}/${name}`, 'utf8');
  const triggers = /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(text)?.[1] ?? '';
  if (!/^ {2}release:/m.test(triggers)) continue;
  check(dispatched.includes(name), `release.yml dispatches ${name}`);
  check(/^ {2}workflow_dispatch:/m.test(triggers), `${name} can be dispatched`);
}
for (const file of ['CHANGELOG.md', ...VERSIONED_FILES]) {
  check(releaseWorkflow.includes(` ${file}`), `release.yml commits ${file}`);
}
for (const name of dispatched) {
  check(readdirSync(workflowDir).includes(name), `${name}, dispatched by release.yml, exists`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll changelog checks passed.');
