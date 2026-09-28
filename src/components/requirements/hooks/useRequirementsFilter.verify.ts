import {
  useRequirementsFilter,
  EMPTY_EPIC_TREE,
} from './useRequirementsFilter';

console.log('=== useRequirementsFilter Unit Tests ===');

if (EMPTY_EPIC_TREE.roots.length !== 0 || EMPTY_EPIC_TREE.unparented.length !== 0) {
  throw new Error('EMPTY_EPIC_TREE constant is incorrect');
}
console.log('ok: EMPTY_EPIC_TREE constant is correct');

if (typeof useRequirementsFilter !== 'function') {
  throw new Error('useRequirementsFilter hook is not a function');
}
console.log('ok: useRequirementsFilter hook is exported');

console.log('ALL PASSED');
