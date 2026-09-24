try {
	const { t, TypeSystem } = await import('../../src/type')

	if (typeof t?.String !== 'function')
		throw new Error(
			't.String is not callable — type-system not initialised'
		)
	if (!TypeSystem)
		throw new Error('TypeSystem export missing from type barrel')

	console.log('✅ type-system import works!')
} catch (cause) {
	throw new Error('❌ type-system import failed', { cause })
}

export {}
