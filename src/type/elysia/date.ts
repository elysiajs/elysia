import { Type } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { DateOptions } from '../types'
import { StringType } from './string'
import { Union } from './union'
import {
	createSharedReference,
	elyType,
	Refines,
	type Refines as RefinesType
} from './utils'

let StringifiedDate: Type.TCodec<
	Type.TUnion<[Type.TRefine<Type.TUnsafe<Date>>, Type.TString]>,
	Date
>
let emptyDate: Type.TCodec<
	Type.TUnion<[Type.TRefine<Type.TUnsafe<Date>>, Type.TString]>,
	Date
>
let sharedDate: ReturnType<
	typeof createSharedReference<
		DateOptions,
		ReturnType<typeof DateWithProperty>
	>
>
export function DateType(property?: DateOptions) {
	StringifiedDate ??= Type.Codec(
		Union([
			Type.Refine(
				Type.Unsafe<Date>({ '~kind': 'Date' }),
				(value) => value instanceof Date,
				'must be Date'
			),
			StringType({
				format: 'date'
			})
		])
	)
		.Decode((value) => (value instanceof Date ? value : new Date(value)))
		.Encode((value) =>
			value instanceof Date ? value.toISOString() : value + ''
		)

	if (!property || isEmpty(property))
		return (emptyDate ??= Object.freeze(
			elyType(ELYSIA_TYPES.Date, StringifiedDate)
		))

	sharedDate ??= createSharedReference(DateWithProperty)
	return sharedDate(property)
}

function DateWithProperty(options: DateOptions) {
	const refines: RefinesType<Date> = []

	if (options.minimumTimestamp)
		refines.push([
			(value) => value.getTime() > options.minimumTimestamp!,
			`date must be after ${new Date(options.minimumTimestamp!).toISOString()}`
		])

	if (options.maximumTimestamp)
		refines.push([
			(value) => value.getTime() < options.maximumTimestamp!,
			`date must be before ${new Date(options.maximumTimestamp!).toISOString()}`
		])

	if (options.exclusiveMinimumTimestamp)
		refines.push([
			(value) => value.getTime() >= options.exclusiveMinimumTimestamp!,
			`date must be after or equal to ${new Date(options.exclusiveMinimumTimestamp!).toISOString()}`
		])

	if (options.exclusiveMaximumTimestamp)
		refines.push([
			(value) => value.getTime() <= options.exclusiveMaximumTimestamp!,
			`date must be before or equal to ${new Date(options.exclusiveMaximumTimestamp!).toISOString()}`
		])

	return elyType(ELYSIA_TYPES.Date, Refines(StringifiedDate, refines as any))
}
