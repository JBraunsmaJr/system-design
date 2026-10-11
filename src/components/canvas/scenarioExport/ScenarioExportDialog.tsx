import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Edge, Node} from '@xyflow/react';
import {FileImage, FileText, Film, Images} from 'lucide-react';
import {BaseModal} from '../../../common/components/modal/BaseModal';
import {Button} from '../../../common/components/button/Button';
import {getBreadcrumbLabelsFlat} from '../../../collab/stores/diagramStore';
import type {ArchEdgeData, ArchNodeData, Scenario} from '../../../domain/canvas/types';
import {
    buildTimeline,
    DEFAULT_EXPORT_OPTIONS,
    planScenarioFrames,
    type ScenarioExportFormat,
    type ScenarioExportOptions,
} from '../../../domain/scenarioExport/scenarioExportPlan';
import {SrdCaptureSurface} from '../../srd/capture/SrdCaptureSurface';
import {layoutFor, loadCaptionFonts, readExportTheme} from './composeFrame';
import {ExportCancelledError, useScenarioStepCapture} from './useScenarioStepCapture';

export interface ScenarioExportDialogProps {
    scenario: Scenario;
    diagramSnapshot: { nodes: Node<ArchNodeData>[]; edges: Edge<ArchEdgeData>[] };
    documentTitle: string;
    onClose: () => void;
}

const FORMATS: {
    id: ScenarioExportFormat;
    label: string;
    detail: string;
    icon: typeof FileText;
}[] = [
    {id: 'pdf', label: 'PDF slides', detail: 'One slide per step', icon: FileText},
    {id: 'png', label: 'PNG images', detail: 'One image per step, zipped', icon: Images},
    {id: 'gif', label: 'Animated GIF', detail: 'Plays inline in docs and wikis', icon: FileImage},
    {id: 'mp4', label: 'MP4 video', detail: 'For slides and sharing', icon: Film},
];

const PACE_CHOICES: { value: ScenarioExportOptions['secondsPerStep']; label: string }[] = [
    {value: 'auto', label: 'Auto (by narration length)'},
    {value: 3, label: '3 seconds'},
    {value: 5, label: '5 seconds'},
    {value: 8, label: '8 seconds'},
];

type Status =
    | { kind: 'idle' }
    | { kind: 'working'; phase: string; done: number; total: number }
    | { kind: 'done'; fileName: string; note?: string }
    | { kind: 'error'; message: string };

function canEncodeVideo(): boolean {
    return typeof VideoEncoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
}

