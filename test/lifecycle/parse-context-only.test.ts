// A v2 parse hook takes the context only. 1.x passed the content type as a
// 2nd argument; v2 types it as `context.contentType`, so a hook written
// against the 1.x signature must get `undefined` there on every compile lane
// (JIT, precompile, AOT replay) and read the same value from the context

import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import {
	aotReconstructHandle,
	jitHandle,
	precompileHandle,
	type Define,
	type LaneFactory
} from '../differential/lanes'

interface Call {
	second: unknown
	arity: number
	contentType: unknown
}

// 1.x shape: `(context, contentType)`
const hook = (calls: Call[], value?: unknown) =>
	function (c: any, second?: unknown) {
		calls.push({
			second,
			arity: arguments.length,
			contentType: c.contentType
		})
		return value
	}

const handler = ({ body }: any) => body

const placements: Record<string, (calls: Call[]) => Define> = {
	'.onParse(fn)': (calls) => (app) =>
		app.onParse(hook(calls, 'parsed')).post('/', handler),
	"plugin .onParse('global', fn)": (calls) => (app) =>
		app
			.use(new Elysia().onParse('global', hook(calls, 'parsed')))
			.post('/', handler),
	'local { parse: fn }': (calls) => (app) =>
		app.post('/', { parse: hook(calls, 'parsed') }, handler),
	"named .parser() as { parse: 'name' }": (calls) => (app) =>
		app
			.parser('custom', hook(calls, 'parsed'))
			.post('/', { parse: 'custom' }, handler),
	"named .parser() as .onParse('name')": (calls) => (app) =>
		app
			.parser('custom', hook(calls, 'parsed'))
			.onParse('custom')
			.post('/', handler),
	'guard { parse: fn }': (calls) => (app) =>
		app.guard({ parse: hook(calls, 'parsed') }, (app) =>
			app.post('/', handler)
		),
	'macro { parse: fn }': (calls) => (app) =>
		app
			.macro({ p: { parse: hook(calls, 'parsed') } })
			.post('/', { p: true }, handler),
	// the route compiles to an async handler
	'async hook': (calls) => (app) => {
		const record = hook(calls, 'parsed')
		return app
			.onParse(async (...args: [any, unknown?]) => record(...args))
			.post('/', handler)
	},
	// the 2nd hook runs in the `if(!hasBody)` branch
	'2nd hook in the chain': (calls) => (app) =>
		app
			.onParse(hook(calls))
			.onParse(hook(calls, 'parsed'))
			.post('/', handler)
}

const request = () =>
	new Request('http://localhost/', {
		method: 'POST',
		headers: { 'content-type': 'application/x-elysia; charset=utf-8' },
		body: 'raw'
	})

const expected: Call = {
	second: undefined,
	arity: 1,
	contentType: 'application/x-elysia'
}

const lanes: LaneFactory[] = [jitHandle, precompileHandle, aotReconstructHandle]

for (const lane of lanes)
	describe(`parse hook receives the context only (${lane.id})`, () => {
		for (const [name, define] of Object.entries(placements))
			it(name, async () => {
				const calls: Call[] = []
				const instance = await lane.make(define(calls))

				try {
					calls.length = 0
					const response = await instance.handle(request())

					// the hook ran and its value became the body
					await expect(response.text()).resolves.toBe('parsed')
					expect(calls).toEqual(
						name === '2nd hook in the chain'
							? [expected, expected]
							: [expected]
					)
				} finally {
					await instance.dispose()
				}
			})
	})
