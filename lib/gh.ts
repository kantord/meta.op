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
    // NOTE: esto's `sh` tag wraps every ${} interpolation in its own single quotes,
    // unconditionally — so ${owner}/${repo} must stay in *unquoted* shell position
    // (as in the first gh api call below). Putting them inside an existing "..."
    // string (as this used to, for the second call) breaks: the single quotes esto
    // adds become literal characters inside the double quotes, not quote-removal,
    // producing a path like repos/'kantord'/'optative'/... that 404s. $f (the shell
    // loop variable, not an esto interpolation) still gets its own "$f" quoting.
    out = sh`
      names=$(gh api repos/${owner}/${repo}/contents/.github/workflows --jq '.[].name' 2>/dev/null) || exit 0
      for f in $names; do
        gh api repos/${owner}/${repo}/contents/.github/workflows/"$f" --jq .content | base64 -d
        echo
      done
    `
  } catch {
    return false
  }
  return out.includes(needle)
}

interface LangNode {
  name: string
}
interface RepoNode {
  name: string
  isArchived: boolean
  languages: { nodes: LangNode[] }
}
interface Page {
  nodes: RepoNode[]
  pageInfo: { hasNextPage: boolean; endCursor: string }
}

const PAGE_QUERY_FIRST = `query($owner: String!) {
  repositoryOwner(login: $owner) {
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes { name isArchived languages(first: 20) { nodes { name } } }
    }
  }
}`

const PAGE_QUERY_NEXT = `query($owner: String!, $cursor: String!) {
  repositoryOwner(login: $owner) {
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes { name isArchived languages(first: 20) { nodes { name } } }
    }
  }
}`

// `gh api --paginate` doesn't reliably auto-follow GraphQL cursors (verified: hung
// indefinitely on this exact query) — so pagination is done by hand here, one `sh`
// call per page, using two query variants since a declared-but-unpassed GraphQL
// variable isn't accepted the way an absent CLI flag is.
const fetchPage = (owner: string, cursor: string | null): Page => {
  const raw = cursor
    ? sh`gh api graphql -f query=${PAGE_QUERY_NEXT} -f owner=${owner} -f cursor=${cursor}`
    : sh`gh api graphql -f query=${PAGE_QUERY_FIRST} -f owner=${owner}`
  return (JSON.parse(raw) as { data: { repositoryOwner: { repositories: Page } } }).data
    .repositoryOwner.repositories
}

// Every non-fork, non-archived repo where Rust appears *anywhere* in the language
// breakdown (not just as the primary/dominant language — GitHub's --language flag
// only matches primary, which misses real cargo projects that aren't majority-Rust
// by byte count). A repo matched here without a Cargo.toml yet is a real gap, not a
// false positive: the CI-wiring task naturally has to set one up as part of the fix.
const listRustRepoNames = (owner: string): string[] => {
  const names: string[] = []
  let cursor: string | null = null
  for (;;) {
    console.log(`gh: fetching repo page${cursor ? ' (cont.)' : ''}...`)
    const page = fetchPage(owner, cursor)
    for (const r of page.nodes) {
      if (!r.isArchived && r.languages.nodes.some((l) => l.name === 'Rust')) {
        names.push(r.name)
      }
    }
    if (!page.pageInfo.hasNextPage) break
    cursor = page.pageInfo.endCursor
  }
  return names
}

// Fetched once per owner and memoized so JSX descent and unit.observe() share a
// single GitHub walk.
export const rustRepoStatus = (owner: string): RepoMeta[] => {
  const cached = cache.get(owner)
  if (cached) return cached

  console.log(`gh: finding Rust repos for ${owner} (GraphQL language breakdown)...`)
  const names = listRustRepoNames(owner)

  console.log(`gh: checking CI status for ${names.length} Rust repos...`)
  const result = names.map((name, i) => {
    console.log(`  [${i + 1}/${names.length}] CI? ${name}`)
    return {
      name,
      hasCargoTestCi: workflowsContain(owner, name, 'cargo test'),
    }
  })

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

// Shared closing instructions for every task prompt in this repo: commit/PR rules plus
// mandatory disclosure that the change is automated, not human-authored, with provenance
// pointing back to the EXACT commit of the script that generated it (not just the repo in
// general, which drifts — a reader auditing this PR later should see precisely which
// version of the invariant produced it). Every unit()'s enter/update prompt should end with
// this — it belongs in the prompt itself, not improvised per-execution, since whatever
// executes the task (a subagent today, something more automated later) should get
// consistent instructions and consistent wording regardless of who or what is running it.
export const automationDisclosure = (scriptPath: string): string => {
  const hash = sh`git rev-parse HEAD`.trim()
  return `Commit using your normal git identity — don't override author/committer. In BOTH
the commit message and the PR description, clearly disclose that this change was made fully
automatically, not by a human, using the script at
https://github.com/kantord/meta.op/blob/${hash}/${scriptPath} (commit ${hash}).

Open a PR — don't push to the default branch directly.`
}
