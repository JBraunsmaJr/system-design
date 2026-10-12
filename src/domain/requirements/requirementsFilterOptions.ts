import {REQUIREMENT_STATUSES} from './requirementsRegistry';
import type {ProgramIncrement} from '../timeline/programIncrements';
import type {TeamDocument} from '../timeline/teamTypes';

/** One choice in a filter menu. */
export interface FilterMenuOption {
    value: string;
    label: string;
    color?: string;
    /** A short secondary line, e.g. a sprint's PI. */
    detail?: string;
}

export function statusOptions(): FilterMenuOption[] {
    return REQUIREMENT_STATUSES.map((s) => ({value: s.id, label: s.label, color: s.color}));
}

export function memberOptions(team: TeamDocument | undefined): FilterMenuOption[] {
    return (team?.members ?? []).map((m) => ({
        value: m.id,
        label: m.name || 'Unnamed',
        color: m.avatarColor,
        detail: m.role,
    }));
}

export function sprintOptions(programIncrements: ProgramIncrement[]): FilterMenuOption[] {
    return programIncrements.flatMap((pi) =>
        pi.sprints.map((s) => ({value: s.id, label: s.name || 'Unnamed sprint', detail: pi.name})),
    );
}
