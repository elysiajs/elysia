import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'
import { JITProbe } from '../../src/compile/jit-probe'

/**
 * `compileHandler` short-circuits a bare route to `createInlineHandler` before
 * `describeRoute` runs. That is only sound if every route it claims would have
 * reached the *same* closure through the full pipeline, so each case pins both
 * halves of the contract:
 *
 * 1. the response is byte-identical to the same route forced down the full
 *    codegen path — an extra no-op `beforeHandle` disqualifies the route from
 *    every inline lane, so the reference app is compiled by `new Function`
 * 2. which lane the route actually took, read off the `JITProbe` tripwire:
 *      []                                → the fast path returned early
 *      ['sucrose']                       → declined; inlined by the JIT's own
 *                                          terminal check (the backstop)
 *      ['sucrose','handler:new-function'] → declined; full codegen
 *
 * Without (2) the suite would still pass if the fast path silently stopped
 * engaging, and without (1) it would pass if the fast path claimed a route the
 * pipeline compiles differently.
 */

interface Case {
	async: boolean
	method: 'GET' | 'POST'
	defaultHeaders: boolean
	destructure: boolean
	traced: boolean
}

const cases: Case[] = []
for (const async of [false, true])
	for (const method of ['GET', 'POST'] as const)
		for (const defaultHeaders of [false, true])
			for (const destructure of [false, true])
				for (const traced of [false, true])
					cases.push({
						async,
						method,
						defaultHeaders,
						destructure,
						traced
					})

const label = (c: Case) =>
	[
		c.async ? 'async' : 'sync',
		c.method,
		c.defaultHeaders ? '+headers' : '-headers',
		c.destructure ? '+ctx' : '-ctx',
		c.traced ? '+trace' : '-trace'
	].join(' ')

// The fast path is only claimed for a bodyless method, on the compact response
// lane, with a handler that names no context: everything else must decline
const expectsFastPath = (c: Case) =>
	c.method === 'GET' && !c.defaultHeaders && !c.destructure && !c.traced

// Sources are fixed per shape so `sucrose` sees the same text in both apps
const handlerOf = ({ async, destructure }: Case) =>
	async
		? destructure
			? async ({ query }: any) => `q:${query.a ?? ''}`
			: async () => 'ok'
		: destructure
			? ({ query }: any) => `q:${query.a ?? ''}`
			: () => 'ok'

const appOf = (c: Case, forceCodegen: boolean) => {
	let app: any = new Elysia()

	if (c.traced)
		app = app.use(trace()).trace(({ onHandle }: any) => {
			onHandle(() => {})
		})

	if (c.defaultHeaders) app = app.headers({ 'x-default': 'base' })

	const handler = handlerOf(c)
	const verb = c.method === 'GET' ? 'get' : 'post'

	// a route registered with *no* hook argument is the shape the fast path
	// looks for; the no-op `beforeHandle` is what forces the reference app off
	// every inline lane
	return forceCodegen
		? app[verb]('/x', { beforeHandle: () => {} }, handler)
		: app[verb]('/x', handler)
}

const requestOf = (c: Case) =>
	new Request(
		'http://localhost/x?a=1',
		c.method === 'POST' ? { method: 'POST' } : undefined
	)

const snapshot = async (response: Response) => ({
	status: response.status,
	body: await response.text(),
	headers: [...response.headers].sort()
})

const handleProbed = async (app: any, request: Request) => {
	JITProbe.begin()

	try {
		const response: Response = await app.handle(request)

		return { response, reasons: JITProbe.end().reasons }
	} catch (error) {
		JITProbe.end()

		throw error
	}
}

describe('compile: bare-route fast path parity', () => {
	for (const c of cases)
		it(`${label(c)} matches the full pipeline`, async () => {
			const fast = await handleProbed(appOf(c, false), requestOf(c))
			const reference = await appOf(c, true).handle(requestOf(c))

			expect(await snapshot(fast.response)).toEqual(
				await snapshot(reference)
			)

			if (expectsFastPath(c)) expect(fast.reasons).toEqual([])
			else expect(fast.reasons).toContain('sucrose')
		})

	it('a declined route still inlines through the JIT terminal check', async () => {
		// the backstop is what makes declining cheap rather than wrong: default
		// headers move the route to the set-aware inline lane, not to codegen
		const { reasons } = await handleProbed(
			new Elysia().headers({ 'x-default': 'base' }).get('/x', () => 'ok'),
			new Request('http://localhost/x')
		)

		expect(reasons).toEqual(['sucrose'])
	})
})

/**
 * The fast path proves "this handler names no context" syntactically, because
 * `sucrose` cannot be imported into `compile/handler/index.ts` without pinning
 * the analyzer into every AOT-stripped bundle. These are the shapes where
 * `sucrose` widens inference to *every* channel regardless of the parameter
 * list — if the syntactic gate ever stops mirroring them, a route that mutates
 * `set` gets compiled onto the compact lane and silently loses its mutation.
 */
describe('compile: bare-route fast path declines sucrose-opaque handlers', () => {
	it('declines a handler that reaches the context through `arguments`', async () => {
		const app = new Elysia().get('/x', function () {
			// eslint-disable-next-line prefer-rest-params
			const context: any = arguments[0]
			context.set.status = 418

			return 'teapot'
		})

		const { response, reasons } = await handleProbed(
			app,
			new Request('http://localhost/x')
		)

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('teapot')
		expect(reasons).toContain('sucrose')
	})

	it('declines a bound handler (`[native code]` source)', async () => {
		const implementation = (context: any) => {
			context.set.status = 418

			return 'teapot'
		}

		const app = new Elysia().get('/x', implementation.bind(null) as any)

		const { response, reasons } = await handleProbed(
			app,
			new Request('http://localhost/x')
		)

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('teapot')
		expect(reasons).toContain('sucrose')
	})

	it('declines a handler with a forged own `toString`', async () => {
		const forged: any = () => 'ok'
		forged.toString = () => '({ set }) => { set.status = 418 }'

		const { response, reasons } = await handleProbed(
			new Elysia().get('/x', forged),
			new Request('http://localhost/x')
		)

		// the forgery cannot change what the handler *does*, only what the
		// compiler is allowed to assume — so the lane is the whole assertion
		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toBe('ok')
		expect(reasons).toContain('sucrose')
	})
})
