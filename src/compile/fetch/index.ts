import { Memoirist } from 'memoirist'

import { decodeComponent } from 'deuri'
import { isDynamicRegex, needEncodeRegex } from '../../constants'
import { compileHandler } from '../handler'
import { getLoosePath, mapMethodBack, nullObject } from '../../utils'
import { createContext, type Context } from '../../context'

import type { AnyElysia } from '../../base'
import type { CompiledHandler, InternalRoute } from '../../types'

function buildRoute(
	app: AnyElysia,
	routes: InternalRoute[],
	router: Memoirist<any>,
	compiled: CompiledHandler[]
) {
	const strictPath = app['~config']?.strictPath

	const map = nullObject() as Record<string, string>

	for (let i = 0; i < routes.length; i++) {
		const [_method, path] = routes[i]
		const method = mapMethodBack(_method) ?? _method

		if (isDynamicRegex.test(path))
			router.add(
				method,
				path,
				(context: Context) =>
					compiled[i]?.(context) ??
					(compiled[i] = compileHandler(routes[i], app))(context)
			)
		else {
			const tmp =
				`case '${path}':\n` +
				(strictPath ? '' : `case '${getLoosePath(path)}':\n`) +
				(needEncodeRegex.test(path)
					? `case '${encodeURI(path)}':\n` +
						(strictPath ? '' : `case '${getLoosePath(path)}':\n`)
					: '') +
				`return cmp[${i}]?.(c)??` +
				`(cmp[${i}]=cmph(rou[${i}],app))(c)\n`

			if (map[method]) map[method] += tmp
			else map[method] = tmp
		}
	}

	let code = 'map:switch(r.method){\n'
	for (const method in map)
		code += `case '${method}':\nswitch(p){\n${map[method]}default: break map\n}\n`
	code += '}\n'

	return code
}

function decodeParams(params: Record<string, string>) {
	for (const key in params) {
		const value = params[key]
		if (value.indexOf('%') !== -1)
			params[key] = decodeComponent(value) ?? value
	}

	return params
}

export function compileFetch(app: AnyElysia, routes: InternalRoute[]) {
	const compiled: CompiledHandler[] = new Array(routes.length)
	const router = new Memoirist({ loosePath: true })

	let code =
		'const c=new Context(r),' +
		'u=r.url,' +
		`s=u.indexOf('/',${app['~config']?.handler?.standardHostname === false ? 7 : 11}),` +
		'p=(' +
		/**/ 'c.path=u.substring(' +
		/*  */ 's,' +
		/*  */ "(c.qi=u.indexOf('?',s))===-1" +
		/*    */ '?u.length' +
		/*    */ ':c.qi' +
		/**/ ')' +
		')\n'

	code +=
		buildRoute(app, routes, router, compiled) +
		"const dynr=dyn?.find(r.method,p)??dyn?.find('*',p)\n" +
		'if(dynr){' +
		/**/ 'c.params=dcp(dynr.params)\n' +
		/**/ 'return dynr.store(c)\n' +
		'}\n' +
		'return new Response(null,{status:404})\n'

	// eslint-disable-next-line sonarjs/code-eval
	const createFetch = Function(
		'app',
		'Context',
		'rou',
		'cmph',
		'cmp',
		'dyn',
		'dcp',
		`return (r)=>{${code}}`
	) as (
		app: AnyElysia,
		Context: ReturnType<typeof createContext>,
		rou: InternalRoute[],
		cmph: typeof compileHandler,
		cmp: CompiledHandler[],
		dyn: Memoirist<any>,
		dcp: typeof decodeParams
	) => (request: Request) => MaybePromise<Response>

	return createFetch(
		app,
		createContext(app),
		routes,
		compileHandler,
		compiled,
		router,
		decodeParams
	)
}
