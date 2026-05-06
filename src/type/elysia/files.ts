import { Type } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { FilesOptions } from '../types'
import { ArrayType } from './array'
import { File } from './file'
import { Union } from './union'
import {
	createSharedReference,
	elyType,
	Refines,
	type Refines as RefinesType
} from './utils'

let BaseFiles: Type.TUnion<
	[
		Type.TArray<Readonly<Type.TRefine<Type.TUnsafe<File>>>>,
		Type.TCodec<Readonly<Type.TRefine<Type.TUnsafe<File>>>, File[]>
	]
>
let emptyFiles: Readonly<
	Type.TUnion<
		[
			Type.TArray<Type.TUnsafe<File>>,
			Type.TCodec<Readonly<Type.TRefine<Type.TUnsafe<File>>>, File[]>
		]
	>
>
let sharedFiles: ReturnType<
	typeof createSharedReference<
		FilesOptions,
		ReturnType<typeof FilesWithProperty>
	>
>
export function Files(options?: FilesOptions) {
	BaseFiles ??= Union([
		ArrayType(File()),
		Type.Decode(File(), (value) => [value])
	])

	if (!options || isEmpty(options))
		return (emptyFiles ??= Object.freeze(
			elyType(ELYSIA_TYPES.Files, BaseFiles)
		))

	sharedFiles ??= createSharedReference(FilesWithProperty)
	return sharedFiles(options)
}

function FilesWithProperty(options: FilesOptions) {
	const refines: RefinesType<File[]> = []

	if (options.minItems && options.minItems > 1)
		refines.push([
			(value) =>
				Array.isArray(value) && value.length >= options.minItems!,
			`Expect at least ${options.minItems} files`
		])

	if (options.maxItems)
		refines.push([
			(value) =>
				Array.isArray(value) && value.length <= options.maxItems!,
			`Expect less than ${options.maxItems} files`
		])

	// refines not matched, expected Decode first
	return elyType(ELYSIA_TYPES.Files, Refines(BaseFiles, refines as any))
}
