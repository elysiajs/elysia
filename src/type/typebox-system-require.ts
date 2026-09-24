import type { System } from 'typebox/system'

import { syncRequire } from './sync-require'
import type { TypeboxTypeNamespaces } from './typebox-type'

const requireLocale = (): typeof System.Locale => {
	try {
		const req = syncRequire(import.meta, import.meta.url)
		if (req) return req('typebox/system').System.Locale
	} catch {}

	throw new Error(
		"TypeSystem.Locale isn't bundled: it carries every locale table. Register it with setupTypebox({ typebox: { type, system } }) using `import * as system from 'typebox/system'`, or build with the AOT plugin."
	)
}

export const typeSystem = (
	system: TypeboxTypeNamespaces['system']
): typeof System =>
	system.System ??
	(Object.defineProperty(
		{
			Arguments: system.Arguments,
			Environment: system.Environment,
			Hashing: system.Hashing,
			Memory: system.Memory,
			Settings: system.Settings
		},
		'Locale',
		{ get: requireLocale, enumerable: true }
	) as typeof System)
