// ==========================================
// 1. CONFIGURACIÓN Y ESTADO GLOBAL
// ==========================================
const canvas = document.getElementById('cad-canvas');
const ctx = canvas.getContext('2d');

// Estado de la Cámara (Pan y Zoom)
let cam = { x: 0, y: 0, zoom: 1 };
let entities = []; // Array de objetos del spool
let currentTool = 'line';
let isDrawing = false;
let startWorldPos = null;
let currentEndPos = { x: 0, y: 0 };

// Configuración de Grilla y Snapping (Milímetros a Píxeles lógicos)
const MM_TO_PX = 0.12; 
let snapGridMM = 50;   
let primaryGridMM = 200;
let secondaryGridMM = 50;

// ==========================================
// 2. SISTEMA DE COORDENADAS Y TRANSFORMACIÓN
// ==========================================
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  render();
}

function screenToWorld(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  const px = sx - rect.left;
  const py = sy - rect.top;
  return {
    x: (px - cam.x) / (cam.zoom * MM_TO_PX),
    y: (py - cam.y) / (cam.zoom * MM_TO_PX)
  };
}

function worldToScreen(wx, wy) {
  return {
    x: wx * cam.zoom * MM_TO_PX + cam.x,
    y: wy * cam.zoom * MM_TO_PX + cam.y
  };
}

function snapToGrid(worldPos) {
  const snapSize = snapGridMM;
  return {
    x: Math.round(worldPos.x / snapSize) * snapSize,
    y: Math.round(worldPos.y / snapSize) * snapSize
  };
}

// ==========================================
// 3. LÓGICA DE DIBUJO ORTOGONAL/45°
// ==========================================
function constrainAngle(start, end) {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  let dist = Math.hypot(dx, dy);
  if (dist === 0) return end;
  
  let angle = Math.atan2(dy, dx);
  // Forzar ángulos a 0, 45, 90, 135, 180, etc.
  let snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  
  return {
    x: start.x + Math.cos(snapAngle) * dist,
    y: start.y + Math.sin(snapAngle) * dist
  };
}

// ==========================================
// 4. GESTIÓN DE ENTIDADES (SPLOGIC)
// ==========================================
function addEntity(type, start, end, extraProps = {}) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length_mm = Math.hypot(dx, dy);

  entities.push({
    id: Date.now(),
    type: type,
    coords_start: { ...start },
    coords_end: { ...end },
    diameter_in: extraProps.diameter_in || 6, 
    material: extraProps.material || 'A106 Gr.B',
    auto_length_mm: length_mm,
    layer: extraProps.layer || 1
  });
}

// ==========================================
// 5. BIBLIOTECA DE SIMBOLOGÍA (DRAWING)
// ==========================================
function drawPipeLine(ctx, sStart, sEnd, diameterIn) {
  const width = (diameterIn * 8) * cam.zoom * MM_TO_PX; // Escala visual del diámetro
  ctx.lineWidth = Math.max(2, width); // Mínimo 2px para que sea visible
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

  ctx.lineWidth = 2;
  ctx.strokeStyle = '#0f172a';
  ctx.fillStyle = '#f8fafc';

  switch(type) {
    case 'elbow90':
      ctx.lineWidth = w; 
      ctx.lineCap = 'round';
      ctx.beginPath(); 
      ctx.arc(0, 0, w, -Math.PI/2, 0); 
      ctx.stroke();
      break;
    case 'elbow45':
      ctx.lineWidth = w; 
      ctx.lineCap = 'round';
      ctx.beginPath(); 
      ctx.arc(0, 0, w*1.5, -Math.PI/4, 0); 
      ctx.stroke();
      break;
    case 'tee':
      // Dibujar tubería principal (horizontal en rotación local)
      ctx.lineWidth = w;
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.stroke();
      // Dibujar ramal (vertical hacia abajo)
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, w*2); ctx.stroke();
      break;
    case 'flange':
      const flangeW = w * 1.4;
      ctx.lineWidth = 3;
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(-8, -flangeW/2); ctx.lineTo(-8, flangeW/2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(8, -flangeW/2); ctx.lineTo(8, flangeW/2); ctx.stroke();
      break;
    case 'cap':
      ctx.lineWidth = w;
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(-10,0); ctx.lineTo(0,0); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, w/2, Math.PI/2, -Math.PI/2, false); ctx.fill(); ctx.stroke();
      break;
    case 'red-conc':
      ctx.lineWidth = 2;
      ctx.beginPath(); 
      ctx.moveTo(-15, -w/2); ctx.lineTo(15, -w/3); 
      ctx.lineTo(15, w/3); ctx.lineTo(-15, w/2); 
      ctx.closePath(); 
      ctx.fill(); ctx.stroke();
      break;
    case 'red-exc':
      ctx.lineWidth = 2;
      ctx.beginPath(); 
      ctx.moveTo(-15, -w/2); ctx.lineTo(15, -w/2); // Base recta superior
      ctx.lineTo(15, w/3); ctx.lineTo(-15, w/2);   // Base inclinada inferior
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
  }
  ctx.restore();
}

