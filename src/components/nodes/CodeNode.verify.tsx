/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/nodes/CodeNode.verify.tsx
 */
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

class MockDOMNode {
  nodeType: number;
  nodeName: string;
  tagName: string;
  ownerDocument: MockDocument | null;
  childNodes: MockDOMNode[];
  parentNode: MockDOMNode | null;
  style: Record<string, string>;
  attributes: Record<string, string>;
  _listeners: Record<string, ((event: unknown) => void)[]>;
  _value: string;
  _defaultValue: string;
  _dirtyValue: boolean;
  selectionStart: number;
  selectionEnd: number;
  namespaceURI: string;

  constructor(nodeType: number, nodeName: string, ownerDoc: MockDocument | null = null) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.tagName = nodeName;
    this.ownerDocument = ownerDoc;
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = {};
    this._listeners = {};
    this._value = "";
    this._defaultValue = "";
    this._dirtyValue = false;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.namespaceURI = "http://www.w3.org/1999/xhtml";
  }

  get value(): string {
    return this._value;
  }

  set value(v: string) {
    this._value = String(v ?? "");
    this._dirtyValue = true;
  }

  get nodeValue(): string {
    return this._value;
  }

  set nodeValue(v: string) {
    this._value = String(v ?? "");
  }

  get data(): string {
    return this._value;
  }

  set data(v: string) {
    this._value = String(v ?? "");
  }

  get className(): string {
    return this.attributes.class || "";
  }

  set className(v: string) {
    this.attributes.class = String(v ?? "");
  }

  get defaultValue(): string {
    return this._defaultValue;
  }

  set defaultValue(v: string) {
    this._defaultValue = String(v ?? "");
    if (!this._dirtyValue) {
      this._value = this._defaultValue;
    }
  }

  get textContent(): string {
    if (this.childNodes.length === 0) return this._value;
    return this.childNodes.map((c) => c.textContent).join("");
  }

  set textContent(v: string) {
    this._value = String(v ?? "");
    this.childNodes = [];
  }

  get innerHTML(): string {
    return this._value || "";
  }

  set innerHTML(v: string) {
    this._value = String(v ?? "");
  }

  appendChild<T extends MockDOMNode>(child: T): T {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore<T extends MockDOMNode>(newNode: T, refNode: MockDOMNode | null): T {
    newNode.parentNode = this;
    const idx = refNode ? this.childNodes.indexOf(refNode) : -1;
    if (idx >= 0) {
      this.childNodes.splice(idx, 0, newNode);
    } else {
      this.childNodes.push(newNode);
    }
    return newNode;
  }

  removeChild<T extends MockDOMNode>(child: T): T {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
    }
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, val: unknown) {
    this.attributes[name] = String(val);
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string) {
    delete this.attributes[name];
  }

  addEventListener(type: string, listener: (event: unknown) => void, options?: boolean | { capture?: boolean }) {
    const isCapture = typeof options === "boolean" ? options : !!options?.capture;
    const key = isCapture ? `${type}:capture` : type;
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void, options?: boolean | { capture?: boolean }) {
    const isCapture = typeof options === "boolean" ? options : !!options?.capture;
    const key = isCapture ? `${type}:capture` : type;
    if (!this._listeners[key]) return;
    this._listeners[key] = this._listeners[key].filter((l) => l !== listener);
  }

  dispatchEvent(event: {
    type: string;
    bubbles?: boolean;
    cancelable?: boolean;
    target?: unknown;
    currentTarget?: unknown;
    defaultPrevented?: boolean;
    propagationStopped?: boolean;
    preventDefault?: () => void;
    stopPropagation?: () => void;
    [key: string]: unknown;
  }): boolean {
    event.target = this;
    if (!event.preventDefault) {
      event.preventDefault = () => {
        event.defaultPrevented = true;
      };
    }
    if (!event.stopPropagation) {
      event.stopPropagation = () => {
        event.propagationStopped = true;
      };
    }

    const path: MockDOMNode[] = [];
    let curr: MockDOMNode | null = this;
    while (curr) {
      path.push(curr);
      curr = curr.parentNode;
    }

    // Capture phase
    for (let i = path.length - 1; i >= 0; i--) {
      if (event.propagationStopped) break;
      const node = path[i];
      event.currentTarget = node;
      const captureList = node._listeners[`${event.type}:capture`] || [];
      for (const listener of captureList) {
        listener.call(node, event);
      }
    }

    // Bubble phase
    for (let i = 0; i < path.length; i++) {
      if (event.propagationStopped) break;
      if (i > 0 && event.bubbles === false) break;
      const node = path[i];
      event.currentTarget = node;
      const bubbleList = node._listeners[event.type] || [];
      for (const listener of bubbleList) {
        listener.call(node, event);
      }
    }

    return !event.defaultPrevented;
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = null;
    }
  }

  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }

  querySelector(selector: string): MockDOMNode | null {
    for (const child of this.childNodes) {
      if (child.nodeType === 1) {
        const isTagMatch = child.tagName.toLowerCase() === selector.toLowerCase();
        const classNames = child.attributes.class ? child.attributes.class.split(" ") : [];
        const isClassMatch = selector.startsWith(".") && classNames.includes(selector.slice(1));
        if (isTagMatch || isClassMatch) {
          return child;
        }
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll(selector: string): MockDOMNode[] {
    const results: MockDOMNode[] = [];
    const walk = (node: MockDOMNode) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          const isTagMatch = child.tagName.toLowerCase() === selector.toLowerCase();
          const classNames = child.attributes.class ? child.attributes.class.split(" ") : [];
          const isClassMatch = selector.startsWith(".") && classNames.includes(selector.slice(1));
          if (isTagMatch || isClassMatch || selector === "*") {
            results.push(child);
          }
          walk(child);
        }
      }
    };
    walk(this);
    return results;
  }

  getElementsByTagName(tag: string): MockDOMNode[] {
    const results: MockDOMNode[] = [];
    const walk = (node: MockDOMNode) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          if (tag === "*" || child.tagName.toLowerCase() === tag.toLowerCase()) {
            results.push(child);
          }
          walk(child);
        }
      }
    };
    walk(this);
    return results;
  }
}

