import { Elysia } from '../../../src'

const importCounter = Symbol.for('elysia.test.workerd-eager-imports')
;(globalThis as any)[importCounter] =
	((globalThis as any)[importCounter] ?? 0) + 1

const app = new Elysia().get('/eager-leak', () => 'eager')

// Accessing fetch compiles eagerly while the AOT build environment is active.
void app.fetch

export default app
