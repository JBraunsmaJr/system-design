import type {ReactNode} from 'react';
import {BringToFront, ChevronDown, ChevronUp, Lock, LockOpen, SendToBack} from 'lucide-react';
import {
    DEFAULT_EDGE_STROKE_WIDTH,
    EDGE_ROUTINGS,
    EDGE_STROKE_WIDTHS,
    EDGE_STYLE_GROUP_ORDER,
    EDGE_TYPES,
    STYLE_GROUP_LABELS,
} from '../../domain/canvas/edgeRegistry';
import type {EdgeRouting} from '../../domain/canvas/types';
import type {ZOrderCommand} from '../../domain/canvas/zOrder';
import {MIXED, type Mixed} from './mixedValue';

/**
 * Field building blocks shared by the single-item Inspector and the
 * multi-selection one (MultiSelectionInspector.tsx).
 */

export function Field({label, children}: { label: string; children: ReactNode }) {
    return (
        <label className="inspector__field">
            <span>{label}</span>
            {children}
        </label>
    );
}

// Shared by typed/group nodes, edges, and shapes - a color override with a
// "Reset" link that only appears once an override is actually set, so
// there's a clear way back to "just use the type's default color" without
// needing to manually match the exact default hex value.
//
// For a multi-selection, `mixed` says the items don't agree (the swatch then
// shows the first one's color), and `canReset` says at least one of them has
// an override to clear.
export function ColorField({
                               value,
                               defaultValue,
                               onChange,
                               label = 'Color',
                               mixed = false,
                               canReset,
                           }: {
    value: string | undefined;
    defaultValue: string;
    onChange: (color: string | undefined) => void;
    label?: string;
    mixed?: boolean;
    canReset?: boolean;
}) {
    const showReset = canReset ?? Boolean(value);
    return (
        <Field label={label}>
            <div className="color-field">
                <input
                    type="color"
                    value={value ?? defaultValue}
                    onChange={(e) => onChange(e.target.value)}
                />
                {mixed && <span className="inspector__mixed">Mixed</span>}
                {showReset && (
                    <button type="button" className="color-field__reset" onClick={() => onChange(undefined)}>
                        Reset
                    </button>
                )}
            </div>
        </Field>
    );
}

/**
 * A checkbox that can also show "some but not all" - used for flags across a
 * multi-selection. `indeterminate` is a DOM property with no HTML attribute,
 * so it's set through a ref callback rather than a prop.
 */
export function TriStateCheckbox({
                                     checked,
                                     label,
                                     onChange,
                                     title,
                                 }: {
    checked: Mixed<boolean>;
    label: ReactNode;
    onChange: (checked: boolean) => void;
    title?: string;
}) {
    return (
        <label className="inspector__checkbox" title={title}>
            <input
                type="checkbox"
                checked={checked === true}
                ref={(el) => {
                    if (el) el.indeterminate = checked === MIXED;
                }}
                // From mixed, a click locks/sets everything - the same thing every
                // other editor's tri-state checkbox does.
                onChange={(e) => onChange(checked === MIXED ? true : e.target.checked)}
            />
            <span>{label}</span>
        </label>
    );
}

/** "Locked" toggle - see ArchNodeData.locked. */
export function LockField({
                              locked,
                              onChange,
                          }: {
    locked: Mixed<boolean>;
    onChange: (locked: boolean) => void;
}) {
    return (
        <TriStateCheckbox
            checked={locked}
            onChange={onChange}
            title="A locked node can't be moved, resized or deleted until it's unlocked."
            label={
                <span className="inspector__lock-label">
          {locked === true ? <Lock size={12}/> : <LockOpen size={12}/>}
                    Locked
        </span>
            }
        />
    );
}

/**
 * Front/back controls for the current selection.
 *
 * Shown for every node type because any node can end up buried - the
 * reported case was a rectangle covering nodes, but a large node can
 * just as easily cover a small one. The commands themselves live in
 * App.tsx, since deciding what "in front" means needs every node's
 * geometry and the Inspector only sees the selected one.
 */
