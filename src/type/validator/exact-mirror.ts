import { isCloudflareWorker } from '../../universal/constants'

export type CreateMirror = (schema: any, options?: any) => any

function loadExactMirror(): CreateMirror | undefined {
	// workerd has no CJS loader, so this probe can only fail — and its module
	// fallback service asserts in the host process before the catch below ever
	// sees it, printing an unsuppressable stack trace on every dev boot.
	// On workerd the supported paths are the AOT `-live` reroute or
	// `setupTypebox({ exactMirror })`.
	if (isCloudflareWorker) return undefined

	try {
		const meta = import.meta as ImportMeta & {
			require?: (specifier: string) => any
		}
		const require =
			meta.require ??
			(globalThis as any).process
				?.getBuiltinModule?.('module')
				?.createRequire(import.meta.url)

		const module = require?.('exact-mirror')
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
