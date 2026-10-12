import type {Scenario, ScenarioStep} from './types';

/**
 * Copying scenarios and steps, so a variant of a walkthrough ("the same
 * login flow, but the token is expired") starts from the original instead
 * of being rebuilt by hand.
 *
 * Pure: ids come from the caller, nothing here touches the document. A
 * copy shares no arrays with its original, so editing one never changes
 * the other - the stores treat scenarios as plain values, and a shared
 * focus array would be an aliasing bug waiting for the first in-place
 * edit.
 */

/** "Login" -> "Login (copy)" -> "Login (copy 2)" ..., skipping any name
 * already taken in `existing`. A title that is already a copy is copied
 * from its base name, so copying "Login (copy)" gives "Login (copy 2)"
 * rather than "Login (copy) (copy)". */
export function copyTitle(title: string, existing: Iterable<string>): string {
    const taken = new Set(existing);
    const base = title.replace(/\s*\(copy(?: \d+)?\)$/, '').trim() || title.trim();
    const first = base ? `${base} (copy)` : '(copy)';
    if (!taken.has(first)) return first;
    for (let n = 2; ; n++) {
        const candidate = base ? `${base} (copy ${n})` : `(copy ${n})`;
        if (!taken.has(candidate)) return candidate;
    }
}

/** A step with a new id and its own arrays; everything else as it was. */
export function cloneStep(step: ScenarioStep, newId: string): ScenarioStep {
    return {
        ...step,
        id: newId,
        path: [...step.path],
        focusNodeIds: [...step.focusNodeIds],
        focusEdgeIds: [...step.focusEdgeIds],
    };
}

/**
 * A copy of `scenario` with a fresh id for it and for every step, titled
 * so it can be told apart from the original in the scenario list.
 */
export function duplicateScenario(
    scenario: Scenario,
    existingTitles: Iterable<string>,
    ids: { scenarioId: string; nextStepId: () => string },
): Scenario {
    return {
        ...scenario,
        id: ids.scenarioId,
        title: copyTitle(scenario.title, existingTitles),
        steps: scenario.steps.map((step) => cloneStep(step, ids.nextStepId())),
    };
}

/**
 * Inserts a copy of `scenarios`' scenario `scenarioId` directly after it.
 * Returns the list unchanged when there is no such scenario.
 */
export function withScenarioDuplicated(
    scenarios: Scenario[],
    scenarioId: string,
    ids: { scenarioId: string; nextStepId: () => string },
): Scenario[] {
    const index = scenarios.findIndex((s) => s.id === scenarioId);
    if (index === -1) return scenarios;
    const copy = duplicateScenario(
        scenarios[index],
        scenarios.map((s) => s.title),
        ids,
    );
    return [...scenarios.slice(0, index + 1), copy, ...scenarios.slice(index + 1)];
}

/**
 * Inserts a copy of step `stepId` directly after it in its scenario, so
 * "the next step is this one plus one more box" is a duplicate and a
 * click rather than reselecting everything. Returns the list unchanged
 * when the scenario or step doesn't exist.
 */
export function withStepDuplicated(
    scenarios: Scenario[],
    scenarioId: string,
    stepId: string,
    newStepId: string,
): Scenario[] {
    return scenarios.map((sc) => {
        if (sc.id !== scenarioId) return sc;
        const index = sc.steps.findIndex((st) => st.id === stepId);
        if (index === -1) return sc;
        const original = sc.steps[index];
        const copy = cloneStep(original, newStepId);
        // An untitled step shows as "Step N", so its copy stays untitled and
        // picks up its own number from its new position.
        if (original.title.trim()) {
            copy.title = copyTitle(
                original.title,
                sc.steps.map((st) => st.title),
            );
        }
        return {
            ...sc,
            steps: [...sc.steps.slice(0, index + 1), copy, ...sc.steps.slice(index + 1)],
        };
    });
}
