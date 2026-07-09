/* ============================================================
   Verificación de EPP - Megablessing S.C.
   App offline-first (IndexedDB + PWA). Todo funciona sin internet
   una vez cargada la primera vez.
   ============================================================ */

const DB_NAME = 'eppMegablessingDB';
const DB_VERSION = 1;
const PIN_DEFAULT = '1234';
let db;

// ---------- Semillas iniciales ----------
const PERSONAS_DEFAULT = Array.from({length:15}, (_,i)=>({
  nombre: `Colaborador ${i+1}`,
  cargo: '',
  activo: true
}));

const EPP_DEFAULT = [
  'Casco de seguridad',
  'Gafas / lentes de protección',
  'Guantes de seguridad',
  'Mascarilla / protección respiratoria',
  'Botas de seguridad',
  'Uniforme / overol de trabajo',
  'Protector auditivo',
  'Cofia o malla para cabello',
  'Chaleco reflectivo'
].map(n=>({nombre:n, activo:true}));

// ---------- IndexedDB ----------
function initDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const d = e.target.result;
      if(!d.objectStoreNames.contains('config')) d.createObjectStore('config',{keyPath:'key'});
      if(!d.objectStoreNames.contains('personas')) d.createObjectStore('personas',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('eppItems')) d.createObjectStore('eppItems',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('registros')) d.createObjectStore('registros',{keyPath:'id',autoIncrement:true});
    };
    req.onsuccess = async (e)=>{
      db = e.target.result;
      await seedIfEmpty();
      resolve(db);
    };
    req.onerror = ()=>reject(req.error);
  });
}

