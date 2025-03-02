import { error, InternalRoute, redirect, type AnyElysia } from '../..'
import { createHoc, createOnRequestHandler } from '../../compose'
import { sucrose } from '../../sucrose'

const allocateIf = (value: string, condition: unknown) =>
	condition ? value : ''

const createContext = (app: AnyElysia, route: InternalRoute) => {
	let fnLiteral = ''

	// @ts-expect-error private
	const defaultHeaders = app.setHeaders

	const hasTrace = !!app.event.trace?.length
	if (hasTrace) fnLiteral += `const id=randomId()\n`

	const path = route.path

	const isDynamic = path.includes(':') || path.includes('*')

	const standardHostname = app.config.handler?.standardHostname ?? true

	const inference = sucrose(
		Object.assign({}, route.hooks, {
			handler: route.handler
		}),
		// @ts-expect-error
		app.inference
	)

	const getQi =
		`const u=request.url,` +
		`s=u.indexOf('/',${standardHostname ? 11 : 7}),` +
		`qi=u.indexOf('?', s + 1)\n`

	if (inference.query) fnLiteral += getQi

	const getPath = !isDynamic
		? `path:'${path}',`
		: `get path(){` +
			(inference.query ? '' : getQi) +
			`if(qi===-1) return u.substring(s)\n` +
			`return u.substring(s, qi)\n` +
			`},`

	fnLiteral +=
		`const c={request,` +
		`store,` +
		allocateIf(`qi,`, inference.query) +
		allocateIf(`route`, inference.route || hasTrace) +
		getPath +
		`url:request.url,` +
		`redirect,` +
		`error,` +
		`set:{headers:`

	fnLiteral += Object.keys(defaultHeaders ?? {}).length
		? 'Object.assign({},app.setHeaders)'
		: '{}'

	fnLiteral += `,status:200}`

	// @ts-expect-error private
	if (app.inference.server)
		fnLiteral += `,get server(){return app.getServer()}`

	if (hasTrace) fnLiteral += ',[ELYSIA_REQUEST_ID]:id'

	{
		let decoratorsLiteral = ''
		// @ts-expect-error private
		for (const key of Object.keys(app.singleton.decorator))
			decoratorsLiteral += `,${key}:decorator['${key}']`

		fnLiteral += decoratorsLiteral
	}

	fnLiteral += `}\n`

	return fnLiteral
}

export const createBunRouteHandler = (app: AnyElysia, route: InternalRoute) => {
	let fnLiteral =
		'const handler=data.handler,' +
		'store=data.store,' +
		'redirect=data.redirect,' +
		'error=data.error\n' +
		'function map(request){'

	fnLiteral += createContext(app, route)
	fnLiteral += createOnRequestHandler(app)

	fnLiteral += 'return handler(c)}\n'

	fnLiteral += createHoc(app)

	return Function(
		'data',
		fnLiteral
	)({
		handler: route.compile?.() ?? route.composed,
		redirect,
		error,
		store: app.store
	})
}
