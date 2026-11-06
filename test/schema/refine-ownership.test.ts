import '../../src/compile/aot-capture'
import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { System } from 'typebox/system'

import { Elysia, t } from '../../src'
import { Compiled } from '../../src/compile/aot'
import { pureRefine } from '../../src/type/shared'
import { Validator } from '../../src/validator'
import { buildMode } from '../aot/_manifest'

const isEmail = (value: string) => value.includes('@')

const createUser = (check: (value: string) => unknown = isEmail) =>
	t.Object({
		id: t.String(),
		email: t.Refine(t.String(), check as any)
	})

const post = (
	app: { handle(request: Request): Promise<Response> },
	body: unknown
) =>
	app.handle(
		new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	)

// TypeBox 1.4 composes by sharing subschemas, so `t.Pick(User)` holds the
// very refinement objects `User` does. Elysia wraps each refinement's check
// (sync guard, replay memo): doing it on the caller's object would leak
// Elysia's wrapper into `User` everywhere it is used outside the route
describe("route compile keeps the caller's refinement", () => {
	for (const [name, wrap] of [
		['the schema itself', (User: any) => User],
		['t.Pick', (User: any) => t.Pick(User, ['email'])],
		['t.Partial', (User: any) => t.Partial(User)]
	] as const)
		it(`leaves the source check in place through ${name}`, async () => {
			const User = createUser()
			const app = new Elysia().post(
				'/',
				{ body: wrap(User) },
				({ body }) => body
			)

			app.compile()
			await post(app, { id: '1', email: 'x' })

			expect(User.properties.email['~refine'][0].check as Function).toBe(
				isEmail
			)
		})
})

// TypeBox's recommended dev setting deep-freezes every schema it builds, so a
// write into the caller's refinement throws and the route never compiles
describe('immutableTypes', () => {
	const previous = System.Settings.Get().immutableTypes
	afterAll(() => System.Settings.Set({ immutableTypes: previous }))

	it('compiles and validates a route over a frozen schema', async () => {
		System.Settings.Set({ immutableTypes: true })

		const User = createUser()
		const app = new Elysia().post(
			'/',
			{ body: t.Pick(User, ['email']) },
			({ body }) => body
		)

		expect(() => app.compile()).not.toThrow()
		expect((await post(app, { email: 'a@b' })).status).toBe(200)
		expect((await post(app, { email: 'x' })).status).toBe(422)
	})
})

// The copy Elysia validates with must behave exactly like the refinement it
// was copied from
describe('refinement semantics through a composed schema', () => {
	it('rejects what the refinement rejects', async () => {
		const app = new Elysia().post(
			'/',
			{ body: t.Pick(createUser(), ['email']) },
			({ body }) => body
		)

		expect((await post(app, { email: 'a@b' })).status).toBe(200)
		expect((await post(app, { email: 'x' })).status).toBe(422)
	})

	it('runs a user refinement once per value, even when it fails', async () => {
		let calls = 0
		const app = new Elysia().post(
			'/',
			{
				body: t.Pick(
					createUser((value) => (calls++, isEmail(value))),
					['email']
				)
			},
			({ body }) => body
		)

		expect((await post(app, { email: 'x' })).status).toBe(422)
		expect(calls).toBe(1)
	})

	// an async check hands TypeBox a truthy Promise: it must fail closed
	for (const [name, check] of [
		['an async', async () => true],
		['a Promise-returning', () => Promise.resolve(true)]
	] as const)
		it(`still refuses ${name} refinement`, async () => {
			let message: string | undefined
			const app = new Elysia()
				.onError(({ error }) => {
					message = (error as Error).message
				})
				.post(
					'/',
					{ body: t.Pick(createUser(check), ['email']) },
					({ body }) => body
				)

			expect((await post(app, { email: 'a@b' })).status).toBe(500)
			expect(message).toContain('t.Refine check must be synchronous')
		})

	// Elysia's own predicates (t.Numeric ranges, t.BooleanString, ...) skip
	// the guard and replay machinery; the copy must not demote them to it
	it("keeps Elysia's own refinement on its pure lane", async () => {
		let calls = 0
		const email = pureRefine(
			t.Refine(t.String(), (value: string) => (calls++, isEmail(value)))
		)
		const app = new Elysia().post(
			'/',
			{ body: t.Object({ email }) },
			({ body }) => body
		)

		expect((await post(app, { email: 'x' })).status).toBe(422)
		// re-run by the error walk instead of replayed from the first verdict
		expect(calls).toBe(2)
	})
})

// an annotation may hold the very array a node keeps as `~refine`: the route
// snapshot deep-freezes its own clone of the annotation, and the refinements
// the validator wraps must still be a separate, writable copy
it('wraps refinements whose array an annotation also references', async () => {
	const email = t.Refine(t.String(), isEmail)
	const app = new Elysia().post(
		'/',
		{
			body: t.Object({
				tag: t.Optional(t.String({ refinements: email['~refine'] })),
				email
			})
		},
		({ body }) => body
	)

	expect(() => app.compile()).not.toThrow()
	expect((await post(app, { email: 'a@b' })).status).toBe(200)
	expect((await post(app, { email: 'x' })).status).toBe(422)
})

// an AOT build replays a t.ObjectString by swapping its codec's `decode` for
// the baked one: that must land on Elysia's copy, not on the caller's codec
describe("frozen lane keeps the caller's codec", () => {
	afterEach(() => {
		System.Settings.Set({ immutableTypes: false })
		Compiled.clear()
		Validator.clear()
	})

	const createMeta = () =>
		t.Object({ id: t.String(), meta: t.ObjectString({ a: t.String() }) })

	for (const [name, wrap] of [
		['the schema itself', (Meta: any) => Meta],
		['t.Partial', (Meta: any) => t.Partial(Meta)]
	] as const)
		for (const immutableTypes of [false, true])
			it(`through ${name}${immutableTypes ? ' with immutableTypes' : ''}`, async () => {
				System.Settings.Set({ immutableTypes })

				const Meta = createMeta()
				const codec = Meta.properties.meta.anyOf[1]['~codec']
				const decode = codec.decode

				const app = buildMode('frozen', () =>
					new Elysia().post(
						'/',
						{ body: wrap(Meta) },
						({ body }) => body
					)
				)

				const response = await post(app, { id: '1', meta: '{"a":"x"}' })
				expect(response.status).toBe(200)
				expect(await response.json()).toEqual({
					id: '1',
					meta: { a: 'x' }
				})
				expect(codec.decode).toBe(decode)
			})
})
