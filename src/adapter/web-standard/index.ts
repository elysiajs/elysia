import { mapCompactResponse, mapResponse } from './handler'
import { formDataToObject } from './utils'

import { createAdapter } from '..'
import { parseQuery } from '../../parse-query'
import { isBun } from '../../universal/constants'
import type { Context } from '../../context'

function lowercaseContentType(ct: string) {
	for (let i = 0; i < ct.length; i++) {
		const code = ct.charCodeAt(i)
		if (code >= 65 && code <= 90) return ct.toLowerCase()
	}

	return ct
}

function parseFormData(context: Context, contentType?: string) {
	contentType ??= context.request.headers.get('content-type') ?? ''
	const ct = lowercaseContentType(contentType)

	if (isBun && ct !== contentType) {
		const fullCt = context.request.headers.get('content-type') ?? ''

		const semi = fullCt.indexOf(';')
		const fixedCt =
			semi === -1
				? lowercaseContentType(fullCt)
				: lowercaseContentType(fullCt.slice(0, semi)) +
					fullCt.slice(semi)

		const headers = new Headers(context.request.headers)
		headers.set('content-type', fixedCt)

		const rewrapped = new Request(context.request, {
			headers
		})
		// @ts-ignore
		return rewrapped.formData().then(formDataToObject)
	}

	// @ts-ignore
	return context.request.formData().then(formDataToObject)
}

export const WebStandardAdapter = createAdapter({
	name: 'web-standard',
	runtime: 'unknown',
	isWebStandard: true,
	parse: {
		arrayBuffer: (context) => context.request.arrayBuffer(),
		formData: parseFormData,
		// @ts-ignore
		json: (context) => context.request.json(),
		text: (context) => context.request.text(),
		urlencoded: (context) => context.request.text().then(parseQuery),
		default(context, contentType) {
			const ct = lowercaseContentType(contentType)

			switch (ct.charCodeAt(12)) {
				case 106:
					return context.request.json()

				case 120:
					// match both `application/x-www-form-urlencoded` and
					// `application/xml` / `application/xhtml+xml`
					// Only urlencoded form has '-' at index 13
					if (ct.charCodeAt(13) === 45)
						return context.request.text().then(parseQuery)

					break

				case 111:
					return context.request.arrayBuffer()

				case 114:
					return parseFormData(context, contentType)

				default:
					if (ct.charCodeAt(0) === 116) return context.request.text()
			}
		}
	},
	response: {
		map: mapResponse,
		compact: mapCompactResponse
	}
})