class MockDocument extends MockDOMNode {
  documentElement: MockDOMNode;
  body: MockDOMNode;
  activeElement: MockDOMNode | null;
  defaultView: unknown;
  currentScript: MockDOMNode | null = null;
  oninput: unknown = null;
  onchange: unknown = null;
  onkeydown: unknown = null;
  onkeyup: unknown = null;
  onfocus: unknown = null;
  onblur: unknown = null;
  onfocusin: unknown = null;
  onfocusout: unknown = null;

  constructor() {
    super(9, "#document", null);
    this.ownerDocument = null;
    this.documentElement = new MockDOMNode(1, "HTML", this);
    this.body = new MockDOMNode(1, "BODY", this);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = null;
    this.defaultView = globalThis;
  }

  createElement(tag: string): MockDOMNode {
    return new MockDOMNode(1, tag.toUpperCase(), this);
  }

  createElementNS(ns: string, tag: string): MockDOMNode {
    const el = new MockDOMNode(1, tag.toUpperCase(), this);
    el.namespaceURI = ns;
    return el;
  }

  createTextNode(text: string): MockDOMNode {
    const node = new MockDOMNode(3, "#text", this);
    node.nodeValue = text;
    node.textContent = text;
    return node;
  }

  createComment(text: string): MockDOMNode {
    const node = new MockDOMNode(8, "#comment", this);
    node.nodeValue = text;
    return node;
  }
}

const mockDoc = new MockDocument();
// @ts-expect-error Mocking DOM in node
globalThis.document = mockDoc;
// @ts-expect-error Mocking DOM in node
globalThis.window = globalThis;
// @ts-expect-error Mocking DOM in node
globalThis.HTMLIFrameElement = class HTMLIFrameElement extends MockDOMNode {};
// @ts-expect-error Mocking DOM in node
globalThis.Node = MockDOMNode;
// @ts-expect-error Mocking DOM in node
globalThis.Element = MockDOMNode;
// @ts-expect-error Mocking DOM in node
globalThis.HTMLElement = MockDOMNode;
// @ts-expect-error Mocking DOM in node
globalThis.HTMLTextAreaElement = MockDOMNode;
// @ts-expect-error Mocking DOM in node
globalThis.HTMLInputElement = MockDOMNode;
// @ts-expect-error Mocking DOM in node
globalThis.HTMLSelectElement = MockDOMNode;
if (!("navigator" in globalThis)) {
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "node.js" }, configurable: true });
}
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
  cb(Date.now());
  return 1;
};

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

