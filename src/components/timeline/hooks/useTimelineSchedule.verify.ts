import { useTimelineSchedule } from './useTimelineSchedule';
import { useTimelineCapacity } from './useTimelineCapacity';

console.log('=== Timeline Hooks Export Verification ===');

if (typeof useTimelineSchedule !== 'function') {
  throw new Error('useTimelineSchedule is not a function');
}
console.log('ok: useTimelineSchedule is exported');

if (typeof useTimelineCapacity !== 'function') {
  throw new Error('useTimelineCapacity is not a function');
}
console.log('ok: useTimelineCapacity is exported');

console.log('ALL PASSED');
