"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Router = exports.getSchemaValidator = exports.createValidationError = exports.getPath = exports.SCHEMA = exports.t = exports.Elysia = void 0;
const router_1 = require("./router");
const handler_1 = require("./handler");
const utils_1 = require("./utils");
const schema_1 = require("./schema");
const error_1 = require("./error");
/**
 * ### Elysia Server
 * Main instance to create web server using Elysia
 *
 * ---
 * @example
 * ```typescript
 * import { Elysia } from 'elysia'
 *
 * new Elysia()
 *     .get("/", () => "Hello")
 *     .listen(8080)
 * ```
 */
class Elysia {
    constructor(config = {}) {
        this.store = {
            [utils_1.SCHEMA]: {}
        };
        this.event = {
            start: [],
            request: [],
            parse: [
                (request, contentType) => {
                    switch (contentType) {
                        case 'application/json':
                            return request.json();
                        case 'text/plain':
                            return request.text();
                    }
                }
            ],
            transform: [],
            beforeHandle: [],
            afterHandle: [],
            error: [],
            stop: []
        };
        this.server = null;
        this.$schema = null;
        this.router = new router_1.Router();
        this.routes = [];
        /**
         * ### stop
         * Stop server from serving
         *
         * ---
         * @example
         * ```typescript
         * const app = new Elysia()
         *     .get("/", () => 'hi')
         *     .listen(8080)
         *
         * // Sometime later
         * app.stop()
         * ```
         */
        this.stop = async () => {
            if (!this.server)
                throw new Error("Elysia isn't running. Call `app.listen` to start the server.");
            this.server.stop();
            for (let i = 0; i < this.event.stop.length; i++) {
                const process = this.event.stop[i](this);
                if (process instanceof Promise)
                    await process;
            }
        };
        this.config = {
            strictPath: false,
            ...config
        };
    }
    _addHandler(method, _path, handler, hook) {
        const path = _path.startsWith('/') ? _path : `/${_path}`;
        this.routes.push({
            method,
            path,
            handler,
            hooks: (0, utils_1.mergeHook)((0, utils_1.clone)(this.event), hook)
        });
        const body = (0, utils_1.getSchemaValidator)(hook?.schema?.body ?? this.$schema?.body);
        const header = (0, utils_1.getSchemaValidator)(hook?.schema?.header ?? this.$schema?.header, true);
        const params = (0, utils_1.getSchemaValidator)(hook?.schema?.params ?? this.$schema?.params);
        const query = (0, utils_1.getSchemaValidator)(hook?.schema?.query ?? this.$schema?.query);
        const response = (0, utils_1.getSchemaValidator)(hook?.schema?.response ?? this.$schema?.response);
        (0, schema_1.registerSchemaPath)({
            // @ts-ignore
            schema: this.store[utils_1.SCHEMA],
            hook,
            method,
            path
        });
        this.router.register(path)[method] = {
            handle: handler,
            hooks: (0, utils_1.mergeHook)((0, utils_1.clone)(this.event), hook),
            validator: body || header || params || query || response
                ? {
                    body,
                    header,
                    params,
                    query,
                    response
                }
                : undefined
        };
        if (!this.config.strictPath && path !== '/')
            if (path.endsWith('/'))
                this.router.register(path.substring(0, path.length - 1))[method] = this.router.register(path)[method];
            else
                this.router.register(`${path}/`)[method] =
                    this.router.register(path)[method];
    }
    /**
     * ### start | Life cycle event
     * Called after server is ready for serving
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onStart(({ url, port }) => {
     *         console.log("Running at ${url}:${port}")
     *     })
     *     .listen(8080)
     * ```
     */
    onStart(handler) {
        this.event.start.push(handler);
        return this;
    }
    /**
     * ### request | Life cycle event
     * Called on every new request is accepted
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onRequest(({ method, url }) => {
     *         saveToAnalytic({ method, url })
     *     })
     * ```
     */
    onRequest(handler) {
        this.event.request.push(handler);
        return this;
    }
    /**
     * ### parse | Life cycle event
     * Callback function to handle body parsing
     *
     * If truthy value is returned, will be assigned to `context.body`
     * Otherwise will skip the callback and look for the next one.
     *
     * Equivalent to Express's body parser
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onParse((request, contentType) => {
     *         if(contentType === "application/json")
     *             return request.json()
     *     })
     * ```
     */
    onParse(parser) {
        this.event.parse.splice(this.event.parse.length - 1, 0, parser);
        return this;
    }
    /**
     * ### transform | Life cycle event
     * Assign or transform anything related to context before validation.
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onTransform(({ params }) => {
     *         if(params.id)
     *             params.id = +params.id
     *     })
     * ```
     */
    onTransform(handler) {
        this.event.transform.push(handler);
        return this;
    }
    /**
     * ### Before Handle | Life cycle event
     * Intercept request **before(()) main handler is called.
     *
     * If truthy value is returned, will be assigned as `Response` and skip the main handler
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onBeforeHandle(({ params: { id }, status }) => {
     *         if(id && !isExisted(id)) {
     * 	           status(401)
     *
     *             return "Unauthorized"
     * 	       }
     *     })
     * ```
     */
    onBeforeHandle(handler) {
        this.event.beforeHandle.push(handler);
        return this;
    }
    /**
     * ### After Handle | Life cycle event
     * Intercept request **after** main handler is called.
     *
     * If truthy value is returned, will be assigned as `Response`
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onAfterHandle((context, response) => {
     *         if(typeof response === "object")
     *             return JSON.stringify(response)
     *     })
     * ```
     */
    onAfterHandle(handler) {
        this.event.afterHandle.push(handler);
        return this;
    }
    /**
     * ### Error | Life cycle event
     * Called when error is thrown during processing request
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onError(({ code }) => {
     *         if(code === "NOT_FOUND")
     *             return "Path not found :("
     *     })
     * ```
     */
    onError(errorHandler) {
        this.event.error.push(errorHandler);
        return this;
    }
    /**
     * ### stop | Life cycle event
     * Called after server stop serving request
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .onStop((app) => {
     *         cleanup()
     *     })
     * ```
     */
    onStop(handler) {
        this.event.stop.push(handler);
        return this;
    }
    /**
     * ### on
     * Syntax sugar for attaching life cycle event by name
     *
     * Does the exact same thing as `.on[Event]()`
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .on('error', ({ code }) => {
     *         if(code === "NOT_FOUND")
     *             return "Path not found :("
     *     })
     * ```
     */
    on(type, handler) {
        switch (type) {
            case 'start':
                this.event.start.push(handler);
                break;
            case 'request':
                this.event.request.push(handler);
                break;
            case 'parse':
                this.event.parse.push(handler);
                break;
            case 'transform':
                this.event.transform.push(handler);
                break;
            case 'beforeHandle':
                this.event.beforeHandle.push(handler);
                break;
            case 'afterHandle':
                this.event.afterHandle.push(handler);
                break;
            case 'error':
                this.event.error.push(handler);
                break;
            case 'stop':
                this.event.stop.push(handler);
                break;
        }
        return this;
    }
    /**
     * ### group
     * Encapsulate and group path with prefix
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .group('/v1', app => app
     *         .get('/', () => 'Hi')
     *         .get('/name', () => 'Elysia')
     *     })
     * ```
     */
    group(prefix, run) {
        const instance = new Elysia();
        run(instance);
        this.store = (0, utils_1.mergeDeep)(this.store, instance.store);
        Object.values(instance.routes).forEach(({ method, path, handler, hooks }) => {
            this._addHandler(method, `${prefix}${path}`, handler, hooks);
        });
        return this;
    }
    /**
     * ### guard
     * Encapsulate and pass hook into all child handler
     *
     * ---
     * @example
     * ```typescript
     * import { t } from 'elysia'
     *
     * new Elysia()
     *     .guard({
     *          schema: {
     *              body: t.Object({
     *                  username: t.String(),
     *                  password: t.String()
     *              })
     *          }
     *     }, app => app
     *         .get("/", () => 'Hi')
     *         .get("/name", () => 'Elysia')
     *     })
     * ```
     */
    guard(hook, run) {
        const instance = new Elysia();
        run(instance);
        Object.values(instance.routes).forEach(({ method, path, handler, hooks: localHook }) => {
            this._addHandler(method, path, handler, (0, utils_1.mergeHook)(hook, localHook));
        });
        return this;
    }
    /**
     * ### use
     * Merge separate logic of Elysia with current
     *
     * ---
     * @example
     * ```typescript
     * const plugin = (app: Elysia) => app
     *     .get('/plugin', () => 'hi')
     *
     * new Elysia()
     *     .use(plugin)
     * ```
     */
    use(plugin) {
        // ? Type enforce on function already
        return plugin(this);
    }
    /**
     * ### get
     * Register handler for path with method [GET]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .get('/', () => 'hi')
     *     .get('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    get(path, handler, hook) {
        this._addHandler('GET', path, handler, hook);
        return this;
    }
    /**
     * ### post
     * Register handler for path with method [POST]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .post('/', () => 'hi')
     *     .post('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    post(path, handler, hook) {
        this._addHandler('POST', path, handler, hook);
        return this;
    }
    /**
     * ### put
     * Register handler for path with method [PUT]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .put('/', () => 'hi')
     *     .put('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    put(path, handler, hook) {
        this._addHandler('PUT', path, handler, hook);
        return this;
    }
    /**
     * ### patch
     * Register handler for path with method [PATCH]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .patch('/', () => 'hi')
     *     .patch('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    patch(path, handler, hook) {
        this._addHandler('PATCH', path, handler, hook);
        return this;
    }
    /**
     * ### delete
     * Register handler for path with method [DELETE]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .delete('/', () => 'hi')
     *     .delete('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    delete(path, handler, hook) {
        this._addHandler('DELETE', path, handler, hook);
        return this;
    }
    /**
     * ### options
     * Register handler for path with method [OPTIONS]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .options('/', () => 'hi')
     *     .options('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    options(path, handler, hook) {
        this._addHandler('OPTIONS', path, handler, hook);
        return this;
    }
    /**
     * ### post
     * Register handler for path with any method
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .all('/', () => 'hi')
     * ```
     */
    all(path, handler, hook) {
        this._addHandler('ALL', path, handler, hook);
        return this;
    }
    /**
     * ### head
     * Register handler for path with method [HEAD]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .head('/', () => 'hi')
     *     .head('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    head(path, handler, hook) {
        this._addHandler('HEAD', path, handler, hook);
        return this;
    }
    /**
     * ### trace
     * Register handler for path with method [TRACE]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .trace('/', () => 'hi')
     *     .trace('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    trace(path, handler, hook) {
        this._addHandler('TRACE', path, handler, hook);
        return this;
    }
    /**
     * ### connect
     * Register handler for path with method [CONNECT]
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .connect('/', () => 'hi')
     *     .connect('/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    connect(path, handler, hook) {
        this._addHandler('CONNECT', path, handler, hook);
        return this;
    }
    /**
     * @deprecated
     *
     * Use `route` instead
     */
    method(method, path, handler, hook) {
        this.route(method, path, handler, hook);
    }
    /**
     * ### route
     * Register handler for path with custom method
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .route('CUSTOM', '/', () => 'hi')
     *     .route('CUSTOM', '/with-hook', () => 'hi', {
     *         schema: {
     *             response: t.String()
     *         }
     *     })
     * ```
     */
    route(method, path, handler, hook) {
        this._addHandler(method, path, handler, hook);
        return this;
    }
    /**
     * ### state
     * Assign global mutatable state accessible for all handler
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .state('counter', 0)
     *     .get('/', (({ counter }) => ++counter)
     * ```
     */
    state(name, value) {
        ;
        this.store[name] = value;
        return this;
    }
    /**
     * ### decorate
     * Define custom method to `Context` accessible for all handler
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .decorate('getDate', () => Date.now())
     *     .get('/', (({ getDate }) => getDate())
     * ```
     */
    decorate(name, value) {
        if (this.decorators === undefined)
            this.decorators = {};
        this.decorators[name] = value;
        return this;
    }
    /**
     * Create derived property from Context
     *
     * ---
     * @example
     * new Elysia()
     *     .state('counter', 1)
     *     .derive((store) => ({
     *         multiplied: () => store().counter * 2
     *     }))
     */
    derive(transform) {
        this.store = (0, utils_1.mergeDeep)(this.store, transform(() => this.store));
        return this;
    }
    /**
     * Assign property which required access to Context
     *
     * ---
     * @example
     * new Elysia()
     *     .state('counter', 1)
     *     .inject(({ store }) => ({
     *         increase() {
     *             store.counter++
     *         }
     *     }))
     */
    inject(transform) {
        return this.onTransform((context) => {
            Object.assign(context, transform(context));
        });
    }
    /**
     * ### schema
     * Define type strict validation for request
     *
     * ---
     * @example
     * ```typescript
     * import { Elysia, t } from 'elysia'
     *
     * new Elysia()
     *     .schema({
     *         response: t.String()
     *     })
     *     .get('/', () => 'hi')
     * ```
     */
    schema(schema) {
        this.$schema = {
            body: (0, utils_1.getSchemaValidator)(schema?.body),
            header: (0, utils_1.getSchemaValidator)(schema?.header),
            params: (0, utils_1.getSchemaValidator)(schema?.params),
            query: (0, utils_1.getSchemaValidator)(schema?.query),
            response: (0, utils_1.getSchemaValidator)(schema?.response)
        };
        return this;
    }
    async handle(request) {
        for (let i = 0; i < this.event.request.length; i++) {
            let response = this.event.request[i](request, this.store);
            if (response instanceof Promise)
                response = await response;
            if (response)
                return response;
        }
        const route = this.router.find((0, utils_1.getPath)(request.url));
        if (route === null)
            throw new Error('NOT_FOUND');
        const handler = route.store[request.method] ?? route.store.ALL;
        if (handler === undefined)
            throw new Error('NOT_FOUND');
        let body;
        if (request.method !== 'GET') {
            const contentType = request.headers.get('content-type') ?? '';
            if (contentType !== '')
                for (let i = 0; i < this.event.parse.length; i++) {
                    let temp = this.event.parse[i](request, contentType);
                    if (temp instanceof Promise)
                        temp = await temp;
                    if (temp) {
                        body = temp;
                        break;
                    }
                }
        }
        let context = {
            ...this.decorators,
            request,
            params: route?.params ?? {},
            query: (0, utils_1.mapQuery)(request.url),
            body,
            store: this.store,
            set: {
                status: 200,
                headers: {}
            }
        };
        for (let i = 0; i < handler.hooks.transform.length; i++) {
            let _context = handler.hooks.transform[i](context);
            if (_context instanceof Promise)
                _context = await _context;
            if (_context)
                context = _context;
        }
        if (handler.validator) {
            const validator = handler.validator;
            if (validator.header) {
                const _header = {};
                for (const v of request.headers.entries())
                    _header[v[0]] = v[1];
                if (validator.header.Check(_header) === false)
                    throw (0, utils_1.createValidationError)('header', validator.header, _header);
            }
            if (validator.params &&
                validator.params.Check(context.params) === false)
                throw (0, utils_1.createValidationError)('params', validator.params, context.params);
            if (validator.query &&
                validator.query.Check(context.query) === false) {
                throw (0, utils_1.createValidationError)('query', validator.query, context.query);
            }
            if (validator.body && validator.body.Check(body) === false)
                throw (0, utils_1.createValidationError)('body', validator.body, body);
        }
        for (let i = 0; i < handler.hooks.beforeHandle.length; i++) {
            let response = handler.hooks.beforeHandle[i](context);
            if (response instanceof Promise)
                response = await response;
            // `false` is a falsey value, check for null and undefined instead
            if (response !== null && response !== undefined) {
                for (let i = 0; i < handler.hooks.afterHandle.length; i++) {
                    let newResponse = handler.hooks.afterHandle[i](context, response);
                    if (newResponse instanceof Promise)
                        newResponse = await newResponse;
                    if (newResponse)
                        response = newResponse;
                }
                const result = (0, handler_1.mapEarlyResponse)(response, context);
                if (result)
                    return result;
            }
        }
        let response = handler.handle(context);
        if (response instanceof Promise)
            response = await response;
        if (handler.validator?.response &&
            handler.validator.response.Check(response) === false)
            throw (0, utils_1.createValidationError)('response', handler.validator.response, response);
        for (let i = 0; i < handler.hooks.afterHandle.length; i++) {
            let newResponse = handler.hooks.afterHandle[i](context, response);
            if (newResponse instanceof Promise)
                newResponse = await newResponse;
            if (newResponse)
                response = newResponse;
            const result = (0, handler_1.mapEarlyResponse)(response, context);
            if (result)
                return result;
        }
        return (0, handler_1.mapResponse)(response, context);
    }
    handleError(error) {
        for (let i = 0; i < this.event.error.length; i++) {
            const response = this.event.error[i]((0, error_1.mapErrorCode)(error.message), error);
            if (response instanceof Response)
                return response;
        }
        return new Response(typeof error.cause === 'string' ? error.cause : error.message);
    }
    /**
     * ### listen
     * Assign current instance to port and start serving
     *
     * ---
     * @example
     * ```typescript
     * new Elysia()
     *     .get("/", () => 'hi')
     *     .listen(8080)
     * ```
     */
    listen(options, callback) {
        if (!Bun)
            throw new Error('Bun to run');
        const fetch = this.handle.bind(this);
        const error = this.handleError.bind(this);
        if (typeof options === 'string') {
            options = +options;
            if (Number.isNaN(options))
                throw new Error('Port must be a numeric value');
        }
        this.server = Bun.serve(typeof options === 'object'
            ? {
                ...this.config.serve,
                ...options,
                fetch,
                error
            }
            : {
                ...this.config.serve,
                port: options,
                fetch,
                error
            });
        for (let i = 0; i < this.event.start.length; i++)
            this.event.start[i](this);
        if (callback)
            callback(this.server);
        return this;
    }
}
exports.default = Elysia;
exports.Elysia = Elysia;
var typebox_1 = require("@sinclair/typebox");
Object.defineProperty(exports, "t", { enumerable: true, get: function () { return typebox_1.Type; } });
var utils_2 = require("./utils");
Object.defineProperty(exports, "SCHEMA", { enumerable: true, get: function () { return utils_2.SCHEMA; } });
Object.defineProperty(exports, "getPath", { enumerable: true, get: function () { return utils_2.getPath; } });
Object.defineProperty(exports, "createValidationError", { enumerable: true, get: function () { return utils_2.createValidationError; } });
Object.defineProperty(exports, "getSchemaValidator", { enumerable: true, get: function () { return utils_2.getSchemaValidator; } });
var router_2 = require("./router");
Object.defineProperty(exports, "Router", { enumerable: true, get: function () { return router_2.Router; } });
