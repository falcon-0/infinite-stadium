const NS='http://www.w3.org/2000/svg';
// View-only football markers. These do not alter received frames or measurements.
export function drawPitchPlayers(layer,frame,{selected=false,participants=[],names={},focusId=null,storyPlayerId=null,tracker=false}={}){
 const add=(tag,attrs,parent=layer)=>{const node=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,value);parent.append(node);return node;};
 const markers=new Map();
 const playerIds=frame.players.map(player=>player.id);
 const initialFocus=[focusId,storyPlayerId,frame.ballState?.ownerId,...playerIds].find(id=>playerIds.includes(id));
 // Focusable player descriptions remain available alongside the overall pitch
 // description; an image role would flatten those descendants for assistive tech.
 layer.ownerSVGElement?.setAttribute?.('role','group');
 layer.ownerSVGElement?.setAttribute?.('aria-description','Use arrow keys to move through players in roster order, Home or End for the first or last player, and Tab to leave the pitch.');
 // Scale the drawing, never the received position. One SVG measurement serves
 // every marker and is refreshed during painting so a resized field stays legible.
 const displayScales=()=>{
  const svg=layer.ownerSVGElement;
 let width,height;
  try{const bounds=svg?.getBoundingClientRect?.();width=bounds?.width;height=bounds?.height;}catch{/* Detached or non-layout DOM: use authored marker sizes. */}
  const viewWidth=svg?.viewBox?.baseVal?.width||1110;
  if(!Number.isFinite(width)||width<=0)return {player:1,label:1,ball:1};
  const viewHeight=svg?.viewBox?.baseVal?.height||720;
  const pixelsPerUnit=Number.isFinite(height)&&height>0?Math.min(width/viewWidth,height/viewHeight):width/viewWidth;
  const scale=(target,size,limit)=>Math.max(1,Math.min(limit,target/(size*pixelsPerUnit)));
  return {player:scale(26,34,2.85),label:scale(11,14,3),ball:scale(10,tracker?18:14,3)};
 };
 for(const player of frame.players){
  const relevant=!selected||participants.includes(player.id)||player.id===focusId;
  const name=names[player.id]||player.name||'';
  const identity=`${name||'Player'}, ${player.team==='home'?'home':'away'} team, number ${player.number}`;
  const group=add('g',{'data-player-marker':player.id,opacity:relevant?1:.28,tabindex:player.id===initialFocus?0:-1,role:'img','aria-label':identity});
  const title=add('title',{},group);title.textContent=identity;
  add('ellipse',{cx:0,cy:12,rx:15,ry:6,fill:'#04080b',opacity:.3},group);
  const halo=add('circle',{cx:0,cy:0,r:23,fill:'none',stroke:player.id===storyPlayerId||player.id===focusId?'#79c79e':'#fff','stroke-width':2,'stroke-dasharray':player.id===storyPlayerId?'5 4':'none',opacity:0},group);
  add('path',{d:'M-7-13 L-17-7 L-12 1 L-8-1 L-8 13 L8 13 L8-1 L12 1 L17-7 L7-13 L3-10 L-3-10 Z',fill:player.team==='home'?'#ceff22':'#ff438d',stroke:player.team==='home'?'#ebff8f':'#ff9ec3','stroke-width':1.5,'stroke-linejoin':'round'},group);
  add('path',{d:'M-6 12 L-6 17 L-1 17 L0 13 L1 17 L6 17 L6 12',fill:player.team==='home'?'#202724':'#f6faf7'},group);
  const number=add('text',{x:0,y:5,'text-anchor':'middle',fill:player.team==='home'?'#142117':'#fff','font-size':14,'font-weight':700,'font-family':'Arial, sans-serif'},group);number.textContent=player.number;
  const label=add('g',{'data-player-label':player.id,'pointer-events':'none','aria-hidden':'true'});
  const text=player.id===storyPlayerId?`Story: ${name}`:name;
  const labelBox=add('rect',{x:-Math.min(100,text.length*3.7+9),y:-13,width:Math.min(200,text.length*7.4+18),height:23,rx:5,fill:'#151b18',opacity:.96},label);
  const labelText=add('text',{x:0,y:3,'text-anchor':'middle',fill:'#fff','font-size':14,'font-family':'Arial, sans-serif'},label);labelText.textContent=text;
  const marker={group,label,halo,name,identity,relevant,labelText,labelBox,hovered:false,focused:false,showName:!!text&&(selected&&participants.includes(player.id)||player.id===focusId||player.id===storyPlayerId)};
  markers.set(player.id,marker);
  const identify=(key,value)=>{marker[key]=value;if(value)layer.append(label);paint(lastPose);};
  group.addEventListener('pointerenter',()=>identify('hovered',true));
  group.addEventListener('pointerleave',()=>identify('hovered',false));
  group.addEventListener('focus',()=>{
   for(const [id,item] of markers)item.group.setAttribute('tabindex',id===player.id?0:-1);
   identify('focused',true);
  });
  group.addEventListener('blur',()=>identify('focused',false));
  group.addEventListener('pointerdown',()=>group.focus?.({preventScroll:true}));
  group.addEventListener('keydown',event=>{
   if(event.altKey||event.ctrlKey||event.metaKey)return;
   const index=playerIds.indexOf(player.id),last=playerIds.length-1;
   const next=event.key==='Home'?0:event.key==='End'?last:['ArrowRight','ArrowDown'].includes(event.key)?(index+1)%playerIds.length:['ArrowLeft','ArrowUp'].includes(event.key)?(index+last)%playerIds.length:null;
   if(next===null)return; // Tab keeps its normal path to the next page control.
   event.preventDefault();markers.get(playerIds[next])?.group.focus?.({preventScroll:true});
  });
 }
 const trail=tracker?add('line',{stroke:'#fff','stroke-width':4,'stroke-linecap':'round',opacity:0}):null;let previousBall=null;
 const ballShadow=add('ellipse',{cx:0,cy:0,rx:8,ry:4,fill:'#000',opacity:.35});
 const ball=add('g',{'data-ball-marker':''});
 if(tracker)add('circle',{cx:0,cy:0,r:15,fill:'#fff',opacity:.16},ball);
 add('circle',{cx:0,cy:0,r:tracker?9:7,fill:'#fff',stroke:'#202522','stroke-width':1.3},ball);
 add('path',{d:'M0-3 L3-1 L2 3 L-2 3 L-3-1 Z',fill:'#202522'},ball);
 // Paint identities above every shirt and the ball. Labels cannot intercept
 // pointer events, so revealing one never interrupts hovering its player.
 for(const marker of markers.values())layer.append(marker.label);
 let lastPose=frame;
 function paint(pose){
  lastPose=pose;
  const scales=displayScales();
  for(const player of pose.players){
   const marker=markers.get(player.id);if(!marker)continue;
   marker.group.setAttribute('transform',`translate(${player.x*10} ${player.y*10})${Number.isFinite(player.displayDiveAngle)?` rotate(${player.displayDiveAngle})`:pose.ballState?.saveKeeperId===player.id?' rotate(-55)':''} scale(${scales.player})`);
   const carrier=!selected&&pose.ballState?.ownerId===player.id;
   const inspected=marker.hovered||marker.focused;
   const caption=inspected?`${carrier?'Ball: ':''}${marker.name||'Player'} · ${player.team==='home'?'Home':'Away'} #${player.number}`:player.id===storyPlayerId?`Story: ${marker.name}`:carrier?`Ball: ${marker.name}`:marker.name;
   marker.group.setAttribute('aria-label',`${marker.identity}${carrier?', with the ball':''}`);
   marker.group.setAttribute('opacity',marker.relevant||inspected?1:.28);
   if(marker.labelText.textContent!==caption){marker.labelText.textContent=caption;const half=Math.min(100,caption.length*3.7+9);marker.labelBox.setAttribute('x',-half);marker.labelBox.setAttribute('width',half*2);}
   const half=Math.min(100,caption.length*3.7+9),edge=half*scales.label+6;
   const labelX=Math.max(edge,Math.min(1050-edge,player.x*10));
   const labelY=Math.max(13*scales.label+6,Math.min(680-10*scales.label-6,player.y*10-32*scales.player));
   marker.label.setAttribute('transform',`translate(${labelX} ${labelY}) scale(${scales.label})`);
   // Long names fit their label instead of spilling beyond the measured box.
   if(caption.length*7.4>182){marker.labelText.setAttribute('textLength',182);marker.labelText.setAttribute('lengthAdjust','spacingAndGlyphs');}
   else{marker.labelText.removeAttribute?.('textLength');marker.labelText.removeAttribute?.('lengthAdjust');}
   marker.label.setAttribute('visibility',marker.showName||carrier||inspected?'visible':'hidden');
   marker.halo.setAttribute('opacity',inspected||player.id===storyPlayerId||player.id===focusId ? .9 : carrier ? .65 : 0);
  }
  if(trail){
   const current={x:pose.ball.x*10,y:pose.ball.y*10},dx=previousBall?current.x-previousBall.x:0,dy=previousBall?current.y-previousBall.y:0,distance=Math.hypot(dx,dy);
   const flight=['pass-flight','shot-flight','rebound-flight'].includes(pose.ballState?.kind);
   trail.setAttribute('opacity',flight&&distance>.05&&distance<40?.5:0);
   if(distance>.05){const length=Math.min(28,distance*4);trail.setAttribute('x1',current.x-dx/distance*length);trail.setAttribute('y1',current.y-dy/distance*length);trail.setAttribute('x2',current.x);trail.setAttribute('y2',current.y);}
   previousBall=current;
  }
  const height=Math.max(0,Math.min(6,pose.ball.height||0));
  ballShadow.setAttribute('transform',`translate(${pose.ball.x*10} ${pose.ball.y*10+6}) scale(${scales.ball*(1+height*.08)})`);
  ballShadow.setAttribute('opacity',.35-height*.03);
  ball.setAttribute('transform',`translate(${pose.ball.x*10} ${pose.ball.y*10-height*8}) scale(${scales.ball*(1+height*.04)})`);
 }
 paint.refresh=()=>paint(lastPose);
 paint(frame);return paint;
}
