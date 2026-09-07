/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/autoSizeTextarea.verify.ts
 *
 * The stub below MODELS the browser's scrollHeight rule (it reports the
 * greater of the content height and the element's own height) rather
 * than proving it - that rule comes from the CSSOM spec, not from this
 * file. What these assertions genuinely pin is that fitHeightToContent
 * behaves correctly GIVEN that rule, in particular that it can shrink.
 * jsdom can't stand in for this: it performs no layout and reports
 * scrollHeight as 0 for everything.
 */
import { fitHeightToContent, type AutoSizableElement } from "./autoSizeTextarea";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

/**
 * A textarea whose content is `contentHeight` tall. Reading scrollHeight
 * returns max(content, current height) when a height is pinned, and the
 * content height when height is "auto" - the behavior that makes the
 * collapse-first step necessary.
 */
function stubTextarea(contentHeight: number) {
  const el = {
    contentHeight,
    style: { height: "" },
    get scrollHeight(): number {
      if (this.style.height === "auto" || this.style.height === "") return this.contentHeight;
      const pinned = Number.parseFloat(this.style.height);
      return Number.isNaN(pinned) ? this.contentHeight : Math.max(this.contentHeight, pinned);
    },
  };
  return el as typeof el & AutoSizableElement;
}

// === Part 1: growing to fit ===
{
  const el = stubTextarea(340);
  fitHeightToContent(el);
  assert(el.style.height === "340px", "a 15-line description sizes the textarea to its full content height rather than a fixed window");
}

// === Part 2: shrinking back - the case the collapse step exists for ===
// Without setting height to "auto" first, scrollHeight would report the
// element's own (larger) pinned height and the textarea would never get
// smaller: it would grow while typing and stay grown after deleting.
{
  const el = stubTextarea(340);
  fitHeightToContent(el);
  assert(el.style.height === "340px", "sized to the long content first");

  el.contentHeight = 60; // the user deletes most of the text
  fitHeightToContent(el);
  assert(
    el.style.height === "60px",
    "shrinks back when content is removed - measuring without collapsing to auto first would have left it stuck at 340px forever"
  );
}

// === Part 3: repeated fits with unchanged content are stable ===
// Relevant because this runs on every value change, and an unstable
// result would compound across keystrokes.
{
  const el = stubTextarea(200);
  fitHeightToContent(el);
  const first = el.style.height;
  fitHeightToContent(el);
  fitHeightToContent(el);
  assert(el.style.height === first && first === "200px", "fitting repeatedly with unchanged content converges on the same height instead of creeping");
}

// === Part 4: only height is written ===
// The CSS min-height/max-height bounds have to stay in charge, so this
// must not start writing them too.
{
  const el = stubTextarea(120);
  fitHeightToContent(el);
  const written = Object.keys(el.style);
  assert(written.length === 1 && written[0] === "height", `only the height property is set, leaving min-height/max-height to CSS - wrote: ${written.join(", ")}`);
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
