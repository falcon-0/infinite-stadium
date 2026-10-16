import {timingSafeEqual} from 'node:crypto';
import {GenerationError} from './ai.js';

export function serverSettings(env={}){
 const host=env.HOST||'127.0.0.1',port=Number(env.PORT||4173),publicHost=!['127.0.0.1','localhost','::1'].includes(host);
 if(!['127.0.0.1','localhost','::1','0.0.0.0'].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid server host or port.');
 const token=env.APP_ACCESS_TOKEN||null;
 if(publicHost&&(!token||token.length<32))throw new Error('Public binding requires APP_ACCESS_TOKEN with at least 32 characters.');
 if(publicHost&&!env.PUBLIC_ORIGIN)throw new Error('Public binding requires an HTTPS PUBLIC_ORIGIN.');
 const origins=[`http://localhost:${port}`,`http://127.0.0.1:${port}`];
 for(const value of [env.PUBLIC_ORIGIN,env.PUBLIC_DEPLOYMENT_ORIGIN].filter(Boolean)){const url=new URL(value);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('PUBLIC_ORIGIN must be an HTTPS origin.');if(!origins.includes(url.origin))origins.push(url.origin);}
 const dailyModelCalls=Number(env.MAX_DAILY_MODEL_CALLS||100);
 if(!Number.isInteger(dailyModelCalls)||dailyModelCalls<1||dailyModelCalls>10000)throw new Error('Invalid daily model-call limit.');
 return {host,port,token,origins,dailyModelCalls,publicHost};
}
export function authorized(header,token){
 if(!token)return true;
 if(typeof header!=='string'||!header.startsWith('Bearer '))return false;
 const received=Buffer.from(header.slice(7)),expected=Buffer.from(token);
 return received.length===expected.length&&timingSafeEqual(received,expected);
}
export function modelBudget(limit,clock=()=>new Date()){
 let day='',calls=0;
 return {take(){const today=clock().toISOString().slice(0,10);if(today!==day){day=today;calls=0;}if(calls>=limit)throw new GenerationError('Daily model-call limit reached.',429);calls++;},snapshot(){return {day,calls,limit};}};
}
