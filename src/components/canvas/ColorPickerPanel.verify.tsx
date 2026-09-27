/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/ColorPickerPanel.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { ColorPickerPanel, PRESET_COLORS } from './ColorPickerPanel';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// === Part 1: Preset Colors rendering ===
{
  const html = renderToStaticMarkup(
    React.createElement(ColorPickerPanel, {
      value: undefined,
      defaultValue: '#5B7CFA',
      onChange: () => {},
    }),
  );

  assert(html.includes('color-picker-panel'), 'renders color-picker-panel container');
  for (const color of PRESET_COLORS) {
    assert(html.includes(color), `renders preset color swatch for ${color}`);
  }
  assert(html.includes('Custom color'), 'renders custom color label');
  assert(html.includes('type="color"'), 'renders native color input');
  assert(
    !html.includes('Reset to default'),
    'does not render reset button when value is undefined',
  );
}

// === Part 2: Value override and reset button ===
{
  const html = renderToStaticMarkup(
    React.createElement(ColorPickerPanel, {
      value: '#FF6B6B',
      defaultValue: '#5B7CFA',
      onChange: () => {},
    }),
  );

  assert(html.includes('Reset to default'), 'renders reset button when value override is present');
  assert(html.includes('is-selected'), 'selected swatch receives is-selected class');
}

// === Part 3: Selection logic ===
{
  let selectedColor: string | undefined = 'initial';
  let closed: boolean = false;

  const panel = ColorPickerPanel({
    value: '#FF6B6B',
    defaultValue: '#5B7CFA',
    onChange: (color) => {
      selectedColor = color;
    },
    onClose: () => {
      closed = true;
    },
  });

  assert(panel !== null, 'ColorPickerPanel renders successfully');
  const resetButton = panel.props.children[3];
  if (resetButton && resetButton.props?.onClick) {
    resetButton.props.onClick();
    assert(selectedColor === undefined, 'Reset button calls onChange with undefined');
    assert(closed, 'Reset button calls onClose');
  }
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} assertion(s) failed`);
