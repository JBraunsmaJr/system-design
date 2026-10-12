import {useState} from 'react';
import {ChevronDown, ChevronRight, NotebookPen, Target} from 'lucide-react';
import type {PlanningDetails, PlanningDetailsPatch,} from '../../domain/timeline/programIncrements';
import {AutoResizeTextarea} from '../srd/AutoResizeTextarea';

interface PlanningDetailsFieldsProps {
    details: PlanningDetails;
    /** "PI" or "Sprint" - used in placeholders and labels. */
    scope: 'PI' | 'Sprint';
    onChange: (patch: PlanningDetailsPatch) => void;
    /** Start with the notes textarea open. Defaults to open only when notes
     * already exist. */
    initiallyShowNotes?: boolean;
}

/**
 * Goal + notes editor shared by the PI card and each sprint row.
 *
 * The goal is a single line, always visible: it is the thing people need
 * to read at a glance. Notes are longer and collapsed by default unless
 * they already have content.
 */
export function PlanningDetailsFields({
                                          details,
                                          scope,
                                          onChange,
                                          initiallyShowNotes,
                                      }: PlanningDetailsFieldsProps) {
    const [showNotes, setShowNotes] = useState(initiallyShowNotes ?? Boolean(details.notes));
    const hasNotes = Boolean(details.notes);

    return (
        <div className="planning-details">
            <div className="planning-details__goal-row">
                <Target size={13} className="planning-details__icon" aria-hidden="true"/>
                <input
                    className="planning-details__goal"
                    value={details.goal ?? ''}
                    placeholder={`${scope} goal - what should this ${scope.toLowerCase()} achieve?`}
                    aria-label={`${scope} goal`}
                    onChange={(e) => onChange({goal: e.target.value})}
                />
                <button
                    type="button"
                    className={`planning-details__notes-toggle${hasNotes ? ' has-notes' : ''}`}
                    onClick={() => setShowNotes((v) => !v)}
                    aria-expanded={showNotes}
                    title={
                        showNotes ? `Hide ${scope.toLowerCase()} notes` : `Show ${scope.toLowerCase()} notes`
                    }
                >
                    {showNotes ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                    <NotebookPen size={12}/>
                    Notes{hasNotes && !showNotes ? ' •' : ''}
                </button>
            </div>
            {showNotes && (
                <AutoResizeTextarea
                    className="planning-details__notes"
                    value={details.notes ?? ''}
                    placeholder={`${scope} notes - context, risks, decisions, retro points…`}
                    onChange={(notes) => onChange({notes})}
                />
            )}
        </div>
    );
}
