// An error whose `status` is not an HTTP status must not be served as 200 OK:
// a library's `status: 'fail'` used to reach the client as a success with the
// raw error message as the body, on every lane

import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import {
	aotReconstructHandle,
	jitHandle,
	precompileHandle,
	type Define,
	type LaneFactory
} from '../differential/lanes'

const boom = (v: unknown) =>
	Object.assign(new Error('boom-message'), { status: v })

const cases: [unknown, number][] = [
	['403', 403],
	['401', 401],
	[' 403', 403],
	['Forbidden', 403],
	[403, 403],
	[200, 200],
	['200', 200],
	['abc', 500],
	['fail', 500],
	['4e2', 400],
	[0, 500],
	[99, 500],
	[100, 500],
	[101, 500],
	[600, 500],
	[-1, 500],
	[3.5, 500],
	[NaN, 500]
]

const shapes: Record<string, (v: unknown) => Define> = {
	'thrown, no error hook': (v) => (app) =>
		app.get(
			'/',
			{
				beforeHandle() {
					throw boom(v)
				}
			},
			() => 'HANDLER-RAN'
		),
	'thrown, route error hook declines': (v) => (app) =>
		app.get(
			'/',
			{
				error() {},
				beforeHandle() {
					throw boom(v)
				}
			},
			() => 'HANDLER-RAN'
		),
	'returned by route error hook': (v) => (app) =>
		app.get(
			'/',
			{
				error() {
					return boom(v)
				},
				beforeHandle() {
					throw new Error('first')
				}
			},
			() => 'HANDLER-RAN'
		),
	'returned by app error hook': (v) => (app) =>
		(app as Elysia)
			.onError(() => boom(v))
			.get(
				'/',
				{
					beforeHandle() {
						throw new Error('first')
					}
				},
				() => 'HANDLER-RAN'
			) as any
}

const lanes: LaneFactory[] = [jitHandle, precompileHandle, aotReconstructHandle]

const run = async (lane: LaneFactory, define: Define) => {
	const instance = await lane.make(define)

	try {
		const res = await instance.handle(new Request('http://localhost/'))

		return { status: res.status, body: await res.text() }
	} finally {
		await instance.dispose()
	}
}

for (const lane of lanes)
	describe(`error status resolves or is 500 (${lane.id})`, () => {
		for (const [name, shape] of Object.entries(shapes))
			for (const [value, expected] of cases)
				it(`${name}: status ${String(typeof value === 'string' ? JSON.stringify(value) : value)} -> ${expected}`, async () => {
					const { status, body } = await run(lane, shape(value))

					expect(status).toBe(expected)
					expect(body).not.toContain('HANDLER-RAN')
				})

		for (const [name, shape] of Object.entries(shapes))
			for (const value of ['abc', 'fail'])
				it(`production, ${name}: status ${JSON.stringify(value)} is a masked 500`, async () => {
					const previous = process.env.NODE_ENV
					process.env.NODE_ENV = 'production'

					try {
						const { status, body } = await run(lane, shape(value))

						expect(status).toBe(500)
						expect(body).not.toContain('boom-message')
					} finally {
						if (previous === undefined) delete process.env.NODE_ENV
						else process.env.NODE_ENV = previous
					}
				})
	})
