import { Codec, Refine, Unsafe } from '../typebox-type'

import { NumberType } from './number'
import type { Type } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { DateOptions } from '../types'
import { StringType } from './string'
import { Union } from './union'
import { cloneSchema, createSharedReference, elyType, getMeta } from './utils'

const ISO8601 = /T\d\d(?::\d\d){1,2} \d\d:\d\d$/
const removeTime = / (\d{2}:\d{2})$/

const toTimestamp = (value: Date | string | number) => {
	if (value instanceof Date) return value.getTime()
	let t = new Date(value).getTime()
	if (
		isNaN(t) &&
		typeof value === 'string' &&
		/T\d{2}:\d{2}(:\d{2})? \d{2}:\d{2}$/.test(value)
	)
		t = new Date(value.replace(/ (\d{2}:\d{2})$/, '+$1')).getTime()
	return t
}

let StringifiedDate: Type.TCodec<
	Type.TUnion<[Type.TUnsafe<Date>, Type.TString, Type.TNumber]>,
	Date
>
let emptyDate: Type.TCodec<
	Type.TUnion<[Type.TUnsafe<Date>, Type.TString, Type.TNumber]>,
	Date
>
let sharedDate: ReturnType<
	typeof createSharedReference<
		DateOptions,
		ReturnType<typeof DateWithProperty>
	>
>
export function DateType(
	property?: DateOptions
): Type.TCodec<
	Type.TUnion<[Type.TUnsafe<Date>, Type.TString, Type.TNumber]>,
	Date
> {
	StringifiedDate ??= Codec(
		Union([
			Refine(
				Unsafe<Date>({ '~kind': 'Date' }),
				(value) => value instanceof Date,
				() => 'must be Date'
			),
			Refine(
				StringType(),
				(value) => {
					if (!isNaN(new Date(value).getTime())) return true

					if (ISO8601.test(value))
						return !isNaN(
							new Date(value.replace(removeTime, '+$1')).getTime()
						)
					return false
				},
				() => 'must be Date'
			),
			NumberType()
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
	const min = options.minimumTimestamp
	const max = options.maximumTimestamp
	const xMin = options.exclusiveMinimumTimestamp
	const xMax = options.exclusiveMaximumTimestamp
	const step = options.multipleOfTimestamp

	const minMessage =
		typeof min === 'number'
			? `date must be after or equal to ${new Date(min).toISOString()}`
			: undefined

	const maxMessage =
		typeof max === 'number'
			? `date must be before or equal to ${new Date(max).toISOString()}`
			: undefined

	const xMinMessage =
		typeof xMin === 'number'
			? `date must be after ${new Date(xMin).toISOString()}`
			: undefined

	const xMaxMessage =
		typeof xMax === 'number'
			? `date must be before ${new Date(xMax).toISOString()}`
			: undefined

	const stepMessage =
		typeof step === 'number'
			? `date timestamp must be a multiple of ${step}`
			: undefined

	let schema: any = StringifiedDate

	if (minMessage || maxMessage || xMinMessage || xMaxMessage || stepMessage) {
		let failed = 'must be Date'

		schema = Refine(
			schema,
			(value: Date | string | number) => {
				const t = toTimestamp(value)

				if (minMessage && t < (min as number)) {
					failed = minMessage
					return false
				}

				if (maxMessage && t > (max as number)) {
					failed = maxMessage
					return false
				}

				if (xMinMessage && t <= (xMin as number)) {
					failed = xMinMessage
					return false
				}

				if (xMaxMessage && t >= (xMax as number)) {
					failed = xMaxMessage
					return false
				}

				if (stepMessage && t % (step as number) !== 0) {
					failed = stepMessage
					return false
				}

				return true
			},
			() => failed
		)
	}

	const [, meta] = getMeta(options as any)
	if (meta) {
		schema = cloneSchema(schema)
		Object.assign(schema, meta)
		if (Array.isArray(schema.anyOf))
			schema.anyOf = schema.anyOf.map((member: any) => {
				const cloned = cloneSchema(member)
				if (meta.default !== undefined) cloned.default = meta.default
				return cloned
			})
	}

	return elyType(ELYSIA_TYPES.Date, schema)
}
