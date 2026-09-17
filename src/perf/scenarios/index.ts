import type { ScenarioDefinition } from "./types";
import {
  setupFixture,
  resetCounters,
  settleCanvas,
  dragCoordinates,
  recordViewportBeforeDrag,
  assertViewportTranslated,
  findEmptyCanvasPoint,
  frameNodes,
  pointOnTarget,
  assertGestureCommitted,
  findGrabbableUpdater,
} from "./helpers";

const nodeSelector = (id: string) => `.react-flow__node[data-id="${id}"]`;

/**
 * Nodes whose bounding box covers edge-hub-1 (node-0 -> node-1) and both of
 * its fixture waypoints, which sit near y 410-470 - so every edge scenario
 * frames the same region.
 */
const EDGE_HUB_1_REGION = ["node-0", "node-1", "node-62"];

/** Reconnect target. Inside EDGE_HUB_1_REGION, so the whole gesture is on
 * screen at zoom 1; node-10 (the previous target) is 2200px away. */
const RECONNECT_TARGET = "node-42";

async function selectEdgeHub1(page: Parameters<ScenarioDefinition["run"]>[0]) {
  await page.evaluate(`
    (() => {
      const perfObj = window.__PERF__;
      if (perfObj && typeof perfObj.setSelectedEdges === "function") {
        perfObj.setSelectedEdges(["edge-hub-1"]);
      }
    })()
  `);
  await settleCanvas(page, 2);
}

export const idleScenario: ScenarioDefinition = {
  id: "idle",
  name: "Idle at Rest",
  fixture: "large",
  description: "Mount, settle, then do nothing for 2 seconds. Protects against runaway effects and render loops.",
  run: async (page) => {
    await setupFixture(page, "large");
    await resetCounters(page);

    // Idle for 2000ms
    await page.waitForTimeout(2000);
    await settleCanvas(page, 2);
  },
};

export const dragNodeScenario: ScenarioDefinition = {
  id: "drag-node",
  name: "Drag Single Node",
  fixture: "large",
  description: "Drag one node 200px in 20 discrete 10px steps. Protects single-node render isolation.",
  run: async (page) => {
    await setupFixture(page, "large");
    await frameNodes(page, ["node-50"]);
    const start = await pointOnTarget(page, nodeSelector("node-50"));
    await resetCounters(page);

    await dragCoordinates(page, start.x, start.y, 200, 0, 20);
    await assertGestureCommitted(page, "Dragging node-50");
  },
};

export const dragHubNodeScenario: ScenarioDefinition = {
  id: "drag-hub-node",
  name: "Drag Hub Node (High Degree)",
  fixture: "large",
  description: "Drag hub node with >=25 attached edges 200px. Protects edge re-render fan-out.",
  run: async (page) => {
    await setupFixture(page, "large");
    await frameNodes(page, ["node-0"]);
    const start = await pointOnTarget(page, nodeSelector("node-0"));
    await resetCounters(page);

    await dragCoordinates(page, start.x, start.y, 200, 0, 20);
    await assertGestureCommitted(page, "Dragging hub node-0");
  },
};

export const dragGroupScenario: ScenarioDefinition = {
  id: "drag-group",
  name: "Drag Group Boundary",
  fixture: "grouped",
  description: "Drag a boundary containing >=10 child nodes 150px. Protects group child geometry caching.",
  run: async (page) => {
    await setupFixture(page, "grouped");
    await frameNodes(page, ["group-0"]);
    // The top edge hit area is what drags a group boundary.
    const start = await pointOnTarget(page, `${nodeSelector("group-0")} .group-node__edge-hit--top`);
    await resetCounters(page);

    await dragCoordinates(page, start.x, start.y, 150, 0, 15);
    await assertGestureCommitted(page, "Dragging group-0");
  },
};

