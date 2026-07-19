// lib/gh.ts — userland "esto/gh" locators: capability-injected, same shape as esto/fs's
// GitRepo → File, but walking a GitHub *account* instead of a local working tree. Pure
// userland — built entirely from `sh` (gh CLI) + JSON.parse, no engine changes.
import { sh } from 'esto'

export interface RepoMeta {
  name: string
  hasCargoTestCi: boolean
}

// h_fn always wraps JSX children in an array, even a single one — same gotcha
// insane-forms/docs/doc-coverage.op.tsx documents on its own `rp` helper.
const rp = <T,>(children: unknown): ((arg: T) => unknown) =>
  (Array.isArray(children) ? children[0] : children) as (arg: T) => unknown

const cache = new Map<string, RepoMeta[]>()

const workflowsContain = (owner: string, repo: string, needle: string): boolean => {
  let out = ''
  try {
    out = sh`
      names=$(gh api repos/${owner}/${repo}/contents/.github/workflows --jq '.[].name' 2>/dev/null) || exit 0
      for f in $names; do
        gh api "repos/${owner}/${repo}/contents/.github/workflows/$f" --jq .content | base64 -d
        echo
      done
    `
  } catch {
    return false
  }
  return out.includes(needle)
}

const hasCargoToml = (owner: string, repo: string): boolean => {
  try {
    sh`gh api repos/${owner}/${repo}/contents/Cargo.toml -q .name`
    return true
  } catch {
    return false
  }
}

// Rust repos only (root Cargo.toml present), non-fork, non-archived. Fetched once per owner
// and memoized so JSX descent and unit.observe() share a single GitHub walk.
export const rustRepoStatus = (owner: string): RepoMeta[] => {
  const cached = cache.get(owner)
  if (cached) return cached

  const all = JSON.parse(
    sh`gh repo list ${owner} --limit 500 --json name,isFork,isArchived`
  ) as { name: string; isFork: boolean; isArchived: boolean }[]

  const result = all
    .filter((r) => !r.isFork && !r.isArchived)
    .filter((r) => hasCargoToml(owner, r.name))
    .map((r) => ({
      name: r.name,
      hasCargoTestCi: workflowsContain(owner, r.name, 'cargo test'),
    }))

  cache.set(owner, result)
  return result
}

export const GitHubAccount = ({
  owner,
  children,
}: {
  owner: string
  children: (ctx: { Repo: (p: { children: (r: RepoMeta) => unknown }) => unknown }) => unknown
}): unknown =>
  rp<{ Repo: (p: { children: (r: RepoMeta) => unknown }) => unknown }>(children)({
    Repo: ({ children }) => rustRepoStatus(owner).map((r) => rp<RepoMeta>(children)(r)),
  })

export const CANONICAL_WORKFLOW = `name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo test --workspace --all-features
`