async function runTests() {
  const React = await import("react");
  const { useState, act } = React;
  const { createRoot } = await import("react-dom/client");
  const { ReactFlowProvider } = await import("@xyflow/react");
  const { CodeNode } = await import("./CodeNode");
  const { CanvasContext } = await import("../CanvasContext");
  // --- Test 1: DOM interaction test with controlled CodeNode editor, JSON update, and Tab key press ---
  {
    const container = mockDoc.createElement("div");
    const root = createRoot(container as unknown as HTMLElement);

    const initialCode = '{\n  "status": "ok"\n}';

    function ControlledCodeNodeHarness() {
      const [code, setCode] = useState(initialCode);

      return (
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              isPresenting: false,
              onDrillInto: () => {},
              editingLabelNodeId: "code-test-node",
              setEditingLabelNodeId: () => {},
              onChangeTextNode: () => {},
              onChangeCodeNode: (_id, nextCode) => setCode(nextCode),
              onAdoptIntoGroup: () => {},
            }}
          >
            <CodeNode
              id="code-test-node"
              type="code"
              data={{
                nodeType: "code",
                label: "Payload",
                codeContent: code,
                codeLanguage: "json",
                tags: [],
                properties: {},
              }}
              selected={true}
              zIndex={1}
              isConnectable={true}
              positionAbsoluteX={100}
              positionAbsoluteY={100}
              dragging={false}
              selectable={true}
              deletable={true}
              draggable={true}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    }

    await act(async () => {
      root.render(<ControlledCodeNodeHarness />);
    });

    const textarea = container.querySelector("textarea");
    assert(!!textarea, "Controlled CodeNode mounts and renders textarea in editing mode");
    assert(textarea?.value === initialCode, "Textarea has initial JSON code content");
    assert(mockDoc.activeElement === textarea, "Textarea receives focus on mount effect");

    // 1. Perform a JSON update and exercise caret-preservation behavior
    // Simulate user editing JSON at position 18 (e.g. changing "ok" to "pending")
    const updatedCode = '{\n  "status": "pending"\n}';
    const targetCaretPos = 21; // after "pending"

    await act(async () => {
      if (textarea) {
        textarea.selectionStart = targetCaretPos;
        textarea.selectionEnd = targetCaretPos;
        textarea.value = updatedCode;
        textarea.dispatchEvent({ type: "input", bubbles: true });
        textarea.dispatchEvent({ type: "change", bubbles: true });
      }
    });

    assert(textarea?.value === updatedCode, "Textarea value updated to new JSON content");
    assert(
      textarea?.selectionStart === targetCaretPos && textarea?.selectionEnd === targetCaretPos,
      `Caret preserved after JSON update: selectionStart=${textarea?.selectionStart}, selectionEnd=${textarea?.selectionEnd} (expected ${targetCaretPos})`
    );

    // 2. Simulate a Tab key press at a specific caret offset
    // Place caret at beginning of line 2 (offset 4, before '"status"')
    const tabInsertPos = 4;
    await act(async () => {
      if (textarea) {
        textarea.setSelectionRange(tabInsertPos, tabInsertPos);
        textarea.dispatchEvent({
          type: "keydown",
          key: "Tab",
          bubbles: true,
          cancelable: true,
        });
      }
    });

    const expectedTabCode = '{\n    "status": "pending"\n}';
    const expectedTabCaret = tabInsertPos + 2; // INDENT is "  " (2 spaces)

    assert(textarea?.value === expectedTabCode, "Textarea value updated with indentation on Tab key");
    assert(
      textarea?.selectionStart === expectedTabCaret && textarea?.selectionEnd === expectedTabCaret,
      `Caret preserved after Tab key: selectionStart=${textarea?.selectionStart}, selectionEnd=${textarea?.selectionEnd} (expected ${expectedTabCaret})`
    );

    // Clean up
    await act(async () => {
      root.unmount();
    });
  }

  // --- Test 2: Display mode when not editing ---
  {
    const container = mockDoc.createElement("div");
    const root = createRoot(container as unknown as HTMLElement);

    await act(async () => {
      root.render(
        <ReactFlowProvider>
          <CanvasContext.Provider
            value={{
              isPresenting: false,
              onDrillInto: () => {},
              editingLabelNodeId: null,
              setEditingLabelNodeId: () => {},
              onChangeTextNode: () => {},
              onChangeCodeNode: () => {},
              onAdoptIntoGroup: () => {},
            }}
          >
            <CodeNode
              id="code-display-node"
              type="code"
              data={{
                nodeType: "code",
                label: "Payload",
                codeContent: '{\n  "status": "ok"\n}',
                codeLanguage: "json",
                tags: [],
                properties: {},
              }}
              selected={false}
              zIndex={1}
              isConnectable={true}
              positionAbsoluteX={100}
              positionAbsoluteY={100}
              dragging={false}
              selectable={true}
              deletable={true}
              draggable={true}
            />
          </CanvasContext.Provider>
        </ReactFlowProvider>
      );
    });

    const display = container.querySelector(".code-node__display");
    assert(!!display, "CodeNode renders display mode container when not editing");
    const lang = container.querySelector(".code-node__lang");
    assert(lang?.textContent === "JSON", "CodeNode renders language label in header");

    await act(async () => {
      root.unmount();
    });
  }

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
  if (failures > 0) throw new Error(`${failures} test(s) failed`);
}

await runTests();