function tx(store, mode='readonly'){
  return db.transaction(store, mode).objectStore(store);
}
function getAll(store){
  return new Promise((res,rej)=>{
    const r = tx(store).getAll();
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}
function put(store, val){
  return new Promise((res,rej)=>{
    const r = tx(store,'readwrite').put(val);
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}
function del(store, id){
  return new Promise((res,rej)=>{
    const r = tx(store,'readwrite').delete(id);
    r.onsuccess=()=>res();
    r.onerror=()=>rej(r.error);
  });
}
function getConfig(key, fallback){
  return new Promise((res)=>{
    const r = tx('config').get(key);
    r.onsuccess=()=>res(r.result ? r.result.value : fallback);
    r.onerror=()=>res(fallback);
  });
}
function setConfig(key, value){
  return put('config',{key,value});
}

async function seedIfEmpty(){
  const personas = await getAll('personas');
  if(personas.length===0){
    for(const p of PERSONAS_DEFAULT) await put('personas', p);
  }
  const items = await getAll('eppItems');
  if(items.length===0){
    for(const it of EPP_DEFAULT) await put('eppItems', it);
  }
  const pin = await getConfig('pin', null);
  if(!pin) await setConfig('pin', PIN_DEFAULT);
}

// ---------- Utilidades ----------
function hoyISO(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}
function fmtFecha(iso){
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

// ============================================================
// LOGIN / PIN
// ============================================================
let pinBuffer = '';
async function setupLogin(){
  const keypad = document.getElementById('keypad');
  const teclas = ['1','2','3','4','5','6','7','8','9','','0','del'];
  keypad.innerHTML = teclas.map(t=>{
    if(t==='') return `<div></div>`;
    if(t==='del') return `<button class="del" onclick="pinBorrar()">Borrar</button>`;
    return `<button onclick="pinPress('${t}')">${t}</button>`;
  }).join('');
  renderPinDots();
}
function renderPinDots(){
  const dots = document.getElementById('pinDots');
  dots.innerHTML = Array.from({length:4}).map((_,i)=>
    `<span class="${i<pinBuffer.length?'filled':''}"></span>`).join('');
}
async function pinPress(n){
  if(pinBuffer.length>=4) return;
  pinBuffer += n;
  renderPinDots();
  document.getElementById('loginErr').textContent='';
  if(pinBuffer.length===4){
    const pinReal = await getConfig('pin', PIN_DEFAULT);
    if(pinBuffer===pinReal){
      setTimeout(()=>{
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('appRoot').classList.remove('hidden');
        arrancarApp();
      },150);
    } else {
      document.getElementById('loginErr').textContent = 'PIN incorrecto';
      setTimeout(()=>{ pinBuffer=''; renderPinDots(); }, 500);
    }
  }
}
function pinBorrar(){
  pinBuffer = pinBuffer.slice(0,-1);
  renderPinDots();
}
function cerrarSesion(){
  pinBuffer='';
  renderPinDots();
  document.getElementById('appRoot').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
}

// ============================================================
// NAVEGACIÓN
// ============================================================
async function cambiarVista(view){
  document.querySelectorAll('main > section').forEach(s=>s.classList.add('hidden'));
  document.getElementById('view-'+view).classList.remove('hidden');
  document.querySelectorAll('nav.tabbar button').forEach(b=>b.classList.remove('activo'));
  document.querySelector(`nav.tabbar button[data-view="${view}"]`).classList.add('activo');
  if(view==='dashboard') await loadDashboard();
  if(view==='registro') await loadRegistroForm();
  if(view==='historial') await loadHistorial();
  if(view==='personal') await loadPersonal();
  if(view==='ajustes') await actualizarEstadoStorage();
}

async function arrancarApp(){
  document.getElementById('fechaHoy').textContent = fmtFecha(hoyISO());
  if(navigator.storage && navigator.storage.persist){
    try{ await navigator.storage.persist(); }catch(e){}
  }
  await loadDashboard();
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard(){
  const personas = (await getAll('personas')).filter(p=>p.activo);
  const registros = await getAll('registros');
  const hoy = hoyISO();
  const regHoy = registros.filter(r=>r.fecha===hoy);

  document.getElementById('statRegistrados').textContent = `${regHoy.length}/${personas.length}`;

  let totalItems=0, totalOk=0;
  regHoy.forEach(r=>{
    r.items.forEach(it=>{ totalItems++; if(it.cumple) totalOk++; });
  });
  const pct = totalItems? Math.round((totalOk/totalItems)*100) : 0;
  document.getElementById('statCumplimiento').textContent = pct+'%';

  const idsRegistrados = new Set(regHoy.map(r=>r.personaId));
  const pendientes = personas.filter(p=>!idsRegistrados.has(p.id));
  const contPend = document.getElementById('listaPendientes');
  contPend.innerHTML = pendientes.length===0
    ? `<div class="empty-state">✅ Todos los colaboradores tienen registro hoy</div>`
    : pendientes.map(p=>`<div class="list-row"><div class="main"><div class="t1">${p.nombre}</div><div class="t2">${p.cargo||'Sin cargo asignado'}</div></div><span class="badge warn">Pendiente</span></div>`).join('');

  await renderReincidencias();

  const ultimos = [...registros].sort((a,b)=>b.timestamp-a.timestamp).slice(0,5);
  const contUlt = document.getElementById('listaUltimos');
  if(ultimos.length===0){
    contUlt.innerHTML = `<div class="empty-state">Aún no hay registros</div>`;
  } else {
    const mapaPersonas = Object.fromEntries(personas.map(p=>[p.id,p.nombre]));
    const todasPersonas = Object.fromEntries((await getAll('personas')).map(p=>[p.id,p.nombre]));
    contUlt.innerHTML = ultimos.map(r=>{
      const ok = r.items.every(i=>i.cumple);
      return `<div class="list-row"><div class="main"><div class="t1">${todasPersonas[r.personaId]||'—'}</div><div class="t2">${fmtFecha(r.fecha)} · ${r.inspector||'Sin inspector'}</div></div><span class="badge ${ok?'ok':'bad'}">${ok?'Cumple':'Con faltas'}</span></div>`;
    }).join('');
  }
}

// ============================================================
// REINCIDENCIAS (semáforo de faltas repetidas)
// ============================================================
const UMBRAL_REINCIDENCIA = 3;
const DIAS_VENTANA = 30;

async function calcularReincidencias(){
  const personas = Object.fromEntries((await getAll('personas')).map(p=>[p.id,p]));
  const registros = await getAll('registros');
  const limite = new Date(); limite.setDate(limite.getDate()-DIAS_VENTANA);
  const limiteISO = limite.toISOString().slice(0,10);

  const conteo = {}; // personaId -> {nombreItem: count}
  registros.filter(r=>r.fecha>=limiteISO).forEach(r=>{
    r.items.forEach(it=>{
      if(!it.cumple){
        conteo[r.personaId] = conteo[r.personaId] || {};
        conteo[r.personaId][it.nombre] = (conteo[r.personaId][it.nombre]||0)+1;
      }
    });
  });

  const resultado = [];
  Object.keys(conteo).forEach(pid=>{
    const persona = personas[pid];
    if(!persona) return;
    const itemsReincidentes = Object.entries(conteo[pid]).filter(([_,c])=>c>=UMBRAL_REINCIDENCIA);
    if(itemsReincidentes.length>0){
      resultado.push({ personaId:Number(pid), nombre:persona.nombre, items:itemsReincidentes });
    }
  });
  return resultado;
}

async function renderReincidencias(){
  const cont = document.getElementById('listaReincidencias');
  if(!cont) return;
  const reincidencias = await calcularReincidencias();
  const card = document.getElementById('cardReincidencias');
  if(reincidencias.length===0){
    card.classList.add('hidden');
    cont.innerHTML='';
    return;
  }
  card.classList.remove('hidden');
  cont.innerHTML = reincidencias.map(r=>`
    <div class="reincidencia-row">
      <div>
        <div class="t1">${r.nombre}</div>
        <div class="t2">${r.items.map(([n,c])=>`${n}: ${c} veces`).join(' · ')}</div>
      </div>
      <span class="badge bad">Reincidente</span>
    </div>`).join('');
}

// ============================================================
// REGISTRO DIARIO
// ============================================================
async function loadRegistroForm(){
  document.getElementById('regFecha').value = hoyISO();
  const personas = (await getAll('personas')).filter(p=>p.activo);
  const sel = document.getElementById('regPersona');
  sel.innerHTML = personas.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join('');
  document.getElementById('regInspector').value = localStorage.getItem('ultimoInspector')||'';
  await renderChecklist();
  initFirmaCanvas();
  document.getElementById('regFecha').onchange = precargarSiExiste;
  sel.onchange = precargarSiExiste;
  await precargarSiExiste();
}

// ---------- Firma del inspector (canvas) ----------
let firmaCtx, firmaDibujando=false, firmaTieneTrazo=false;
function initFirmaCanvas(){
  const canvas = document.getElementById('firmaCanvas');
  // Ajustar resolución real al tamaño mostrado (evita firma borrosa/desalineada)
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  firmaCtx = canvas.getContext('2d');
  firmaCtx.scale(2,2);
  firmaCtx.lineWidth = 2;
  firmaCtx.lineCap = 'round';
  firmaCtx.strokeStyle = '#22261f';
  firmaTieneTrazo = false;

  const pos = (e)=>{
    const r = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return {x: p.clientX-r.left, y: p.clientY-r.top};
  };
  const iniciar = (e)=>{ e.preventDefault(); firmaDibujando=true; const p=pos(e); firmaCtx.beginPath(); firmaCtx.moveTo(p.x,p.y); };
  const mover = (e)=>{ if(!firmaDibujando) return; e.preventDefault(); const p=pos(e); firmaCtx.lineTo(p.x,p.y); firmaCtx.stroke(); firmaTieneTrazo=true; };
  const soltar = ()=>{ firmaDibujando=false; };

  canvas.onmousedown = iniciar; canvas.onmousemove = mover; canvas.onmouseup = soltar; canvas.onmouseleave = soltar;
  canvas.ontouchstart = iniciar; canvas.ontouchmove = mover; canvas.ontouchend = soltar;
}
function limpiarFirma(){
  const canvas = document.getElementById('firmaCanvas');
  firmaCtx.clearRect(0,0,canvas.width,canvas.height);
  firmaTieneTrazo = false;
}
function cargarFirmaExistente(dataUrl){
  const canvas = document.getElementById('firmaCanvas');
  limpiarFirma();
  if(!dataUrl) return;
  const img = new Image();
  img.onload = ()=>{ firmaCtx.drawImage(img,0,0,canvas.width/2,canvas.height/2); firmaTieneTrazo = true; };
  img.src = dataUrl;
}
function obtenerFirmaDataUrl(){
  if(!firmaTieneTrazo) return '';
  return document.getElementById('firmaCanvas').toDataURL('image/png');
}

let fotosItems = {}; // {eppItemId: base64 dataURL}

async function renderChecklist(marcados, fotosExistentes){
  fotosItems = fotosExistentes ? {...fotosExistentes} : {};
  const items = (await getAll('eppItems')).filter(i=>i.activo);
  const cont = document.getElementById('checklistEpp');
  cont.innerHTML = items.map(it=>{
    const estado = marcados ? marcados[it.id] : true; // por defecto "cumple"
    const tieneFoto = !!fotosItems[it.id];
    return `
    <div class="epp-item" data-item-id="${it.id}">
      <div class="fila-toggle">
        <div class="nombre">${it.nombre}</div>
        <div class="toggle">
          <button type="button" class="si ${estado===true?'activo':''}" onclick="marcarItem(${it.id}, true)">Cumple</button>
          <button type="button" class="no ${estado===false?'activo':''}" onclick="marcarItem(${it.id}, false)">No cumple</button>
        </div>
      </div>
      <button type="button" class="foto-btn ${tieneFoto?'tiene-foto':''}" style="${estado===false?'':'display:none;'}" onclick="tomarFotoItem(${it.id})" id="fotoBtn-${it.id}">
        ${tieneFoto?'📷 Foto adjunta — tocar para cambiar':'📷 Adjuntar foto de evidencia'}
      </button>
    </div>`;
  }).join('');
}
function marcarItem(itemId, valor){
  const row = document.querySelector(`.epp-item[data-item-id="${itemId}"]`);
  row.querySelector('.si').classList.toggle('activo', valor===true);
  row.querySelector('.no').classList.toggle('activo', valor===false);
  const btn = document.getElementById(`fotoBtn-${itemId}`);
  if(valor===false){
    btn.style.display = '';
  } else {
    btn.style.display = 'none';
    delete fotosItems[itemId];
    btn.classList.remove('tiene-foto');
    btn.textContent = '📷 Adjuntar foto de evidencia';
  }
}
function tomarFotoItem(itemId){
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.onchange = async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const dataUrl = await comprimirImagen(file);
    fotosItems[itemId] = dataUrl;
    const btn = document.getElementById(`fotoBtn-${itemId}`);
    btn.classList.add('tiene-foto');
    btn.textContent = '📷 Foto adjunta — tocar para cambiar';
    toast('Foto adjuntada');
  };
  input.click();
}
function comprimirImagen(file){
  return new Promise((resolve)=>{
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e)=>{
      img.onload = ()=>{
        const maxW = 900;
        const scale = Math.min(1, maxW/img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width*scale;
        canvas.height = img.height*scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL('image/jpeg',0.6));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function precargarSiExiste(){
  const fecha = document.getElementById('regFecha').value;
  const personaId = Number(document.getElementById('regPersona').value);
  if(!fecha || !personaId) return;
  const registros = await getAll('registros');
  const existente = registros.find(r=>r.fecha===fecha && r.personaId===personaId);
  if(existente){
    const marcados = {}, fotos = {};
    existente.items.forEach(it=>{ marcados[it.eppItemId]=it.cumple; if(it.foto) fotos[it.eppItemId]=it.foto; });
    await renderChecklist(marcados, fotos);
    document.getElementById('regInspector').value = existente.inspector||'';
    document.getElementById('regObs').value = existente.observaciones||'';
    cargarFirmaExistente(existente.firma||'');
    toast('Ya existe un registro para esta fecha — se cargó para editar');
  } else {
    await renderChecklist();
    document.getElementById('regObs').value = '';
    limpiarFirma();
  }
}

async function guardarRegistro(){
  const fecha = document.getElementById('regFecha').value;
  const personaId = Number(document.getElementById('regPersona').value);
  const inspector = document.getElementById('regInspector').value.trim();
  const obs = document.getElementById('regObs').value.trim();
  if(!fecha || !personaId){ toast('Completa fecha y colaborador'); return; }

  const itemsDefinidos = (await getAll('eppItems')).filter(i=>i.activo);
  const items = itemsDefinidos.map(it=>{
    const row = document.querySelector(`.epp-item[data-item-id="${it.id}"]`);
    const cumple = row.querySelector('.si').classList.contains('activo');
    const obj = { eppItemId: it.id, nombre: it.nombre, cumple };
    if(!cumple && fotosItems[it.id]) obj.foto = fotosItems[it.id];
    return obj;
  });

  const registros = await getAll('registros');
  const existente = registros.find(r=>r.fecha===fecha && r.personaId===personaId);
  const registro = {
    personaId, fecha, inspector, observaciones: obs, items,
    firma: obtenerFirmaDataUrl(),
    timestamp: Date.now()
  };
  if(existente) registro.id = existente.id;
  await put('registros', registro);
  localStorage.setItem('ultimoInspector', inspector);
  toast('Registro guardado ✅');
  await cambiarVista('dashboard');
}

// ============================================================
// HISTORIAL
// ============================================================
async function loadHistorial(){
  const personas = await getAll('personas');
  const selP = document.getElementById('filtroPersona');
  selP.innerHTML = `<option value="">Todos los colaboradores</option>` +
    personas.map(p=>`<option value="${p.id}">${p.nombre}</option>`).join('');
  selP.onchange = renderHistorial;
  document.getElementById('filtroFecha').onchange = renderHistorial;
  await renderHistorial();
}
async function renderHistorial(){
  const personas = Object.fromEntries((await getAll('personas')).map(p=>[p.id,p.nombre]));
  let registros = await getAll('registros');
  const fp = document.getElementById('filtroPersona').value;
  const ff = document.getElementById('filtroFecha').value;
  if(fp) registros = registros.filter(r=>r.personaId===Number(fp));
  if(ff) registros = registros.filter(r=>r.fecha===ff);
  registros.sort((a,b)=>b.timestamp-a.timestamp);

  const cont = document.getElementById('listaHistorial');
  if(registros.length===0){
    cont.innerHTML = `<div class="empty-state">Sin registros para el filtro seleccionado</div>`;
    return;
  }
  cont.innerHTML = registros.map(r=>{
    const ok = r.items.every(i=>i.cumple);
    const faltantes = r.items.filter(i=>!i.cumple).map(i=>i.nombre);
    return `<div class="list-row" onclick="verDetalleRegistro(${r.id})" style="cursor:pointer">
      <div class="main">
        <div class="t1">${personas[r.personaId]||'—'}</div>
        <div class="t2">${fmtFecha(r.fecha)} · ${r.inspector||'Sin inspector'}${faltantes.length?' · Falta: '+faltantes.join(', '):''}</div>
      </div>
      <span class="badge ${ok?'ok':'bad'}">${ok?'Cumple':'Con faltas'}</span>
    </div>`;
  }).join('');
}

async function verDetalleRegistro(id){
  const registros = await getAll('registros');
  const r = registros.find(x=>x.id===id);
  const personas = Object.fromEntries((await getAll('personas')).map(p=>[p.id,p.nombre]));
  const filas = r.items.map(it=>`
    <div class="epp-item">
      <div class="fila-toggle">
        <div class="nombre">${it.nombre}</div>
        <span class="badge ${it.cumple?'ok':'bad'}">${it.cumple?'Cumple':'No cumple'}</span>
      </div>
      ${it.foto?`<img src="${it.foto}" class="thumb-foto" onclick="verImagenGrande('${it.foto}')">`:''}
    </div>`).join('');
  abrirModal(`
    <h3>${personas[r.personaId]} — ${fmtFecha(r.fecha)}</h3>
    <p style="font-size:12px;color:var(--texto-suave);margin-bottom:10px;">Inspector: ${r.inspector||'—'}</p>
    ${filas}
    ${r.observaciones ? `<p style="margin-top:12px;font-size:13px;"><b>Observaciones:</b> ${r.observaciones}</p>` : ''}
    ${r.firma ? `<div class="section-title">Firma del inspector</div><img src="${r.firma}" style="max-width:220px;border:1px solid var(--gris-borde);border-radius:8px;">` : ''}
    <div class="btn-row" style="margin-top:16px;">
      <button class="btn btn-secondary btn-sm" style="flex:1" onclick="pdfRegistroIndividual(${r.id})">📄 Descargar PDF</button>
      <button class="btn btn-danger btn-sm" style="flex:1" onclick="eliminarRegistro(${r.id})">Eliminar</button>
    </div>
  `);
}
function verImagenGrande(src){
  abrirModal(`<img src="${src}" style="width:100%;border-radius:8px;">`);
}
async function eliminarRegistro(id){
  if(!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
  await del('registros', id);
  cerrarModal();
  toast('Registro eliminado');
  await renderHistorial();
  await loadDashboard();
}

// ============================================================
// PERSONAL / EPP ITEMS
// ============================================================
async function loadPersonal(){
  const personas = await getAll('personas');
  const reincidencias = await calcularReincidencias();
  const idsReincidentes = new Set(reincidencias.map(r=>r.personaId));
  const cont = document.getElementById('listaPersonal');
  cont.innerHTML = personas.map(p=>`
    <div class="persona-row">
      <div class="info"><div class="nombre">${p.nombre} ${idsReincidentes.has(p.id)?'<span class="badge bad">Reincidente</span>':''}</div><div class="cargo">${p.cargo||'Sin cargo'}${p.activo?'':' · Inactivo'}</div></div>
      <div class="btn-row">
        <button class="btn btn-outline btn-sm" onclick="abrirModalPersona(${p.id})">Editar</button>
      </div>
    </div>`).join('');

  const items = await getAll('eppItems');
  const cont2 = document.getElementById('listaEppItems');
  cont2.innerHTML = items.map(it=>`
    <div class="persona-row">
      <div class="info"><div class="nombre">${it.nombre}</div><div class="cargo">${it.activo?'Activo':'Inactivo'}</div></div>
      <div class="btn-row">
        <button class="btn btn-outline btn-sm" onclick="abrirModalEpp(${it.id})">Editar</button>
      </div>
    </div>`).join('');
}

function abrirModal(html){
  const c = document.getElementById('modalContainer');
  c.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this) cerrarModal()"><div class="modal-box"><button class="close-x" onclick="cerrarModal()">×</button>${html}</div></div>`;
}
function cerrarModal(){ document.getElementById('modalContainer').innerHTML=''; }

async function abrirModalPersona(id){
  let p = {nombre:'',cargo:'',activo:true};
  if(id){ p = (await getAll('personas')).find(x=>x.id===id); }
  abrirModal(`
    <h3>${id?'Editar colaborador':'Nuevo colaborador'}</h3>
    <label>Nombre completo</label>
    <input type="text" id="mNombre" value="${p.nombre}">
    <label>Cargo / área</label>
    <input type="text" id="mCargo" value="${p.cargo||''}">
    <label style="display:flex;align-items:center;gap:8px;margin-top:14px;">
      <input type="checkbox" id="mActivo" ${p.activo?'checked':''} style="width:auto;"> Activo
    </label>
    <button class="btn btn-primary" onclick="guardarPersona(${id||'null'})">Guardar</button>
    ${id?`<button class="btn btn-danger" onclick="eliminarPersona(${id})">Eliminar colaborador</button>`:''}
  `);
}
async function guardarPersona(id){
  const nombre = document.getElementById('mNombre').value.trim();
  const cargo = document.getElementById('mCargo').value.trim();
  const activo = document.getElementById('mActivo').checked;
  if(!nombre){ toast('El nombre es obligatorio'); return; }
  const obj = {nombre,cargo,activo};
  if(id) obj.id = id;
  await put('personas', obj);
  cerrarModal();
  toast('Colaborador guardado');
  await loadPersonal();
}
async function eliminarPersona(id){
  if(!confirm('¿Eliminar colaborador? Sus registros históricos se conservarán.')) return;
  await del('personas', id);
  cerrarModal();
  toast('Colaborador eliminado');
  await loadPersonal();
}

async function abrirModalEpp(id){
  let it = {nombre:'',activo:true};
  if(id){ it = (await getAll('eppItems')).find(x=>x.id===id); }
  abrirModal(`
    <h3>${id?'Editar elemento EPP':'Nuevo elemento EPP'}</h3>
    <label>Nombre del elemento</label>
    <input type="text" id="mEppNombre" value="${it.nombre}">
    <label style="display:flex;align-items:center;gap:8px;margin-top:14px;">
      <input type="checkbox" id="mEppActivo" ${it.activo?'checked':''} style="width:auto;"> Activo (aparece en el checklist)
    </label>
    <button class="btn btn-primary" onclick="guardarEpp(${id||'null'})">Guardar</button>
    ${id?`<button class="btn btn-danger" onclick="eliminarEpp(${id})">Eliminar elemento</button>`:''}
  `);
}
async function guardarEpp(id){
  const nombre = document.getElementById('mEppNombre').value.trim();
  const activo = document.getElementById('mEppActivo').checked;
  if(!nombre){ toast('El nombre es obligatorio'); return; }
  const obj = {nombre,activo};
  if(id) obj.id = id;
  await put('eppItems', obj);
  cerrarModal();
  toast('Elemento EPP guardado');
  await loadPersonal();
}
async function eliminarEpp(id){
  if(!confirm('¿Eliminar este elemento EPP? Los registros históricos conservarán el nombre guardado.')) return;
  await del('eppItems', id);
  cerrarModal();
  toast('Elemento eliminado');
  await loadPersonal();
}

// ============================================================
// EXPORTAR A EXCEL
// ============================================================
function nombreHojaSeguro(nombre, usados){
  let base = nombre.replace(/[\\/*?:\[\]]/g,'').slice(0,28).trim() || 'Colaborador';
  let final = base, n=2;
  while(usados.has(final)){ final = `${base} (${n++})`; }
  usados.add(final);
  return final;
}

async function exportarExcel(){
  const desde = document.getElementById('expDesde').value;
  const hasta = document.getElementById('expHasta').value;
  const personas = await getAll('personas');
  let registros = await getAll('registros');
  if(desde) registros = registros.filter(r=>r.fecha>=desde);
  if(hasta) registros = registros.filter(r=>r.fecha<=hasta);

  if(registros.length===0){ toast('No hay registros en el rango seleccionado'); return; }

  const wb = XLSX.utils.book_new();

  // ---- Hoja resumen ----
  const resumenFilas = [['Colaborador','Cargo','N° de registros','% Cumplimiento','Último registro']];
  const porPersona = {};
  registros.forEach(r=>{
    (porPersona[r.personaId] = porPersona[r.personaId]||[]).push(r);
  });
  personas.forEach(p=>{
    const regs = porPersona[p.id]||[];
    if(regs.length===0) return;
    let totalItems=0, totalOk=0;
    regs.forEach(r=>r.items.forEach(it=>{totalItems++; if(it.cumple) totalOk++;}));
    const pct = totalItems? Math.round((totalOk/totalItems)*100) : 0;
    const ultima = regs.reduce((a,b)=>a.fecha>b.fecha?a:b).fecha;
    resumenFilas.push([p.nombre, p.cargo||'', regs.length, pct+'%', fmtFecha(ultima)]);
  });
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenFilas);
  wsResumen['!cols'] = [{wch:24},{wch:20},{wch:14},{wch:16},{wch:14}];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  // ---- Una hoja por colaborador ----
  const nombresUsados = new Set(['Resumen']);
  const mapaPersonas = Object.fromEntries(personas.map(p=>[p.id,p]));

  Object.keys(porPersona).forEach(pid=>{
    const persona = mapaPersonas[pid] || {nombre:`Colaborador ${pid}`};
    const regs = [...porPersona[pid]].sort((a,b)=>a.fecha.localeCompare(b.fecha));

    // columnas EPP: unión de todos los nombres de items usados por esta persona
    const columnasEpp = [];
    regs.forEach(r=>r.items.forEach(it=>{
      if(!columnasEpp.includes(it.nombre)) columnasEpp.push(it.nombre);
    }));

    const encabezado = ['Fecha','Inspector', ...columnasEpp, 'Cumplimiento general','Observaciones'];
    const filas = [encabezado];
    regs.forEach(r=>{
      const mapaItems = Object.fromEntries(r.items.map(it=>[it.nombre, it.cumple]));
      const fila = [fmtFecha(r.fecha), r.inspector||''];
      columnasEpp.forEach(col=>{
        fila.push(col in mapaItems ? (mapaItems[col] ? 'Cumple' : 'No cumple') : '—');
      });
      const ok = r.items.every(it=>it.cumple);
      fila.push(ok ? 'Cumple' : 'No cumple');
      fila.push(r.observaciones||'');
      filas.push(fila);
    });

    const ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!cols'] = [{wch:12},{wch:18}, ...columnasEpp.map(()=>({wch:16})), {wch:18}, {wch:28}];
    const nombreHoja = nombreHojaSeguro(persona.nombre, nombresUsados);
    XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
  });

  const rango = (desde||hasta) ? `_${desde||'inicio'}_a_${hasta||'hoy'}` : '';
  XLSX.writeFile(wb, `Verificacion_EPP_Megablessing${rango}.xlsx`);
  toast('Excel generado ✅');
}

// ============================================================
// LOGO (para PDFs)
// ============================================================
let logoBase64Cache = null;
async function obtenerLogoBase64(){
  if(logoBase64Cache) return logoBase64Cache;
  try{
    const resp = await fetch('img/imagotipo-rojo.jpg');
    const blob = await resp.blob();
    logoBase64Cache = await new Promise((res)=>{
      const reader = new FileReader();
      reader.onloadend = ()=>res(reader.result);
      reader.readAsDataURL(blob);
    });
  }catch(e){ logoBase64Cache = null; }
  return logoBase64Cache;
}

// ============================================================
// EXPORTAR PDF
// ============================================================
async function pdfRegistroIndividual(id){
  const { jsPDF } = window.jspdf;
  const registros = await getAll('registros');
  const r = registros.find(x=>x.id===id);
  const persona = (await getAll('personas')).find(p=>p.id===r.personaId) || {nombre:'—'};
  const logo = await obtenerLogoBase64();

  const doc = new jsPDF({unit:'mm', format:'a4'});
  let y = 18;
  if(logo){ try{ doc.addImage(logo, 'JPEG', 15, 10, 42, 12); }catch(e){} y = 30; }
  doc.setFont('helvetica','bold'); doc.setFontSize(15);
  doc.setTextColor('#e40421');
  doc.text('Verificación de EPP', 15, y); doc.setTextColor('#000000'); y+=6;
  doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(100);
  doc.text('Megablessing S.C.', 15, y); doc.setTextColor(0); y+=6;
  doc.setDrawColor(228,4,33); doc.setLineWidth(0.6); doc.line(15,y,195,y); doc.setLineWidth(0.2); y+=8;

  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.text(`Colaborador: ${persona.nombre}`, 15, y); y+=6;
  doc.text(`Cargo / área: ${persona.cargo||'—'}`, 15, y); y+=6;
  doc.text(`Fecha: ${fmtFecha(r.fecha)}`, 15, y); y+=6;
  doc.text(`Inspector: ${r.inspector||'—'}`, 15, y); y+=10;

  doc.setFont('helvetica','bold'); doc.text('Elemento EPP', 15, y);
  doc.text('Resultado', 150, y); y+=2;
  doc.setDrawColor(200); doc.line(15,y,195,y); y+=6;
  doc.setFont('helvetica','normal');

  r.items.forEach(it=>{
    if(y>270){ doc.addPage(); y=20; }
    doc.text(it.nombre, 15, y);
    doc.setTextColor(it.cumple? '#2f7d4f':'#c23b3b');
    doc.text(it.cumple?'Cumple':'No cumple', 150, y);
    doc.setTextColor('#000000');
    y+=7;
  });

  if(r.observaciones){
    y+=4;
    doc.setFont('helvetica','bold'); doc.text('Observaciones:', 15, y); y+=6;
    doc.setFont('helvetica','normal');
    const lineas = doc.splitTextToSize(r.observaciones, 175);
    doc.text(lineas, 15, y); y += lineas.length*5.5+4;
  }

  // fotos de evidencia
  const conFoto = r.items.filter(it=>it.foto);
  if(conFoto.length){
    if(y>230){ doc.addPage(); y=20; }
    doc.setFont('helvetica','bold'); doc.text('Evidencia fotográfica:', 15, y); y+=6;
    let x=15;
    conFoto.forEach(it=>{
      if(x>150){ x=15; y+=45; }
      if(y>230){ doc.addPage(); y=20; x=15; }
      try{ doc.addImage(it.foto, 'JPEG', x, y, 40, 40); }catch(e){}
      doc.setFontSize(8); doc.text(it.nombre.slice(0,22), x, y+44);
      doc.setFontSize(11);
      x+=45;
    });
    y+=52;
  }

  if(r.firma){
    if(y>250){ doc.addPage(); y=20; }
    doc.setFont('helvetica','bold'); doc.text('Firma del inspector:', 15, y); y+=4;
    try{ doc.addImage(r.firma, 'PNG', 15, y, 60, 20); }catch(e){}
  }

  doc.setFontSize(8); doc.setTextColor(150);
  doc.text(`Generado el ${new Date().toLocaleString('es-EC')}`, 15, 290);

  doc.save(`EPP_${persona.nombre.replace(/\s+/g,'_')}_${r.fecha}.pdf`);
  toast('PDF generado ✅');
}

async function pdfResumenDia(fecha){
  fecha = fecha || hoyISO();
  const { jsPDF } = window.jspdf;
  const registros = (await getAll('registros')).filter(r=>r.fecha===fecha);
  const personas = Object.fromEntries((await getAll('personas')).map(p=>[p.id,p.nombre]));

  if(registros.length===0){ toast('No hay registros de esta fecha para generar el PDF'); return; }
  const logo = await obtenerLogoBase64();

  const doc = new jsPDF({unit:'mm', format:'a4'});
  let y=18;
  if(logo){ try{ doc.addImage(logo, 'JPEG', 15, 10, 42, 12); }catch(e){} y=30; }
  doc.setFont('helvetica','bold'); doc.setFontSize(15);
  doc.setTextColor('#e40421');
  doc.text('Resumen diario de verificación EPP', 15, y); doc.setTextColor(0); y+=7;
  doc.setFontSize(11); doc.setFont('helvetica','normal');
  doc.text(`Megablessing S.C.  ·  Fecha: ${fmtFecha(fecha)}`, 15, y); y+=8;
  doc.setDrawColor(228,4,33); doc.setLineWidth(0.6); doc.line(15,y,195,y); doc.setLineWidth(0.2); y+=8;

  doc.setFont('helvetica','bold');
  doc.text('Colaborador', 15, y); doc.text('Inspector', 100, y); doc.text('Resultado', 165, y);
  y+=2; doc.line(15,y,195,y); y+=6;
  doc.setFont('helvetica','normal');

  registros.sort((a,b)=>(personas[a.personaId]||'').localeCompare(personas[b.personaId]||''));
  registros.forEach(r=>{
    if(y>275){ doc.addPage(); y=20; }
    const ok = r.items.every(it=>it.cumple);
    doc.text(personas[r.personaId]||'—', 15, y);
    doc.text(r.inspector||'—', 100, y);
    doc.setTextColor(ok?'#2f7d4f':'#c23b3b');
    doc.text(ok?'Cumple':'Con faltas', 165, y);
    doc.setTextColor('#000000');
    y+=7;
  });

  doc.setFontSize(8); doc.setTextColor(150);
  doc.text(`Generado el ${new Date().toLocaleString('es-EC')}`, 15, 290);
  doc.save(`Resumen_EPP_${fecha}.pdf`);
  toast('PDF de resumen generado ✅');
}

// ============================================================
// PIN Y ALMACENAMIENTO PERSISTENTE
// ============================================================
async function cambiarPin(){
  const actual = document.getElementById('pinActual').value;
  const nuevo = document.getElementById('pinNuevo').value;
  const confirmar = document.getElementById('pinConfirmar').value;
  const err = document.getElementById('pinCambioErr');
  err.textContent='';

  const pinReal = await getConfig('pin', PIN_DEFAULT);
  if(actual !== pinReal){ err.textContent='El PIN actual no es correcto'; return; }
  if(!/^\d{4}$/.test(nuevo)){ err.textContent='El nuevo PIN debe tener 4 dígitos'; return; }
  if(nuevo !== confirmar){ err.textContent='Los PIN no coinciden'; return; }

  await setConfig('pin', nuevo);
  document.getElementById('pinActual').value='';
  document.getElementById('pinNuevo').value='';
  document.getElementById('pinConfirmar').value='';
  toast('PIN actualizado ✅');
}

async function actualizarEstadoStorage(){
  const cont = document.getElementById('estadoStorage');
  if(!cont) return;
  if(navigator.storage && navigator.storage.persisted){
    const persistido = await navigator.storage.persisted();
    cont.innerHTML = persistido
      ? `<span class="storage-ok">✅ Almacenamiento persistente activo — los datos no se borrarán automáticamente.</span>`
      : `<span class="storage-warn">⚠️ Aún no confirmado por el navegador. Toca el botón de abajo o instala la app en la pantalla de inicio para reforzarlo.</span>`;
  } else {
    cont.innerHTML = `<span class="storage-warn">Tu navegador no informa este estado, pero los datos igual se guardan localmente en el dispositivo.</span>`;
  }
}
async function solicitarStoragePersistente(){
  if(navigator.storage && navigator.storage.persist){
    await navigator.storage.persist();
  }
  await actualizarEstadoStorage();
  toast('Solicitud enviada al navegador');
}

// ============================================================
// RESPALDO JSON
// ============================================================
async function exportarJSON(){
  const data = {
    personas: await getAll('personas'),
    eppItems: await getAll('eppItems'),
    registros: await getAll('registros'),
    exportadoEn: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `respaldo_epp_megablessing_${hoyISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Respaldo exportado');
}
async function importarJSON(evt){
  const file = evt.target.files[0];
  if(!file) return;
  if(!confirm('Importar reemplazará todos los datos actuales. ¿Continuar?')) { evt.target.value=''; return; }
  const text = await file.text();
  try{
    const data = JSON.parse(text);
    await clearStore('personas');
    await clearStore('eppItems');
    await clearStore('registros');
    for(const p of data.personas||[]) await put('personas', p);
    for(const it of data.eppItems||[]) await put('eppItems', it);
    for(const r of data.registros||[]) await put('registros', r);
    toast('Respaldo importado ✅');
    await loadDashboard();
  }catch(err){
    toast('Error al importar el archivo');
  }
  evt.target.value='';
}
function clearStore(store){
  return new Promise((res,rej)=>{
    const r = tx(store,'readwrite').clear();
    r.onsuccess=()=>res();
    r.onerror=()=>rej(r.error);
  });
}

// ============================================================
// INICIO
// ============================================================
window.onerror = function(msg, src, line, col, err){
  mostrarErrorArranque(`${msg} (línea ${line})`);
};

function mostrarErrorArranque(detalle){
  const box = document.querySelector('.login-box');
  if(!box) return;
  box.innerHTML = `
    <div class="logo">⚠️</div>
    <h1>No se pudo iniciar la app</h1>
    <p style="text-align:left;font-size:12px;line-height:1.5;">
      Esto casi siempre pasa cuando la app se abre dentro de un empaquetado Android (WebView) que carga los archivos
      como <b>file://</b> en lugar de <b>https://</b>. El almacenamiento local (IndexedDB) no funciona bien así.<br><br>
      <b>Solución recomendada:</b> configura el WebView de tu app Android para que cargue la URL de GitHub Pages
      (https://...) en vez de los archivos locales del APK.<br><br>
      <b>Detalle técnico:</b> ${detalle}
    </p>
  `;
}

(async function(){
  try{
    if(!window.indexedDB) throw new Error('IndexedDB no disponible en este navegador/WebView');
    await initDB();
    await setupLogin();
  }catch(err){
    mostrarErrorArranque(err.message || String(err));
  }
})();
