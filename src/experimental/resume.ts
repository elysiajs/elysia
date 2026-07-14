import { emitResume } from '../compile/plan/emit'
import { planRoute } from '../compile/plan/plan'

export const resumeEmit = { planRoute, emitResume } as const

export type ResumeEmit = typeof resumeEmit
