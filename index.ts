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

type HookEvent = 'preHandler'

interface Hook {
    preHandlers: Handler[]
}

interface RegisterHook {
    preHandlers: Handler | Handler[]
}

const createHandler =
    (handler: Handler, hook: Hook) =>
    async (request: Request, params, query, store): Promise<Response> => {
        for (const preHandler of hook.preHandlers) {
            const handled = await preHandler(
                {
                    request,
                    params,
                    query,
                    headers: () => parseHeader(request.headers)
                },
                store
            )

            if (handled)
                switch (typeof handled) {
                    case 'string':
                        return new Response(handled)

                    case 'object':
                        try {
                            return new Response(
                                JSON.stringify(handled),
                                jsonHeader
                            )
                        } catch (error) {
                            throw new error()
                        }

                    case 'function':
                        return handled

                    case 'number':
                    case 'boolean':
                        return new Response(handled.toString())

                    default:
                        break
                }
        }

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

export type Plugin<T extends Object> = (app: KingWorld, config?: T) => void

const mergeHook = (a: Hook, b: Hook | RegisterHook | undefined): Hook => ({
    preHandlers: b?.preHandlers
        ? a.preHandlers.concat(b.preHandlers)
        : a.preHandlers
})

export default class KingWorld {
    router: Router
    store: Object
    hook: Hook

    constructor() {
        this.router = new Router()
        this.store = {}
        this.hook = {
            preHandlers: []
        }
    }

    #addHandler(
        method: HTTPMethod,
        path: string,
        handler: Handler,
        hook?: RegisterHook
    ) {
        this.router.on(
            method,
            path,
            createHandler(handler, mergeHook(this.hook, hook)),
            this.store
        )
    }

    when(type: HookEvent, handler: Handler) {
        switch (type) {
            case 'preHandler':
                this.hook.preHandlers.push(handler)
        }

        return this
    }

    group(prefix: string, run: (group: KingWorld) => void) {
        const instance = new KingWorld()
        run(instance)

        this.store = Object.assign(this.store, instance.store)

        instance.router.routes.forEach(({ method, path, handler }) => {
            // @ts-ignore
            this.#addHandler(method, `${prefix}${path}`, handler, instance.hook)
        })

        return this
    }

    register<T extends Object>(plugin: Plugin<T>, config?: T) {
        plugin(this, config)

        return this
    }

    get(path: string, handler: Handler, hook?: RegisterHook) {
        this.#addHandler('GET', path, handler, hook)

        return this
    }

    post(path: string, handler: Handler, hook?: RegisterHook) {
        this.#addHandler('POST', path, handler, hook)

        return this
    }

    put(path: string, handler: Handler, hook?: RegisterHook) {
        this.#addHandler('PUT', path, handler)

        return this
    }

    patch(path: string, handler: Handler, hook?: RegisterHook) {
        this.#addHandler('PATCH', path, handler)

        return this
    }

    delete(path: string, handler: Handler, hook?: RegisterHook) {
        this.#addHandler('DELETE', path, handler)

        return this
    }

    options(path: string, handler: Handler, hook?: RegisterHook) {
        this.#addHandler('OPTIONS', path, handler)

        return this
    }

    head(path: string, handler: Handler, hook?: RegisterHook) {
        this.#addHandler('HEAD', path, handler)

        return this
    }

    purge(path: string, handler: Handler, hook?: RegisterHook) {
        this.#addHandler('PURGE', path, handler)

        return this
    }

    move(path: string, handler: Handler, hook?: RegisterHook) {
        this.#addHandler('MOVE', path, handler)

        return this
    }

    on(
        method: HTTPMethod,
        path: string,
        handler: Handler,
        hook?: RegisterHook
    ) {
        this.#addHandler(method, path, handler, hook)

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
