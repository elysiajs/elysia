import { expectType } from 'tsd'
import * as Router from '../../'
import { Http2ServerRequest, Http2ServerResponse } from 'http2'
import { IncomingMessage, ServerResponse } from 'http'

let http1Req!: IncomingMessage;
let http1Res!: ServerResponse;
let http2Req!: Http2ServerRequest;
let http2Res!: Http2ServerResponse;

// HTTP1
{
  let handler: Router.Handler<Router.HTTPVersion.V1>
  const router = Router({
    ignoreTrailingSlash: true,
    ignoreDuplicateSlashes: true,
    allowUnsafeRegex: false,
    caseSensitive: false,
    maxParamLength: 42,
    defaultRoute (http1Req, http1Res) {},
    onBadUrl (path, http1Req, http1Res) {},
    constraints: {
      foo: {
        name: 'foo',
        mustMatchWhenDerived: true,
        storage () {
          return {
            get (version) { return handler },
            set (version, handler) {},
            del (version) {},
            empty () {}
          }
        },
        deriveConstraint(req) { return '1.0.0' },
        validate(value) { if (typeof value === "string") { throw new Error("invalid")} }
      }
    }
  })
  expectType<Router.Instance<Router.HTTPVersion.V1>>(router)

  expectType<void>(router.on('GET', '/', () => {}))
  expectType<void>(router.on(['GET', 'POST'], '/', () => {}))
  expectType<void>(router.on('GET', '/', { constraints: { version: '1.0.0' }}, () => {}))
  expectType<void>(router.on('GET', '/', () => {}, {}))
  expectType<void>(router.on('GET', '/', {constraints: { version: '1.0.0' }}, () => {}, {}))

  expectType<void>(router.get('/', () => {}))
  expectType<void>(router.get('/', { constraints: { version: '1.0.0' }}, () => {}))
  expectType<void>(router.get('/', () => {}, {}))
  expectType<void>(router.get('/', { constraints: { version: '1.0.0' }}, () => {}, {}))

  expectType<void>(router.off('GET', '/'))
  expectType<void>(router.off(['GET', 'POST'], '/'))

  expectType<any>(router.lookup(http1Req, http1Res))
  expectType<Router.FindResult<Router.HTTPVersion.V1> | null>(router.find('GET', '/'))
  expectType<Router.FindResult<Router.HTTPVersion.V1> | null>(router.find('GET', '/', {}))
  expectType<Router.FindResult<Router.HTTPVersion.V1> | null>(router.find('GET', '/', {version: '1.0.0'}))

  expectType<void>(router.reset())
  expectType<string>(router.prettyPrint())
  expectType<string>(router.prettyPrint({ commonPrefix: false }))
  expectType<string>(router.prettyPrint({ commonPrefix: true }))
  expectType<string>(router.prettyPrint({ includeMeta: true }))
  expectType<string>(router.prettyPrint({ includeMeta: ['test', Symbol('test')] }))
}

// HTTP2
{
  const constraints: { [key: string]: Router.ConstraintStrategy<Router.HTTPVersion.V2, string> } = {
    foo: {
      name: 'foo',
      mustMatchWhenDerived: true,
      storage () {
        return {
          get (version) { return handler },
          set (version, handler) {},
          del (version) {},
          empty () {}
        }
      },
      deriveConstraint(req) { return '1.0.0' },
      validate(value) { if (typeof value === "string") { throw new Error("invalid")} }
    }
  }

  let handler: Router.Handler<Router.HTTPVersion.V2>
  const router = Router<Router.HTTPVersion.V2>({
    ignoreTrailingSlash: true,
    ignoreDuplicateSlashes: true,
    allowUnsafeRegex: false,
    caseSensitive: false,
    maxParamLength: 42,
    defaultRoute (http1Req, http1Res) {},
    onBadUrl (path, http1Req, http1Res) {},
    constraints
  })
  expectType<Router.Instance<Router.HTTPVersion.V2>>(router)

  expectType<void>(router.on('GET', '/', () => {}))
  expectType<void>(router.on(['GET', 'POST'], '/', () => {}))
  expectType<void>(router.on('GET', '/', { constraints: { version: '1.0.0' }}, () => {}))
  expectType<void>(router.on('GET', '/', () => {}, {}))
  expectType<void>(router.on('GET', '/', { constraints: { version: '1.0.0' }}, () => {}, {}))

  expectType<void>(router.addConstraintStrategy(constraints.foo))

  expectType<void>(router.get('/', () => {}))
  expectType<void>(router.get('/', { constraints: { version: '1.0.0' }}, () => {}))
  expectType<void>(router.get('/', () => {}, {}))
  expectType<void>(router.get('/', { constraints: { version: '1.0.0' }}, () => {}, {}))

  expectType<void>(router.off('GET', '/'))
  expectType<void>(router.off(['GET', 'POST'], '/'))

  expectType<any>(router.lookup(http2Req, http2Res))
  expectType<Router.FindResult<Router.HTTPVersion.V2> | null>(router.find('GET', '/', {}))
  expectType<Router.FindResult<Router.HTTPVersion.V2> | null>(router.find('GET', '/', {version: '1.0.0', host: 'fastify.io'}))

  expectType<void>(router.reset())
  expectType<string>(router.prettyPrint())

}

// Custom Constraint
{
  let handler: Router.Handler<Router.HTTPVersion.V1>

  interface AcceptAndContentType { accept?: string, contentType?: string }

  const customConstraintWithObject: Router.ConstraintStrategy<Router.HTTPVersion.V1, AcceptAndContentType> = {
    name: "customConstraintWithObject",
    deriveConstraint<Context>(req: Router.Req<Router.HTTPVersion.V1>, ctx: Context | undefined): AcceptAndContentType {
      return {
        accept: req.headers.accept,
        contentType: req.headers["content-type"]
      }
    },
    validate(value: unknown): void {},
    storage () {
      return {
        get (version) { return handler },
        set (version, handler) {},
        del (version) {},
        empty () {}
      }
    }
  }

  const storageWithObject = customConstraintWithObject.storage()
  const acceptAndContentType: AcceptAndContentType = { accept: 'application/json', contentType: 'application/xml' }

  expectType<AcceptAndContentType>(customConstraintWithObject.deriveConstraint(http1Req, http1Res))
  expectType<void>(storageWithObject.empty())
  expectType<void>(storageWithObject.del(acceptAndContentType));
  expectType<Router.Handler<Router.HTTPVersion.V1> | null>(storageWithObject.get(acceptAndContentType));
  expectType<void>(storageWithObject.set(acceptAndContentType, () => {}));

  const customConstraintWithDefault: Router.ConstraintStrategy<Router.HTTPVersion.V1> = {
    name: "customConstraintWithObject",
    deriveConstraint<Context>(req: Router.Req<Router.HTTPVersion.V1>, ctx: Context | undefined): string {
      return req.headers.accept ?? ''
    },
    validate(value: unknown): void {},
    storage () {
      return {
        get (version) { return handler },
        set (version, handler) {},
        del (version) {},
        empty () {}
      }
    }
  }

  const storageWithDefault = customConstraintWithDefault.storage()

  expectType<string>(customConstraintWithDefault.deriveConstraint(http1Req, http1Res))
  expectType<void>(storageWithDefault.empty())
  expectType<void>(storageWithDefault.del(''));
  expectType<Router.Handler<Router.HTTPVersion.V1> | null>(storageWithDefault.get(''));
  expectType<void>(storageWithDefault.set('', () => {}));
}
