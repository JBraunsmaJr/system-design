import { Fragment, memo, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Eye, TriangleAlert, X } from 'lucide-react';
import type {
  RequirementItem,
  RequirementsDocument,
} from '../../domain/requirements/requirementsTypes';
import type { DiagramPath, LinkedNodeRef } from '../../domain/canvas/subDiagramTree';
import { getStatusMeta, isItemWorkable } from '../../domain/requirements/requirementsRegistry';
import { HighlightedText } from '../../common/components/highlight/HighlightText';
import {
  type AcceptanceCriteria,
  describeVerification,
  isVerifiable,
  isVerified,
  parseAcceptanceCriteria,
  summarizeVerification,
  type VerificationSummary,
} from '../../domain/requirements/verification';
import { percentOf } from '../../domain/requirements/requirementsCoverage';
import { getLifecycleMeta, getPriorityMeta } from '../../domain/requirements/requirementAttributes';
import { isExpectedOnDiagram } from '../../domain/requirements/requirementsFilter';
import { getDecisionStatusMeta, isDecisionItem } from '../../domain/requirements/decisionRecords';

/** One line of the table. An item shown twice (a ticket under two epics)
 * is two rows with the same item and different keys. */
export interface RequirementsTableRow {
  key: string;
  item: RequirementItem;
  /** Written to data-section-key, which navigation uses to prefer the copy
   * in the section it came from. */
  sectionKey: string;
  /** Nesting under an epic, 0 for a top-level row. */
  depth: number;
  /** How many items sit beneath this one in the epic grouping. */
  descendantCount: number;
  /** The children are folded away. */
  isFolded: boolean;
  /** Shown only because something beneath it matched the search. */
  isContext: boolean;
  domId?: string;
}

export interface RequirementsTableSection {
  key: string;
  /** Left out for the epic tree, which has no heading of its own. */
  label?: string;
  color?: string;
  rows: RequirementsTableRow[];
  /** Folded with its heading; the rows are still counted. */
  isCollapsed: boolean;
}

interface RequirementsTableProps {
  doc: RequirementsDocument;
  sections: RequirementsTableSection[];
  linkedNodesByItemId: ReadonlyMap<string, LinkedNodeRef[]>;
  /** Open items, by item id: an item shown under two epics opens in both. */
  expandedIds: ReadonlySet<string>;
  onToggleExpanded: (itemId: string) => void;
  /** The full card for an open row. */
  renderExpanded: (row: RequirementsTableRow) => ReactNode;
  onToggleSection: (sectionKey: string) => void;
  onToggleFolded: (itemId: string) => void;
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  highlightedId: string | null;
  /** Marked in ids and titles. */
  searchQuery?: string;
  /** Items someone else in the session has their cursor in. */
  editorsByItemId?: ReadonlyMap<string, { names: string; color: string }>;
  bulkSelectedIds: ReadonlySet<string>;
  /** Set while selecting: rows get a checkbox. */
  onToggleBulkSelected?: (itemId: string, extendRange: boolean) => void;
}

const MAX_NODE_CHIPS = 2;

interface RowProps {
  row: RequirementsTableRow;
  typeLabel: string;
  typeColor: string;
  status?: { label: string; color: string };
  priority?: { label: string; color: string };
  /** Undefined for work and epics, which aren't expected on the diagram. */
  linkedNodes?: LinkedNodeRef[];
  /** Undefined for an item that isn't verified - see isVerifiable. */
  verification?: { summary: VerificationSummary; title: string; criteria: AcceptanceCriteria };
  isExpanded: boolean;
  isHighlighted: boolean;
  isBulkSelected: boolean;
  searchQuery?: string;
  /** Who else is editing this item, as text, and the color of their dot.
   * Two plain strings rather than one object so the row stays memoized. */
  editorNames?: string;
  editorColor?: string;
  onToggleExpanded: (itemId: string) => void;
  onToggleFolded: (itemId: string) => void;
  onNavigateToNode?: (path: DiagramPath, nodeId: string) => void;
  onToggleBulkSelected?: (itemId: string, extendRange: boolean) => void;
}

