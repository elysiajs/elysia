import { isAsyncFunction } from '../utils'
import { ElysiaStatus } from '../../error'

import type { ElysiaAdapter } from '../../adapter'
import type { AnyElysia } from '../../base'
import type { AppEvent, AppHook, MaybeArray } from '../../types'
import type { Link } from '../types'

export const mapTransform = map<'transform'>(
	(i, fn) => `${Await(fn)}tf${at(i)}(c)\n`
)

// Walk the `beforeHandle` chain. Each hook runs in a nested
// `if (_r === undefined)` block so the first one that returns a
// non-undefined value short-circuits the rest — its value flows through
// `afterHandle` / `afterResponse` instead of being returned directly.
//
// `derive` hooks (registered via `.derive(...)`) are special: their
// non-status return is merged into context via `Object.assign`, and we
// reset `tmp` so they don't look like a response. An `ElysiaStatus`
// return *does* short-circuit (treated as a response). `ElysiaStatus`
// is linked as `es` here when any derive hook exists.
export const mapBeforeHandle = (
	hooksRaw: AppHook['beforeHandle'] | AppHook['beforeHandle'][0],
	derive: AnyElysia['~derive'],
	link: Link
): string => {
	const hooks = Array.isArray(hooksRaw) ? hooksRaw : [hooksRaw]
	let code = ''
	let depth = 0
	let needsEs = false
	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]
		if (i > 0) {
			code += `if(_r===undefined){\n`
			depth++
		}
		code += `tmp=${Await(fn)}bf${at(i)}(c)\n`
		if (derive?.has(fn)) {
			needsEs = true
			code +=
				'if(tmp instanceof es)_r=tmp\n' +
				'else if(tmp){Object.assign(c,tmp);tmp=undefined}\n'
		} else code += 'if(tmp!==undefined)_r=tmp\n'
	}
	code += '}'.repeat(depth)
	if (needsEs) link(ElysiaStatus, 'es')
	return code
}

// Walk the `afterHandle` chain. First hook to return non-undefined wins;
// the rest are skipped via nested `if (tmp === undefined)` blocks. The
// override (if any) is committed to `_r` and `c.responseValue` after the
// chain completes — so `afterResponse` and the final `mapResponse` see
// the post-override value.
export const mapAfterHandle = (
	hooksRaw: AppHook['afterHandle'] | AppHook['afterHandle'][0]
): string => {
	const hooks = Array.isArray(hooksRaw) ? hooksRaw : [hooksRaw]
	let code = ''
	let depth = 0
	for (let i = 0; i < hooks.length; i++) {
		if (i > 0) {
			code += `if(tmp===undefined){\n`
			depth++
		}
		code += `tmp=${Await(hooks[i])}af${at(i)}(c)\n`
	}
	code += '}'.repeat(depth)
	code += `if(tmp!==undefined)_r=c.responseValue=tmp\n`
	return code
}

// `mapResponse` chain — like `afterHandle`, but conventionally transforms
// the final response into a Response. Runs after `afterHandle`. Same
// short-circuit semantics: first non-undefined return wins, the rest are
// skipped via nested `if (tmp === undefined)` blocks. The override is
// committed to `_r` and `c.responseValue` so subsequent stages
// (`afterResponse`) observe it.
export const mapMapResponse = (
	hooksRaw: AppHook['mapResponse'] | AppHook['mapResponse'][0]
): string => {
	const hooks = Array.isArray(hooksRaw) ? hooksRaw : [hooksRaw]
	let code = ''
	let depth = 0
	for (let i = 0; i < hooks.length; i++) {
		if (i > 0) {
			code += `if(tmp===undefined){\n`
			depth++
		}
		code += `tmp=${Await(hooks[i])}mr${at(i)}(c)\n`
	}
	code += '}'.repeat(depth)
	code += `if(tmp!==undefined)_r=c.responseValue=tmp\n`
	return code
}

// `afterResponse` runs after the route's response is computed but is
// scheduled via `setImmediate` (or microtask fallback) so it doesn't delay
// the response. Each hook is isolated in its own try/catch so a thrown hook
// doesn't drop the remaining hooks (and doesn't surface as an unhandled
// rejection — Bun reports those as `Unhandled error between tests`).
// `Await` emits `await ` only for async fns so sync hooks skip the
// microtask hop.
export const mapAfterResponse = map<'afterResponse'>(
	(i, fn) =>
		`try{${Await(fn)}ar${at(i)}(c)}catch(_e){console.error(_e)}\n`
)

// Per-route error chain. The catch block runs each handler in order; first
// non-undefined return wins. The schedule string lets the surrounding code
// splice in `afterResponse` so it fires for handled errors too.
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

export const Await = (fn: Function) => (isAsyncFunction(fn) ? 'await ' : '')
