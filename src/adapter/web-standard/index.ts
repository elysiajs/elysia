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
					`const dangerousKeys=new Set(['__proto__','constructor','prototype'])\n` +
					`const isDangerousKey=(k)=>{` +
					`if(dangerousKeys.has(k))return true;` +
					`const m=k.match(/^(.+)\\[(\\d+)\\]$/);` +
					`return m?dangerousKeys.has(m[1]):false` +
					`}\n` +
					`const parseArrayKey=(k)=>{` +
					`const m=k.match(/^(.+)\\[(\\d+)\\]$/);` +
					`return m?{name:m[1],index:parseInt(m[2],10)}:null` +
					`}\n` +
					`for(const key of form.keys()){` +
					`if(c.body[key])continue\n` +
					`const value=form.getAll(key)\n` +
					`let finalValue\n` +
    				`if(value.length===1){\n` +
    				`const sv=value[0]\n` +
    				`if(typeof sv==='string'&&sv.charCodeAt(0)===123){\n` +
    				`try{\n` +
    				`const p=JSON.parse(sv)\n` +
    				`if(p&&typeof p==='object'&&!Array.isArray(p))finalValue=p\n` +
    				`}catch{}\n` +
    				`}\n` +
    				`if(finalValue===undefined)finalValue=sv\n` +
    				`}else finalValue=value\n` +
					`if(Array.isArray(finalValue)){\n` +
					`const stringValue=finalValue.find((entry)=>typeof entry==='string')\n` +
					`const files=typeof File==='undefined'?[]:finalValue.filter((entry)=>entry instanceof File)\n` +
					`if(stringValue&&files.length&&stringValue.charCodeAt(0)===123){\n` +
					`try{\n` +
					`const parsed=JSON.parse(stringValue)\n` +
					`if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){\n` +
					`if(!('file' in parsed)&&files.length===1)parsed.file=files[0]\n` +
					`else if(!('files' in parsed)&&files.length>1)parsed.files=files\n` +
					`finalValue=parsed\n` +
					`}\n` +
					`}catch{}\n` +
					`}\n` +
					`}\n` +
					`if(key.includes('.')||key.includes('[')){` +
					`const keys=key.split('.')\n` +
					`const lastKey=keys.pop()\n` +
					`if(isDangerousKey(lastKey)||keys.some(isDangerousKey))continue\n` +
					`let current=c.body\n` +
					`for(const k of keys){` +
					`const arrayInfo=parseArrayKey(k)\n` +
					`if(arrayInfo){` +
					`if(!Array.isArray(current[arrayInfo.name]))current[arrayInfo.name]=[]\n` +
					`const existing=current[arrayInfo.name][arrayInfo.index]\n` +
					`const isFile=typeof File!=='undefined'&&existing instanceof File\n` +
					`if(!existing||typeof existing!=='object'||Array.isArray(existing)||isFile){\n` +
					`let parsed\n` +
					`if(typeof existing==='string'&&existing.charCodeAt(0)===123){\n` +
					`try{` +
					`parsed=JSON.parse(existing)\n` +
					`if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))parsed=undefined` +
					`}catch{}\n` +
					`}\n` +
					`current[arrayInfo.name][arrayInfo.index]=parsed||{}\n` +
					`}\n` +
					`current=current[arrayInfo.name][arrayInfo.index]` +
					`}else{` +
					`if(!current[k]||typeof current[k]!=='object')current[k]={}\n` +
					`current=current[k]` +
					`}` +
					`}\n` +
					`const arrayInfo=parseArrayKey(lastKey)\n` +
					`if(arrayInfo){` +
					`if(!Array.isArray(current[arrayInfo.name]))current[arrayInfo.name]=[]\n` +
					`current[arrayInfo.name][arrayInfo.index]=finalValue` +
					`}else{` +
					`current[lastKey]=finalValue` +
					`}` +
					`}else c.body[key]=finalValue` +
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
			await app.server.stop(closeActiveConnections)
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
				`qi=u.indexOf('?',s+1),` +
				`p=u.substring(s,qi===-1?undefined:qi)\n`

			if (hasTrace) fnLiteral += `const id=randomId()\n`

			fnLiteral +=
				`const c={request:r,` +
				`store,` +
				`qi,` +
				`path:p,` +
				`url:u,` +
				`redirect,` +
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
				(hasErrorHook ? '' : 'c.set.status=404') +
				'\nreturn '

			if (hasErrorHook)
				findDynamicRoute += `app.handleError(c,notFound,false,${this.parameters})`
			else
				findDynamicRoute += hasEventHook
					? `c.response=c.responseValue=new Response(error404Message,{` +
						`status:c.set.status===200?404:c.set.status,` +
						`headers:c.set.headers` +
						`})`
					: `c.response=c.responseValue=error404.clone()`

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
			`set.headers['content-type']='application/json';` +
			`return mapResponse(error.message,set)`,
		unknownError:
			`set.status=error.status??set.status??500;` +
			`return mapResponse(error.message,set)`
	},
	listen() {
		return () => {
			throw new Error(
				'WebStandard does not support listen, you might want to export default Elysia.fetch instead'
			)
		}
	}
}
