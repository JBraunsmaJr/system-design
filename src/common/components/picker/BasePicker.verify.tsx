import { renderToStaticMarkup } from 'react-dom/server';
import { BasePicker, type PickerOption } from './BasePicker';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

const testOptions: PickerOption<string>[] = [
  { value: 'opt-1', label: 'First Option', description: 'Description 1' },
  { value: 'opt-2', label: 'Second Option', description: 'Description 2' },
  { value: 'opt-3', label: 'Third Option', disabled: true },
];

// 1. BasePicker renders trigger with selected label
{
  const html = renderToStaticMarkup(
    <BasePicker
      options={testOptions}
      selectedValue="opt-1"
      onSelect={() => {}}
    />,
  );
  assert(html.includes('base-picker'), 'BasePicker renders root container');
  assert(html.includes('base-picker__trigger'), 'BasePicker renders trigger');
  assert(html.includes('First Option'), 'Trigger displays selected option label');
}

// 2. BasePicker renders placeholder when selectedValue has no match
{
  const html = renderToStaticMarkup(
    <BasePicker
      options={testOptions}
      selectedValue="non-existent"
      placeholder="Select an option..."
      onSelect={() => {}}
    />,
  );
  assert(html.includes('Select an option...'), 'Trigger displays placeholder');
}

// 3. BasePicker custom trigger rendering
{
  const html = renderToStaticMarkup(
    <BasePicker
      options={testOptions}
      selectedValue="opt-2"
      onSelect={() => {}}
      trigger={(selected) => <button id="custom-btn">{selected?.label}</button>}
    />,
  );
  assert(html.includes('id="custom-btn"'), 'Custom trigger is rendered');
  assert(html.includes('Second Option'), 'Custom trigger receives selected option');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
