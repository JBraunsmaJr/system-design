import { useCallback, useLayoutEffect, useRef } from 'react';
import type {
  RequirementItem,
  RequirementItemType,
} from '../../domain/requirements/requirementsTypes';
import type { RequirementsStore } from '../../collab/stores/requirementsStore';
export interface UseRequirementStoreActionsOptions {
  requirementsStore: RequirementsStore;
  /** Must be stable - App passes a useState setter. */
  onFocusedItemChange?: (itemId: string | null) => void;
}

/**
 * Every edit the Requirements view makes to the document, as callbacks.
 * Moved unchanged from RequirementsView.tsx.
 *
 * PERFORMANCE: the useCallback'd handlers here are passed to EVERY
 * RequirementCard, whose memo comparator checks them by identity. They
 * read the store through requirementsStoreRef rather than listing
 * requirementsStore as a dependency, because App recreates the store object
 * on every requirements change: listing it would give each handler a new
 * identity on every edit and re-render every card. Keep new handlers here
 * following the same pattern.
 *
 * The type-management handlers (onAddCustomType and friends) are plain
 * functions, as they were: they only reach the two manage-types modals,
 * which are not memoised.
 *
 * Performance contract: this hook runs inside RequirementsView's render,
 * so it adds no component and no render. Everything it returns is state, a
 * ref, or memoised with the dependencies it had in RequirementsView.tsx.
 * Destructure the result and depend on its members - never on the returned
 * object, which is new on every render.
 */
export function useRequirementStoreActions({
  requirementsStore,
  onFocusedItemChange,
}: UseRequirementStoreActionsOptions) {
  /**
   * Keep in sync on every render so useCallback-stabilized handlers can
   * always call the CURRENT store without needing requirementsStore in
   * their own dependency arrays - requirementsStore itself is recreated
   * on every requirements change (see App.tsx), unlike the plain
   * onUpdateDoc callback this replaces, which was already stable. Same
   * reasoning as the old docRef this replaces, generalized from just
   * onAddRelationship (the only handler that previously needed to read
   * doc directly) to every handler below, since all of them now go
   * through the store rather than a stable setter.
   */
  const requirementsStoreRef = useRef(requirementsStore);

  useLayoutEffect(() => {
    requirementsStoreRef.current = requirementsStore;
  }, [requirementsStore]);

  /**
   * Unlike onAddItem, deliberately doesn't scroll or clear the search:
   * the quick-add row is for staying on the parent and adding several
   * children in a row.
   */
  const onAddChildItem = useCallback(
    (parentId: string, typeId: string, title: string): string | null =>
      requirementsStoreRef.current.addChildItem(parentId, typeId, title),
    [],
  );

  const onUpdateItem = useCallback((id: string, patch: Partial<RequirementItem>) => {
    requirementsStoreRef.current.updateItem(id, patch);
  }, []);

  const onConvertItemType = useCallback((id: string, newTypeId: string) => {
    requirementsStoreRef.current.convertItemType(id, newTypeId);
  }, []);

  const onConvertAllItemsOfType = useCallback((fromTypeId: string, toTypeId: string) => {
    return requirementsStoreRef.current.convertAllItemsOfType(fromTypeId, toTypeId);
  }, []);

  const onDeleteItem = useCallback((id: string) => {
    requirementsStoreRef.current.deleteItem(id);
  }, []);

  /**
   * Creating a category and assigning it to an item happen as one combined
   * store operation (not two separate calls) so they land as a single
   * undo step, and so the item is never left referencing a categoryId that
   * doesn't exist yet in an intermediate state.
   */
  const onCreateAndAssignCategory = useCallback((itemId: string, label: string) => {
    requirementsStoreRef.current.createAndAssignCategory(itemId, label);
  }, []);

  /**
   * Categories are created ad hoc from any card's picker, so they're
   * deleted from there too. The store clears categoryId on every item
   * that referenced it, so nothing is left dangling
   */
  const onDeleteCategory = useCallback((categoryId: string) => {
    requirementsStoreRef.current.deleteCategory(categoryId);
  }, []);

  // One instance shared by every card, rather than a fresh arrow per
  // card per render. RequirementCard compares this by identity in its
  // memo comparator, so a per-card closure would make that comparison
  // always fail and defeat memoization for the whole list.
  // onFocusedItemChange is a useState setter from App, so it's stable
  // and this callback is too.
  const onEditingChange = useCallback(
    (itemId: string, isEditing: boolean) => onFocusedItemChange?.(isEditing ? itemId : null),
    [onFocusedItemChange],
  );

  const onAddRelationship = useCallback(
    (typeId: string, fromItemId: string, toItemId: string): string | null => {
      return requirementsStoreRef.current.addRelationship(typeId, fromItemId, toItemId);
    },
    [],
  );

  const onDeleteRelationship = useCallback((relationshipId: string) => {
    requirementsStoreRef.current.deleteRelationship(relationshipId);
  }, []);

  const onAddCustomType = (
    label: string,
    prefix: string,
    color: string,
    isWorkable: boolean,
  ): boolean => {
    return requirementsStoreRef.current.addCustomType(label, prefix, color, isWorkable);
  };

  /**
   * Label, color, and isWorkable are all safe to edit after the fact for
   * ANY type, including built-in ones - none of them are baked into
   * already-generated item ids the way prefix is, so changing them can't create
   * a mismatch between an item's stored id and its type's current definition.
   * This intentionally never accepts a prefix patch (the
   * caller can only pass these three fields, not arbitrary ones) - prefix
   * is what actually needs to stay stable once items exist under it.
   * @param typeId
   * @param patch
   */
  const onUpdateType = (
    typeId: string,
    patch: Partial<Pick<RequirementItemType, 'label' | 'color' | 'isWorkable'>>,
  ) => {
    requirementsStoreRef.current.updateType(typeId, patch);
  };

  const onDeleteCustomType = (typeId: string): boolean => {
    return requirementsStoreRef.current.deleteCustomType(typeId);
  };

  const onAddCustomRelationshipType = (
    label: string,
    inverseLabel: string,
    color: string,
    isBlocking: boolean,
  ) => {
    requirementsStoreRef.current.addCustomRelationshipType(label, inverseLabel, color, isBlocking);
  };

  const onDeleteCustomRelationshipType = (typeId: string) => {
    requirementsStoreRef.current.deleteCustomRelationshipType(typeId);
  };

  return {
    requirementsStoreRef,
    onAddChildItem,
    onUpdateItem,
    onConvertItemType,
    onConvertAllItemsOfType,
    onDeleteItem,
    onCreateAndAssignCategory,
    onDeleteCategory,
    onEditingChange,
    onAddRelationship,
    onDeleteRelationship,
    onAddCustomType,
    onUpdateType,
    onDeleteCustomType,
    onAddCustomRelationshipType,
    onDeleteCustomRelationshipType,
  };
}
