import { Type } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { FileOptions, FilesOptions } from '../types'
import { ArrayType } from './array'
import { File } from './file'
import { Union } from './union'
import {
	cloneSchema,
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
export type TFiles = Type.TUnsafe<File[]>

export function Files(options?: FilesOptions): TFiles {
	BaseFiles ??= Union([
		ArrayType(File()),
		Type.Decode(File(), (value) => [value])
	])

	if (!options || isEmpty(options))
		return (emptyFiles ??= Object.freeze(
			elyType(ELYSIA_TYPES.Files, cloneSchema(BaseFiles))
		)) as unknown as TFiles

	sharedFiles ??= createSharedReference(FilesWithProperty)
	return sharedFiles(options) as unknown as TFiles
}

function FilesWithProperty(options: FilesOptions) {
	const fileOptions: FileOptions = {}
	if (options.type) fileOptions.type = options.type
	if (options.minSize) fileOptions.minSize = options.minSize
	if (options.maxSize) fileOptions.maxSize = options.maxSize

	const base: typeof BaseFiles = isEmpty(fileOptions)
		? BaseFiles
		: (Union([
				ArrayType(File(fileOptions)),
				Type.Decode(File(fileOptions), (value) => [value])
			]) as typeof BaseFiles)

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

	return elyType(ELYSIA_TYPES.Files, Refines(base, refines as any))
}
