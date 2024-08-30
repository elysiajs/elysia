import { Elysia, t } from '../src'
import { TypeCompiler, SetErrorFunction } from '@sinclair/typebox/errors'

SetErrorFunction((error) => {
	error.
})

const a = TypeCompiler.Compile(t.String())

console.log(a)
