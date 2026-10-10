import type { TString, TStringOptions } from 'typebox'

import { noEnumerable } from '../constants'
import { evictOldestHalf } from '../../utils'
import { referenceCache, SHARED_REFERENCE_CACHE_LIMIT } from '../shared'

const emptyString = Object.freeze(
	Object.defineProperty(
		{ type: 'string', '~kind': 'String' },
		'~kind',
		noEnumerable
	) as any as TString
)
const stringFormatCache = new Map<string, TString>()
referenceCache(stringFormatCache)

export function StringType(options?: TStringOptions): TString {
	if (!options) return emptyString

	const totalOptions = Object.keys(options).length
	if (!totalOptions) return emptyString

	if (totalOptions === 1 && options.format) {
		const cached = stringFormatCache.get(options.format)
		if (cached) {
			if (stringFormatCache.size >= SHARED_REFERENCE_CACHE_LIMIT) {
				stringFormatCache.delete(options.format)
				stringFormatCache.set(options.format, cached)
			}

			return cached
		}

		if (stringFormatCache.size >= SHARED_REFERENCE_CACHE_LIMIT)
			evictOldestHalf(stringFormatCache)

		const schema = Object.freeze(
			Object.defineProperty(
				{
					type: 'string',
					format: options.format,
					'~kind': 'String'
				},
				'~kind',
				noEnumerable
			) as any as TString
		)
		stringFormatCache.set(options.format, schema)
		return schema
	}

	const schema = { ...options, type: 'string', '~kind': 'String' }
	return Object.defineProperty(schema, '~kind', noEnumerable) as any
}
