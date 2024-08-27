// import { describe, it, expect } from 'bun:test'
// import { classToObject } from '../../src/utils'

// describe('extractPropertiesAndGetters', () => {
// 	class TestClass {
// 		public normalProperty: string = 'normal'
// 		private _computedProperty: number = 42

// 		get computedProperty(): number {
// 			return this._computedProperty
// 		}

// 		public method(): string {
// 			return 'method'
// 		}
// 	}

// 	it('should extract properties and getters, omitting methods', () => {
// 		const instance = new TestClass()
// 		const result = classToObject(instance)

// 		// Check that normal property is copied
// 		expect(result.normalProperty).toBe('normal')

// 		// Check that getter is included
// 		expect(result.computedProperty).toBe(42)

// 		// Check that method is not included
// 		// @ts-ignore
// 		expect(result.method).toBeUndefined()

// 		// Check that private property is not included
// 		expect(result).not.toHaveProperty('_computedProperty')

// 		// Check the structure of the result object
// 		expect(Object.keys(result)).toEqual([
// 			'normalProperty',
// 			'computedProperty'
// 		])
// 	})

// 	it('should handle objects with no getters', () => {
// 		const obj = { a: 1, b: 2 }
// 		const result = classToObject(obj)

// 		expect(result).toEqual({ a: 1, b: 2 })
// 	})

// 	it('should handle empty objects', () => {
// 		const obj = {}
// 		const result = classToObject(obj)

// 		expect(result).toEqual({})
// 	})

// 	it('should handle circular references', () => {
// 		const obj: any = { a: 1 }
// 		obj.self = obj
// 		obj.nested = { b: 2, parent: obj }

// 		const result = classToObject(obj)

// 		expect(result.a).toBe(1)
// 		expect(result.self).toBe(result)
// 		expect(result.nested.b).toBe(2)
// 		expect(result.nested.parent).toBe(result)
// 	})
// })
