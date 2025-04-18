import {
	Kind,
	TUnsafe,
	TypeRegistry,
	Unsafe,
	type TAnySchema
} from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { TypeCheck, TypeCompiler } from '@sinclair/typebox/compiler'

import { InvalidFileType, ValidationError } from '../error'
import type { FileOptions, FileUnit } from './types'
import { ElysiaFile } from '../universal/file'
import { fileTypeFromBlob } from 'file-type'

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

export const validateFileExtension = async (
	file: Blob | File | undefined,
	extension: string | string[],
	// @ts-ignore
	name = file?.name ?? ''
) => {
	if (!file) return

	const result = await fileTypeFromBlob(file)
	if (!result) throw new InvalidFileType(name)

	if (typeof extension === 'string')
		if (!checkFileExtension(result.mime, extension))
			throw new InvalidFileType(name)

	for (let i = 0; i < extension.length; i++)
		if (checkFileExtension(result.mime, extension[i])) return true

	throw new InvalidFileType(name)
}

export const validateFile = (options: FileOptions, value: any) => {
	if (value instanceof ElysiaFile) return true

	if (!(value instanceof Blob)) return false

	if (options.minSize && value.size < parseFileUnit(options.minSize))
		return false

	if (options.maxSize && value.size > parseFileUnit(options.maxSize))
		return false

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
