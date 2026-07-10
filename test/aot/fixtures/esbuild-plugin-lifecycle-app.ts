import { Elysia } from '../../../src'

const state = globalThis as typeof globalThis & {
	__elysiaEsbuildPluginLifecycleEvaluations?: number
}

state.__elysiaEsbuildPluginLifecycleEvaluations =
	(state.__elysiaEsbuildPluginLifecycleEvaluations ?? 0) + 1

export const app = new Elysia().get('/', () => 'ok')
