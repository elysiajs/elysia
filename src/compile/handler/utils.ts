import { isAsyncFunction } from '../utils'
import { ElysiaStatus } from '../../error'

import type { ElysiaAdapter } from '../../adapter'
import type { AnyElysia } from '../../base'
import type { AppEvent, AppHook, MaybeArray } from '../../types'
import type { Link } from '../types'
import { ELYSIA_TYPES, primitiveElysiaTypes } from '../../type/constants'

export interface TraceReporter {
	resolveChild(name: string): {
		begin: string
		end: (errBinding?: string) => string
	}
}

const childName = (fn: unknown): string =>
	(fn as any)?.name && typeof (fn as any).name === 'string'
		? (fn as any).name
		: 'anonymous'

const noTrace = { begin: '', end: () => '' } as const

const trace = (report: TraceReporter | undefined, fn: Function) =>
	report?.resolveChild(childName(fn)) ?? noTrace

const toArray = <T>(v: MaybeArray<T>): T[] => (Array.isArray(v) ? v : [v])

export const mapTransform = map<'transform', [report?: TraceReporter]>(
	(i, fn, [report]) => {
		const t = trace(report, fn)
		return t.begin + `${Await(fn)}tf${at(i)}(c)\n` + t.end()
	}
)

// `beforeHandle` / `afterHandle` / `mapResponse` all share a
// short-circuit shape: each successive hook runs ONLY if the previous
// one didn't set the gating var (`_r === undefined` or
// `tmp === undefined`). That cross-iteration state (depth tracking,
// closing brace count) doesn't fit the per-hook `map` HOF, so these
// stay as manual loops with `toArray` + `trace` for consistency.
export function mapBeforeHandle(
	_hooks: AppHook['beforeHandle'] | AppHook['beforeHandle'][0],
	derive: AnyElysia['~derive'],
	link: Link,
	report?: TraceReporter
) {
	const hooks = toArray(_hooks)

	let code = ''
	let depth = 0
	let needsEs = false

	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]
		if (i > 0) {
			code += `if(_r===undefined){\n`
			depth++
		}

		const t = trace(report, fn)
		code += t.begin
		code += `tmp=${Await(fn)}bf${at(i)}(c)\n`
		if (derive?.has(fn)) {
			needsEs = true
			code +=
				'if(tmp instanceof es)_r=tmp\n' +
				'else if(tmp){Object.assign(c,tmp);tmp=undefined}\n'
		} else code += 'if(tmp!==undefined)_r=tmp\n'
		code += t.end('tmp')
	}

	code += '}'.repeat(depth)
	if (needsEs) link(ElysiaStatus, 'es')

	return code
}

export function mapAfterHandle(
	_hooks: AppHook['afterHandle'] | AppHook['afterHandle'][0],
	report?: TraceReporter
) {
	const hooks = toArray(_hooks)
	let code = ''
	let depth = 0

	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]
		if (i > 0) {
			code += `if(tmp===undefined){\n`
			depth++
		}

		const t = trace(report, fn)
		code += t.begin
		code += `tmp=${Await(fn)}af${at(i)}(c)\n`
		code += t.end('tmp')
	}

	code += '}'.repeat(depth)
	code += `if(tmp!==undefined)_r=c.responseValue=tmp\n`
	return code
}

export function mapMapResponse(
	_hooks: AppHook['mapResponse'] | AppHook['mapResponse'][0],
	report?: TraceReporter
) {
	const hooks = toArray(_hooks)
	let code = ''
	let depth = 0

	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]
		if (i > 0) {
			code += `if(tmp===undefined){\n`
			depth++
		}
		const t = trace(report, fn)
		code += t.begin
		code += `tmp=${Await(fn)}mr${at(i)}(c)\n`
		code += t.end('tmp')
	}
	code += '}'.repeat(depth)
	code += `if(tmp!==undefined)_r=c.responseValue=tmp\n`
	return code
}

