// === CONFIG ===
const API = 'https://script.google.com/macros/s/AKfycby6SzAgXhtctDbYEGETB6Ku8X_atugp7Mld5QvimnDpXMmHU9IxW9XRqDkRI0rGONr85Q/exec'; // <-- pegá acá tu Web App URL. Ej: https://script.google.com/macros/s/AKfy....../exec
const CACHE_KEY = 'stock_cache_v1';
const CACHE_TTL_MIN = 15; // minutos

// Traduce los encabezados del Sheet a las claves que usa la UI
const MAP = {
  'N ANTEOJO': 'n_anteojo',
  'MARCA': 'marca',
  'MODELO': 'modelo',
  'COLOR': 'color',
  'FAMILIA': 'familia',
  'CRISTAL': 'cristal_color',        // tu script usa "CRISTAL"
  'COLOR CRISTAL': 'cristal_color',   // por si viene así
  'CALIBRE': 'calibre',
  'PRECIO PUBLICO': 'precio',
  'FECHA INGRESO': 'fecha_ingreso',
  'FECHA DE VENTA': 'fecha_venta',
  'VENDEDOR': 'vendedor',
  'CODIGO DE BARRAS': 'codigo_barras',
  'OBSERVACIONES': 'observaciones',
  'ARMAZON': 'armazon',               // opcional, no lo muestro en tabla
  'FÁBRICA': 'fabrica',
  'FABRICA': 'fabrica'
};

// === HELPERS ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatMoney(v){
  if (v === null || v === undefined || v === '') return '';
  const num = Number(v);
  if (Number.isNaN(num)) return v;
  return num.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}
function toDate(s){
  // admite "dd/mm/yy" o ISO
  if (!s) return '';
  if (/\d{2}\/\d{2}\/\d{2,4}/.test(s)) {
    const [d,m,y] = s.split('/');
    const yy = y.length===2 ? '20'+y : y;
    return new Date(`${yy}-${m}-${d}`);
  }
  const d = new Date(s);
  return isNaN(d) ? '' : d;
}
function formatShortDate(s){
  const d = toDate(s);
  if (!d) return '';
  return d.toLocaleDateString('es-AR');
}
function debounce(fn, ms=250){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}
function setStatus(msg, color){
  const el = $('#status');
  el.textContent = msg || '';
  el.style.color = color || 'inherit';
}
function setLastSync(ts){
  const el = $('#lastSync');
  if (!ts) { el.textContent=''; return; }
  const d = new Date(ts);
  el.textContent = `Actualizado: ${d.toLocaleString('es-AR')}`;
}

// === ESTADO ===
let DATA = [];
let sortKey = 'n_anteojo';
let sortDir = 'asc';

// === RENDER ===
function render(rows){
  const tbody = $('#tbody');
  tbody.innerHTML = '';
  if (!rows.length){
    $('#empty').hidden = false;
    $('#count').textContent = '0 resultados';
    return;
  }
  $('#empty').hidden = true;
  $('#count').textContent = `${rows.length} resultado${rows.length!==1?'s':''}`;

  const frag = document.createDocumentFragment();
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.n_anteojo ?? ''}</td>
      <td>${r.marca ?? ''}</td>
      <td>${r.modelo ?? ''}</td>
      <td>${r.color ?? ''}</td>
      <td>${r.familia ?? ''}</td>
      <td>${r.cristal_color ?? ''}</td>
      <td>${r.calibre ?? ''}</td>
      <td>${formatMoney(r.precio)}</td>
      <td>${formatShortDate(r.fecha_ingreso)}</td>
      <td>${formatShortDate(r.fecha_venta)}</td>
      <td>${r.vendedor ?? ''}</td>
      <td>${r.codigo_barras ?? ''}</td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// === ORDEN ===
function sortRows(rows, key, dir='asc'){
  const mult = dir==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    const va = (a[key] ?? '').toString().toLowerCase();
    const vb = (b[key] ?? '').toString().toLowerCase();
    // num
    if (key==='n_anteojo' || key==='calibre' || key==='precio'){
      const na = Number(a[key]) || 0;
      const nb = Number(b[key]) || 0;
      return (na-nb)*mult;
    }
    // fecha
    if (key==='fecha_ingreso' || key==='fecha_venta'){
      const da = toDate(a[key]) ? toDate(a[key]).getTime() : 0;
      const db = toDate(b[key]) ? toDate(b[key]).getTime() : 0;
      return (da-db)*mult;
    }
    // texto
    if (va<vb) return -1*mult;
    if (va>vb) return  1*mult;
    return 0;
  });
}

