import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'

describe('.use() with asynchronous plugins', () => {
	it('accepts a plugin promise', async () => {
		const plugin = new Elysia().get('/p', () => 'plugin')
		const app = new Elysia().use(Promise.resolve(plugin))

		await app.modules

		const res = await app.handle('/p').then((r) => r.text())
		expect(res).toBe('plugin')
	})

	it('accepts an asynchronous plugin factory', async () => {
		const app = new Elysia().use(async () =>
			new Elysia().get('/p', () => 'plugin')
		)

		await app.modules

		const res = await app.handle('/p').then((r) => r.text())
		expect(res).toBe('plugin')
	})

	it('accepts a dynamic-import module', async () => {
		const plugin = new Elysia().get('/p', () => 'plugin')
		const app = new Elysia().use(Promise.resolve({ default: plugin }))

		await app.modules

		const res = await app.handle('/p').then((r) => r.text())
		expect(res).toBe('plugin')
	})

	it('registers synchronous routes while a plugin is pending', async () => {
		let resolvePlugin!: (v: any) => void
		const promise = new Promise((res) => {
			resolvePlugin = res
		})

		const app = new Elysia()
			.use(promise as Promise<any>)
			.get('/sync', () => 'sync')

		const res = await app.handle('/sync').then((r) => r.text())
		expect(res).toBe('sync')

		resolvePlugin(new Elysia())
		await app.modules
	})

	it('registers plugin routes after app.modules resolves', async () => {
		const app = new Elysia()
			.get('/sync', () => 'sync')
			.use(Promise.resolve(new Elysia().get('/async', () => 'async')))

		await app.modules

		const both = await Promise.all([
			app.handle('/sync').then((r) => r.text()),
			app.handle('/async').then((r) => r.text())
		])

		expect(both).toEqual(['sync', 'async'])
	})

	it('keeps pending plugin routes unavailable until app.modules resolves', async () => {
		let resolveLater!: (v: any) => void
		const pending = new Promise((res) => {
			resolveLater = res
		})

		const app = new Elysia()
			.get('/sync', () => 'sync')
			.use(pending as Promise<any>)

		const syncBefore = await app
			.handle('/sync')
			.then((r) => [r.status, r.text()] as const)
		expect(syncBefore[0]).toBe(200)
		await expect(syncBefore[1]).resolves.toBe('sync')

		const asyncBefore = await app.handle('/async').then((r) => r.status)
		expect(asyncBefore).toBe(404)

		resolveLater(new Elysia().get('/async', () => 'async'))
		await app.modules

		const asyncAfter = await app.handle('/async').then((r) => r.text())
		expect(asyncAfter).toBe('async')

		const syncAfter = await app.handle('/sync').then((r) => r.text())
		expect(syncAfter).toBe('sync')
	})

	it('reports a rejected plugin without disabling synchronous routes', async () => {
		const errors: unknown[] = []
		const orig = console.error
		console.error = (...a: unknown[]) => {
			errors.push(a[0])
		}

		try {
			const app = new Elysia()
				.get('/sync', () => 'sync')
				.use(Promise.reject(new Error('boom')))

			let caught: unknown
			try {
				await app.modules
			} catch (e) {
				caught = e
			}
			expect((caught as Error)?.message).toBe('boom')

			const res = await app.handle('/sync').then((r) => r.text())
			expect(res).toBe('sync')
			expect(errors.length).toBeGreaterThan(0)
		} finally {
			console.error = orig
		}
	})

	it.each([
		['Error', new Error('first-fail')],
		['undefined', undefined],
		['null', null]
	] as const)(
		'preserves a first %s rejection across repeated app.modules reads',
		async (_name, failure) => {
			const errors: unknown[] = []
			const orig = console.error
			console.error = (...a: unknown[]) => {
				errors.push(a[0])
			}

			try {
				const app = new Elysia()
					.use(Promise.reject(failure))
					.use(Promise.reject(new Error('later-fail')))
				const current = await Promise.allSettled([
					app.modules,
					app.modules
				])

				for (const result of current) {
					expect(result.status).toBe('rejected')
					if (result.status === 'rejected')
						expect(result.reason).toBe(failure)
				}

				const [later] = await Promise.allSettled([app.modules])
				expect(later.status).toBe('rejected')
				if (later.status === 'rejected')
					expect(later.reason).toBe(failure)
			} finally {
				console.error = orig
			}
		}
	)

	it.each([
		['undefined', undefined],
		['null', null]
	] as const)(
		'preserves %s thrown while applying a resolved plugin',
		async (_name, failure) => {
			const orig = console.error
			console.error = () => {}

			try {
				const app = new Elysia()
					.use(
						Promise.resolve(() => {
							throw failure
						})
					)
					.use(Promise.reject(new Error('later-fail')))

				for (const result of await Promise.allSettled([
					app.modules,
					app.modules
				])) {
					expect(result.status).toBe('rejected')
					if (result.status === 'rejected')
						expect(result.reason).toBe(failure)
				}
			} finally {
				console.error = orig
			}
		}
	)

	it('accepts a new plugin after a previous rejection is observed', async () => {
		const errors: unknown[] = []
		const orig = console.error
		console.error = (...a: unknown[]) => {
			errors.push(a[0])
		}

		try {
			const app = new Elysia().use(Promise.reject(new Error('first')))

			try {
				await app.modules
			} catch {}

			app.use(Promise.resolve(new Elysia().get('/p', () => 'p')))

			await expect(app.modules).resolves.toBeUndefined()

			const res = await app.handle('/p').then((r) => r.text())
			expect(res).toBe('p')
		} finally {
			console.error = orig
		}
	})

	it('resolves app.modules when no plugin is pending', async () => {
		const app = new Elysia()
		await expect(app.modules).resolves.toBeUndefined()
	})
})
