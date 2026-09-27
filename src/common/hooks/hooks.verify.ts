import { useOutsideClick } from './useOutsideClick';
import { usePositionedDropdown } from './usePositionedDropdown';
import { computeFlippedPosition } from '../../domain/canvas/popoverPosition';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// 1. Hook exports exist and are functions
{
  assert(typeof useOutsideClick === 'function', 'useOutsideClick is a function');
  assert(typeof usePositionedDropdown === 'function', 'usePositionedDropdown is a function');
}

// 2. Dropdown position calculation respects right viewport boundaries
{
  const viewport = { width: 1200, height: 800 };
  const popover = { width: 340, height: 420 };
  const anchorNearRightEdge = { top: 100, bottom: 130, right: 1180 };

  const pos = computeFlippedPosition(anchorNearRightEdge, popover, viewport);
  assert(pos.left + popover.width <= viewport.width, 'popover does not overflow right edge of viewport');
  assert(pos.left >= 8, 'popover stays within left boundary');
  assert(pos.left === 1200 - 340 - 8 || pos.left === 1180 - 340, 'popover right-aligns with anchor or clamps to viewport');
}

// 3. Dropdown flips vertically when constrained below
{
  const viewport = { width: 1200, height: 600 };
  const popover = { width: 340, height: 400 };
  const anchorNearBottom = { top: 450, bottom: 480, right: 800 };

  const pos = computeFlippedPosition(anchorNearBottom, popover, viewport);
  assert(pos.top < anchorNearBottom.top, 'flips above when space below is insufficient');
  assert(pos.top >= 8, 'flipped popover does not overflow top edge');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
