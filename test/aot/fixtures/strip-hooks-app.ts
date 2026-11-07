import { Elysia, t } from '../../../src'

// decorate + derive + beforeHandle make evaluation enter the error.ts import
// cycle from error.ts itself, the order that hit the PROBLEM_JSON TDZ
export const app = new Elysia()
	.decorate(
		'svc',
		new (class Svc {
			v = 41
			next() {
				return ++this.v
			}
		})()
	)
	.derive(() => Promise.resolve({ who: 'derived' }))
	.onBeforeHandle(function () {
		return new Promise<void>((r) => setTimeout(r, 1))
	})
	.get('/', 'hi')
	.get('/who', ({ who }) => who)
	.get('/svc', ({ svc }) => ({ n: svc.next() }))
	.get(
		'/user/:id',
		{ params: t.Object({ id: t.Numeric() }) },
		({ params }) => params.id
	)
	.get(
		'/pat',
		{
			query: t.Object({
				slug: t.String({ pattern: '^[a-z]+(-[a-z]+)*$' })
			})
		},
		({ query }) => query.slug
	)
	.post('/json', { body: t.Object({ name: t.String() }) }, ({ body }) => body)
