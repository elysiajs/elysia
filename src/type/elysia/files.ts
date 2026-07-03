import { Decode } from 'typebox/type'
import type { Type } from 'typebox'

import { isBlob, isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { FileOptions, FilesOptions } from '../types'
import { ArrayType } from './array'
import { File } from './file'
import { Union } from './union'
import {
	cloneSchema,
	createSharedReference,
	elyType,
	getMeta,
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

const filesUnion = (options?: FileOptions): typeof BaseFiles =>
	Union([
		ArrayType(File(options)),
		Decode(File(options), (value) => [value])
	]) as typeof BaseFiles

export function Files(options?: FilesOptions): TFiles {
	BaseFiles ??= filesUnion()

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
		: filesUnion(fileOptions)

	const refines: RefinesType<File[]> = []

	if (options.minItems)
		refines.push([
			(value) => {
				const length = Array.isArray(value)
					? value.length
					: isBlob(value)
						? 1
						: 0

				return length >= options.minItems!
			},
			`Expect at least ${options.minItems} files`
		])

	if (options.maxItems)
		refines.push([
			(value) => {
				const len = Array.isArray(value)
					? value.length
					: isBlob(value)
						? 1
						: 0
				return len <= options.maxItems!
			},
			`Expect less than ${options.maxItems} files`
		])

	let schema: any = Refines(base, refines as any)
	const [, meta] = getMeta(options as any)
	if (meta) {
		schema = cloneSchema(schema)
		Object.assign(schema, meta)
	}

	return elyType(ELYSIA_TYPES.Files, schema)
}
