import { describe, it, expect, afterEach } from 'bun:test'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'

import type { Elysia } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	DEURI_IMPORTER_FILTER,
	ROUTER_IMPORTER_FILTER
} from '../../src/plugin/aot/core'
import { aot as bunAot } from '../../src/plugin/aot/bun'
import { createAotPluginHooks } from '../../src/plugin/aot/hooks'
import * as resolvers from '../../src/compile/handler/param-resolvers'
import { json, req } from '../utils'

/**
 * Module stubs beyond the handler JIT: each drops a runtime module only when
 * the build-time replay proves no request can reach it, and the controls pin
 * that an app using the feature keeps the real module and still serves.
 * A stub that fires on a using app would throw on the first request, so the
 * served responses are the regression signal, not just the bundle text
 */

const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')
const ROUTE_SHAPE_FROM = resolve(
	import.meta.dir,
	'../../src/compile/handler/route-shape.ts'
)

/** Error text of each stub, present in the bundle iff the stub applied */
const MARKER = {
	query: 'query parser was stripped',
	parse: 'body parser was stripped',
	router: 'dynamic router was stripped',
	schemaSnapshot: 'schema snapshot was stripped',
	cookieJar: 'response set a cookie'
} as const

/** Text only the real module carries, absent once it is stubbed */
const REAL = {
	query: 'function parseQueryFromURL(input',
	parse: 'function parseFormData(',
	router: 'wildcardStore',
	schemaSnapshot: 'function deepCloneSchema',
	cookieJar: 'function serialize(name'
} as const

/** `deuri` ships with the router: `decodeParams` runs only after a router hit */
const REAL_DEURI = 'TRANSITION_MASK'
const DEURI_MARKER = 'param decoder was stripped'

type Stub = keyof typeof MARKER

const built: string[] = []

async function build(name: string) {
	const entry = `test/aot/fixtures/stub-modules-${name}-app.ts`
	const result = await Bun.build({
		entrypoints: [entry],
		plugins: [
			bunAot(entry, {
				registerFrom: REGISTER_FROM,
				routeShapeFrom: ROUTE_SHAPE_FROM
			})
		],
		target: 'bun'
	})
	if (!result.success)
		throw new Error(
			`build failed: ${result.logs.map((l) => l.message).join('\n')}`
		)
	return await result.outputs[0]!.text()
}

const stubbed = (text: string) =>
	Object.fromEntries(
		(Object.keys(MARKER) as Stub[]).map((stub) => {
			const marker = text.includes(MARKER[stub])
			// a stub that applied must also have dropped the real module
			expect(text.includes(REAL[stub])).toBe(!marker)
			return [stub, marker]
		})
	) as Record<Stub, boolean>

async function load(text: string) {
	const tmp = resolve(
		import.meta.dir,
		`_stub-modules.${Date.now()}.${Math.random().toString(36).slice(2)}.mjs`
	)
	built.push(tmp)
	await Bun.write(tmp, text)

	const previous = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1' // skip the bundle's app.listen on import
	try {
		const mod: any = await import(tmp)
		return (mod.app ?? mod.default) as Elysia<any, any>
	} finally {
		if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previous
	}
}

afterEach(async () => {
	Compiled.clear()
	Validator.clear()
	delete process.env.ELYSIA_AOT_BUILD
	for (const f of built.splice(0)) await rm(f, { force: true })
})

