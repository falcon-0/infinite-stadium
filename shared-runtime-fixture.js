// Test-only REST simulator; never a production storage fallback.
export function memoryRedis(){
 const values=new Map();let outage=false;
 const fetcher=async(_url,options)=>{
  if(outage)throw new Error('simulated connection loss');
  const [cmd,...args]=JSON.parse(options.body);let result=null;
  if(cmd==='GET')result=values.get(args[0])??null;
  if(cmd==='HGET')result=values.get(args[0])?.get(args[1])??null;
  if(cmd==='HDEL')result=values.get(args[0])?.delete(args[1])?1:0;
  if(cmd==='EVAL'){
   const [script,_keys,key,...argv]=args;
   if(script.includes('HGETALL')){
    const sessions=values.get(key)||new Map(),[now,id,expiry]=argv;
    for(const [id,time] of sessions)if(Number(time)<=Number(now))sessions.delete(id);
    if(sessions.has(id))result=0;
    else {if(sessions.size>=16)sessions.delete([...sessions].sort((a,b)=>Number(a[1])-Number(b[1]))[0][0]);sessions.set(id,expiry);values.set(key,sessions);result=1;}
   }else{
    const current=values.get(key)??'0',n=Number(current),limit=Number(argv[0]);
    result=!Number.isSafeInteger(n)||n<0?-2:n>=limit?-1:n+1;if(result>0)values.set(key,String(result));
   }
  }
  return {ok:true,json:async()=>({result})};
 };
 return {fetcher,values,setOutage:value=>{outage=value;}};
}
