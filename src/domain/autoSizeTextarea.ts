/**
 * The minimum surface of a textarea this needs, declared structurally so
 * the logic is testable without a real DOM (jsdom reports scrollHeight
 * as 0 - it does no layout - so a real element proves nothing here
 * either).
 */
export interface AutoSizableElement {
  style: { height: string };
  readonly scrollHeight: number;
}

/**
 * Sets an element's inline height to exactly fit its content.
 *
 * The two steps are both load-bearing, and the reason is not obvious
 * enough to survive a well-meaning simplification: scrollHeight reports
 * the greater of the content height and the element's own client
 * height, so measuring it while the element is still at its previous
 * height can only ever report the SAME or a LARGER value. Collapsing to
 * "auto" first is what lets it report a smaller content height, and
 * without it the textarea becomes a one-way ratchet - it grows as text
 * is typed and never shrinks back when text is deleted.
 *
 * Deliberately writes only `height`. A `max-height` in CSS still clamps
 * the rendered box and switches on the textarea's own scrollbar, and
 * `min-height` still wins for near-empty content, so the CSS keeps
 * control of the bounds and this only has to answer "how tall is the
 * content".
 */
export function fitHeightToContent(el: AutoSizableElement): void {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
