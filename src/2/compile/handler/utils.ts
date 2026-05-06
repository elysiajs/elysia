import { isAsyncFunction } from '../utils'
import { ElysiaStatus } from '../../error'

import type { ElysiaAdapter } from '../../adapter'
import type { AnyElysia } from '../../base'
import type { AppEvent, AppHook, MaybeArray } from '../../types'
import type { Link } from '../types'

export const mapTransform = map<'transform'>(
	(i, fn) => `${Await(fn)}tf${at(i)}(c)\n`
)

export const mapBeforeHandle = map<
	'beforeHandle',
	[
		AnyElysia['~derive'],
		string,
		Link,
		ElysiaAdapter['response']['map'],
		shouldReturn: boolean
	]
>((i, fn, [derive, map, link, mapResponse, shouldReturn]) => {
	const body = `tmp=${Await(fn)}bf${at(i)}(c)\n`

	if (derive?.has(fn)) {
		link(ElysiaStatus, 'st')
		link(mapResponse, 'rm')

		return (
			body +
			'if(tmp instanceof st){\n' +
			'c.set.status=tmp.status\n' +
			`return ${map}(tmp.res,c.set)\n` +
			'}else if(tmp)Object.assign(c,tmp)\n'
		)
	}

	if (shouldReturn) {
		const set = map === 'rc' ? '' : ',c.set'
		return body + `if(tmp!==undefined)return ${map}(tmp${set})\n`
	}

	return body
})

export const mapAfterHandle = map<'afterHandle'>((i, fn) => {
	const body = `tmp=${Await(fn)}af${at(i)}(c)\n`

	return body + `if(tmp!==undefined)return tmp\n`
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

const Await = (fn: Function) => (isAsyncFunction(fn) ? 'await ' : '')
