export const requireExactMirror = (): unknown => {
	if (typeof require === 'function')
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load bundlers can follow
			return require('exact-mirror')
		} catch {}
}
