// Smoke test: the type-system barrel must import without crashing.
// Importing the type module runs `setupTypebox()` (registers Elysia's custom
// typebox kinds), so touching it here catches import-time/registration
// regressions before they reach users.
try {
	const { t, TypeSystem } = await import('../../src/type')

	// assert the type-system surface is actually wired (not an empty/broken module)
	if (typeof t?.String !== 'function')
		throw new Error(
			't.String is not callable — type-system not initialised'
		)
	if (!TypeSystem)
		throw new Error('TypeSystem export missing from type-system barrel')

	console.log('✅ type-system import works!')
} catch (cause) {
	throw new Error('❌ type-system import failed', { cause })
}

export {}
