import { mapEarlyResponse } from './handler'
import { sucrose, type Sucrose } from '../../sucrose'
import { createHoc, createOnRequestHandler, isAsync } from '../../compose'

import { randomId, ELYSIA_REQUEST_ID, redirect, isNotEmpty } from '../../utils'
import { status } from '../../error'
import { ELYSIA_TRACE } from '../../trace'

import type { AnyElysia } from '../..'
import type { InternalRoute } from '../../types'

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

	const isDynamic = /[:*]/.test(route.path)

	const standardHostname = app.config.handler?.standardHostname ?? true

	const getQi =
		`const u=request.url,` +
		`s=u.indexOf('/',${standardHostname ? 11 : 7}),` +
		`qi=u.indexOf('?', s + 1)\n`

	const needsQuery =
		inference.query ||
		!!route.hooks.query ||
		!!route.standaloneValidators?.find((x) => x.query) ||
		app.event.request?.length

	if (needsQuery) fnLiteral += getQi

	const getPath = !inference.path
		? ''
		: !isDynamic
			? `path:'${route.path}',`
			: `get path(){` +
				(needsQuery ? '' : getQi) +
				`if(qi===-1)return u.substring(s)\n` +
				`return u.substring(s,qi)\n` +
				`},`

	fnLiteral +=
		allocateIf(`const c=`, !isInline) +
		`{request,` +
		`store,` +
		allocateIf(`qi,`, needsQuery) +
		allocateIf(`params:request.params,`, isDynamic) +
		getPath +
		allocateIf(
			`url:request.url,`,
			hasTrace || inference.url || needsQuery
		) +
		`redirect,` +
		`error:status,` +
		`status,` +
		`set:{headers:` +
		(isNotEmpty(defaultHeaders)
			? 'Object.assign({},app.setHeaders)'
			: 'Object.create(null)') +
		`,status:200}`

	if (inference.server) fnLiteral += `,get server(){return app.getServer()}`

	if (hasTrace) fnLiteral += ',[ELYSIA_REQUEST_ID]:id'

	{
		let decoratorsLiteral = ''
		// @ts-expect-error private
		for (const key of Object.keys(app.singleton.decorator))
			decoratorsLiteral += `,'${key}':decorator['${key}']`

		fnLiteral += decoratorsLiteral
	}

	fnLiteral += `}\n`

	return fnLiteral
}

export const createBunRouteHandler = (app: AnyElysia, route: InternalRoute) => {
	const hasTrace = !!app.event.trace?.length
	// @ts-expect-error private property
	const hasHoc = !!app.extender.higherOrderFunctions.length

	let inference = sucrose(
		route.hooks,
		// @ts-expect-error
		app.inference
	)
	inference = sucrose(
		{
			handler: route.handler
		},
		inference
	)

	let fnLiteral =
		'const handler=data.handler,' +
		`app=data.app,` +
		'store=data.store,' +
		`decorator=data.decorator,` +
		'redirect=data.redirect,' +
		'route=data.route,' +
		'mapEarlyResponse=data.mapEarlyResponse,' +
		allocateIf('randomId=data.randomId,', hasTrace) +
		allocateIf(`ELYSIA_REQUEST_ID=data.ELYSIA_REQUEST_ID,`, hasTrace) +
		allocateIf(`ELYSIA_TRACE=data.ELYSIA_TRACE,`, hasTrace) +
		allocateIf(`trace=data.trace,`, hasTrace) +
		allocateIf(`hoc=data.hoc,`, hasHoc) +
		'status=data.status\n'

	if (app.event.request?.length)
		fnLiteral += `const onRequest=app.event.request.map(x=>x.fn)\n`

	fnLiteral += `${app.event.request?.find(isAsync) ? 'async' : ''} function map(request){`

	const needsQuery =
		inference.query ||
		!!route.hooks.query ||
		!!route.standaloneValidators?.find((x) => x.query)

	// inference.query require declaring const 'qi'
	if (hasTrace || needsQuery || app.event.request?.length) {
		fnLiteral += createContext(app, route, inference)
		fnLiteral += createOnRequestHandler(app)

		fnLiteral += 'return handler(c)}'
	} else
		fnLiteral += `return handler(${createContext(app, route, inference, true)})}`

	fnLiteral += createHoc(app)

	return Function(
		'data',
		fnLiteral
	)({
		app,
		handler: route.compile?.() ?? route.composed,
		redirect,
		status,
		// @ts-expect-error private property
		hoc: app.extender.higherOrderFunctions.map((x) => x.fn),
		store: app.store,
		decorator: app.decorator,
		route: route.path,
		randomId: hasTrace ? randomId : undefined,
		ELYSIA_TRACE: hasTrace ? ELYSIA_TRACE : undefined,
		ELYSIA_REQUEST_ID: hasTrace ? ELYSIA_REQUEST_ID : undefined,
		trace: hasTrace ? app.event.trace?.map((x) => x?.fn ?? x) : undefined,
		mapEarlyResponse: mapEarlyResponse
	})
}
