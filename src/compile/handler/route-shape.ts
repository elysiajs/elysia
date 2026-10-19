import type { AnyElysia } from '../../base'
import type { AnyLocalHook } from '../../types'

import { defaultAdapter } from '../../adapter/constants'
import { frozenRootOf } from '../../generation'
import { returnedErrorClasses } from '../../handler/utils'
import { originalFunction } from '../../type/shared'
import { isAsyncFunction } from '../utils'
import { deriveModes } from './utils'
import { isResponseMap } from './frozen-validator'
import { compositionKeys, fnv1a, isNotEmpty, refTargets } from '../../utils'

/**
 * `k` of a captured route: the manifest stores it, replay compares it.
 *
 * Only AOT needs it: the generated manifest installs it as `Compiled.routeShape`
 * (the capture side through `installReconstructImpl`), so a plain bundle
 * never carries the walker. Without the install every replay is unprovable
 * and `compileHandler` compiles live
 */
const shapeEvents = [
	'parse',
	'transform',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'error',
	'trace'
] as const

const shapeSlots = ['body', 'headers', 'params', 'query', 'cookie', 'response']

const isCookieAt = (at: string) => at === 'cookie' || at === 'field'

// mirrors `gather` in cookie/config: a trailing `*` marks a container whose
// every value is a schema, `^` a Deferred's `parameters`
function childAt(at: string, k: string, value: unknown, deferred: boolean) {
	if (at.endsWith('*')) return at.slice(0, -1)
	if (at.endsWith('^'))
		return k === '0'
			? at.slice(0, -1) + (Array.isArray(value) ? '*' : '')
			: ''

	if (!isCookieAt(at)) return ''

	switch (k) {
		case '$ref':
			return at

		case 'properties':
			return at === 'cookie' ? 'field*' : ''

		case 'parameters':
			return deferred ? at + '^' : ''
	}

	return k === '$defs' || compositionKeys.includes(k) ? at + '*' : ''
}

// checksum of route compilation
export function routeShape(
	hook: AnyLocalHook | undefined,
	handler: unknown,
	root: AnyElysia
): number | undefined {
	const frozenRoot = frozenRootOf(root)
	const config = frozenRoot['~config']
	const models = frozenRoot['~ext']?.models as Record<string, unknown>

	// reference models
	const refs = new Map<string, string>()
	const addRef = (name: string, at = '') => {
		if (!isCookieAt(at)) at = ''
		if (at === 'cookie' || !refs.get(name)) refs.set(name, at)
	}

	const ids = new Map<Function, number>()
	const visiting = new Set<object>()
	let unsupported = false

	// polluted Object / Array prototype
	for (const _ in []) return

	// fnv1a of the canonical sequence, hashed as it is produced, never built
	let hash: number | undefined
	const feed = (s: string) => {
		hash = fnv1a(s, hash)
	}

	const quote = (s: string) => feed(JSON.stringify(s))

	const shape = (v: any, at = ''): void => {
		switch (typeof v) {
			case 'string':
				return quote(v)

			case 'number':
				return feed('n' + (Object.is(v, -0) ? '-0' : v))

			case 'bigint':
				return feed('b' + v)

			case 'boolean':
				return feed(v ? 'T' : 'F')

			case 'undefined':
				return feed('U')

			case 'function':
				// compile replaces refine checks in place
				v = originalFunction(v)
				if (ids.has(v)) return feed('#' + ids.get(v))
				ids.set(v, ids.size)
				return feed(isAsyncFunction(v) ? 'fa' : 'fs')

			case 'symbol':
				unsupported = true
				return
		}

		if (v === null) return feed('N')
		if ('~standard' in v) return feed('S')

		if (visiting.has(v)) {
			unsupported = true
			return
		}

		// Elysia builders keep `~kind` on a shared prototype
		let kind: PropertyDescriptor | undefined
		const list = Array.isArray(v)
		const proto = Object.getPrototypeOf(v)
		if (
			list
				? proto !== Array.prototype
				: proto !== null && proto !== Object.prototype
		) {
			kind = proto && Object.getOwnPropertyDescriptor(proto, '~kind')

			if (
				!kind ||
				!('value' in kind) ||
				Reflect.ownKeys(proto).length !== 1 ||
				Object.getPrototypeOf(proto) !== Object.prototype
			) {
				unsupported = true
				return
			}
		}

		// the tag follows the bracket
		feed(list ? '[' : '{')
		if (kind) shape(kind.value)

		visiting.add(v)

		const map = at === 'response' && isResponseMap(v)
		const deferred = v['~kind'] === 'Deferred'

		for (const k of Reflect.ownKeys(v)) {
			const d = Object.getOwnPropertyDescriptor(v, k)!
			if (typeof k === 'symbol' || !('value' in d)) {
				unsupported = true
				break
			}

			const value = d.value
			if (k === '$ref' && typeof value === 'string') addRef(value, at)
			feed(d.enumerable ? ',' : ',!')
			quote(k)
			feed(':')

			if (map) named(value)
			else if (k === 'config' && isCookieAt(at))
				shape([value?.sign, !!value?.secrets])
			// secret never enters shape
			else if (
				k === 'secrets' &&
				(typeof value === 'string' || Array.isArray(value))
			)
				shape(!!value)
			else shape(value, childAt(at, k as string, value, deferred))
		}

		visiting.delete(v)

		feed(list ? ']' : '}')
	}

	// a string is a model name
	const named = (v: unknown, at?: string) => {
		if (typeof v === 'string') addRef(v, at)
		shape(v, at)
	}

	if (typeof handler === 'function' || handler == null) shape(handler)
	else
		feed(
			handler instanceof Response
				? 'R'
				: handler instanceof Promise
					? 'P'
					: typeof handler === 'object'
						? 'O'
						: 'V'
		)

	for (const event of shapeEvents) {
		feed('|')

		const fns = (hook as any)?.[event]
		if (fns) for (const fn of Array.isArray(fns) ? fns : [fns]) shape(fn)
	}

	const bf = hook?.beforeHandle as Function | Function[] | undefined
	feed(
		'|' +
			JSON.stringify(
				bf &&
					deriveModes(
						Array.isArray(bf) ? bf : [bf],
						(hook as any)['~deriveEntries']
					)
			)
	)

	for (const from of [hook, ...((hook as any)?.schemas || [])])
		for (const slot of shapeSlots) {
			feed('|')
			named(from?.[slot], slot)
		}

	// reference models, a cookie counts every schema a name may resolve to.
	// `refs` grows while walked: a model may name another
	let targets: ReturnType<typeof refTargets> | undefined
	for (const [ref, at] of refs)
		for (const target of at
			? (targets ??= refTargets([], models))(ref)
			: [models?.[ref]]) {
			feed('|')
			quote(ref)
			shape(target, at)
		}

	feed(
		'|' +
			JSON.stringify([
				config?.cookie?.sign,
				config?.cookie?.verify,
				config?.normalize,
				!!config?.allowUnsafeValidationDetails,
				config?.abortSignal !== false,
				isNotEmpty(frozenRoot['~ext']?.headers),
				// not `compact`: captured code works either way
				!!(config?.adapter ?? defaultAdapter).response
					.supportsDefaultHeaderSink,
				!!returnedErrorClasses(hook as any)
			])
	)
	shape(config?.sanitize)

	return unsupported ? undefined : hash
}
