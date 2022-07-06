import Router, {
    type ParsedUrlQuery,
    type Handler as RawHandler,
    type HTTPMethod
} from './lib/find-my-world'

interface KWRequest {
    readonly request: Request
    readonly query: ParsedUrlQuery
    readonly params: Record<string, string | undefined>
    readonly headers: () => Record<string, string>
}

type EmptyHandler = (request: Request) => Response
type Handler = (request: KWRequest, store: any) => any

const jsonHeader = {
    headers: {
        'Content-Type': 'application/json'
    }
}

const createHandler =
    (handler: Handler) => async (request: Request, params, query, store) => {
        const response = await handler(
            {
                request,
                params,
                query,
                headers: () => parseHeader(request.headers)
            },
            store
        )

        switch (typeof response) {
            case 'string':
                return new Response(response)

            case 'object':
                try {
                    return new Response(JSON.stringify(response), jsonHeader)
                } catch (error) {
                    throw new error()
                }

            case 'function':
                return response

            case 'number':
            case 'boolean':
                return new Response(response.toString())

            case 'undefined':
                return new Response('')

            default:
                return new Response(response)
        }
    }

const parseHeader = (headers: Headers) => {
    const parsed = {}

    for (let [key, value] of headers.entries()) parsed[key] = value

    return parsed
}

export default class KingWorld {
    router: Router

    constructor() {
        this.router = new Router()
    }

    get(path: string, handler: Handler) {
        this.router.on('GET', path, createHandler(handler))

        return this
    }

    post(path: string, handler: Handler) {
        this.router.on('POST', path, createHandler(handler))

        return this
    }

    put(path: string, handler: Handler) {
        this.router.on('PUT', path, createHandler(handler))

        return this
    }

    patch(path: string, handler: Handler) {
        this.router.on('PATCH', path, createHandler(handler))

        return this
    }

    delete(path: string, handler: Handler) {
        this.router.on('DELETE', path, createHandler(handler))

        return this
    }

    options(path: string, handler: Handler) {
        this.router.on('DELETE', path, createHandler(handler))

        return this
    }

    head(path: string, handler: Handler) {
        this.router.on('DELETE', path, createHandler(handler))

        return this
    }

    purge(path: string, handler: Handler) {
        this.router.on('PURGE', path, createHandler(handler))

        return this
    }

    move(path: string, handler: Handler) {
        this.router.on('MOVE', path, createHandler(handler))

        return this
    }

    on(on: HTTPMethod, path: string, handler: Handler) {
        this.router.on(on, path, createHandler(handler))

        return this
    }

    default(handler: EmptyHandler) {
        this.router.defaultRoute = handler

        return this
    }

    listen(port: number) {
        // @ts-ignore
        if (!Bun) throw new Error('KINGWORLD is not run in Bun environment')

        const fetch = (request: Request) => this.router.lookup(request)

        // @ts-ignore
        Bun.serve({
            port,
            fetch
        })
    }
}