const Row = memo(function Row({
  row,
  typeLabel,
  typeColor,
  status,
  priority,
  linkedNodes,
  verification,
  isExpanded,
  isHighlighted,
  isBulkSelected,
  searchQuery,
  editorNames,
  editorColor,
  onToggleExpanded,
  onToggleFolded,
  onNavigateToNode,
  onToggleBulkSelected,
}: RowProps) {
  const { item } = row;
  const dash = <span className="requirements-table__none">-</span>;
  return (
    <div
      role="row"
      id={isExpanded ? undefined : row.domId}
      data-requirement-id={item.id}
      data-section-key={row.sectionKey}
      className={`requirements-table__row${isExpanded ? ' is-expanded' : ''}${
        isHighlighted ? ' is-highlighted' : ''
      }${row.isContext ? ' is-context' : ''}${row.depth === 0 && row.descendantCount > 0 ? ' is-parent' : ''}`}
      onClick={(e) => {
        // A click on a control inside the row is that control's business.
        if ((e.target as HTMLElement).closest('button, input, a')) return;
        onToggleExpanded(item.id);
      }}
    >
      <span role="cell" className="requirements-table__lead">
        {onToggleBulkSelected ? (
          <input
            type="checkbox"
            checked={isBulkSelected}
            aria-label={`Select ${item.id}`}
            onClick={(e) => onToggleBulkSelected(item.id, e.shiftKey)}
            onChange={() => undefined}
          />
        ) : isExpanded ? (
          <ChevronDown size={13} aria-hidden />
        ) : (
          <ChevronRight size={13} aria-hidden />
        )}
      </span>
      <span role="cell" className="requirements-table__id" style={{ color: typeColor }}>
        <HighlightedText text={item.id} search={searchQuery} />
      </span>
      <span
        role="cell"
        className="requirements-table__title-cell"
        style={{ paddingLeft: row.depth * 18 }}
      >
        <button
          type="button"
          className="requirements-table__title"
          aria-expanded={isExpanded}
          onClick={() => onToggleExpanded(item.id)}
          title={item.title || 'Untitled'}
        >
          {item.title ? (
            <HighlightedText text={item.title} search={searchQuery} />
          ) : (
            <span className="requirements-table__none">Untitled</span>
          )}
        </button>
        {editorNames && (
          <span
            className="requirements-table__editing"
            style={{ background: editorColor }}
            role="img"
            aria-label={`${editorNames} ${editorNames.includes(', ') ? 'are' : 'is'} editing this`}
            title={`${editorNames} ${editorNames.includes(', ') ? 'are' : 'is'} editing this`}
          />
        )}
        {row.descendantCount > 0 && (
          <button
            type="button"
            className="requirements-table__fold"
            aria-expanded={!row.isFolded}
            aria-label={`${row.isFolded ? 'Show' : 'Hide'} the items under ${item.id}`}
            title={row.isFolded ? 'Show the items under this one' : 'Hide the items under this one'}
            onClick={() => onToggleFolded(item.id)}
          >
            {row.isFolded ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            {row.descendantCount}
          </button>
        )}
      </span>
      <span role="cell" className="requirements-table__type">
        {typeLabel}
      </span>
      <span role="cell" className="requirements-table__status">
        {priority ? (
          <>
            <span
              className="requirements-table__priority-dot"
              style={{ background: priority.color }}
              aria-hidden
            />
            {priority.label}
          </>
        ) : (
          dash
        )}
      </span>
      <span role="cell" className="requirements-table__status">
        {status ? (
          <>
            <span
              className="requirements-table__status-dot"
              style={{ borderColor: status.color }}
              aria-hidden
            />
            {status.label}
          </>
        ) : (
          dash
        )}
      </span>
      <span role="cell" className="requirements-table__nodes">
        {linkedNodes === undefined ? (
          dash
        ) : linkedNodes.length === 0 ? (
          <span className="requirements-table__gap">
            <TriangleAlert size={12} aria-hidden /> Not linked
          </span>
        ) : (
          <>
            {linkedNodes.slice(0, MAX_NODE_CHIPS).map((ref) => (
              <button
                key={`${ref.path.join('/')}/${ref.nodeId}`}
                type="button"
                className="requirements-table__node"
                onClick={() => onNavigateToNode?.(ref.path, ref.nodeId)}
                title={`Show ${ref.label || 'this component'} on the diagram`}
              >
                {ref.label || 'Untitled'}
              </button>
            ))}
            {linkedNodes.length > MAX_NODE_CHIPS && (
              <span
                className="requirements-table__more"
                title={linkedNodes
                  .slice(MAX_NODE_CHIPS)
                  .map((ref) => ref.label || 'Untitled')
                  .join(', ')}
              >
                +{linkedNodes.length - MAX_NODE_CHIPS}
              </span>
            )}
          </>
        )}
      </span>
      <span
        role="cell"
        className={`requirements-table__verification${
          verification ? ` is-${verification.summary.tone}` : ''
        }`}
        title={verification?.title}
      >
        {verification ? (
          <>
            {VERIFICATION_ICON[verification.summary.tone]}
            {verification.summary.label}
            {verification.criteria.total > 0 && (
              <span className="requirements-table__criteria">
                {verification.criteria.met}/{verification.criteria.total}
              </span>
            )}
          </>
        ) : (
          dash
        )}
      </span>
    </div>
  );
});

/**
 * The Requirements view as a table: one line per item - id, title, type,
 * status, sprint, assignee, the components it is linked to and how many
 * relationships it has - with the full card a click away. The card view
 * shows one item per screen; this shows the whole document's shape and
 * where its gaps are.
 */
export function RequirementsTable({
  doc,
  sections,
  linkedNodesByItemId,
  expandedIds,
  onToggleExpanded,
  renderExpanded,
  onToggleSection,
  onToggleFolded,
  onNavigateToNode,
  highlightedId,
  searchQuery,
  editorsByItemId,
  bulkSelectedIds,
  onToggleBulkSelected,
}: RequirementsTableProps) {
  const typeById = new Map(doc.itemTypes.map((t) => [t.id, t]));
  return (
    <div className="requirements-table" role="table" aria-label="Requirements">
      <div role="row" className="requirements-table__head">
        <span role="columnheader" aria-label="Open" />
        <span role="columnheader">ID</span>
        <span role="columnheader">Title</span>
        <span role="columnheader">Type</span>
        <span role="columnheader">Priority</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">On the diagram</span>
        <span
          role="columnheader"
          title="Whether a requirement is verified, and how many of its acceptance criteria are checked"
        >
          Verification
        </span>
      </div>
      {sections.map((section) => (
        <Fragment key={section.key}>
          {section.label !== undefined && (
            <button
              type="button"
              className="requirements-table__section"
              aria-expanded={!section.isCollapsed}
              onClick={() => onToggleSection(section.key)}
            >
              {section.isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span
                className="requirements-table__section-swatch"
                style={{ background: section.color }}
                aria-hidden
              />
              <span className="requirements-table__section-label">{section.label}</span>
              <span className="requirements-table__section-count">{section.rows.length}</span>
              <SectionProgress doc={doc} rows={section.rows} />
            </button>
          )}
          {!section.isCollapsed &&
            section.rows.map((row) => {
              const { item } = row;
              const type = typeById.get(item.typeId);
              const workable = isItemWorkable(doc, item);
              const status = workable
                ? getStatusMeta(item.status)
                : isDecisionItem(item)
                  ? getDecisionStatusMeta(item.decisionStatus)
                  : isVerifiable(doc, item)
                    ? getLifecycleMeta(item.lifecycle)
                    : undefined;
              const isExpanded = expandedIds.has(item.id);
              const verification = isVerifiable(doc, item) ? verificationCell(item) : undefined;
              return (
                <Fragment key={row.key}>
                  <Row
                    row={row}
                    typeLabel={type?.label ?? 'Unknown'}
                    typeColor={type?.color ?? 'var(--chrome-text-dim)'}
                    status={status}
                    priority={isVerifiable(doc, item) ? getPriorityMeta(item.priority) : undefined}
                    linkedNodes={
                      isExpectedOnDiagram(doc, item)
                        ? (linkedNodesByItemId.get(item.id) ?? NONE)
                        : undefined
                    }
                    verification={verification}
                    isExpanded={isExpanded}
                    isHighlighted={highlightedId === item.id}
                    isBulkSelected={bulkSelectedIds.has(item.id)}
                    searchQuery={searchQuery}
                    editorNames={editorsByItemId?.get(item.id)?.names}
                    editorColor={editorsByItemId?.get(item.id)?.color}
                    onToggleExpanded={onToggleExpanded}
                    onToggleFolded={onToggleFolded}
                    onNavigateToNode={onNavigateToNode}
                    onToggleBulkSelected={onToggleBulkSelected}
                  />
                  {isExpanded && (
                    <div className="requirements-table__detail">{renderExpanded(row)}</div>
                  )}
                </Fragment>
              );
            })}
        </Fragment>
      ))}
    </div>
  );
}

const NONE: LinkedNodeRef[] = [];

const VERIFICATION_ICON: Record<VerificationSummary['tone'], React.ReactNode> = {
  ok: <Check size={12} aria-hidden />,
  warning: <TriangleAlert size={12} aria-hidden />,
  failing: <X size={12} aria-hidden />,
  neutral: <Eye size={12} aria-hidden />,
};

/** How much of a section is verified, at the right of its heading. Left
 * out where nothing in the section is the kind of thing that gets verified. */
function SectionProgress({
  doc,
  rows,
}: {
  doc: RequirementsDocument;
  rows: RequirementsTableRow[];
}) {
  const verifiable = rows.filter((row) => isVerifiable(doc, row.item));
  if (verifiable.length === 0) return null;
  const percent = percentOf(
    verifiable.filter((row) => isVerified(row.item)).length,
    verifiable.length,
  );
  return (
    <span className="requirements-table__section-progress">
      {percent}% verified
      <span className="requirements-table__section-bar" aria-hidden>
        <span style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

function verificationCell(item: RequirementItem): NonNullable<RowProps['verification']> {
  const criteria = parseAcceptanceCriteria(item.body);
  return {
    summary: summarizeVerification(item),
    criteria,
    title: `${describeVerification(item)}. ${
      criteria.total === 0
        ? 'No acceptance criteria.'
        : `${criteria.met} of ${criteria.total} acceptance criteria checked.`
    }`,
  };
}
