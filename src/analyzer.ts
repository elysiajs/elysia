import type { LifeCycleEvent } from './types'

export const separateFunction = (code: string): [string, string] => {
	if (code.startsWith('async')) code = code.slice(6)

	let index = -1

	// Starts with '(', is an arrow function
	if (code.charCodeAt(0) === 40) {
		// ? arrow function
		index = code.indexOf(') => {\n')
		if (index !== -1) return [code.slice(1, index), code.slice(index + 5)]

		// ? Sudden return
		index = code.indexOf(') => ')
        if (index !== -1) return [code.slice(1, index), code.slice(index + 5)]
	}

	// Using function keyword
	if (code.startsWith('function')) {
		index = code.indexOf('(')
		const end = code.indexOf(')')

		return [code.slice(index + 1, end), code.slice(end + 2)]
	}

    // Unknown case
	return code.split('\n', 1) as [string, string]
}

const extractContextReference = (code: string) => {}

export const Sucrose = () => {
    
}