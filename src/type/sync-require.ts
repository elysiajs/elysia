/**
 * Synchronous `require` resolving from the CALLER's module: pass its own
 * `import.meta` and `import.meta.url` (a CJS build empties `import.meta` but
 * still rewrites `import.meta.url`)
 *
 * Never swapped by the AOT build plugin
 */
export const syncRequire = (
	meta: ImportMeta,
	url: string
): ((specifier: string) => any) | undefined =>
	(meta as ImportMeta & { require?: (specifier: string) => any }).require ??
	(globalThis as any).process
		?.getBuiltinModule?.('module')
		?.createRequire(url)
