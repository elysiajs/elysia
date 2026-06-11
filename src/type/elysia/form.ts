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
	// `T` is a record of SCHEMA NODES, so decode each field to its static type
	// (`t.File()` → File, `t.Files()` → File[]) instead of passing the raw node
	// through — the old `T[K] extends Blob | ElysiaFile` test never matched a
	// schema node and leaked `Readonly<TRefine<TUnsafe<File>>>` into `ctx.body`.
	// (Mirrors the sibling `ObjectType(property)` member of the Intersect.)
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
				(value) => '~ely-form' in value,
				'must be instance of Elysia.form'
			),
			// The form's fields live inline on the object (`~ely-form` is just
			// a marker), so decoding is identity.
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
