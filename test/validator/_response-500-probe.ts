// Response masking reads NODE_ENV at module load, so each mode needs a child process.

import { Elysia, t, HTTPError } from '../../src'

HTTPError.typeBase = 'https://ex.test/errors'

const schema = { response: t.Object({ n: t.Number() }) } as any
const bad = () => ({ n: 'x' }) as any

const out: Record<string, { status: number; body: string }> = {}

const probe = async (name: string, app: any) => {
	await app.modules
	app.compile()

	const response = await app.handle(new Request('http://localhost/rs'))
	out[name] = { status: response.status, body: await response.text() }
}

await probe('noHook', new Elysia().get('/rs', schema, bad))

await probe(
	'hookReturnsValue',
	new Elysia()
		.error(({ error }: any) => ({ oops: (error as Error).message }))
		.get('/rs', schema, bad)
)

await probe(
	'hookReadsSetStatus',
	new Elysia()
		.error(({ set }: any) => ({ sawStatus: set.status }))
		.get('/rs', schema, bad)
)

await probe(
	'hookReturnsUndefined',
	new Elysia().error(() => {}).get('/rs', schema, bad)
)

await probe(
	'genericThrow',
	new Elysia().get('/rs', () => {
		throw new Error('kaboom')
	})
)

await probe(
	'requestViolation',
	new Elysia()
		.error(({ error }: any) => ({ oops: (error as Error).message }))
		.get('/rs', { query: t.Object({ n: t.Number() }) } as any, () => 'ok')
)

console.log(JSON.stringify(out))
