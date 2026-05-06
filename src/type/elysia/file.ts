import { Type } from 'typebox'

import { isBlob, isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { FileOptions, FilesOptions, FileType, FileUnit } from '../types'
import {
	createSharedReference,
	elyType,
	Refines,
	type Refines as RefinesType
} from './utils'

export function checkFileExtension(type: string, extension: string) {
	if (type.startsWith(extension)) return true

	return (
		extension.charCodeAt(extension.length - 1) === 42 &&
		extension.charCodeAt(extension.length - 2) === 47 &&
		type.startsWith(extension.slice(0, -1))
	)
}

export function parseFileUnit(size: FileUnit) {
	if (typeof size !== 'string') return size

	switch (size.slice(-1)) {
		case 'k':
			return +size.slice(0, size.length - 1) * 1024

		case 'm':
			return +size.slice(0, size.length - 1) * 1048576

		default:
			return +size
	}
}

export let BaseFile: Type.TRefine<Type.TUnsafe<File>>
let emptyFile: Readonly<Type.TRefine<Type.TUnsafe<File>>>
let sharedFile: ReturnType<
	typeof createSharedReference<
		FileOptions,
		ReturnType<typeof FileWithProperty>
	>
>
export function File(options?: FileOptions) {
	BaseFile ??= Type.Refine(
		Type.Unsafe<File>({ '~kind': 'File' }),
		isBlob,
		'must be instance of Blob'
	)

	if (!options || isEmpty(options))
		return (emptyFile ??= Object.freeze(
			elyType(ELYSIA_TYPES.File, BaseFile)
		))

	sharedFile ??= createSharedReference(FileWithProperty)
	return sharedFile(options)
}

function FileWithProperty(options: FilesOptions) {
	const refines: RefinesType<File> = []

	if (options.minSize) {
		const minSize = parseFileUnit(options.minSize!)

		refines.push([
			(value) => value.size > minSize,
			`Expect file size to be more than ${options.minSize}`
		])
	}

	if (options.maxSize) {
		const maxSize = parseFileUnit(options.maxSize!)

		refines.push([
			(value) => value.size < maxSize,
			`Expect file size to be less than ${options.maxSize}`
		])
	}

	if (options.type) {
		if (typeof options.type === 'string')
			refines.push([
				(value) =>
					checkFileExtension(value.type, options.type as FileType),
				`Expect file type to be ${options.type}`
			])
		else
			refines.push([
				(value) => {
					for (let i = 0; i < options.type!.length; i++)
						if (checkFileExtension(value.type, options.type![i]))
							return true

					return false
				},
				`Expect file type to be one of ${options.type.join(', ')}`
			])
	}

	return elyType(ELYSIA_TYPES.File, Refines(BaseFile, refines))
}
