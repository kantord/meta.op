// lib/execState.ts — minimal execution-state tracking, entirely userland (no esto/optative
// changes). Closes one specific gap: observe() only knows whether an invariant currently
// holds, not whether a fix for it is already in flight. Without this, re-running a script
// while an earlier task is still being worked on (agent hasn't opened/merged its PR yet)
// would just re-emit the same task again. This is deliberately NOT the full "storage engine
// per reconciliation border" idea — just the one piece needed to avoid double-dispatching.
//
// Marking something in-progress is NOT done automatically by enter() — enter() only emits a
// prompt, it has no idea whether anything will actually act on it. Marking is a decision the
// external executor (whatever dispatches agents against tasks/) makes explicitly, once it
// actually starts working a task. Completion needs no explicit transition: once the real fix
// lands, the invariant's own observe() check (e.g. hasCargoTestCi) naturally stops matching,
// which is the reconciler's existing self-healing behavior — this module only needs to stop
// it from re-triggering in the meantime.
import { exists, read, sh } from 'esto'

interface ExecRecord {
  status: 'in-progress'
  markedAt: string
  prUrl?: string
}

type ExecState = Record<string, ExecRecord>

const readState = (stateFile: string): ExecState => {
  if (!exists(stateFile)) return {}
  try {
    return JSON.parse(read(stateFile)) as ExecState
  } catch {
    return {}
  }
}

const writeState = (stateFile: string, state: ExecState): void => {
  const dir = stateFile.slice(0, stateFile.lastIndexOf('/'))
  const json = JSON.stringify(state, null, 2)
  sh`mkdir -p ${dir} && printf '%s' ${json} > ${stateFile}`
}

export const isInProgress = (stateFile: string, key: string): boolean =>
  readState(stateFile)[key]?.status === 'in-progress'

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
