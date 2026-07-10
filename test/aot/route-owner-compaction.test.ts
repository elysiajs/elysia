import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import type { InternalRoute } from '../../src/types'
import { req } from '../utils'

const route = (app: Elysia, path: string): InternalRoute => {
	const found = app['~routes']?.find((entry) => entry[1] === path)
	if (!found) throw new Error(`Missing route ${path}`)

	return found
}

const expectFullOwner = (root: Elysia, path: string, owner: Elysia) =>
	expect(route(root, path)[3]).toBe(owner)

const expectCompactOwner = (root: Elysia, path: string, owner: Elysia) => {
	const compact = route(root, path)[3]
	expect(compact).not.toBe(owner)
	expect(compact).not.toBe(root)
	expect(Object.isFrozen(compact)).toBeTrue()

	return compact
}

describe('absorbed route owner compaction', () => {
	it('shares one immutable owner for plain unnamed and named plugins', async () => {
		const unnamed = new Elysia().get('/unnamed', () => 'unnamed')
		const named = new Elysia({ name: 'plain-owner' }).get(
			'/named',
			() => 'named'
		)
		const root = new Elysia().use(unnamed).use(named)

		const unnamedOwner = expectCompactOwner(root, '/unnamed', unnamed)
		const namedOwner = expectCompactOwner(root, '/named', named)
		expect(namedOwner).toBe(unnamedOwner)
		expect(route(unnamed, '/unnamed')[3]).toBe(unnamed)
		expect(route(named, '/named')[3]).toBe(named)
		await expect((await root.handle(req('/unnamed'))).text()).resolves.toBe(
			'unnamed'
		)
		await expect((await root.handle(req('/named'))).text()).resolves.toBe(
			'named'
		)
	})

	it('preserves lifecycle and error owners', async () => {
		const order: string[] = []
		const lifecycle = new Elysia()
			.beforeHandle(() => void order.push('plugin'))
			.get('/hook', () => 'hook')
		const error = new Elysia()
			.error(() => 'recovered')
			.get('/error', () => {
				throw new Error('boom')
			})
		const root = new Elysia().use(lifecycle).use(error)

		expectFullOwner(root, '/hook', lifecycle)
		expectFullOwner(root, '/error', error)
		await expect((await root.handle(req('/hook'))).text()).resolves.toBe(
			'hook'
		)
		expect(order).toEqual(['plugin'])
		await expect((await root.handle(req('/error'))).text()).resolves.toBe(
			'recovered'
		)
	})

	it('preserves macro owners and macro-applied local hooks', async () => {
		const macro = new Elysia()
			.macro({
				marked: {
					beforeHandle({ set }: any) {
						set.headers['x-macro'] = 'yes'
					}
				}
			})
			.get('/macro', { marked: true } as any, () => 'macro')
		const root = new Elysia().use(macro)

		expectFullOwner(root, '/macro', macro)
		const response = await root.handle(req('/macro'))
		expect(await response.text()).toBe('macro')
		expect(response.headers.get('x-macro')).toBe('yes')
	})

	it('preserves group and plugin-inside-group owners', async () => {
		const grouped = new Elysia().group('/group', (group) =>
			group.get('/own', () => 'group')
		)
		const groupedOwner = route(grouped, '/group/own')[3]
		const nested = new Elysia().get('/nested', () => 'nested')
		const pluginInGroup = new Elysia().group('/scope', (group) =>
			group.use(nested)
		)
		const nestedOwner = route(pluginInGroup, '/scope/nested')[3]
		const root = new Elysia().use(grouped).use(pluginInGroup)

		expect(route(root, '/group/own')[3]).toBe(groupedOwner)
		expect(route(root, '/scope/nested')[3]).toBe(nestedOwner)
		await expect(
			(await root.handle(req('/group/own'))).text()
		).resolves.toBe('group')
		await expect(
			(await root.handle(req('/scope/nested'))).text()
		).resolves.toBe('nested')
	})

	it('preserves model-string owners after models merge', async () => {
		const plugin = new Elysia()
			.model('Reply', t.Object({ value: t.String() }))
			.get('/model', { response: 'Reply' }, () => ({ value: 'ok' }))
		const root = new Elysia().use(plugin)

		expectFullOwner(root, '/model', plugin)
		await expect(
			(await root.handle(req('/model'))).json()
		).resolves.toEqual({
			value: 'ok'
		})
	})

	it('preserves root hook order before and after use', async () => {
		const order: string[] = []
		const plugin = new Elysia().get('/ordered', () => {
			order.push('handler')
			return 'ok'
		})
		const root = new Elysia()
			.beforeHandle(() => void order.push('before-use'))
			.use(plugin)
			.beforeHandle(() => void order.push('after-use'))

		expectCompactOwner(root, '/ordered', plugin)
		await expect((await root.handle(req('/ordered'))).text()).resolves.toBe(
			'ok'
		)
		expect(order).toEqual(['before-use', 'after-use', 'handler'])
	})

	it('does not mutate a plain plugin reused by two roots', async () => {
		const plugin = new Elysia().get('/shared', () => 'shared')
		const rootA = new Elysia().use(plugin)
		const rootB = new Elysia().use(plugin)

		const ownerA = expectCompactOwner(rootA, '/shared', plugin)
		const ownerB = expectCompactOwner(rootB, '/shared', plugin)
		expect(ownerA).toBe(ownerB)
		expect(route(plugin, '/shared')[3]).toBe(plugin)
		await expect((await rootA.handle(req('/shared'))).text()).resolves.toBe(
			'shared'
		)
		await expect((await rootB.handle(req('/shared'))).text()).resolves.toBe(
			'shared'
		)
	})

	it('keeps websocket, mount, configured, and AOT-build owners full', () => {
		const websocket = new Elysia({ websocket: {} as any }).ws(
			'/ws',
			() => undefined
		)
		const mounted = new Elysia().mount('/mount', () => new Response('ok'))
		const configured = new Elysia({ strictPath: true }).get(
			'/configured',
			() => 'ok'
		)
		const previous = process.env.ELYSIA_AOT_BUILD
		const aot = new Elysia().get('/aot', () => 'aot')
		let aotRoot: Elysia
		try {
			process.env.ELYSIA_AOT_BUILD = '1'
			aotRoot = new Elysia().use(aot)
		} finally {
			if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = previous
		}

		expectFullOwner(new Elysia().use(websocket), '/ws', websocket)
		for (const entry of mounted['~routes'] ?? [])
			expectFullOwner(new Elysia().use(mounted), entry[1], mounted)
		expectFullOwner(new Elysia().use(configured), '/configured', configured)
		expectFullOwner(aotRoot!, '/aot', aot)
	})

	it('preserves static response owners and native response behavior', async () => {
		const response = new Response('static', {
			headers: { 'x-static': 'yes' }
		})
		const plugin = new Elysia().get('/static', response)
		const root = new Elysia().use(plugin)

		expectFullOwner(root, '/static', plugin)
		const handled = await root.handle(req('/static'))
		expect(await handled.text()).toBe('static')
		expect(handled.headers.get('x-static')).toBe('yes')
	})

	it('keeps public routes and lazy/eager handlers equivalent', async () => {
		const build = () =>
			new Elysia().use(
				new Elysia({ name: 'compile-owner' }).get(
					'/compile',
					() => 'compiled'
				)
			)
		const lazy = build()
		const eager = build()
		;(eager as any).compile()

		expect(
			lazy.routes.map(({ method, path }) => ({ method, path }))
		).toEqual(eager.routes.map(({ method, path }) => ({ method, path })))
		await expect((await lazy.handle(req('/compile'))).text()).resolves.toBe(
			'compiled'
		)
		await expect(
			(await eager.handle(req('/compile'))).text()
		).resolves.toBe('compiled')
	})
})
