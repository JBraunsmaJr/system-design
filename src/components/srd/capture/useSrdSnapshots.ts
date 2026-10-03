import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { projectCanvasElements } from '../../../app/canvasProjection';
import { populatedLevelCounts } from '../../../collab/stores/diagramStore';
import {
  captureDiagramSnapshot,
  captureNodeSubsetSnapshot,
} from '../../../domain/canvas/imageExport';
import type { ArchEdgeData, ArchNodeData } from '../../../domain/canvas/types';
import { srdSnapshotCache } from '../../../domain/srd/srdSnapshotCache';
import { planSrdSnapshots, type SrdSnapshotTarget } from '../../../domain/srd/srdSnapshotPlan';
import type { SrdDocumentState, SrdSnapshotFraming } from '../../../domain/srd/srdTypes';
import type { CaptureLevel, RenderedLevel, SrdCaptureSurfaceProps } from './SrdCaptureSurface';

/**
 * Pinned so a snapshot looks the same on every screen, rather than following
 * each device's pixel ratio. 2 keeps text crisp in print.
 */
const CAPTURE_PIXEL_RATIO = 2;
const ITEM_SNAPSHOT_SIZE = { width: 1200, height: 600, padding: 0.06 };
/** Batches a burst of edits into one round of captures. */
const CAPTURE_DEBOUNCE_MS = 200;
/** A level that never reports rendered (it should) is captured anyway
 * rather than stalling every snapshot behind it. */
const RENDER_TIMEOUT_MS = 4000;

export interface SrdSnapshotImage {
  dataUrl: string;
  /** The framing the image was rendered with. */
  framing: SrdSnapshotFraming;
}

export interface SrdSnapshots {
  /** Props for the one SrdCaptureSurface the SRD view renders (offscreen). */
  surfaceProps: SrdCaptureSurfaceProps;
  /** Rendered images by target key (an item id, or the diagram key). */
  images: ReadonlyMap<string, SrdSnapshotImage>;
  /** Snapshots the document needs. */
  total: number;
  /** Of those, how many are still to be rendered. */
  pending: number;
  isCapturing: boolean;
  /** Discards the given snapshots' images (all, when omitted) and renders
   * them again. */
  refresh: (keys?: readonly string[]) => void;
}

interface UseSrdSnapshotsOptions {
  diagramSnapshot: { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] };
  itemIds: readonly string[];
  framing: SrdDocumentState['framing'];
}

const NO_IDS: readonly string[] = [];
const EMPTY_MAP = new Map<never, never>();

/** The level a target shows, drawn as the editor's canvas would draw it. */
function levelFor(
  target: SrdSnapshotTarget,
  diagram: UseSrdSnapshotsOptions['diagramSnapshot'],
  levelCounts: ReadonlyMap<string, number>,
): CaptureLevel {
  const { nodes, edges } = projectCanvasElements({
    diagramSnapshot: diagram,
    subDiagramLevelCounts: levelCounts,
    path: target.path,
    selectedNodeIds: NO_IDS,
    selectedEdgeIds: NO_IDS,
    measuredDimensions: EMPTY_MAP,
    inFlight: EMPTY_MAP,
    peerInFlight: EMPTY_MAP,
    edgeInFlight: EMPTY_MAP,
    peerEdgeInFlight: EMPTY_MAP,
    peerEdgeLabels: EMPTY_MAP,
  });
  return { key: target.levelKey, nodes, edges };
}

function captureTarget(target: SrdSnapshotTarget, rendered: RenderedLevel) {
  const nodes = rendered.getNodes();
  // JPEG: about three times cheaper for the PDF engine to embed than a PNG
  // with transparency, on every render. Captures are opaque, so nothing is
  // lost to it but a little fidelity.
  const capture = { root: rendered.root, pixelRatio: CAPTURE_PIXEL_RATIO, format: 'jpeg' as const };
  if (target.kind === 'diagram') return captureDiagramSnapshot(nodes, 'jpeg', capture);
  return captureNodeSubsetSnapshot(nodes, target.nodeIds, {
    ...ITEM_SNAPSHOT_SIZE,
    ...capture,
    panOffset: { x: target.framing.offsetX, y: target.framing.offsetY },
    zoomMultiplier: target.framing.zoom,
  });
}

/**
 * The SRD's snapshots, rendered on this device from the document's content
 * and framing (Phase 1c). Nothing here is stored in the document.
 *
 * Images come from a fingerprint-keyed cache, so an unchanged snapshot is
 * available immediately - after leaving and returning to the view too. Missing
 * ones are rendered one at a time on an offscreen surface, those sharing the
 * level on screen first, so a level renders once for all of its snapshots.
 */