// `try / catch` per hook so a thrown hook doesn't drop the rest
export const mapAfterResponse = map<'afterResponse', [report?: TraceReporter]>(
	(i, fn, [report]) => {
		const t = trace(report, fn)
		return (
			`try{` +
			t.begin +
			`${Await(fn)}ar${at(i)}(c)\n` +
			t.end() +
			`}catch(_e){` +
			t.end('_e') +
			`}\n`
		)
	}
)

export const mapError = map<
	'error',
	[
		map: string,
		link: Link,
		mapResponse: ElysiaAdapter['response']['map'],
		schedule: string
	]
>((i, fn, [map, link, mapResponse, schedule]) => {
	link(mapResponse, 'rm')
	return (
		`_r=${Await(fn)}er${at(i)}(c)\n` +
		`if(_r!==undefined){\n` +
		`if(_r?.status)c.set.status=_r.status\n` +
		schedule +
		`return ${map}(_r,c.set)\n` +
		`}\n`
	)
})

function map<Event extends AppEvent, T extends unknown[] = []>(
	map: (index: number | undefined, fn: AppHook[Event][0], rest: T) => string
) {
	return function (event: MaybeArray<AppHook[Event][0]>, rest?: T) {
		if (Array.isArray(event)) {
			let code = ''

			for (let i = 0; i < event.length; i++)
				code += map(i, event[i], rest as T)

			return code
		} else return map(undefined, event, rest as T)
	}
}

const at = (index: number | undefined) =>
	index === undefined ? '' : `[${index}]`

function arrayItemSchema(v: any): any {
	if (!v) return undefined
	if (v.type === 'array' || v['~kind'] === 'Array') return v.items
	if (Array.isArray(v.anyOf))
		for (const x of v.anyOf) {
			const it = arrayItemSchema(x)
			if (it) return it
		}
	return undefined
}

function isObjectish(v: any): boolean {
	if (!v) return false
	if (v.type === 'object' || v['~kind'] === 'Object') return true
	if (Array.isArray(v.anyOf)) return v.anyOf.some(isObjectish)
	return false
}

function containsArray(v: any, seen = new WeakSet()): boolean {
	if (!v || typeof v !== 'object') return false
	if (seen.has(v)) return false
	seen.add(v)
	if (v.type === 'array' || v['~kind'] === 'Array') return true
	if (v['~elyTyp'] === ELYSIA_TYPES.ArrayString) return true
	for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
		const arr = v[key]
		if (Array.isArray(arr))
			for (const x of arr) if (containsArray(x, seen)) return true
	}
	return false
}

// see if schema has object/array then tell `parseQueryFromURL`
export function getQueryParseArgs(querySchema: any): string {
	if (!querySchema) return ''

	let arrayProps: Record<string, 1> | undefined
	let objectProps: Record<string, 1> | undefined
	const seen = new WeakSet()

	function collect(node: any) {
		if (!node || typeof node !== 'object' || seen.has(node)) return
		seen.add(node)

		const props = node.properties
		if (props)
			for (const k in props) {
				const v = props[k]
				const kind = v?.['~elyTyp']
				if (containsArray(v)) {
					;(arrayProps ??= {})[k] = 1

					const item = arrayItemSchema(v)
					if (item && isObjectish(item)) (objectProps ??= {})[k] = 1
				}
				if (kind === ELYSIA_TYPES.ObjectString)
					(objectProps ??= {})[k] = 1
			}

		for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
			const arr = node[key]
			if (Array.isArray(arr)) for (const x of arr) collect(x)
		}
	}

	collect(querySchema)

	if (!arrayProps && !objectProps) return ''
	const arrLit = arrayProps ? `,${JSON.stringify(arrayProps)}` : ''
	const objLit = objectProps
		? `,${arrayProps ? '' : 'undefined,'}${JSON.stringify(objectProps)}`
		: ''

	return arrLit + objLit
}

export const Await = (fn: Function) => (isAsyncFunction(fn) ? 'await ' : '')
