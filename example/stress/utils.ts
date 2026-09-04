import { cpus } from 'node:os'

let warnedNoGc = false
export function gc() {
	if (typeof Bun !== 'undefined') Bun.gc(true)
	else if (typeof global.gc === 'function') global.gc()
	else if (!warnedNoGc) {
		warnedNoGc = true
		// On Node without `--expose-gc`, global.gc is undefined → this silently
		// no-ops and memory numbers include uncollected garbage (unfair vs Bun,
		// which always GCs). Surface it instead of lying.
		console.warn(
			'[stress] global.gc unavailable — run Node with `--expose-gc` for accurate memory numbers.'
		)
	}
}

export function memoryUsage() {
	if (typeof Bun !== 'undefined') {
		const { memoryUsage } = require('bun:jsc')

		gc()
		return memoryUsage().current
	}

	gc()
	return process.memoryUsage().heapUsed
}

export function memorySnapshot() {
	gc()

	if (typeof Bun !== 'undefined') {
		const { heapStats, memoryUsage } = require('bun:jsc')
		const memory = memoryUsage()
		const heap = heapStats()

		return {
			runtime: 'bun',
			metric: 'bun:jsc.current',
			current: memory.current,
			heapSize: heap.heapSize,
			extraMemorySize: heap.extraMemorySize,
			objectCount: heap.objectCount
		}
	}

	const memory = process.memoryUsage()
	return {
		runtime: 'node',
		metric: 'process.memoryUsage.heapUsed',
		current: memory.heapUsed,
		heapUsed: memory.heapUsed,
		rss: memory.rss,
		external: memory.external
	}
}

export function environment() {
	const cpu = cpus()
	return {
		runtime: typeof Bun !== 'undefined' ? 'bun' : 'node',
		runtimeVersion:
			typeof Bun !== 'undefined' ? Bun.version : process.version,
		platform: process.platform,
		arch: process.arch,
		cpuModel: cpu[0]?.model ?? 'unknown',
		logicalCpuCount: cpu.length
	}
}

export function median(values: number[]) {
	const sorted = values.toSorted((a, b) => a - b)
	return sorted[Math.floor(sorted.length / 2)]!
}

export function profile(title: string) {
	const m1 = memoryUsage()
	const t1 = performance.now()

	return () => {
		const t2 = performance.now()
		gc()
		const m2 = memoryUsage()

		const time = t2 - t1
		const memory = m2 - m1

		console.log(title)
		console.log('Time:', time.toFixed(2), 'ms')
		console.log('Memory usage:', (memory / 1024 / 1024).toFixed(2), 'MB')

		return { time, memory }
	}
}
