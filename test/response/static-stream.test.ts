import { describe, expect, it } from 'bun:test'
import { Elysia, status } from '../../src'
import { BunAdapter } from '../../src/adapter/bun'
import { mapResponse } from '../../src/adapter/web-standard/handler'
import {
	buildNativeStaticResponse,
	compileHandler
} from '../../src/compile/handler'
import { AOT_MANIFEST_FORMAT, Compiled } from '../../src/compile/aot'
import { materialiseHandlers, registerManifest } from '../aot/_manifest'

function source(kind: string) {
	let advances = 0
	let stream: ReadableStream | undefined
	class NextOnly {
		next() {
			return advances++ < 2
				? { value: advances === 1 ? 'a' : 'b', done: false }
				: { done: true }
		}
	}
	const value =
		kind === 'readable'
			? (stream = new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('a'))
						controller.enqueue(new TextEncoder().encode('b'))
						controller.close()
					}
				}))
			: kind === 'async'
				? (async function* () {
						advances++
						yield 'a'
						advances++
						yield 'b'
					})()
				: kind === 'done'
					? (function* () {
							advances++
							return 'ab'
						})()
					: kind === 'next-only'
						? new NextOnly()
						: (function* () {
								advances++
								yield 'a'
								advances++
								yield 'b'
							})()
	return {
		value,
		state: () => ({ advances, locked: stream?.locked ?? false })
	}
}

async function listen(app: Elysia<any>) {
	await new Promise<void>((resolve) =>
		app.listen({ hostname: '127.0.0.1', port: 0 }, () => resolve())
	)
	await Bun.sleep(0)
}

async function read(app: Elysia<any>) {
	const response = await fetch(`http://127.0.0.1:${app.server!.port}/value`, {
		signal: AbortSignal.timeout(1500)
	})
	return {
		status: response.status,
		headers: response.headers,
		body: await response.text()
	}
}

async function released(state: () => { locked: boolean }) {
	for (let turn = 0; state().locked && turn < 50; turn++) await Bun.sleep(1)
	expect(state().locked).toBe(false)
}