export const marqueeSelectScenario: ScenarioDefinition = {
  id: "marquee-select",
  name: "Marquee Select Multiple Nodes",
  fixture: "large",
  description: "Marquee-select ~100 nodes across canvas. Protects selection change fan-out.",
  run: async (page) => {
    await setupFixture(page, "large");
    // Fit the whole fixture so a 600x400 marquee covers a large share of it.
    await frameNodes(page, ["node-0", "node-399"]);

    // The toggle is titled by its CURRENT mode. The old selector looked for an
    // aria-label that does not exist and skipped the click when it was not
    // found, so this scenario was measuring a pan, not a selection.
    const toggle = page.locator('.react-flow__controls button[title^="Pan mode"]');
    await toggle.click();
    await page.locator('.react-flow__controls button[title^="Select mode"]').waitFor();
    await settleCanvas(page, 2);

    // Start from the first genuinely empty pane point near the top-left, so
    // the marquee has room to extend right and down. Fixed offsets land on
    // floating UI (breadcrumb, panels) depending on layout.
    const region = await page.evaluate(() => {
      const el = document.querySelector(".react-flow__pane");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      for (let y = r.top + 20; y < r.top + 240; y += 10) {
        for (let x = r.left + 20; x < r.left + 240; x += 10) {
          const hit = document.elementFromPoint(x, y);
          if (hit && hit.classList.contains("react-flow__pane")) {
            return { x, y, right: r.right, bottom: r.bottom };
          }
        }
      }
      return null;
    });
    if (!region) throw new Error("No empty canvas pane point near the top-left to start a marquee from");
    const start = { x: region.x, y: region.y };
    const width = Math.min(600, region.right - start.x - 30);
    const height = Math.min(400, region.bottom - start.y - 30);

    await resetCounters(page);
    await dragCoordinates(page, start.x, start.y, width, height, 20);

    const selected = await page.$$eval(".react-flow__node.selected", (els) => els.length);
    if (selected < 20) {
      throw new Error(`Marquee selected ${selected} nodes; expected a large share of the fixture.`);
    }
  },
};

export const panScenario: ScenarioDefinition = {
  id: "pan",
  name: "Pan Viewport",
  fixture: "large",
  description: "Pan the viewport 500px in 50 discrete 10px steps. Viewport transforms must not re-render nodes.",
  run: async (page) => {
    await setupFixture(page, "large");
    await resetCounters(page);

    // Drag canvas background. Verified afterwards: a pan that silently
    // delivers fewer steps renders less and reads as an improvement.
    // Must start on empty pane: a drag beginning on a node drags the node,
    // which is what this scenario was silently doing before.
    const origin = await findEmptyCanvasPoint(page);
    await recordViewportBeforeDrag(page);
    await dragCoordinates(page, origin.x, origin.y, 500, 0, 50);
    await assertViewportTranslated(page, 500, 0);
  },
};

export const zoomScenario: ScenarioDefinition = {
  id: "zoom",
  name: "Zoom Viewport In and Out",
  fixture: "large",
  description: "Zoom out two steps and back. Protects zoom-dependent rendering paths.",
  run: async (page) => {
    await setupFixture(page, "large");
    await resetCounters(page);

    await page.mouse.move(500, 400);
    // Zoom out
    await page.mouse.wheel(0, 300);
    await settleCanvas(page, 2);
    // Zoom in back
    await page.mouse.wheel(0, -300);
    await settleCanvas(page, 3);
  },
};

export const dragWaypointScenario: ScenarioDefinition = {
  id: "drag-waypoint",
  name: "Drag Waypoint Bend",
  fixture: "large",
  description: "Drag existing edge waypoint 150px in 15 steps. Protects waypoint coalescing and routing.",
  run: async (page) => {
    await setupFixture(page, "large");
    await frameNodes(page, EDGE_HUB_1_REGION);
    await selectEdgeHub1(page);
    const start = await pointOnTarget(page, ".typed-edge__waypoint");
    await resetCounters(page);

    await dragCoordinates(page, start.x, start.y, 150, 0, 15);
    await assertGestureCommitted(page, "Dragging a waypoint of edge-hub-1");
  },
};

