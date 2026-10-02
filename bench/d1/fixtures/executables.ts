import { resolve } from 'node:path'

import { gc } from '../../../example/stress/utils'
import { injectExecutable } from '../inject'
import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')

async function main() {
	const routes = integerArgument('routes', 1_000)
	const { Elysia, t } = await import(repoRoot + '/src/index.ts')
	const app = new Elysia()
	for (let i = 0; i < routes; i++) {
		injectExecutable(i)
		switch (i % 6) {
			case 0:
				app.get(`/plain/${i}`, () => 'ok')
				break
			case 1:
				app.get(`/dynamic/${i}/:id`, ({ params }: any) => params.id)
				break
			case 2:
				app.post(
					`/json/${i}`,
					{ body: t.Object({ name: t.String(), age: t.Number() }) },
					({ body }: any) => body
				)
				break
			case 3:
				app.get(
					`/query/${i}`,
					{ query: t.Object({ page: t.Number() }) },
					({ query }: any) => query
				)
				break
			case 4:
				app.get(
					`/cookie/${i}`,
					{ cookie: t.Object({ session: t.Optional(t.String()) }) },
					({ cookie }: any) => cookie.session.value ?? ''
				)
				break
			default:
				app.get(`/mixed/${i}/:id`, ({ params }: any) => params.id)
		}
	}
	void app.fetch
	await app.handle(new Request('http://localhost/plain/0'))
	await app.handle(new Request('http://localhost/dynamic/1/value'))
	await app.handle(
		new Request('http://localhost/json/2', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'x', age: 1 })
		})
	)
	await app.handle(new Request('http://localhost/query/3?page=1'))
	await app.handle(
		new Request('http://localhost/cookie/4', {
			headers: { cookie: 'session=x' }
		})
	)
	await app.handle(new Request('http://localhost/mixed/5/value'))
	gc()
	const counts = (await import('bun:jsc')).heapStats()
		.objectTypeCounts as Record<string, number>
	console.log(
		JSON.stringify({
			fixture: 'executables',
			routes,
			counts: {
				Structure: counts.Structure ?? 0,
				FunctionExecutable: counts.FunctionExecutable ?? 0,
				FunctionCodeBlock: counts.FunctionCodeBlock ?? 0,
				UnlinkedFunctionExecutable:
					counts.UnlinkedFunctionExecutable ?? 0
			},
			routeSizeOrder: [routes]
		})
	)
}

try {
	await main()
} catch (error) {
	console.error(error)
	process.exitCode = 1
}