describe('static stream preparation', () => {
	for (const kind of ['sync', 'async', 'readable'])
		for (const native of [true, false])
			for (const defaults of [false, true])
				it(`${kind}, native=${native}, defaults=${defaults}: keeps the entire cold body`, async () => {
					const input = source(kind)
					const app = new Elysia({ nativeStaticResponse: native })
					if (defaults) app.headers({ 'x-default': 'base' })
					app.get('/value', input.value)
					try {
						await listen(app)
						const ready = input.state()
						const cold = await read(app)
						const warm = await read(app)
						expect(cold.body).toBe('ab')
						expect(cold.status).toBe(200)
						expect(cold.headers.get('x-default')).toBe(
							defaults ? 'base' : null
						)
						expect(ready).toEqual({ advances: 0, locked: false })
						// This raw owner is single-use. Warm consumption only checks completion.
						expect(warm.status).toBe(200)
						await released(input.state)
					} finally {
						await app.stop(true)
					}
				})

	for (const kind of ['done', 'next-only'])
		it(`does not discard the first result of a ${kind} iterator`, async () => {
			const input = source(kind)
			const app = new Elysia().get('/value', input.value)
			try {
				await listen(app)
				const ready = input.state()
				const cold = await read(app)
				expect(cold.body).toBe('ab')
				expect(cold.status).toBe(200)
				expect(ready.advances).toBe(0)
			} finally {
				await app.stop(true)
			}
		})

	for (const native of [true, false])
		it(`carries preparation through status and a late serializer, native=${native}`, async () => {
			const input = source('async')
			let release!: () => void
			const gate = new Promise<void>((resolve) => {
				release = resolve
			})
			class Serialized {
				async toResponse() {
					await gate
					return status(201, input.value)
				}
			}
			const app = new Elysia({ nativeStaticResponse: native })
				.headers({ 'x-default': 'base' })
				.get('/value', new Serialized())
			try {
				await listen(app)
				release()
				await Bun.sleep(0)
				const ready = input.state()
				const cold = await read(app)
				expect(cold.body).toBe('ab')
				expect(cold.status).toBe(201)
				expect(cold.headers.get('x-default')).toBe('base')
				expect(ready.advances).toBe(0)
			} finally {
				release()
				await app.stop(true)
			}
		})

	it('keeps the raw stream visible to afterHandle', async () => {
		const input = source('sync')
		const seen: unknown[] = []
		const app = new Elysia().get(
			'/value',
			{
				afterHandle({ responseValue }) {
					seen.push(responseValue)
				}
			},
			input.value
		)
		try {
			await listen(app)
			const ready = input.state()
			const cold = await read(app)
			expect(cold.body).toBe('ab')
			expect(ready.advances).toBe(0)
			expect(seen).toHaveLength(1)
			expect(seen[0]).toBe(input.value)
		} finally {
			await app.stop(true)
		}
	})

	it('still maps a stream with an omitted request', async () => {
		const input = source('sync')
		const response = await mapResponse(input.value, { headers: {} })
		expect(await response.text()).toBe('ab')
		expect(input.state().advances).toBe(2)
	})

	it('does not suppress reentrant mapping with a real request', async () => {
		const bodies: Promise<string>[] = []
		class Serialized {
			toResponse() {
				const inner = source('sync')
				bodies.push(
					Promise.resolve(
						mapResponse(
							inner.value,
							{ headers: {} },
							new Request('http://localhost/inner')
						)
					).then((response) => response.text())
				)
				return 'outer'
			}
		}
		const app = new Elysia().get('/value', new Serialized())
		try {
			await listen(app)
			const prepared = bodies.length
			const cold = await read(app)
			expect(cold.body).toBe('outer')
			expect(prepared).toBeGreaterThan(0)
			expect(await Promise.all(bodies)).toEqual(bodies.map(() => 'ab'))
		} finally {
			await app.stop(true)
		}
	})

	for (const native of [true, false])
		it(`recognizes the canonical map on a distinct response object, native=${native}`, async () => {
			const input = source('sync')
			const adapter = {
				...BunAdapter,
				response: { ...BunAdapter.response, map: mapResponse }
			}
			const app = new Elysia({
				adapter,
				nativeStaticResponse: native
			}).get('/value', input.value)
			try {
				await listen(app)
				const ready = input.state()
				const cold = await read(app)
				expect(cold.body).toBe('ab')
				expect(ready.advances).toBe(0)
			} finally {
				await app.stop(true)
			}
		})

	for (const native of [true, false])
		it(`preserves custom mapper selection, receiver, arguments and order, native=${native}`, async () => {
			const events: string[] = []
			let selected = 0
			let preparationCalls = 0
			const mapped = new Response('custom', { status: 202 })
			const response = {
				get map() {
					selected++
					events.push('map')
					return function (this: unknown, ...args: unknown[]) {
						preparationCalls++
						expect(selected).toBe(1)
						expect(events).toEqual(
							native ? ['map', 'headers'] : ['headers', 'map']
						)
						expect(this).toBe(response)
						expect(args).toEqual([
							'raw',
							{ headers: { 'x-default': 'base' } }
						])
						return mapped
					}
				}
			}
			const app = new Elysia({ adapter: { ...BunAdapter, response } })
				.headers({ 'x-default': 'base' })
				.get('/value', 'raw')
			Object.defineProperty(app['~ext']!.headers!, 'x-default', {
				enumerable: true,
				get() {
					events.push('headers')
					return 'base'
				}
			})
			const route = app['~routes'][0]
			const compiled = native
				? buildNativeStaticResponse(route, app)
				: compileHandler(route, app)
			expect(preparationCalls).toBe(1)
			if (native) expect(compiled).toBe(mapped)
			else expect(typeof compiled).toBe('function')
			expect(await mapped.text()).toBe('custom')
		})

	it('binds a factory captured before the repair to the unchanged raw owner and runtime mapper', async () => {
		// Captured from the old runtime, ABI 4. Keep its code and alias order literal.
		const old = {
			method: 'GET',
			path: '/old-stream',
			alias: 'rt,fre,rm',
			code: "function route(c){\ntry{\nconst _m=rm(h,c.set,c.request,true)\nreturn typeof _m?.then==='function'?Promise.resolve(_m).catch((_e)=>fre(rt,c,_e)):_m\n}catch(e){return fre(rt,c,e)}\n}"
		}
		const input = source('sync')
		const manifest = materialiseHandlers([old])
		const entry = manifest.GET['/old-stream']
		const factory = entry.f
		let calls = 0
		entry.f = function (handler: unknown, ...bindings: unknown[]) {
			calls++
			expect(handler).toBe(input.value)
			expect(bindings[2]).toBe(mapResponse)
			return Reflect.apply(factory, this, [handler, ...bindings])
		}
		try {
			expect(AOT_MANIFEST_FORMAT).toBe(4)
			registerManifest({ handlers: manifest })
			const app = new Elysia({ nativeStaticResponse: false })
				.headers({ 'x-default': 'base' })
				.get('/old-stream', input.value)
			app.compile()
			const ready = input.state()
			const response = await app.handle(
				new Request('http://localhost/old-stream')
			)
			expect(await response.text()).toBe('ab')
			expect(response.status).toBe(200)
			expect(response.headers.get('x-default')).toBe('base')
			expect(ready.advances).toBe(0)
			expect(calls).toBe(1)
		} finally {
			Compiled.clear()
		}
	})
})
