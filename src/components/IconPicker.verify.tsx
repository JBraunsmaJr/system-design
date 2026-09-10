/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/IconPicker.verify.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { IconPicker } from "./IconPicker";
import { globalIconRegistry } from "../domain/iconRegistry";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// === Part 1: Default value rendering ===
{
  const html = renderToStaticMarkup(
    React.createElement(IconPicker, {
      value: undefined,
      defaultValue: "Database",
      onChange: () => {},
    })
  );

  assert(html.includes("Database"), "renders default icon name");
  assert(html.includes("icon-picker__trigger"), "renders trigger button");
  assert(!html.includes("color-field__reset"), "does not render reset button when no override is present");
  assert(!html.includes("icon-picker__panel"), "panel is closed and not rendered inline by default");
}

// === Part 2: Override value rendering ===
{
  const html = renderToStaticMarkup(
    React.createElement(IconPicker, {
      value: "Server",
      defaultValue: "Database",
      onChange: () => {},
    })
  );

  assert(html.includes("Server"), "renders override icon name");
  assert(html.includes("color-field__reset"), "renders reset button when override is present");
}

// === Part 3: No icon / None rendering ===
{
  const htmlWithoutDefault = renderToStaticMarkup(
    React.createElement(IconPicker, {
      value: undefined,
      defaultValue: undefined,
      onChange: () => {},
    })
  );

  assert(htmlWithoutDefault.includes("None"), "renders 'None' when no default or value is present");

  const htmlExplicitNone = renderToStaticMarkup(
    React.createElement(IconPicker, {
      value: "none",
      defaultValue: "Database",
      onChange: () => {},
    })
  );

  assert(htmlExplicitNone.includes("None"), "renders 'None' when value is set to 'none'");
  assert(htmlExplicitNone.includes("color-field__reset"), "renders reset button when overridden to 'none'");
}

// === Part 4: Registry integration ===
{
  const icons = globalIconRegistry.searchIcons("Server");
  assert(icons.length > 0, "registry contains matching icons for query");
  assert(icons.some((i) => i.id === "Server"), "Server icon found in registry");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} assertion(s) failed`);
