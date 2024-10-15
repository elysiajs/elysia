import type { Serve } from 'bun'

import { isProduction } from '../../error'
import { getLoosePath, isNumericString } from '../../utils'
import { websocket } from '../../ws'

import type { ElysiaAdapter } from '../types'

export const WebStandardAdapter: ElysiaAdapter = {
	composeHandler: {
		abortSignal: 'c.request.signal',
		preferWebstandardHeaders: true,
		// @ts-ignore Bun specific
		headers:
			'c.headers = {}\n' +
			'for (const [key, value] of c.request.headers.entries())' +
			'c.headers[key] = value\n',
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
	composeGeneralHandler: {
		createContext(app) {
			let decoratorsLiteral = ''
			let fnLiteral = ''

			// @ts-expect-error private
			const defaultHeaders = app.setHeaders

			// @ts-ignore
			for (const key of Object.keys(app.singleton.decorator))
				decoratorsLiteral += `,${key}: app.singleton.decorator.${key}`

			const standardHostname =
				app.config.handler?.standardHostname ?? true
			const hasTrace = app.event.trace.length > 0

			fnLiteral +=
				`const u=r.url,` +
				`s=u.indexOf('/',${standardHostname ? 11 : 7}),` +
				`qi=u.indexOf('?', s + 1)\n` +
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
				`error,` +
				`set:{headers:`

			fnLiteral += Object.keys(defaultHeaders ?? {}).length
				? 'Object.assign({}, app.setHeaders)'
				: '{}'

			fnLiteral += `,status:200}`

			// @ts-expect-error private
			if (app.inference.server)
				fnLiteral += `,get server(){return getServer()}`
			if (hasTrace) fnLiteral += ',[ELYSIA_REQUEST_ID]:id'
			fnLiteral += decoratorsLiteral
			fnLiteral += `}\n`

			return fnLiteral
		},
		websocket(app) {
			let fnLiteral = ''

			const wsPaths = app.router.static.ws
			const wsRouter = app.router.ws

			if (Object.keys(wsPaths).length || wsRouter.history.length) {
				fnLiteral += `if(r.method==='GET'){switch(p){`

				for (const [path, index] of Object.entries(wsPaths)) {
					fnLiteral +=
						`case'${path}':` +
						(app.config.strictPath !== true
							? `case'${getLoosePath(path)}':`
							: '') +
						`if(r.headers.get('upgrade')==='websocket')` +
						`return ht[${index}].composed(c)\n`
				}

				fnLiteral +=
					`default:` +
					`if(r.headers.get('upgrade')==='websocket'){` +
					`const route=wsRouter.find('ws',p)\n` +
					`if(route){` +
					`c.params=route.params\n` +
					`if(route.store.handler)return route.store.handler(c)\n` +
					`return (route.store.handler=route.store.compile())(c)` +
					`}` +
					`}` +
					`break` +
					`}` +
					`}`
			}

			return fnLiteral
		}
	},
	listen() {
		return () => {
			throw new Error(
				'WebStandard does not support listen, you might want to export default Elysia.fetch instead'
			)
		}
	}
}
