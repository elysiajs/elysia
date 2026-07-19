import '../../src/compile/aot-capture' // installs build-only capture impl (mirrors the AOT plugin)
import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { compileHandler } from '../../src/compile/handler'
import {
	materialise,
	materialiseHandlers,
	registerManifest
} from '../aot/_manifest'
import { req } from '../utils'

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

describe('case-insensitive content-type parse', () => {
	const jsonBody = (contentType: string) =>
		new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': contentType },
			body: JSON.stringify({ n: 5 })
		})

	it('parses an uppercase `Application/JSON` body (was a spurious 422)', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ n: t.Number() }) },
			({ body }) => body
		)

		const res = await app.handle(jsonBody('Application/JSON'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ n: 5 })
	})

	it('parses a mixed-case `APPLICATION/json` body', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ n: t.Number() }) },
			({ body }) => body
		)

		const res = await app.handle(jsonBody('APPLICATION/json'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ n: 5 })
	})

	it('parses uppercase content-type carrying a parameter (`Application/JSON; charset=UTF-8`)', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ n: t.Number() }) },
			({ body }) => body
		)

		const res = await app.handle(
			jsonBody('Application/JSON; charset=UTF-8')
		)
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ n: 5 })
	})

	it('parses lowercase application/json through the exact-match path', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ n: t.Number() }) },
			({ body }) => body
		)

		const res = await app.handle(jsonBody('application/json'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ n: 5 })
	})

	it('normalizes Content-Type before exact JSON dispatch', () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ n: t.Number() }) },
			({ body }) => body
		)
		const src = compileHandler(app['~routes']![0] as any, app).toString()

		expect(src).toContain('let ce=nc(ct)')
		expect(src).toContain(
			"let cj=(ce.charCodeAt(12)===106&&ce==='application/json')||ce.endsWith('+json')"
		)
		expect(src).toMatch(
			/c\.body=cj\?\(?[^\n]*await pj\(c\)\)?\:\(?[^\n]*await pd\(c,ce,true\)\)?/
		)
		expect(src).not.toContain('ctlc')
		expect(src).not.toContain('_ctl')
		expect(src).not.toContain('pmrc')
		expect(src).not.toContain('pff')
	})

	const multipartBody = (contentType: string) => {
		const boundary = '----TestBoundaryWebKit123ABC'
		return new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': `${contentType}; boundary=${boundary}` },
			body: `--${boundary}\r\nContent-Disposition: form-data; name="x"\r\n\r\ny\r\n--${boundary}--\r\n`
		})
	}

	it('parses a fully-uppercase `MULTIPART/FORM-DATA` body (was a hard 400)', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const res = await app.handle(multipartBody('MULTIPART/FORM-DATA'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ x: 'y' })
	})

	it('parses a mixed-case `Multipart/Form-Data` body', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const res = await app.handle(multipartBody('Multipart/Form-Data'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ x: 'y' })
	})

	it('parses lowercase multipart/form-data', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const res = await app.handle(multipartBody('multipart/form-data'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ x: 'y' })
	})
})

describe('compiled query parse tables', () => {
	it('no per-request object literal in the emitted query parse call', () => {
		const app = new Elysia().get(
			'/',
			{ query: t.Object({ tags: t.Array(t.String()) }) },
			({ query }) => query
		)
		const src = compileHandler(app['~routes']![0] as any, app).toString()

		const pqLine = src.split('\n').find((l) => l.includes('pq(')) as string
		expect(pqLine).toBeDefined()
		// the array table is passed by identifier, not an inlined `{"tags":1}`
		expect(pqLine).toContain('pq(c.request.url,c.qi,qa)')
		expect(pqLine).not.toContain('{')
	})

	it('array query still decodes (comma-split) after hoisting', async () => {
		const app = new Elysia().get(
			'/',
			{ query: t.Object({ tags: t.Array(t.String()) }) },
			({ query }) => query
		)

		const res = await app.handle(req('/?tags=x,y,z'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ tags: ['x', 'y', 'z'] })
	})

	it('a route with no array/object query links no table (plain pq call)', () => {
		const app = new Elysia().get(
			'/',
			{ query: t.Object({ q: t.Optional(t.String()) }) },
			({ query }) => query
		)
		const src = compileHandler(app['~routes']![0] as any, app).toString()

		const pqLine = src.split('\n').find((l) => l.includes('pq(')) as string
		expect(pqLine).toContain('pq(c.request.url,c.qi)')
		expect(pqLine).not.toContain('qa')
		expect(pqLine).not.toContain('qo')
	})
})