describe('AOT module stubs', () => {
	it('stubs query, body parse, router, schema snapshot and cookie jar for a static app', async () => {
		const text = await build('static')
		expect(stubbed(text)).toEqual({
			query: true,
			parse: true,
			router: true,
			schemaSnapshot: true,
			cookieJar: true
		})

		// nothing validates: the error path's brand check keeps no class
		expect(text).not.toContain('class ValidationError')
		expect(text).toContain(DEURI_MARKER)
		expect(text).not.toContain(REAL_DEURI)

		const app = await load(text)
		const res = await app.handle(req('/?ignored=1'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('Hello World')

		// a schema-free hook passes through the snapshot stub
		await expect(
			app.handle(req('/hook')).then((r) => r.text())
		).resolves.toBe('hooked')

		// 404 installs the lazy `query` getter, nobody reads it
		expect((await app.handle(req('/nope?q=1'))).status).toBe(404)
	})

	it('keeps the router for a dynamic path', async () => {
		const text = await build('param')
		expect(stubbed(text)).toEqual({
			query: true,
			parse: true,
			router: false,
			schemaSnapshot: true,
			cookieJar: true
		})
		expect(text).toContain(REAL_DEURI)
		expect(text).not.toContain(DEURI_MARKER)

		const app = await load(text)
		await expect(
			app.handle(req('/id/42')).then((r) => r.text())
		).resolves.toBe('42')
		await expect(
			app.handle(req('/id/a%20b')).then((r) => r.text())
		).resolves.toBe('a b')
		expect((await app.handle(req('/id'))).status).toBe(404)
	})

	it('keeps the query parser when a handler reads query', async () => {
		const text = await build('query')
		expect(stubbed(text).query).toBe(false)

		const app = await load(text)
		await expect(
			app.handle(req('/?name=a%20b')).then((r) => r.text())
		).resolves.toBe('a b')
	})

	it('keeps schema snapshot (and the body parser path to parseQuery) for a schema route', async () => {
		const text = await build('body')
		expect(stubbed(text)).toMatchObject({
			// `pd` can parse a urlencoded body through parseQuery
			query: false,
			parse: false,
			schemaSnapshot: false,
			router: true
		})
		expect(text).toContain('class ValidationError')

		const app = await load(text)
		const ok = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				body: 'name=f'
			})
		)
		await expect(ok.text()).resolves.toBe('f')
		expect((await app.handle(req('/', json({ name: 1 })))).status).toBe(422)
	})

	it('keeps the body-parse table for a named parser without a schema', async () => {
		const text = await build('parser')
		expect(stubbed(text).parse).toBe(false)

		const app = await load(text)
		await expect(
			app.handle(req('/', json({ name: 'f' }))).then((r) => r.json())
		).resolves.toEqual({ name: 'f' })
	})

	it('keeps the cookie jar and serializer when a route reads cookies', async () => {
		const text = await build('cookie')
		expect(stubbed(text).cookieJar).toBe(false)

		const app = await load(text)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('ok')
		expect(res.headers.getAll('set-cookie')).toEqual(['name=set; Path=/'])
	})

	it('keeps the query parser when a root error hook reads query on the 404 path', async () => {
		const text = await build('root-error-query')
		expect(stubbed(text).query).toBe(false)

		const app = await load(text)
		await expect(
			app.handle(req('/nope?q=x')).then((r) => r.text())
		).resolves.toBe('missing x')
	})

	it('keeps the cookie serializer when a root hook writes set.cookie', async () => {
		const text = await build('root-set-cookie')
		expect(stubbed(text).cookieJar).toBe(false)

		const app = await load(text)
		const res = await app.handle(req('/nope'))
		expect(res.status).toBe(404)
		expect(res.headers.getAll('set-cookie')).toEqual(['seen=1'])
	})

	it('stubs only the memoirist Elysia imports, a user import keeps the real one', async () => {
		const text = await build('user-memoirist')
		// Elysia's routes are static, so its import still gets the stub
		expect(text).toContain(MARKER.router)
		expect(text).toContain(REAL.router)

		const app = await load(text)
		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('found')
	})

	it('stubs only the fetch handler deuri import, a user import keeps the real one', async () => {
		const text = await build('user-deuri')
		expect(text).toContain(DEURI_MARKER)
		expect(text).toContain(REAL_DEURI)

		const app = await load(text)
		await expect(app.handle(req('/')).then((r) => r.text())).resolves.toBe(
			'a b'
		)
	})

	// replaying a handler resolves only its own aliases, so the table needs
	// exactly their union: a missing one would fail every replay of the route
	it('prunes the link-resolver table to the aliases the manifest uses', async () => {
		const entry = 'test/aot/fixtures/stub-modules-links-app.ts'
		const hooks = createAotPluginHooks(entry, {
			registerFrom: REGISTER_FROM,
			routeShapeFrom: ROUTE_SHAPE_FROM
		})
		await hooks.buildStart()

		const used = new Set<string>()
		for (const [, list] of hooks
			.load('\0elysia/compiled')!
			.matchAll(/_a\d+ = (\[[^\]]*\])/g))
			for (const name of JSON.parse(list!) as string[])
				used.add(/^v[rs]\d+$/.test(name) ? 'va' : name)

		// cookie jar, body validation and the route error hook all link
		for (const name of ['bcj', 'cc', 'va', 'pj', 'er', 'fbr'])
			expect(used).toContain(name)

		const table = hooks.transform(
			'',
			resolve(import.meta.dir, '../../src/compile/handler/param-table.ts')
		)!
		const kept = /export const handlerParams = \{ ([^}]*) \}/
			.exec(table)![1]!
			.split(', ')
		expect(kept.sort()).toEqual([...used].sort())
		expect(kept.length).toBeLessThan(Object.keys(resolvers).length)

		const text = await build('links')
		// the stream tee is only reachable through its `tee` resolver
		expect(text).not.toContain('function tee(')

		const app = await load(text)
		const cookie = await app.handle(req('/cookie'))
		await expect(cookie.text()).resolves.toBe('ok')
		expect(cookie.headers.getAll('set-cookie')).toEqual([
			'name=set; Path=/'
		])
		await expect(
			app.handle(req('/stream')).then((r) => r.text())
		).resolves.toBe('ab')
		await expect(
			app.handle(req('/body', json({ name: 'f' }))).then((r) => r.text())
		).resolves.toBe('f')
		expect((await app.handle(req('/body', json({ name: 1 })))).status).toBe(
			422
		)
		await expect(
			app.handle(req('/error')).then((r) => r.text())
		).resolves.toBe('handled')
	})

	// `k` is only comparable through the walker the manifest installs: a
	// manifest without it must not replay (and a sealed bundle has no JIT to
	// fall back to), it must not serve the captured code unverified
	it('refuses replay when the manifest does not install routeShape', async () => {
		const text = await build('static')
		const install = 'Compiled.routeShape = routeShape'
		expect(text).toContain(install)
		expect(text).toContain('field*') // the walker ships with the manifest

		const app = await load(text.replace(install, ''))
		app.onError(({ error }) => (error as Error).message)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(500)
		await expect(res.text()).resolves.toContain(
			'differs from the AOT build'
		)
	})

	it('fails the replay loudly when an alias is missing from the pruned table', async () => {
		const text = await build('static')
		// a manifest asking for a resolver the build did not keep
		const tampered = text.replace(/(_a\d+ = \[)"rt"/, '$1"tee", "rt"')
		expect(tampered).not.toBe(text)

		const app = await load(tampered)
		app.onError(({ error }) => (error as Error).message)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(500)
		await expect(res.text()).resolves.toContain('missing "tee" param')
		// the other route keeps replaying
		await expect(
			app.handle(req('/hook')).then((r) => r.text())
		).resolves.toBe('hooked')
	})

	// every filter is a path suffix: only a module under the resolved
	// package's dist/ or src/ may match it, a user file at a mirrored path
	// keeps its code (it would throw at import if replaced)
	it('stubs only modules under the resolved package root', async () => {
		const text = await build('mirrored-path')
		expect(stubbed(text)).toMatchObject({ query: true, router: true })
		expect(text).toContain('user parse-query')
		expect(text).toContain(DEURI_MARKER)
		expect(text).toContain(REAL_DEURI)

		const app = await load(text)
		await expect(app.handle(req('/')).then((r) => r.text())).resolves.toBe(
			'user parse-query'
		)
		await expect(
			app.handle(req('/decoded')).then((r) => r.text())
		).resolves.toBe('a b')
	})

	it('scopes the router stub to an Elysia importer', () => {
		const matches = (path: string) => ROUTER_IMPORTER_FILTER.test(path)

		expect(matches('/x/node_modules/elysia/dist/base.mjs')).toBe(true)
		expect(matches('/x/node_modules/elysia/dist/base.js')).toBe(true)
		expect(matches('/x/elysia/src/base.ts')).toBe(true)
		expect(matches('/x/elysia/src/ws/route.ts')).toBe(true)
		expect(matches('/app/src/index.ts')).toBe(false)
		expect(matches('/x/node_modules/elysia/dist/utils.mjs')).toBe(false)
	})

	it('scopes the deuri stub to the fetch handler importer', () => {
		const matches = (path: string) => DEURI_IMPORTER_FILTER.test(path)

		expect(matches('/x/node_modules/elysia/dist/handler/fetch.mjs')).toBe(
			true
		)
		expect(matches('/x/elysia/src/handler/fetch.ts')).toBe(true)
		expect(matches('/x/elysia/src/parse-query.ts')).toBe(false)
		expect(matches('/x/elysia/src/cookie/utils.ts')).toBe(false)
		expect(matches('/app/src/index.ts')).toBe(false)
	})
})
