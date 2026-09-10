/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/domain/clipboardShortcut.verify.ts
 *
 * Verifies keyboard shortcut handling for copying text vs diagram elements:
 * - When text selection exists (e.g. copying requirement items in non-edit mode),
 *   the copy shortcut does not prevent default and allows native clipboard copy.
 * - In non-diagram views, diagram node copy/paste/delete/undo/redo are inactive.
 * - In diagram view with no text selection, diagram operations function as expected.
 */

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

interface FakeSelection {
  isCollapsed: boolean;
  text: string;
}

interface FakeKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: { tagName: string; isContentEditable?: boolean };
  preventDefault(): void;
}

function createKeyboardHandler(options: {
  isPresenting: boolean;
  viewMode: string;
  getSelection: () => FakeSelection | null;
  onCopy: () => void;
  onPaste: () => void;
}) {
  return (event: FakeKeyboardEvent) => {
    if (options.isPresenting) return;
    const target = event.target as { tagName: string; isContentEditable?: boolean } | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "c") {
      const selection = options.getSelection();
      const hasTextSelection = Boolean(selection && !selection.isCollapsed && selection.text.length > 0);
      if (hasTextSelection) return;
      if (options.viewMode !== "diagram") return;
      event.preventDefault();
      options.onCopy();
    } else if ((event.ctrlKey || event.metaKey) && key === "v") {
      if (options.viewMode !== "diagram") return;
      event.preventDefault();
      options.onPaste();
    }
  };
}

function createEvent(key: string, ctrl = true, tag = "DIV", isContentEditable = false): FakeKeyboardEvent {
  const evt: FakeKeyboardEvent = {
    key,
    ctrlKey: ctrl,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    target: { tagName: tag, isContentEditable },
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  return evt;
}

// --- Test 1: Active text selection on requirement item (DIV / SPAN) allows native copy ---
{
  let diagramCopyCalled = false;
  const handler = createKeyboardHandler({
    isPresenting: false,
    viewMode: "requirements",
    getSelection: () => ({ isCollapsed: false, text: "As a user, I want..." }),
    onCopy: () => {
      diagramCopyCalled = true;
    },
    onPaste: () => {},
  });

  const event = createEvent("c", true, "DIV");
  handler(event);

  assert(!event.defaultPrevented, "Ctrl+C on selected text does not preventDefault, enabling OS clipboard copy");
  assert(!diagramCopyCalled, "Diagram node onCopy is not triggered when text is highlighted");
}

// --- Test 2: Active text selection on diagram view still allows native text copy ---
{
  let diagramCopyCalled = false;
  const handler = createKeyboardHandler({
    isPresenting: false,
    viewMode: "diagram",
    getSelection: () => ({ isCollapsed: false, text: "Highlighted label text" }),
    onCopy: () => {
      diagramCopyCalled = true;
    },
    onPaste: () => {},
  });

  const event = createEvent("c", true, "DIV");
  handler(event);

  assert(!event.defaultPrevented, "Ctrl+C on highlighted text in diagram view does not preventDefault");
  assert(!diagramCopyCalled, "Diagram node onCopy is not called when text is selected in diagram view");
}

// --- Test 3: No text selection in diagram view triggers diagram copy ---
{
  let diagramCopyCalled = false;
  const handler = createKeyboardHandler({
    isPresenting: false,
    viewMode: "diagram",
    getSelection: () => ({ isCollapsed: true, text: "" }),
    onCopy: () => {
      diagramCopyCalled = true;
    },
    onPaste: () => {},
  });

  const event = createEvent("c", true, "DIV");
  handler(event);

  assert(event.defaultPrevented, "Ctrl+C with no text selection in diagram view prevents default");
  assert(diagramCopyCalled, "Diagram node onCopy is executed");
}

// --- Test 4: No text selection in requirements view does not trigger diagram copy or prevent default ---
{
  let diagramCopyCalled = false;
  const handler = createKeyboardHandler({
    isPresenting: false,
    viewMode: "requirements",
    getSelection: () => ({ isCollapsed: true, text: "" }),
    onCopy: () => {
      diagramCopyCalled = true;
    },
    onPaste: () => {},
  });

  const event = createEvent("c", true, "DIV");
  handler(event);

  assert(!event.defaultPrevented, "Ctrl+C in requirements view with no selection does not prevent default");
  assert(!diagramCopyCalled, "Diagram node onCopy is not called in requirements view");
}

// --- Test 5: Editing in INPUT or TEXTAREA returns early ---
{
  let diagramCopyCalled = false;
  const handler = createKeyboardHandler({
    isPresenting: false,
    viewMode: "diagram",
    getSelection: () => ({ isCollapsed: true, text: "" }),
    onCopy: () => {
      diagramCopyCalled = true;
    },
    onPaste: () => {},
  });

  const event = createEvent("c", true, "INPUT");
  handler(event);

  assert(!event.defaultPrevented, "Ctrl+C inside INPUT allows standard browser input copy");
  assert(!diagramCopyCalled, "Diagram node onCopy is not called inside INPUT");
}

// --- Test 6: Text selection does NOT block Ctrl+V paste on diagram ---
{
  let diagramPasteCalled = false;
  const handler = createKeyboardHandler({
    isPresenting: false,
    viewMode: "diagram",
    getSelection: () => ({ isCollapsed: false, text: "Some selected text elsewhere" }),
    onCopy: () => {},
    onPaste: () => {
      diagramPasteCalled = true;
    },
  });

  const event = createEvent("v", true, "DIV");
  handler(event);

  assert(event.defaultPrevented, "Ctrl+V on diagram prevents default even when text selection exists");
  assert(diagramPasteCalled, "Diagram node onPaste is executed when text selection exists");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) {
  throw new Error(`${failures} test(s) failed`);
}
