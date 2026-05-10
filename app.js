// ==========================================
// 1. CONFIGURACIÓN Y ESTADO GLOBAL
// ==========================================
const canvas = document.getElementById('cad-canvas');
const ctx = canvas.getContext('2d', { alpha: false });

let cam = { x: 0, y: 0, zoom: 1 };
let entities = [];
let currentTool = 'pan';
let isDrawing = false;
let startWorldPos = null;
let currentEndPos = { x: 0, y: 0 };
let pipeCounter = 1;

const MM_TO_PX = 0.12;
const INV_MM_TO_PX = 1 / MM_TO_PX;
let snapGridMM = 50;
let primaryGridMM = 200;
let secondaryGridMM = 50;

let canvasWidth = 0;
let canvasHeight = 0;
let animationFrameId = null;

// ==========================================
// 2. SISTEMA DE COORDENADAS
// ==========================================
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvasWidth = rect.width;
  canvasHeight = rect.height;
  ctx.scale(dpr, dpr);
  render();
}

function screenToWorld(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  const px = sx - rect.left;
  const py = sy - rect.top;
  return {
    x: (px - cam.x) * INV_MM_TO_PX / cam.zoom,
    y: (py - cam.y) * INV_MM_TO_PX / cam.zoom
  };
}

function worldToScreen(wx, wy) {
  const scale = cam.zoom * MM_TO_PX;
  return {
    x: wx * scale + cam.x,
    y: wy * scale + cam.y
  };
}

function snapToGrid(worldPos) {
  const invSnap = 1 / snapGridMM;
  return {
    x: Math.round(worldPos.x * invSnap) * snapGridMM,
    y: Math.round(worldPos.y * invSnap) * snapGridMM
  };
}

function constrainAngle(start, end) {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  let dist = Math.hypot(dx, dy);
  if (dist === 0) return end;
  let angle = Math.atan2(dy, dx);
  let snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return { x: start.x + Math.cos(snapAngle) * dist, y: start.y + Math.sin(snapAngle) * dist };
}

// ==========================================
// 3. GESTIÓN DE ENTIDADES Y GUARDADO
// ==========================================
function addEntity(type, start, end, extraProps = {}) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length_mm = Math.hypot(dx, dy);

  entities.push({
    id: Date.now(),
    type: type,
    id_num: type === 'line' ? pipeCounter++ : '', // Solo las cañerías tienen #1, #2
    coords_start: { ...start },
    coords_end: { ...end },
    diameter_in: extraProps.diameter_in || 2, // Por defecto 2 pulgadas como la foto
    material: extraProps.material || 'A106 Gr.B',
    auto_length_mm: length_mm,
    layer: 1
  });
  saveLocal();
}

// Guardado en LocalStorage (Botón GUARDAR)
function saveLocal() {
  localStorage.setItem('spool_entities', JSON.stringify(entities));
  localStorage.setItem('spool_counter', pipeCounter);
}

function loadLocal() {
  const saved = localStorage.getItem('spool_entities');
  if (saved) {
    entities = JSON.parse(saved);
    pipeCounter = parseInt(localStorage.getItem('spool_counter')) || entities.length + 1;
  }
}

// ==========================================
// 4. BIBLIOTECA DE SIMBOLOGÍA
// ==========================================
function drawPipeLine(ctx, sStart, sEnd, diameterIn) {
  const width = (diameterIn * 8) * cam.zoom * MM_TO_PX;
  ctx.lineWidth = Math.max(2, width);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(sStart.x, sStart.y);
  ctx.lineTo(sEnd.x, sEnd.y);
  ctx.stroke();
}

