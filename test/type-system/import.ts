try {
	const { TypeSystem } = await import('../../src/type')
	console.log(TypeSystem && `✅ TypeSystem import works!`)
} catch (cause) {
	throw new Error('❌ TypeSystem import failed', { cause })
}
export {}
