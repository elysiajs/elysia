import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { cpus, release } from 'node:os'
import { dirname, relative, resolve } from 'node:path'

import type {
	BunManifest,
	FloorsFile,
	MachineManifest,
	PinnedManifest
} from './schema'

export const BENCH_SOURCE_FILES = [
	'bench/d1/env.ts',
	'bench/d1/inject.ts',
	'bench/d1/margins.json',
	'bench/d1/run.ts',
	'bench/d1/schema.ts',
	'bench/d1/stats.ts',
	'bench/d1/runtime-lowering.test.ts',
	'bench/d1/retention-seal.test.ts',
	'bench/d1/canonical-ir.test.ts',
	'bench/d1/provenance.test.ts',
	'bench/d1/validation.test.ts',
	'bench/d1/websocket-runtime.test.ts',
	'bench/d1/fixtures/aot-cold-start.ts',
	'bench/d1/fixtures/cold-start.ts',
	'bench/d1/fixtures/canonical-ir.ts',
	'bench/d1/fixtures/post-n4.ts',
	'bench/d1/fixtures/compile-memory.ts',
	'bench/d1/fixtures/crypto-hmac.ts',
	'bench/d1/fixtures/default-headers.ts',
	'bench/d1/fixtures/body-presence.ts',
	'bench/d1/fixtures/executables.ts',
	'bench/d1/fixtures/formdata.ts',
	'bench/d1/fixtures/http.ts',
	'bench/d1/fixtures/native-table.ts',
	'bench/d1/fixtures/retained.ts',
	'bench/d1/fixtures/retention-seal.ts',
	'bench/d1/fixtures/runtime-http.ts',
	'bench/d1/fixtures/runtime-lowering.ts',
	'bench/d1/fixtures/websocket-runtime.ts',
	'bench/d1/fixtures/response-body-cookie.ts',
	'bench/d1/fixtures/validation.ts',
	'bench/d1/fixtures/utils.ts',
	'example/stress/utils.ts',
	'package.json'
] as const

export const PRODUCT_SOURCE_INPUTS = [
	'src',
	'build.ts',
	'package.json',
	'bun.lock',
	'tsconfig.json'
] as const

export const POST_N4_BASELINE_COMMIT =
	'a5831b577e98fd4973c331ebfb075893c9679fd5'

export interface D1Environment {
	machine: MachineManifest
	bun: BunManifest
	env: Record<string, string>
	machineId: string
}

function text(value: Uint8Array | undefined) {
	return value ? new TextDecoder().decode(value).trim() : ''
}

export function command(command_: string, args: string[]) {
	try {
		const result = Bun.spawnSync({
			cmd: [command_, ...args],
			stdout: 'pipe',
			stderr: 'pipe'
		})
		return {
			code: result.exitCode ?? 1,
			stdout: text(result.stdout),
			stderr: text(result.stderr)
		}
	} catch (error) {
		return { code: 1, stdout: '', stderr: String(error) }
	}
}

function commandText(command_: string, args: string[]) {
	const result = command(command_, args)
	return result.code === 0 ? result.stdout : 'unavailable'
}

function cleanCpuModel(model: string) {
	return model
		.toLowerCase()
		.replace(/^apple\s+/, '')
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
}

export function deriveMachineId(
	cpuModel: string,
	platform: string,
	arch: string
) {
	return `${cleanCpuModel(cpuModel)}-${platform}-${arch}`
}

function macImage() {
	const product = commandText('sw_vers', ['-productName'])
	const build = commandText('sw_vers', ['-buildVersion'])
	return { product, build }
}

function powerState() {
	const battery = commandText('pmset', ['-g', 'batt'])
	const settings = commandText('pmset', ['-g'])
	const source =
		battery.match(/Now drawing from '([^']+)'/i)?.[1] ?? 'unknown'
	const lowPowerMode =
		settings.match(/lowpowermode\s+([01])/i)?.[1] ?? 'unknown'
	return { source, lowPowerMode }
}

export function relevantEnvironment(
	environment: NodeJS.ProcessEnv = process.env
) {
	return Object.fromEntries(
		Object.entries(environment)
			.filter(
				([key, value]) =>
					value !== undefined &&
					(key === 'NODE_ENV' ||
						key === 'ELYSIA_EXPERIMENTAL_BUN_CRYPTO_HASHER' ||
						key.startsWith('BUN_') ||
						key.startsWith('D1_'))
			)
			.sort(([a], [b]) => a.localeCompare(b))
	) as Record<string, string>
}

