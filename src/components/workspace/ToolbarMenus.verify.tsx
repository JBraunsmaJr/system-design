import {renderToStaticMarkup} from 'react-dom/server';
import {FileMenu} from './FileMenu';
import {ExportMenu} from './ExportMenu';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log('=== Toolbar Menus (FileMenu & ExportMenu) Verification ===');

// 1. FileMenu renders trigger button without errors
{
  const html = renderToStaticMarkup(
    <FileMenu
      onNew={() => {}}
      onLoadClick={() => {}}
      onOpenDocuments={() => {}}
      onManageLibraries={() => {}}
      isInSession={false}
    />,
  );
  assert(html.includes('title="File"'), 'FileMenu renders trigger with File title');
  assert(html.includes('toolbar__label'), 'FileMenu renders toolbar label');
}

// 2. ExportMenu renders trigger button without errors
{
  const html = renderToStaticMarkup(
    <ExportMenu onExportPng={() => {}} onExportSvg={() => {}} onOpenSrd={() => {}} />,
  );
  assert(html.includes('title="Export"'), 'ExportMenu renders trigger with Export title');
  assert(html.includes('toolbar__label'), 'ExportMenu renders toolbar label');
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  throw new Error(`${failures} test(s) failed`);
} else {
  console.log('\nAll Toolbar Menus verification checks passed.');
}
