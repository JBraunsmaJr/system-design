import * as p from '@clack/prompts';
import pc from 'picocolors';
import {InstallerError} from './util.ts';

/**
 * Every line the installer prints goes through here, so interactive and
 * non-interactive runs differ in exactly one place. Non-interactive runs
 * (a manifest in CI, or no TTY) print plain timestamped-free lines instead
 * of animations, which keeps logs readable.
 */
class Ui {
    interactive = false;
    assumeYes = false;

    intro(title: string): void {
        if (this.interactive) p.intro(pc.bgCyan(pc.black(` ${title} `)));
        else console.log(pc.bold(pc.cyan(`== ${title}`)));
    }

    outro(message: string): void {
        if (this.interactive) p.outro(message);
        else console.log(pc.bold(message));
    }

    section(title: string): void {
        if (this.interactive) p.log.step(pc.bold(pc.cyan(title)));
        else console.log(`\n${pc.bold(pc.cyan(`-- ${title}`))}`);
    }

    info(message: string): void {
        if (this.interactive) p.log.info(message);
        else console.log(`${pc.blue('i')} ${message}`);
    }

    message(message: string): void {
        if (this.interactive) p.log.message(message);
        else console.log(`  ${message}`);
    }

    success(message: string): void {
        if (this.interactive) p.log.success(pc.green(message));
        else console.log(`${pc.green('✔')} ${message}`);
    }

    warn(message: string): void {
        if (this.interactive) p.log.warn(pc.yellow(message));
        else console.log(`${pc.yellow('!')} ${pc.yellow(message)}`);
    }

    error(message: string): void {
        if (this.interactive) p.log.error(pc.red(message));
        else console.error(`${pc.red('✖')} ${pc.red(message)}`);
    }

    note(body: string, title?: string): void {
        if (this.interactive) p.note(body, title);
        else {
            if (title) console.log(pc.bold(title));
            for (const line of body.split('\n')) console.log(`  ${line}`);
        }
    }

    spinner(): { start(m: string): void; stop(m: string): void; fail(m: string): void; message(m: string): void } {
        if (this.interactive) {
            const s = p.spinner();
            return {
                start: (m) => s.start(m),
                stop: (m) => s.stop(pc.green(m)),
                fail: (m) => s.error(pc.red(m)),
                message: (m) => s.message(m),
            };
        }
        return {
            start: (m) => console.log(`${pc.dim('…')} ${m}`),
            stop: (m) => console.log(`${pc.green('✔')} ${m}`),
            fail: (m) => console.error(`${pc.red('✖')} ${m}`),
            message: () => {
            },
        };
    }

    /** Runs `fn` under a spinner; the spinner reports failure and the error propagates. */
    async task<T>(label: string, fn: () => Promise<T>, done?: (r: T) => string): Promise<T> {
        const s = this.spinner();
        s.start(label);
        try {
            const result = await fn();
            s.stop(done ? done(result) : label);
            return result;
        } catch (error) {
            s.fail(`${label} — failed`);
            throw error;
        }
    }

    private requireInteractive(what: string): void {
        if (!this.interactive) {
            throw new InstallerError(
                `Needed an answer for "${what}" but this run is non-interactive.`,
                'Supply it in the manifest, or run with a TTY (docker run -it) to be asked.',
            );
        }
    }

    private unwrap<T>(value: T): Exclude<T, symbol> {
        if (p.isCancel(value)) {
            p.cancel('Cancelled. Nothing further was changed.');
            process.exit(130);
        }
        return value as Exclude<T, symbol>;
    }

    async text(opts: {
        message: string;
        defaultValue?: string;
        placeholder?: string;
        validate?: (v: string) => string | undefined;
    }): Promise<string> {
        this.requireInteractive(opts.message);
        const value = await p.text({
            message: opts.message,
            initialValue: opts.defaultValue,
            placeholder: opts.placeholder,
            validate: opts.validate ? (v) => opts.validate!(v ?? '') : undefined,
        });
        return this.unwrap(value).trim();
    }

    async password(opts: { message: string; validate?: (v: string) => string | undefined }): Promise<string> {
        this.requireInteractive(opts.message);
        const value = await p.password({
            message: opts.message,
            validate: (v) => (v ? opts.validate?.(v) : 'A value is required'),
        });
        return this.unwrap(value);
    }

    async select<T extends string>(opts: {
        message: string;
        options: { value: T; label: string; hint?: string }[];
        initialValue?: T;
    }): Promise<T> {
        this.requireInteractive(opts.message);
        // clack's Option type is a conditional type over Value; the cast keeps
        // our simpler shape without fighting the inference.
        const value = await p.select<T>({
            message: opts.message,
            options: opts.options as Parameters<typeof p.select<T>>[0]['options'],
            initialValue: opts.initialValue,
        });
        return this.unwrap(value);
    }

    /** In non-interactive mode returns `--yes` if given, otherwise `fallback`. */
    async confirm(message: string, fallback: boolean): Promise<boolean> {
        if (!this.interactive) return this.assumeYes ? true : fallback;
        const value = await p.confirm({message, initialValue: fallback});
        return this.unwrap(value);
    }

    /** A yes/no that must be answered yes to continue; non-interactive needs --yes. */
    async confirmOrAbort(message: string): Promise<void> {
        if (!this.interactive) {
            if (this.assumeYes) return;
            throw new InstallerError(`Refusing to continue without confirmation: ${message}`, 'Re-run with --yes.');
        }
        const ok = await this.confirm(message, true);
        if (!ok) {
            p.cancel('Stopped. Nothing further was changed.');
            process.exit(1);
        }
    }
}

export const ui = new Ui();
export {pc};
