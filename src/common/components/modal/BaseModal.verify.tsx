import { renderToStaticMarkup } from 'react-dom/server';
import { BaseModal } from './BaseModal';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    failures++;
    console.error(`FAIL: ${message}`);
  }
}

// 1. BaseModal returns null when closed
{
  const html = renderToStaticMarkup(
    <BaseModal isOpen={false} onClose={() => {}}>
      <div>Modal Body</div>
    </BaseModal>,
  );
  assert(html === '', 'Closed BaseModal renders nothing');
}

// 2. BaseModal renders dialog container, title, body, and footer when open
{
  const html = renderToStaticMarkup(
    <BaseModal
      isOpen={true}
      onClose={() => {}}
      title="Test Dialog"
      footer={<button>Confirm</button>}
    >
      <p>Content Body</p>
    </BaseModal>,
  );
  assert(html.includes('modal-overlay'), 'Open BaseModal renders modal overlay');
  assert(html.includes('modal-content'), 'Open BaseModal renders modal content');
  assert(html.includes('role="dialog"'), 'Default role is dialog');
  assert(html.includes('aria-modal="true"'), 'aria-modal attribute is set to true');
  assert(html.includes('Test Dialog'), 'Title is rendered');
  assert(html.includes('Content Body'), 'Body children are rendered');
  assert(html.includes('<button>Confirm</button>'), 'Footer is rendered');
}

// 3. BaseModal supports alertdialog role and ariaLabel
{
  const html = renderToStaticMarkup(
    <BaseModal isOpen={true} onClose={() => {}} role="alertdialog" ariaLabel="Warning Notice">
      <p>Alert Message</p>
    </BaseModal>,
  );
  assert(html.includes('role="alertdialog"'), 'Custom role alertdialog is set');
  assert(html.includes('aria-label="Warning Notice"'), 'aria-label is passed correctly');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
if (failures > 0) throw new Error(`${failures} test(s) failed`);
