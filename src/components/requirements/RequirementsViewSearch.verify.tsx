/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/requirements/RequirementsViewSearch.verify.tsx
 */
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { RequirementsView } from "./RequirementsView";
import {
  BUILT_IN_ITEM_TYPES,
  BUILT_IN_RELATIONSHIP_TYPES,
} from "../../domain/requirementsRegistry";
import type { RequirementsDocument } from "../../domain/requirementsTypes";
import type { RequirementsStore } from "../../collab/requirementsStore";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const testDoc: RequirementsDocument = {
  itemTypes: BUILT_IN_ITEM_TYPES,
  categories: [{ id: "cat-sec", label: "Security", color: "#f0578c" }],
  relationshipTypes: BUILT_IN_RELATIONSHIP_TYPES,
  items: [
    { id: "REQ-1", typeId: "requirement", title: "User authentication with OAuth2", body: "Auth token details", categoryId: "cat-sec" },
    { id: "REQ-2", typeId: "requirement", title: "Database migration scripts", body: "PostgreSQL setup", categoryId: undefined },
    { id: "GOAL-1", typeId: "goal", title: "High reliability and auth security", body: "Ensure 99.99% uptime", categoryId: "cat-sec" },
  ],
  relationships: [],
  nextSequence: {},
};

function createMockStore(doc: RequirementsDocument): RequirementsStore {
  return {
    getSnapshot: () => doc,
    subscribe: () => () => {},
    addItem: () => "REQ-99",
    updateItem: () => {},
    deleteItem: () => {},
    convertItemType: () => {},
    convertAllItemsOfType: () => 0,
    createAndAssignCategory: () => "cat-1",
    deleteCategory: () => {},
    addRelationship: () => null,
    deleteRelationship: () => {},
    addCustomType: () => true,
    updateType: () => {},
    deleteCustomType: () => true,
    addCustomRelationshipType: () => {},
    deleteCustomRelationshipType: () => {},
    destroy: () => {},
    unassignItemsFromSprints: () => {},
  };
}

console.log("=== RequirementsView Search & Navigation Tests ===");

// === Test 1: Empty search shows total count badge and standard search input ===
{
  const store = createMockStore(testDoc);
  const html = renderToStaticMarkup(
    React.createElement(RequirementsView, {
      requirementsStore: store,
      programIncrements: [],
    })
  );

  assert(html.includes('placeholder="Search requirements..."'), "search input is rendered");
  assert(html.includes("3 items"), "total count badge shows '3 items' when no search");
  assert(!html.includes("requirements-view__search-actions"), "search nav actions not rendered when search is empty");
}

// === Test 2: Active search shows match counter (e.g. 1 of 2), prev/next nav buttons, and clear button ===
{
  const store = createMockStore(testDoc);
  const html = renderToStaticMarkup(
    React.createElement(RequirementsView, {
      requirementsStore: store,
      programIncrements: [],
      initialSearch: "auth",
    })
  );

  assert(html.includes("requirements-view__search-actions"), "search actions container is rendered");
  assert(html.includes("1 of 2"), "search counter shows '1 of 2' matching items");
  assert(html.includes('aria-label="Previous match"'), "Previous match button is rendered");
  assert(html.includes('aria-label="Next match"'), "Next match button is rendered");
  assert(html.includes('aria-label="Clear search"'), "Clear search button is rendered");
  assert(html.includes("search-highlight"), "matching terms are highlighted");
  assert(html.includes("is-highlighted"), "active matched item is highlighted");
}

// === Test 3: Search with no results shows '0 of 0' counter and disabled nav buttons ===
{
  const store = createMockStore(testDoc);
  const html = renderToStaticMarkup(
    React.createElement(RequirementsView, {
      requirementsStore: store,
      programIncrements: [],
      initialSearch: "nonexistent",
    })
  );

  assert(html.includes("0 of 0"), "search counter shows '0 of 0' for no matches");
  assert(html.includes("disabled"), "nav buttons are disabled when 0 matches");
  assert(html.includes("No requirements match your search"), "empty match message displayed");
}

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
if (failures > 0) {
  throw new Error(`${failures} test(s) failed`);
}
