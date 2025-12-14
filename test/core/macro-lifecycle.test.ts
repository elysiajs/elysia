import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

describe('macro beforeHandle lifecycle order', () => {
	it('should run macro beforeHandle before nested plugin resolve', async () => {
		const executionOrder: string[] = []

		// Auth service with resolve + macro
		const authService = new Elysia({ name: 'auth-service' })
			.resolve(() => {
				executionOrder.push('authService.resolve')
				return { userId: undefined } // Simulating no auth
			})
			.macro({
				isSignedIn: {
					beforeHandle({ userId }) {
						executionOrder.push('isSignedIn.beforeHandle')
						if (!userId) throw new Error('Unauthorized')
					}
				}
			})
			.as('scoped')

		// DB client that requires userId
		const dbClient = new Elysia({ name: 'db-client' })
			.resolve((ctx) => {
				executionOrder.push('dbClient.resolve')
				const userId = (ctx as { userId?: string }).userId
				if (!userId) throw new Error('User ID is required')
				return { db: { userId } }
			})
			.as('scoped')

		// Feature module using dbClient
		const feature = new Elysia({ name: 'feature' })
			.use(dbClient)
			.get('/', ({ db }) => `Hello ${db.userId}`)

		// Main app
		const app = new Elysia()
			.use(authService)
			.group('/v1', { isSignedIn: true }, (app) => app.use(feature))

		const response = await app.handle(new Request('http://localhost/v1/'))

		// The macro's beforeHandle should run BEFORE dbClient's resolve
		// So we should get "Unauthorized" error, not "User ID is required"
		const body = await response.text()

		console.log('Execution order:', executionOrder)
		console.log('Response:', body)

		// Expected order: authService.resolve -> isSignedIn.beforeHandle (throws)
		// dbClient.resolve should NOT run because beforeHandle throws first
		expect(executionOrder).toContain('authService.resolve')
		expect(executionOrder).toContain('isSignedIn.beforeHandle')
		expect(executionOrder).not.toContain('dbClient.resolve')
		expect(body).toContain('Unauthorized')
	})

	it('should run hooks in registration order within same queue', async () => {
		const executionOrder: string[] = []

		const app = new Elysia()
			.resolve(() => {
				executionOrder.push('resolve1')
				return { val1: 1 }
			})
			.onBeforeHandle(() => {
				executionOrder.push('beforeHandle1')
			})
			.resolve(() => {
				executionOrder.push('resolve2')
				return { val2: 2 }
			})
			.onBeforeHandle(() => {
				executionOrder.push('beforeHandle2')
			})
			.get('/', () => 'ok')

		await app.handle(new Request('http://localhost/'))

		console.log('Execution order:', executionOrder)

		// According to docs, resolve and beforeHandle share the same queue
		// Order should be: resolve1 -> beforeHandle1 -> resolve2 -> beforeHandle2
		expect(executionOrder).toEqual([
			'resolve1',
			'beforeHandle1',
			'resolve2',
			'beforeHandle2'
		])
	})

	it('should demonstrate the issue with macro in group', async () => {
		const executionOrder: string[] = []
		let errorMessage = ''

		const authPlugin = new Elysia({ name: 'auth' })
			.resolve(() => {
				executionOrder.push('auth.resolve')
				return { userId: 'user123' } // Auth succeeds
			})
			.macro({
				requireAuth: {
					beforeHandle({ userId }) {
						executionOrder.push('requireAuth.beforeHandle')
						if (!userId) throw new Error('Unauthorized')
					}
				}
			})
			.as('scoped')

		const dataPlugin = new Elysia({ name: 'data' })
			.resolve((ctx) => {
				executionOrder.push('data.resolve')
				return { data: 'some data' }
			})
			.as('scoped')

		const app = new Elysia()
			.use(authPlugin)
			.onError(({ error }) => {
				errorMessage = error.message
				return error.message
			})
			.group('/api', { requireAuth: true }, (app) => app.use(dataPlugin).get('/', ({ data }) => data))

		const response = await app.handle(new Request('http://localhost/api/'))

		console.log('Execution order:', executionOrder)
		console.log('Error:', errorMessage)

		// With auth succeeding (userId = 'user123'), all should run
		// Expected: auth.resolve -> requireAuth.beforeHandle -> data.resolve
		expect(executionOrder).toEqual([
			'auth.resolve',
			'requireAuth.beforeHandle',
			'data.resolve'
		])
	})
})
