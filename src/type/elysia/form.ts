import { Type } from 'typebox'
import type { TObjectOptions, TProperties } from 'typebox'

import { ELYSIA_TYPES } from '../constants'
import { Intersect } from './intersect'
import type { IsTuple, ElysiaFormData } from '../../types'
import { ElysiaFile } from '../../universal/file'
import { ObjectType } from './object'
import { elyType } from './utils'

type BaseFormType<T extends Record<keyof any, unknown>> = Type.TCodec<
	Type.TRefine<Type.TUnsafe<ElysiaFormData<T>>>,
	(
		T extends Record<string, unknown>
			? { [K in keyof T]: T[K] extends Blob | ElysiaFile ? File : T[K] }
			: T extends Blob | ElysiaFile
				? File
				: T
	) extends infer A
		? {
				[key in keyof A]: IsTuple<A[key]> extends true
					? // @ts-expect-error
						A[key][number] extends Blob | ElysiaFile
						? File[]
						: A[key]
					: A[key]
			}
		: T
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
			(value) => value['~ely-form']
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
