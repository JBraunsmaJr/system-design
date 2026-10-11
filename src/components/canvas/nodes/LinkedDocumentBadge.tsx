import {FileText} from 'lucide-react';
import {linkedDocumentHref, linkedDocumentLabel, normalizeLinkedDocument,} from '../../../domain/canvas/documentLinks';

/**
 * The on-canvas end of a cross-document link: a small chip on a node that
 * opens the linked document in a new tab, so following "Shared auth" to
 * the auth platform's document never loses your place in this one.
 *
 * A plain link rather than a callback through CanvasContext: it needs
 * nothing from App, and a new callback reaching every node is exactly
 * what the canvas performance rules (src/app/README.md) guard against.
 * The href is computed when the chip renders; the page URL it builds on
 * only changes when the tab navigates away anyway.
 *
 * `nodrag`/`nopan` so pressing it opens the document instead of starting
 * a drag, and the click doesn't also select the node underneath.
 */
export function LinkedDocumentBadge({value, className}: { value: unknown; className?: string }) {
    const ref = normalizeLinkedDocument(value);
    if (!ref) return null;
    const href = linkedDocumentHref(window.location.href, ref.docId);
    if (!href) return null;
    const label = linkedDocumentLabel(ref);
    return (
        <a
            className={`linked-doc-badge nodrag nopan${className ? ` ${className}` : ''}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open "${label}" in a new tab`}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            <FileText size={10}/>
            <span className="linked-doc-badge__label">{label}</span>
        </a>
    );
}
