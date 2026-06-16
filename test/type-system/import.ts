// Smoke test: the type-system barrel must import without crashing.
// `t` is a Proxy that runs typebox `setupTypebox()` on first access (side
// effects: registering Elysia's custom typebox kinds), so touching it here
// catches import-time/registration regressions before they reach users.
try {
	const { t, System } = await import('../../src/type')

	// touch `t` to trigger the lazy setupTypebox() proxy, then assert the
	// type-system surface is actually wired (not an empty/broken module).
	if (typeof t?.String !== 'function')
		throw new Error(
			't.String is not callable — type-system not initialised'
		)
	if (!System)
		throw new Error('System export missing from type-system barrel')

	console.log('✅ type-system import works!')
} catch (cause) {
	throw new Error('❌ type-system import failed', { cause })
}

export {}
