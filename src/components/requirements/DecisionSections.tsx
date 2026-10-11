import {
  DECISION_SECTIONS,
  getDecisionStatusMeta,
  getSupersedingDecisionIds,
} from '../../domain/requirements/decisionRecords';
import type {ItemMarkdownField} from '../../domain/requirements/requirementsRegistry';
import type {RequirementItem, RequirementsDocument,} from '../../domain/requirements/requirementsTypes';
import {RequirementBody} from './RequirementBody';
import {RequirementEditor} from './RequirementEditor';

interface DecisionSectionsProps {
  item: RequirementItem;
  doc: RequirementsDocument;
  /** Which section is open in the editor, or null. Owned by the card so
   * its "someone is editing this" presence covers every section, not just
   * the body. */
  editingField: ItemMarkdownField | null;
  onEditField: (field: ItemMarkdownField | null) => void;
  onUpdateItem: (id: string, patch: Partial<RequirementItem>) => void;
  onNavigateToItem: (itemId: string) => void;
  searchQuery?: string;
}

/**
 * A decision's body, laid out as an ADR: context, options considered,
 * decision, consequences. Each section edits the way an item's body
 * always has - double-click to open the markdown editor, with #references
 * - so there is nothing new to learn, only more places to write.
 *
 * Above the sections, a note when a later decision supersedes this one,
 * derived from the Supersedes relationships rather than stored, so it can
 * never disagree with them.
 */
export function DecisionSections({
                                   item,
                                   doc,
                                   editingField,
                                   onEditField,
                                   onUpdateItem,
                                   onNavigateToItem,
                                   searchQuery,
                                 }: DecisionSectionsProps) {
  const supersededBy = getSupersedingDecisionIds(doc, item.id);
  const status = getDecisionStatusMeta(item.decisionStatus);

  return (
      <div className="decision-sections">
        {supersededBy.length > 0 && (
            <p className="decision-sections__superseded">
              {status.id === 'superseded' ? 'Superseded by ' : 'A later decision supersedes this: '}
              {supersededBy.map((id, i) => (
                  <span key={id}>
              {i > 0 && ', '}
                    <button
                        type="button"
                        className="requirement-body__ref-link"
                        onClick={() => onNavigateToItem(id)}
                    >
                #{id}
              </button>
            </span>
              ))}
              {status.id !== 'superseded' && ' - consider marking it Superseded.'}
            </p>
        )}
        {DECISION_SECTIONS.map((section) => {
          const value = item[section.field] ?? '';
          const isEditing = editingField === section.field;
          return (
              <section key={section.field} className="decision-sections__section">
                <h4 className="decision-sections__label">{section.label}</h4>
                {isEditing ? (
                    <RequirementEditor
                        value={value}
                        onChange={(text) => onUpdateItem(item.id, {[section.field]: text})}
                        onDone={() => onEditField(null)}
                        doc={doc}
                        autoFocus
                        placeholder={section.placeholder}
                    />
                ) : (
                    <div
                        className="requirement-card__body-wrap decision-sections__body"
                        onDoubleClick={() => onEditField(section.field)}
                        title={value.trim() ? undefined : section.placeholder}
                    >
                      <RequirementBody
                          text={value}
                          doc={doc}
                          onNavigateToItem={onNavigateToItem}
                          searchQuery={searchQuery}
                      />
                    </div>
                )}
              </section>
          );
        })}
      </div>
  );
}
