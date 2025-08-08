/* 
  Gym Planner - Canvas edition
  - Fullscreen canvas UI
  - Week tabs at top
  - Scrollable list of Day/Exercise "blocks"
  - Drag to reorder
  - Checkmarks for completion
  - Preset library
  - Custom images via URL or file picker (stored base64 in localStorage)
  - Local persistence
  - Offline support (service worker)
*/

(() => {
  const DPR = window.devicePixelRatio || 1;
  const canvas = document.getElementById('app');
  const ctx = canvas.getContext('2d');
  const filePick = document.getElementById('filePick');

  // Register SW (for GitHub Pages + Add to Home Screen on iOS for borderless)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }

  // Theme
  const colors = {
    bg: '#0b0b12',
    panel: '#121225',
    card: '#191933',
    accent: '#7b6cff',
    accentSoft: '#2b2859',
    text: '#e7e7f1',
    textDim: '#b8b8cf',
    success: '#3ada8a',
    danger: '#ff667a',
    outline: 'rgba(255,255,255,0.08)',
    shadow: 'rgba(0,0,0,0.35)'
  };

  // Layout metrics
  const metrics = {
    tabH: 56,      // tabs bar height
    headerH: 18,   // secondary header below tabs
    padding: 14,
    cardH: 88,
    cardR: 14,
    cardGap: 10,
    checkbox: 22,
    btnH: 44,
    fabR: 28
  };

  // State
  let W = 0, H = 0;
  let contentScroll = 0;
  let touchStartY = 0;
  let dragItem = null; // {weekIndex, index, yOffset}
  let activeWeek = 0;
  const MAX_WEEKS = 8;

  // Simple preset images drawn procedurally onto canvas and kept as data URLs
  const iconCache = {};
  function makeIcon(key) {
    if (iconCache[key]) return iconCache[key];
    const c = document.createElement('canvas');
    c.width = 96; c.height = 96;
    const x = c.getContext('2d');
    x.fillStyle = '#0b0b12'; x.fillRect(0,0,96,96);
    // draw shapes by key
    x.strokeStyle = colors.accent; x.lineWidth = 6;
    x.lineCap = 'round';
    if (key === 'biceps') {
      x.beginPath();
      x.arc(48, 54, 24, 0.2*Math.PI, 1.2*Math.PI);
      x.stroke();
      x.beginPath();
      x.moveTo(48,30); x.lineTo(70,18);
      x.stroke();
    } else if (key === 'pullups') {
      x.beginPath(); x.moveTo(20,20); x.lineTo(76,20); x.stroke();
      x.beginPath(); x.moveTo(48,20); x.lineTo(48,70); x.stroke();
      x.beginPath(); x.arc(48,40,12,0,Math.PI*2); x.stroke();
    } else if (key === 'dumbbells') {
      x.beginPath();
      x.rect(20,38,16,20);
      x.rect(60,38,16,20);
      x.stroke();
      x.beginPath();
      x.moveTo(36,48); x.lineTo(60,48); x.stroke();
    } else if (key === 'legs') {
      x.beginPath();
      x.moveTo(30,30); x.lineTo(40,70); x.moveTo(66,30); x.lineTo(56,70);
      x.stroke();
    } else {
      x.fillStyle = colors.accent; x.beginPath(); x.arc(48,48,20,0,Math.PI*2); x.fill();
    }
    const url = c.toDataURL('image/png');
    iconCache[key] = url;
    return url;
  }

  // Data model
  function defaultWeek(i) {
    // 7 days with empty exercise lists
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    return {
      name: 'Week ' + (i+1),
      days: days.map(d => ({ day: d, items: [] }))
    };
  }

  const PRESETS = [
    { name:'Push A', img:'biceps', notes:'Chest/Triceps/Shoulders', items:[
      { title:'Bench Press', sets:4, reps:'6–10', weight:'', notes:'' },
      { title:'Incline DB Press', sets:3, reps:'8–12', weight:'', notes:'' },
      { title:'Tricep Dips', sets:3, reps:'AMRAP', weight:'', notes:'' },
    ]},
    { name:'Pull A', img:'pullups', notes:'Back/Biceps', items:[
      { title:'Pull-Ups', sets:4, reps:'6–10', weight:'', notes:'' },
      { title:'Barbell Row', sets:3, reps:'8–12', weight:'', notes:'' },
      { title:'Face Pulls', sets:3, reps:'12–15', weight:'', notes:'' },
    ]},
    { name:'Legs A', img:'legs', notes:'Quads/Hams/Glutes', items:[
      { title:'Back Squat', sets:4, reps:'5–8', weight:'', notes:'' },
      { title:'RDL', sets:3, reps:'6–10', weight:'', notes:'' },
      { title:'Walking Lunges', sets:3, reps:'10/leg', weight:'', notes:'' },
    ]},
    { name:'Dumbbell Full', img:'dumbbells', notes:'DB full body', items:[
      { title:'DB Shoulder Press', sets:3, reps:'8–12', weight:'', notes:'' },
      { title:'DB Row', sets:3, reps:'8–12', weight:'', notes:'' },
      { title:'Goblet Squat', sets:3, reps:'10–15', weight:'', notes:'' },
    ]}
  ];

  const STORAGE_KEY = 'gym_planner_canvas_v1';

  let data = loadData() || {
    weeks: Array.from({length:MAX_WEEKS}, (_,i)=>defaultWeek(i)),
    progress: {}, // key: itemId -> completed boolean
    images: {}    // key: customId -> dataURL
  };

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e) { console.warn(e); }
  }
  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  }

  // Utilities
  function uid() { return Math.random().toString(36).slice(2); }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

  // Resize & scale
  function resize() {
    W = Math.floor(window.innerWidth * DPR);
    H = Math.floor(window.innerHeight * DPR);
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = Math.floor(W / DPR) + 'px';
    canvas.style.height = Math.floor(H / DPR) + 'px';
    draw();
  }
  window.addEventListener('resize', resize);

  // Input handling
  let pointer = {x:0, y:0, down:false, id:null};
  canvas.addEventListener('pointerdown', (e)=>{
    pointer.down = true; pointer.id = e.pointerId;
    const rect = canvas.getBoundingClientRect();
    pointer.x = (e.clientX - rect.left) * DPR;
    pointer.y = (e.clientY - rect.top) * DPR;
    onPointerDown(pointer.x, pointer.y);
  });
  canvas.addEventListener('pointermove', (e)=>{
    if (pointer.id !== e.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = (e.clientX - rect.left) * DPR;
    pointer.y = (e.clientY - rect.top) * DPR;
    onPointerMove(pointer.x, pointer.y);
  });
  canvas.addEventListener('pointerup', (e)=>{
    if (pointer.id !== e.pointerId) return;
    pointer.down = false; pointer.id = null;
    onPointerUp();
  });
  canvas.addEventListener('wheel', (e)=>{
    contentScroll = clamp(contentScroll + e.deltaY * DPR, 0, Math.max(0, contentHeight()- (H - (metrics.tabH+metrics.headerH)*DPR)));
    draw();
  }, {passive:true});

  // Area bookkeeping for hit detection
  const hit = [];
  function clearHits(){ hit.length = 0; }
  function registerHit(rect, info){ hit.push({rect, info}); }
  function hitTest(x,y){
    for (let i=hit.length-1;i>=0;i--) {
      const h = hit[i], r=h.rect;
      if (x>=r.x && x<=r.x+r.w && y>=r.y && y<=r.y+r.h) return h.info;
    }
    return null;
  }

  // Drawing helpers
  function rrect(x,y,w,h,r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }
  function drawText(text, x,y, size, color, align='left', base='alphabetic', weight='400') {
    ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align; ctx.textBaseline = base;
    ctx.fillText(text, x,y);
  }
  function drawShadowedCard(x,y,w,h,r, fill) {
    ctx.save();
    ctx.shadowColor = colors.shadow; ctx.shadowBlur = 22; ctx.shadowOffsetY = 10;
    rrect(x,y,w,h,r); ctx.fillStyle = fill; ctx.fill();
    ctx.restore();
  }

  // Content measurement
  function contentHeight() {
    const week = data.weeks[activeWeek];
    let h = 0;
    const P = metrics.padding*DPR;
    const cardH = metrics.cardH*DPR, gap = metrics.cardGap*DPR;

    week.days.forEach(day => {
      h += (cardH + gap);
      day.items.forEach(()=> { h += (cardH + gap); });
    });
    // controls area
    h += (metrics.btnH*DPR + gap)*2 + 120*DPR;
    return h + P*2;
  }

  // Render main
  function draw() {
    clearHits();
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = colors.bg; ctx.fillRect(0,0,W,H);

    const P = metrics.padding*DPR;
    const tabH = metrics.tabH*DPR, headerH = metrics.headerH*DPR;

    // Top tabs
    drawTabs(0,0,W,tabH);
    // Subheader
    drawSubHeader(0, tabH, W, headerH);

    // Content area (scrollable)
    const top = tabH + headerH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, W, H-top);
    ctx.clip();

    let y = top + P - contentScroll;

    const week = data.weeks[activeWeek];

    // Days + items
    week.days.forEach((day, dIndex) => {
      // Day header card
      y = drawDayCard(day.day, y, dIndex);

      // Exercises
      day.items.forEach((item, iIndex) => {
        y = drawExerciseCard(day, dIndex, item, iIndex, y);
      });
    });

    // Buttons: Add preset / Add custom
    y += P;
    y = drawButton(y, 'Add preset to selected day', () => openPresetPicker());
    y += P/2;
    y = drawButton(y, 'Add custom exercise to selected day', () => addCustomExercise());

    // Save indicator
    y += P;
    drawText('Saved automatically • Offline ready', P, y, 12*DPR, colors.textDim, 'left', 'alphabetic', '500');

    ctx.restore();

    // FABs (floating actions) - change day selection
    drawFABs();
  }

  // Tab bar
  function drawTabs(x,y,w,h) {
    drawShadowedCard(x, y, w, h, 0, colors.panel);
    const gap = 10*DPR, pad = 16*DPR;
    const pillH = h - 18*DPR;
    const pillR = pillH/2;

    let cursor = pad;
    for (let i=0;i<MAX_WEEKS;i++) {
      const label = `W${i+1}`;
      const tw = measure(label, 14*DPR, '600');
      const pillW = tw + 28*DPR;
      const isActive = i===activeWeek;

      ctx.globalAlpha = 1;
      rrect(cursor, y + (h-pillH)/2, pillW, pillH, pillR);
      ctx.fillStyle = isActive ? colors.accent : colors.accentSoft;
      ctx.fill();

      drawText(label, cursor + pillW/2, y+h/2+5, 14*DPR, colors.text, 'center', 'middle', '600');

      registerHit({x:cursor, y:y, w:pillW, h:h}, {type:'week-tab', index:i});
      cursor += pillW + gap;
    }
  }
  function measure(text, size, weight='400') {
    ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto`;
    return ctx.measureText(text).width;
  }

  function drawSubHeader(x,y,w,h) {
    // Secondary strip
    ctx.fillStyle = colors.panel;
    ctx.fillRect(x, y, w, h);
    drawText(data.weeks[activeWeek].name, x+16*DPR, y+h-4*DPR, 13*DPR, colors.textDim, 'left', 'alphabetic', '600');
  }

  // Day card
  function drawDayCard(label, y, dIndex) {
    const P = metrics.padding*DPR;
    const cardH = metrics.cardH*DPR;
    const r = metrics.cardR*DPR;

    drawShadowedCard(P, y, W-2*P, cardH, r, colors.card);
    drawText(label, P+18*DPR, y+28*DPR, 20*DPR, colors.text, 'left', 'alphabetic', '700');
    drawText('Tap + to add below', P+18*DPR, y+52*DPR, 12*DPR, colors.textDim);

    // Add item button (+)
    const bx = W - P - 42*DPR, by = y + cardH/2 - 18*DPR;
    rrect(bx, by, 42*DPR, 36*DPR, 12*DPR); ctx.fillStyle = colors.accent; ctx.fill();
    drawText('+', bx+21*DPR, by+24*DPR, 24*DPR, colors.text, 'center', 'alphabetic', '700');

    registerHit({x:bx, y:by, w:42*DPR, h:36*DPR}, {type:'add-item', dayIndex:dIndex});

    return y + cardH + metrics.cardGap*DPR;
  }

  // Exercise card
  function drawExerciseCard(day, dIndex, item, iIndex, y) {
    const P = metrics.padding*DPR;
    const cardH = metrics.cardH*DPR;
    const r = metrics.cardR*DPR;

    const topY = y;
    drawShadowedCard(P, y, W-2*P, cardH, r, colors.card);

    // Checkbox
    const cb = { x: P+16*DPR, y: y+18*DPR, s: metrics.checkbox*DPR };
    rrect(cb.x, cb.y, cb.s, cb.s, 6*DPR);
    ctx.fillStyle = colors.panel; ctx.fill();
    const key = item.id || (item.id = uid());
    const checked = !!data.progress[key];
    if (checked) {
      ctx.fillStyle = colors.success; rrect(cb.x, cb.y, cb.s, cb.s, 6*DPR); ctx.fill();
      drawText('✓', cb.x+cb.s/2, cb.y+cb.s*0.78, 20*DPR, '#0b0b12', 'center', 'alphabetic', '800');
    }
    registerHit({x:cb.x, y:cb.y, w:cb.s, h:cb.s}, {type:'toggle', dayIndex:dIndex, itemIndex:iIndex, key});

    // Title + meta
    drawText(item.title || 'Exercise', P+cb.s+28*DPR, y+28*DPR, 18*DPR, colors.text, 'left', 'alphabetic', '700');
    const meta = `${item.sets||0} sets × ${item.reps||'-'}  •  ${item.weight||'—'}  •  ${item.notes||''}`;
    drawText(meta, P+cb.s+28*DPR, y+52*DPR, 12*DPR, colors.textDim);

    // Image thumb (right)
    const thumb = {w:64*DPR, h:64*DPR};
    const tx = W - P - thumb.w, ty = y + (cardH-thumb.h)/2;
    rrect(tx, ty, thumb.w, thumb.h, 10*DPR); ctx.fillStyle = colors.panel; ctx.fill();
    let imgSrc = item.imgCustom ? data.images[item.imgCustom] : (item.img ? makeIcon(item.img) : null);
    if (imgSrc) {
      const img = new Image();
      img.onload = () => { ctx.drawImage(img, tx, ty, thumb.w, thumb.h); };
      img.src = imgSrc;
      // still register hit
    }
    registerHit({x:tx, y:ty, w:thumb.w, h:thumb.h}, {type:'image', dIndex, iIndex});

    // Action chips: edit • drag • menu
    const chipY = y + cardH - 16*DPR;
    const chips = [
      {label:'Edit', action:()=>editItem(dIndex, iIndex)},
      {label:'Drag', action:()=>startDrag(dIndex, iIndex, topY)},
      {label:'•••', action:()=>itemMenu(dIndex, iIndex)}
    ];
    let cx = P+cb.s+28*DPR;
    chips.forEach(c=>{
      const tw = measure(c.label, 12*DPR, '700');
      const bw = tw + 18*DPR;
      rrect(cx, chipY-20*DPR, bw, 24*DPR, 8*DPR); ctx.fillStyle = colors.accentSoft; ctx.fill();
      drawText(c.label, cx+bw/2, chipY-4*DPR, 12*DPR, colors.text, 'center', 'alphabetic', '700');
      registerHit({x:cx, y:chipY-20*DPR, w:bw, h:24*DPR}, {type:'chip', cb:c});
      cx += bw + 8*DPR;
    });

    return y + cardH + metrics.cardGap*DPR;
  }

  function drawButton(y, label, onTap) {
    const P = metrics.padding*DPR;
    const bw = W-2*P, bh = metrics.btnH*DPR;
    drawShadowedCard(P, y, bw, bh, 12*DPR, colors.accent);
    drawText(label, P + bw/2, y + bh/2 + 6*DPR, 16*DPR, colors.text, 'center', 'alphabetic', '800');
    registerHit({x:P, y:y, w:bw, h:bh}, {type:'button', onTap});
    return y + bh;
  }

  function drawFABs() {
    const r = metrics.fabR*DPR;
    const x = W - (metrics.padding*DPR) - r*2;
    const y1 = H - (metrics.padding*DPR) - r*2;
    const y2 = y1 - r*2 - 12*DPR;

    // Scroll to top
    rrect(x, y2, r*2, r*2, r);
    ctx.fillStyle = colors.accent; ctx.fill();
    drawText('⇧', x+r, y2+r+6*DPR, 18*DPR, colors.text, 'center', 'alphabetic', '800');
    registerHit({x:x, y:y2, w:r*2, h:r*2}, {type:'scrollTop'});

    // New week name
    rrect(x, y1, r*2, r*2, r);
    ctx.fillStyle = colors.accent; ctx.fill();
    drawText('✎', x+r, y1+r+6*DPR, 18*DPR, colors.text, 'center', 'alphabetic', '800');
    registerHit({x:x, y:y1, w:r*2, h:r*2}, {type:'renameWeek'});
  }

  // Hit handling
  function onPointerDown(x,y) {
    const info = hitTest(x,y);
    touchStartY = y;

    if (!info) return;

    if (info.type === 'week-tab') {
      activeWeek = info.index;
      contentScroll = 0; draw(); return;
    }
    if (info.type === 'add-item') {
      // Add blank item under a day header
      const item = { title:'New Exercise', sets:3, reps:'10', weight:'', notes:'', img:null };
      data.weeks[activeWeek].days[info.dayIndex].items.push(item);
      saveData(); draw(); return;
    }
    if (info.type === 'toggle') {
      const k = info.key;
      data.progress[k] = !data.progress[k];
      saveData(); draw(); return;
    }
    if (info.type === 'image') {
      imageMenu(info.dIndex, info.iIndex); return;
    }
    if (info.type === 'chip') {
      info.cb.action(); return;
    }
    if (info.type === 'button') {
      info.onTap(); return;
    }
    if (info.type === 'scrollTop') {
      contentScroll = 0; draw(); return;
    }
    if (info.type === 'renameWeek') {
      const name = prompt('Rename week to:' , data.weeks[activeWeek].name);
      if (name) { data.weeks[activeWeek].name = name; saveData(); draw(); }
      return;
    }
  }
  function onPointerMove(x,y) {
    if (!pointer.down) return;
    // dragging to scroll
    if (dragItem) {
      dragItem.currentY = y;
      draw(); // We'll overlay ghost
    } else {
      const dy = (touchStartY - y);
      if (Math.abs(dy) > 2*DPR) {
        contentScroll = clamp(contentScroll + dy, 0, Math.max(0, contentHeight() - (H - (metrics.tabH+metrics.headerH)*DPR)));
        touchStartY = y;
        draw();
      }
    }
  }
  function onPointerUp() {
    if (dragItem) {
      finalizeDrag();
      dragItem = null;
    }
  }

  // Drag logic (reorder within the same day)
  function startDrag(dIndex, iIndex, itemTopY) {
    dragItem = { dIndex, iIndex, startY: itemTopY, currentY: itemTopY };
  }
  function finalizeDrag() {
    const day = data.weeks[activeWeek].days[dragItem.dIndex];
    const listTop = 0; // simplified
    const delta = (dragItem.currentY - dragItem.startY);
    const slotH = (metrics.cardH+metrics.cardGap)*DPR;
    let moved = Math.round(delta / slotH);
    const from = dragItem.iIndex;
    let to = clamp(from + moved, 0, day.items.length-1);
    if (to !== from) {
      const [it] = day.items.splice(from,1);
      day.items.splice(to,0,it);
      saveData();
    }
    draw();
  }

  // Edit item
  function editItem(dIndex, iIndex) {
    const item = data.weeks[activeWeek].days[dIndex].items[iIndex];
    const title = prompt('Exercise name:', item.title || '');
    if (title===null) return;
    const sets = prompt('Sets:', item.sets ?? '');
    if (sets===null) return;
    const reps = prompt('Reps:', item.reps ?? '');
    if (reps===null) return;
    const weight = prompt('Weight (optional):', item.weight ?? '');
    if (weight===null) return;
    const notes = prompt('Notes (optional):', item.notes ?? '');
    if (notes===null) return;
    Object.assign(item, {title, sets:Number(sets)||sets, reps, weight, notes});
    saveData(); draw();
  }

  // Image menu
  function imageMenu(dIndex, iIndex) {
    const choice = prompt('Image:\n1) Built‑in icon (biceps/pullups/dumbbells/legs)\n2) Use image URL\n3) Upload from device\n4) Clear image\n\nType 1, 2, 3, or 4:');
    const item = data.weeks[activeWeek].days[dIndex].items[iIndex];
    if (!choice) return;
    if (choice==='1') {
      const key = prompt('Type one: biceps, pullups, dumbbells, legs', item.img||'dumbbells');
      if (!key) return;
      item.imgCustom = null; item.img = key;
      saveData(); draw();
    } else if (choice==='2') {
      const url = prompt('Paste image URL:');
      if (!url) return;
      // store by custom id after loading to dataURL via Image + canvas
      urlToDataURL(url).then(dataURL => {
        const id = uid();
        data.images[id] = dataURL;
        item.img = null; item.imgCustom = id;
        saveData(); draw();
      }).catch(()=>alert('Could not load image.'));
    } else if (choice==='3') {
      filePick.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const id = uid();
          data.images[id] = reader.result;
          item.img = null; item.imgCustom = id;
          saveData(); draw();
          filePick.value = '';
        };
        reader.readAsDataURL(file);
      };
      filePick.click();
    } else if (choice==='4') {
      item.img = null; item.imgCustom = null; saveData(); draw();
    }
  }

  function urlToDataURL(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function(){
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const x = c.getContext('2d');
        x.drawImage(img, 0,0);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // Preset picker (very simple)
  function openPresetPicker() {
    const list = PRESETS.map((p,i)=>`${i+1}) ${p.name} — ${p.notes}`).join('\n');
    const s = prompt('Pick a preset to add to a day (type day number then preset number):\n\nDays: 1=Mon .. 7=Sun\n' + list + '\n\nExample: "1 2" to add Pull A to Monday');
    if (!s) return;
    const [dStr, pStr] = s.trim().split(/\s+/);
    const d = Math.max(1, Math.min(7, parseInt(dStr||'1')))-1;
    const p = Math.max(1, Math.min(PRESETS.length, parseInt(pStr||'1')))-1;
    const preset = PRESETS[p];
    const day = data.weeks[activeWeek].days[d];
    preset.items.forEach(pt => day.items.push({ ...pt, img:preset.img }));
    saveData(); draw();
  }

  function addCustomExercise() {
    const s = prompt('Add to which day? 1=Mon .. 7=Sun', '1');
    if (!s) return;
    const d = clamp(parseInt(s||'1')-1, 0, 6);
    const day = data.weeks[activeWeek].days[d];
    const title = prompt('Exercise name:', 'New Exercise');
    if (!title) return;
    const sets = prompt('Sets:', '3');
    if (sets===null) return;
    const reps = prompt('Reps:', '10');
    if (reps===null) return;
    day.items.push({title, sets:Number(sets)||sets, reps, weight:'', notes:'', img:null});
    saveData(); draw();
  }

  // Initial mount
  resize();
  draw();

})();