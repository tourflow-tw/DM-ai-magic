(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = {
    image: null, imageUrl: '', filename: '', width: 0, height: 0,
    elements: [], selected: null, zoom: .5, guides: true,
    history: [], future: [], ocrRunning: false, drag: null,
    mode: 'select', drawDrag: null, pendingRect: null,
  };
  let nextId = 1;
  let sourcePixels = null;
  let toastTimeout;
  let deferredInstallPrompt = null;
  const fields = ['textValue', 'fontFamily', 'fontSize', 'fontWeight', 'textColor', 'rotation', 'xPos', 'yPos', 'widthValue', 'opacityValue', 'coverOriginal', 'coverColor'];

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => $('toast').classList.remove('show'), 3200);
  }
  function status(message) { $('bottomStatus').textContent = message; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function selected() { return state.elements.find(e => e.id === state.selected) || null; }
  function deepCopy(list) { return JSON.parse(JSON.stringify(list)); }
  function checkpoint() {
    state.history.push(deepCopy(state.elements));
    if (state.history.length > 50) state.history.shift();
    state.future = [];
    updateHistoryButtons();
  }
  function updateHistoryButtons() { $('undoBtn').disabled = !state.history.length; $('redoBtn').disabled = !state.future.length; }
  function undo() {
    if (!state.history.length) return;
    state.future.push(deepCopy(state.elements));
    state.elements = state.history.pop();
    if (!selected()) state.selected = null;
    updateAll(); updateHistoryButtons();
  }
  function redo() {
    if (!state.future.length) return;
    state.history.push(deepCopy(state.elements));
    state.elements = state.future.pop();
    if (!selected()) state.selected = null;
    updateAll(); updateHistoryButtons();
  }

  function setZoom(zoom) {
    state.zoom = clamp(zoom, .1, 3);
    $('pageFrame').style.width = `${Math.round(state.width * state.zoom)}px`;
    $('pageFrame').style.height = `${Math.round(state.height * state.zoom)}px`;
    $('page').style.width = `${state.width}px`;
    $('page').style.height = `${state.height}px`;
    $('page').style.transform = `scale(${state.zoom})`;
    $('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
  }
  function zoomAround(zoom, clientX, clientY) {
    if(!state.image) return;
    const scroller=$('stageScroller');
    const before=$('pageFrame').getBoundingClientRect();
    const sourceX=(clientX-before.left)/state.zoom;
    const sourceY=(clientY-before.top)/state.zoom;
    setZoom(zoom);
    const after=$('pageFrame').getBoundingClientRect();
    scroller.scrollLeft += after.left+sourceX*state.zoom-clientX;
    scroller.scrollTop += after.top+sourceY*state.zoom-clientY;
  }
  function zoomAtCenter(multiplier) {
    const rect=$('stageScroller').getBoundingClientRect();
    zoomAround(state.zoom*multiplier,rect.left+rect.width/2,rect.top+rect.height/2);
  }
  function fit() {
    if (!state.image) return;
    const target = $('stageScroller');
    const scale = Math.min(1, (target.clientWidth - 95) / state.width, (target.clientHeight - 75) / state.height);
    setZoom(Math.max(.1, scale));
  }

  function loadImage(src, filename) {
    const image = new Image();
    image.onload = () => {
      state.image = image;
      state.imageUrl = src;
      state.filename = filename;
      state.width = image.naturalWidth;
      state.height = image.naturalHeight;
      sourcePixels = null;
      state.elements = []; state.selected = null; state.history = []; state.future = [];
      closeMobileInspector();
      $('baseImage').src = src;
      $('baseImage').style.width = `${state.width}px`;
      $('baseImage').style.height = `${state.height}px`;
      $('fileLabel').textContent = filename;
      $('resolutionLabel').textContent = `${state.width} × ${state.height} px`;
      $('emptyState').hidden = true;
      $('stageScroller').scrollTop = 0; $('stageScroller').scrollLeft = 0;
      $('downloadBtn').disabled = false;
      updateAll(); fit();
      setMode('price');
      toast('圖片已載入！直接在舊金額上拖曳框選');
    };
    image.onerror = () => toast('圖片載入失敗，請改用 PNG 或 JPG');
    image.src = src;
  }
  function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('請上傳 JPG、PNG 或 WEBP 圖片');
    if (file.size > 35 * 1024 * 1024) return toast('圖片超過 35MB，請先縮小檔案');
    const reader = new FileReader();
    reader.onload = () => loadImage(reader.result, file.name);
    reader.readAsDataURL(file);
  }

  function sampleCover(box) {
    if (!sourcePixels) {
      const temp = document.createElement('canvas');
      temp.width = state.width; temp.height = state.height;
      const cx = temp.getContext('2d', { willReadFrequently: true });
      cx.drawImage(state.image, 0, 0);
      sourcePixels = cx.getImageData(0, 0, state.width, state.height).data;
    }
    const left = clamp(Math.floor(box.x0), 0, state.width - 1);
    const right = clamp(Math.ceil(box.x1), 0, state.width - 1);
    const top = clamp(Math.floor(box.y0), 0, state.height - 1);
    const bottom = clamp(Math.ceil(box.y1), 0, state.height - 1);
    const pixels = sourcePixels;
    const colors = []; const interval = Math.max(2, Math.round((right-left)/12));
    for (let x = left; x <= right; x += interval) {
      for (const y of [top-5, top-2, bottom+2, bottom+5]) {
        if (y < 0 || y >= state.height) continue;
        const ix = (y*state.width+x)*4;
        colors.push([pixels[ix], pixels[ix+1], pixels[ix+2]]);
      }
    }
    if (!colors.length) return '#ffffff';
    return `#${[0,1,2].map(channel=>Math.round(colors.reduce((acc,c)=>acc+c[channel],0)/colors.length).toString(16).padStart(2,'0')).join('')}`;
  }
  function textColorFor(background) {
    const r=parseInt(background.slice(1,3),16),g=parseInt(background.slice(3,5),16),b=parseInt(background.slice(5,7),16);
    return .2126*r+.7152*g+.0722*b<120?'#ffffff':'#1b2850';
  }
  function guessForeground(box, background) {
    sampleCover(box);
    const red=[];
    const step=Math.max(1,Math.round(Math.min(box.x1-box.x0,box.y1-box.y0)/40));
    for(let y=Math.max(0,Math.floor(box.y0));y<Math.min(state.height,box.y1);y+=step){
      for(let x=Math.max(0,Math.floor(box.x0));x<Math.min(state.width,box.x1);x+=step){
        const i=(y*state.width+x)*4,r=sourcePixels[i],g=sourcePixels[i+1],b=sourcePixels[i+2];
        if(r>95&&r>g*1.4&&r>b*1.27&&g<160)red.push([r,g,b]);
      }
    }
    if(red.length>5){
      const rgb=[0,1,2].map(n=>Math.round(red.reduce((acc,v)=>acc+v[n],0)/red.length));
      return '#'+rgb.map(n=>n.toString(16).padStart(2,'0')).join('');
    }
    return textColorFor(background);
  }
  function isRedPriceInk(x, y) {
    const i = (y * state.width + x) * 4;
    const r = sourcePixels[i], g = sourcePixels[i+1], b = sourcePixels[i+2];
    return r > 100 && r > g * 1.35 && r > b * 1.2 && g < 170;
  }
  // Work on the original pixels, never on the whole dragged rectangle: the latter
  // may contain the red heading, a border, NT(net), and a much smaller number.
  function detectPriceLayout(box) {
    sampleCover(box);
    const x0 = clamp(Math.floor(box.x0), 0, state.width - 1);
    const x1 = clamp(Math.ceil(box.x1), 0, state.width);
    const y0 = clamp(Math.floor(box.y0), 0, state.height - 1);
    const y1 = clamp(Math.ceil(box.y1), 0, state.height);
    const width = x1-x0, height = y1-y0;
    if(width < 15 || height < 8) return null;
    const counts = new Array(height).fill(0);
    for(let y=y0; y<y1; y++) for(let x=x0; x<x1; x++) if(isRedPriceInk(x,y)) counts[y-y0]++;

    // Ignore a saturated, solid-color heading (e.g. the red 「優惠價」 bar).
    let searchTop = y0, denseStart = -1;
    for(let i=0; i<height; i++) {
      if(width >= 55 && counts[i] > width*.68) {
        if(denseStart < 0) denseStart = i;
      } else if(denseStart >= 0) {
        if(i-denseStart >= 3 && denseStart < height*.72) searchTop = y0+i+1;
        denseStart = -1;
      }
    }
    if(denseStart >= 0 && height-denseStart >= 3 && denseStart < height*.72) searchTop = y1;

    // Find the dominant line of red print below the heading.
    let bands = [], active = null;
    for(let y=searchTop; y<y1; y++) {
      const count=counts[y-y0];
      if(count < 2 || count > width*.68) continue;
      if(!active || y-active.end > 3) {
        active={start:y,end:y,ink:0};bands.push(active);
      }
      active.end=y;active.ink+=count;
    }
    bands=bands.filter(b=>b.end-b.start>=6);
    bands.sort((a,b)=>(b.ink*(b.end-b.start+1))-(a.ink*(a.end-a.start+1)));
    const band=bands[0];
    if(!band) return null;
    const columns=[];let maxSpan=0;
    for(let x=x0; x<x1; x++) {
      let top=Infinity,bottom=-1,ink=0;
      for(let y=band.start; y<=band.end; y++) {
        if(counts[y-y0]>width*.68 || !isRedPriceInk(x,y)) continue;
        top=Math.min(top,y);bottom=Math.max(bottom,y);ink++;
      }
      const span=bottom>=top?bottom-top+1:0;
      columns.push({x,top,bottom,ink,span});
      maxSpan=Math.max(maxSpan,span);
    }
    if(maxSpan<8) return null;
    // Big digits have much taller strokes than the preceding NT(net) and 「起」.
    const digits=columns.filter(c=>c.ink>=3 && c.span>=maxSpan*.59);
    if(digits.length<7)return null;
    let first=digits[0].x,last=digits[digits.length-1].x,top=Infinity,bottom=-1;
    for(const c of columns) if(c.x>=first-2 && c.x<=last+2 && c.ink) {
      top=Math.min(top,c.top);bottom=Math.max(bottom,c.bottom);
    }
    const amount={x0:Math.max(x0,first-2),x1:Math.min(x1,last+3),y0:Math.max(band.start,top-2),y1:Math.min(band.end+3,bottom+3)};
    if(amount.x1-amount.x0<16 || amount.y1-amount.y0<8) return null;

    // Look for the smaller NT(net) immediately to the left of those digits.
    const before=columns.filter(c=>c.x<first-4 && c.ink>=2 && c.span>=5 && c.span<maxSpan*.72);
    let prefix=null;
    if(before.length) {
      const groups=[];let current=null;
      for(const c of before) {
        if(!current || c.x-current.x1>3) {current={x0:c.x,x1:c.x,top:c.top,bottom:c.bottom};groups.push(current);}
        else {current.x1=c.x;current.top=Math.min(current.top,c.top);current.bottom=Math.max(current.bottom,c.bottom);}
      }
      const start=groups[0]?.x0,end=groups[groups.length-1]?.x1;
      if(groups.length>=4 && end-start>=28 && end<first && first-end<16 && end-start<width*.65) {
        prefix={x0:Math.max(x0,start-2),x1:Math.min(x1,end+3),y0:Math.max(y0,Math.min(...groups.map(g=>g.top))-2),y1:Math.min(y1,Math.max(...groups.map(g=>g.bottom))+3)};
      }
    }
    return {amount,prefix};
  }
  function fittedPriceSize(text, width, inkHeight) {
    const ctx=document.createElement('canvas').getContext('2d');
    let size=clamp(Math.round(inkHeight*1.27),10,115);
    while(size>10) {
      ctx.font=`800 ${size}px Arial`;
      if(ctx.measureText(text).width<=width-2)break;
      size--;
    }
    return size;
  }
  function newElement(text, box, cover = false) {
    const base = { x0:box.x0, y0:box.y0, x1:box.x1, y1:box.y1 };
    const background = state.image ? sampleCover(base) : '#ffffff';
    const height = Math.max(14, box.y1 - box.y0);
    return {
      id:nextId++, text, x:box.x0, y:box.y0, width:Math.max(50,box.x1-box.x0+9),
      size:clamp(Math.round(height*.87),10,120), font:'Noto Sans TC, sans-serif', weight:'700',
      color:textColorFor(background), rotate:0, opacity:100,
      cover, coverColor:background, source:base, rendered:!cover,
    };
  }
  function coverRect(e) {
    if (!e.source) return null;
    return { x:clamp(e.source.x0-2,0,state.width), y:clamp(e.source.y0-2,0,state.height), width:Math.min(state.width-e.source.x0+2,e.source.x1-e.source.x0+4), height:e.source.y1-e.source.y0+5 };
  }
  function renderScene() {
    const maskLayer = $('maskLayer');
    const textLayer = $('textLayer');
    maskLayer.replaceChildren(); textLayer.replaceChildren();
    for (const e of state.elements) {
      if (e.rendered && e.cover && e.source) {
        const mask = document.createElement('div');
        mask.className = 'mask';
        const rect = coverRect(e);
        Object.assign(mask.style,{left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`,background:e.coverColor});
        maskLayer.append(mask);
      }
    }
    for (const e of state.elements) {
      const layer = document.createElement('div');
      layer.className = `text-object${e.id===state.selected?' selected':''}${e.rendered?'':' ocr-placeholder'}${e.kind==='price'?' price-object':''}${e.kind==='currency'?' currency-object':''}`;
      layer.dataset.id = e.id;
      layer.textContent = e.rendered ? (e.text || ' ') : '';
      layer.title = e.rendered ? '按兩下編輯文字' : `OCR 辨識：${e.text}。點選後可以修正。`;
      Object.assign(layer.style, {
        left:`${e.x}px`,top:`${e.y}px`,width:`${e.width}px`,minHeight:`${e.size*1.12}px`,
        fontSize:`${e.size}px`,fontFamily:e.font,fontWeight:e.weight,color:e.color,
        transform:`rotate(${e.rotate}deg)`,opacity:e.opacity/100,
      });
      layer.addEventListener('pointerdown',evt => beginDrag(evt,e.id));
      layer.addEventListener('dblclick',()=>{setSelected(e.id);$('textValue').focus();$('textValue').select();});
      textLayer.append(layer);
    }
    $('page').classList.toggle('show-guides',state.guides);
    $('layerCount').textContent = `${state.elements.length} 個文字圖層`;
    $('layerBadge').textContent = state.elements.length;
  }
  function renderLayers() {
    const area=$('layersList'); area.replaceChildren();
    if (!state.elements.length) {const d=document.createElement('div');d.className='layers-empty';d.textContent='修改金額後，圖層會出現在這裡';area.append(d);return;}
    for (const e of [...state.elements].reverse()) {
      const line=document.createElement('div');line.className=`layer-row${state.selected===e.id?' active':''}`;
      line.innerHTML='<div class="layer-glyph">T</div><span></span>';
      line.querySelector('.layer-glyph').textContent=e.kind==='price'?'＄':e.kind==='currency'?'NT':e.kind==='erase'?'×':'T';
      line.querySelector('span').textContent=e.kind==='erase'?'已清除的文字區塊':e.kind==='price'?`金額：${e.text}`:e.kind==='currency'?'已放大並靠近金額的 NT':(e.text||'（空白文字）');
      line.addEventListener('click',()=>setSelected(e.id));area.append(line);
    }
  }
  function showInspector() {
    const e=selected();
    $('properties').hidden=!e;$('noSelection').hidden=!!e;
    $('inspectorSubtitle').textContent=e?'正在編輯文字圖層':'選取文字即可調整';
    if (!e) return;
    const map = {textValue:e.text,fontFamily:e.font,fontSize:e.size,fontWeight:e.weight,textColor:e.color,rotation:e.rotate,xPos:Math.round(e.x),yPos:Math.round(e.y),widthValue:Math.round(e.width),opacityValue:e.opacity,coverColor:e.coverColor};
    for(const [id,val] of Object.entries(map)) $(id).value=val;
    $('coverOriginal').checked=e.cover;
    $('textColorValue').textContent=e.color.toUpperCase();$('coverColorValue').textContent=e.coverColor.toUpperCase();
  }
  function updateMobileEditButton() {
    $('mobileEditBtn').hidden=!selected()||$('inspector').classList.contains('mobile-open')||window.innerWidth>800;
  }
  function openMobileInspector() {
    if(!selected())return;
    $('inspector').classList.add('mobile-open');
    updateMobileEditButton();
  }
  function closeMobileInspector() {
    $('inspector').classList.remove('mobile-open');
    updateMobileEditButton();
  }
  function updateAll() {renderScene();renderLayers();showInspector();updateHistoryButtons();updateMobileEditButton();}
  function setSelected(id) {
    state.selected=id;
    if(id&&window.innerWidth<=800)openMobileInspector();
    else if(!id)closeMobileInspector();
    updateAll();
  }
  function mutateSelected(patch, inspector = false) {
    const e=selected();if(!e)return;
    if(!e.rendered && !Object.prototype.hasOwnProperty.call(patch,'cover')) {
      patch.rendered=true;
      if(e.source)patch.cover=true;
    }
    Object.assign(e,patch);
    renderScene();renderLayers();
    if(inspector)showInspector();
  }
  function beginDrag(event,id) {
    if(state.mode!=='select')return;
    if(event.button !== 0) return;
    event.stopPropagation(); event.preventDefault();
    const e=state.elements.find(item=>item.id===id);if(!e)return;
    if(state.selected!==id)setSelected(id);
    checkpoint();
    state.drag={id,startX:event.clientX,startY:event.clientY,originalX:e.x,originalY:e.y,moved:false};
    const node=event.currentTarget;
    node.setPointerCapture(event.pointerId);
    const move=(evt)=>{
      if(!state.drag)return;
      const dx=(evt.clientX-state.drag.startX)/state.zoom,dy=(evt.clientY-state.drag.startY)/state.zoom;
      e.x=clamp(Math.round(state.drag.originalX+dx),-e.width+10,state.width-10);
      e.y=clamp(Math.round(state.drag.originalY+dy),-e.size,state.height-5);
      state.drag.moved=true;
      node.style.left=`${e.x}px`;node.style.top=`${e.y}px`;
      $('xPos').value=Math.round(e.x);$('yPos').value=Math.round(e.y);
    };
    const stop=()=>{
      node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',stop);node.removeEventListener('pointercancel',stop);
      state.drag=null;renderLayers();
    };
    node.addEventListener('pointermove',move);node.addEventListener('pointerup',stop);node.addEventListener('pointercancel',stop);
  }

  function setMode(mode) {
    state.mode=mode;
    $('page').classList.toggle('drawing',mode!=='select');
    for(const [buttonId,value] of [['priceToolBtn','price'],['eraseToolBtn','erase'],['selectTool','select']]){
      $(buttonId).classList.toggle('active',mode===value);
    }
    for(const [buttonId,value] of [['mobilePriceBtn','price'],['mobileEraseBtn','erase'],['mobileSelectBtn','select']])
      $(buttonId).classList.toggle('active',mode===value);
    if(mode!=='select')closeMobileInspector();
    const instructions={
      price:'框住包含舊金額的價格欄，會自動找出數字大小；可連同 NT(net) 一起整理，免費使用。',
      erase:'在 net 或不想要的文字上拖出範圍，即可用背景色遮蓋。',
      select:'點選新增的文字圖層，可以拖曳位置與修改字體。',
    };
    $('toolHint').textContent=instructions[mode];
    if(state.image)status(instructions[mode]);
  }
  function drawPoint(evt) {
    const bounds=$('page').getBoundingClientRect();
    return {x:clamp(Math.round((evt.clientX-bounds.left)/state.zoom),0,state.width),
      y:clamp(Math.round((evt.clientY-bounds.top)/state.zoom),0,state.height)};
  }
  function previewSelection(box) {
    const el=$('selectionBox');el.hidden=false;
    Object.assign(el.style,{left:`${box.x0}px`,top:`${box.y0}px`,width:`${box.x1-box.x0}px`,height:`${box.y1-box.y0}px`});
  }
  function dismissSelection(){state.pendingRect=null;state.drawDrag=null;$('selectionBox').hidden=true;$('quickModal').hidden=true;}
  function onDrawStart(evt){
    if(state.mode==='select'||!state.image||evt.button!==0||(evt.pointerType==='touch'&&!evt.isPrimary))return;
    evt.preventDefault();evt.stopPropagation();
    const point=drawPoint(evt);
    state.drawDrag={start:point,current:point};
    $('page').setPointerCapture(evt.pointerId);
    previewSelection({x0:point.x,y0:point.y,x1:point.x,y1:point.y});
  }
  function onDrawMove(evt){
    if(!state.drawDrag)return;
    evt.preventDefault();
    state.drawDrag.current=drawPoint(evt);
    const {start,current}=state.drawDrag;
    previewSelection({x0:Math.min(start.x,current.x),y0:Math.min(start.y,current.y),x1:Math.max(start.x,current.x),y1:Math.max(start.y,current.y)});
  }
  function onDrawEnd(evt){
    if(!state.drawDrag)return;
    evt.preventDefault();
    const {start,current}=state.drawDrag;state.drawDrag=null;
    const rect={x0:Math.min(start.x,current.x),y0:Math.min(start.y,current.y),x1:Math.max(start.x,current.x),y1:Math.max(start.y,current.y)};
    if(rect.x1-rect.x0<9||rect.y1-rect.y0<6){dismissSelection();toast('請把舊金額完整框起來，範圍稍微大一點');return;}
    state.pendingRect=rect;
    if(state.mode==='erase'){
      insertPriceEdit('',true);
    }else{
      $('quickModal').hidden=false;
      $('quickPriceInput').value='';$('quickPriceInput').focus();
    }
  }
  function insertPriceEdit(value,erase=false) {
    const rect=state.pendingRect;
    if(!rect)return;
    if(!erase && /^\d{4,9}$/.test(value.replaceAll(',','')))
      value=Number(value.replaceAll(',','')).toLocaleString('en-US');
    const layout=erase?null:detectPriceLayout(rect);
    if(!erase&&!layout){
      toast('找不到清楚的紅色金額，請只框住數字與 NT(net) 附近再試一次');
      return;
    }
    checkpoint();
    if(!erase){
      // Reapplying to the same original price replaces that edit instead of
      // stacking a second amount or NT layer over the first one.
      const replaceIds=new Set(state.elements.filter(old=>old.kind==='price'&&old.source&&
        Math.abs((old.source.x0+old.source.x1)-(layout.amount.x0+layout.amount.x1))<layout.amount.x1-layout.amount.x0&&
        Math.abs((old.source.y0+old.source.y1)-(layout.amount.y0+layout.amount.y1))<layout.amount.y1-layout.amount.y0).map(old=>old.id));
      state.elements=state.elements.filter(old=>!replaceIds.has(old.id)&&!replaceIds.has(old.priceGroup));
    }
    const amountBox=erase?rect:layout.amount;
    const e=newElement(value,amountBox,true);
    e.kind=erase?'erase':'price';
    e.rendered=true;e.cover=true;
    e.width=Math.max(20,amountBox.x1-amountBox.x0);
    e.font='Arial, sans-serif';e.weight='800';
    e.size=erase?12:fittedPriceSize(value,e.width,amountBox.y1-amountBox.y0-4);
    e.x=amountBox.x0+1;
    e.y=erase?rect.y0:amountBox.y0-Math.round(e.size*.14);
    e.color=guessForeground(amountBox,e.coverColor);
    if(erase)e.width=rect.x1-rect.x0;
    state.elements.push(e);state.selected=e.id;
    let ntUpdated=false;
    if(!erase && $('quickTidyPrefix').checked && layout.prefix) {
      const nt=newElement('NT',layout.prefix,true);
      nt.kind='currency';nt.rendered=true;nt.cover=true;
      nt.priceGroup=e.id;
      nt.font='Arial, sans-serif';nt.weight='800';nt.color=e.color;
      nt.size=clamp(Math.round(e.size*.66),13,65);
      const ctx=document.createElement('canvas').getContext('2d');
      ctx.font=`800 ${nt.size}px Arial`;
      const ntWidth=Math.ceil(ctx.measureText('NT').width);
      nt.width=ntWidth+3;
      nt.x=Math.max(0,e.x-ntWidth-6);
      nt.y=Math.round(e.y+(e.size-nt.size)*.71);
      state.elements.push(nt);
      ntUpdated=true;
    }
    dismissSelection();setMode('select');updateAll();
    if(!erase){$('textValue').focus();toast(ntUpdated?'已定位金額，移除 net 並將 NT 放大靠近價格':'已根據舊數字大小放入新金額；可在右側微調');}
    else toast('已遮蓋指定文字；若顏色不合，可修改右側「遮蓋顏色」');
  }

  async function loadOcrLibrary() {
    if(window.Tesseract?.createWorker)return;
    const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
    await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>reject(new Error('無法下載 OCR 程式'));document.head.append(script);});
  }
  function extractLines(blocks) {
    const lines=[];
    for(const block of blocks||[]) for(const paragraph of block.paragraphs||[]) for(const line of paragraph.lines||[]) {
      const words=(line.words||[]).filter(w=>w.text?.trim());
      const content=(line.text||words.map(w=>w.text).join(' ')).trim();
      if(!content||!line.bbox)continue;
      if(typeof line.confidence==='number'&&line.confidence<24)continue;
      lines.push({text:content,bbox:line.bbox});
    }
    return lines;
  }
  async function startOcr() {
    if(!state.image)return toast('請先上傳圖片');
    if(state.ocrRunning)return;
    state.ocrRunning=true;$('ocrBtn').disabled=true;$('ocrBtn').textContent='辨識中，請稍候…';
    $('progressWrap').hidden=false;$('progressBar').style.width='2%';$('progressText').textContent='載入辨識引擎…';
    status('AI 辨識中，首次下載模型可能需要一點時間');
    let worker;
    try {
      await loadOcrLibrary();
      worker=await window.Tesseract.createWorker(['chi_tra','eng'],1,{logger:m=>{
        const progress=Math.round((m.progress||0)*100);
        $('progressBar').style.width=`${progress}%`;
        $('progressText').textContent=`${({loading:'載入資料',recognizing:'辨識文字',initializing:'初始化'})[m.status]||m.status||'辨識中'} ${progress}%`;
      }});
      const result=await worker.recognize(state.image,{}, {blocks:true});
      let lines=extractLines(result.data.blocks);
      if(!lines.length && result.data.words?.length)lines=result.data.words.filter(w=>w.text?.trim()&&w.bbox).map(w=>({text:w.text,bbox:w.bbox}));
      if(!lines.length)throw new Error('沒有找到帶位置資訊的文字，試試較清晰的圖片');
      checkpoint();
      state.elements=lines.slice(0,350).map(l=>newElement(l.text,{x0:l.bbox.x0,y0:l.bbox.y0,x1:l.bbox.x1,y1:l.bbox.y1},true));
      state.selected=null;
      updateAll();
      $('progressBar').style.width='100%';$('progressText').textContent='辨識完成';
      status(`已辨識 ${state.elements.length} 段文字 · 點選任一段開始修改`);
      toast(`成功建立 ${state.elements.length} 個可編輯文字圖層`);
    } catch(error) {
      console.error('OCR failed:',error);
      status('辨識失敗，可重新嘗試或手動新增文字');
      toast(`OCR 辨識失敗：${error.message||'請稍後重試'}`);
    } finally {
      if(worker)await worker.terminate().catch(()=>{});
      state.ocrRunning=false;$('ocrBtn').disabled=false;$('ocrBtn').textContent='✦ 重新辨識文字';
    }
  }
  function addText() {
    if(!state.image)return toast('請先上傳圖片');
    checkpoint();
    const x=Math.round(state.width*.28),y=Math.round(state.height*.25);
    const e=newElement('在這裡輸入文字',{x0:x,y0:y,x1:x+Math.min(450,state.width*.55),y1:y+45},false);
    e.size=Math.round(Math.min(36,state.width/24));e.color='#242947';e.weight='700';
    e.rendered=true;
    state.elements.push(e);state.selected=e.id;updateAll();
    $('textValue').focus();$('textValue').select();toast('已新增文字，右側可直接修改');
  }
  function exportPng() {
    if(!state.image)return toast('請先上傳圖片');
    const canvas=document.createElement('canvas');canvas.width=state.width;canvas.height=state.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(state.image,0,0);
    for(const e of state.elements)if(e.rendered&&e.cover&&e.source){const r=coverRect(e);ctx.fillStyle=e.coverColor;ctx.fillRect(r.x,r.y,r.width,r.height);}
    for(const e of state.elements){
      if(!e.rendered)continue;
      ctx.save();ctx.globalAlpha=e.opacity/100;ctx.translate(e.x,e.y);ctx.rotate(e.rotate*Math.PI/180);
      ctx.font=`${e.weight} ${e.size}px ${e.font}`;
      ctx.fillStyle=e.color;ctx.textBaseline='top';
      const lineHeight=e.size*1.15;
      if(e.kind==='price'||e.kind==='currency'){
        ctx.fillText(e.text,0,0,e.width);
        ctx.restore();
        continue;
      }
      let lines=[];
      for(const paragraph of e.text.split('\n')){
        if(!paragraph){lines.push('');continue;}
        let current='';
        for(const char of paragraph){
          if(ctx.measureText(current+char).width>e.width&&current){lines.push(current);current=char;}
          else current+=char;
        }
        lines.push(current);
      }
      lines.forEach((line,index)=>ctx.fillText(line,0,index*lineHeight));
      ctx.restore();
    }
    canvas.toBlob(blob=>{
      if(!blob)return toast('匯出圖片失敗');
      const url=URL.createObjectURL(blob);const a=document.createElement('a');
      const base=state.filename.replace(/\.[^.]+$/,'')||'design';a.download=`${base}_編輯版.png`;a.href=url;a.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);toast('已開始下載 PNG 圖片');
    },'image/png');
  }

  function bindFields(){
    const map={textValue:['text',v=>v],fontFamily:['font',v=>v],fontSize:['size',v=>clamp(Number(v)||12,6,400)],fontWeight:['weight',v=>v],textColor:['color',v=>v],rotation:['rotate',v=>Number(v)||0],xPos:['x',v=>Number(v)||0],yPos:['y',v=>Number(v)||0],widthValue:['width',v=>Math.max(10,Number(v)||10)],opacityValue:['opacity',v=>clamp(Number(v)||0,0,100)],coverOriginal:['cover',v=>v],coverColor:['coverColor',v=>v]};
    for(const id of fields){
      const input=$(id),[key,cast]=map[id];
      input.addEventListener('focus',()=>{if(selected())checkpoint();});
      input.addEventListener(id==='coverOriginal'?'change':'input',()=>{
        const value=id==='coverOriginal'?input.checked:input.value;
        mutateSelected({[key]:cast(value)});
        if(id==='textColor')$('textColorValue').textContent=value.toUpperCase();
        if(id==='coverColor')$('coverColorValue').textContent=value.toUpperCase();
      });
    }
  }
  function initEvents(){
    $('fileInput').addEventListener('change',evt=>{handleFile(evt.target.files?.[0]);evt.target.value='';});
    for(const id of ['uploadCard','emptyUploadBtn'])$(id).addEventListener('click',()=>$('fileInput').click());
    $('uploadCard').addEventListener('keydown',evt=>{if(evt.key==='Enter')$('fileInput').click();});
    $('fileLabel').addEventListener('click',()=>$('fileInput').click());
    $('fileLabel').style.cursor='pointer';
    $('demoBtn').addEventListener('click',()=>loadImage('./assets/demo-thailand-web.jpg','泰享樂_芭達雅曼谷_DM.jpg'));
    $('ocrBtn').addEventListener('click',startOcr);
    $('downloadBtn').addEventListener('click',exportPng);
    $('mobileUploadBtn').addEventListener('click',()=>$('fileInput').click());
    $('mobileDownloadBtn').addEventListener('click',exportPng);
    $('mobilePriceBtn').addEventListener('click',()=>setMode(state.mode==='price'?'select':'price'));
    $('mobileSelectBtn').addEventListener('click',()=>setMode('select'));
    $('mobileEraseBtn').addEventListener('click',()=>setMode(state.mode==='erase'?'select':'erase'));
    $('mobileEditBtn').addEventListener('click',openMobileInspector);
    $('mobileInspectorClose').addEventListener('click',closeMobileInspector);
    $('installPwaBtn').addEventListener('click',async()=>{
      if(deferredInstallPrompt){
        const prompt=deferredInstallPrompt;deferredInstallPrompt=null;
        await prompt.prompt();
        return;
      }
      $('installHelp').hidden=false;
    });
    $('installHelpClose').addEventListener('click',()=>$('installHelp').hidden=true);
    $('installHelp').addEventListener('click',event=>{if(event.target===$('installHelp'))$('installHelp').hidden=true;});
    $('undoBtn').addEventListener('click',undo);$('redoBtn').addEventListener('click',redo);
    $('zoomInBtn').addEventListener('click',()=>zoomAtCenter(1.25));
    $('zoomOutBtn').addEventListener('click',()=>zoomAtCenter(1/1.25));
    $('fitBtn').addEventListener('click',fit);
    $('toggleGuidesBtn').addEventListener('click',()=>{state.guides=!state.guides;renderScene();toast(state.guides?'已顯示文字邊框':'已隱藏文字邊框');});
    $('addTextBtn').addEventListener('click',addText);
    $('priceToolBtn').addEventListener('click',()=>setMode(state.mode==='price'?'select':'price'));
    $('eraseToolBtn').addEventListener('click',()=>setMode(state.mode==='erase'?'select':'erase'));
    $('selectTool').addEventListener('click',()=>setMode('select'));
    $('quickCancelBtn').addEventListener('click',dismissSelection);
    $('quickApplyBtn').addEventListener('click',()=>{
      const value=$('quickPriceInput').value.trim();
      if(!value)return toast('請輸入新的金額');
      insertPriceEdit(value);
    });
    $('quickPriceInput').addEventListener('keydown',evt=>{if(evt.key==='Enter'){evt.preventDefault();$('quickApplyBtn').click();}});
    $('page').addEventListener('pointerdown',onDrawStart);
    $('page').addEventListener('pointermove',onDrawMove);
    $('page').addEventListener('pointerup',onDrawEnd);
    $('page').addEventListener('pointercancel',dismissSelection);
    const scroller=$('stageScroller');
    let pinch=null;
    const distance=touches=>Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);
    scroller.addEventListener('touchstart',event=>{
      if(event.touches.length!==2)return;
      dismissSelection();
      const touches=event.touches;
      pinch={initialDistance:distance(touches),initialZoom:state.zoom};
    },{passive:true});
    scroller.addEventListener('touchmove',event=>{
      if(!pinch||event.touches.length!==2)return;
      event.preventDefault();
      const centerX=(event.touches[0].clientX+event.touches[1].clientX)/2;
      const centerY=(event.touches[0].clientY+event.touches[1].clientY)/2;
      zoomAround(pinch.initialZoom*distance(event.touches)/Math.max(1,pinch.initialDistance),centerX,centerY);
    },{passive:false});
    scroller.addEventListener('touchend',event=>{if(event.touches.length<2)pinch=null;},{passive:true});
    scroller.addEventListener('touchcancel',()=>pinch=null,{passive:true});
    $('deleteLayerBtn').addEventListener('click',()=>{
      if(!selected())return;checkpoint();state.elements=state.elements.filter(e=>e.id!==state.selected);state.selected=null;updateAll();toast('已刪除文字圖層');
    });
    $('clearTextBtn').addEventListener('click',()=>{
      if(!state.elements.length)return;
      if(!confirm('確定清空全部文字圖層？可以使用復原功能找回。'))return;
      checkpoint();state.elements=[];state.selected=null;updateAll();
    });
    $('page').addEventListener('pointerdown',evt=>{if(evt.target===$('page')||evt.target===$('baseImage'))setSelected(null);});
    ['dragover','drop'].forEach(kind=>document.addEventListener(kind,evt=>evt.preventDefault()));
    $('uploadCard').addEventListener('dragover',()=>$('uploadCard').classList.add('dragover'));
    $('uploadCard').addEventListener('dragleave',()=>$('uploadCard').classList.remove('dragover'));
    document.addEventListener('drop',evt=>{$('uploadCard').classList.remove('dragover');handleFile(evt.dataTransfer?.files?.[0]);});
    document.addEventListener('keydown',evt=>{
      if(evt.ctrlKey||evt.metaKey){
        if(evt.key.toLowerCase()==='z'){evt.preventDefault();evt.shiftKey?redo():undo();}
        if(evt.key.toLowerCase()==='y'){evt.preventDefault();redo();}
        return;
      }
      if(evt.key==='Escape'&&!$('quickModal').hidden){dismissSelection();return;}
      if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
      if((evt.key==='Delete'||evt.key==='Backspace')&&selected()){
        checkpoint();state.elements=state.elements.filter(e=>e.id!==state.selected);state.selected=null;updateAll();evt.preventDefault();
      }
      if(evt.key.toLowerCase()==='t'&&state.image)addText();
      if(evt.key.toLowerCase()==='p')setMode('price');
      if(evt.key.toLowerCase()==='e')setMode('erase');
      if(evt.key.toLowerCase()==='v')setMode('select');
      if(evt.key==='Escape'){dismissSelection();setMode('select');setSelected(null);}
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(evt.key)&&selected()){
        evt.preventDefault();checkpoint();const e=selected(),step=evt.shiftKey?10:1;
        if(evt.key==='ArrowLeft')e.x-=step;if(evt.key==='ArrowRight')e.x+=step;
        if(evt.key==='ArrowUp')e.y-=step;if(evt.key==='ArrowDown')e.y+=step;
        updateAll();
      }
    });
    window.addEventListener('resize',()=>{if(state.image)fit();if(window.innerWidth>800)closeMobileInspector();updateMobileEditButton();});
    window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;});
    window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;toast('已安裝到手機主畫面');});
    bindFields();
  }
  initEvents();
  $('downloadBtn').disabled=true;
  updateHistoryButtons();
  loadImage('./assets/demo-thailand-web.jpg','泰享樂_芭達雅曼谷_DM.jpg');
  if('serviceWorker' in navigator)
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(error=>console.info('PWA 快取暫時無法啟用',error)));
})();
