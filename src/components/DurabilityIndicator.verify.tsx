/**
 * Run with: npx tsx --tsconfig tsconfig.app.json src/components/DurabilityIndicator.verify.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { DurabilityIndicator } from './DurabilityIndicator';
import type { DurabilitySignals } from '../domain/durability';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

const localSignals: DurabilitySignals = { localPersistence: 'active' };

console.log('=== DurabilityIndicator OIDC and Workspace Persistence ===');

// 1. Durability indicator renders chip with local state
{
  const html = renderToStaticMarkup(
    <DurabilityIndicator signals={localSignals} />,
  );
  assert(html.includes('durability__chip'), 'renders durability chip');
  assert(html.includes('Saved in browser'), 'renders label Saved in browser');
}

// 2. Alert / at-risk state renders persistent detail popup with OIDC sign-in when logged out
{
  const atRiskSignals: DurabilitySignals = {
    localPersistence: 'unavailable',
  };
  const html = renderToStaticMarkup(
    <DurabilityIndicator
      signals={atRiskSignals}
      onExport={() => {}}
      onLoginOidc={() => {}}
      isOidcAvailable={true}
      isLoggedIn={false}
    />,
  );
  assert(html.includes('durability__detail'), 'renders detail popup for persistent/alert state');
  assert(html.includes('Sign in with OIDC'), 'renders Sign in with OIDC button when logged out and OIDC is available');
  assert(html.includes('Export a copy'), 'renders Export a copy action');
}

// 3. Logged in user in at-risk state sees Save to workspace option
{
  const atRiskSignals: DurabilitySignals = {
    localPersistence: 'unavailable',
  };
  const html = renderToStaticMarkup(
    <DurabilityIndicator
      signals={atRiskSignals}
      onExport={() => {}}
      isLoggedIn={true}
      onSaveToWorkspace={() => {}}
    />,
  );
  assert(html.includes('durability__detail'), 'renders detail popup');
  assert(html.includes('Save to workspace'), 'renders Save to workspace button when logged in');
  assert(!html.includes('Sign in with OIDC'), 'does not render Sign in with OIDC when logged in');
}

// 4. File-backed document in at-risk/alert state renders Stop saving to file option
{
  const atRiskFileSignals: DurabilitySignals = {
    localPersistence: 'unavailable',
    fileBacked: true,
    fileAccess: 'available',
  };
  const html = renderToStaticMarkup(
    <DurabilityIndicator
      signals={atRiskFileSignals}
      fileName="diagram.json"
      onStopFile={() => {}}
      onExport={() => {}}
    />,
  );
  assert(html.includes('Stop saving to diagram.json'), 'renders Stop saving to file option when file-backed');
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  (globalThis as unknown as { process: { exitCode: number } }).process?.exitCode ? ((globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1) : undefined;
  throw new Error(`${failures} test(s) failed`);
} else {
  console.log('\nAll DurabilityIndicator verification checks passed.');
}
