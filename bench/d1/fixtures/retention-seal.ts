import { resolve } from 'node:path'

import { gc, memorySnapshot } from '../../../example/stress/utils'
import { injectRetained } from '../inject'
import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const routeCounts = [1, 100, 1_000, 10_000] as const
const shapes = ['plain', 'schema'] as const

type Shape = (typeof shapes)[number]

function selectedCounts() {
	const value = process.argv
		.find((argument) => argument.startsWith('--counts='))
		?.slice('--counts='.length)
	if (!value) return [...routeCounts]
	const counts = value
		.split(',')
		.map(Number)
		.filter((count) => Number.isInteger(count) && count > 0)
	if (!counts.length) throw new Error('retention-seal needs a route count')
	return counts
}

async function measure() {
	const routes = integerArgument('routes', 1_000)
	const shape = process.argv
		.find((argument) => argument.startsWith('--shape='))
		?.slice('--shape='.length) as Shape | undefined
	if (!shape || !shapes.includes(shape))
		throw new Error(`invalid retention-seal shape: ${shape}`)
	const image = process.env.D1_N3A_IMAGE ?? 'strict'
	if (image !== 'strict' && image !== 'introspect')
		throw new Error(`invalid N+3a image: ${image}`)

	const { Elysia, t } = await import(repoRoot + '/src/index.ts')
	gc()
	const before = memorySnapshot()
	const beforeRSS = process.memoryUsage().rss
	const app = new Elysia({
		introspect: image === 'introspect',
		precompile: true
	})
	const plain = ({ path }: { path: string }) => path
	const validated = ({ query }: { query: { value: number } }) => query.value
	for (let index = 0; index < routes; index++) {
		injectRetained(index)
		if (shape === 'plain') app.get(`/d1/${index}`, plain)
		else
			app.get(
				`/d1/${index}`,
				{
					query: t.Object({ value: t.Numeric() })
				},
				validated
			)
	}
	void app.fetch
	gc()
	const after = memorySnapshot()
	const afterRSS = process.memoryUsage().rss
	console.log(
		JSON.stringify({
			routes,
			shape,
			image,
			build: 'precompile',
			currentBytesPerRoute: (after.current - before.current) / routes,
			heapSizeBytesPerRoute:
				((after.heapSize ?? 0) - (before.heapSize ?? 0)) / routes,
			extraMemoryBytesPerRoute:
				((after.extraMemorySize ?? 0) - (before.extraMemorySize ?? 0)) /
				routes,
			rssBytesPerRoute: (afterRSS - beforeRSS) / routes
		})
	)
}

function runMeasure(routes: number, shape: Shape) {
	const result = Bun.spawnSync({
		cmd: [
			process.execPath,
			import.meta.path,
			'--measure',
			`--routes=${routes}`,
			`--shape=${shape}`
		],
		env: { ...process.env, NODE_ENV: 'production' },
		stdout: 'pipe',
		stderr: 'pipe'
	})
	const stderr = new TextDecoder().decode(result.stderr)
	if (result.exitCode !== 0)
		throw new Error(
			`retention-seal ${shape}/${routes} exited ${result.exitCode}: ${stderr}`
		)
	return JSON.parse(new TextDecoder().decode(result.stdout)) as Record<
		string,
		string | number
	>
}

function main() {
	const image = process.env.D1_N3A_IMAGE ?? 'strict'
	const samples: Record<string, number[]> = {}
	for (const routes of selectedCounts())
		for (const shape of shapes) {
			const result = runMeasure(routes, shape)
			if (result.image !== image)
				throw new Error(
					`retention-seal image mismatch: ${result.image} !== ${image}`
				)
			for (const [name, value] of [
				['current', result.currentBytesPerRoute],
				['heap-size', result.heapSizeBytesPerRoute],
				['extra-memory', result.extraMemoryBytesPerRoute],
				['rss', result.rssBytesPerRoute]
			] as const) {
				if (!Number.isFinite(value))
					throw new Error(
						`retention-seal ${shape}/${routes}/${name} is not finite`
					)
				samples[`${shape}-${routes}-${name}-bytes-per-route`] = [
					value as number
				]
			}
		}
	console.log(
		JSON.stringify({
			fixture: 'retention-seal',
			image,
			build: 'precompile',
			routeSizeOrder: selectedCounts(),
			samples
		})
	)
}

if (process.argv.includes('--measure')) await measure()
else main()
