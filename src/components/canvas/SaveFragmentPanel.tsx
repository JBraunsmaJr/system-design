import {type CSSProperties, useState} from 'react';
import {PackagePlus} from 'lucide-react';
import {MAX_FRAGMENT_NAME_LENGTH} from '../../domain/canvas/diagramFragments';

interface SaveFragmentPanelProps {
    /** What the name field starts with - e.g. the single selected node's label. */
    defaultName: string;
    /** How many nodes were right-clicked, for the explanation line. */
    nodeCount: number;
    onSave: (name: string) => void;
    onClose: () => void;
    style?: CSSProperties;
}

/**
 * The right-click menu's "Save as fragment" submenu: a name and a Save
 * button. A blank name is allowed - the library picks one (see
 * suggestFragmentName).
 */
export function SaveFragmentPanel({
                                      defaultName,
                                      nodeCount,
                                      onSave,
                                      onClose,
                                      style,
                                  }: SaveFragmentPanelProps) {
    const [name, setName] = useState(defaultName);
    const save = () => onSave(name);

    return (
        <div
            className="save-fragment-panel"
            role="dialog"
            aria-label="Save as fragment"
            style={style}
            onClick={(e) => e.stopPropagation()}
        >
            <label className="save-fragment-panel__field">
                <span className="save-fragment-panel__label">Fragment name</span>
                <input
                    className="save-fragment-panel__input"
                    autoFocus
                    value={name}
                    maxLength={MAX_FRAGMENT_NAME_LENGTH}
                    placeholder="e.g. Auth service + DB"
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            save();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            onClose();
                        }
                    }}
                />
            </label>
            <p className="save-fragment-panel__hint">
                Saves {nodeCount === 1 ? 'this node' : `these ${nodeCount} nodes`}, the connections between
                them and anything inside them to <strong>Fragments</strong> in the palette, ready to drag
                into any document in this browser.
            </p>
            <button type="button" className="save-fragment-panel__save" onClick={save}>
                <PackagePlus size={13}/> Save fragment
            </button>
        </div>
    );
}
