import { describe, expect, it } from 'bun:test'

import {
	resolveRouteTable,
	type RouteResolutionTable
} from '../../src/compile/route-resolution'

const table = (
	routes: readonly (readonly [method: string, path: string])[]
): RouteResolutionTable => ({
	length: routes.length,
	method: routes.map(([method]) => method),
	path: routes.map(([, path]) => path)
})

describe('route resolution', () => {
	it('keeps exact winners in original declaration order', () => {
		const resolution = resolveRouteTable(
			table([
				['GET', '/same'],
				['GET', '/other'],
				['GET', '/same'],
				['POST', '/same']
			])
		)

		expect(resolution.declarationIds).toEqual([1, 2, 3])
		expect(resolution.httpDeclarationIds).toEqual([1, 2, 3])
		expect(resolution.wsDeclarationIds).toEqual([])
		expect(resolution.staticRoutes.GET).toEqual({
			'/same': 2,
			'/other': 1
		})
		expect(resolution.staticRoutes.POST).toEqual({ '/same': 3 })
		expect(resolution.coverage).toEqual({
			declaredHttpRoutes: 4,
			winningHttpRoutes: 3,
			shadowedHttpRoutes: 1,
			declaredWSRoutes: 0,
			winningWSRoutes: 0,
			shadowedWSRoutes: 0
		})
	})

	it('uses Memoirist leaves to resolve structurally equivalent parameters', () => {
		const resolution = resolveRouteTable(
			table([
				['GET', '/dynamic/:id'],
				['GET', '/other/:id'],
				['GET', '/dynamic/:name']
			])
		)

		expect(resolution.declarationIds).toEqual([1, 2])
		expect(resolution.dynamicRouter?.find('GET', '/dynamic/value')).toEqual({
			store: 2,
			params: { name: 'value' }
		})
		expect(resolution.dynamicRouter?.find('GET', '/other/value')?.store).toBe(
			1
		)
		expect(resolution.coverage.shadowedHttpRoutes).toBe(1)
	})

	it('retains an optional declaration when only one of its leaves is replaced', () => {
		const resolution = resolveRouteTable(
			table([
				['GET', '/optional/:id?'],
				['GET', '/optional/:name']
			])
		)

		expect(resolution.declarationIds).toEqual([0, 1])
		expect(resolution.dynamicRouter?.find('GET', '/optional')?.store).toBe(0)
		expect(resolution.dynamicRouter?.find('GET', '/optional/value')).toEqual({
			store: 1,
			params: { name: 'value' }
		})
	})

	it('registers encoded dynamic aliases and preserves wildcard leaves', () => {
		const resolution = resolveRouteTable(
			table([
				['GET', '/café/:id'],
				['GET', '/wild/*']
			])
		)

		expect(resolution.declarationIds).toEqual([0, 1])
		expect(resolution.dynamicRouter?.find('GET', '/café/value')).toBeNull()
		expect(
			resolution.dynamicRouter?.find('GET', '/caf%C3%A9/value')?.store
		).toBe(0)
		expect(
			resolution.dynamicRouter?.find('GET', '/caf%C3%A9/value/')?.store
		).toBe(0)
		expect(resolution.dynamicRouter?.find('GET', '/wild/tail')?.store).toBe(1)
	})

	it('canonicalizes dynamic literals before resolving duplicate leaves', () => {
		const forward = resolveRouteTable(
			table([
				['GET', '/café/:id'],
				['GET', '/caf%C3%A9/:name']
			])
		)
		const reverse = resolveRouteTable(
			table([
				['GET', '/caf%C3%A9/:id'],
				['GET', '/café/:name']
			])
		)

		expect(forward.declarationIds).toEqual([1])
		expect(forward.dynamicRouter?.find('GET', '/caf%C3%A9/value')).toEqual({
			store: 1,
			params: { name: 'value' }
		})
		expect(reverse.declarationIds).toEqual([0, 1])
		expect(
			reverse.dynamicRouter?.find('GET', '/caf%25C3%25A9/value')?.store
		).toBe(0)
	})

	it('normalizes mixed optional and wildcard patterns without changing tokens', () => {
		const resolution = resolveRouteTable(
			table([['GET', '/café/:id?/résumé/*']])
		)

		expect(
			resolution.dynamicRouter?.find(
				'GET',
				'/caf%C3%A9/r%C3%A9sum%C3%A9/tail'
			)?.store
		).toBe(0)
		expect(
			resolution.dynamicRouter?.find(
				'GET',
				'/caf%C3%A9/value/r%C3%A9sum%C3%A9/tail'
			)?.store
		).toBe(0)
	})

	it('discards URL-unstable aliases instead of promoting canonical paths', () => {
		const staticResolution = resolveRouteTable(
			table([
				['GET', '/a/../b'],
				['GET', '/query?value'],
				['GET', '/fragment#value'],
				['GET', '/a\\b']
			])
		)
		const dynamicResolution = resolveRouteTable(
			table([
				['GET', '/a/../:id'],
				['GET', '/query?value/:id'],
				['GET', '/a\\b/:id']
			])
		)

		expect(staticResolution.staticRoutes.GET).toEqual({ '/a%5Cb': 3 })
		expect(staticResolution.declarationIds).toEqual([3])
		expect(staticResolution.coverage.shadowedHttpRoutes).toBe(3)
		expect(dynamicResolution.declarationIds).toEqual([2])
		expect(dynamicResolution.dynamicRouter?.find('GET', '/value')).toBeNull()
		expect(dynamicResolution.dynamicRouter?.find('GET', '/query')).toBeNull()
		expect(
			dynamicResolution.dynamicRouter?.find('GET', '/a%5Cb/value')?.store
		).toBe(2)
	})

	it('keeps custom, wildcard, HTTP, and WebSocket method namespaces separate', () => {
		const resolution = resolveRouteTable(
			table([
				['purge', '/cache'],
				['*', '/cache'],
				['WS', '/cache'],
				['GET', '/cache']
			])
		)

		expect(resolution.declarationIds).toEqual([0, 1, 2, 3])
		expect(resolution.httpDeclarationIds).toEqual([0, 1, 3])
		expect(resolution.wsDeclarationIds).toEqual([2])
		expect(resolution.staticRoutes.PURGE?.['/cache']).toBe(0)
		expect(resolution.staticRoutes['*']?.['/cache']).toBe(1)
		expect(resolution.staticRoutes.WS?.['/cache']).toBe(2)
		expect(resolution.staticRoutes.WS?.['/cache/']).toBe(2)
		expect(resolution.staticRoutes.GET?.['/cache']).toBe(3)
		expect(resolution.coverage.declaredHttpRoutes).toBe(3)
		expect(resolution.coverage.declaredWSRoutes).toBe(1)
	})

	it('resolves WebSocket static and dynamic duplicates independently', () => {
		const resolution = resolveRouteTable(
			table([
				['WS', '/socket'],
				['WS', '/socket'],
				['WS', '/room/:id'],
				['WS', '/room/:name']
			])
		)

		expect(resolution.declarationIds).toEqual([1, 3])
		expect(resolution.httpDeclarationIds).toEqual([])
		expect(resolution.wsDeclarationIds).toEqual([1, 3])
		expect(resolution.staticRoutes.WS).toEqual({
			'/socket': 1,
			'/socket/': 1
		})
		expect(resolution.dynamicRouter?.find('WS', '/room/value')).toEqual({
			store: 3,
			params: { name: 'value' }
		})
		expect(resolution.coverage).toEqual({
			declaredHttpRoutes: 0,
			winningHttpRoutes: 0,
			shadowedHttpRoutes: 0,
			declaredWSRoutes: 4,
			winningWSRoutes: 2,
			shadowedWSRoutes: 2
		})
	})

	it('materializes encoded and loose static aliases without stealing explicit paths', () => {
		const resolution = resolveRouteTable(
			table([
				['GET', '/café/'],
				['GET', '/x'],
				['GET', '/x/']
			])
		)

		expect(resolution.staticRoutes.GET).toEqual({
			'/caf%C3%A9/': 0,
			'/caf%C3%A9': 0,
			'/x': 1,
			'/x/': 2
		})
		expect(resolution.declarationIds).toEqual([0, 1, 2])
	})

	it('lets encoded aliases participate in normal last-write-wins resolution', () => {
		const forward = resolveRouteTable(
			table([
				['GET', '/café'],
				['GET', '/caf%C3%A9']
			])
		)
		const reverse = resolveRouteTable(
			table([
				['GET', '/caf%C3%A9'],
				['GET', '/café']
			])
		)

		expect(forward.staticRoutes.GET).toEqual({
			'/caf%C3%A9': 1,
			'/caf%25C3%25A9': 1
		})
		expect(forward.declarationIds).toEqual([1])
		expect(reverse.staticRoutes.GET).toEqual({
			'/caf%C3%A9': 1,
			'/caf%25C3%25A9': 0
		})
		expect(reverse.declarationIds).toEqual([0, 1])
	})

	it('drops optional leaves hidden by static HTTP and WebSocket winners', () => {
		const http = resolveRouteTable(
			table([
				['GET', '/optional/:id?'],
				['GET', '/optional/:name'],
				['GET', '/optional']
			])
		)
		const ws = resolveRouteTable(
			table([
				['WS', '/socket/:id?'],
				['WS', '/socket/:name'],
				['WS', '/socket']
			])
		)
		const wildcard = resolveRouteTable(
			table([
				['GET', '/fallback/:id?'],
				['GET', '/fallback/:name'],
				['*', '/fallback']
			])
		)
		const wildcardDynamic = resolveRouteTable(
			table([
				['*', '/method/:id?'],
				['*', '/method/:name'],
				['GET', '/method']
			])
		)

		expect(http.declarationIds).toEqual([1, 2])
		expect(http.coverage.shadowedHttpRoutes).toBe(1)
		expect(ws.declarationIds).toEqual([1, 2])
		expect(ws.coverage.shadowedWSRoutes).toBe(1)
		expect(wildcard.declarationIds).toEqual([1, 2])
		expect(wildcardDynamic.declarationIds).toEqual([0, 1, 2])
	})

	it('removes every loose alias in strict-path mode', () => {
		const resolution = resolveRouteTable(
			table([
				['GET', '/http/'],
				['GET', '/dynamic/:id'],
				['WS', '/socket']
			]),
			true
		)

		expect(resolution.staticRoutes.GET).toEqual({ '/http/': 0 })
		expect(resolution.staticRoutes.WS).toEqual({ '/socket': 2 })
		expect(resolution.dynamicRouter?.find('GET', '/dynamic/value')?.store).toBe(
			1
		)
		expect(
			resolution.dynamicRouter?.find('GET', '/dynamic/value/')
		).toBeNull()
	})

	it('returns an immutable result and rejects malformed declaration tables', () => {
		const resolution = resolveRouteTable(table([['GET', '/:id']]))

		expect(Object.isFrozen(resolution)).toBeTrue()
		expect(Object.isFrozen(resolution.declarationIds)).toBeTrue()
		expect(Object.isFrozen(resolution.staticRoutes)).toBeTrue()
		expect(Object.isFrozen(resolution.dynamicRouter)).toBeTrue()
		expect(Object.isFrozen(resolution.coverage)).toBeTrue()

		expect(() =>
			resolveRouteTable({ length: 1, method: [], path: [] })
		).toThrow('[ROUTE_RESOLUTION] invalid declaration table')
		expect(() =>
			resolveRouteTable({ length: 1, method: [''], path: ['/'] })
		).toThrow('[ROUTE_RESOLUTION] invalid declaration at 0')
	})
})
