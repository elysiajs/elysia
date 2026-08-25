// ponytail: preload for profiling runs only — dumps heap snapshot + mimalloc
// stats at exit so stress scripts stay untouched.
// Usage: bun --cpu-prof --preload ./example/stress/heap-preload.ts example/stress/<case>.ts
import { heapStats } from 'bun:jsc'

process.on('beforeExit', () => {
	const name = (process.argv[1] ?? 'unknown').split('/').pop()!.replace(/\.ts$/, '')
	const dir = 'trace/profile'
	require('node:fs').mkdirSync(dir, { recursive: true })

	Bun.gc(true)

	const snapshot = Bun.generateHeapSnapshot()
	require('node:fs').writeFileSync(
		`${dir}/${name}.heapsnapshot`,
		typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot)
	)

	const stats = heapStats()
	console.error(
		`[heap-preload] ${name}: heapSize=${(stats.heapSize / 1e6).toFixed(1)}MB objects=${stats.objectCount}`
	)

	if (Bun.unsafe?.mimallocDump) {
		console.error(`[heap-preload] mimalloc dump for ${name}:`)
		Bun.unsafe.mimallocDump()
	} else console.error('[heap-preload] Bun.unsafe.mimallocDump not available')
})
