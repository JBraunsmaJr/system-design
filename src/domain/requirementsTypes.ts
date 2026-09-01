/** A "kind" of requirements-doc item - Requirement, Goal, Constraint, etc.,
 * or a custom one the user defines. Extensible by design: the built-in set
 * covers common cases, but nothing about the data model assumes only
 * these exist. */
export interface RequirementItemType {
  id: string;
  label: string;
  /** Used in generated ids, e.g. "REQ" -> "REQ-1", "REQ-2"... */
  prefix: string;
  color: string;
  /** Built-in types can't be deleted or have their prefix changed (that
   * would silently break every existing reference using the old prefix) -
   * custom types can be freely edited/removed. */
  isBuiltIn: boolean;
}

export interface RequirementItem {
  /** The full generated reference id, e.g. "REQ-1" - stable for the life
   * of the item, never reused even after deletion. */
  id: string;
  typeId: string;
  title: string;
  /** Markdown content, may contain #REQ-3 style references to other items. */
  body: string;
}

export interface RequirementsDocument {
  itemTypes: RequirementItemType[];
  items: RequirementItem[];
  /** Next sequence number to assign per type id. IDs are never reused
   * after a delete - matching how issue trackers like GitHub/GitLab number
   * things - so a reference already written elsewhere never silently ends
   * up pointing at a different item later. */
  nextSequence: Record<string, number>;
}

export const EMPTY_REQUIREMENTS_DOCUMENT: RequirementsDocument = {
  itemTypes: [],
  items: [],
  nextSequence: {},
};
