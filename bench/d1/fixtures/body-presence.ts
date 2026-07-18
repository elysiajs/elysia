import { resolve } from 'node:path'

import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')

async function main() {
	const warmup = integerArgument('warmup', 50)
	const requests = integerArgument('requests', 200)
	const batch = 1_000
	const utilities = await import(repoRoot + '/src/compile/handler/utils.ts')
	const hasBody =
		utilities.hasRequestBody ?? ((request: Request) => request.body != null)
	const framed = () =>
		new Request('http://localhost/', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'content-length': '16'
			},
			body: '{"value":"test"}'
		})
	if (!hasBody(framed())) throw new Error('framed body was not detected')

	for (let sample = 0; sample < warmup; sample++)
		for (const request of Array.from({ length: batch }, framed))
			hasBody(request)
	const isolated: number[] = []
	for (let sample = 0; sample < requests; sample++) {
		const batchRequests = Array.from({ length: batch }, framed)
		const started = Bun.nanoseconds()
		for (const request of batchRequests) hasBody(request)
		isolated.push((Bun.nanoseconds() - started) / batch)
	}

	const { Elysia } = await import(repoRoot + '/src/index.ts')
	const app = new Elysia().post('/', ({ body }: any) => body.value)
	void app.fetch
	const request = () =>
		new Request('http://localhost/', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'content-length': '16'
			},
			body: '{"value":"test"}'
		})
	const preflight = await app.handle(request())
	if (preflight.status !== 200 || (await preflight.text()) !== 'test')
		throw new Error('schema-less POST produced the wrong result')
	for (let i = 0; i < warmup; i++)
		await (await app.handle(request())).arrayBuffer()
	const integrated: number[] = []
	for (let i = 0; i < requests; i++) {
		const started = Bun.nanoseconds()
		await (await app.handle(request())).arrayBuffer()
		integrated.push(Bun.nanoseconds() - started)
	}

	console.log(
		JSON.stringify({
			fixture: 'body-presence',
			warmup,
			requests,
			batch,
			samples: {
				'framed-probe-p50-ns': isolated,
				'schema-less-post-p50-ns': integrated
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
