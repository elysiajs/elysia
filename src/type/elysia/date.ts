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

const ISO8601 = /T\d\d(?::\d\d){1,2} \d\d:\d\d$/
const removeTime = / (\d{2}:\d{2})$/

let StringifiedDate: Type.TCodec<Type.TUnion<Type.TSchema[]>, Date>
let emptyDate: Type.TCodec<Type.TUnion<Type.TSchema[]>, Date>
let sharedDate: ReturnType<
	typeof createSharedReference<
		DateOptions,
		ReturnType<typeof DateWithProperty>
	>
>
export function DateType(property?: DateOptions) {
	// Source schema: any of [actual Date | parseable string | epoch
	// ms]. The string branch uses a Refine — not `format: 'date-time'`
	// — so query-string-mangled offsets (`+`→space) survive Check and
	// reach the Decode callback, which attempts a repair. Strings that
	// can't be parsed at all (`'Hello'`) fail the Refine, surfacing as
	// 422 in plain `t.Date()` validation while still passing through
	// for `t.NoValidate(t.Date())` (which skips Check).
	StringifiedDate ??= Type.Codec(
		Union([
			Type.Refine(
				Type.Unsafe<Date>({ '~kind': 'Date' }),
				(value) => value instanceof Date,
				'must be Date'
			),
			Type.Refine(
				StringType(),
				(value) => {
					if (!isNaN(new Date(value).getTime())) return true

					if (ISO8601.test(value))
						return !isNaN(
							new Date(value.replace(removeTime, '+$1')).getTime()
						)
					return false
				},
				'must be Date'
			),
			Type.Number()
		])
	)
		.Decode((value) => {
			if (value instanceof Date) return value
			let d = new Date(value as any)

			if (
				isNaN(d.getTime()) &&
				typeof value === 'string' &&
				/T\d{2}:\d{2}(:\d{2})? \d{2}:\d{2}$/.test(value)
			)
				d = new Date(value.replace(/ (\d{2}:\d{2})$/, '+$1'))

			if (isNaN(d.getTime()))
				throw new Error(`Expected Date, got: ${String(value)}`)

			return d
		})
		.Encode((value) => {
			if (value instanceof Date) return value.toISOString()
			return value + ''
		})

	if (!property || isEmpty(property))
		return (emptyDate ??= Object.freeze(
			elyType(ELYSIA_TYPES.Date, StringifiedDate)
		)) as any

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
