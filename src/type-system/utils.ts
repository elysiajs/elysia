import {
	Kind,
	TUnsafe,
	TypeRegistry,
	Unsafe,
	type TAnySchema
} from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { TypeCheck, TypeCompiler } from '@sinclair/typebox/compiler'

import { ElysiaFile } from '../universal/file'
import { InvalidFileType, ValidationError } from '../error'
import type {
	ElysiaTypeCustomErrorCallback,
	FileOptions,
	FileUnit
} from './types'
import type { MaybeArray } from '../types'

export const tryParse = (v: unknown, schema: TAnySchema) => {
	try {
		return JSON.parse(v as string)
	} catch {
		throw new ValidationError('property', schema, v)
	}
}

export function createType<TSchema = unknown, TReturn = unknown>(
	kind: string,
	func: TypeRegistry.TypeRegistryValidationFunction<TSchema>
): TUnsafe<TReturn> {
	if (!TypeRegistry.Has(kind)) TypeRegistry.Set<TSchema>(kind, func)

	return ((options = {}) => Unsafe({ ...options, [Kind]: kind })) as any
}

export const compile = <T extends TAnySchema>(schema: T) => {
	try {
		const compiler = TypeCompiler.Compile(schema) as TypeCheck<T> & {
			Create(): T['static']
			Error(v: unknown): asserts v is T['static']
		}

		compiler.Create = () => Value.Create(schema)
		compiler.Error = (v: unknown) =>
			new ValidationError('property', schema, v, compiler.Errors(v))

		return compiler
	} catch {
		return {
			Check: (v: unknown) => Value.Check(schema, v),
			CheckThrow: (v: unknown) => {
				if (!Value.Check(schema, v))
					throw new ValidationError(
						'property',
						schema,
						v,
						Value.Errors(schema, v)
					)
			},
			Decode: (v: unknown) => Value.Decode(schema, v),
			Create: () => Value.Create(schema),
			Error: (v: unknown) =>
				new ValidationError(
					'property',
					schema,
					v,
					Value.Errors(schema, v)
				)
		}
	}
}

export const parseFileUnit = (size: FileUnit) => {
	if (typeof size === 'string')
		switch (size.slice(-1)) {
			case 'k':
				return +size.slice(0, size.length - 1) * 1024

			case 'm':
				return +size.slice(0, size.length - 1) * 1048576

			default:
				return +size
		}

	return size
}

export const checkFileExtension = (type: string, extension: string) => {
	if (type.startsWith(extension)) return true

	return (
		extension.charCodeAt(extension.length - 1) === 42 &&
		extension.charCodeAt(extension.length - 2) === 47 &&
		type.startsWith(extension.slice(0, -1))
	)
}

let _fileTypeFromBlobWarn = false
const warnIfFileTypeIsNotInstalled = () => {
	if (!_fileTypeFromBlobWarn) {
		console.warn(
			"[Elysia] Attempt to validate file type without 'file-type'. This may lead to security risks. We recommend installing 'file-type' to properly validate file extension."
		)
		_fileTypeFromBlobWarn = true
	}
}

export const loadFileType = async () =>
	import('file-type')
		.then((x) => {
			_fileTypeFromBlob = x.fileTypeFromBlob
			return _fileTypeFromBlob
		})
		.catch(warnIfFileTypeIsNotInstalled)

let _fileTypeFromBlob: Function
export const fileTypeFromBlob = (file: Blob | File) => {
	if (_fileTypeFromBlob) return _fileTypeFromBlob(file)

	return loadFileType().then((mod) => {
		if (mod) return mod(file)
	})
}

export const validateFileExtension = async (
	file: MaybeArray<Blob | File | undefined>,
	extension: string | string[],
	// @ts-ignore
	name = file?.name ?? ''
): Promise<boolean> => {
	if (Array.isArray(file)) {
		await Promise.all(
			file.map((f) => validateFileExtension(f, extension, name))
		)

		return true
	}

	if (!file) return false

	const result = await fileTypeFromBlob(file)
	if (!result) throw new InvalidFileType(name, extension)

	if (typeof extension === 'string')
		if (!checkFileExtension(result.mime, extension))
			throw new InvalidFileType(name, extension)

	for (let i = 0; i < extension.length; i++)
		if (checkFileExtension(result.mime, extension[i])) return true

	throw new InvalidFileType(name, extension)
}

export const validateFile = (options: FileOptions, value: any) => {
	if (value instanceof ElysiaFile) return true

	if (!(value instanceof Blob)) return false

	if (options.minSize && value.size < parseFileUnit(options.minSize))
		return false

	if (options.maxSize && value.size > parseFileUnit(options.maxSize))
		return false

	// This only check file extension based on it's name / mimetype
	// to actual check the file type, use `validateFileExtension` instead
	if (options.extension) {
		if (typeof options.extension === 'string')
			return checkFileExtension(value.type, options.extension)

		for (let i = 0; i < options.extension.length; i++)
			if (checkFileExtension(value.type, options.extension[i]))
				return true

		return false
	}

	return true
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