function drawFitting(ctx, type, sPos, angle, diameterIn) {
  const w = Math.max(4, (diameterIn * 8) * cam.zoom * MM_TO_PX);
  ctx.save();
  ctx.translate(sPos.x, sPos.y);
  ctx.rotate(angle);
  ctx.lineWidth = 2; ctx.strokeStyle = '#0f172a'; ctx.fillStyle = '#f8fafc';

  switch(type) {
    case 'elbow90': ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 0, w, -Math.PI/2, 0); ctx.stroke(); break;
    case 'elbow45': ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 0, w*1.5, -Math.PI/4, 0); ctx.stroke(); break;
    case 'tee': ctx.lineWidth = w; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, w*2); ctx.stroke(); break;
    case 'flange': const flangeW = w * 1.4; ctx.lineWidth = 3; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(-8, -flangeW/2); ctx.lineTo(-8, flangeW/2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(8, -flangeW/2); ctx.lineTo(8, flangeW/2); ctx.stroke(); break;
    case 'cap': ctx.lineWidth = w; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(-10,0); ctx.lineTo(0,0); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, w/2, Math.PI/2, -Math.PI/2, false); ctx.fill(); ctx.stroke(); break;
    case 'red-conc': ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-15, -w/2); ctx.lineTo(15, -w/3); ctx.lineTo(15, w/3); ctx.lineTo(-15, w/2); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    case 'red-exc': ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-15, -w/2); ctx.lineTo(15, -w/2); ctx.lineTo(15, w/3); ctx.lineTo(-15, w/2); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
  }
  ctx.restore();
}

// ==========================================
// 5. MOTOR DE RENDERIZADO
// ==========================================
function render() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  
  animationFrameId = requestAnimationFrame(() => {
    const w = canvasWidth;
    const h = canvasHeight;
    
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);
    drawGrid(w, h);

    const len = entities.length;
    for (let i = 0; i < len; i++) {
      const ent = entities[i];
      const sS = worldToScreen(ent.coords_start.x, ent.coords_start.y);
      const sE = worldToScreen(ent.coords_end.x, ent.coords_end.y);
      const angle = Math.atan2(sE.y - sS.y, sE.x - sS.x);

      if (ent.type === 'line') {
        drawPipeLine(ctx, sS, sE, ent.diameter_in);
      } else {
        drawFitting(ctx, ent.type, sS, angle, ent.diameter_in);
      }

      if (ent.type === 'line' && ent.auto_length_mm > 0) {
        const midX = (sS.x + sE.x) / 2;
        const midY = (sS.y + sE.y) / 2;
        ctx.save();
        ctx.translate(midX, midY);
        let textAngle = angle;
        if (textAngle > Math.PI/2 || textAngle < -Math.PI/2) textAngle += Math.PI;
        ctx.rotate(textAngle);
        
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        
        const label = `#${ent.id_num}: ${ent.auto_length_mm.toFixed(0)}mm (${ent.diameter_in}'')`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = '#ffffffcc';
        ctx.fillRect(-textWidth/2 - 4, -20, textWidth + 8, 16);
        
        ctx.fillStyle = '#dc2626';
        ctx.fillText(label, 0, -6);
        ctx.restore();
      }
    }

    if (isDrawing && startWorldPos && currentTool === 'line') {
      const sS = worldToScreen(startWorldPos.x, startWorldPos.y);
      const sE = worldToScreen(currentEndPos.x, currentEndPos.y);
      ctx.globalAlpha = 0.5;
      drawPipeLine(ctx, sS, sE, 2);
      ctx.globalAlpha = 1;
    }
  });
}


function drawGrid(w, h) {
  const stepSec = secondaryGridMM * cam.zoom * MM_TO_PX;
  if (stepSec > 10) {
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    const offX = cam.x % stepSec;
    const offY = cam.y % stepSec;
    ctx.beginPath();
    for (let x = offX; x < w; x += stepSec) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = offY; y < h; y += stepSec) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }
  const stepPri = primaryGridMM * cam.zoom * MM_TO_PX;
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  const offXP = cam.x % stepPri;
  const offYP = cam.y % stepPri;
  ctx.beginPath();
  for (let x = offXP; x < w; x += stepPri) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = offYP; y < h; y += stepPri) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

// ==========================================
// 6. INTERACCIÓN Y EVENTOS
// ==========================================
const toolBtns = document.querySelectorAll('.tool-btn');
for (let i = 0; i < toolBtns.length; i++) {
  toolBtns[i].addEventListener('click', (e) => {
    for (let j = 0; j < toolBtns.length; j++) {
      toolBtns[j].classList.remove('active');
    }
    e.target.classList.add('active');
    currentTool = e.target.dataset.tool;
  });
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const worldPos = screenToWorld(e.clientX, e.clientY);
  const snappedPos = snapToGrid(worldPos);

  if (currentTool === 'pan') {
    isDrawing = true;
    startWorldPos = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
  } else if (currentTool === 'line') {
    isDrawing = true;
    startWorldPos = snappedPos;
    currentEndPos = snappedPos;
  } else {
    addEntity(currentTool, snappedPos, { x: snappedPos.x + 200, y: snappedPos.y });
    render();
  }
});