function formatDuration(seconds: number): string {
    const s = Math.round(seconds);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Exports a scenario as PDF slides, a PNG per step, an animated GIF or an MP4.
 * Steps are rendered offscreen exactly as Presentation Mode shows them; the
 * user's canvas never moves. Runs entirely in the browser with bundled code.
 */
export default function ScenarioExportDialog({
                                                 scenario,
                                                 diagramSnapshot,
                                                 documentTitle,
                                                 onClose,
                                             }: ScenarioExportDialogProps) {
    const [options, setOptions] = useState<ScenarioExportOptions>(DEFAULT_EXPORT_OPTIONS);
    const [status, setStatus] = useState<Status>({kind: 'idle'});
    const abortRef = useRef<AbortController | null>(null);
    const {surfaceProps, captureSteps} = useScenarioStepCapture();
    const [videoSupported] = useState(canEncodeVideo);

    // The diagram as it was when the dialog opened: an export in progress is
    // not disturbed by edits arriving from collaborators.
    const [diagram] = useState(diagramSnapshot);
    const plans = useMemo(
        () =>
            planScenarioFrames(scenario, diagram.nodes, diagram.edges, (path) => {
                const labels = getBreadcrumbLabelsFlat(diagram.nodes, path);
                return labels.length === 0 ? 'Root' : labels.join(' › ');
            }),
        [scenario, diagram],
    );
    // A step whose sub-diagram is gone is reported once, as that, rather than
    // also counting each of its elements as deleted.
    const missing = plans.reduce((sum, p) => sum + (p.levelExists ? p.missingCount : 0), 0);
    const deletedLevels = plans.filter((p) => !p.levelExists).length;
    const isVideo = options.format === 'gif' || options.format === 'mp4';
    const duration = useMemo(() => {
        const timeline = buildTimeline(plans, options);
        const last = timeline[timeline.length - 1];
        return last ? last.start + last.duration : 0;
    }, [plans, options]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const set = <K extends keyof ScenarioExportOptions>(key: K, value: ScenarioExportOptions[K]) =>
        setOptions((prev) => ({...prev, [key]: value}));

    const run = useCallback(async () => {
        const controller = new AbortController();
        abortRef.current = controller;
        const {signal} = controller;
        setStatus({kind: 'working', phase: 'Preparing', done: 0, total: plans.length});
        try {
            const theme = readExportTheme();
            await loadCaptionFonts(theme);
            const measuring = document.createElement('canvas').getContext('2d')!;
            // PDF slides always carry their captions, as text.
            const captions = options.format === 'pdf' || options.captions;
            const layout = layoutFor(measuring, plans, captions, theme);
            const steps = await captureSteps(diagram, plans, layout, {
                signal,
                onProgress: (done, total) =>
                    setStatus({kind: 'working', phase: 'Rendering steps', done, total}),
            });
            try {
                const {encodeScenario, downloadBlob} = await import('./exportScenario');
                const phase =
                    options.format === 'pdf'
                        ? 'Building PDF'
                        : options.format === 'png'
                            ? 'Saving images'
                            : 'Encoding';
                const result = await encodeScenario({
                    steps,
                    layout,
                    theme,
                    options,
                    scenarioTitle: scenario.title,
                    documentTitle,
                    signal,
                    onProgress: (done, total) => setStatus({kind: 'working', phase, done, total}),
                });
                if (signal.aborted) throw new ExportCancelledError();
                downloadBlob(result.blob, result.fileName);
                setStatus({kind: 'done', fileName: result.fileName, note: result.note});
            } finally {
                for (const s of steps) s.diagram?.close();
            }
        } catch (err) {
            if (err instanceof ExportCancelledError || signal.aborted) {
                setStatus({kind: 'idle'});
                return;
            }
            console.error('Scenario export failed:', err);
            setStatus({
                kind: 'error',
                message: err instanceof Error ? err.message : 'The export failed.',
            });
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, [captureSteps, diagram, documentTitle, options, plans, scenario.title]);

    const working = status.kind === 'working';
    const cancel = () => abortRef.current?.abort();
    const close = () => {
        cancel();
        onClose();
    };

    const footer = working ? (
        <Button variant="secondary" onClick={cancel}>
            Cancel
        </Button>
    ) : (
        <>
            <Button variant="secondary" onClick={close}>
                {status.kind === 'done' ? 'Close' : 'Cancel'}
            </Button>
            <Button
                variant="primary"
                onClick={run}
                disabled={plans.length === 0 || (options.format === 'mp4' && !videoSupported)}
            >
                {status.kind === 'done' ? 'Export again' : 'Export'}
            </Button>
        </>
    );

    return (
        <>
            <BaseModal
                isOpen
                onClose={close}
                title={`Export “${scenario.title || 'Scenario'}”`}
                className="scenario-export"
                width={520}
                maxWidth="calc(100vw - 32px)"
                closeOnBackdropClick={!working}
                footer={footer}
            >
                <fieldset className="scenario-export__formats" disabled={working}>
                    <legend className="scenario-export__label">Format</legend>
                    {FORMATS.map((f) => {
                        const unsupported = f.id === 'mp4' && !videoSupported;
                        const Icon = f.icon;
                        return (
                            <label
                                key={f.id}
                                className={`scenario-export__format${options.format === f.id ? ' is-selected' : ''}${
                                    unsupported ? ' is-unsupported' : ''
                                }`}
                                title={unsupported ? "This browser doesn't support video encoding" : undefined}
                            >
                                <input
                                    type="radio"
                                    name="scenario-export-format"
                                    value={f.id}
                                    checked={options.format === f.id}
                                    disabled={unsupported}
                                    onChange={() => set('format', f.id)}
                                />
                                <Icon size={16} aria-hidden="true"/>
                                <span className="scenario-export__format-text">
                  <span className="scenario-export__format-name">{f.label}</span>
                  <span className="scenario-export__format-detail">
                    {unsupported ? 'Not supported in this browser' : f.detail}
                  </span>
                </span>
                            </label>
                        );
                    })}
                </fieldset>

                <fieldset className="scenario-export__options" disabled={working}>
                    <legend className="scenario-export__label">Options</legend>
                    {options.format === 'pdf' ? (
                        <label className="scenario-export__check">
                            <input
                                type="checkbox"
                                checked={options.titleSlide}
                                onChange={(e) => set('titleSlide', e.target.checked)}
                            />
                            Start with a title slide listing the steps
                        </label>
                    ) : (
                        <label className="scenario-export__check">
                            <input
                                type="checkbox"
                                checked={options.captions}
                                onChange={(e) => set('captions', e.target.checked)}
                            />
                            Show the step title and narration
                        </label>
                    )}
                    {isVideo && (
                        <>
                            <label className="scenario-export__field">
                                <span>Time per step</span>
                                <select
                                    value={String(options.secondsPerStep)}
                                    onChange={(e) =>
                                        set(
                                            'secondsPerStep',
                                            e.target.value === 'auto' ? 'auto' : Number(e.target.value),
                                        )
                                    }
                                >
                                    {PACE_CHOICES.map((c) => (
                                        <option key={String(c.value)} value={String(c.value)}>
                                            {c.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="scenario-export__check">
                                <input
                                    type="checkbox"
                                    checked={options.crossfade}
                                    onChange={(e) => set('crossfade', e.target.checked)}
                                />
                                Fade between steps
                            </label>
                        </>
                    )}
                </fieldset>

                <p className="scenario-export__summary">
                    {plans.length} {plans.length === 1 ? 'step' : 'steps'}
                    {isVideo && ` · about ${formatDuration(duration)}`}
                    {options.format === 'gif' && ' · 960×540'}
                    {(options.format === 'mp4' || options.format === 'png') && ' · 1920×1080'}
                </p>
                {(missing > 0 || deletedLevels > 0) && (
                    <p className="scenario-export__warning">
                        {deletedLevels > 0 &&
                            `${deletedLevels} ${deletedLevels === 1 ? 'step points' : 'steps point'} at a sub-diagram that no longer exists. `}
                        {missing > 0 &&
                            `${missing} highlighted ${missing === 1 ? 'element has' : 'elements have'} since been deleted and will be skipped.`}
                    </p>
                )}

                <div className="scenario-export__status" aria-live="polite">
                    {status.kind === 'working' && (
                        <>
                            <div className="scenario-export__status-text">
                                {status.phase}
                                {status.total > 1 &&
                                    ` ${Math.min(status.done + 1, status.total)} of ${status.total}`}
                                …
                            </div>
                            <progress
                                className="scenario-export__progress"
                                value={status.total > 0 ? status.done : undefined}
                                max={status.total || 1}
                            />
                        </>
                    )}
                    {status.kind === 'done' && (
                        <div className="scenario-export__status-text">
                            Saved <strong>{status.fileName}</strong>.{status.note && ` ${status.note}`}
                        </div>
                    )}
                    {status.kind === 'error' && (
                        <div className="scenario-export__error" role="alert">
                            {status.message}
                        </div>
                    )}
                </div>
            </BaseModal>
            <SrdCaptureSurface {...surfaceProps} />
        </>
    );
}
