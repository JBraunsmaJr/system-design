import type { ScenarioDefinition } from "./types";
import { setupFixture, resetCounters, settleCanvas, dragCoordinates } from "./helpers";

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
    await resetCounters(page);

    // Locate node-50 (or any standard node)
    const nodeEl = page.locator('.react-flow__node[data-id="node-50"]');
    const box = await nodeEl.boundingBox();
    if (!box) {
      throw new Error("Could not find bounding box for node-50");
    }

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await dragCoordinates(page, startX, startY, 200, 0, 20);
  },
};

export const dragHubNodeScenario: ScenarioDefinition = {
  id: "drag-hub-node",
  name: "Drag Hub Node (High Degree)",
  fixture: "large",
  description: "Drag hub node with >=25 attached edges 200px. Protects edge re-render fan-out.",
  run: async (page) => {
    await setupFixture(page, "large");
    await resetCounters(page);

    const nodeEl = page.locator('.react-flow__node[data-id="node-0"]');
    const box = await nodeEl.boundingBox();
    if (!box) {
      throw new Error("Could not find bounding box for hub node-0");
    }
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await dragCoordinates(page, startX, startY, 200, 0, 20);
  },
};

export const dragGroupScenario: ScenarioDefinition = {
  id: "drag-group",
  name: "Drag Group Boundary",
  fixture: "grouped",
  description: "Drag a boundary containing >=10 child nodes 150px. Protects group child geometry caching.",
  run: async (page) => {
    await setupFixture(page, "grouped");
    await resetCounters(page);

    // Target the top edge hit area of group-0
    const groupHitEl = page.locator('.react-flow__node[data-id="group-0"] .group-node__edge-hit--top');
    const box = await groupHitEl.boundingBox();
    if (!box) {
      throw new Error("Could not find bounding box for group-0 top edge hit area");
    }
    const startX = box.x + box.width / 2;
    const startY = box.y + 10;

    await dragCoordinates(page, startX, startY, 150, 0, 15);
  },
};

export const marqueeSelectScenario: ScenarioDefinition = {
  id: "marquee-select",
  name: "Marquee Select Multiple Nodes",
  fixture: "large",
  description: "Marquee-select ~100 nodes across canvas. Protects selection change fan-out.",
  run: async (page) => {
    await setupFixture(page, "large");
    // Switch to select mode via UI or keyboard
    const selectBtn = page.locator('button[aria-label="Select mode"]');
    if (await selectBtn.isVisible()) {
      await selectBtn.click();
      await settleCanvas(page, 2);
    }

    await resetCounters(page);
    // Drag marquee selection over wide canvas region
    await dragCoordinates(page, 100, 100, 600, 400, 20);
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

    // Drag canvas background
    await dragCoordinates(page, 500, 400, 500, 0, 50);
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
    // Select edge-hub-1 which carries waypoints
    await page.evaluate(`
      (() => {
        const perfObj = window.__PERF__;
        if (perfObj && typeof perfObj.setSelectedEdges === "function") {
          perfObj.setSelectedEdges(["edge-hub-1"]);
        }
      })()
    `);
    await settleCanvas(page, 2);

    await resetCounters(page);

    const handleEl = page.locator(".typed-edge__waypoint").first();
    const box = await handleEl.boundingBox();
    if (!box) {
      throw new Error("Could not find bounding box for waypoint handle");
    }
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await dragCoordinates(page, startX, startY, 150, 0, 15);
  },
};

export const createWaypointScenario: ScenarioDefinition = {
  id: "create-waypoint",
  name: "Create Waypoint Bend",
  fixture: "large",
  description: "Drag an insertion handle 100px into a new bend. Protects insertion drag path.",
  run: async (page) => {
    await setupFixture(page, "large");
    await page.evaluate(`
      (() => {
        const perfObj = window.__PERF__;
        if (perfObj && typeof perfObj.setSelectedEdges === "function") {
          perfObj.setSelectedEdges(["edge-hub-1"]);
        }
      })()
    `);
    await settleCanvas(page, 2);

    await resetCounters(page);

    const insertHandleEl = page.locator(".typed-edge__insert-dot").first();
    const box = await insertHandleEl.boundingBox();
    if (!box) {
      throw new Error("Could not find bounding box for waypoint insert handle");
    }
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await dragCoordinates(page, startX, startY, 100, 50, 10);
  },
};

export const reconnectEdgeScenario: ScenarioDefinition = {
  id: "reconnect-edge",
  name: "Reconnect Edge Endpoint",
  fixture: "large",
  description: "Drag edge endpoint to another node. Protects reconnection validation path.",
  run: async (page) => {
    await setupFixture(page, "large");
    await page.evaluate(`
      (() => {
        const perfObj = window.__PERF__;
        if (perfObj && typeof perfObj.setSelectedEdges === "function") {
          perfObj.setSelectedEdges(["edge-hub-1"]);
        }
      })()
    `);
    await settleCanvas(page, 2);

    await resetCounters(page);

    // Locate the reconnect handle for the selected edge
    const reconnectHandle = page.locator(".react-flow__edgeupdater").first();
    const handleBox = await reconnectHandle.boundingBox();
    if (!handleBox) {
      throw new Error("Could not find bounding box for edge reconnect handle");
    }

    // Reconnect endpoint to node-10
    const targetNode = page.locator('.react-flow__node[data-id="node-10"]');
    const targetBox = await targetNode.boundingBox();
    if (!targetBox) {
      throw new Error("Could not find bounding box for target node-10");
    }

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    const targetX = targetBox.x + targetBox.width / 2;
    const targetY = targetBox.y + targetBox.height / 2;

    await dragCoordinates(page, startX, startY, targetX - startX, targetY - startY, 10);
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
    await settleCanvas(page, 3);

    // Drill out
    await page.evaluate(`
      (() => {
        const perfObj = window.__PERF__;
        if (perfObj && typeof perfObj.setPath === "function") {
          perfObj.setPath([]);
        }
      })()
    `);
    await settleCanvas(page, 3);
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
