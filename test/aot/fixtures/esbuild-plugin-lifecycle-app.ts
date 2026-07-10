import { Elysia } from '../../../src'

const state = globalThis as typeof globalThis & {
	__elysiaEsbuildPluginLifecycleEvaluations?: number
}

state.__elysiaEsbuildPluginLifecycleEvaluations =
	(state.__elysiaEsbuildPluginLifecycleEvaluations ?? 0) + 1

const marker = process.env.ELYSIA_AOT_LIFECYCLE_MARKER ?? 'missing'

export const app = new Elysia().get('/' + marker, () => 'ok')
