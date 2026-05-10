import { mapCompactResponse, mapResponse } from './handler'
import { formDataToObject } from './utils'

import { createAdapter } from '..'
import { parseQuery } from '../../parse-query'

export const WebStandardAdapter = createAdapter({
	name: 'web-standard',
	runtime: 'unknown',
	isWebStandard: true,
	parse: {
		arrayBuffer: (context) => context.request.arrayBuffer(),
		formData: (context) =>
			// @ts-ignore
			context.request.formData().then(formDataToObject),
		// @ts-ignore
		json: (context) => context.request.json(),
		text: (context) => context.request.text(),
		urlencoded: (context) => context.request.text().then(parseQuery)
	},
	response: {
		map: mapResponse,
		compact: mapCompactResponse
	}
})
