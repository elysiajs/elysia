import {
	mapCompactResponse,
	mapEarlyResponse,
	mapResponse,
	mapStaticHandler
} from './handler'
import { formDataToObject } from './utils'

import { createAdapter } from '..'
import { parseQuery } from '../../parse-query'

export const webStandardAdapter = createAdapter({
	name: 'web-standard',
	runtime: 'unknown',
	isWebStandard: true,
	listen: () => () => {
		throw new Error('Not supported')
	},
	parse: {
		arrayBuffer: (context) => context.request.arrayBuffer(),
		formData: async (context) =>
			// @ts-ignore
			context.request.formData().then(formDataToObject),
		json: (context) =>
			context.request.json() as any as Promise<
				Record<keyof any, undefined> | unknown[]
			>,
		text: (context) => context.request.text(),
		urlencoded: (context) => context.request.text().then(parseQuery)
	},
	response: {
		map: mapResponse,
		early: mapEarlyResponse,
		compact: mapCompactResponse,
		static: mapStaticHandler
	}
})
