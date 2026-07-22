import { mapCompactResponse, mapResponse } from './handler'
import { formDataToObject, formDataToObjectFlatFastPath } from './utils'
import { normalizeContentType } from '../utils'

import { createAdapter } from '..'
import { parseQuery } from '../../parse-query'
import { isBun } from '../../universal/constants'
import type { Context } from '../../context'

function parseFormData(context: Context, flatFastPath = false) {
	const contentType = context.request.headers.get('content-type') ?? ''
	const ct = contentType.toLowerCase()
	const convert = flatFastPath ? formDataToObjectFlatFastPath : formDataToObject

	if (isBun && ct !== contentType) {
		const fullCt = context.request.headers.get('content-type') ?? ''

		const semi = fullCt.indexOf(';')
		const fixedCt =
			semi === -1
				? fullCt.toLowerCase()
				: fullCt.slice(0, semi).toLowerCase() + fullCt.slice(semi)

		const headers = new Headers(context.request.headers)
		headers.set('content-type', fixedCt)

		const rewrapped = new Request(context.request.url, {
			method: context.request.method,
			headers,
			body: context.request.body,
			duplex: 'half'
		})

		// @ts-ignore
		return rewrapped.formData().then(convert)
	}

	// @ts-ignore
	return context.request.formData().then(convert)
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
		default(context, contentType, normalized, flatFormDataFastPath) {
			const ct = normalized
				? contentType
				: normalizeContentType(contentType)

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
						return parseFormData(context, flatFormDataFastPath)
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