// === FILTRO ===
function filterRows(){
  const q = $('#q').value.trim().toLowerCase();
  const fam = $('#familia').value;
  const estado = $('#estadoVenta').value; // DISPONIBLE vs VENDIDO

  let rows = DATA;

  if (q){
    rows = rows.filter(r=>{
      return String(r.n_anteojo ?? '').toLowerCase().includes(q)
          || String(r.marca ?? '').toLowerCase().includes(q)
          || String(r.modelo ?? '').toLowerCase().includes(q)
          || String(r.color ?? '').toLowerCase().includes(q)
          || String(r.codigo_barras ?? '').toLowerCase().includes(q);
    });
  }

  if (fam){
    rows = rows.filter(r=> (r.familia || '').toUpperCase()===fam);
  }

  if (estado){
    if (estado==='DISPONIBLE') rows = rows.filter(r=> !r.fecha_venta);
    if (estado==='VENDIDO')    rows = rows.filter(r=> !!r.fecha_venta);
  }

  rows = sortRows(rows, sortKey, sortDir);
  render(rows);
}

// === CACHE ===
function getCache(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const ageMin = (Date.now()-obj.ts)/60000;
    if (ageMin > CACHE_TTL_MIN) return null;
    return obj;
  }catch{ return null; }
}
function setCache(data){
  localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
}

// === FETCH ===
async function fetchAll(){
  $('#spinner').hidden = false;
  setStatus('Cargando…');
  try{
    const res = await fetch(`${API}?todos=true`, { method:'GET' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();

    // Tu Apps Script retorna { ok, headers, rows, ... }
    let rows = [];
    if (Array.isArray(json)) {
      // caso antiguo (no aplica acá), pero lo tolero
      rows = json;
    } else if (json && Array.isArray(json.rows)) {
      const headers = json.headers || [];
      // rows = array de objetos con claves EXACTAS de encabezado; mapeo a las claves internas
      rows = json.rows.map(r => {
        const o = {};
        // cada r ya viene como objeto { 'N ANTEOJO':..., 'MARCA': ... }
        Object.keys(r).forEach(h => {
          const key = MAP[h?.toString().trim().toUpperCase()];
          if (key) o[key] = r[h];
        });
        return o;
      });
    } else {
      throw new Error('Forma de respuesta inesperada');
    }

    DATA = rows;
    setCache(DATA);
    setLastSync(Date.now());
    setStatus('Listo', 'var(--accent)');
  }catch(e){
    console.error('fetchAll error:', e);
    setStatus('Error al cargar. Uso copia local si existe.', 'var(--danger)');
    const cached = getCache();
    if (cached){
      DATA = cached.data;
      setLastSync(cached.ts);
    }else{
      DATA = [];
    }
  }finally{
    $('#spinner').hidden = true;
    filterRows();
  }
}


// === INIT ===
function attachEvents(){
  // búsqueda con debounce
  $('#q').addEventListener('input', debounce(filterRows, 200));
  $('#familia').addEventListener('change', filterRows);
  $('#estadoVenta').addEventListener('change', filterRows);
  $('#clearBtn').addEventListener('click', ()=>{
    $('#q').value=''; $('#familia').value=''; $('#estadoVenta').value='';
    filterRows();
  });
  $('#reloadBtn').addEventListener('click', ()=>{
    // invalido cache y recargo
    localStorage.removeItem(CACHE_KEY);
    fetchAll();
  });

  // ordenar por encabezado
  document.querySelectorAll('th[data-sort]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.getAttribute('data-sort');
      if (sortKey===key){ sortDir = (sortDir==='asc'?'desc':'asc'); }
      else { sortKey=key; sortDir='asc'; }
      filterRows();
    });
  });
}

(function start(){
  attachEvents();
  const cached = getCache();
  if (cached){
    DATA = cached.data;
    setLastSync(cached.ts);
    filterRows();
    // refresco en background
    fetchAll();
  }else{
    fetchAll();
  }
})();
