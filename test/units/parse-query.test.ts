import { describe, expect, it } from 'bun:test'

import {
	parseQueryFromURL,
	parseQueryStandardSchema
} from '../../src/parse-query'

describe('parse query', () => {
	it('starts parsing from the provided URL query index', () => {
		const url =
			'http://localhost/path=a&ignored=true/route?name=sucrose&job=alchemist'
		const startIndex = url.indexOf('?') + 1

		expect(parseQueryFromURL(url, startIndex)).toEqual({
			name: 'sucrose',
			job: 'alchemist'
		})
	})

	it('starts standard schema parsing from the provided URL query index', () => {
		const url =
			'http://localhost/path=a&ignored=true/route?names=sucrose,lumine'
		const startIndex = url.indexOf('?') + 1

		expect(parseQueryStandardSchema(url, startIndex)).toEqual({
			names: ['sucrose', 'lumine']
		})
	})
})
