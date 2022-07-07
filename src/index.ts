import validate from 'fluent-schema-validator'

import { createHandler } from './handler'
import { concatArrayObject, mergeHook, parseHeader } from './utils'

import Router, { type HTTPMethod } from './lib/find-my-world'

import type {
    Handler,
    EmptyHandler,
    Hook,
    HookEvent,
    RegisterHook,
    PreRequestHandler,
    TypedRoute,
    Schemas,
    Plugin,
    ParsedRequest,
    KingWorldInstance
} from './types'

export default class KingWorld<
    Instance extends KingWorldInstance = KingWorldInstance
> {
    router: Router
    store: Instance['Store']
    #ref: [keyof Instance['Store'], any][]
    hook: Hook<Instance>

    constructor() {
        this.router = new Router()
        this.store = {} as Instance['Store']
        this.#ref = []
        this.hook = {
            onRequest: [],
            transform: [],
            preHandler: [],
            schema: {
                body: [],
                header: [],
                query: [],
                params: []
            }
        }
    }

    #addHandler<Route extends TypedRoute = TypedRoute>(
        method: HTTPMethod,
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.router.on(
            method,
            path,
            createHandler<Route, Instance>(
                handler,
                mergeHook(this.hook as any, hook as any)
            ),
            this.store
        )
    }

    onRequest(handler: PreRequestHandler<Instance['Store']>) {
        this.hook.onRequest.push(handler)

        return this
    }

    transform(handler: Handler<{}, Instance>) {
        this.hook.transform.push(handler)

        return this
    }

    schema(schema: Schemas) {
        if (schema.body)
            this.hook.schema.body = this.hook.schema.body.concat(schema.body)

        if (schema.header)
            this.hook.schema.body = this.hook.schema.body.concat(schema.header)

        if (schema.params)
            this.hook.schema.params = this.hook.schema.body.concat(
                schema.params
            )

        if (schema.query)
            this.hook.schema.query = this.hook.schema.body.concat(schema.query)

        return this
    }

    preHandler(handler: Handler<{}, Instance>) {
        this.hook.preHandler.push(handler)

        return this
    }

    when<Event extends HookEvent = HookEvent>(
        type: Event,
        handler: RegisterHook<Instance['Store']>[Event]
    ) {
        switch (type) {
            case 'onRequest':
                this.hook.onRequest.push(
                    handler as PreRequestHandler<Instance['Store']>
                )

            case 'transform':
                this.hook.transform.push(handler as Handler<{}, Instance>)

            case 'preHandler':
                this.hook.preHandler.push(handler as Handler<{}, Instance>)
        }

        return this
    }

    group(prefix: string, run: (group: KingWorld<Instance>) => void) {
        const instance = new KingWorld<Instance>()
        run(instance)

        this.store = Object.assign(this.store, instance.store)

        instance.router.routes.forEach(({ method, path, handler }) => {
            this.#addHandler(method, `${prefix}${path}`, handler, instance.hook)
        })

        return this
    }

    guard(
        hook: RegisterHook<any, Instance>,
        run: (group: KingWorld<Instance>) => void
    ) {
        const instance = new KingWorld<Instance>()
        instance.hook = mergeHook(instance.hook)
        run(instance)

        this.store = Object.assign(this.store, instance.store)

        instance.router.routes.forEach(({ method, path, handler }) => {
            this.#addHandler(method, path, handler, instance.hook)
        })

        return this
    }

    use<
        CurrentInstance extends KingWorldInstance = Instance,
        Config = Object,
        PluginInstance extends KingWorldInstance = KingWorldInstance
    >(
        plugin: Plugin<Config, PluginInstance, CurrentInstance>,
        config?: Config
    ): KingWorld<Instance & PluginInstance> {
        // ? Need hack, because instance need to have both type
        // ? but before transform type won't we available
        return plugin(this as any, config) as any
    }

    get<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('GET', path, handler, hook)

        return this
    }

    post<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('POST', path, handler, hook)

        return this
    }

    put<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('PUT', path, handler)

        return this
    }

    patch<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('PATCH', path, handler)

        return this
    }

    delete<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('DELETE', path, handler)

        return this
    }

    options<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('OPTIONS', path, handler)

        return this
    }

    head<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('HEAD', path, handler)

        return this
    }

    trace<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('TRACE', path, handler)

        return this
    }

    connect<Route extends TypedRoute = TypedRoute>(
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler('CONNECT', path, handler)

        return this
    }

    on<Route extends TypedRoute = TypedRoute>(
        method: HTTPMethod,
        path: string,
        handler: Handler<Route, Instance>,
        hook?: RegisterHook<Route, Instance>
    ) {
        this.#addHandler(method, path, handler, hook)

        return this
    }

    default(handler: EmptyHandler) {
        this.router.defaultRoute = handler

        return this
    }

    state(
        name: keyof Instance['Store'],
        value: Instance['Store'][keyof Instance['Store']]
    ) {
        this.store[name] = value

        return this
    }

    ref(
        name: keyof Instance['Store'],
        value:
            | Instance['Store'][keyof Instance['Store']]
            | (() => Instance['Store'][keyof Instance['Store']])
            | (() => Promise<Instance['Store'][keyof Instance['Store']]>)
    ) {
        this.#ref.push([name, value])

        return this
    }

    serverless = (request: Request) => {
        const reference: Partial<Instance['Store']> = {}

        if (this.#ref[0])
            for (const [key, value] of this.#ref)
                reference[key] =
                    typeof value === 'function'
                        ? Promise.resolve(value())
                        : value

        if (this.hook.onRequest[0])
            for (const onRequest of this.hook.onRequest)
                Promise.resolve(
                    onRequest(request, reference)
                )

        return this.router.lookup(request, reference)
    }

    listen(port: number) {
        // @ts-ignore
        if (!Bun) throw new Error('KINGWORLD required Bun to run')

        try {
            // @ts-ignore
            Bun.serve({
                port,
                fetch: this.serverless
            })
        } catch (error) {
            throw new Error(error)
        }
    }
}

export { validate }

export type {
    Handler,
    EmptyHandler,
    Hook,
    HookEvent,
    RegisterHook,
    ParsedRequest,
    PreRequestHandler,
    TypedRoute,
    Schemas,
    Plugin
} from './types'
