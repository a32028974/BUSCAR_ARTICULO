/* ===== Versión (debe coincidir con index.html) ===== */
const APP_VERSION = '2025-08-20_11-05';

// Limpieza automática de cachés locales si cambió la versión
(() => {
  const last = localStorage.getItem('APP_VERSION');
  if (last !== APP_VERSION) {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('APP_VERSION', APP_VERSION);
  }
})();

/** URL del Apps Script NUEVO (abajo tenés el código del backend) */
const API = 'https://script.google.com/macros/s/AKfycby6SzAgXhtctDbYEGETB6Ku8X_atugp7Mld5QvimnDpXMmHU9IxW9XRqDkRI0rGONr85Q/exec';

/** Encabezados oficiales del Sheet (NO los cambiamos) */
const HEADERS_REQUIRED = [
  'N ANTEOJO','MARCA','MODELO','COLOR','ARMAZON','CALIBRE','CRISTAL',
  'FAMILIA','PRECIO PUBLICO','FECHA INGRESO','FECHA DE VENTA','VENDEDOR',
  'COSTO','CODIGO DE BARRAS','OBSERVACIONES','FÁBRICA'
];

/** Orden visual (12 columnas que mostramos) */
const DISPLAY_ORDER = [
  'N ANTEOJO','MARCA','MODELO','COLOR','ARMAZON','CALIBRE',
  'CRISTAL','FAMILIA','PRECIO PUBLICO','FECHA DE VENTA','VENDEDOR','FECHA INGRESO'
];

let stockLocal = []; // siempre arrays
let headerIndex = {}; // nombre -> índice

/* -------- Utils -------- */
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
function buildIndex(headers){
  headerIndex = {};
  headers.forEach((h,i)=>{ headerIndex[norm(h)] = i; });

  // validar requeridas
  for (const name of HEADERS_REQUIRED){
    if (!(norm(name) in headerIndex)) {
      throw new Error(`Falta la columna requerida: "${name}" en la hoja (headers recibidos: ${headers.join(', ')})`);
    }
  }
}
function fmtDate(v){
  if (!v) return '';
  const d = new Date(v);
  if (!isNaN(d)) {
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = d.getFullYear();
    return `${dd}-${mm}-${yy}`;
  }
  if (typeof v === 'string' && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)) {
    const [dd,mm,yy] = v.split('/');
    const full = yy.length === 2 ? ('20'+yy) : yy;
    return `${dd.padStart(2,'0')}-${mm.padStart(2,'0')}-${full}`;
  }
  return String(v);
}

