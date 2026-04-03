import { ElysiaFile } from '../universal/file'
import { InvalidFileType } from '../error'
import type {
	ElysiaTypeCustomErrorCallback,
	FileOptions,
	FileUnit,
	FileType
} from './types'
import type { MaybeArray } from '../types'

export const parseFileUnit = (size: FileUnit) => {
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

/**
 * Utility function to inherit add custom error and keep the original Validation error
 *
 * @since 1.3.14
 *
 * @example
 * ```ts
 * import { Elysia, t, errorWithDetail } from 'elysia'
 *
 * new Elysia()
 *		.post('/', () => 'Hello World!', {
 *			body: t.Object({
 *				x: t.Number({
 *					error: validationDetail('x must be a number')
 *				})
 *			})
 *		})
 */
export const validationDetail =
	<T>(message: T) =>
	(error: Parameters<ElysiaTypeCustomErrorCallback>[0]) => ({
		...error,
		message
	})
