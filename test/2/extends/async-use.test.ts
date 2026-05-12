import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'

describe('async use', () => {
	it('accepts Promise<Elysia>', async () => {
		const plugin = new Elysia().get('/p', () => 'plugin')
		const app = new Elysia().use(Promise.resolve(plugin))

		await app.modules

		const res = await app.handle('/p').then((r) => r.text())
		expect(res).toBe('plugin')
	})

	it('accepts async () => Elysia', async () => {
		const app = new Elysia().use(
			async () => new Elysia().get('/p', () => 'plugin')
		)

		await app.modules

		const res = await app.handle('/p').then((r) => r.text())
		expect(res).toBe('plugin')
	})

	it('accepts Promise<{ default }> (dynamic import shape)', async () => {
		const plugin = new Elysia().get('/p', () => 'plugin')
		const app = new Elysia().use(Promise.resolve({ default: plugin }))

		await app.modules

		const res = await app.handle('/p').then((r) => r.text())
		expect(res).toBe('plugin')
	})

	it('sync calls chained after async use run eagerly', async () => {
		// Async plugins are background work — they don't gate subsequent
		// sync registrations. /sync registers immediately and is reachable
		// without waiting on the pending plugin.
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

	it('rebuilds router after drain so plugin routes become reachable', async () => {
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

	it('async route is unreachable before drain, reachable after (via app.handle)', async () => {
		let resolveLater!: (v: any) => void
		const pending = new Promise((res) => {
			resolveLater = res
		})

		const app = new Elysia()
			.get('/sync', () => 'sync')
			.use(pending as Promise<any>)

		// Before drain: /async doesn't exist yet, /sync does.
		const syncBefore = await app
			.handle('/sync')
			.then((r) => [r.status, r.text()] as const)
		expect(syncBefore[0]).toBe(200)
		expect(await syncBefore[1]).toBe('sync')

		const asyncBefore = await app.handle('/async').then((r) => r.status)
		expect(asyncBefore).toBe(404)

		// Resolve the plugin and let the chain settle (#tryDrain rebuilds the
		// router internally — same path the Bun adapter relies on for reload).
		resolveLater(new Elysia().get('/async', () => 'async'))
		await app.modules

		const asyncAfter = await app.handle('/async').then((r) => r.text())
		expect(asyncAfter).toBe('async')

		const syncAfter = await app.handle('/sync').then((r) => r.text())
		expect(syncAfter).toBe('sync')
	})

	it('rejected async use does not stall drain (pending-- still fires)', async () => {
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
			// app.modules surfaces the rejection (issue 6).
			expect((caught as Error)?.message).toBe('boom')

			// Sync route registered before the async use is unaffected.
			const res = await app.handle('/sync').then((r) => r.text())
			expect(res).toBe('sync')
			expect(errors.length).toBeGreaterThan(0)
		} finally {
			console.error = orig
		}
	})

	it('app.modules rejects with first error (issue 6)', async () => {
		const errors: unknown[] = []
		const orig = console.error
		console.error = (...a: unknown[]) => {
			errors.push(a[0])
		}

		try {
			const app = new Elysia().use(
				Promise.reject(new Error('first-fail'))
			)

			let caught: unknown
			try {
				await app.modules
			} catch (e) {
				caught = e
			}
			expect((caught as Error)?.message).toBe('first-fail')

			// Multiple awaits see the same rejection (no consume-on-read).
			let caught2: unknown
			try {
				await app.modules
			} catch (e) {
				caught2 = e
			}
			expect((caught2 as Error)?.message).toBe('first-fail')
		} finally {
			console.error = orig
		}
	})

	it('a fresh chain after a handled failure starts clean', async () => {
		const errors: unknown[] = []
		const orig = console.error
		console.error = (...a: unknown[]) => {
			errors.push(a[0])
		}

		try {
			const app = new Elysia().use(Promise.reject(new Error('first')))

			// Drain the failed chain; #error is captured.
			try {
				await app.modules
			} catch {}

			// Start a new async use — #error should reset since #ready
			// was undefined when the new chain started.
			app.use(Promise.resolve(new Elysia().get('/p', () => 'p')))

			await expect(app.modules).resolves.toBeUndefined()

			const res = await app.handle('/p').then((r) => r.text())
			expect(res).toBe('p')
		} finally {
			console.error = orig
		}
	})

	it('app.modules resolves to a no-op promise when nothing is pending', async () => {
		const app = new Elysia()
		await expect(app.modules).resolves.toBeUndefined()
	})
})
