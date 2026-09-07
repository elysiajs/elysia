// Run each NODE_ENV value in a fresh process.
import { Elysia } from '../../src'

// Simulate setting NODE_ENV after Elysia loads.
if (process.env.ELYSIA_TEST_LATE_PROD) process.env.NODE_ENV = 'production'

const secret = ({ set }: any) => {
	set.redirect = '/signin'
	return 'THE SECRET'
}

const report = async (res: Response) => ({
	status: res.status,
	body: await res.text()
})

const out: Record<string, { status: number; body: string }> = {}

out.dispatch = await report(
	await new Elysia()
		.request(secret)
		.get('/secret', () => 'plain')
		.handle('/secret')
)

{
	const app = new Elysia().get('/secret', secret)
	;(app as any).compile()
	out.inline = await report(await app.handle('/secret'))
}

{
	const app = new Elysia().beforeHandle(() => {}).get('/secret', secret)
	;(app as any).compile()
	out.jit = await report(await app.handle('/secret'))
}

console.log(JSON.stringify(out))
