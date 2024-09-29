//10598091800295472221
function map(r){const u=r.url,s=u.indexOf('/',11),qi=u.indexOf('?', s + 1)
let p
if(qi===-1)p=u.substring(s)
else p=u.substring(s, qi)
const c={request:r,store,qi,path:p,url:u,redirect,error,set:{headers:{},status:200}}
switch(p){case'/b':switch(r.method){case 'GET': return st[0](c)
default:const route=router.find(r.method,p)
if(route===null)return error404.clone()
c.params=route.params
if(route.store.handler)return route.store.handler(c)
return (route.store.handler=route.store.compile())(c)
}case'/b/':switch(r.method){case 'GET': return st[0](c)
default:const route=router.find(r.method,p)
if(route===null)return error404.clone()
c.params=route.params
if(route.store.handler)return route.store.handler(c)
return (route.store.handler=route.store.compile())(c)
}case'/':switch(r.method){case 'GET': return st[1](c)
default:const route=router.find(r.method,p)
if(route===null)return error404.clone()
c.params=route.params
if(route.store.handler)return route.store.handler(c)
return (route.store.handler=route.store.compile())(c)
}case'':switch(r.method){case 'GET': return st[1](c)
default:const route=router.find(r.method,p)
if(route===null)return error404.clone()
c.params=route.params
if(route.store.handler)return route.store.handler(c)
return (route.store.handler=route.store.compile())(c)
}default:break}const route=router.find(r.method,p)
if(route===null)return error404.clone()
c.params=route.params
if(route.store.handler)return route.store.handler(c)
return (route.store.handler=route.store.compile())(c)
}