export function ZOrderControls({onCommand}: { onCommand: (command: ZOrderCommand) => void }) {
    return (
        <div className="inspector__z-order">
            <span className="inspector__z-order-label">Arrange</span>
            <div className="inspector__z-order-buttons">
                <button type="button" onClick={() => onCommand('back')} title="Send to back">
                    <SendToBack size={13}/>
                </button>
                <button type="button" onClick={() => onCommand('backward')} title="Send backward">
                    <ChevronDown size={13}/>
                </button>
                <button type="button" onClick={() => onCommand('forward')} title="Bring forward">
                    <ChevronUp size={13}/>
                </button>
                <button type="button" onClick={() => onCommand('front')} title="Bring to front">
                    <BringToFront size={13}/>
                </button>
            </div>
        </div>
    );
}

/** The edge type dropdown, grouped by style. `mixed` adds a placeholder for
 * a multi-selection whose edges aren't all one type. */
export function EdgeTypeSelect({
                                   value,
                                   onChange,
                                   mixed = false,
                               }: {
    value: string;
    onChange: (edgeType: string) => void;
    mixed?: boolean;
}) {
    return (
        <select
            value={mixed ? '' : value}
            onChange={(e) => {
                if (e.target.value) onChange(e.target.value);
            }}
        >
            {mixed && (
                <option value="" disabled>
                    Mixed
                </option>
            )}
            {EDGE_STYLE_GROUP_ORDER.map((group) => {
                const options = EDGE_TYPES.filter((t) => t.styleGroup === group);
                if (!options.length) return null;
                return (
                    <optgroup key={group} label={STYLE_GROUP_LABELS[group]}>
                        {options.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.menuLabel ?? t.label}
                            </option>
                        ))}
                    </optgroup>
                );
            })}
        </select>
    );
}

/**
 * Line thickness. Picking "Normal" clears the override rather than storing
 * the default's number, so the edge keeps following the default if it ever
 * changes. A value that isn't on the ladder (a file written by hand, say)
 * is still shown rather than silently snapped.
 */
export function EdgeStrokeWidthField({
                                         value,
                                         onChange,
                                         mixed = false,
                                     }: {
    value: number;
    onChange: (strokeWidth: number | undefined) => void;
    mixed?: boolean;
}) {
    const known = EDGE_STROKE_WIDTHS.some((w) => w.value === value);
    return (
        <Field label="Thickness">
            <select
                value={mixed ? '' : String(value)}
                onChange={(e) => {
                    if (e.target.value === '') return;
                    const next = Number(e.target.value);
                    onChange(next === DEFAULT_EDGE_STROKE_WIDTH ? undefined : next);
                }}
            >
                {mixed && (
                    <option value="" disabled>
                        Mixed
                    </option>
                )}
                {!mixed && !known && <option value={String(value)}>{value}px</option>}
                {EDGE_STROKE_WIDTHS.map((w) => (
                    <option key={w.value} value={String(w.value)}>
                        {w.label} ({w.value}px)
                    </option>
                ))}
            </select>
        </Field>
    );
}

/** Straight / orthogonal / curved. Orthogonal is the default, and stored as
 * absent for the same reason as thickness above. */
export function EdgeRoutingField({
                                     value,
                                     onChange,
                                     mixed = false,
                                 }: {
    value: EdgeRouting;
    onChange: (routing: EdgeRouting | undefined) => void;
    mixed?: boolean;
}) {
    return (
        <div className="inspector__field">
            <span>Routing</span>
            <div className="inspector__segmented" role="radiogroup" aria-label="Routing">
                {EDGE_ROUTINGS.map((r) => {
                    const active = !mixed && r.value === value;
                    return (
                        <button
                            key={r.value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={active ? 'is-active' : undefined}
                            onClick={() => onChange(r.value === 'orthogonal' ? undefined : r.value)}
                        >
                            {r.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
