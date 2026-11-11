import decode from 'deuri'

// A user importer whose path mirrors Elysia's `src/handler/fetch.ts`, the one
// importer the deuri resolution stub targets. This one keeps the real decoder
export const decoded = decode('a%20b')
