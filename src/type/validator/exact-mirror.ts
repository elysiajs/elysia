export type CreateMirror = (schema: any, options?: any) => any

function loadExactMirror(): CreateMirror | undefined {
	try {
		const meta = import.meta as ImportMeta & {
			require?: (specifier: string) => any
		}
		const require =
			meta.require ??
			(globalThis as any).process
				?.getBuiltinModule?.('module')
				?.createRequire(import.meta.url)

		const pkg = 'exact-mirror'
		const module = require?.(pkg)
		const mirror = module?.default ?? module

		return typeof mirror === 'function' ? mirror : undefined
	} catch {}
}

let exactMirror = loadExactMirror()

export const getExactMirror = () => exactMirror

// Internal registration hook for non-Node runtimes and tests.
export const setExactMirror = (mirror: CreateMirror | undefined) =>
	(exactMirror = mirror)

export const exactMirrorRequired = () =>
	new Error(
		"exact-mirror is required when using normalize: 'exactMirror' or sanitize. Install it and, if the runtime cannot load CommonJS modules, register it with setupTypebox({ exactMirror }); otherwise use normalize: 'typebox'."
	)
