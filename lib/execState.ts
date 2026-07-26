// lib/execState.ts — userland execution-state tracking (no esto/optative changes). Lets
// observe() know a fix is already in flight, so a re-run doesn't re-emit the same task while
// an earlier one is still being worked. Marking is done by the external dispatcher, not by
// enter() — enter() only emits a prompt, it has no idea if anything acts on it. Completion
// needs no explicit transition: once the real fix lands, observe()'s own check stops matching.
import { exists, read, sh } from 'esto'

interface ExecRecord {
  status: 'in-progress'
  markedAt: string
  prUrl?: string
}

type ExecState = Record<string, ExecRecord>

// Markers older than this are treated as abandoned (e.g. a dispatched agent crashed and never
// opened a PR), so the repo isn't hidden from observe() forever.
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

const readState = (stateFile: string): ExecState => {
  if (!exists(stateFile)) return {}
  try {
    return JSON.parse(read(stateFile)) as ExecState
  } catch {
    return {}
  }
}

// Write-then-rename so a crash mid-write can't leave a truncated state file.
const writeState = (stateFile: string, state: ExecState): void => {
  const dir = stateFile.slice(0, stateFile.lastIndexOf('/'))
  const json = JSON.stringify(state, null, 2)
  const tmpFile = `${stateFile}.new`
  sh`mkdir -p ${dir} && printf '%s' ${json} > ${tmpFile} && mv ${tmpFile} ${stateFile}`
}

const isStale = (record: ExecRecord): boolean =>
  Date.now() - new Date(record.markedAt).getTime() > STALE_AFTER_MS

export const isInProgress = (stateFile: string, key: string): boolean => {
  const record = readState(stateFile)[key]
  return record?.status === 'in-progress' && !isStale(record)
}

export const markInProgress = (stateFile: string, key: string, prUrl?: string): void => {
  const state = readState(stateFile)
  state[key] = {
    status: 'in-progress',
    markedAt: new Date().toISOString(),
    ...(prUrl ? { prUrl } : {}),
  }
  writeState(stateFile, state)
}

export const clearInProgress = (stateFile: string, key: string): void => {
  const state = readState(stateFile)
  delete state[key]
  writeState(stateFile, state)
}
