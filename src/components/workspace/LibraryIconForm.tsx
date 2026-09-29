import { sanitizeSvg } from '../../domain/canvas/iconRegistry';
import { IconRenderer } from '../canvas/IconRenderer';
import type { LibraryManagerView } from './useLibraryManager';

/**
 * The form for adding an SVG icon to the selected library, with a live
 * preview.
 *
 * Moved unchanged from LibraryManagerModal.tsx; its props are exactly the
 * modal state it reads. Not memoised: it re-renders whenever the modal
 * does, as this markup did when it was inline, at the cost of one extra
 * function call per modal render.
 */
export function LibraryIconForm({
  setIsAddingIcon,
  newIconName,
  setNewIconName,
  newIconCategory,
  setNewIconCategory,
  newIconTags,
  setNewIconTags,
  newIconSvg,
  setNewIconSvg,
  handleCreateIcon,
}: Pick<
  LibraryManagerView,
  | 'setIsAddingIcon'
  | 'newIconName'
  | 'setNewIconName'
  | 'newIconCategory'
  | 'setNewIconCategory'
  | 'newIconTags'
  | 'setNewIconTags'
  | 'newIconSvg'
  | 'setNewIconSvg'
  | 'handleCreateIcon'
>) {
  return (
    <form onSubmit={handleCreateIcon} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h4 style={{ margin: '0 0 8px 0' }}>Add Custom SVG Icon</h4>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              marginBottom: 4,
              color: 'var(--text-muted)',
            }}
          >
            Icon Name *
          </label>
          <input
            type="text"
            required
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--bg-field)',
              border: '1px solid var(--border)',
              color: '#fff',
              borderRadius: 4,
            }}
            value={newIconName}
            onChange={(e) => setNewIconName(e.target.value)}
            placeholder="e.g. Auth Gateway"
          />
        </div>
        <div style={{ flex: 1 }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              marginBottom: 4,
              color: 'var(--text-muted)',
            }}
          >
            Category
          </label>
          <input
            type="text"
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--bg-field)',
              border: '1px solid var(--border)',
              color: '#fff',
              borderRadius: 4,
            }}
            value={newIconCategory}
            onChange={(e) => setNewIconCategory(e.target.value)}
            placeholder="e.g. Security"
          />
        </div>
      </div>
      <div>
        <label
          style={{
            display: 'block',
            fontSize: 12,
            marginBottom: 4,
            color: 'var(--text-muted)',
          }}
        >
          Search Tags (comma separated)
        </label>
        <input
          type="text"
          style={{
            width: '100%',
            padding: '6px 8px',
            background: 'var(--bg-field)',
            border: '1px solid var(--border)',
            color: '#fff',
            borderRadius: 4,
          }}
          value={newIconTags}
          onChange={(e) => setNewIconTags(e.target.value)}
          placeholder="e.g. auth, security, lock, login"
        />
      </div>
      <div>
        <label
          style={{
            display: 'block',
            fontSize: 12,
            marginBottom: 4,
            color: 'var(--text-muted)',
          }}
        >
          SVG Code *
        </label>
        <textarea
          rows={4}
          required
          style={{
            width: '100%',
            padding: '6px 8px',
            background: 'var(--bg-field)',
            border: '1px solid var(--border)',
            color: '#fff',
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: 12,
          }}
          value={newIconSvg}
          onChange={(e) => setNewIconSvg(e.target.value)}
        />
      </div>
      {/* Preview */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          background: 'var(--bg-field)',
          borderRadius: 4,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Preview:</span>
        <div
          style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconRenderer
            iconDefinition={{
              id: 'preview-new-icon',
              name: newIconName || 'Preview',
              version: 1,
              source: {
                type: 'svg',
                data: sanitizeSvg(newIconSvg),
              },
            }}
            size={24}
          />
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
          Save Icon
        </button>
        <button
          type="button"
          onClick={() => setIsAddingIcon(false)}
          style={{
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
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
