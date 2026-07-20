import { Refine, Unsafe } from 'typebox/type'
import type { Type } from 'typebox'

import { isBlob, isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { FileOptions, FilesOptions, FileType } from '../types'
import {
	cloneSchema,
	createSharedReference,
	elyType,
	getMeta,
	Refines,
	type Refines as RefinesType
} from './utils'

import {
	ASYNC_REFINE,
	matchesAnyFileType,
	maybeQueueFileTypeCheck,
	parseFileUnit
} from './file-type'

let baseFile: Type.TRefine<Type.TUnsafe<File>>
let emptyFile: Readonly<Type.TRefine<Type.TUnsafe<File>>>
let sharedFile: ReturnType<
	typeof createSharedReference<
		FileOptions,
		ReturnType<typeof FileWithProperty>
	>
>
export function File(options?: FileOptions) {
	baseFile ??= Refine(
		Unsafe<File>({ '~kind': 'File' }),
		isBlob,
		() => 'must be instance of Blob'
	)

	if (!options || isEmpty(options))
		return (emptyFile ??= Object.freeze(
			elyType(ELYSIA_TYPES.File, cloneSchema(baseFile))
		))

	sharedFile ??= createSharedReference(FileWithProperty)
	return sharedFile(options)
}

function FileWithProperty(options: FilesOptions) {
	const refines: RefinesType<File> = []

	if (options.minSize !== undefined) {
		const minSize = parseFileUnit(options.minSize!)

		refines.push([
			(value) => value.size >= minSize,
			`Expect file size to be more than ${options.minSize}`
		])
	}

	if (options.maxSize !== undefined) {
		const maxSize = parseFileUnit(options.maxSize!)

		refines.push([
			(value) => value.size <= maxSize,
			`Expect file size to be less than ${options.maxSize}`
		])
	}

	if (options.type) {
		const types: FileType[] =
			typeof options.type === 'string' ? [options.type] : options.type

		const message =
			types.length === 1
				? `Expect file type to be ${types[0]}`
				: `Expect file type to be one of ${types.join(', ')}`

		const checkType = (value: File) => {
			if (!matchesAnyFileType(value.type, types)) return false

			maybeQueueFileTypeCheck(value, types, message)

			return true
		}
		;(checkType as any)[ASYNC_REFINE] = true

		refines.push([checkType, message])
	}

	let schema = Refines(baseFile, refines)
	const [, meta] = getMeta(options as any)
	if (meta) {
		schema = cloneSchema(schema)
		Object.assign(schema, meta)
	}

	return elyType(ELYSIA_TYPES.File, schema)
}
