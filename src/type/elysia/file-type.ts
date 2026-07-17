import type { FileType, FileUnit } from '../types'
import type { MaybeArray, MaybePromise } from '../../types'
import { isAsyncFunction } from '../../compile/utils'

export type FileTypeDetector = (
	file: File
) => MaybePromise<string | { mime?: string } | null | undefined>

let fileTypeDetectors: FileTypeDetector[] | undefined

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

	if (!matchesAnyFileType(file.type, types)) return false

	if (!fileTypeDetectors) return false

	const mime = await detectFileType(file)
	if (mime && matchesAnyFileType(mime, types)) return true

	return false
}

let collecting = false
let pendingFileTypeChecks: PendingFileTypeCheck[] | undefined

export interface PendingFileTypeCheck {
	check: Promise<true | string>
	/** kept so a failed detection can be located in the validated value
	 *  (identity walk on failure only) for a path-aware error */
	file: File
}

export const ASYNC_REFINE = '~elyAsyncRefine'

export const isAsyncPredicate = (v: unknown) =>
	Array.isArray(v)
		? v.some((x: any) =>
				typeof x.check === 'function'
					? isAsyncFunction(x.check) || x.check[ASYNC_REFINE] === true
					: false
			)
		: false

export function collectFileTypeChecks() {
	collecting = true
}

export function takeFileTypeChecks() {
	collecting = false

	const pending = pendingFileTypeChecks
	pendingFileTypeChecks = undefined

	return pending
}

export function maybeQueueFileTypeCheck(
	value: File,
	types: FileType[],
	message: string
) {
	if (!collecting) return

	if (!fileTypeDetectors) {
		;(pendingFileTypeChecks ??= []).push({
			file: value,
			check: Promise.resolve(message)
		})

		return
	}

	;(pendingFileTypeChecks ??= []).push({
		file: value,
		check: detectFileType(value).then(
			(mime) =>
				mime && matchesAnyFileType(mime, types)
					? (true as const)
					: message,
			() => message
		)
	})
}

// does `mime` match any of the accepted file types?
export function matchesAnyFileType(mime: string, types: FileType[]): boolean {
	for (let i = 0; i < types.length; i++)
		if (checkFileExtension(mime, types[i])) return true

	return false
}

export function checkFileExtension(type: string, extension: string) {
	const slashIdx = extension.indexOf('/')
	if (slashIdx === -1) return type.startsWith(extension + '/')

	if (
		extension.charCodeAt(extension.length - 1) === 42 /* '*' */ &&
		extension.charCodeAt(extension.length - 2) === 47 /* '/' */
	) {
		return type.startsWith(extension.slice(0, -1))
	}

	// Exact MIME match (e.g. "image/png" must NOT match "image/png-malicious")
	return type === extension
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
