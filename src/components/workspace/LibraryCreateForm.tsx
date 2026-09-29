import type { LibraryManagerView } from './useLibraryManager';

/**
 * The form for creating a new custom library.
 *
 * Moved unchanged from LibraryManagerModal.tsx; its props are exactly the
 * modal state it reads. Not memoised: it re-renders whenever the modal
 * does, as this markup did when it was inline, at the cost of one extra
 * function call per modal render.
 */
export function LibraryCreateForm({
  setIsCreatingLib,
  newLibName,
  setNewLibName,
  newLibDesc,
  setNewLibDesc,
  newLibAuthor,
  setNewLibAuthor,
  newLibLicense,
  setNewLibLicense,
  handleCreateLibrary,
}: Pick<
  LibraryManagerView,
  | 'setIsCreatingLib'
  | 'newLibName'
  | 'setNewLibName'
  | 'newLibDesc'
  | 'setNewLibDesc'
  | 'newLibAuthor'
  | 'setNewLibAuthor'
  | 'newLibLicense'
  | 'setNewLibLicense'
  | 'handleCreateLibrary'
>) {
  return (
    <form
      onSubmit={handleCreateLibrary}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <h4 style={{ margin: '0 0 8px 0' }}>Create New Custom Library</h4>
      <div>
        <label
          style={{
            display: 'block',
            fontSize: 12,
            marginBottom: 4,
            color: 'var(--text-muted)',
          }}
        >
          Library Name *
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
          value={newLibName}
          onChange={(e) => setNewLibName(e.target.value)}
          placeholder="e.g. Company Architecture"
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
          Description
        </label>
        <textarea
          rows={2}
          style={{
            width: '100%',
            padding: '6px 8px',
            background: 'var(--bg-field)',
            border: '1px solid var(--border)',
            color: '#fff',
            borderRadius: 4,
          }}
          value={newLibDesc}
          onChange={(e) => setNewLibDesc(e.target.value)}
          placeholder="Describe the library contents..."
        />
      </div>
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
            Author / Team
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
            value={newLibAuthor}
            onChange={(e) => setNewLibAuthor(e.target.value)}
            placeholder="e.g. Core Engineering"
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
            License
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
            value={newLibLicense}
            onChange={(e) => setNewLibLicense(e.target.value)}
            placeholder="e.g. MIT, Internal"
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
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
          Create Library
        </button>
        <button
          type="button"
          onClick={() => setIsCreatingLib(false)}
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
