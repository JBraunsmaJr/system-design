import {chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,} from 'node:fs';
import {dirname, join} from 'node:path';
import {createTwoFilesPatch} from 'diff';
import type {RenderedFile} from './render/index.ts';
import {type State, STATE_DIR} from './state.ts';
import {sha256, timestampId} from './lib/util.ts';
import {pc, ui} from './lib/ui.ts';

export type FileStatus =
    | 'new' // not on disk
    | 'unchanged' // on disk and identical
    | 'update' // on disk, untouched since we wrote it, content changes
    | 'conflict' // on disk, edited by someone (or not ours), content would change
    | 'stale' // we wrote it before, no longer needed, untouched
    | 'stale-modified'; // no longer needed, but edited — left alone

export interface PlannedFile {
    path: string;
    status: FileStatus;
    file?: RenderedFile;
    existing?: string;
    /** For conflicts: what the operator decided. */
    decision?: 'overwrite' | 'keep';
}

export function planFiles(dir: string, files: RenderedFile[], state: State): PlannedFile[] {
    const plan: PlannedFile[] = [];
    const wanted = new Set(files.map((f) => f.path));
    for (const file of files) {
        const abs = join(dir, file.path);
        if (file.seed) {
            // Operator-owned once it exists: never compared, never tracked.
            if (!existsSync(abs)) plan.push({path: file.path, status: 'new', file});
            continue;
        }
        if (!existsSync(abs)) {
            plan.push({path: file.path, status: 'new', file});
            continue;
        }
        const existing = readFileSync(abs, 'utf8');
        if (existing === file.content) {
            plan.push({path: file.path, status: 'unchanged', file, existing});
            continue;
        }
        const recorded = state.files[file.path];
        const untouched = recorded !== undefined && recorded === sha256(existing);
        plan.push({path: file.path, status: untouched ? 'update' : 'conflict', file, existing});
    }
    for (const [path, hash] of Object.entries(state.files)) {
        if (wanted.has(path)) continue;
        const abs = join(dir, path);
        if (!existsSync(abs)) continue;
        plan.push({path, status: sha256(readFileSync(abs)) === hash ? 'stale' : 'stale-modified'});
    }
    return plan;
}

export function planHasChanges(plan: PlannedFile[]): boolean {
    return plan.some((p) => p.status !== 'unchanged' && p.status !== 'stale-modified');
}

const LABEL: Record<FileStatus, (s: string) => string> = {
    new: (s) => pc.green(`+ ${s}`),
    unchanged: (s) => pc.dim(`  ${s}`),
    update: (s) => pc.cyan(`~ ${s}`),
    conflict: (s) => pc.yellow(`! ${s}  (edited by hand)`),
    stale: (s) => pc.red(`- ${s}`),
    'stale-modified': (s) => pc.yellow(`? ${s}  (no longer used; edited, so left in place)`),
};

/** Lines with values replaced by a short fingerprint, so a diff shows *that* a secret changed but not what to. */
function maskSecrets(text: string): string {
    return text.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(.+)$/gm, (_m, k: string, v: string) =>
        v.startsWith('#') ? `${k}${v}` : `${k}<${sha256(v).slice(0, 8)}>`,
    );
}

export function diffFor(p: PlannedFile): string {
    const before = p.existing ?? '';
    const after = p.file?.content ?? '';
    const mask = p.file?.secret ? maskSecrets : (s: string) => s;
    const patch = createTwoFilesPatch(
        `a/${p.path}`,
        `b/${p.path}`,
        mask(before),
        mask(after),
        '',
        '',
        {context: 2},
    );
    return patch
        .split('\n')
        .slice(2) // drop the "===" banner and blank line createTwoFilesPatch adds
        .map((l) =>
            l.startsWith('+')
                ? pc.green(l)
                : l.startsWith('-')
                    ? pc.red(l)
                    : l.startsWith('@@')
                        ? pc.cyan(l)
                        : l,
        )
        .join('\n');
}

export function showPlan(plan: PlannedFile[], opts: { diffs: boolean }): void {
    ui.note(plan.map((p) => LABEL[p.status](p.path)).join('\n'), 'Files');
    if (!opts.diffs) return;
    for (const p of plan) {
        if (p.status === 'update' || p.status === 'conflict') ui.note(diffFor(p), p.path);
    }
}

/**
 * Asks what to do with each hand-edited file. With --force, overwrites
 * (keeping a copy); non-interactive without --force, refuses rather than
 * guessing which version is right.
 */
export async function resolveConflicts(
    plan: PlannedFile[],
    opts: { force: boolean },
): Promise<void> {
    const conflicts = plan.filter((p) => p.status === 'conflict' && !p.decision);
    if (!conflicts.length) return;
    if (opts.force) {
        for (const p of conflicts) p.decision = 'overwrite';
        ui.warn(
            `Overwriting ${conflicts.length} hand-edited file(s) because of --force; copies are kept under ${STATE_DIR}/replaced/.`,
        );
        return;
    }
    if (!ui.interactive) {
        throw new Error(
            `These files were edited by hand and would change: ${conflicts.map((p) => p.path).join(', ')}. ` +
            'Review with `render --dry-run`, then re-run with --force to overwrite (copies are kept).',
        );
    }
    for (const p of conflicts) {
        ui.note(diffFor(p), `${p.path} was edited by hand`);
        p.decision = await ui.select<'overwrite' | 'keep'>({
            message: `What should happen to ${p.path}?`,
            options: [
                {
                    value: 'overwrite',
                    label: 'Replace it',
                    hint: `your version is copied to ${STATE_DIR}/replaced/`,
                },
                {value: 'keep', label: 'Keep my version', hint: 'the installer will ask again next time'},
            ],
            initialValue: 'overwrite',
        });
    }
}

export interface ApplyResult {
    written: string[];
    removed: string[];
    kept: string[];
}

export function applyPlan(dir: string, plan: PlannedFile[], state: State): ApplyResult {
    const result: ApplyResult = {written: [], removed: [], kept: []};
    const stamp = timestampId();
    for (const p of plan) {
        const abs = join(dir, p.path);
        if (p.status === 'unchanged' && p.file) {
            state.files[p.path] = sha256(p.file.content);
            continue;
        }
        if (p.status === 'stale') {
            rmSync(abs);
            delete state.files[p.path];
            result.removed.push(p.path);
            continue;
        }
        if (p.status === 'stale-modified') {
            delete state.files[p.path];
            result.kept.push(p.path);
            continue;
        }
        if (!p.file) continue;
        if (p.status === 'conflict') {
            if (p.decision !== 'overwrite') {
                result.kept.push(p.path);
                continue;
            }
            const saved = join(dir, STATE_DIR, 'replaced', stamp, p.path);
            mkdirSync(dirname(saved), {recursive: true});
            copyFileSync(abs, saved);
        }
        mkdirSync(dirname(abs), {recursive: true});
        writeFileSync(abs, p.file.content, {mode: p.file.mode ?? 0o644});
        // writeFileSync's mode only applies on creation.
        chmodSync(abs, p.file.mode ?? 0o644);
        if (!p.file.seed) state.files[p.path] = sha256(p.file.content);
        result.written.push(p.path);
    }
    return result;
}
