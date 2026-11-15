/**
 * Which store this browser uses, and a way to point it at one, inside
 * File > Documents.
 *
 * A deployment can serve the editor with its store built in. This is for
 * the other case: an editor hosted somewhere general, used with an
 * organization's own store. Someone types the store's address; it is
 * checked - there is a store there, and this page may talk to it - and
 * only then remembered. The page reloads, because which store there is
 * decides how the editor is wired from its first render (storeMode.ts).
 *
 * Nothing about the open document changes. Documents in this browser stay
 * in this browser whichever store is chosen, or none.
 */
import { useState } from 'react';
import { Server } from 'lucide-react';
import { Button } from '../../common/components/button/Button';
import { checkStore } from '../../collab/trusted/storeMode';
import {
  getDeploymentStoreUrl,
  getSavedStoreUrl,
  parseStoreAddress,
  saveStoreUrl,
} from '../../domain/storage/storeConfig';

interface StoreConnectionProps {
  /** The store in use on this visit, or null. */
  storeUrl: string | null;
  /** Injected for tests; default reloads the page. */
  onChanged?: () => void;
  /** Injected for tests. */
  check?: typeof checkStore;
}

export function StoreConnection({ storeUrl, onChanged, check = checkStore }: StoreConnectionProps) {
  const [saved] = useState(() => getSavedStoreUrl());
  const [deployment] = useState(() => getDeploymentStoreUrl());
  const [address, setAddress] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const changed = onChanged ?? (() => globalThis.location.reload());

  const connect = async () => {
    if (address === null) return;
    const parsed = parseStoreAddress(address, globalThis.location?.protocol);
    if (!parsed.ok) return setProblem(parsed.message);
    if (parsed.url === storeUrl) return setAddress(null);
    setChecking(true);
    setProblem(null);
    const found = await check(parsed.url);
    setChecking(false);
    if (!found) {
      // The browser does not say which of these it was, so name them all.
      return setProblem(
        `No store answered at ${parsed.url}. Check the address and that the store is running. ` +
          `If both are right, the store has not been told about this editor: ask its administrator to add ` +
          `${globalThis.location.origin} to the store's ALLOWED_ORIGINS.`,
      );
    }
    if (!saveStoreUrl(parsed.url)) {
      return setProblem(
        'This browser would not remember the address. Check that it allows this site to store data.',
      );
    }
    changed();
  };

  const forget = () => {
    saveStoreUrl(null);
    changed();
  };

  return (
    <div className="store-connection">
      <div className="store-connection__header">
        <Server size={14} />
        <strong>Store</strong>
      </div>

      {address === null ? (
        <div className="trusted-workspace__row">
          {storeUrl ? (
            <span className="store-connection__current">
              <span className="store-connection__url">{storeUrl}</span>
              <span className="store-connection__source">
                {saved ? ' Chosen in this browser.' : ' Set by this site.'}
              </span>
            </span>
          ) : (
            <span className="trusted-workspace__status">
              No store. Documents are kept in this browser only. Connect to your organization&apos;s
              store to share them in workspaces.
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="store-connection__change"
            onClick={() => {
              setProblem(null);
              setAddress(saved ?? '');
            }}
          >
            {storeUrl ? 'Change' : 'Connect to a store'}
          </Button>
        </div>
      ) : (
        <>
          <form
            className="trusted-workspace__row"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <label htmlFor="store-connection-address">Store address</label>
            <input
              id="store-connection-address"
              className="trusted-workspace__input"
              placeholder="https://store.example.com"
              value={address}
              autoFocus
              autoComplete="url"
              spellCheck={false}
              onChange={(e) => setAddress(e.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="store-connection__connect"
              disabled={checking || address.trim() === ''}
            >
              {checking ? 'Checking...' : 'Connect'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAddress(null)}>
              Cancel
            </Button>
          </form>
          <p className="trusted-workspace__status">
            The page reloads once the store answers. Documents in this browser stay where they are.
          </p>
          {saved && (
            <div>
              <Button
                variant="ghost"
                size="sm"
                className="store-connection__forget"
                onClick={forget}
              >
                {deployment
                  ? `Go back to this site's store (${deployment})`
                  : 'Stop using a store in this browser'}
              </Button>
            </div>
          )}
        </>
      )}

      {problem && (
        <p className="trusted-workspace__error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
