try {
	const { TypeSystem } = await import('../../src/2/type')
	console.log(TypeSystem && `✅ TypeSystem import works!`)
} catch (cause) {
	throw new Error('❌ TypeSystem import failed', { cause })
}
export {}