/* -------- API wrappers (sin caché) -------- */
async function apiTodos() {
  const r = await fetch(`${API}?todos=1`, { cache: 'no-store' });
  const j = await r.json();
  if (!j || !j.ok) throw new Error(j && j.error || 'Error API');
  if (!Array.isArray(j.headers) || !Array.isArray(j.rows)) throw new Error('Respuesta inválida');
  buildIndex(j.headers);
  return j; // { ok, headers, rows, updatedAt }
}
async function apiBuscarNumero(n) {
  const r = await fetch(`${API}?n=${encodeURIComponent(n)}`, { cache: 'no-store' });
  const j = await r.json();
  if (!j || !j.ok) throw new Error(j && j.error || 'Error API');
  if (!Array.isArray(j.headers) || !Array.isArray(j.rows)) throw new Error('Respuesta inválida');
  buildIndex(j.headers);
  return j;
}
async function apiBuscarTexto(q) {
  const r = await fetch(`${API}?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
  const j = await r.json();
  if (!j || !j.ok) throw new Error(j && j.error || 'Error API');
  if (!Array.isArray(j.headers) || !Array.isArray(j.rows)) throw new Error('Respuesta inválida');
  buildIndex(j.headers);
  return j;
}

/* -------- Render -------- */
function render(rows){
  const tbody = document.getElementById('contenido');
  tbody.innerHTML = '';

  const get = (row, name) => row[ headerIndex[norm(name)] ];

  rows.forEach(row => {
    const tr = document.createElement('tr');

    const tdCheck = document.createElement('td');
    const ck = document.createElement('input'); ck.type='checkbox'; ck.checked=true;
    ck.dataset.id = get(row, 'N ANTEOJO');
    tdCheck.appendChild(ck); tr.appendChild(tdCheck);

    DISPLAY_ORDER.forEach(name => {
      const td = document.createElement('td');
      let val = get(row, name);
      if (name === 'FECHA DE VENTA' || name === 'FECHA DE INGRESO') val = fmtDate(val) || '-';
      td.textContent = (val == null || val === '') ? '-' : String(val);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  document.getElementById('resultado').style.display = 'block';
}

let ordenAsc = true;
function ordenarPor(indiceVisual){
  const tbody = document.getElementById('contenido');
  const filas = Array.from(tbody.querySelectorAll('tr'));
  filas.sort((a,b)=>{
    const A=a.children[indiceVisual+1].textContent.trim();
    const B=b.children[indiceVisual+1].textContent.trim();
    const nA=Number(A.replace(/[^0-9.-]/g,'')), nB=Number(B.replace(/[^0-9.-]/g,''));
    if(!isNaN(nA)&&!isNaN(nB)) return ordenAsc ? nA-nB : nB-nA;
    return ordenAsc ? A.localeCompare(B) : B.localeCompare(A);
  });
  ordenAsc=!ordenAsc; filas.forEach(f=>tbody.appendChild(f));
}

/* -------- Acciones UI -------- */
async function actualizarStock(){
  document.getElementById('spinner').style.display = 'block';
  try{
    const data = await apiTodos(); // {headers, rows, updatedAt}
    stockLocal = data.rows;
    localStorage.setItem('stock', JSON.stringify(stockLocal));
    localStorage.setItem('headers', JSON.stringify(data.headers));
    const fecha = data.updatedAt || new Date().toLocaleString();
    document.getElementById('ultimaActualizacion').textContent = 'Base de datos actualizada: ' + fecha;
    Swal.fire({icon:'success',title:'Stock actualizado',timer:1000,showConfirmButton:false});
  }catch(e){
    console.error(e);
    Swal.fire('❌ '+e.message);
  }finally{
    document.getElementById('spinner').style.display = 'none';
  }
}

async function buscarAnteojo(){
  const input = document.getElementById('codigo');
  const q = String(input.value||'').trim();
  const avanzada = document.getElementById('busquedaAvanzada').checked;
  if (!q) { Swal.fire('Ingresá un número o texto'); return; }

  const inicio = performance.now();
  document.getElementById('spinner').style.display='block';
  document.getElementById('tiempoBusqueda').textContent='';
  document.getElementById('cantidadResultados').textContent='';

  try{
    let data;
    if (!avanzada && /^\d+$/.test(q) && stockLocal.length) {
      // usar cache local si coincide exacto por número
      const headers = JSON.parse(localStorage.getItem('headers')||'[]');
      buildIndex(headers);
      const idxNum = headerIndex[norm('N ANTEOJO')];
      const res = stockLocal.filter(r => String(r[idxNum]).replace(/\D+/g,'') === q);
      data = { rows: res, headers };
    } else {
      // ir a la API con headers garantizados
      data = /^\d+$/.test(q) ? await apiBuscarNumero(q) : await apiBuscarTexto(q);
    }

    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length){
      document.getElementById('resultado').style.display='none';
      document.getElementById('cantidadResultados').textContent='No se encontraron resultados.';
    } else {
      render(rows);
      document.getElementById('cantidadResultados').textContent = `🔎 Se encontraron ${rows.length} resultado(s).`;
    }
  }catch(e){
    console.error(e);
    Swal.fire('❌ '+e.message);
  }finally{
    document.getElementById('spinner').style.display='none';
    const t = (performance.now()).toFixed(2);
    document.getElementById('tiempoBusqueda').textContent = `⏱ Tiempo de búsqueda: ${t} ms`;
  }
}

function limpiar(){
  document.getElementById('codigo').value='';
  document.getElementById('contenido').innerHTML='';
  document.getElementById('resultado').style.display='none';
  document.getElementById('spinner').style.display='none';
  document.getElementById('tiempoBusqueda').textContent='';
  document.getElementById('cantidadResultados').textContent='';
  document.getElementById('codigo').focus();
}

window.buscarAnteojo = buscarAnteojo;
window.actualizarStock = actualizarStock;
window.ordenarPor = ordenarPor;
window.limpiar = limpiar;

window.onload = () => {
  document.getElementById('codigo').focus();

  const headers = localStorage.getItem('headers');
  const stock   = localStorage.getItem('stock');
  if (headers && stock){
    try{
      buildIndex(JSON.parse(headers));
      stockLocal = JSON.parse(stock);
      document.getElementById('ultimaActualizacion').textContent =
        'Base de datos actualizada: (cache local)';
    }catch{}
  }

  document.getElementById('codigo').addEventListener('keydown', e=>{
    if (e.key === 'Enter'){ e.preventDefault(); buscarAnteojo(); }
  });
};
