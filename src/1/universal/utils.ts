// @ts-ignore
export const isBun = typeof Bun !== 'undefined'
// @ts-ignore
export const isDeno = typeof Deno !== 'undefined'

export function isCloudflareWorker() {
	try {
		// Check for the presence of caches.default, which is a global in Workers
		if (
			// @ts-ignore
			typeof caches !== 'undefined' &&
			// @ts-ignore
			typeof caches.default !== 'undefined'
		)
			return true

		// @ts-ignore
		if (typeof WebSocketPair !== 'undefined') return true
	} catch {
		return false
	}

	return false
}