canvas.addEventListener('pointermove', (e) => {
  e.preventDefault();
  if (!isDrawing) return;

  if (currentTool === 'pan') {
    cam.x += e.clientX - startWorldPos.x;
    cam.y += e.clientY - startWorldPos.y;
    startWorldPos = { x: e.clientX, y: e.clientY };
    render();
  } else if (currentTool === 'line') {
    const worldPos = screenToWorld(e.clientX, e.clientY);
    const snapped = snapToGrid(worldPos);
    currentEndPos = constrainAngle(startWorldPos, snapped);
    render();
  }
});

canvas.addEventListener('pointerup', (e) => {
  e.preventDefault();
  if (!isDrawing) return;
  isDrawing = false;
  canvas.style.cursor = 'crosshair';

  if (currentTool === 'line' && startWorldPos) {
    const worldPos = screenToWorld(e.clientX, e.clientY);
    const snapped = snapToGrid(worldPos);
    const endPos = constrainAngle(startWorldPos, snapped);
    
    if (Math.hypot(endPos.x - startWorldPos.x, endPos.y - startWorldPos.y) > 10) {
      addEntity('line', startWorldPos, endPos);
    }
    render();
  }
});

// Zoom
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  const mouseWorld = screenToWorld(e.clientX, e.clientY);
  cam.zoom *= zoomFactor;
  const newMouseWorld = screenToWorld(e.clientX, e.clientY);
  cam.x += (newMouseWorld.x - mouseWorld.x) * cam.zoom * MM_TO_PX;
  cam.y += (newMouseWorld.y - mouseWorld.y) * cam.zoom * MM_TO_PX;
  render();
}, { passive: false });

// ==========================================
// 7. BOTONES DE ACCIÓN
// ==========================================
document.getElementById('btn-save').addEventListener('click', saveLocal);
document.getElementById('btn-bom').addEventListener('click', toggleBOM);
document.getElementById('btn-export').addEventListener('click', exportPNG);

function toggleBOM() {
  const modal = document.getElementById('bom-modal');
  modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
  
  const len = entities.length;
  let html = '';
  for (let i = 0; i < len; i++) {
    const ent = entities[i];
    if(ent.type === 'line') {
      html += `<tr><td>#${ent.id_num}</td><td>Cañería</td><td>${ent.diameter_in}''</td><td>${ent.auto_length_mm.toFixed(0)}</td></tr>`;
    } else {
      html += `<tr><td>-</td><td>${ent.type}</td><td>${ent.diameter_in}''</td><td>-</td></tr>`;
    }
  }
  document.getElementById('bom-body').innerHTML = html;
}

function exportPNG() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 1920;
  tempCanvas.height = 1080;
  const tCtx = tempCanvas.getContext('2d');
  tCtx.fillStyle = '#FFFFFF';
  tCtx.fillRect(0, 0, 1920, 1080);
  
  const exportZoom = 2;
  const exportOffsetX = 200;
  const exportOffsetY = 200;
  
  const len = entities.length;
  for (let i = 0; i < len; i++) {
    const ent = entities[i];
    tCtx.strokeStyle = '#000000';
    tCtx.lineWidth = ent.diameter_in * 2;
    tCtx.lineCap = 'round';
    tCtx.beginPath();
    tCtx.moveTo(ent.coords_start.x * exportZoom + exportOffsetX, ent.coords_start.y * exportZoom + exportOffsetY);
    tCtx.lineTo(ent.coords_end.x * exportZoom + exportOffsetX, ent.coords_end.y * exportZoom + exportOffsetY);
    tCtx.stroke();
  }
  
  const link = document.createElement('a');
  link.download = 'Achero_Spool.png';
  link.href = tempCanvas.toDataURL();
  link.click();
}
// 8. INICIALIZACIÓN
// ==========================================
window.addEventListener('resize', resizeCanvas);
loadLocal(); // Cargar datos guardados
resizeCanvas();
cam.x = canvas.clientWidth / 2;
cam.y = canvas.clientHeight / 2;
cam.zoom = 3; 
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
}