export const createWaypointScenario: ScenarioDefinition = {
  id: "create-waypoint",
  name: "Create Waypoint Bend",
  fixture: "large",
  description: "Drag an insertion handle 100px into a new bend. Protects insertion drag path.",
  run: async (page) => {
    await setupFixture(page, "large");
    await frameNodes(page, EDGE_HUB_1_REGION);
    await selectEdgeHub1(page);
    const start = await pointOnTarget(page, ".typed-edge__insert-dot");
    await resetCounters(page);

    await dragCoordinates(page, start.x, start.y, 100, 50, 10);
    await assertGestureCommitted(page, "Creating a waypoint on edge-hub-1");
  },
};

export const reconnectEdgeScenario: ScenarioDefinition = {
  id: "reconnect-edge",
  name: "Reconnect Edge Endpoint",
  fixture: "large",
  description: "Drag edge endpoint to another node. Protects reconnection validation path.",
  run: async (page) => {
    await setupFixture(page, "large");
    await frameNodes(page, EDGE_HUB_1_REGION);
    await selectEdgeHub1(page);

    // Some edge's endpoint updater - see findGrabbableUpdater for why not a
    // specific one. assertGestureCommitted below proves a reconnect happened.
    const start = await findGrabbableUpdater(page);
    // Released over a connection HANDLE, not the node body: React Flow only
    // completes a reconnect within connectionRadius of a handle, so a drop on
    // the middle of a node (what this scenario used to do) connects nothing.
    const target = await page.evaluate((sel) => {
      const handle = document.querySelector(sel);
      if (!handle) return null;
      const r = handle.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, `${nodeSelector(RECONNECT_TARGET)} .react-flow__handle`);
    if (!target) throw new Error(`${RECONNECT_TARGET} has no connection handle to reconnect onto`);
    await resetCounters(page);

    await dragCoordinates(page, start.x, start.y, target.x - start.x, target.y - start.y, 10);
    await assertGestureCommitted(page, `Reconnecting an edge endpoint to ${RECONNECT_TARGET}`);
  },
};

export const drillInOutScenario: ScenarioDefinition = {
  id: "drill-in-out",
  name: "Drill In and Out Sub-Diagram",
  fixture: "nested",
  description: "Drill into nested sub-diagram and back to root. Protects path filtering and camera fit.",
  run: async (page) => {
    await setupFixture(page, "nested");
    await resetCounters(page);

    // Drill in
    await page.evaluate(`
      (() => {
        const perfObj = window.__PERF__;
        if (perfObj && typeof perfObj.setPath === "function") {
          perfObj.setPath(["node-0"]);
        }
      })()
    `);
    await settleCanvas(page, 2);

    // Drill out
    await page.evaluate(`
      (() => {
        const perfObj = window.__PERF__;
        if (perfObj && typeof perfObj.setPath === "function") {
          perfObj.setPath([]);
        }
      })()
    `);
    await settleCanvas(page, 2);
  },
};

export const remoteBurstScenario: ScenarioDefinition = {
  id: "remote-burst",
  name: "Remote Yjs Update Burst (Idle Local)",
  fixture: "large",
  description: "Apply 120 remote Yjs updates at ~60Hz while idle locally (PERF-S-2). Protects remote change ingestion.",
  run: async (page) => {
    await setupFixture(page, "large");
    await resetCounters(page);

    // Drive 120 real Yjs updates from a secondary doc inside browser context
    await page.evaluate(`
      (async () => {
        const perfObj = window.__PERF__;
        const Y = window.Y || (perfObj ? perfObj.Y : null);
        if (!Y || !perfObj) return;

        const appDoc = new Y.Doc();
        const sourceDoc = new Y.Doc();
        perfObj.startCollabSessionWithDoc(appDoc);

        sourceDoc.on("update", (update) => {
          Y.applyUpdate(appDoc, update);
        });

        const nodesMap = sourceDoc.getMap("nodes");
        const nodeOrder = sourceDoc.getArray("nodeOrder");

        for (let i = 0; i < 120; i++) {
          sourceDoc.transact(() => {
            const targetId = "node-" + (i % 20);
            let m = nodesMap.get(targetId);
            if (m) {
              m.set("position", { x: 50 + i * 2, y: 50 + (i % 10) * 5 });
            } else {
              m = new Y.Map();
              m.set("type", "typed");
              m.set("position", { x: 100, y: 100 });
              m.set("label", "Remote Node " + i);
              m.set("nodeType", "microservice");
              m.set("properties", {});
              m.set("tags", []);
              m.set("parentPath", []);
              nodesMap.set(targetId, m);
              nodeOrder.push([targetId]);
            }
          });
          await new Promise((r) => requestAnimationFrame(r));
        }
      })()
    `);

    await settleCanvas(page, 3);
  },
};

export const remoteDuringDragScenario: ScenarioDefinition = {
  id: "remote-during-drag",
  name: "Remote Yjs Updates During Active Local Drag",
  fixture: "large",
  description: "Apply 120 remote Yjs updates while actively dragging a local node 200px. Protects worst-case collaborative throughput.",
  run: async (page) => {
    await setupFixture(page, "large");
    await page.evaluate(`
      (() => {
        const perfObj = window.__PERF__;
        const Y = window.Y || (perfObj ? perfObj.Y : null);
        if (!Y || !perfObj) return;

        window.__perfAppDoc = new Y.Doc();
        window.__perfSourceDoc = new Y.Doc();
        perfObj.startCollabSessionWithDoc(window.__perfAppDoc);

        window.__perfSourceDoc.on("update", (update) => {
          Y.applyUpdate(window.__perfAppDoc, update);
        });

        const nodesMap = window.__perfSourceDoc.getMap("nodes");
        const nodeOrder = window.__perfSourceDoc.getArray("nodeOrder");

        // Seed initial nodes
        window.__perfSourceDoc.transact(() => {
          for (let k = 0; k <= 50; k++) {
            const m = new Y.Map();
            m.set("type", "typed");
            m.set("position", { x: 150 + (k % 8) * 120, y: 100 + Math.floor(k / 8) * 90 });
            m.set("label", "Node " + k);
            m.set("nodeType", "microservice");
            m.set("properties", {});
            m.set("tags", []);
            m.set("parentPath", []);
            nodesMap.set("node-" + k, m);
            nodeOrder.push(["node-" + k]);
          }
        });
      })()
    `);
    await settleCanvas(page, 2);

    await resetCounters(page);

    // Start remote updates in background while driving mouse drag
    const updatePromise = page.evaluate(`
      (async () => {
        const sourceDoc = window.__perfSourceDoc;
        if (!sourceDoc) return;
        const nodesMap = sourceDoc.getMap("nodes");

        for (let i = 0; i < 120; i++) {
          sourceDoc.transact(() => {
            const targetId = "node-" + ((i % 10) + 20);
            const m = nodesMap.get(targetId);
            if (m) {
              m.set("position", { x: 100 + i * 2, y: 100 + i });
            }
          });
          await new Promise((r) => requestAnimationFrame(r));
        }
      })()
    `);

    // Simultaneously perform drag on node-50
    const nodeEl = page.locator('.react-flow__node[data-id="node-50"]');
    const box = await nodeEl.boundingBox();
    if (!box) {
      throw new Error("Could not find bounding box for node-50");
    }
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await dragCoordinates(page, startX, startY, 200, 0, 20);
    await updatePromise;
    await settleCanvas(page, 3);
  },
};

export const ALL_SCENARIOS: ScenarioDefinition[] = [
  idleScenario,
  dragNodeScenario,
  dragHubNodeScenario,
  dragGroupScenario,
  marqueeSelectScenario,
  panScenario,
  zoomScenario,
  dragWaypointScenario,
  createWaypointScenario,
  reconnectEdgeScenario,
  drillInOutScenario,
  remoteBurstScenario,
  remoteDuringDragScenario,
];
