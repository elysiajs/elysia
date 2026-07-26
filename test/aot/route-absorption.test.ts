import { describe, expect, it } from 'bun:test'

import { Elysia, t, type AnyElysia } from '../../src'
import type { InternalRoute } from '../../src/types'
import { req } from '../utils'

const route = (app: AnyElysia, path: string): InternalRoute => {
	const found = app['~routes']?.find((entry) => entry[1] === path)
	if (!found) throw new Error(`Missing route ${path}`)

	return found
}

const expectOwner = (root: AnyElysia, path: string, owner: AnyElysia) =>
	expect(route(root, path)[3]).toBe(owner)

describe('route absorption', () => {
	it('preserves lifecycle order and error recovery through absorption', async () => {
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

		expectOwner(root, '/hook', lifecycle)
		expectOwner(root, '/error', error)
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

		expectOwner(root, '/macro', macro)
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

		expectOwner(root, '/model', plugin)
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

		expectOwner(root, '/ordered', plugin)
		await expect((await root.handle(req('/ordered'))).text()).resolves.toBe(
			'ok'
		)
		expect(order).toEqual(['before-use', 'after-use', 'handler'])
	})

	it('does not mutate a plain plugin reused by two roots', async () => {
		const plugin = new Elysia().get('/shared', () => 'shared')
		const rootA = new Elysia().use(plugin)
		const rootB = new Elysia().use(plugin)

		expectOwner(rootA, '/shared', plugin)
		expectOwner(rootB, '/shared', plugin)
		expect(route(plugin, '/shared')[3]).toBe(plugin)
		await expect((await rootA.handle(req('/shared'))).text()).resolves.toBe(
			'shared'
		)
		await expect((await rootB.handle(req('/shared'))).text()).resolves.toBe(
			'shared'
		)
	})

	it('preserves static response owners and native response behavior', async () => {
		const response = new Response('static', {
			headers: { 'x-static': 'yes' }
		})
		const plugin = new Elysia().get('/static', response)
		const root = new Elysia().use(plugin)

		expectOwner(root, '/static', plugin)
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
