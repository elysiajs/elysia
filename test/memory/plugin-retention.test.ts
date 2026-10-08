import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

const PLUGINS = 40

// Plugins are minted in their own frame so no stale stack slot of the test
// body keeps one alive
function usePlugins(app: Elysia, refs: WeakRef<object>[]) {
	for (let i = 0; i < PLUGINS / 2; i++) {
		const inner = new Elysia().decorate(`inner${i}`, i)
		const outer = new Elysia().decorate(`outer${i}`, i).use(inner)

		app.use(outer)
		refs.push(new WeakRef(inner), new WeakRef(outer))
	}
}

// JSC scans the stack conservatively, so one dead plugin can survive a few
// collections in an unrelated stale slot. Poll on fresh tasks instead of
// trusting a single collection; a deref keeps its target until the task ends
const liveAfterGC = async (refs: WeakRef<object>[]) => {
	let live = refs.length

	for (let i = 0; i < 20 && live > 0; i++) {
		await Bun.sleep(1)
		Bun.gc(true)
		live = refs.filter((ref) => ref.deref() !== undefined).length
	}

	return live
}

describe('plugin retention', () => {
	// `.use()` runs at startup, but factories minting fresh unnamed plugins
	// (one per route group, per test app) would grow the parent and every
	// ancestor by the whole plugin instance
	it('does not retain unnamed plugins after .use()', async () => {
		const app = new Elysia()
		const refs: WeakRef<object>[] = []

		usePlugins(app, refs)

		// retaining plugins keeps all of them
		expect(await liveAfterGC(refs)).toBe(0)

		// the plugins still applied
		const res = await app
			.get('/', ({ inner19, outer19 }: any) => inner19 + outer19)
			.handle(new Request('http://localhost/'))
		expect(await res.text()).toBe('38')
	})

	// the app's chain links each plugin's hook registration; recording the
	// registering instance there (read only for a group/guard child's local
	// macros) would keep every hook-only plugin whole for the app's lifetime
	it('does not retain unnamed plugins that registered hooks', async () => {
		const app = new Elysia()
		const refs: WeakRef<object>[] = []
		let calls = 0

		useHookPlugins(app, refs, () => {
			calls++
		})

		expect(await liveAfterGC(refs)).toBe(0)

		// the hooks still applied, every one of them
		const res = await app
			.get('/', () => 'ok')
			.handle(new Request('http://localhost/'))
		expect(await res.text()).toBe('ok')
		expect(calls).toBe(PLUGINS)
	})
})

function useHookPlugins(
	app: Elysia,
	refs: WeakRef<object>[],
	hook: () => void
) {
	for (let i = 0; i < PLUGINS; i++) {
		const plugin = new Elysia({ as: 'plugin' }).beforeHandle(hook)

		app.use(plugin)
		refs.push(new WeakRef(plugin))
	}
}
