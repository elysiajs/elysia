const injection = process.env.D1_INJECT
const retained: Uint8Array[] = []
const executables: Function[] = []
const n2bRetained: Uint8Array[] = []
const coldStartStarted = Bun.nanoseconds()

export function busyWaitNanoseconds(duration: number) {
	const started = Bun.nanoseconds()
	while (Bun.nanoseconds() - started < duration) {}
}

if (injection === 'cold-start') busyWaitNanoseconds(200_000_000)

export const coldStartOverheadNs =
	injection === 'cold-start' ? Bun.nanoseconds() - coldStartStarted : 0

export function injectHttp() {
	if (injection === 'http') busyWaitNanoseconds(200_000)
}

export function injectCompileHighwater(route: number) {
	if (injection !== 'compile-highwater') return
	const transient = new Uint8Array(256 * 1024)
	transient[route % transient.length] = route & 255
}

export function injectRetained(route: number) {
	if (injection !== 'retained') return
	// Keep the self-test signal comfortably above pinned-machine allocator noise.
	const bytes = new Uint8Array(2_048)
	bytes[route % bytes.length] = route & 255
	retained.push(bytes)
}

export function injectExecutable(route: number) {
	if (injection !== 'executables' && injection !== 'n2b-executables') return
	executables.push(new Function(`return ${route}`))
}

export function injectN2bRuntime() {
	if (injection === 'n2b-runtime') busyWaitNanoseconds(200_000)
}

export function injectWebSocketRuntime() {
	if (injection === 'websocket-runtime') busyWaitNanoseconds(200_000)
}

export function injectN2bRetained(index: number) {
	if (injection !== 'n2b-retained') return
	const bytes = new Uint8Array(64 * 1024)
	bytes[index % bytes.length] = index & 255
	n2bRetained.push(bytes)
}
