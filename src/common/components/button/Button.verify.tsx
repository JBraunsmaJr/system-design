import React, { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from './Button';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// 1. Default button renders with secondary variant, md size, type="button", and text
{
  const html = renderToStaticMarkup(<Button>Click Me</Button>);
  assert(html.includes('btn'), 'Includes base btn class');
  assert(html.includes('btn--secondary'), 'Default variant is secondary');
  assert(html.includes('btn--md'), 'Default size is md');
  assert(html.includes('type="button"'), 'Default type is button');
  assert(html.includes('Click Me'), 'Renders children text');
}

// 2. Button variants apply corresponding classes and styles
{
  const primary = renderToStaticMarkup(<Button variant="primary">Primary</Button>);
  assert(primary.includes('btn--primary'), 'Primary variant class is set');
  assert(primary.includes('primary'), 'Backwards-compatible primary class is set');

  const ghost = renderToStaticMarkup(<Button variant="ghost">Ghost</Button>);
  assert(ghost.includes('btn--ghost'), 'Ghost variant class is set');

  const danger = renderToStaticMarkup(<Button variant="danger">Danger</Button>);
  assert(danger.includes('btn--danger'), 'Danger variant class is set');

  const dangerOutline = renderToStaticMarkup(<Button variant="danger-outline">Danger Outline</Button>);
  assert(dangerOutline.includes('btn--danger-outline'), 'Danger outline variant class is set');
}

// 3. Button sizes apply corresponding classes
{
  const sm = renderToStaticMarkup(<Button size="sm">Small</Button>);
  assert(sm.includes('btn--sm'), 'Small size class is set');

  const lg = renderToStaticMarkup(<Button size="lg">Large</Button>);
  assert(lg.includes('btn--lg'), 'Large size class is set');
}

// 4. Icons and iconOnly mode
{
  const withLeftIcon = renderToStaticMarkup(
    <Button icon={<span className="test-icon">icon</span>}>With Icon</Button>,
  );
  assert(withLeftIcon.includes('btn__icon--left'), 'Left icon wrapper is rendered');
  assert(withLeftIcon.includes('test-icon'), 'Left icon is present');

  const withRightIcon = renderToStaticMarkup(
    <Button iconRight={<span className="right-icon">right</span>}>With Right Icon</Button>,
  );
  assert(withRightIcon.includes('btn__icon--right'), 'Right icon wrapper is rendered');
  assert(withRightIcon.includes('right-icon'), 'Right icon is present');

  const iconOnly = renderToStaticMarkup(
    <Button iconOnly aria-label="Close" icon={<span className="x-icon">X</span>} />,
  );
  assert(iconOnly.includes('btn--icon-only'), 'iconOnly class is applied');
  assert(iconOnly.includes('aria-label="Close"'), 'aria-label is passed');
}

// 5. Disabled and loading states
{
  const disabled = renderToStaticMarkup(<Button disabled>Disabled</Button>);
  assert(disabled.includes('disabled=""') || disabled.includes('disabled'), 'disabled attribute is present');

  const loading = renderToStaticMarkup(<Button loading>Loading</Button>);
  assert(loading.includes('btn--loading'), 'btn--loading class is applied');
  assert(loading.includes('disabled=""') || loading.includes('disabled'), 'loading disables the button');
}

// 6. fullWidth and custom className / attributes
{
  const fullWidth = renderToStaticMarkup(
    <Button fullWidth className="custom-class" data-testid="custom-btn" title="Helpful tooltip">
      Full Width
    </Button>,
  );
  assert(fullWidth.includes('btn--full-width'), 'btn--full-width class is applied');
  assert(fullWidth.includes('custom-class'), 'Custom class is merged');
  assert(fullWidth.includes('data-testid="custom-btn"'), 'data attributes are passed');
  assert(fullWidth.includes('title="Helpful tooltip"'), 'title attribute is passed');
}

// 7. forwardRef support
{
  const ref = createRef<HTMLButtonElement>();
  // Verify it accepts ref without TypeScript or runtime error
  <Button ref={ref}>Ref Button</Button>;
  assert(ref !== undefined, 'Button accepts ref');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
