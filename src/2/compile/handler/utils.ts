import { isAsyncFunction } from '../utils'

import type { AnyElysia } from '../..'
import type { AppEvent, AppHook, BodyHandler, MaybeArray } from '../../types'

export const mapTransform = map<'transform'>(
	(i, fn) => `${Await(fn)}tf${at(i)}(c)\n`
)

export const mapBeforeHandle = map<'beforeHandle', [AnyElysia['~derive']]>(
	(i, fn, [derive]) => {
		const body = `${Await(fn)}bf${at(i)}(c)\n`

		if (derive?.has(fn)) return `dr=${body}if(dr)Object.assign(c,dr)\n`

		return body
	}
)

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
