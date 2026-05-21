import { Elysia, t } from '../src'
const t1 = performance.now()

class CustomError extends Error {
	constructor() {
		super()
	}
}

const app = new Elysia().error(CustomError, () => {})

const getErrors = (app: Elysia<any, any, any, any, any>) => app['~ext']?.error

console.log(getErrors(app))