// ==========================================
// 6. MOTOR DE RENDERIZADO (GRILLA + ENTIDADES)
// ==========================================
function render() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#f8fafc'; 
  ctx.fillRect(0, 0, w, h);

  // -- Dibujar Grilla --
  drawGrid(w, h);

  // -- Estados de Capas --
  const showPipe = document.getElementById('lay-pipe').checked;
  const showDim = document.getElementById('lay-dim').checked;
  
  // -- Dibujar Entidades --
  if (showPipe) {
    entities.forEach(ent => {
      const sS = worldToScreen(ent.coords_start.x, ent.coords_start.y);
      const sE = worldToScreen(ent.coords_end.x, ent.coords_end.y);
      const angle = Math.atan2(sE.y - sS.y, sE.x - sS.x);

      if (ent.type === 'line') {
        drawPipeLine(ctx, sS, sE, ent.diameter_in);
      } else {
        drawFitting(ctx, ent.type, sS, angle, ent.diameter_in);
      }

      // -- Dibujar Cotas --
      if (showDim && ent.auto_length_mm > 0) {
        const midX = (sS.x + sE.x) / 2;
        const midY = (sS.y + sE.y) / 2;
        ctx.save();
        ctx.translate(midX, midY);
        let textAngle = angle;
        if (textAngle > Math.PI/2 || textAngle < -Math.PI/2) textAngle += Math.PI;
        ctx.rotate(textAngle);
        ctx.fillStyle = '#dc2626'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
        ctx.fillText(`${ent.auto_length_mm.toFixed(0)} mm`, 0, -15);
        ctx.restore();
      }
    });
  }

  // -- Dibujar línea en progreso --
  if (isDrawing && startWorldPos && currentTool === 'line') {
    const sS = worldToScreen(startWorldPos.x, startWorldPos.y);
    const sE = worldToScreen(currentEndPos.x, currentEndPos.y);
    ctx.globalAlpha = 0.5;
    drawPipeLine(ctx, sS, sE, 6);
    ctx.globalAlpha = 1;
  }
}

function drawGrid(w, h) {
  // Grilla Secundaria (50mm)
  const stepSec = secondaryGridMM * cam.zoom * MM_TO_PX;
  if (stepSec > 10) { 
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 0.5;
    const offX = cam.x % stepSec; const offY = cam.y % stepSec;
    ctx.beginPath();
    for (let x = offX; x < w; x += stepSec) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = offY; y < h; y += stepSec) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  // Grilla Primaria (200mm)
  const stepPri = primaryGridMM * cam.zoom * MM_TO_PX;
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
  const offXP = cam.x % stepPri; const offYP = cam.y % stepPri;
  ctx.beginPath();
  for (let x = offXP; x < w; x += stepPri) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = offYP; y < h; y += stepPri) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

// ==========================================
// 7. INTERACCIÓN Y EVENTOS (TÁCTIL Y RATÓN)
// ==========================================

// Gestión de Herramientas
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
  });
});

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const worldPos = screenToWorld(e.clientX, e.clientY);
  const snappedPos = snapToGrid(worldPos);

  if (currentTool === 'pan') {
    isDrawing = true; 
    startWorldPos = { x: e.clientX, y: e.clientY };
  } else if (currentTool === 'line') {
    isDrawing = true;
    startWorldPos = snappedPos;
    currentEndPos = snappedPos;
  } else {
    // Insertar accesorio
    addEntity(currentTool, snappedPos, { x: snappedPos.x + 200, y: snappedPos.y }, { layer: 1 });
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

// Zoom con rueda (Desktop)
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

// Capas
document.querySelectorAll('.layer-toggle input').forEach(inp => inp.addEventListener('change', render));

// ==========================================
// 8. EXPORTACIÓN Y LISTADO DE MATERIALES
// ==========================================
function exportPNG() {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = 1920; tempCanvas.height = 1080;
  const tCtx = tempCanvas.getContext('2d');
  
  // Fondo blanco limpio para impresión
  tCtx.fillStyle = '#FFFFFF'; 
  tCtx.fillRect(0, 0, 1920, 1080);

  // Re-renderizar sin grilla (Escala 1:1 fija para exportación)
  const exportZoom = 2;
  const exportOffsetX = 200;
  const exportOffsetY = 200;

  entities.forEach(ent => {
    tCtx.strokeStyle = '#000000'; 
    tCtx.lineWidth = ent.diameter_in * 2;
    tCtx.lineCap = 'round';
    tCtx.beginPath();
    tCtx.moveTo(ent.coords_start.x * exportZoom + exportOffsetX, ent.coords_start.y * exportZoom + exportOffsetY);
    tCtx.lineTo(ent.coords_end.x * exportZoom + exportOffsetX, ent.coords_end.y * exportZoom + exportOffsetY);
    tCtx.stroke();
  });

  const link = document.createElement('a');
  link.download = 'spool_drawing.png';
  link.href = tempCanvas.toDataURL();
  link.click();
}

function toggleBOM() {
  const modal = document.getElementById('bom-modal');
  modal.style.display = modal.style.display === 'block' ? 'none' : 'block';
  
  let html = '';
  entities.forEach(ent => {
    html += `<tr>
      <td>${ent.type}</td>
      <td>${ent.diameter_in}"</td>
      <td>${ent.auto_length_mm.toFixed(1)}</td>
      <td>${ent.material}</td>
    </tr>`;
  });
  document.getElementById('bom-body').innerHTML = html;
}

// ==========================================
// 9. INICIALIZACIÓN Y SERVICE WORKER
// ==========================================
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Centrar cámara al inicio
cam.x = canvas.clientWidth / 2;
cam.y = canvas.clientHeight / 2;
cam.zoom = 3; 
render();

// Registro del Service Worker (Ruta relativa para GitHub Pages)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(reg => console.log('Service Worker registrado correctamente'))
    .catch(err => console.error('Error al registrar SW:', err));
}
