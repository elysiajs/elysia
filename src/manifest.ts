// import { stat, mkdir, writeFile } from 'fs/promises'
// import type { AnyElysia } from '.'
// import { checksum } from './utils'

// const mkdirIfNotExists = async (path: string) => {
// 	if (
// 		await stat(path)
// 			.then(() => false)
// 			.catch(() => true)
// 	)
// 		await mkdir(path)
// }

// export const manifest = async (app: AnyElysia) => {
// 	await app.modules

// 	app.compile()

// 	console.log(process.cwd())

// 	await mkdirIfNotExists('.elysia')
// 	await mkdirIfNotExists('.elysia/routes')

// 	const ops = <Promise<void>[]>[]

// 	let appChecksum = 0

// 	for (const route of app.routes) {
// 		const { path, method } = route

// 		const code = route.compile().toString()
// 		const name = `.elysia/routes/${path === '' ? 'index' : path.endsWith('/') ? path.replace(/\//g, '_') + 'index' : path.replace(/\//g, '_')}.${method.toLowerCase()}.js`

// 		appChecksum = checksum(appChecksum + path + method + code)

// 		ops.push(writeFile(name, '//' + checksum(code) + '\n' + code))
// 	}

// 	const code = app.fetch.toString()
// 	appChecksum = checksum(appChecksum + code)

// 	ops.push(writeFile(`.elysia/handler.js`, '//' + appChecksum + '\n' + code))

// 	await Promise.all(ops)

// 	console.log('DONE')
// }
