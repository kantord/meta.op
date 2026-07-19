// ci/cargo-test-coverage.op.tsx — INVARIANT, stated positively: every non-fork, non-archived Rust
// repo under github.com/kantord has a CI workflow that runs `cargo test`.
//   • GitHubAccount / Repo = userland locators (lib/gh.ts), same shape as esto/fs's GitRepo → File.
//   • observe() and the JSX descent share ONE memoized GitHub walk (lib/gh.ts's cache) — same
//     discipline as insane-forms' doc-coverage.op.tsx sharing one typedoc fetch between TsExports
//     and observe().
//   • enter embeds CANONICAL_WORKFLOW as grounding, so a repo with no Rust CI yet gets the exact
//     same file every time. Judgment is only needed when a Rust workflow already exists and the
//     step must be merged into it instead.
//   esto run ci/cargo-test-coverage.op.tsx            # emit a task per repo missing the CI step
//   esto run --dry-run ci/cargo-test-coverage.op.tsx  # list them, write nothing
import { Context, h, prompt, unit } from 'esto'
import { CANONICAL_WORKFLOW, GitHubAccount, rustRepoStatus } from '../lib/gh.ts'

const OWNER = 'kantord'

interface RepoTarget {
  name: string
}

const CargoTestCI = unit({
  key: (r: RepoTarget): string => r.name,
  value: (): string => 'present',
  observe: (): RepoTarget[] =>
    rustRepoStatus(OWNER)
      .filter((r) => r.hasCargoTestCi)
      .map((r) => ({ name: r.name })),
  enter: (r: RepoTarget) =>
    prompt`\`${OWNER}/${r.name}\` has no CI workflow that runs \`cargo test\`.

If \`.github/workflows/\` has NO Rust workflow yet, create \`.github/workflows/ci.yml\` with
exactly this content:

\`\`\`yaml
${CANONICAL_WORKFLOW}
\`\`\`

If a Rust workflow already exists there, add a \`cargo test --workspace --all-features\` step to
it instead of creating a parallel one — match its existing style (checkout/toolchain actions,
triggers, runner OS) rather than pasting the template verbatim.

Open a PR — don't push to the default branch directly.`,
})

// TODO: second unit, CIPathFiltered — repos already passing CargoTestCI should also scope
// their `cargo test` workflow's `on:` triggers to Rust-relevant paths (**/*.rs, **/Cargo.toml,
// **/Cargo.lock) instead of running on every push. Plan:
//   - lib/gh.ts: the per-repo workflow-content fetch already happens once (inside what's
//     currently workflowsContain) — extend it to return a second derived boolean,
//     hasPathFilter, via a cheap regex (/\bpaths(-ignore)?:/) against that same content. No
//     new GitHub calls.
//   - Here: a second unit(), observe() = rustRepoStatus(OWNER).filter(r => r.hasCargoTestCi
//     && r.hasPathFilter) — mirrors CargoTestCI exactly. Render alongside it per repo:
//     {(r) => [<CargoTestCI name={r.name} />, <CIPathFiltered name={r.name} />]}.
//   - Its enter prompt should ask the agent to review the real trigger config and add a
//     sensible filter — don't try to mechanically validate "is this filter good enough".

export default (): unknown => (
  <Context data={{ note: 'personal GitHub governance: kantord/* Rust repos must run cargo test in CI' }}>
    <GitHubAccount owner={OWNER}>
      {({ Repo }) => <Repo>{(r) => <CargoTestCI name={r.name} />}</Repo>}
    </GitHubAccount>
  </Context>
)
