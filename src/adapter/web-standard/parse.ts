import { formDataToObject } from './utils'

import { parseQuery } from '../../parse-query'
import type { Context } from '../../context'
import type { ElysiaAdapterOptions } from '../types'

function parseFormData(context: Context) {
	// @ts-ignore
	return context.request.formData().then(formDataToObject)
}

// Own module: only the body-parse links (`pf`/`pj`/`pu`/`pa`/`pt`/`pd`) and
// the handler JIT read it, an AOT strip build without them stubs it
export const parse: ElysiaAdapterOptions['parse'] = {
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
				if (ct === 'multipart/form-data') return parseFormData(context)
		}

		if (ct.charCodeAt(0) === 116 && ct.startsWith('text/'))
			return context.request.text()

		// RFC 6839 structured syntax suffix
		if (ct.endsWith('+json')) return context.request.json()
	}
}
