import { Decode, Refine, Unsafe } from '../typebox-type'
import type {
	StaticDecode,
	TObjectOptions,
	TProperties,
	TSchema,
	Type
} from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { isElysiaForm } from '../../utils'
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
		Decode(
			Refine(
				Unsafe<any>({ '~kind': 'FormData' }),
				(value) => isElysiaForm(value),
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
