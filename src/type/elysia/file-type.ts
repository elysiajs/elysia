import type { FileType, FileUnit } from '../types'
import type { MaybeArray, MaybePromise } from '../../types'

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

let warnedNoFileTypeDetector = false
function warnNoFileTypeDetector() {
	if (warnedNoFileTypeDetector) return
	warnedNoFileTypeDetector = true

	console.warn(
		"[Elysia] Attempt to validate file type without a file type detector, only the file's reported mime type is checked which can be spoofed. This may lead to security risks. We recommend registering a detector with `setFileTypeDetector`, eg. `setFileTypeDetector(fileTypeFromBlob)` using the 'file-type' package."
	)
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

	if (!fileTypeDetectors) {
		warnNoFileTypeDetector()
		return true
	}

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
		warnNoFileTypeDetector()
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
