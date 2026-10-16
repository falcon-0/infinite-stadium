/** A reviewed package is immutable; corrections require a new human decision. */
export class ProductionDesk {
 constructor(){this.saved=null;this.current=null;this.approvedKey=null;this.checking=false;this.showing=false;this.invalidated=false;this.audit=[];}
 beginCheck(){this.checking=true;this.showing=false;}
 failCheck(){this.checking=true;this.showing=false;}
 receive(pkg){
  if(pkg?.schema!=='infinite-stadium.production-package.v1'||!pkg.key||pkg.outputs?.length!==3)throw new TypeError('Invalid production package.');
  this.current=structuredClone(pkg);this.checking=false;
  if(!this.saved){this.saved=structuredClone(pkg);return;}
  if(this.saved.key!==pkg.key){
   if(!this.invalidated)this.audit.push({action:'withdrawn',at:pkg.observedAt,key:this.saved.key,replacementKey:pkg.key});
   this.invalidated=true;this.showing=false;
  }
 }
 get status(){return this.checking?'checking':!this.saved?'empty':this.invalidated?'withdrawn':this.approvedKey===this.saved.key?'approved':'review';}
 reviewReplacement(){if(this.checking||!this.current)throw new Error('Wait for current evidence.');this.saved=structuredClone(this.current);this.approvedKey=null;this.invalidated=false;this.showing=false;}
 approve(reviewed){if(!reviewed||this.status!=='review'||this.saved.key!==this.current?.key)throw new Error('Review all three current outputs before approving.');this.approvedKey=this.saved.key;this.audit.push({action:'approved',at:this.current.observedAt,key:this.saved.key});}
 preview(){if(this.status!=='approved')throw new Error('Only a current approved package can enter preview.');this.showing=true;}
 get graphic(){return this.showing&&this.status==='approved'?this.saved:null;}
 export(){if(this.status!=='approved')throw new Error('Approve the current package before exporting.');return {schema:'infinite-stadium.graphics-package.v1',packageKey:this.saved.key,anchorId:this.saved.anchorId,eventTime:this.saved.eventTime,observedAt:this.current.observedAt,outputs:structuredClone(this.saved.outputs),humanReview:structuredClone(this.audit.at(-1)),timing:{type:'relative-review-preview',suggestedDurationSeconds:8},warning:'Review artifact only. Exported files cannot withdraw themselves after a correction.'};}
}
