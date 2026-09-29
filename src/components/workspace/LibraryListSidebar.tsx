import { Upload, Plus } from 'lucide-react';
import type { LibraryManagerView } from './useLibraryManager';

/**
 * The left sidebar: every installed library, with enable, import and create
 * controls.
 *
 * Moved unchanged from LibraryManagerModal.tsx; its props are exactly the
 * modal state it reads. Not memoized: it re-renders whenever the modal
 * does, as this markup did when it was inline, at the cost of one extra
 * function call per modal render.
 */
export function LibraryListSidebar({
  libraries,
  selectedLibId,
  setSelectedLibId,
  setIsCreatingLib,
  setIsAddingIcon,
  setIsAddingShape,
  fileInputRef,
  handleToggleLibrary,
  handleImportFile,
}: Pick<
  LibraryManagerView,
  | 'libraries'
  | 'selectedLibId'
  | 'setSelectedLibId'
  | 'setIsCreatingLib'
  | 'setIsAddingIcon'
  | 'setIsAddingShape'
  | 'fileInputRef'
  | 'handleToggleLibrary'
  | 'handleImportFile'
>) {
  return (
    <div
      style={{
        width: 260,
        borderRight: '1px solid var(--border, #2d3342)',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(0,0,0,0.1)',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          display: 'flex',
          gap: 6,
          borderBottom: '1px solid var(--border, #2d3342)',
        }}
      >
        <button
          type="button"
          className="btn-primary"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            fontSize: 12,
            padding: '6px 8px',
            borderRadius: 4,
            background: 'var(--accent, #5B7CFA)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
          }}
          onClick={() => {
            setIsCreatingLib(true);
            setIsAddingIcon(false);
            setIsAddingShape(false);
          }}
        >
          <Plus size={14} /> New Library
        </button>
        <button
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '6px 10px',
            fontSize: 12,
            borderRadius: 4,
            background: 'var(--bg-field, #252a36)',
            color: 'var(--text)',
            border: '1px solid var(--border, #2d3342)',
            cursor: 'pointer',
          }}
          title="Import Library (.json)"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={14} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleImportFile}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            padding: '4px 6px',
          }}
        >
          Built-in Taxonomy
        </div>
        <div
          style={{
            padding: '6px 8px',
            borderRadius: 4,
            fontSize: 13,
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>Core System Design</span>
          <span style={{ fontSize: 11 }}>18 shapes / 1000+ icons</span>
        </div>

        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            padding: '8px 6px 4px 6px',
          }}
        >
          Custom Libraries ({libraries.length})
        </div>
        {libraries.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 8px' }}>
            No custom libraries installed. Click "New Library" or "Import" to add one.
          </div>
        ) : (
          libraries.map((lib) => {
            const isSelected = lib.library.id === selectedLibId;
            return (
              <div
                key={lib.library.id}
                style={{
                  padding: '6px 8px',
                  borderRadius: 4,
                  fontSize: 13,
                  cursor: 'pointer',
                  background: isSelected ? 'var(--bg-active, #313848)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 2,
                }}
                onClick={() => {
                  setSelectedLibId(lib.library.id);
                  setIsCreatingLib(false);
                  setIsAddingIcon(false);
                  setIsAddingShape(false);
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    overflow: 'hidden',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={lib.enabled !== false}
                    onChange={() => handleToggleLibrary(lib.library.id, lib.enabled)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {lib.library.name}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {lib.shapes.length}s / {lib.icons.length}i
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
