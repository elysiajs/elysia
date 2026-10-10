import type {
	TInteger,
	TObject,
	TObjectOptions,
	TOptional,
	TProperties,
	TString
} from 'typebox'

import { Integer } from './integer'
import { ObjectType } from './object'
import { Optional } from './optional'
import { StringType } from './string'

interface TProblemBase {
	type: TString
	code: TOptional<TString>
	title: TString
	status: TInteger
	detail: TOptional<TString>
	instance: TOptional<TString>
}

/**
 * RFC 9457 Problem Details schema. Extension members are spread last, so they
 * may override a base member.
 *
 * @see https://www.rfc-editor.org/info/rfc9457
 */
export const Problem = <T extends TProperties = {}>(
	extension?: T,
	options?: TObjectOptions
): TObject<Omit<TProblemBase, keyof T> & T> =>
	ObjectType(
		{
			type: StringType(),
			code: Optional(StringType()),
			title: StringType(),
			status: Integer(),
			detail: Optional(StringType()),
			instance: Optional(StringType()),
			...extension
		},
		options
	) as any
