import type {ReactNode} from 'react';
import {
    AlignCenterHorizontal,
    AlignCenterVertical,
    AlignEndHorizontal,
    AlignEndVertical,
    AlignHorizontalSpaceBetween,
    AlignStartHorizontal,
    AlignStartVertical,
    AlignVerticalSpaceBetween,
    Maximize2,
    MoveHorizontal,
    MoveVertical,
} from 'lucide-react';
import type {ArrangeCommand} from '../../domain/canvas/arrange';

interface ArrangeButton {
    command: ArrangeCommand;
    label: string;
    icon: ReactNode;
}

const ALIGN: ArrangeButton[] = [
    {
        command: {kind: 'align', edge: 'left'},
        label: 'Align left',
        icon: <AlignStartVertical size={14}/>,
    },
    {
        command: {kind: 'align', edge: 'center'},
        label: 'Align centers horizontally',
        icon: <AlignCenterVertical size={14}/>,
    },
    {
        command: {kind: 'align', edge: 'right'},
        label: 'Align right',
        icon: <AlignEndVertical size={14}/>,
    },
    {
        command: {kind: 'align', edge: 'top'},
        label: 'Align top',
        icon: <AlignStartHorizontal size={14}/>,
    },
    {
        command: {kind: 'align', edge: 'middle'},
        label: 'Align centers vertically',
        icon: <AlignCenterHorizontal size={14}/>,
    },
    {
        command: {kind: 'align', edge: 'bottom'},
        label: 'Align bottom',
        icon: <AlignEndHorizontal size={14}/>,
    },
];

const DISTRIBUTE: ArrangeButton[] = [
    {
        command: {kind: 'distribute', axis: 'horizontal'},
        label: 'Distribute horizontally (equal gaps)',
        icon: <AlignHorizontalSpaceBetween size={14}/>,
    },
    {
        command: {kind: 'distribute', axis: 'vertical'},
        label: 'Distribute vertically (equal gaps)',
        icon: <AlignVerticalSpaceBetween size={14}/>,
    },
];

const MATCH: ArrangeButton[] = [
    {
        command: {kind: 'matchSize', dimension: 'width'},
        label: 'Match width (to the widest)',
        icon: <MoveHorizontal size={14}/>,
    },
    {
        command: {kind: 'matchSize', dimension: 'height'},
        label: 'Match height (to the tallest)',
        icon: <MoveVertical size={14}/>,
    },
    {
        command: {kind: 'matchSize', dimension: 'both'},
        label: 'Match size (to the largest)',
        icon: <Maximize2 size={14}/>,
    },
];

/**
 * Align / distribute / match size buttons, shared by the multi-selection
 * Inspector and the context menu's "Align & distribute" submenu. A button
 * that would do nothing for the current selection (distributing two nodes,
 * matching the size of nodes that size to their content) is disabled with
 * the reason in its tooltip.
 */
export function ArrangeControls({
                                    canRun,
                                    onRun,
                                }: {
    canRun: (command: ArrangeCommand) => boolean;
    onRun: (command: ArrangeCommand) => void;
}) {
    const row = (title: string, buttons: ArrangeButton[], whyDisabled: string) => (
        <div className="arrange-controls__row">
            <span className="arrange-controls__label">{title}</span>
            <div className="arrange-controls__buttons">
                {buttons.map((b) => {
                    const enabled = canRun(b.command);
                    return (
                        <button
                            key={b.label}
                            type="button"
                            title={enabled ? b.label : `${b.label} - ${whyDisabled}`}
                            aria-label={b.label}
                            disabled={!enabled}
                            onClick={() => onRun(b.command)}
                        >
                            {b.icon}
                        </button>
                    );
                })}
            </div>
        </div>
    );
    return (
        <div className="arrange-controls">
            {row('Align', ALIGN, 'select at least two unlocked nodes')}
            {row('Distribute', DISTRIBUTE, 'select at least three unlocked nodes')}
            {row(
                'Match size',
                MATCH,
                'needs two nodes, one of them resizable (component nodes size to their content)',
            )}
        </div>
    );
}
