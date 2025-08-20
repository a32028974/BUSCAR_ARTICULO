/* ===== Versión (debe coincidir con index.html) ===== */
const APP_VERSION = '2025-08-20_13-20';

// Limpieza automática de caches locales si cambió la versión
(() => {
  const last = localStorage.getItem('APP_VERSION');
  if (last !== APP_VERSION) {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('APP_VERSION', APP_VERSION);
  }
})();

/** URL de tu WebApp (tu Apps Script actual, NO lo cambiamos) */
const API = 'https://script.google.com/macros/s/AKfycbye3RORWk2HZFBdKayrKXKMM1jACMg14YZPIhxXNVo-yuLMlYpIsQAuCIWh2IlZLRF2ZA/exec';

/** Encabezados oficiales de la hoja (exactos) */
const HEADERS_REQUIRED = [
  'N ANTEOJO','MARCA','MODELO','COLOR','ARMAZON','CALIBRE','CRISTAL',
  'FAMILIA','PRECIO PUBLICO','FECHA INGRESO','FECHA DE VENTA','VENDEDOR'
];

/** Orden visual que mostramos (12 columnas) */
const DISPLAY_ORDER = [
  'N ANTEOJO','MARCA','MODELO','COLOR','ARMAZON','CALIBRE',
  'CRISTAL','FAMILIA','PRECIO PUBLICO','FECHA DE VENTA','VENDEDOR','FECHA INGRESO'
];

let stockLocal = [];      // array de objetos { 'N ANTEOJO':..., ... }
let headersActuales = []; // headers devueltos por API (para validar)

/* ---------- Utils ---------- */
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
function ensureHeaders(headers){
  headersActuales = headers || [];
  for (const name of HEADERS_REQUIRED) {
    if (!headersActuales.includes(name)) {
      throw new Error(`Falta la columna requerida: "${name}". Revisá los encabezados de la hoja.`);
    }
  }
}
function fmtFecha(v){
  if (!v) return '';
  // Tu API ya formatea Date -> "dd/MM/yy", igual soportamos otros formatos
  const d = new Date(v);
  if (!isNaN(d)) {
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = d.getFullYear();
    return `${dd}-${mm}-${yy}`;
  }
  if (typeof v === 'string' && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v)) {
    const [dd,mm,yy] = v.split('/');
    const Y = yy.length === 2 ? '20'+yy : yy;
    return `${dd.padStart(2,'0')}-${mm.padStart(2,'0')}-${Y}`;
  }
  return String(v);
}

/* ---------- API wrappers ---------- */
// Devuelve { ok, headers, rows, updatedAt } con filas como OBJETOS
async function apiTodos(n = ''){
  const url = n ? `${API}?todos=true&n=${encodeURIComponent(n)}` : `${API}?todos=true`;
  const r = await fetch(url, { cache: 'no-store' });
  const j = await r.json();
  if (!j || !j.ok) throw new Error(j?.error || 'Error API');
  if (!Array.isArray(j.headers) || !Array.isArray(j.rows)) throw new Error('Respuesta inválida');
  ensureHeaders(j.headers);
  return j;
}

/* ---------- Render ---------- */
function render(rows){
  const tbody = document.getElementById('contenido');
  tbody.innerHTML = '';

  rows.forEach(row => {
    const tr = document.createElement('tr');

    // checkbox con id = N ANTEOJO
    const tdCheck = document.createElement('td');
    const ck = document.createElement('input'); ck.type='checkbox'; ck.checked=true;
    ck.dataset.id = row['N ANTEOJO'] ?? '';
    tdCheck.appendChild(ck); tr.appendChild(tdCheck);

    DISPLAY_ORDER.forEach(name => {
      const td = document.createElement('td');
      let val = row[name];
      const isFecha = (name === 'FECHA DE VENTA' || name === 'FECHA DE INGRESO');
      td.textContent = (val == null || val === '') ? '-' : (isFecha ? fmtFecha(val) : String(val));
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

/* ---------- Acciones UI ---------- */
async function actualizarStock(){
  document.getElementById('spinner').style.display = 'block';
  try{
    const data = await apiTodos(); // todo el stock como objetos
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
    let rows = [];

    if (/^\d+$/.test(q) && !avanzada) {
      // número exacto: pedimos al backend ya filtrado
      const data = await apiTodos(q);
      rows = data.rows;
      // cacheamos por si querés seguir buscando
      localStorage.setItem('stock', JSON.stringify(rows));
      localStorage.setItem('headers', JSON.stringify(data.headers));
    } else {
      // texto o búsqueda avanzada: uso cache si existe, sino bajo todo y filtro
      if (!stockLocal.length) {
        const data = await apiTodos();
        stockLocal = data.rows;
        localStorage.setItem('stock', JSON.stringify(stockLocal));
        localStorage.setItem('headers', JSON.stringify(data.headers));
      }
      const hay = (obj, k) => (obj[k] ?? '').toString().toLowerCase();
      const ql = q.toLowerCase();
      rows = stockLocal.filter(r =>
        hay(r,'MARCA').includes(ql)   ||
        hay(r,'MODELO').includes(ql)  ||
        hay(r,'COLOR').includes(ql)   ||
        hay(r,'ARMAZON').includes(ql) ||
        hay(r,'FAMILIA').includes(ql) ||
        hay(r,'CRISTAL').includes(ql) ||
        String(r['N ANTEOJO']||'').includes(ql)
      );
    }

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
    const t=(performance.now()-inicio).toFixed(2);
    document.getElementById('tiempoBusqueda').textContent=`⏱ Tiempo de búsqueda: ${t} ms`;
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

/* ---------- Exponer funciones a HTML ---------- */
window.buscarAnteojo = buscarAnteojo;
window.actualizarStock = actualizarStock;
window.ordenarPor = ordenarPor;
window.limpiar = limpiar;

window.onload = () => {
  document.getElementById('codigo').focus();

  // restaurar cache si lo hay
  try{
    const h = localStorage.getItem('headers');
    const s = localStorage.getItem('stock');
    if (h && s) {
      headersActuales = JSON.parse(h);
      ensureHeaders(headersActuales);
      stockLocal = JSON.parse(s);
      document.getElementById('ultimaActualizacion').textContent = 'Base de datos actualizada: (cache local)';
    }
  }catch{}

  document.getElementById('codigo').addEventListener('keydown', e=>{
    if (e.key === 'Enter'){ e.preventDefault(); buscarAnteojo(); }
  });
};
