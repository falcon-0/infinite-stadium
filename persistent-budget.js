import {openSync,closeSync,readSync,writeFileSync,readFileSync,fsyncSync,renameSync,unlinkSync,mkdirSync,lstatSync,fstatSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {GenerationError} from './ai.js';

const unavailable=()=>new GenerationError('Persistent model-call budget is unavailable.',503);
// Windows scanners may briefly hold a file without delete sharing. Retry only
// a bounded storage operation, never a reservation or acquisition of a lock.
const storagePause=new Int32Array(new SharedArrayBuffer(4));
function retrySharing(action){
 for(let attempt=0;;attempt++){
  try{return action();}catch(error){
   if(attempt>=2||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;
   Atomics.wait(storagePause,0,0,10*(attempt+1));
  }
 }
}
function ownsFile(path,identity,nonce){
 const stat=lstatSync(path);
 return stat.isFile()&&!stat.isSymbolicLink()&&stat.dev===identity.dev&&stat.ino===identity.ino&&
  (nonce===undefined||readFileSync(path,'utf8')===nonce);
}
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
 Number.isFinite(Date.parse(value+'T00:00:00.000Z'))&&new Date(value+'T00:00:00.000Z').toISOString().slice(0,10)===value;

/** A same-filesystem request reservation, not a distributed or dollar cap.
 * A crashed process may leave a lock: recovery is explicit, never guessed.
 * The caller must enforce its own permitted production path scope.
 */
export function createPersistentModelBudget({limit,filename=resolve('.runtime/azure-model-budget.json'),clock=()=>new Date()}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>10000||typeof filename!=='string'||!filename||typeof clock!=='function')throw unavailable();
 const file=resolve(filename),lock=file+'.lock';let latestDay='';
 function today(){
  let date;try{date=clock();}catch{throw unavailable();}
  if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw unavailable();
  const day=date.toISOString().slice(0,10);
  if(!validDay(day)||day<latestDay)throw unavailable();
  latestDay=day;return day;
 }
 function ledger(){
  let descriptor;
  try{
   let stat;try{stat=lstatSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw unavailable();
   descriptor=openSync(file,'r');const actual=fstatSync(descriptor);
   if(!actual.isFile()||actual.size>4096)throw unavailable();
   const bytes=Buffer.alloc(4097),length=readSync(descriptor,bytes,0,bytes.length,0);
   if(length>4096)throw unavailable();
   const value=JSON.parse(bytes.subarray(0,length).toString('utf8'));
   if(!value||Array.isArray(value)||Object.keys(value).length!==3||value.version!==1||!validDay(value.day)||
    !Number.isSafeInteger(value.calls)||value.calls<0)throw unavailable();
   return value;
  }catch{throw unavailable();}finally{if(descriptor!==undefined)try{closeSync(descriptor);}catch{}}
 }
 function state(day,value){
  if(value&&value.day>day)throw unavailable();
  if(value&&value.day>latestDay)latestDay=value.day;
  return {day,calls:value?.day===day?value.calls:0,limit};
 }
 function snapshot(){return state(today(),ledger());}
 function take(){
  const day=today(),nonce=randomBytes(16).toString('hex');let descriptor,ownedStat,temp,temporaryDescriptor,temporaryStat;
  try{
   mkdirSync(dirname(file),{recursive:true});
   descriptor=openSync(lock,'wx',0o600);ownedStat=fstatSync(descriptor);
   writeFileSync(descriptor,nonce,'utf8');fsyncSync(descriptor);
   const current=state(day,ledger());
   if(current.calls>=limit)throw new GenerationError('Daily model-call limit reached.',429);
   temp=file+'.tmp-'+nonce;temporaryDescriptor=openSync(temp,'wx',0o600);temporaryStat=fstatSync(temporaryDescriptor);
   writeFileSync(temporaryDescriptor,JSON.stringify({version:1,day,calls:current.calls+1})+'\n','utf8');
   fsyncSync(temporaryDescriptor);closeSync(temporaryDescriptor);temporaryDescriptor=undefined;
   retrySharing(()=>{
    if(!ownsFile(lock,ownedStat,nonce)||!ownsFile(temp,temporaryStat))throw unavailable();
    renameSync(temp,file);
   });temp=undefined;
  }catch(error){if(error instanceof GenerationError&&error.status===429)throw error;throw unavailable();}
  finally{
   if(temporaryDescriptor!==undefined){try{closeSync(temporaryDescriptor);}catch{}}
   if(temp&&temporaryStat){try{retrySharing(()=>{if(ownsFile(temp,temporaryStat))unlinkSync(temp);});}catch{}}
   if(descriptor!==undefined){
    // Close our handle before unlink: on Windows an open handle can keep a
    // deleted name pending. The existing path continues to serialize callers.
    try{closeSync(descriptor);}catch{}
    // Never remove another process's lock, including a replaced lock path.
    if(ownedStat)try{retrySharing(()=>{if(ownsFile(lock,ownedStat,nonce))unlinkSync(lock);});}catch{}
   }
  }
 }
 return {take,snapshot};
}
