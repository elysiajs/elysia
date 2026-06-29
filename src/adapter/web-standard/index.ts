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
		urlencoded: (context) => context.request.text().then(parseQuery),
		default(context, contentType) {
			switch (contentType.charCodeAt(12)) {
				case 106:
					return context.request.json()

				case 120:
					// match both `application/x-www-form-urlencoded` and
					// `application/xml` / `application/xhtml+xml`
					// Only urlencoded form has '-' at index 13
					if (contentType.charCodeAt(13) === 45)
						return context.request.text().then(parseQuery)

					break

				case 111:
					return context.request.arrayBuffer()

				case 114:
					// @ts-ignore
					return context.request.formData().then(formDataToObject)

				default:
					if (contentType.charCodeAt(0) === 116)
						return context.request.text()
			}
		}
	},
	response: {
		map: mapResponse,
		compact: mapCompactResponse
	}
})
