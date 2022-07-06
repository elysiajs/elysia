import type { ParsedUrlQuery } from 'querystring'

export type HTTPMethod =
    | 'ACL'
    | 'BIND'
    | 'CHECKOUT'
    | 'CONNECT'
    | 'COPY'
    | 'DELETE'
    | 'GET'
    | 'HEAD'
    | 'LINK'
    | 'LOCK'
    | 'M-SEARCH'
    | 'MERGE'
    | 'MKACTIVITY'
    | 'MKCALENDAR'
    | 'MKCOL'
    | 'MOVE'
    | 'NOTIFY'
    | 'OPTIONS'
    | 'PATCH'
    | 'POST'
    | 'PROPFIND'
    | 'PROPPATCH'
    | 'PURGE'
    | 'PUT'
    | 'REBIND'
    | 'REPORT'
    | 'SEARCH'
    | 'SOURCE'
    | 'SUBSCRIBE'
    | 'TRACE'
    | 'UNBIND'
    | 'UNLINK'
    | 'UNLOCK'
    | 'UNSUBSCRIBE'

export type Handler<T = Record<string, any>> = (
    request: Request,
    params: { [k: string]: string | undefined },
    store: T,
    searchParams?: ParsedUrlQuery
) => any

export interface Route<T = Record<string, any>> {
    method: HTTPMethod
    path: string
    handler: Handler<T>
    store: Object
}

export type ShortHandRoute = <T = Record<string, any>>(
    path: string,
    handler: Handler<T>,
    store?: any
) => void

export interface FindResult<T = Record<string, any>> {
    handler: Handler<T>
    params: { [k: string]: string | undefined }
    searchParams?: ParsedUrlQuery
    store: any
}
