import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'

describe('named optional schemas', () => {
	for (const [name, schema] of [
		['name', 'OptionalName'],
		['Ref', t.Ref('OptionalName')],
		['alias', 'Alias'],
		['nested alias', 'Alias2']
	] as const)
		it(`allows absent body and query fields through ${name}`, async () => {
			const app = new Elysia()
				.model({
					OptionalName: t.Optional(t.Object({ name: t.String() })),
					Alias: t.Ref('OptionalName'),
					Alias2: t.Ref('Alias')
				})
				.post(
					'/',
					{ body: schema, query: schema },
					({ body, query }) => ({
						body: body?.name ?? 'absent',
						query: query.name ?? 'absent'
					})
				)

			for (const present of [false, true]) {
				const response = await app.handle(
					new Request(
						`http://localhost/${present ? '?name=query' : ''}`,
						{
							method: 'POST',
							...(present
								? {
										headers: {
											'Content-Type': 'application/json'
										},
										body: JSON.stringify({ name: 'body' })
									}
								: {})
						}
					)
				)
				expect(response.status).toBe(200)
				expect(await response.json()).toEqual(
					present
						? { body: 'body', query: 'query' }
						: { body: 'absent', query: 'absent' }
				)
			}
		})
})

describe('optional primitive body', () => {
	for (const [name, schema] of [
		['inline', t.Optional(t.String())],
		['name', 'OptionalString'],
		['Ref', t.Ref('OptionalString')],
		['alias', 'StringAlias']
	] as const)
		it(`preserves absent and present values through ${name}`, async () => {
			const app = new Elysia()
				.model({
					OptionalString: t.Optional(t.String()),
					StringAlias: t.Ref('OptionalString')
				})
				.post('/', { body: schema }, ({ body }) => ({
					absent: body === undefined,
					value: body?.toUpperCase() ?? 'absent'
				}))
			for (const present of [false, true]) {
				const response = await app.handle(
					new Request('http://localhost/', {
						method: 'POST',
						...(present
							? {
									headers: { 'Content-Type': 'text/plain' },
									body: 'hello'
								}
							: {})
					})
				)
				expect(response.status).toBe(200)
				expect(await response.json()).toEqual(
					present
						? { absent: false, value: 'HELLO' }
						: { absent: true, value: 'absent' }
				)
			}
		})
})

describe('$ref only under if/then/else', () => {
	// Wrapping this schema into the models Module throws on its (snapshot-
	// frozen) t.Optional members, which fails the route compile, so every
	// request would 500 even when the conditional branch is never taken
	it('keeps serving requests with an optional sibling field', async () => {
		const app = new Elysia().model({ Inner: t.String() }).post(
			'/',
			{
				body: t.Object({
					a: t.Optional(t.String()),
					d: t.Optional(
						Object.assign(t.Object({ k: t.String() }), {
							if: t.Object({ k: t.Literal('a') }),
							then: t.Object({ k: t.String(), b: t.Ref('Inner') })
						})
					)
				})
			},
			({ body }) => body
		)

		const post = (body: unknown) =>
			app.handle(
				new Request('http://localhost/', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				})
			)

		for (const body of [{ a: 'x' }, { d: { k: 'z' } }]) {
			const response = await post(body)
			expect(response.status).toBe(200)
			expect(await response.json()).toEqual(body)
		}

		// the conditional branch still fails closed
		expect((await post({ d: { k: 'a', b: 1 } })).status).toBe(422)
	})
})
