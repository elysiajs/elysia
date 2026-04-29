function gc() {
	if (typeof Bun !== 'undefined') Bun.gc(true)
	else if (typeof global.gc === 'function') global.gc()
}

function memoryUsage() {
	if (typeof Bun !== 'undefined') {
		const { memoryUsage } = require('bun:jsc')

		gc()
		return memoryUsage().current
	}

	gc()
	return process.memoryUsage().heapUsed
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
