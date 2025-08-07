import {
	mapResponse,
	mapEarlyResponse,
	mapCompactResponse,
	createStaticHandler
} from './handler'

import type { ElysiaAdapter } from '../types'

export const WebStandardAdapter: ElysiaAdapter = {
	name: 'web-standard',
	isWebStandard: true,
	handler: {
		mapResponse,
		mapEarlyResponse,
		mapCompactResponse,
		createStaticHandler
	},
	composeHandler: {
		mapResponseContext: 'c.request',
		preferWebstandardHeaders: true,
		// @ts-ignore Bun specific
		headers:
			'c.headers={}\n' +
			'for(const [k,v] of c.request.headers.entries())' +
			'c.headers[k]=v\n',
		parser: {
			json(isOptional) {
				if (isOptional)
					return `try{c.body=await c.request.json()}catch{}\n`
				return `c.body=await c.request.json()\n`
			},
			text() {
				return `c.body=await c.request.text()\n`
			},
			urlencoded() {
				return `c.body=parseQuery(await c.request.text())\n`
			},
			arrayBuffer() {
				return `c.body=await c.request.arrayBuffer()\n`
			},
			formData(isOptional) {
				let fnLiteral = '\nc.body={}\n'

				if (isOptional)
					fnLiteral += `let form;try{form=await c.request.formData()}catch{}`
				else fnLiteral += `const form=await c.request.formData()\n`

				return (
					fnLiteral +
					`for(const key of form.keys()){` +
					`if(c.body[key]) continue\n` +
					`const value=form.getAll(key)\n` +
					`if(value.length===1)` +
					`c.body[key]=value[0]\n` +
					`else c.body[key]=value` +
					`}`
				)
			}
		}
	},
	async stop(app, closeActiveConnections) {
		if (!app.server)
			throw new Error(
				"Elysia isn't running. Call `app.listen` to start the server."
			)

		if (app.server) {
			app.server.stop(closeActiveConnections)
			app.server = null

			if (app.event.stop?.length)
				for (let i = 0; i < app.event.stop.length; i++)
					app.event.stop[i].fn(app)
		}
	},
	composeGeneralHandler: {
		parameters: 'r',
		createContext(app) {
			let decoratorsLiteral = ''
			let fnLiteral = ''

			// @ts-expect-error private
			const defaultHeaders = app.setHeaders

			for (const key of Object.keys(app.decorator))
				decoratorsLiteral += `,'${key}':decorator['${key}']`

			const standardHostname =
				app.config.handler?.standardHostname ?? true
			const hasTrace = !!app.event.trace?.length

			fnLiteral +=
				`const u=r.url,` +
				`s=u.indexOf('/',${standardHostname ? 11 : 7}),` +
				`qi=u.indexOf('?',s+1)\n` +
				`let p\n` +
				`if(qi===-1)p=u.substring(s)\n` +
				`else p=u.substring(s, qi)\n`

			if (hasTrace) fnLiteral += `const id=randomId()\n`

			fnLiteral +=
				`const c={request:r,` +
				`store,` +
				`qi,` +
				`path:p,` +
				`url:u,` +
				`redirect,` +
				`error:status,` +
				`status,` +
				`set:{headers:`

			fnLiteral += Object.keys(defaultHeaders ?? {}).length
				? 'Object.assign({},app.setHeaders)'
				: 'Object.create(null)'

			fnLiteral += `,status:200}`

			// @ts-expect-error private
			if (app.inference.server)
				fnLiteral += `,get server(){return app.getServer()}`
			if (hasTrace) fnLiteral += ',[ELYSIA_REQUEST_ID]:id'
			fnLiteral += decoratorsLiteral
			fnLiteral += `}\n`

			return fnLiteral
		},
		error404(hasEventHook, hasErrorHook, afterHandle = '') {
			let findDynamicRoute =
				`if(route===null){` +
				afterHandle +
				'\nreturn '

			if (hasErrorHook)
				findDynamicRoute += `app.handleError(c,notFound,false,${this.parameters})`
			else
				findDynamicRoute += hasEventHook
					? `new Response(error404Message,{` +
						`status:c.set.status===200?404:c.set.status,` +
						`headers:c.set.headers` +
						`})`
					: `error404.clone()`

			findDynamicRoute += '}'

			return {
				declare: hasErrorHook
					? ''
					: `const error404Message=notFound.message.toString()\n` +
						`const error404=new Response(error404Message,{status:404})\n`,
				code: findDynamicRoute
			}
		}
	},
	composeError: {
		mapResponseContext: '',
		validationError:
			`return new Response(` +
			`error.message,` +
			`{` +
			`headers:Object.assign(` +
			`{'content-type':'application/json'},` +
			`set.headers` +
			`),` +
			`status:set.status` +
			`}` +
			`)`,
		unknownError:
			`return new Response(` +
			`error.message,` +
			`{headers:set.headers,status:error.status??set.status??500}` +
			`)`
	},
	listen() {
		return () => {
			throw new Error(
				'WebStandard does not support listen, you might want to export default Elysia.fetch instead'
			)
		}
	}
}
