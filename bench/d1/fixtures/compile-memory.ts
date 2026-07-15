import { resolve } from 'node:path'

import { gc, memorySnapshot } from '../../../example/stress/utils'
import { injectCompileHighwater } from '../inject'
import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')

async function main() {
	const routes = integerArgument('routes', 1_000)
	const { Elysia } = await import(repoRoot + '/src/index.ts')
	const app = new Elysia()
	for (let i = 0; i < routes; i++) {
		injectCompileHighwater(i)
		app.get(`/d1/${i}`, () => 'ok')
	}
	void app.fetch
	const maxRSS = process.resourceUsage().maxRSS
	gc()
	const snapshot = memorySnapshot()
	console.log(
		JSON.stringify({
			fixture: 'compile-memory',
			routes,
			maxRSS,
			postGcCurrent: snapshot.current,
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
