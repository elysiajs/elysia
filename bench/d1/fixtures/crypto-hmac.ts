import { createHmac } from 'node:crypto'
import { resolve } from 'node:path'

import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const secret = 'd1-cookie-secret'
const value = 'd1-session-value'

async function main() {
	const warmup = integerArgument('warmup', 50)
	const requests = integerArgument('requests', 200)
	const batch = 100
	const crypto = await import(repoRoot + '/src/cookie/crypto.ts')
	const { Elysia, t } = await import(repoRoot + '/src/index.ts')
	const direct: number[] = []
	const expectedSignature = `${value}.${createHmac('sha256', secret)
		.update(value)
		.digest('base64')
		.replace(/=+$/, '')}`
	if (crypto.signCookieSync(value, secret) !== expectedSignature)
		throw new Error('HMAC provider produced the wrong direct result')

	for (let i = 0; i < warmup; i++) crypto.signCookieSync(value, secret)
	for (let sample = 0; sample < requests; sample++) {
		const started = Bun.nanoseconds()
		for (let i = 0; i < batch; i++) crypto.signCookieSync(value, secret)
		direct.push((Bun.nanoseconds() - started) / batch)
	}

	const request = () =>
		new Request('http://localhost/', {
			headers: {
				cookie: `session=${encodeURIComponent(expectedSignature)}`
			}
		})
	const app = new Elysia().get(
		'/',
		{
			cookie: t.Cookie(
				{ session: t.String() },
				{ secrets: secret, sign: ['session'] }
			)
		},
		({ cookie }: any) => {
			const current = cookie.session.value
			cookie.session.value = current
			return current
		}
	)
	void app.fetch
	const preflight = await app.handle(request())
	if (preflight.status !== 200 || (await preflight.text()) !== value)
		throw new Error('signed-cookie handler produced the wrong integrated result')

	for (let i = 0; i < warmup; i++)
		await (await app.handle(request())).arrayBuffer()
	const integrated: number[] = []
	for (let i = 0; i < requests; i++) {
		const started = Bun.nanoseconds()
		const response = await app.handle(request())
		await response.arrayBuffer()
		integrated.push(Bun.nanoseconds() - started)
	}

	console.log(
		JSON.stringify({
			fixture: 'crypto-hmac',
			provider: crypto.hmacProvider ?? 'node',
			warmup,
			requests,
			batch,
			samples: {
				'direct-sign-ns-per-op': direct,
				'signed-cookie-handle-p50-ns': integrated
			}
		})
	)
}

try {
	await main()
} catch (error) {
	console.error(error)
	process.exitCode = 1
}
