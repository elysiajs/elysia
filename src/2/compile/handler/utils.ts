import { isAsyncFunction } from '../utils'
import { ElysiaStatus } from '../../error'

import type { AnyElysia } from '../../base'
import type { AppEvent, AppHook, MaybeArray } from '../../types'
import type { Link } from '../types'

export const mapTransform = map<'transform'>(
	(i, fn) => `${Await(fn)}tf${at(i)}(c)\n`
)

export const mapBeforeHandle = map<
	'beforeHandle',
	[AnyElysia['~derive'], Link]
>((i, fn, [derive, link]) => {
	const body = `tmp=${Await(fn)}bf${at(i)}(c)\n`

	if (derive?.has(fn)) {
		link(ElysiaStatus, 'st')

		return (
			body +
			'if(tmp instanceof st){\n' +
			'c.set.status=tmp.status\n' +
			'return re(tmp.res,c.set)\n' +
			'}else if(tmp)Object.assign(c,tmp)\n'
		)
	}

	return body + `if(tmp!==undefined)return re(tmp,c.set)\n`
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
