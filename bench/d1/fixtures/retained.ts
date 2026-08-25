import { resolve } from 'node:path'

import { gc, memorySnapshot } from '../../../example/stress/utils'
import { injectRetained } from '../inject'
import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')

async function main() {
	const routes = integerArgument('routes', 1_000)
	const { Elysia } = await import(repoRoot + '/src/index.ts')
	gc()
	const before = memorySnapshot()
	const beforeRSS = process.memoryUsage().rss
	const app = new Elysia()
	for (let i = 0; i < routes; i++) {
		injectRetained(i)
		app.get(`/d1/${i}`, () => 'ok')
	}
	void app.fetch
	gc()
	const after = memorySnapshot()
	const afterRSS = process.memoryUsage().rss
	console.log(
		JSON.stringify({
			fixture: 'retained',
			routes,
			before,
			after,
			currentBytesPerRoute: (after.current - before.current) / routes,
			heapSizeBytesPerRoute:
				((after.heapSize ?? 0) - (before.heapSize ?? 0)) / routes,
			extraMemoryBytesPerRoute:
				((after.extraMemorySize ?? 0) - (before.extraMemorySize ?? 0)) /
				routes,
			rssBytesPerRoute: (afterRSS - beforeRSS) / routes,
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
