// gifenc ships no types; these cover the parts the scenario GIF export uses.
declare module 'gifenc' {
    export type Palette = number[][];

    export interface GifFrameOptions {
        palette?: Palette;
        /** Milliseconds, stored in 10ms units. */
        delay?: number;
        /** -1 = play once, 0 = loop forever, >0 = loop count. */
        repeat?: number;
        transparent?: boolean;
        transparentIndex?: number;
        colorDepth?: number;
        dispose?: number;
    }

    export interface GifEncoder {
        writeFrame(index: Uint8Array, width: number, height: number, opts?: GifFrameOptions): void;

        finish(): void;

        bytes(): Uint8Array;

        bytesView(): Uint8Array;
    }

    export function GIFEncoder(opts?: { initialCapacity?: number; auto?: boolean }): GifEncoder;

    export function quantize(
        rgba: Uint8Array | Uint8ClampedArray,
        maxColors: number,
        opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' },
    ): Palette;

    export function applyPalette(
        rgba: Uint8Array | Uint8ClampedArray,
        palette: Palette,
        format?: 'rgb565' | 'rgb444' | 'rgba4444',
    ): Uint8Array;
}
