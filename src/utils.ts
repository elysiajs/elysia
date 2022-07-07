import type { Hook, RegisterHook } from './types'

export const parseHeader = (headers: Headers) => {
    const parsed: Record<string, any> = {}

    for (let [key, value] of headers.entries()) parsed[key] = value

    return parsed
}

export const concatArrayObject = <T>(a: T[], b: T | T[] | undefined): T[] =>
    b ? a.concat(b) : a

export const mergeHook = <T>(
    a: Hook<T>,
    b?: Hook<T> | RegisterHook<T> | undefined
): Hook<T> => ({
    onRequest: concatArrayObject(a?.onRequest, b?.onRequest),
    transform: concatArrayObject(a?.transform, b?.transform),
    preHandler: concatArrayObject(a?.preHandler, b?.preHandler),
    schema: {
        body: concatArrayObject(a?.schema.body, b?.schema?.body),
        header: concatArrayObject(a?.schema.header, b?.schema?.header),
        query: concatArrayObject(a?.schema.query, b?.schema?.query),
        params: concatArrayObject(a?.schema.params, b?.schema?.params)
    }
})
