import { heapStats } from 'bun:jsc'

// JSC scans the stack conservatively: collect on fresh tasks so a stale
// slot cannot pin garbage into one count and release it before the next
export const settle = async () => {
	for (let i = 0; i < 3; i++) {
		Bun.gc(true)
		await Bun.sleep(10)
	}

	return heapStats()
}
