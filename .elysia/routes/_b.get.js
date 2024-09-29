//2866900669422722016
function anonymous(hooks
) {
const {handler,handleError,hooks: {transform,resolve,beforeHandle,afterHandle,mapResponse: onMapResponse,parse,error: handleErrors,afterResponse,trace: _trace},validator,utils: {mapResponse,mapCompactResponse,mapEarlyResponse,parseQuery,parseQueryFromURL,isNotEmpty},error: {NotFoundError,ValidationError,InternalServerError,ParseError},schema,definitions,ERROR_CODE,parseCookie,signCookie,decodeURIComponent,ELYSIA_RESPONSE,ELYSIA_TRACE,ELYSIA_REQUEST_ID,getServer}=hooks
const trace=_trace.map(x=>typeof x==='function'?x:x.fn)
return function handle(c){try{c.route=`/b`
return mapCompactResponse(handler(c),c.request)

}catch(error){return(async()=>{const set=c.set
if(!set.status||set.status<300)set.status=error?.status||500
return handleError(c,error,true)})()}}
}