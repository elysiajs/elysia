import { Type } from 'typebox'

import { isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { FilesOptions } from '../types'
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
export function Files(options?: FilesOptions) {
	BaseFiles ??= Union([
		ArrayType(File()),
		Type.Decode(File(), (value) => [value])
	])

	// Clone `BaseFiles` (preserving non-enumerable `~kind` / `~refine`)
	// before passing to `elyType` so the cached `BaseFile` stays mutable
	// for later `Refines()` calls. Without the clone, the first
	// `t.File()` call freezes BaseFile via `emptyFile`, and subsequent
	// `t.File({type})` calls fail when typebox `Update()` tries to
	// define properties on the now-frozen schema.
	if (!options || isEmpty(options))
		return (emptyFiles ??= Object.freeze(
			elyType(ELYSIA_TYPES.Files, cloneSchema(BaseFiles))
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

	return elyType(ELYSIA_TYPES.Files, Refines(BaseFiles, refines as any))
}
