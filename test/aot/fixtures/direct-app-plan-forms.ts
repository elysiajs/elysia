import { Elysia, t } from '../../../src'

const structuralThenable = {
	then(resolve: (value: string) => void) {
		resolve('thenable')
	}
}

export const app = new Elysia()
	.get('/static', new Response('static', { status: 201 }))
	.get('/promise', Promise.resolve('promise') as any)
	.get('/coerce', { query: t.Object({ n: t.Numeric() }) }, ({ query }) =>
		String(query.n)
	)
	.get(
		'/response-valid',
		{ response: t.Object({ ok: t.Boolean() }) },
		() => ({ ok: true })
	)
	.get(
		'/response-invalid',
		{ response: t.Object({ ok: t.Boolean() }) },
		() => ({ ok: 'not-a-boolean' }) as any
	)
	.get(
		'/lifecycle',
		{ afterHandle: () => Promise.resolve('settled') as any },
		() => 'original'
	)
	.get('/thenable', structuralThenable as any)
