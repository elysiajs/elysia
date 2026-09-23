import { mapCompactResponse, mapResponse } from './handler'
import { formDataToObject } from './utils'

import { createAdapter } from '..'
import { parseQuery } from '../../parse-query'
import type { Context } from '../../context'

function parseFormData(context: Context) {
	// @ts-ignore
	return context.request.formData().then(formDataToObject)
}

export const WebStandardAdapter = createAdapter({
	parse: {
		arrayBuffer: (context) => context.request.arrayBuffer(),
		formData: parseFormData,
		// @ts-ignore
		json: (context) => context.request.json(),
		text: (context) => context.request.text(),
		urlencoded: (context) => context.request.text().then(parseQuery),
		default(context, ct) {
			switch (ct.charCodeAt(12)) {
				case 106:
					if (ct === 'application/json') return context.request.json()

					break

				case 120:
					if (ct === 'application/x-www-form-urlencoded')
						return context.request.text().then(parseQuery)

					break

				case 111:
					if (ct === 'application/octet-stream')
						return context.request.arrayBuffer()

					break

				case 114:
					if (ct === 'multipart/form-data')
						return parseFormData(context)
			}

			if (ct.charCodeAt(0) === 116 && ct.startsWith('text/'))
				return context.request.text()

			// RFC 6839 structured syntax suffix
			if (ct.endsWith('+json')) return context.request.json()
		}
	},
	response: {
		map: mapResponse,
		supportsDefaultHeaderSink: true,
		compact: mapCompactResponse
	}
})
