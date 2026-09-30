import { SvgShapeRenderer } from '../canvas/nodes/SvgShapeRenderer';
import { GeometryPicker } from '../canvas/GeometryPicker';
import type { LibraryManagerView } from './useLibraryManager';

/**
 * The form for adding a shape to the selected library, with a live preview.
 *
 * Moved unchanged from LibraryManagerModal.tsx; its props are exactly the
 * modal state it reads. Not memoized: it re-renders whenever the modal
 * does, as this markup did when it was inline, at the cost of one extra
 * function call per modal render.
 */
export function LibraryShapeForm({
  setIsAddingShape,
  newShapeName,
  setNewShapeName,
  newShapeCategory,
  setNewShapeCategory,
  newShapeGeomType,
  setNewShapeGeomType,
  newShapeSvgPath,
  setNewShapeSvgPath,
  newShapeWidth,
  setNewShapeWidth,
  newShapeHeight,
  setNewShapeHeight,
  newShapeColor,
  setNewShapeColor,
  newShapeIconId,
  setNewShapeIconId,
  handleCreateShape,
}: Pick<
  LibraryManagerView,
  | 'setIsAddingShape'
  | 'newShapeName'
  | 'setNewShapeName'
  | 'newShapeCategory'
  | 'setNewShapeCategory'
  | 'newShapeGeomType'
  | 'setNewShapeGeomType'
  | 'newShapeSvgPath'
  | 'setNewShapeSvgPath'
  | 'newShapeWidth'
  | 'setNewShapeWidth'
  | 'newShapeHeight'
  | 'setNewShapeHeight'
  | 'newShapeColor'
  | 'setNewShapeColor'
  | 'newShapeIconId'
  | 'setNewShapeIconId'
  | 'handleCreateShape'
>) {
  return (
    <form
      onSubmit={handleCreateShape}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <h4 style={{ margin: '0 0 8px 0' }}>Add Custom Shape</h4>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              marginBottom: 4,
              color: 'var(--chrome-text-dim)',
            }}
          >
            Shape Name *
          </label>
          <input
            type="text"
            required
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--chrome-bg)',
              border: '1px solid var(--chrome-border)',
              color: '#fff',
              borderRadius: 4,
            }}
            value={newShapeName}
            onChange={(e) => setNewShapeName(e.target.value)}
            placeholder="e.g. Edge Node"
          />
        </div>
        <div style={{ flex: 1 }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              marginBottom: 4,
              color: 'var(--chrome-text-dim)',
            }}
          >
            Category
          </label>
          <input
            type="text"
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--chrome-bg)',
              border: '1px solid var(--chrome-border)',
              color: '#fff',
              borderRadius: 4,
            }}
            value={newShapeCategory}
            onChange={(e) => setNewShapeCategory(e.target.value)}
            placeholder="e.g. Infrastructure"
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              marginBottom: 4,
              color: 'var(--chrome-text-dim)',
            }}
          >
            Geometry Type
          </label>
          <GeometryPicker value={newShapeGeomType} onChange={(type) => setNewShapeGeomType(type)} />
        </div>
        <div style={{ flex: 1 }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              marginBottom: 4,
              color: 'var(--chrome-text-dim)',
            }}
          >
            Shape Color
          </label>
          <input
            type="color"
            style={{
              width: '100%',
              height: 34,
              padding: '2px 4px',
              background: 'var(--chrome-bg)',
              border: '1px solid var(--chrome-border)',
              borderRadius: 4,
            }}
            value={newShapeColor}
            onChange={(e) => setNewShapeColor(e.target.value)}
          />
        </div>
      </div>
      {newShapeGeomType === 'path' && (
        <div>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              marginBottom: 4,
              color: 'var(--chrome-text-dim)',
            }}
          >
            SVG Path Data (d attribute)
          </label>
          <input
            type="text"
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--chrome-bg)',
              border: '1px solid var(--chrome-border)',
              color: '#fff',
              borderRadius: 4,
              fontFamily: 'monospace',
            }}
            value={newShapeSvgPath}
            onChange={(e) => setNewShapeSvgPath(e.target.value)}
          />
        </div>
      )}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              marginBottom: 4,
              color: 'var(--chrome-text-dim)',
            }}
          >
            Default Width
          </label>
          <input
            type="number"
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--chrome-bg)',
              border: '1px solid var(--chrome-border)',
              color: '#fff',
              borderRadius: 4,
            }}
            value={newShapeWidth}
            onChange={(e) => setNewShapeWidth(Number(e.target.value))}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              marginBottom: 4,
              color: 'var(--chrome-text-dim)',
            }}
          >
            Default Height
          </label>
          <input
            type="number"
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--chrome-bg)',
              border: '1px solid var(--chrome-border)',
              color: '#fff',
              borderRadius: 4,
            }}
            value={newShapeHeight}
            onChange={(e) => setNewShapeHeight(Number(e.target.value))}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              marginBottom: 4,
              color: 'var(--chrome-text-dim)',
            }}
          >
            Icon ID (optional)
          </label>
          <input
            type="text"
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--chrome-bg)',
              border: '1px solid var(--chrome-border)',
              color: '#fff',
              borderRadius: 4,
            }}
            value={newShapeIconId}
            onChange={(e) => setNewShapeIconId(e.target.value)}
            placeholder="e.g. Server"
          />
        </div>
      </div>
      {/* Live Preview */}
      <div
        style={{
          padding: '12px',
          background: 'var(--chrome-bg)',
          borderRadius: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--chrome-text-dim)', marginBottom: 8 }}>
          Shape Preview:
        </span>
        <div style={{ position: 'relative', width: newShapeWidth, height: newShapeHeight }}>
          <SvgShapeRenderer
            geometry={
              newShapeGeomType === 'circle'
                ? { type: 'circle' }
                : newShapeGeomType === 'rectangle'
                  ? { type: 'rectangle' }
                  : newShapeGeomType === 'diamond'
                    ? { type: 'diamond' }
                    : newShapeGeomType === 'cylinder'
                      ? { type: 'cylinder' }
                      : newShapeGeomType === 'cloud'
                        ? { type: 'cloud' }
                        : newShapeGeomType === 'actor'
                          ? { type: 'actor' }
                          : newShapeGeomType === 'document'
                            ? { type: 'document' }
                            : newShapeGeomType === 'hexagon'
                              ? { type: 'hexagon' }
                              : newShapeGeomType === 'parallelogram'
                                ? { type: 'parallelogram' }
                                : newShapeGeomType === 'path'
                                  ? { type: 'path', d: newShapeSvgPath }
                                  : { type: 'rounded-rectangle', radius: 8 }
            }
            width={newShapeWidth}
            height={newShapeHeight}
            color={newShapeColor}
            iconId={newShapeIconId || undefined}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              color: 'var(--chrome-text)',
            }}
          >
            {newShapeName || 'Preview'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="submit"
          style={{
            padding: '6px 14px',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Save Shape
        </button>
        <button
          type="button"
          onClick={() => setIsAddingShape(false)}
          style={{
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid var(--chrome-border)',
            color: 'var(--chrome-text-dim)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
