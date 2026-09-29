import { Download, Plus, Trash2 } from 'lucide-react';
import { globalAssetLibraryManager } from '../../domain/storage/assetLibrary';
import { IconRenderer } from '../canvas/IconRenderer';
import { SvgShapeRenderer } from '../canvas/nodes/SvgShapeRenderer';
import type { LibraryManagerView } from './useLibraryManager';

/**
 * The selected library: its details, export and delete, and its shapes and
 * icons.
 *
 * Moved unchanged from LibraryManagerModal.tsx; its props are exactly the
 * modal state it reads. Not memoised: it re-renders whenever the modal
 * does, as this markup did when it was inline, at the cost of one extra
 * function call per modal render.
 */
export function LibraryDetails({
  setIsAddingIcon,
  setIsAddingShape,
  selectedLib,
  handleDeleteLibrary,
}: Pick<LibraryManagerView, 'setIsAddingIcon' | 'setIsAddingShape' | 'handleDeleteLibrary'> & {
  selectedLib: NonNullable<LibraryManagerView['selectedLib']>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Library details header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '1px solid var(--border)',
          paddingBottom: 12,
        }}
      >
        <div>
          <h3 style={{ margin: '0 0 4px 0', fontSize: 18 }}>{selectedLib.library.name}</h3>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {selectedLib.library.description || 'No description provided.'}
          </div>
          {(selectedLib.library.author || selectedLib.library.license) && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {selectedLib.library.author && <span>Author: {selectedLib.library.author} • </span>}
              {selectedLib.library.license && <span>License: {selectedLib.library.license}</span>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 10px',
              fontSize: 12,
              background: 'var(--bg-field)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            onClick={() => globalAssetLibraryManager.exportLibrary(selectedLib.library.id)}
            title="Export Library"
          >
            <Download size={13} /> Export
          </button>
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 10px',
              fontSize: 12,
              background: 'rgba(240, 87, 140, 0.2)',
              color: '#f0578c',
              border: '1px solid rgba(240, 87, 140, 0.4)',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            onClick={() => handleDeleteLibrary(selectedLib.library.id)}
            title="Delete Library"
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>

      {/* Library Shapes Section */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>
            Shapes ({selectedLib.shapes.length})
          </span>
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              fontSize: 11,
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            onClick={() => setIsAddingShape(true)}
          >
            <Plus size={12} /> Add Shape
          </button>
        </div>
        {selectedLib.shapes.length === 0 ? (
          <div
            style={{
              padding: 12,
              background: 'rgba(0,0,0,0.1)',
              borderRadius: 4,
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            No custom shapes in this library yet. Click "Add Shape" to create one.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: 8,
            }}
          >
            {selectedLib.shapes.map((s) => (
              <div
                key={s.id}
                style={{
                  padding: 8,
                  background: 'var(--bg-field)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <div style={{ width: 60, height: 40, position: 'relative' }}>
                  <SvgShapeRenderer
                    geometry={s.geometry}
                    width={60}
                    height={40}
                    color={s.defaults.color || '#5B7CFA'}
                    iconId={s.iconId}
                  />
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    width: '100%',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Library Icons Section */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>Icons ({selectedLib.icons.length})</span>
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              fontSize: 11,
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
            onClick={() => setIsAddingIcon(true)}
          >
            <Plus size={12} /> Add Icon
          </button>
        </div>
        {selectedLib.icons.length === 0 ? (
          <div
            style={{
              padding: 12,
              background: 'rgba(0,0,0,0.1)',
              borderRadius: 4,
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            No custom icons in this library yet. Click "Add Icon" to create one.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
              gap: 6,
            }}
          >
            {selectedLib.icons.map((icon) => (
              <div
                key={icon.id}
                style={{
                  padding: 6,
                  background: 'var(--bg-field)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
                title={icon.name}
              >
                <IconRenderer iconDefinition={icon} size={22} />
                <span
                  style={{
                    fontSize: 10,
                    textAlign: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    width: '100%',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {icon.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
