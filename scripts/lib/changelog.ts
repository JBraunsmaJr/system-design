/**
 * CHANGELOG.md and version handling for the release workflow.
 *
 * Developers add line items under `## [Unreleased]`, each one that should
 * move the version prefixed with [MAJOR], [MINOR] or [PATCH]. Releasing
 * takes the highest marker present, bumps the version accordingly (lower
 * parts reset to zero, as semver expects), renames the section to the new
 * version and date, and strips the markers from it - they say how big a
 * change is to the person cutting the release, not to the person reading
 * the notes.
 *
 * Everything here is pure: text in, text out. scripts/release.ts does the
 * reading and writing, and scripts/verify-changelog.ts tests these directly.
 */

export type Bump = 'major' | 'minor' | 'patch';

export const UNRELEASED_HEADING = '## [Unreleased]';

/** A list item that starts with a marker: `- [MINOR] Something`. */
const MARKER_PATTERN = /^(\s*[-*+]\s+)\[(MAJOR|MINOR|PATCH)\]\s*/;
/** Any second-level heading begins a new section. */
const SECTION_PATTERN = /^## /;
const VERSION_HEADING_PATTERN = /^## \[(\d+\.\d+\.\d+)\]/;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

const RANK: Record<Bump, number> = {patch: 1, minor: 2, major: 3};

interface UnreleasedSection {
    /** Line index of the `## [Unreleased]` heading. */
    start: number;
    /** Line index just past the section (the next `## ` heading, or the end). */
    end: number;
    /** The section's lines between the heading and `end`, blank edges trimmed. */
    body: string[];
}

function lines(text: string): string[] {
    return text.replace(/\r\n/g, '\n').split('\n');
}

function trimBlankEdges(body: string[]): string[] {
    let first = 0;
    let last = body.length;
    while (first < last && body[first].trim() === '') first++;
    while (last > first && body[last - 1].trim() === '') last--;
    return body.slice(first, last);
}

function findUnreleased(all: string[]): UnreleasedSection {
    const starts = all.flatMap((line, i) => (line.trim() === UNRELEASED_HEADING ? [i] : []));
    if (starts.length === 0) throw new Error(`CHANGELOG.md has no "${UNRELEASED_HEADING}" section.`);
    if (starts.length > 1) {
        throw new Error(
            `CHANGELOG.md has ${starts.length} "${UNRELEASED_HEADING}" sections; expected one.`,
        );
    }
    const start = starts[0];
    let end = start + 1;
    while (end < all.length && !SECTION_PATTERN.test(all[end])) end++;
    return {start, end, body: trimBlankEdges(all.slice(start + 1, end))};
}

/** The line items currently under `## [Unreleased]`, blank edges trimmed. */
export function unreleasedBody(text: string): string[] {
    return findUnreleased(lines(text)).body;
}

/** The largest bump any marker in these lines asks for, or null if none do. */
export function highestBump(body: string[]): Bump | null {
    let highest: Bump | null = null;
    for (const line of body) {
        const match = MARKER_PATTERN.exec(line);
        if (!match) continue;
        const bump = match[2].toLowerCase() as Bump;
        if (!highest || RANK[bump] > RANK[highest]) highest = bump;
    }
    return highest;
}

/** The same lines with the [MAJOR]/[MINOR]/[PATCH] markers removed. */
export function stripMarkers(body: string[]): string[] {
    return body.map((line) => line.replace(MARKER_PATTERN, '$1'));
}

export function bumpVersion(version: string, bump: Bump): string {
    const match = SEMVER_PATTERN.exec(version);
    if (!match) throw new Error(`"${version}" is not a MAJOR.MINOR.PATCH version.`);
    const [major, minor, patch] = match.slice(1).map(Number);
    if (bump === 'major') return `${major + 1}.0.0`;
    if (bump === 'minor') return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
}

/** The newest released version in the changelog: the first `## [x.y.z]` heading. */
export function latestReleasedVersion(text: string): string | null {
    for (const line of lines(text)) {
        const match = VERSION_HEADING_PATTERN.exec(line);
        if (match) return match[1];
    }
    return null;
}

export interface Release {
    version: string;
    bump: Bump;
    /** The release notes: the Unreleased items, markers stripped. */
    notes: string;
    /** The changelog with `[Unreleased]` renamed to the version and date. */
    changelog: string;
}

/**
 * Cut a release from the Unreleased section. Throws if the section has no
 * marker, since then there is nothing saying what the version should be.
 */
export function cutRelease(text: string, currentVersion: string, date: string): Release {
    const all = lines(text);
    const section = findUnreleased(all);
    const bump = highestBump(section.body);
    if (!bump) {
        throw new Error(
            `Nothing to release: no line under "${UNRELEASED_HEADING}" is marked [MAJOR], [MINOR] or [PATCH].`,
        );
    }
    const version = bumpVersion(currentVersion, bump);
    const notes = stripMarkers(section.body);
    const changelog = [
        ...all.slice(0, section.start),
        `## [${version}] - ${date}`,
        '',
        ...notes,
        '',
        ...all.slice(section.end),
    ];
    return {
        version,
        bump,
        notes: notes.join('\n') + '\n',
        changelog: changelog.join('\n').replace(/\n*$/, '\n'),
    };
}

/**
 * Put an empty `## [Unreleased]` back above the newest release, for the
 * work that comes after it. A changelog that already has one is unchanged.
 */
export function openUnreleased(text: string): string {
    const all = lines(text);
    if (all.some((line) => line.trim() === UNRELEASED_HEADING)) return text;
    const firstSection = all.findIndex((line) => SECTION_PATTERN.test(line));
    const at = firstSection === -1 ? all.length : firstSection;
    return [...all.slice(0, at), UNRELEASED_HEADING, '', ...all.slice(at)]
        .join('\n')
        .replace(/\n*$/, '\n');
}

/**
 * Files whose `version` moves with each release. Every package in the
 * repository shares one version, so they are bumped together.
 */
export const VERSIONED_FILES = [
    'package.json',
    'package-lock.json',
    'docs-site/package.json',
    'docs-site/package-lock.json',
    'docker/signaling/package.json',
] as const;

/**
 * Set the package's own version in a package.json or package-lock.json,
 * editing only those lines so the rest of the file keeps its formatting.
 * A lockfile records the version twice: at the top and under `packages[""]`.
 */
export function setPackageVersion(text: string, version: string): string {
    const parsed = JSON.parse(text) as { lockfileVersion?: number };
    // Top-level "version" is the first one at two-space indentation.
    let next = text.replace(/^( {2}"version": ")[^"]*(")/m, `$1${version}$2`);
    if (parsed.lockfileVersion !== undefined) {
        next = next.replace(/(^ {4}"": \{\n(?: {6}.*\n)*? {6}"version": ")[^"]*(")/m, `$1${version}$2`);
    }
    const check = JSON.parse(next) as {
        version?: string;
        packages?: Record<string, { version?: string }>;
    };
    if (check.version !== version) throw new Error('could not set the top-level "version".');
    if (parsed.lockfileVersion !== undefined && check.packages?.['']?.version !== version) {
        throw new Error('could not set packages[""].version in the lockfile.');
    }
    return next;
}
