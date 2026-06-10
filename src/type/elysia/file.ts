import { Type } from 'typebox'

import { isBlob, isEmpty } from '../../utils'
import { ELYSIA_TYPES } from '../constants'
import type { FileOptions, FilesOptions, FileType, FileUnit } from '../types'
import type { MaybeArray, MaybePromise } from '../../types'
import {
	cloneSchema,
	createSharedReference,
	elyType,
	Refines,
	type Refines as RefinesType
} from './utils'

/**
 * Detect the actual file type (mime) from file content
 *
 * Returns a mime string, an object with a `mime` property
 * (compatible with `fileTypeFromBlob` of the 'file-type' package),
 * or nullish if the type cannot be determined
 */
export type FileTypeDetector = (
	file: File
) => MaybePromise<string | { mime?: string } | null | undefined>

let fileTypeDetectors: FileTypeDetector[] | undefined

/**
 * Register function(s) to detect the actual file type from file content,
 * used by `t.File({ type })` / `t.Files({ type })` to validate that
 * a file's content matches its reported mime type
 *
 * If an array is provided, detectors are tried in order until one
 * returns a mime type
 *
 * @example
 * ```ts
 * import { setFileTypeDetector } from 'elysia'
 * import { fileTypeFromBlob } from 'file-type'
 *
 * setFileTypeDetector(fileTypeFromBlob)
 * ```
 */
export function setFileTypeDetector(detector: MaybeArray<FileTypeDetector>) {
	fileTypeDetectors = Array.isArray(detector) ? detector : [detector]
}

async function detectFileType(file: File): Promise<string | undefined> {
	for (let i = 0; i < fileTypeDetectors!.length; i++) {
		const result = await fileTypeDetectors![i](file)
		const mime = typeof result === 'string' ? result : result?.mime

		if (mime) return mime
	}
}

let warnedNoFileTypeDetector = false
function warnNoFileTypeDetector() {
	if (warnedNoFileTypeDetector) return
	warnedNoFileTypeDetector = true

	console.warn(
		"[Elysia] Attempt to validate file type without a file type detector, only the file's reported mime type is checked which can be spoofed. This may lead to security risks. We recommend registering a detector with `setFileTypeDetector`, eg. `setFileTypeDetector(fileTypeFromBlob)` using the 'file-type' package."
	)
}

/**
 * Validate that a file matches the expected type(s)
 *
 * The file's reported mime type is checked first, then the actual content
 * is inspected using detectors registered via `setFileTypeDetector`
 *
 * When no detector is registered, only the reported mime type is checked
 * (and a warning is emitted once)
 *
 * @example
 * ```ts
 * z.file().refine((file) => fileType(file, 'image/jpeg'))
 * ```
 */
export async function fileType(
	file: MaybeArray<File | undefined>,
	type: MaybeArray<FileType>
): Promise<boolean> {
	if (Array.isArray(file)) {
		const results = await Promise.all(file.map((f) => fileType(f, type)))

		return results.every(Boolean)
	}

	if (!file) return false

	const types = typeof type === 'string' ? [type] : type

	let match = false
	for (let i = 0; i < types.length; i++)
		if (checkFileExtension(file.type, types[i])) {
			match = true
			break
		}

	if (!match) return false

	if (!fileTypeDetectors) {
		warnNoFileTypeDetector()
		return true
	}

	const mime = await detectFileType(file)
	if (mime)
		for (let i = 0; i < types.length; i++)
			if (checkFileExtension(mime, types[i])) return true

	return false
}

// File content detection is async while typebox's compiled Check is sync:
// a `t.File({ type })` refine cannot await detection inline
//
// Instead, while a validator is collecting (`collectFileTypeChecks`), the refine optimistically
// passes and enqueues a detection promise here. `TypeBoxValidator.FromAsync`
// takes the queue synchronously right after `Check` and awaits it
//
// The flag gate prevents stray enqueues (and leaks) from other Check sites that never
// drain, eg. response validation or typebox's internal Errors / Decode walks.
let collecting = false
let pendingFileTypeChecks: Promise<true | string>[] | undefined

export function collectFileTypeChecks() {
	collecting = true
}

export function takeFileTypeChecks() {
	collecting = false

	const pending = pendingFileTypeChecks
	pendingFileTypeChecks = undefined

	return pending
}

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

	// Clone `BaseFile` (preserving non-enumerable `~kind` / `~refine`)
	// before passing to `elyType` so the cached `BaseFile` stays mutable
	// for later `Refines()` calls. Without the clone, the first
	// `t.File()` call freezes BaseFile via `emptyFile`, and subsequent
	// `t.File({type})` calls fail when typebox `Update()` tries to
	// define properties on the now-frozen schema.
	if (!options || isEmpty(options))
		return (emptyFile ??= Object.freeze(
			elyType(ELYSIA_TYPES.File, cloneSchema(BaseFile))
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
		const types: FileType[] =
			typeof options.type === 'string' ? [options.type] : options.type

		const message =
			types.length === 1
				? `Expect file type to be ${types[0]}`
				: `Expect file type to be one of ${types.join(', ')}`

		refines.push([
			(value) => {
				let match = false
				for (let i = 0; i < types.length; i++)
					if (checkFileExtension(value.type, types[i])) {
						match = true
						break
					}

				if (!match) return false

				if (!collecting) return true

				if (!fileTypeDetectors) {
					warnNoFileTypeDetector()
					return true
				}

				;(pendingFileTypeChecks ??= []).push(
					detectFileType(value).then(
						(mime) => {
							if (mime)
								for (let i = 0; i < types.length; i++)
									if (checkFileExtension(mime, types[i]))
										return true as const

							return message
						},
						() => message
					)
				)

				return true
			},
			message
		])
	}

	return elyType(ELYSIA_TYPES.File, Refines(BaseFile, refines))
}
