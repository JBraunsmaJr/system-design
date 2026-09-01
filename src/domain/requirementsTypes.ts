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

/** A user-defined grouping for organizing items by functional area (e.g.
 * "Authentication", "Payments") - orthogonal to item type: a Requirement
 * and a Goal can both belong to the same category, and a category has no
 * effect on id generation. Unlike item types, there are no built-in
 * categories - what categories make sense is entirely project-specific,
 * so the list starts empty and is built up by the user. */
export interface RequirementCategory {
  id: string;
  label: string;
  color: string;
}

export interface RequirementItem {
  /** The full generated reference id, e.g. "REQ-1" - stable for the life
   * of the item, never reused even after deletion. */
  id: string;
  typeId: string;
  title: string;
  /** Markdown content, may contain #REQ-3 style references to other items. */
  body: string;
  /** References a RequirementCategory.id - undefined means uncategorized,
   * which is a normal, valid state (categorizing everything up front
   * shouldn't be required to start writing). */
  categoryId?: string;
}

export interface RequirementsDocument {
  itemTypes: RequirementItemType[];
  categories: RequirementCategory[];
  items: RequirementItem[];
  /** Next sequence number to assign per type id. IDs are never reused
   * after a delete - matching how issue trackers like GitHub/GitLab number
   * things - so a reference already written elsewhere never silently ends
   * up pointing at a different item later. */
  nextSequence: Record<string, number>;
}

export const EMPTY_REQUIREMENTS_DOCUMENT: RequirementsDocument = {
  itemTypes: [],
  categories: [],
  items: [],
  nextSequence: {},
};