describe('AOT query parsing', () => {
	const freeze = async (
		build: () => Elysia<any, any>,
		assert: (frozen: Elysia<any, any>) => Promise<void>
	) => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endHandlerCapture()
		endValidatorCapture()
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()
		expect(handlers.length).toBeGreaterThan(0)

		delete process.env.ELYSIA_AOT_BUILD
		Validator.clear()
		registerManifest({
			validators: materialise(validators),
			handlers: materialiseHandlers(handlers)
		})

		const frozen = build()
		;(frozen as any).compile()
		await assert(frozen)

		Compiled.clear()
		Validator.clear()
	}

	it('frozen build decodes an array query via the rederived table', async () => {
		const build = () =>
			new Elysia().get(
				'/',
				{ query: t.Object({ tags: t.Array(t.String()) }) },
				({ query }: any) => query
			) as any

		await freeze(build, async (frozen) => {
			const res = await frozen.handle(req('/?tags=a,b'))
			expect(res.status).toBe(200)
			await expect(res.json()).resolves.toEqual({ tags: ['a', 'b'] })
		})
	})
})

describe('fetch-level error fallback for compiled routes', () => {
	it('maps an async handler exception through the application error hook', async () => {
		const app = new Elysia()
			.error(({ error, set }: any) => {
				set.status = 418
				return (error as Error).message
			})
			// body read forces the route async; the handler throws
			.post('/', { body: t.Object({ n: t.Number() }) }, () => {
				throw new Error('boom')
			})

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ n: 1 })
			})
		)
		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('boom')
	})

	it('returns 500 when the application error hook also throws', async () => {
		const app = new Elysia()
			.error(() => {
				throw new Error('error hook itself throws')
			})
			.post('/', { body: t.Object({ n: t.Number() }) }, () => {
				throw new Error('handler boom')
			})

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ n: 1 })
			})
		)
		expect(res.status).toBe(500)
	})

	it('an async route with NO error hook rethrows to the fetch-level handler (still a response)', async () => {
		// no error hook → the codegen does not wrap the body → the throw rejects
		// the route promise → only the outer `.catch` produces a response.
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ n: t.Number() }) },
			() => {
				throw new Error('unwrapped boom')
			}
		)

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ n: 1 })
			})
		)
		expect(res.status).toBe(500)
	})
})

describe('request abort short-circuits lifecycle hooks', () => {
	it('emits abort plumbing only for compat polling or suspension sites', () => {
		const plain = new Elysia().get('/plain', () => 'ok')
		const plainSrc = compileHandler(
			plain['~routes']![0] as any,
			plain
		).toString()

		expect(plainSrc).not.toContain('.signal.aborted')
		expect(plainSrc).not.toContain("addEventListener('abort'")
		expect(plainSrc).not.toContain('emp.clone()')

		const hooked = new Elysia()
			.beforeHandle(() => {})
			.get('/hooked', () => 'ok')
		const hookedSrc = compileHandler(
			hooked['~routes']![0] as any,
			hooked
		).toString()

		expect(hookedSrc).not.toContain(
			'if(c.request.signal.aborted)return emp.clone()'
		)
		expect(hookedSrc).toContain('s(c.request,_m)')
		expect(hookedSrc).not.toContain("addEventListener('abort'")

		const compat = new Elysia({
			experimental: { cancellation: 'compat' }
		})
			.beforeHandle(() => {})
			.get('/compat', () => 'ok')
		const compatSrc = compileHandler(
			compat['~routes']![0] as any,
			compat
		).toString()

		expect(compatSrc).toContain('.signal.aborted')
		expect(compatSrc).toContain('emp.clone()')

		const suspended = new Elysia()
			.beforeHandle(async () => {})
			.get('/suspended', () => 'ok')
		const suspendedSrc = compileHandler(
			suspended['~routes']![0] as any,
			suspended
		).toString()

		expect(suspendedSrc).toContain('.signal.aborted')
		expect(suspendedSrc).not.toContain('emp.clone()')
	})

	it('returns an empty response instead of running the next hook after abort', async () => {
		const controller = new AbortController()
		let beforeHandleCalled = false

		const app = new Elysia()
			.transform(async () => {
				controller.abort()
				await Promise.resolve()
			})
			.beforeHandle(() => {
				beforeHandleCalled = true
			})
			.get('/', () => 'ok')

		const res = await app.handle(
			new Request('http://localhost/', {
				signal: controller.signal
			})
		)

		expect(beforeHandleCalled).toBe(false)
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('')
	})

	it('skips later hooks in the same lifecycle array after abort', async () => {
		const controller = new AbortController()
		let secondHookCalled = false

		const app = new Elysia().get(
			'/',
			{
				beforeHandle: [
					async () => {
						controller.abort()
						await Promise.resolve()
					},
					() => {
						secondHookCalled = true
					}
				]
			},
			() => 'ok'
		)

		const res = await app.handle(
			new Request('http://localhost/', {
				signal: controller.signal
			})
		)

		expect(secondHookCalled).toBe(false)
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('')
	})
})
