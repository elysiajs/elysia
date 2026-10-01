import { Elysia, TypeSystem } from '../../../src'

export const app = new Elysia().get(
	'/',
	() => Object.keys(TypeSystem.Locale).length
)

if (!process.env.ELYSIA_AOT_BUILD)
	console.log(await (await app.handle('http://localhost')).text())
