import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'

// #1972: a guard's `detail` reached routes with no hook of their own, but
// vanished for routes that declared one. The damage shows up in the generated
// OpenAPI document, not in a response, so these tests read `app.routes`
const hooksOf = (app: Elysia<any, any>, path: string, method: string) =>
	(app.routes.find((r) => r.path === path && r.method === method) as any)
		?.hooks

const detailOf = (app: Elysia<any, any>, path: string, method: string) =>
	hooksOf(app, path, method)?.detail

describe('guard detail', () => {
	it('applies guard detail to a route that declares its own hook', async () => {
		const app = new Elysia().guard({ detail: { tags: ['Admin'] } }, (app) =>
			app
				.get('/plain', () => 'ok')
				.post(
					'/with-body',
					{ body: t.Object({ name: t.String() }) },
					({ body }) => body
				)
		)

		await app.modules

		// the route without a hook was never broken — it is the control
		expect(detailOf(app, '/plain', 'GET')?.tags).toEqual(['Admin'])
		expect(detailOf(app, '/with-body', 'POST')?.tags).toEqual(['Admin'])
	})

	it('keeps the guard detail when the route declares detail of its own', async () => {
		const app = new Elysia().guard({ detail: { tags: ['Admin'] } }, (app) =>
			app.post(
				'/both',
				{
					body: t.Object({ name: t.String() }),
					detail: { summary: 'Create a thing' }
				},
				({ body }) => body
			)
		)

		await app.modules

		const detail = detailOf(app, '/both', 'POST')

		// neither side may erase the other
		expect(detail?.tags).toEqual(['Admin'])
		expect(detail?.summary).toBe('Create a thing')
	})

	it('lets the route override a scalar the guard also set', async () => {
		const app = new Elysia().guard(
			{ detail: { tags: ['Admin'], summary: 'guard summary' } },
			(app) =>
				app.post(
					'/override',
					{
						body: t.Object({ name: t.String() }),
						detail: { summary: 'route summary' }
					},
					({ body }) => body
				)
		)

		await app.modules

		const detail = detailOf(app, '/override', 'POST')

		// the more specific declaration wins on a conflict...
		expect(detail?.summary).toBe('route summary')
		// ...without taking the non-conflicting keys down with it
		expect(detail?.tags).toEqual(['Admin'])
	})

	it('does not leak detail between sibling routes', async () => {
		const app = new Elysia()
			.guard({ detail: { tags: ['Admin'] } }, (app) =>
				app.post(
					'/guarded',
					{ body: t.Object({ name: t.String() }) },
					({ body }) => body
				)
			)
			.post(
				'/outside',
				{ body: t.Object({ name: t.String() }) },
				({ body }) => body
			)

		await app.modules

		expect(detailOf(app, '/guarded', 'POST')?.tags).toEqual(['Admin'])
		// the guard is scoped to its callback; the sibling must stay untouched
		expect(detailOf(app, '/outside', 'POST')?.tags).toBeUndefined()
	})

	it('lets an inner guard replace the tags an outer one set', async () => {
		const app = new Elysia().guard({ detail: { tags: ['Outer'] } }, (app) =>
			app.guard({ detail: { tags: ['Inner'] } }, (app) =>
				app.post(
					'/nested',
					{ body: t.Object({ name: t.String() }) },
					({ body }) => body
				)
			)
		)

		await app.modules

		// arrays override rather than accumulate, as they do on 1.x — an
		// accumulating `tags` would also duplicate any entry both sides declare
		expect(detailOf(app, '/nested', 'POST')?.tags).toEqual(['Inner'])
	})

	// `detail` is an OpenAPI operation object, so its other arrays carry meaning
	// that a blanket concatenation would break.

	it('lets a route replace the security the guard requires', async () => {
		const app = new Elysia().guard(
			{ detail: { security: [{ apiKey: [] }] } },
			(app) =>
				app.post(
					'/users',
					{
						body: t.Object({ name: t.String() }),
						detail: { security: [{ oauth2: ['admin'] }] }
					},
					({ body }) => body
				)
		)

		await app.modules

		// only one Security Requirement Object has to be satisfied, so carrying
		// the guard's over as well would widen the route to either scheme
		expect(detailOf(app, '/users', 'POST')?.security).toEqual([
			{ oauth2: ['admin'] }
		])
	})

	it('lets a route opt out of the guard security with an empty array', async () => {
		const app = new Elysia().guard(
			{ detail: { security: [{ apiKey: [] }] } },
			(app) =>
				app.post(
					'/login',
					{
						body: t.Object({ username: t.String() }),
						detail: { security: [] }
					},
					({ body }) => body
				)
		)

		await app.modules

		// an empty array is how OpenAPI marks an operation public, and there is
		// no array value that can shrink an inherited one under concatenation
		expect(detailOf(app, '/login', 'POST')?.security).toEqual([])
	})

	it('does not duplicate a parameter the guard and the route both declare', async () => {
		const header = {
			name: 'X-Tenant',
			in: 'header',
			schema: { type: 'string' }
		}

		const app = new Elysia().guard(
			{ detail: { parameters: [header] } } as any,
			(app) =>
				app.post(
					'/tenant',
					{
						body: t.Object({ name: t.String() }),
						detail: {
							parameters: [{ ...header, required: true }]
						}
					} as any,
					({ body }) => body
				)
		)

		await app.modules

		// two entries sharing name + in make the emitted document fail spec
		// validation: "Operations must have unique name + in parameters"
		expect(detailOf(app, '/tenant', 'POST')?.parameters).toEqual([
			{ ...header, required: true }
		])
	})

	it('applies the guard `tags` shorthand to a route that declares its own hook', async () => {
		const app = new Elysia().guard({ tags: ['Admin'] }, (app) =>
			app
				.post(
					'/hooked',
					{ body: t.Object({ name: t.String() }) },
					({ body }) => body
				)
				.post('/plain', () => 'ok')
		)

		await app.modules

		// `tags` is `detail.tags`' shorthand on both LocalHook and
		// GuardLocalHook, so it was dropped by the same gap — the hookless
		// sibling is the control here too
		expect(hooksOf(app, '/hooked', 'POST')?.tags).toEqual(['Admin'])
		expect(hooksOf(app, '/plain', 'POST')?.tags).toEqual(['Admin'])
	})

	it('does not write a route detail into a schema the guard shares', async () => {
		const ErrorModel = t.Object({ message: t.String() })

		const app = new Elysia().guard(
			{ detail: { responses: { 400: ErrorModel } } } as any,
			(app) =>
				app
					.post(
						'/one',
						{
							body: t.Object({ name: t.String() }),
							detail: {
								responses: { 400: { description: 'only /one' } }
							}
						} as any,
						({ body }) => body
					)
					.post(
						'/two',
						{ body: t.Object({ name: t.String() }) },
						({ body }) => body
					)
		)

		await app.modules

		// a deep clone only copies plain objects, so a TypeBox model comes back
		// by reference — merging into it would stamp one route's description
		// onto the user's own model and onto every sibling that reads it
		expect('description' in ErrorModel).toBe(false)
		expect(
			(detailOf(app, '/two', 'POST')?.responses as any)?.[400]
		).not.toHaveProperty('description')
	})

	it('does not let one route write into the detail its siblings inherit', async () => {
		const app = new Elysia().guard({ detail: { tags: ['Admin'] } }, (app) =>
			app
				.post(
					'/one',
					{
						body: t.Object({ name: t.String() }),
						detail: { summary: 'only mine' }
					},
					({ body }) => body
				)
				.post(
					'/two',
					{ body: t.Object({ name: t.String() }) },
					({ body }) => body
				)
		)

		await app.modules

		// the inherited chain hook is memoized and shared, so merging into it
		// in place would hand `/one`'s summary to every later route
		expect(detailOf(app, '/one', 'POST')?.summary).toBe('only mine')
		expect(detailOf(app, '/two', 'POST')?.summary).toBeUndefined()
		expect(detailOf(app, '/two', 'POST')?.tags).toEqual(['Admin'])
	})
})