export function captureEnvironment(): D1Environment {
	const cpuModel = cpus()[0]?.model ?? 'unknown'
	const platform = process.platform
	const arch = process.arch
	const machine = {
		machineId: deriveMachineId(cpuModel, platform, arch),
		cpuModel,
		arch,
		platform,
		osRelease: release(),
		osImage:
			platform === 'darwin'
				? macImage()
				: { product: 'unavailable', build: 'unavailable' },
		power:
			platform === 'darwin'
				? powerState()
				: { source: 'unavailable', lowPowerMode: 'unavailable' }
	}
	const { machineId, ...machineManifest } = machine
	const bun = {
		version: Bun.version,
		revision: Bun.revision
	}
	return {
		machine: machineManifest,
		bun,
		env: relevantEnvironment(),
		machineId
	}
}

function staticImports(source: string) {
	const imports: string[] = []
	const pattern =
		// eslint-disable-next-line sonarjs/slow-regex -- scans trusted local source files and must support multiline imports
		/\b(?:import|export)\s+(?!\()(?:(?:type)\s+)?(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g
	for (const match of source.matchAll(pattern)) imports.push(match[1]!)
	return imports
}

async function resolveLocalImport(
	repoRoot: string,
	sourceFile: string,
	specifier: string
) {
	if (!specifier.startsWith('.')) return undefined
	const base = resolve(repoRoot, dirname(sourceFile), specifier)
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.json`,
		resolve(base, 'index.ts')
	]
	for (const candidate of candidates) {
		try {
			await readFile(candidate)
			return relative(repoRoot, candidate)
		} catch {}
	}
	return undefined
}

async function benchTypeScriptFiles(
	repoRoot: string,
	directory = 'bench/d1'
): Promise<string[]> {
	const result: string[] = []
	for await (const path of new Bun.Glob('**/*.ts').scan({
		cwd: resolve(repoRoot, directory),
		onlyFiles: true
	}))
		result.push(`${directory}/${path}`)
	return result.sort()
}

export async function assertBenchSourceFileListCoversStaticImports(
	repoRoot: string
) {
	const listed = new Set<string>(BENCH_SOURCE_FILES)
	if (listed.size !== BENCH_SOURCE_FILES.length)
		throw new Error('BENCH_SOURCE_FILES cannot contain duplicates')

	if (
		BENCH_SOURCE_FILES.some(
			(file) =>
				file.startsWith('bench/d1/baseline/') ||
				file.startsWith('bench/d1/runs/') ||
				file.startsWith('trace/')
		)
	)
		throw new Error(
			'BENCH_SOURCE_FILES cannot include baseline, runs, or trace output'
		)
	const currentBenchFiles = await benchTypeScriptFiles(repoRoot)
	const missingBenchFiles = currentBenchFiles.filter(
		(file) => !listed.has(file)
	)
	if (missingBenchFiles.length)
		throw new Error(
			`BENCH_SOURCE_FILES is missing: ${missingBenchFiles.join(', ')}`
		)
	for (const file of BENCH_SOURCE_FILES) {
		try {
			await readFile(resolve(repoRoot, file))
		} catch {
			throw new Error(`BENCH_SOURCE_FILES names a missing file: ${file}`)
		}
	}
	const queue = currentBenchFiles.slice()
	const visited = new Set<string>()
	const missingImports: string[] = []
	while (queue.length) {
		const file = queue.pop()!
		if (visited.has(file)) continue
		visited.add(file)
		const source = await readFile(resolve(repoRoot, file), 'utf8')
		for (const specifier of staticImports(source)) {
			const imported = await resolveLocalImport(repoRoot, file, specifier)
			if (!imported || imported.startsWith('src/')) continue
			if (!listed.has(imported))
				missingImports.push(`${file} -> ${imported}`)
			if (!visited.has(imported)) queue.push(imported)
		}
	}
	if (missingImports.length)
		throw new Error(
			`BENCH_SOURCE_FILES misses static imports: ${missingImports.join(', ')}`
		)
	return true
}

export async function benchSourceHash(repoRoot: string) {
	await assertBenchSourceFileListCoversStaticImports(repoRoot)
	const hash = createHash('sha256')
	for (const file of BENCH_SOURCE_FILES) {
		const bytes = await readFile(resolve(repoRoot, file))
		hash.update(file)
		hash.update('\0')
		hash.update(String(bytes.byteLength))
		hash.update('\0')
		hash.update(bytes)
	}
	return hash.digest('hex')
}

async function productSourceFiles(repoRoot: string, path: string) {
	const absolute = resolve(repoRoot, path)
	if (await Bun.file(absolute).exists()) return [path]
	const files: string[] = []
	for await (const file of new Bun.Glob('**/*').scan({
		cwd: absolute,
		onlyFiles: true
	}))
		files.push(`${path}/${file}`)
	return files.length ? files : [path]
}

/** Hashes the exact product and build inputs used by a benchmark variant. */
export async function productSourceHash(repoRoot: string) {
	const files = (
		await Promise.all(
			PRODUCT_SOURCE_INPUTS.map((path) =>
				productSourceFiles(repoRoot, path)
			)
		)
	)
		.flat()
		.sort()
	const hash = createHash('sha256')
	for (const file of files) {
		const bytes = await readFile(resolve(repoRoot, file))
		hash.update(file)
		hash.update('\0')
		hash.update(String(bytes.byteLength))
		hash.update('\0')
		hash.update(bytes)
	}
	return hash.digest('hex')
}

/** Mirrors only product/build inputs while leaving a pinned proof harness intact. */
export async function mirrorProductSource(sourceRoot: string, targetRoot: string) {
	for (const path of PRODUCT_SOURCE_INPUTS) {
		const target = resolve(targetRoot, path)
		await rm(target, { recursive: true, force: true })
		await mkdir(dirname(target), { recursive: true })
		await cp(resolve(sourceRoot, path), target, { recursive: true })
	}
}

export async function capturePinnedManifest(
	repoRoot: string
): Promise<PinnedManifest> {
	const environment = captureEnvironment()
	return {
		schemaVersion: 1,
		kind: 'd1-manifest',
		machineId: environment.machineId,
		machine: environment.machine,
		bun: environment.bun,
		env: environment.env,
		benchSourceHash: await benchSourceHash(repoRoot),
		createdAt: new Date().toISOString()
	}
}

export function pinOwnerBenchSourceHashes(
	manifest: PinnedManifest,
	owners: Iterable<string>,
	currentHash: string
): PinnedManifest {
	const pins = new Map(Object.entries(manifest.ownerBenchSourceHashes ?? {}))
	for (const owner of [...owners].sort()) pins.set(owner, currentHash)

	return {
		...manifest,
		ownerBenchSourceHashes: Object.fromEntries(
			[...pins].sort(([left], [right]) => left.localeCompare(right))
		)
	}
}

export function assertOwnerBenchSourcePins(
	manifest: PinnedManifest,
	owners: Iterable<string>,
	currentHash: string,
	label = 'pinned manifest'
) {
	for (const owner of [...owners].sort()) {
		const pinnedHash = manifest.ownerBenchSourceHashes?.[owner]
		if (pinnedHash === undefined)
			throw new Error(
				`${label} has no benchmark-source pin for owner '${owner}'; ` +
					`run bun run bench:d1:aa --owners=${owner}`
			)
		if (pinnedHash !== currentHash)
			throw new Error(
				`${label} benchmark-source pin is stale for owner '${owner}'; ` +
					`run bun run bench:d1:aa --owners=${owner}`
			)
	}
}

export function floorsForBenchSourceHash(
	floors: FloorsFile,
	currentHash: string
): FloorsFile {
	if (floors.benchSourceHash === currentHash) return floors

	return {
		...floors,
		benchSourceHash: currentHash,
		sessions: [],
		floors: {},
		countDeltas: {}
	}
}

export function assertPreflightEqual(
	current: D1Environment,
	pinned: PinnedManifest
) {
	const compare = {
		machine: current.machine,
		bun: current.bun,
		env: current.env
	}
	const expected = {
		machine: pinned.machine,
		bun: pinned.bun,
		env: pinned.env
	}
	if (JSON.stringify(compare) !== JSON.stringify(expected))
		throw new Error(
			'D1 preflight mismatch: Bun pin, OS image, power state, machine, or D1 environment differs from the pinned manifest'
		)
}

export function gitInfo(repoRoot: string) {
	const commitResult = command('git', ['-C', repoRoot, 'rev-parse', 'HEAD'])
	if (commitResult.code !== 0)
		throw new Error(`cannot read git commit: ${commitResult.stderr}`)
	const status = command('git', [
		'-C',
		repoRoot,
		'status',
		'--porcelain',
		'--untracked-files=all'
	])
	return { commit: commitResult.stdout, dirty: Boolean(status.stdout) }
}
