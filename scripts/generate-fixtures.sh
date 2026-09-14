#!/usr/bin/env bash
#
# WS5-R6 — regenerate the schema fixture corpus.
#
# Each fixture is produced by that version's OWN serialization code, checked out
# into a temporary worktree. This matters: a hand-authored fixture encodes what
# we currently believe an old version wrote, and that belief is precisely what
# the compatibility tests exist to check.
#
# Run from the repository root. Requires node_modules to be installed at HEAD;
# worktrees symlink to it rather than installing per version.
#
# Adding a new schema version: bump SCHEMA_VERSION, tag or note the commit,
# append it to VERSIONS below, and re-run. Never delete an entry.

set -euo pipefail

# schema version : commit that introduced it
VERSIONS=(
  "0.1:ad67073"
  "0.2:9ec0347"
  "0.3:d483e62"
  "0.4:c1be319"
  "0.5:4f7b54d"
  "0.6:d7cb944"
  "0.7:fb6d4ee"
)

REPO_ROOT="$(git rev-parse --show-toplevel)"
FIXTURE_DIR="${REPO_ROOT}/fixtures"
WORKTREE_ROOT="$(mktemp -d)"
GENERATOR="${REPO_ROOT}/scripts/gen-fixture.mts"

cleanup() {
  for pair in "${VERSIONS[@]}"; do
    git -C "${REPO_ROOT}" worktree remove --force "${WORKTREE_ROOT}/${pair%%:*}" 2>/dev/null || true
  done
  rm -rf "${WORKTREE_ROOT}"
}
trap cleanup EXIT

if [ ! -d "${REPO_ROOT}/node_modules" ]; then
  echo "node_modules not found. Run 'npm install' first." >&2
  exit 1
fi

mkdir -p "${FIXTURE_DIR}"

for pair in "${VERSIONS[@]}"; do
  version="${pair%%:*}"
  commit="${pair##*:}"
  worktree="${WORKTREE_ROOT}/${version}"

  git -C "${REPO_ROOT}" worktree add -f --detach "${worktree}" "${commit}" >/dev/null 2>&1
  ln -s "${REPO_ROOT}/node_modules" "${worktree}/node_modules"
  cp "${GENERATOR}" "${worktree}/gen-fixture.mts"

  (cd "${worktree}" && FIXTURE_OUT="${FIXTURE_DIR}" npx tsx gen-fixture.mts)
done

echo
echo "Corpus written to ${FIXTURE_DIR}"
echo "Fixtures are byte-stable: re-running should produce no git diff."
