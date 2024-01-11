import { describe, expect, it } from 'bun:test'

import { separateFunction } from '../../src/analyzer'

describe('Analyzer: separateFunction', () => {
	it('separate arrowParam', () => {
		const arrowParam = ({ sucrose, amber }: any) => {
			return 'sucrose'
		}

		expect(separateFunction(arrowParam.toString())).toEqual([
			'{ sucrose, amber }',
			'{\n      return "sucrose";\n    }'
		])
	})

	it('separate arrowNoParam', () => {
		const arrowNoParam = () => 'sucrose'

		expect(separateFunction(arrowNoParam.toString())).toEqual([
			'',
			'"sucrose"'
		])
	})

	it('separate arrowAsync', () => {
		const arrowAsync = async (sucrose: any) => 'sucrose'

		expect(separateFunction(arrowAsync.toString())).toEqual([
			'sucrose',
			'"sucrose"'
		])
	})

	it('separate fnParam', () => {
		function fnParam({ sucrose, amber }: any) {
			return 'sucrose'
		}

		expect(separateFunction(fnParam.toString())).toEqual([
			'{ sucrose, amber }',
			'{\n      return "sucrose";\n    }'
		])
	})

	it('separate fnNoParam', () => {
		function fnNoParam() {
			return 'sucrose'
		}

		expect(separateFunction(fnNoParam.toString())).toEqual([
			'',
			'{\n      return "sucrose";\n    }'
		])
	})

	it('separate fnAsync', () => {
		async function fnAsync(sucrose: any) {
			return 'sucrose'
		}

		expect(separateFunction(fnAsync.toString())).toEqual([
			'sucrose',
			'{\n      return "sucrose";\n    }'
		])
	})
})
