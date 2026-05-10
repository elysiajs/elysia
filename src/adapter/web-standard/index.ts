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
		json: async (context) => {
			// `Request.json()` throws `SyntaxError: Unexpected end of
			// JSON input` for empty payloads, which surfaces as a 400
			// ParseError. Empty body with `content-type: application/json`
			// is a common preflight shape — treat it as "no body"
			// instead of erroring (test "skip body parsing if body is
			// empty but headers is present").
			const text = await context.request.text()
			if (!text) return undefined
			return JSON.parse(text) as any
		},
		text: (context) => context.request.text(),
		urlencoded: (context) => context.request.text().then(parseQuery)
	},
	response: {
		map: mapResponse,
		compact: mapCompactResponse
	}
})
