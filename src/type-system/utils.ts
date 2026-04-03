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
