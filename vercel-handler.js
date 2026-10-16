import {createServer} from './server.js';
import {serverSettings} from './server-settings.js';
import {createSharedRuntimeStore} from './shared-runtime-store.js';
import {GenerationError} from './ai.js';
import {Readable} from 'node:stream';

export function createVercelHandler({env=process.env,fetcher=fetch,storeFetcher=fetch}={}){
 const hostname=env.VERCEL_PROJECT_PRODUCTION_URL||env.VERCEL_URL;
 const runtime={...env,HOST:'0.0.0.0',PUBLIC_ORIGIN:env.PUBLIC_ORIGIN||(hostname?`https://${hostname}`:undefined),PUBLIC_DEPLOYMENT_ORIGIN:env.VERCEL_URL?`https://${env.VERCEL_URL}`:undefined};
 const settings=serverSettings(runtime);
 if(env.VERCEL_URL){
  const deployment=new URL(`https://${env.VERCEL_URL}`);
  if(deployment.hostname!==env.VERCEL_URL||deployment.pathname!=='/'||deployment.port)throw new Error('Invalid deployment origin.');
  if(!settings.origins.includes(deployment.origin))settings.origins.push(deployment.origin);
 }
 let store;
 const storeURL=env.UPSTASH_REDIS_REST_URL||env.KV_REST_API_URL,storeToken=env.UPSTASH_REDIS_REST_TOKEN||env.KV_REST_API_TOKEN;
 if(storeURL&&storeToken)store=createSharedRuntimeStore({url:storeURL,token:storeToken,namespace:env.MODEL_BUDGET_NAMESPACE||'infinite-stadium',fetcher:storeFetcher});
 const unavailable=()=>{throw new GenerationError('Shared runtime storage must be connected before AI access is available.',503,'shared-storage-unavailable');};
 const sharedBudget=store?store.budget(settings.dailyModelCalls):{durable:true,kind:'shared-unavailable',snapshot:unavailable,take:unavailable};
 const sharedAccess=store?store.access(settings):{status:()=>false,isAuthorized:()=>false,authenticate:unavailable,clear:unavailable};
 // No listener is opened: Vercel owns the socket. The same application routes
 // and asset allowlist are retained, including the streaming match endpoint.
 const server=createServer({env:runtime,fetcher,sharedBudget,sharedAccess});
 const listener=server.listeners('request')[0];
 return async(req,res)=>{
  // Vercel may have parsed the body already. Preserve the ordinary raw-stream
  // path too, so the application's existing size/content checks still apply.
  let request=req;
  if(req.body!==undefined&&['POST','PUT','PATCH'].includes(req.method)){
   const body=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));
   if(body.length>262144){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Request is too large.'}));return;}
   request=Object.assign(Readable.from([body]),{headers:req.headers,url:req.url,method:req.method,socket:req.socket});
  }
  return new Promise((resolve,reject)=>{
   res.once('finish',resolve);res.once('close',resolve);
   Promise.resolve(listener(request,res)).catch(reject);
  });
 };
}
let handler;
export default function vercelHandler(req,res){
 try{handler??=createVercelHandler();return handler(req,res);}catch{
  res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Deployment configuration is incomplete.'}));
 }
}
