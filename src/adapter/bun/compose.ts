import {
	error,
	redirect,
	ELYSIA_TRACE,
	type InternalRoute,
	type AnyElysia
} from '../../index'

import { createHoc, createOnRequestHandler } from '../../compose'
import { sucrose, type Sucrose } from '../../sucrose'

import { randomId, ELYSIA_REQUEST_ID } from '../../utils'

const allocateIf = (value: string, condition: unknown) =>
	condition ? value : ''

const createContext = (
	app: AnyElysia,
	route: InternalRoute,
	inference: Sucrose.Inference,
	isInline = false
) => {
	let fnLiteral = ''

	// @ts-expect-error private
	const defaultHeaders = app.setHeaders

	const hasTrace = !!app.event.trace?.length
	if (hasTrace) fnLiteral += `const id=randomId()\n`

	const path = route.path

	const isDynamic = path.includes(':') || path.includes('*')

	const standardHostname = app.config.handler?.standardHostname ?? true

	const getQi =
		`const u=request.url,` +
		`s=u.indexOf('/',${standardHostname ? 11 : 7}),` +
		`qi=u.indexOf('?', s + 1)\n`

	if (inference.query) fnLiteral += getQi

	const getPath = !inference.path
		? ''
		: !isDynamic
			? `path:'${path}',`
			: `get path(){` +
				(inference.query ? '' : getQi) +
				`if(qi===-1) return u.substring(s)\n` +
				`return u.substring(s, qi)\n` +
				`},`

	fnLiteral +=
		allocateIf(`const c=`, !isInline) +
		`{request,` +
		`store,` +
		allocateIf(`qi,`, inference.query) +
		allocateIf(`route,`, inference.route || hasTrace) +
		`params:request.params,` +
		getPath +
		`url:request.url,` +
		`redirect,` +
		`error,` +
		`set:{headers:`

	fnLiteral += Object.keys(defaultHeaders ?? {}).length
		? 'Object.assign({},app.setHeaders)'
		: '{}'

	fnLiteral += `,status:200}`

	if (inference.server) fnLiteral += `,get server(){return app.getServer()}`

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
	const hasTrace = !!app.event.trace?.length
	// @ts-expect-error private property
	const hasHoc = !!app.extender.higherOrderFunctions.length

	const inference = sucrose(
		Object.assign({}, route.hooks, {
			handler: route.handler
		}),
		// @ts-expect-error
		app.inference
	)

	let fnLiteral =
		'const handler=data.handler,' +
		'store=data.store,' +
		'redirect=data.redirect,' +
		allocateIf('route=data.route,', inference.route || hasTrace) +
		allocateIf('randomId=data.randomId,', hasTrace) +
		allocateIf(`ELYSIA_REQUEST_ID=data.ELYSIA_REQUEST_ID,`, hasTrace) +
		allocateIf(`ELYSIA_TRACE=data.ELYSIA_TRACE,`, hasTrace) +
		allocateIf(`trace=data.trace,`, hasTrace) +
		allocateIf(`hoc=data.hoc,`, hasHoc) +
		'error=data.error\n' +
		'function map(request){'

	// inference.query require declaring const 'qi'
	if (hasTrace || inference.query || app.event.request?.length) {
		fnLiteral += createContext(app, route, inference)
		fnLiteral += createOnRequestHandler(app)

		fnLiteral += 'return handler(c)}'
	} else {
		fnLiteral += `return handler(${createContext(app, route, inference, true)})}`
	}

	fnLiteral += createHoc(app)

	return Function(
		'data',
		fnLiteral
	)({
		handler: route.compile?.() ?? route.composed,
		redirect,
		error,
		// @ts-expect-error private property
		hoc: app.extender.higherOrderFunctions.map((x) => x.fn),
		store: app.store,
		route: inference.route || hasTrace ? route.path : undefined,
		randomId: hasTrace ? randomId : undefined,
		ELYSIA_TRACE: hasTrace ? ELYSIA_TRACE : undefined,
		ELYSIA_REQUEST_ID: hasTrace ? ELYSIA_REQUEST_ID : undefined,
		trace: hasTrace ? app.event.trace?.map((x) => x?.fn ?? x) : undefined
	})
}
