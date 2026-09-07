import type { MaybeArray } from '../types'

export function isAsyncFunction(fn: Function) {
	return (
		fn.constructor.name === 'AsyncFunction' ||
		fn.constructor.name === 'AsyncGeneratorFunction'
	)
}

// Only simple headers are proof: defaults, comments and opaque functions
// remain conservative. A block without a return token cannot return a Promise.
const matchArrow = /^(?:[\w$]+|\([\w$\s,.[\]{}:]*\))\s*=>([\s\S]*)$/
const matchFunction =
	/^(?:function(?:\s+[\w$]+)?|[\w$]+)\s*\([\w$\s,.[\]{}:]*\)\s*(\{[\s\S]*\})$/
const matchLiteral = /^(?:true|false|null|-?\d+(?:\.\d+)?|'[^'\\]*'|"[^"\\]*")$/

const mayReturnPromiseCache = new WeakMap<Function, boolean>()

export function mayReturnPromise(fn: Function): boolean {
	let result = mayReturnPromiseCache.get(fn)
	if (result !== undefined) return result

	const literal = Function.prototype.toString.call(fn).trim()
	const arrow = matchArrow.exec(literal)
	const body = (arrow?.[1] ?? matchFunction.exec(literal)?.[1])?.trimStart()
	result =
		literal.includes('[native code]') ||
		!(
			(body?.startsWith('{') &&
				body.endsWith('}') &&
				!/\breturn\b/.test(body)) ||
			(arrow && matchLiteral.test(body!))
		)
	mayReturnPromiseCache.set(fn, result)

	return result
}

export const isAsyncLifecycle = (handlers: MaybeArray<Function> | undefined) =>
	handlers
		? Array.isArray(handlers)
			? handlers.some(isAsyncFunction)
			: isAsyncFunction(handlers)
		: false
