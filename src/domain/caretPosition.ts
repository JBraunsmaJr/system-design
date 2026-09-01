/**
 * Computes the pixel position of the caret within a textarea, relative to
 * the textarea's own top-left corner - used to position the reference
 * popover right where the user is typing (matching GitHub/GitLab's
 * behavior), rather than at some fixed, less useful spot.
 *
 * Standard technique: create an invisible "mirror" element with identical
 * font/padding/wrapping as the textarea, fill it with the text up to the
 * caret, measure where a marker span ends up. This is synchronous DOM
 * measurement (no timing/async concerns), but it IS real browser
 * layout/rendering behavior that can't be verified outside an actual
 * browser - kept defensive (try/catch, always removes the mirror element
 * even on error) and the returned position gets clamped to the viewport by
 * the popover component itself, so a measurement being slightly off would
 * degrade gracefully rather than positioning something off-screen.
 */
export function getCaretPixelPosition(
  textarea: HTMLTextAreaElement,
  caretIndex: number
): { top: number; left: number; lineHeight: number } {
  const fallback = { top: 0, left: 0, lineHeight: 20 };
  if (typeof document === "undefined") return fallback;

  const mirror = document.createElement("div");
  try {
    const style = window.getComputedStyle(textarea);
    const propertiesToCopy: (keyof CSSStyleDeclaration)[] = [
      "boxSizing",
      "width",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "borderTopWidth",
      "borderRightWidth",
      "borderBottomWidth",
      "borderLeftWidth",
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "letterSpacing",
      "lineHeight",
      "textTransform",
      "wordSpacing",
    ];
    for (const prop of propertiesToCopy) {
      const value = style[prop];
      if (typeof value === "string") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- assigning a copied CSSStyleDeclaration value back by the same key is inherently untyped
        (mirror.style as any)[prop] = value;
      }
    }
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.top = "0";
    mirror.style.left = "-9999px";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.overflow = "hidden";
    mirror.style.height = "auto";

    mirror.textContent = textarea.value.slice(0, caretIndex);
    const marker = document.createElement("span");
    // A trailing zero-width-ish placeholder so the marker has real
    // dimensions to measure even when the caret is at the very end of
    // an empty or whitespace-ending line.
    marker.textContent = ".";
    mirror.appendChild(marker);

    document.body.appendChild(mirror);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const top = marker.offsetTop - textarea.scrollTop;
    const left = marker.offsetLeft - textarea.scrollLeft;
    return { top, left, lineHeight };
  } catch {
    return fallback;
  } finally {
    if (mirror.parentNode) mirror.parentNode.removeChild(mirror);
  }
}
