import { describe, it, expect, afterAll, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Elysia, t } from '../../src'
import { aot as bunAot } from '../../src/plugin/aot/bun'
import {
	generateCompiledArtifacts,
	mergePlans,
	planFromReport
} from '../../src/plugin/aot/core'
import { captureArtifacts, emitModule } from '../../src/plugin/aot/source'
import type { JITProbeResult } from '../../src/compile/jit-probe'
import { evalRegistration } from './_manifest'

/**
 * One AOT bundle serves several apps: every exported app with a `name` gets
 * its own manifest, claimed at runtime by the app of that name. A manifest is
 * bound by ABI alone, so in an AOT process an app building a router without
 * its own manifest throws: compiling it live would hide that the wrong app
 * may hold a manifest, and with `strip` there is no live compiler to fall to.
 *
 * Runtime checks run the built bundle in a subprocess: importing it here
 * needs `ELYSIA_AOT_BUILD` to skip `.listen()`, and that env exempts the guard.
 */

const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')
const ROUTE_SHAPE_FROM = resolve(
	import.meta.dir,
	'../../src/compile/handler/route-shape.ts'
)
const fixture = (name: string) => resolve(import.meta.dir, 'fixtures', name)

const dir = mkdtempSync(join(tmpdir(), 'elysia-aot-multi-app-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// steps: [export, path, body?], POST when a body is given. A function export
// is called instead. Prints each step's [status, text] or thrown message.
const RUNNER = join(dir, 'run.mjs')
writeFileSync(
	RUNNER,
	`const [bundle, steps] = process.argv.slice(2)
const out = []
try {
	const mod = await import(bundle)
	for (const [name, path, body] of JSON.parse(steps))
		try {
			const res = typeof mod[name] === 'function'
				? await mod[name]()
				: await mod[name].handle(new Request('http://e.ly' + path, body === undefined ? undefined : {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body)
				}))
			out.push([res.status, await res.text()])
		} catch (error) {
			out.push(error.message)
		}
} catch (error) {
	out.push('import: ' + error.message)
}
console.log(JSON.stringify(out))
`
)

let built = 0
async function build(name: string, strip: boolean | 'auto') {
	const entry = fixture(name)
	const result = await Bun.build({
		entrypoints: [entry],
		outdir: join(dir, `${built++}`),
		plugins: [
			bunAot(entry, {
				registerFrom: REGISTER_FROM,
				routeShapeFrom: ROUTE_SHAPE_FROM,
				strip
			})
		],
		target: 'bun'
	})
	if (!result.success)
		throw new Error(result.logs.map((log) => log.message).join('\n'))

	const output = result.outputs[0]!
	return { path: output.path, text: await output.text() }
}

type Step = [name: string, path?: string, body?: unknown]

function serve(bundle: string, steps: Step[]): (string | [number, string])[] {
	const env: Record<string, string | undefined> = { ...process.env }
	delete env.ELYSIA_AOT_BUILD

	const run = Bun.spawnSync({
		cmd: [
			process.execPath,
			'--no-install',
			RUNNER,
			bundle,
			JSON.stringify(steps)
		],
		cwd: dir,
		env
	})
	if (!run.success) throw new Error(run.stderr.toString())

	return JSON.parse(run.stdout.toString().trim().split('\n').pop()!)
}

const status = (result: string | [number, string]) =>
	typeof result === 'string' ? result : result[0]

const MISSING = 'has no AOT manifest. Name and export it, .mount() ones too'

describe('AOT multi-app manifests', () => {
	// the issue: `app.use(api)` with both exported, `api.handle` threw "a second
	// Elysia app" because one manifest bound the first app to build
	it.each([['auto'], [false]] as const)(
		'serves each named app from its own manifest with strip: %p, in either order',
		async (strip) => {
			const { path, text } = await build('multi-app-named.ts', strip)
			expect(text).toContain(')(), "app")')
			expect(text).toContain(')(), "api")')
			// no live compiler, so every 2xx/422 below came from a manifest
			if (strip === 'auto')
				expect(text).toContain('handler compiler JIT was stripped')

			const state = (name: string): Step[] => [
				[name, '/api/state', { theme: 'x' }],
				[name, '/api/state', { theme: 1 }]
			]

			expect(
				serve(path, [...state('app'), ...state('api')]).map(status)
			).toEqual([200, 422, 200, 422])
			expect(
				serve(path, [...state('api'), ...state('app')]).map(status)
			).toEqual([200, 422, 200, 422])
		}
	)

	// verbatim, both unnamed: `api` is not captured, and building it must not
	// fall back to live JIT next to a sealed app without anyone noticing
	it.each([['auto'], [false]] as const)(
		'builds the unnamed issue repro and fails loud on the uncaptured app with strip: %p',
		async (strip) => {
			const { source } = await generateCompiledArtifacts(
				fixture('multi-app-unnamed.ts'),
				{
					registerFrom: REGISTER_FROM,
					routeShapeFrom: ROUTE_SHAPE_FROM,
					strip
				}
			)
			// one unkeyed registration: the unnamed `api` got no manifest
			expect(source.match(/^Compiled\.register\(/gm)).toHaveLength(1)
			expect(source).not.toContain('})(), "')

			const { path } = await build('multi-app-unnamed.ts', strip)
			const [app, api] = serve(path, [
				['app', '/api/state'],
				['api', '/api/state']
			])
			expect(app).toEqual([200, '{"theme":"system"}'])
			expect(api).toBe(`[elysia-aot] App "" ${MISSING}`)
		}
	)

	// an unnamed manifest is up for grabs by any unnamed app, eg. a hidden
	// `.mount(path, sub.fetch)` sub-app building first, so a multi-app build
	// registers none
	it('refuses a multi-app build whose primary app is unnamed', async () => {
		await expect(
			generateCompiledArtifacts(fixture('multi-app-unnamed-primary.ts'), {
				registerFrom: REGISTER_FROM,
				routeShapeFrom: ROUTE_SHAPE_FROM
			})
		).rejects.toThrow(
			"exports `app` with no name next to named Elysia apps (`api`): name it (new Elysia({ name: 'app' })), or stop exporting `api`"
		)
	})

	it('fails loud when a named app the build never captured builds a router', async () => {
		const { path } = await build('multi-app-hidden-named.ts', false)

		const [app, hidden] = serve(path, [['app', '/'], ['serveHidden']])
		expect(app).toEqual([200, 'ok'])
		expect(hidden).toBe(`[elysia-aot] App "hidden" ${MISSING}`)
	})

	it.each([
		['multi-app-duplicate-name.ts', '(first, second)'],
		['multi-app-duplicate-primary.ts', '(app, other)']
	])(
		'refuses %s: two exported apps would share one manifest key',
		async (name, exports) => {
			await expect(
				generateCompiledArtifacts(fixture(name), {
					registerFrom: REGISTER_FROM,
					routeShapeFrom: ROUTE_SHAPE_FROM
				})
			).rejects.toThrow(`exports two Elysia apps named "svc" ${exports}`)
		}
	)

	// 8e6253fa: `sub.fetch` builds the sub-app's router at mount, so it claimed
	// the parent's manifest and the parent silently compiled live, bypassing
	// validation under strip. The displaced parent must fail, pointing at .mount()
	it.each([['auto'], [false]] as const)(
		'fails the root when an unnamed .mount(path, sub.fetch) sub-app claimed first, strip: %p',
		async (strip) => {
			const { path } = await build('multi-app-steal-single.ts', strip)

			expect(serve(path, [['app', '/']])).toEqual([
				`[elysia-aot] App "" ${MISSING}`
			])
		}
	)

	// with no unnamed manifest the hidden sub-app can't claim one: it fails as
	// soon as `sub.fetch` builds it, before serving anything
	it('fails a hidden unnamed .mount(path, sub.fetch) sub-app at import in a multi-app build', async () => {
		const { path } = await build('multi-app-steal-multi.ts', 'auto')

		expect(serve(path, [['app', '/']])).toEqual([
			`import: [elysia-aot] App "" ${MISSING}`
		])
	})

	it.each([['auto'], [false]] as const)(
		'serves a named, exported mounted sub-app from its own manifest with strip: %p',
		async (strip) => {
			const { path } = await build('multi-app-mount-named.ts', strip)

			expect(
				serve(path, [
					['app', '/'],
					['app', '/x/hidden', { n: 1 }],
					['app', '/x/hidden', { n: 'a' }],
					['sub', '/hidden', { n: 2 }]
				]).map(status)
			).toEqual([200, 200, 422, 200])
		}
	)

	// `inner.handle` builds lazily, at its first request: the parent already
	// claimed the unnamed manifest, so the mounted request fails, the rest serves.
	// Only the status is observable: a production bundle redacts the 500 body
	it('fails the request of an unnamed .mount(path, sub.handle) sub-app', async () => {
		const { path } = await build('strip-auto-mount-app.ts', false)

		expect(
			serve(path, [
				['app', '/'],
				['app', '/sub/hello']
			]).map(status)
		).toEqual([200, 500])
	})

	// the build imports the entry with capture on, so `sub.fetch` captured the
	// sub-app's routes into the session the primary's capture then adopted:
	// `/hidden` landed in `app`'s manifest and the sub's `/q` codec merged
	// into `app`'s own `/q` slot
	it('keeps routers built while importing the entry out of the primary manifest', async () => {
		const { source, mode } = await generateCompiledArtifacts(
			fixture('multi-app-mount-leak.ts'),
			{ registerFrom: REGISTER_FROM, routeShapeFrom: ROUTE_SHAPE_FROM }
		)
		const { handlers, validators } = evalRegistration(source) as any

		expect(handlers.POST?.['/hidden']).toBeUndefined()
		expect(validators.POST?.['/hidden']).toBeUndefined()
		expect(validators.GET['/q'].query.dm).toBeUndefined()
		expect(mode).toBe('sealed')
	})

	// `api` relies on its parent's model, so it can't build standalone; its
	// capture failing must not fail the build of the app that works
	it('warns and skips a named export that cannot be captured standalone', async () => {
		const warn = spyOn(console, 'warn').mockImplementation(() => {})
		let source: string
		try {
			;({ source } = await generateCompiledArtifacts(
				fixture('multi-app-parent-model.ts'),
				{
					registerFrom: REGISTER_FROM,
					routeShapeFrom: ROUTE_SHAPE_FROM
				}
			))
			expect(warn.mock.calls.map(([message]) => message)).toContainEqual(
				expect.stringContaining(
					'export `api` (app "api") gets no AOT manifest, its capture failed: [Elysia] Unknown model reference "user"'
				)
			)
		} finally {
			warn.mockRestore()
		}
		expect(
			evalRegistration(source, 'app').handlers?.POST?.['/user']
		).toBeDefined()
		expect(() => evalRegistration(source, 'api')).toThrow(
			'manifest did not call Compiled.register for "api"'
		)

		const { path } = await build('multi-app-parent-model.ts', 'auto')
		const [ok, invalid, api] = serve(path, [
			['app', '/user', { name: 'a' }],
			['app', '/user', {}],
			['api', '/user', { name: 'a' }]
		])
		expect(status(ok!)).toBe(200)
		expect(status(invalid!)).toBe(422)
		expect(api).toBe(
			'[Elysia] Unknown model reference "user" for body on route POST /user.'
		)
	})

	// routes an async module adds must count before the build picks which
	// exports to capture, or `api` is skipped and has no manifest at runtime
	it.each([['auto'], [false]] as const)(
		'captures a named export whose routes come from an async module, strip: %p',
		async (strip) => {
			const { path, text } = await build(
				'multi-app-async-secondary.ts',
				strip
			)
			expect(text).toContain(')(), "api")')

			expect(
				serve(path, [
					['api', '/api/state', { theme: 'x' }],
					['api', '/api/state', { theme: 1 }],
					['app', '/']
				]).map(status)
			).toEqual([200, 422, 200])
		}
	)

	// a plugin or group child is merged by the app using it and never serves
	// on its own: building its router when its module settled claimed a
	// manifest it never had, the throw dropped it and its routes 404'd
	it.each([['auto'], [false]] as const)(
		'serves async routes of plugins consumed by their parent without a manifest of their own, strip: %p',
		async (strip) => {
			const { path, text } = await build(
				'multi-app-async-consumed.ts',
				strip
			)
			expect(text).toContain(')(), "app")')
			expect(text).not.toContain(')(), "api")')

			expect(
				serve(path, [
					['settle'],
					['app', '/api/state', { theme: 'x' }],
					['app', '/api/state', { theme: 1 }],
					['app', '/v1/state', { theme: 'x' }],
					['app', '/v1/state', { theme: 1 }],
					['app', '/']
				]).map(status)
			).toEqual([200, 200, 422, 200, 422, 200])
		}
	)

	// a build that threw leaves no router behind, so it must not count as built
	// when the module settles either: retrying it would throw again
	it('serves a consumed plugin whose early build failed for want of a manifest', async () => {
		const { path } = await build(
			'multi-app-async-consumed-early.ts',
			'auto'
		)

		expect(
			serve(path, [
				['settle'],
				['app', '/api/state', { theme: 'x' }],
				['app', '/api/early'],
				['app', '/']
			]).map(status)
		).toEqual([200, 200, 200, 200])
	})

	// the same timing let an async secondary slip past the build-time checks
	it.each([
		['multi-app-async-duplicate.ts', 'exports two Elysia apps named "svc"'],
		[
			'multi-app-async-unnamed-primary.ts',
			'exports `app` with no name next to named Elysia apps (`api`)'
		]
	])('refuses %s once its async routes settle', async (name, message) => {
		await expect(
			generateCompiledArtifacts(fixture(name), {
				registerFrom: REGISTER_FROM,
				routeShapeFrom: ROUTE_SHAPE_FROM
			})
		).rejects.toThrow(message)
	})

	// the hidden sub-app builds its router when its async module settles,
	// inside the capture of `app`: its `/hidden` and its `/b` codec and custom
	// error check must not reach `app`, which seals like it does alone
	it('keeps a router built while async modules settle out of the primary manifest', async () => {
		const leak = await generateCompiledArtifacts(
			fixture('multi-app-async-leak.ts'),
			{ registerFrom: REGISTER_FROM, routeShapeFrom: ROUTE_SHAPE_FROM }
		)
		const control = await generateCompiledArtifacts(
			fixture('multi-app-async-leak-control.ts'),
			{ registerFrom: REGISTER_FROM, routeShapeFrom: ROUTE_SHAPE_FROM }
		)
		const { handlers, validators } = evalRegistration(
			leak.source,
			'app'
		) as any

		expect(handlers.POST?.['/hidden']).toBeUndefined()
		expect(validators.POST['/b'].body.ic).toBeUndefined()
		expect(validators.POST['/b'].body.ce).toBeUndefined()
		expect(leak.mode).toBe(control.mode)
		expect(leak.mode).toBe('sealed')
	})

	// `captureArtifacts` (and `compileToSource`) are also called directly,
	// with no build to settle modules first
	it('keeps a router built while the app awaits its modules out of its capture', async () => {
		const { app } = await import('./fixtures/multi-app-async-leak-direct')
		const { handlers, validators } = await captureArtifacts(app)

		expect(handlers.map(({ method, path }) => `${method} ${path}`)).toEqual(
			['POST /b', '* /sub', '* /sub/*']
		)
		expect(validators).toHaveLength(1)
		expect(validators[0]!.innerCodecs).toBeUndefined()
		expect(validators[0]!.customErrors).toBeUndefined()
	})
})

describe('AOT multi-app manifest module', () => {
	// every registration shares one module: the header must import what any
	// app needs, and each app's decls stay in its own registration scope
	it('emits one keyed registration per app over shared imports', async () => {
		process.env.ELYSIA_AOT_BUILD = '1'
		try {
			const a = await captureArtifacts(
				new Elysia({ name: 'a' }).post(
					'/a',
					{ body: t.Object({ s: t.String() }) },
					({ body }) => body
				)
			)
			// only `b` coerces, through the coerce-plan rebuilder
			const b = await captureArtifacts(
				new Elysia({ name: 'b' }).get(
					'/b',
					{ query: t.Object({ n: t.Number() }) },
					({ query }) => query
				)
			)

			const source = emitModule([a, b], a.fingerprint, { lazy: true })
			expect(source.match(/^import .*$/gm)).toEqual([
				'import { Compiled } from "elysia"',
				'import { buildCoercedFromPlan } from "elysia/coerce-plan"',
				'import { Reconstruct } from "elysia/reconstruct"',
				'import { routeShape } from "elysia/route-shape"'
			])

			const registrationA = evalRegistration(source, 'a')
			const registrationB = evalRegistration(source, 'b')
			expect(registrationA.lazyGroupOf?.POST?.['/a']).toBe(0)
			expect(registrationA.planRebuilder).toBeUndefined()
			expect(registrationB.lazyGroupOf?.GET?.['/b']).toBe(0)
			expect(registrationB.planRebuilder).toBeDefined()
		} finally {
			delete process.env.ELYSIA_AOT_BUILD
		}
	})
})

describe('AOT multi-app stub plan', () => {
	const jit: JITProbeResult = { jit: true, reasons: [] }
	const plan = (
		aliases: string[],
		allBridgeFree: boolean,
		{
			hasWS = false,
			zeroCapture = false,
			report = jit
		}: {
			hasWS?: boolean
			zeroCapture?: boolean
			report?: JITProbeResult
		} = {}
	) =>
		planFromReport(
			'auto',
			report,
			hasWS,
			false,
			new Set(aliases),
			allBridgeFree,
			zeroCapture,
			false,
			true,
			false,
			true
		)

	const sealed = plan([], true)
	const wired = plan(['va'], false)

	// AND-ing every flag sealed+wired gave `bridge: false, typeboxValue: false`,
	// cutting TypeBox the wired app still validates through
	it('wires TypeBox for the least sealed app', () => {
		expect(sealed.mode).toBe('sealed')
		expect(wired.mode).toBe('wired')

		const merged = mergePlans([sealed, wired], true)
		expect(merged).toEqual(wired)
		expect(merged.plan.bridge).toBe(true)
		expect(merged.plan.typeboxValue).toBe(true)
		expect(merged.plan.exactMirror).toBe(true)
		expect(mergePlans([wired, sealed], true)).toEqual(merged)
	})

	it('leaves TypeBox wired normally next to a WebSocket app with nothing captured', () => {
		const ws = plan([], false, { hasWS: true, zeroCapture: true })
		expect(ws.mode).toBe('off')

		const { plan: merged, mode } = mergePlans([wired, ws], true)
		expect(mode).toBe('off')
		expect(merged.compat).toBe(false)
		expect(merged.bridge).toBe(false)
		expect(merged.typeboxValue).toBe(true)
		// a module stays only for the app that needs it
		expect(merged.ws).toBe(false)
	})

	// each app replays its own handlers from the one shared link table, so
	// intersecting like the module flags would starve both apps
	it('keeps the union of every app link aliases', () => {
		const a = plan(['rt', 'rc', 'cc'], true)
		const b = plan(['rt', 'va', 'er'], false)

		expect(mergePlans([a, b], true).plan.params).toEqual([
			'cc',
			'er',
			'rc',
			'rt',
			'va'
		])
	})

	it('keeps the handler JIT for every app when one still reaches it', () => {
		const live = plan([], false, {
			report: { jit: false, reasons: ['handler:indexed-duplicate'] }
		})

		const { plan: merged, mode } = mergePlans([sealed, live], true)
		expect(mode).toBe('off')
		expect(merged.jit).toBe(false)
		expect(merged.sucrose).toBe(false)
		expect(merged.reconstruct).toBe(false)
	})

	it('names the app that keeps the handler JIT reachable under strip: true', async () => {
		await expect(
			generateCompiledArtifacts(fixture('multi-app-strip-true.ts'), {
				registerFrom: REGISTER_FROM,
				routeShapeFrom: ROUTE_SHAPE_FROM,
				strip: true
			})
		).rejects.toThrow(
			'strip: true requires every route of app "api" to be covered'
		)

		// `app` alone would stub the JIT, `api` needs it
		const { stub, mode } = await generateCompiledArtifacts(
			fixture('multi-app-strip-true.ts'),
			{ registerFrom: REGISTER_FROM, routeShapeFrom: ROUTE_SHAPE_FROM }
		)
		expect(stub.jit).toBe(false)
		expect(mode).toBe('off')
	})
})
