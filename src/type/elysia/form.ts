import { Type } from 'typebox'
import type {
	StaticDecode,
	TObjectOptions,
	TProperties,
	TSchema
} from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { Intersect } from './intersect'
import type { ElysiaFormData } from '../../types'
import { ObjectType } from './object'
import { elyType } from './utils'

type BaseFormType<T extends Record<keyof any, unknown>> = Type.TCodec<
	Type.TRefine<Type.TUnsafe<ElysiaFormData<T>>>,
	{ [K in keyof T]: T[K] extends TSchema ? StaticDecode<T[K]> : T[K] }
>

let BaseForm: BaseFormType<any>
export const Form = <T extends TProperties>(
	property: T,
	options?: TObjectOptions
) => {
	BaseForm ??= Object.freeze(
		Type.Decode(
			Type.Refine(
				Type.Unsafe<any>({ '~kind': 'FormData' }),
				(value) =>
					typeof value === 'object' &&
					value !== null &&
					'~ely-form' in value,
				() => 'must be instance of Elysia.form'
			),
			(value) => value
		)
	)

	return elyType(
		ELYSIA_TYPES.Form,
		Intersect([
			BaseForm as unknown as BaseFormType<T>,
			ObjectType(property, options)
		])
	)
}
