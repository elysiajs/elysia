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

export type Handler = (
    request: Request,
    params: { [k: string]: string | undefined },
    searchParams: ParsedUrlQuery | undefined,
    store: Object,
) => any

export interface Route {
    method: HTTPMethod
    path: string
    handler: Handler
    store: Object
}

export type ShortHandRoute = (
    path: string,
    handler: Handler,
    store?: any
) => void

export interface FindResult {
    handler: Handler
    params: { [k: string]: string | undefined }
    searchParams?: ParsedUrlQuery
    store: any
}