export function useSrdSnapshots({
  diagramSnapshot,
  itemIds,
  framing,
}: UseSrdSnapshotsOptions): SrdSnapshots {
  // Planning hashes level content; deferring keeps typing elsewhere in the
  // view responsive while a large diagram is re-planned.
  const diagram = useDeferredValue(diagramSnapshot);
  const targets = useMemo(
    () =>
      planSrdSnapshots({
        nodes: diagram.nodes,
        edges: diagram.edges,
        itemIds,
        state: { framing },
      }),
    [diagram, itemIds, framing],
  );
  const levelCounts = useMemo(() => populatedLevelCounts(diagram.nodes), [diagram.nodes]);

  // Bumped whenever the cache gains or loses an entry this view cares
  // about, so `images` is re-read from it.
  const [cacheVersion, setCacheVersion] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [level, setLevel] = useState<CaptureLevel | null>(null);
  // Fingerprints that failed to render, not retried until refreshed - a
  // capture that fails once fails the same way again.
  // State, not a ref: recording a failure must update `missing` below.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const markFailed = useCallback(
    (fingerprint: string) => setFailed((prev) => new Set(prev).add(fingerprint)),
    [],
  );
  const busyRef = useRef(false);
  const renderedRef = useRef<RenderedLevel | null>(null);
  const waitersRef = useRef(new Map<string, Array<(rendered: RenderedLevel) => void>>());

  const onRendered = useCallback((rendered: RenderedLevel) => {
    renderedRef.current = rendered;
    const waiters = waitersRef.current.get(rendered.key);
    waitersRef.current.delete(rendered.key);
    for (const resolve of waiters ?? []) resolve(rendered);
  }, []);

  const waitForLevel = useCallback((key: string): Promise<RenderedLevel | null> => {
    if (renderedRef.current?.key === key) return Promise.resolve(renderedRef.current);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(renderedRef.current), RENDER_TIMEOUT_MS);
      const list = waitersRef.current.get(key) ?? [];
      list.push((rendered) => {
        clearTimeout(timer);
        resolve(rendered);
      });
      waitersRef.current.set(key, list);
    });
  }, []);

  const images = useMemo(() => {
    const result = new Map<string, SrdSnapshotImage>();
    for (const target of targets) {
      const dataUrl = srdSnapshotCache.get(target.fingerprint);
      if (dataUrl) result.set(target.key, { dataUrl, framing: target.framing });
    }
    return result;
    // cacheVersion is the signal that the cache changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, cacheVersion]);

  const missing = useMemo(
    () => targets.filter((t) => !images.has(t.key) && !failed.has(t.fingerprint)),
    [targets, images, failed],
  );

  // Capture loop: one snapshot per pass; each completion bumps cacheVersion,
  // which re-runs this effect for the next.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (busyRef.current || missing.length === 0) return;
    const timer = setTimeout(async () => {
      if (busyRef.current || !mountedRef.current) return;
      const currentLevel = renderedRef.current?.key;
      const target = missing.find((t) => t.levelKey === currentLevel) ?? missing[0];
      busyRef.current = true;
      setIsCapturing(true);
      try {
        if (renderedRef.current?.key !== target.levelKey) {
          setLevel(levelFor(target, diagram, levelCounts));
        }
        const rendered = await waitForLevel(target.levelKey);
        if (!mountedRef.current) return;
        // Text is drawn in web fonts; capturing before they load would
        // render the fallback font into the image.
        await document.fonts?.ready;
        const dataUrl = rendered ? await captureTarget(target, rendered) : undefined;
        if (dataUrl) srdSnapshotCache.set(target.fingerprint, dataUrl);
        else markFailed(target.fingerprint);
      } catch (err) {
        console.warn('SRD snapshot capture failed:', target.key, err);
        markFailed(target.fingerprint);
      } finally {
        busyRef.current = false;
        if (mountedRef.current) {
          setIsCapturing(false);
          setCacheVersion((v) => v + 1);
        }
      }
    }, CAPTURE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [missing, diagram, levelCounts, waitForLevel, markFailed]);

  // The surface's level is released once nothing is left to render, so an
  // idle view does not keep a second canvas mounted.
  useEffect(() => {
    if (missing.length === 0 && !busyRef.current) {
      setLevel(null);
      renderedRef.current = null;
    }
  }, [missing.length]);

  const refresh = useCallback(
    (keys?: readonly string[]) => {
      const wanted = keys ? new Set(keys) : null;
      const refreshed = targets.filter((t) => !wanted || wanted.has(t.key));
      for (const target of refreshed) srdSnapshotCache.delete(target.fingerprint);
      // A refreshed snapshot is tried again even if it failed before.
      setFailed((prev) => {
        const next = new Set(prev);
        for (const target of refreshed) next.delete(target.fingerprint);
        return next;
      });
      setCacheVersion((v) => v + 1);
    },
    [targets],
  );

  const surfaceProps = useMemo(() => ({ level, onRendered }), [level, onRendered]);

  return {
    surfaceProps,
    images,
    total: targets.length,
    pending: missing.length,
    isCapturing,
    refresh,
  };
}
