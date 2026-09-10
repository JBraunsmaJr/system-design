import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GeometryPicker, GEOMETRY_OPTIONS } from "./GeometryPicker";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// === Part 1: Options coverage ===
{
  assert(GEOMETRY_OPTIONS.length === 11, "Has all 11 geometric shape types");
  const ids = GEOMETRY_OPTIONS.map((o) => o.id);
  assert(ids.includes("rounded-rectangle"), "includes rounded-rectangle");
  assert(ids.includes("rectangle"), "includes rectangle");
  assert(ids.includes("circle"), "includes circle");
  assert(ids.includes("cylinder"), "includes cylinder");
  assert(ids.includes("diamond"), "includes diamond");
  assert(ids.includes("hexagon"), "includes hexagon");
  assert(ids.includes("parallelogram"), "includes parallelogram");
  assert(ids.includes("document"), "includes document");
  assert(ids.includes("cloud"), "includes cloud");
  assert(ids.includes("actor"), "includes actor");
  assert(ids.includes("path"), "includes custom path");
}

// === Part 2: Component rendering ===
{
  const html = renderToStaticMarkup(
    React.createElement(GeometryPicker, {
      value: "cylinder",
      onChange: () => {},
    })
  );

  assert(html.includes("Cylinder (Database)"), "renders selected geometry label in trigger");
  assert(html.includes("<svg"), "renders geometry icon");
}

console.log("GeometryPicker verification passed successfully!");
