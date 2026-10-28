/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import z from 'zod'

// Header names arrive lowercased, so a `headers` schema key with an uppercase
// letter never matches a request (always 422 or undefined). The runtime no
// longer checks it: the types reject it, naming the key
// (`headers key "X-Token" must be lowercase`)

const upper = t.Object({ 'X-Token': t.String() })

// a route's hook object, `.route()`, `.ws()`
new Elysia().get(
	'/',
	// @ts-expect-error headers key "X-Token" must be lowercase
	{ headers: upper },
	() => 'ok'
)
new Elysia().post(
	'/',
	// @ts-expect-error headers key "X-Token" must be lowercase
	{ headers: upper },
	() => 'ok'
)
new Elysia().route(
	'GET',
	'/',
	// @ts-expect-error headers key "X-Token" must be lowercase
	{ headers: upper },
	() => 'ok'
)
// @ts-expect-error headers key "X-Ws" must be lowercase
new Elysia().use(websocket()).ws('/', {
	headers: t.Object({ 'X-Ws': t.String() }),
	message() {}
})

// a guard, object and callback form
// @ts-expect-error headers key "X-Token" must be lowercase
new Elysia().guard({ headers: upper })
// @ts-expect-error headers key "X-Token" must be lowercase
new Elysia().guard({ headers: upper }, (app) => app)

// Known gap: a macro's `headers` isn't checked (the check costs ~0.33%
// type-perf on every `.macro()`), so an uppercase key there compiles. It is
// caught only when written in a route's own `headers`
new Elysia().macro({ m: { headers: upper } })
new Elysia().macro({ m: (on: boolean) => ({ headers: upper }) })

// a model name and a `t.Ref`, resolved through the models, and a Standard
// Schema by its output
{
	const models = new Elysia().model({ H: upper })

	models.get(
		'/',
		// @ts-expect-error headers key "X-Token" must be lowercase
		{ headers: 'H' },
		() => 'ok'
	)
	models.get(
		'/',
		// @ts-expect-error headers key "X-Token" must be lowercase
		{ headers: t.Ref('H') },
		() => 'ok'
	)
	new Elysia().get(
		'/',
		// @ts-expect-error headers key "X-Zod" must be lowercase
		{ headers: z.object({ 'X-Zod': z.string() }) },
		() => 'ok'
	)
}

// still compile: lowercase keys, an index signature, an empty object, unions
// and intersections of lowercase objects, macros and models with lowercase
// headers, and uppercase keys anywhere but `headers`
{
	const lower = t.Object({ 'x-token': t.String() })

	new Elysia()
		.model({ L: lower })
		.macro({
			m: { headers: lower },
			n: (on: boolean) => ({ headers: lower })
		})
		.guard({ headers: lower, query: t.Object({ Upper: t.String() }) })
		.get('/a', { headers: lower }, () => 'ok')
		.get('/b', { headers: t.Record(t.String(), t.String()) }, () => 'ok')
		.get('/c', { headers: t.Object({}) }, () => 'ok')
		.get(
			'/d',
			{
				headers: t.Union([
					t.Object({ a: t.String() }),
					t.Object({ b: t.String() })
				])
			},
			() => 'ok'
		)
		.get(
			'/e',
			{
				headers: t.Intersect([
					t.Object({ a: t.String() }),
					t.Object({ b: t.String() })
				])
			},
			() => 'ok'
		)
		.get('/f', { headers: 'L' }, () => 'ok')
		.get('/g', { m: true, n: true }, () => 'ok')
		.post(
			'/h',
			{
				query: t.Object({ Upper: t.String() }),
				body: t.Object({ Upper: t.String() })
			},
			() => 'ok'
		)
		.get('/i', { headers: z.object({ 'x-zod': z.string() }) }, () => 'ok')
}
