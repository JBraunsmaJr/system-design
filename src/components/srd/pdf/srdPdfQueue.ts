/**
 * The order SRD PDF renders run in: one at a time, and a render marked
 * `supersedable` (the preview's) replaced while it waits by any newer
 * supersedable one - a burst of edits renders once, for the latest state.
 * Renders that are not supersedable (exports) always run.
 *
 * Separate from how a render is done (srdPdfClient's worker), so the order
 * can be tested on its own.
 */

/** A render replaced by a newer one before it started. */
export class SupersededError extends Error {
  constructor() {
    super('Superseded by a newer render');
    this.name = 'SupersededError';
  }
}

interface Job<Input, Output> {
  input: Input;
  supersedable: boolean;
  resolve: (output: Output) => void;
  reject: (error: Error) => void;
}

export function createRenderQueue<Input, Output>(run: (input: Input) => Promise<Output>) {
  const waiting: Job<Input, Output>[] = [];
  let busy = false;

  const pump = () => {
    if (busy || waiting.length === 0) return;
    const job = waiting.shift()!;
    busy = true;
    run(job.input)
      .then(job.resolve, (err) => job.reject(err instanceof Error ? err : new Error(String(err))))
      .finally(() => {
        busy = false;
        pump();
      });
  };

  return function request(input: Input, { supersedable = false } = {}): Promise<Output> {
    return new Promise((resolve, reject) => {
      if (supersedable) {
        for (let i = waiting.length - 1; i >= 0; i--) {
          if (waiting[i].supersedable) waiting.splice(i, 1)[0].reject(new SupersededError());
        }
      }
      waiting.push({ input, supersedable, resolve, reject });
      pump();
    });
  };
}
