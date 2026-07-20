import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

import { busyWaitNanoseconds } from '../inject'
import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const routes = integerArgument('routes', 1_000)
const candidateLabel = process.env.D1_N3B_CANDIDATE

function argument(name: string) {
	return process.argv
		.find((value) => value.startsWith(`--${name}=`))
		?.slice(name.length + 3)
}

async function measure() {
	const artifact = argument('artifact')
	if (!artifact) throw new Error('aot-cold-start needs --artifact')

	const started = Bun.nanoseconds()
	if (process.env.D1_INJECT === 'aot-cold-start')
		busyWaitNanoseconds(200_000_000)
	const module = (await import(pathToFileURL(artifact).href)) as {
		app?: any
		default?: any
	}
	const app = module.app ?? module.default
	if (!app?.handle)
		throw new Error('standalone artifact did not export an app')

	const response = await app.handle(
		new Request(`http://localhost/d1/aot/${routes - 1}?value=ok`)
	)
	const body = await response.text()
	if (response.status !== 200 || body !== 'ok')
		throw new Error(
			`standalone artifact validation failed: ${response.status} ${body}`
		)
	const elapsed = Bun.nanoseconds() - started

	console.log(JSON.stringify({ elapsed }))
}

async function measureManifest() {
	const entry = argument('entry')
	if (!entry) throw new Error('aot-cold-start manifest needs --entry')

	const [{ compileToSource }, appModule] = await Promise.all([
		import(
			pathToFileURL(resolve(repoRoot, 'src/plugin/aot/source.ts')).href
		) as Promise<typeof import('../../../src/plugin/aot/source')>,
		import(pathToFileURL(entry).href) as Promise<{ app: any }>
	])
	const manifest = await compileToSource(appModule.app, {
		register: true,
		target: 'bun'
	})
	console.log(
		JSON.stringify({
			image: manifest.includes('lazyGroups') ? 'auto-lazy' : 'auto-eager',
			rawBytes: Buffer.byteLength(manifest),
			gzipBytes: gzipSync(manifest, { level: 9 }).length
		})
	)
}

async function buildAndMeasure() {
	if (process.env.NODE_ENV !== 'production')
		throw new Error('aot-cold-start requires NODE_ENV=production')
	if (
		candidateLabel !== undefined &&
		candidateLabel !== '0' &&
		candidateLabel !== '1'
	)
		throw new Error('D1_N3B_CANDIDATE must be 0 or 1 when provided')

	const directory = await mkdtemp(join(tmpdir(), 'ely-d1-aot-cold-'))
	try {
		const entry = join(directory, 'app.ts')
		const artifact = join(directory, 'artifact.mjs')
		const elysia = resolve(repoRoot, 'src/index.ts')
		await Bun.write(
			entry,
			`import { Elysia, t } from ${JSON.stringify(elysia)}
export const app = new Elysia()
const handler = ({ query }) => query.value
for (let index = 0; index < ${routes}; index++)
	app.get(\`/d1/aot/\${index}\`, { query: t.Object({ value: t.String() }) }, handler)
export default app
`
		)
		const pluginUrl = pathToFileURL(
			resolve(repoRoot, 'src/plugin/aot/bun.ts')
		).href
		const { aot } = (await import(
			pluginUrl
		)) as typeof import('../../../src/plugin/aot/bun')
		const result = await Bun.build({
			entrypoints: [entry],
			outdir: directory,
			naming: 'artifact.mjs',
			target: 'bun',
			format: 'esm',
			minify: {
				identifiers: false,
				syntax: true,
				whitespace: true
			},
			plugins: [
				aot(entry, {
					target: 'bun',
					treeShake: false,
					registerFrom: resolve(repoRoot, 'src/compile/aot.ts'),
					reconstructFrom: resolve(
						repoRoot,
						'src/compile/aot-reconstruct.ts'
					)
				})
			]
		})
		if (!result.success) throw new AggregateError(result.logs)

		// Measure the manifest in a fresh process after the standalone build so
		// neither measurement can warm compiler state used by the other.
		const manifestChild = Bun.spawnSync({
			cmd: [
				process.execPath,
				import.meta.path,
				'--manifest',
				`--entry=${entry}`,
				`--routes=${routes}`
			],
			env: { ...process.env, NODE_ENV: 'production' },
			stdout: 'pipe',
			stderr: 'pipe'
		})
		if (manifestChild.exitCode !== 0)
			throw new Error(
				`aot-cold-start manifest exited ${manifestChild.exitCode}: ${new TextDecoder().decode(manifestChild.stderr)}`
			)
		const measuredManifest = JSON.parse(
			new TextDecoder().decode(manifestChild.stdout)
		) as {
			image: 'auto-lazy' | 'auto-eager'
			rawBytes: number
			gzipBytes: number
		}
		const image = measuredManifest.image
		const expectedImage =
			candidateLabel === '1'
				? 'auto-eager'
				: candidateLabel === '0'
					? 'auto-lazy'
					: undefined
		if (expectedImage !== undefined && image !== expectedImage)
			throw new Error(
				`aot-cold-start ${candidateLabel === '1' ? 'candidate' : 'baseline'} emitted ${image}, expected ${expectedImage}`
			)
		if (
			!Number.isFinite(measuredManifest.rawBytes) ||
			!Number.isFinite(measuredManifest.gzipBytes) ||
			measuredManifest.rawBytes <= 0 ||
			measuredManifest.gzipBytes <= 0
		)
			throw new Error('aot-cold-start produced invalid manifest bytes')

		const timingSamples: number[] = []
		for (let index = 0; index < 7; index++) {
			const child = Bun.spawnSync({
				cmd: [
					process.execPath,
					import.meta.path,
					'--measure',
					`--artifact=${artifact}`,
					`--routes=${routes}`
				],
				env: { ...process.env, NODE_ENV: 'production' },
				stdout: 'pipe',
				stderr: 'pipe'
			})
			const stderr = new TextDecoder().decode(child.stderr)
			if (child.exitCode !== 0)
				throw new Error(
					`aot-cold-start measure exited ${child.exitCode}: ${stderr}`
				)
			const measured = JSON.parse(
				new TextDecoder().decode(child.stdout)
			) as { elapsed: number }
			if (!Number.isFinite(measured.elapsed) || measured.elapsed <= 0)
				throw new Error(
					'aot-cold-start produced an invalid timing sample'
				)
			timingSamples.push(measured.elapsed)
		}
		const artifactBytes = Bun.file(artifact).size

		console.log(
			JSON.stringify({
				fixture: 'aot-cold-start',
				routes,
				build: 'standalone-aot',
				image,
				artifactBytes,
				samples: {
					'import-to-first-valid-response-7x-ns': timingSamples,
					'artifact-bytes': [artifactBytes],
					'manifest-raw-bytes': [measuredManifest.rawBytes],
					'manifest-gzip-bytes': [measuredManifest.gzipBytes]
				}
			})
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

if (process.argv.includes('--measure')) await measure()
else if (process.argv.includes('--manifest')) await measureManifest()
else await buildAndMeasure()
