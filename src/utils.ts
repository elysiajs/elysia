import type { Hook, RegisterHook } from './types'

export const parseHeader = (headers: Headers) => {
    const parsed: Record<string, any> = {}

    for (let [key, value] of headers.entries()) parsed[key] = value

    return parsed
}

export const concatArrayObject = <T>(a: T[], b: T | T[] | undefined): T[] =>
    b ? a.concat(b) : a

export const mergeHook = (a: Hook, b?: Hook | RegisterHook): Hook<any> => ({
    onRequest: concatArrayObject(a?.onRequest, b?.onRequest) ?? [],
    transform: concatArrayObject(a?.transform, b?.transform) ?? [],
    preHandler: concatArrayObject(a?.preHandler, b?.preHandler) ?? [],
    schema: {
        body: concatArrayObject(a?.schema.body, b?.schema?.body) ?? [],
        header: concatArrayObject(a?.schema.header, b?.schema?.header) ?? [],
        query: concatArrayObject(a?.schema.query, b?.schema?.query) ?? [],
        params: concatArrayObject(a?.schema.params, b?.schema?.params) ?? []
    }
})

export const isPromise = (response: any) => typeof response?.then === 'function'

export const clone = <T extends Object = Object>(aObject: T): T => {
    let bObject = Array.isArray(aObject) ? [] : {}

    let value: Partial<T>
    for (const key in aObject) {
        value = aObject[key]

        bObject[key as any] =
            typeof value === 'object' ? clone(value as T) : value
    }

    return bObject as T
}
