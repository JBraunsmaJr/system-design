import {type CSSProperties, useState} from 'react';
import {Check, Minus} from 'lucide-react';
import type {Node} from '@xyflow/react';
import {getItemType} from '../../domain/requirements/requirementsRegistry';
import type {RequirementsDocument} from '../../domain/requirements/requirementsTypes';
import type {ArchNodeData} from '../../domain/canvas/types';
import {HighlightedText, HighlightedTitle} from '../../common/components/highlight/HighlightText';

/** How many matches to list - the search narrows it, not scrolling. */
const MAX_RESULTS = 30;

/**
 * The context menu's "Link requirement" submenu: search requirements and
 * toggle them on every right-clicked node at once.
 *
 * A requirement linked to all of the nodes shows a check; linked to only
 * some of them, a dash. Clicking one that isn't on all of them links it to
 * the rest; clicking one that is unlinks it from all of them - the same
 * rule as a tri-state checkbox.
 *
 * Not built on RequirementLinker, whose dropdown is portaled and closes on
 * outside clicks: inside a context menu, which itself closes on any
 * outside click, that would make the two fight over every click. This
 * stays open while toggling, so several requirements can be linked in a row.
 */
export function RequirementLinkPanel({
                                         nodes,
                                         requirements,
                                         onUpdateNodes,
                                         style,
                                     }: {
    nodes: Node<ArchNodeData>[];
    requirements: RequirementsDocument;
    onUpdateNodes: (updates: { id: string; patch: Partial<ArchNodeData> }[]) => void;
    style?: CSSProperties;
}) {
    const [query, setQuery] = useState('');
    const linkedOf = (n: Node<ArchNodeData>) => n.data.linkedRequirementIds ?? [];
    const linkCount = (itemId: string) => nodes.filter((n) => linkedOf(n).includes(itemId)).length;

    const q = query.trim().toLowerCase();
    const matches = requirements.items
        .filter(
            (item) =>
                q === '' || item.id.toLowerCase().includes(q) || item.title.toLowerCase().includes(q),
        )
        // Linked ones first, so what's already there is visible without searching.
        .sort((a, b) => Number(linkCount(b.id) > 0) - Number(linkCount(a.id) > 0))
        .slice(0, MAX_RESULTS);

    const toggle = (itemId: string) => {
        const onAll = linkCount(itemId) === nodes.length;
        onUpdateNodes(
            onAll
                ? nodes.map((n) => ({
                    id: n.id,
                    patch: {linkedRequirementIds: linkedOf(n).filter((id) => id !== itemId)},
                }))
                : nodes
                    .filter((n) => !linkedOf(n).includes(itemId))
                    .map((n) => ({
                        id: n.id,
                        patch: {linkedRequirementIds: [...linkedOf(n), itemId]},
                    })),
        );
    };

    return (
        <div
            className="requirement-link-panel"
            style={style}
            role="dialog"
            aria-label="Link requirement"
            onClick={(e) => e.stopPropagation()}
        >
            <input
                autoFocus
                className="requirement-linker__search"
                placeholder="Search requirements..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
            />
            <div className="requirement-link-panel__list">
                {matches.map((item) => {
                    const count = linkCount(item.id);
                    const state = count === 0 ? 'none' : count === nodes.length ? 'all' : 'some';
                    const type = getItemType(requirements, item.typeId);
                    return (
                        <button
                            key={item.id}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
                            className={`requirement-link-panel__option is-${state}`}
                            onClick={() => toggle(item.id)}
                            title={
                                state === 'all'
                                    ? 'Unlink from all'
                                    : state === 'some'
                                        ? `Linked to ${count} of ${nodes.length} - link to all`
                                        : 'Link'
                            }
                        >
              <span className="requirement-link-panel__check" aria-hidden="true">
                {state === 'all' && <Check size={11}/>}
                  {state === 'some' && <Minus size={11}/>}
              </span>
                            <span
                                className="requirement-linker__option-id"
                                style={{color: type?.color ?? 'var(--chrome-text-dim)'}}
                            >
                <HighlightedText text={item.id} search={query.trim()}/>
              </span>
                            <HighlightedTitle
                                className="requirement-linker__option-title"
                                text={item.title || '(untitled)'}
                                search={query.trim()}
                            />
                        </button>
                    );
                })}
                {matches.length === 0 && (
                    <p className="requirement-linker__empty">
                        {requirements.items.length === 0
                            ? 'No requirements exist yet.'
                            : 'No matching requirements.'}
                    </p>
                )}
            </div>
        </div>
    );
}
