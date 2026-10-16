/** Factor identical schema subtrees into local definitions. No constraint is
 * removed. The expanded schema is byte-for-byte structurally equivalent. */
export function compactRepeatedSchema(input){
 const root=structuredClone(input),counts=new Map(),nodes=new Map();
 const walk=value=>{
  if(Array.isArray(value)){value.forEach(walk);return;}
  if(!value||typeof value!=='object')return;
  if((value.type||value.anyOf)&&!value.$ref){const id=JSON.stringify(value);if(id.length>=180){counts.set(id,(counts.get(id)||0)+1);nodes.set(id,value);}}
  Object.values(value).forEach(walk);
 };
 walk(root);
 const repeated=[...counts].filter(([,count])=>count>1).sort((a,b)=>b[0].length-a[0].length);
 if(!repeated.length)return root;
 const names=new Map(),existing=new Set(Object.keys(root.$defs||{}));let next=0;
 for(const [id]of repeated){let name;do{name='sharedQuerySchema'+next++;}while(existing.has(name));existing.add(name);names.set(id,name);}
 const rewrite=(value,own=null)=>{
  if(Array.isArray(value))return value.map(item=>rewrite(item,own));
  if(!value||typeof value!=='object')return value;
  const id=JSON.stringify(value),name=names.get(id);
  if(name&&id!==own)return {$ref:'#/$defs/'+name};
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewrite(item,own)]));
 };
 const result=rewrite(root);
 result.$defs={...(result.$defs||{}),...Object.fromEntries([...names].map(([id,name])=>[name,rewrite(nodes.get(id),id)]))};
 return result;
}
