import { Type } from 'typebox'
import type { TString, TStringOptions } from 'typebox'

import { noEnumerable } from '../constants'

const emptyString = Object.freeze(Type.String())
const stringFormatCache: Record<string, TString> = Object.create(null)
export function StringType(options?: TStringOptions): TString {
	if (!options) return emptyString

	const totalOptions = Object.keys(options).length
	if (!totalOptions) return emptyString

	if (totalOptions === 1 && options.format) {
		if (options.format in stringFormatCache)
			return stringFormatCache[options.format]

		return (stringFormatCache[options.format] = Object.freeze(
			Object.defineProperty(
				{
					type: 'string',
					format: options.format,
					'~kind': 'String'
				},
				'~kind',
				noEnumerable
			) as any as TString
		))
	}

	options.type = 'string'
	options['~kind'] = 'String'
	return Object.defineProperty(options, '~kind', noEnumerable) as any
}
