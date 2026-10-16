import {numericAssertions} from './question-evidence-check.js';

// Quantities belong in selected verified observations. An optional explanation
// may discard a leading numeric preamble before independent semantic review.
// This proves nothing about the discarded text and never invents replacement
// prose. Keep false-premise corrections and single-sentence answers intact.
export function omitLeadingCountProse(claim,{proofs=[],contradicted=false}={}){
 const unchanged=()=>({claim:{...claim},normalization:null});
 if(contradicted)return unchanged();
 const protectedText=claim.text.replace(/\b(\p{Lu})\.(?=\s*\p{L})/gu,'$1\uE000');
 const sentences=protectedText.split(/(?<=[.!?])\s+/u).map(text=>text.replace(/\uE000/g,'.'));
 const quantities=text=>numericAssertions({claims:[{kind:'interpretation',text}]}).length>0;
 if(claim.kind==='limitation'&&proofs.some(proof=>{const event=proof.kind==='event'?proof:proof.kind==='ordered-event'?proof.event:null;return event?.eventId&&Number.isFinite(event.time);})&&sentences.length>1){
  // A limitation may accidentally repeat the selected action before stating
  // what is unknown. Remove only that timed preamble; never certify its text.
  const first=sentences[0],rest=sentences.slice(1).join(' ').trim();
  if(/\b\d{1,2}:\d{2}\b/.test(first)&&/\b(?:shot|shoots?|pass(?:ed|es)?|saved|scored|recovered)\b/i.test(first)&&
   /\b(?:not|cannot|can't|unknown|unavailable|unrecorded|unclear)\b/i.test(rest)&&/\b(?:reason|why|option|intent|motive|position|record|measur)\w*\b/i.test(rest)&&
   !quantities(rest)&&/[.!?]$/.test(rest))return {claim:{...claim,text:rest},normalization:{method:'omit-leading-timed-action-before-reviewed-limitation',originalText:claim.text,removedText:first,retainedText:rest,removedTextVerified:false}};
 }
 if(claim.kind!=='interpretation'||!proofs.some(proof=>['count','shooting-profile','opponent-count','confirmed-score'].includes(proof.kind)))return unchanged();
 let end=0;while(end<sentences.length&&quantities(sentences[end]))end++;
 if(!end||end===sentences.length||sentences.slice(end).some(quantities))return unchanged();
 const text=sentences.slice(end).join(' ').trim();
 if(!text||!/[.!?]$/.test(text))return unchanged();
 return {claim:{...claim,text},normalization:{method:'omit-leading-quantitative-prose-before-review',originalText:claim.text,removedText:sentences.slice(0,end).join(' '),retainedText:text,removedTextVerified:false}};
}
