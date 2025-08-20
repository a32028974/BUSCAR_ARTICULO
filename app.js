// === CONFIG ===
const API = 'https://script.google.com/macros/s/AKfycbwqmOI-R_htTcfnaFrdI8943665CCLHYWr29GiSTw8qaAwzyXsKx4WXpJ2WtqQVWTq5IQ/exec'; // <-- pegá acá tu Web App de la hoja Stock
const CACHE_KEY = 'stock_cache_v5';           // nueva versión de caché para no mezclar datos viejos
const CACHE_TTL_MIN = 15;                     // minutos

// Traduce los encabezados del Sheet a las claves que usa la UI
const MAP = {
  'N ANTEOJO': 'n_anteojo',
  'MARCA': 'marca',
  'MODELO': 'modelo',
  'COLOR': 'color',
  'FAMILIA': 'familia',
  'CRISTAL': 'cristal_color',
  'COLOR CRISTAL': 'cristal_color',
  'CALIBRE': 'calibre',
  'PRECIO PUBLICO': 'precio',
  'FECHA INGRESO': 'fecha_ingreso',
  'FECHA DE VENTA': 'fecha_venta',
  'VENDEDOR': 'vendedor',
  'CODIGO DE BARRAS': 'codigo_barras',
  'OBSERVACIONES': 'observaciones',
  'ARMAZON': 'armazon',
  'FÁBRICA': 'fabrica',
  'FABRICA': 'fabrica'
};

// === HELPERS ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatMoney(v){
  if (v == null || v === '') return '';
  const num = Number(String(v).toString().replace(/\./g,'').replace(',', '.'));
  if (Number.isNaN(num)) return v;
  return num.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}
function toDate(s){
  if (!s) return null;
  if (/\d{2}\/\d{2}\/\d{2,4}/.test(s)) {
    const [d,m,y] = s.split('/');
    const yy = y.length===2 ? '20'+y : y;
    const iso = `${yy}-${m}-${d}`;
    const dt = new Date(iso);
    return isNaN(dt) ? null : dt;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function formatShortDate(s){
  const d = toDate(s);
  return d ? d.toLocaleDateString('es-AR') : '';
}
function debounce(fn, ms=250){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}
function setStatus(msg, color){
  const el = $('#status'); if (!el) return;
  el.textContent = msg || '';
  el.style.color = color || 'inherit';
}
function setLastSync(ts){
  const el = $('#lastSync'); if (!el) return;
  if (!ts) { el.textContent=''; return; }
  const d = new Date(ts);
  el.textContent = `Actualizado: ${d.toLocaleString('es-AR')}`;
}
function normHeader(h){
  return String(h||'')
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // sin tildes
    .toUpperCase();
}
// --- CONTROL DE CARGA (evita spinner pegado) ---
let LOADING = 0;
function setLoading(on){
  LOADING = Math.max(0, LOADING + (on ? 1 : -1));
  const sp = document.getElementById('spinner');
  if (sp) sp.hidden = (LOADING === 0);
}
// por si algo falla en background, auto-ocultá a los 12s
function loadingFailsafe(){
  setTimeout(()=>{ LOADING = 0; const sp = document.getElementById('spinner'); if (sp) sp.hidden = true; }, 12000);
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
    if (key==='n_anteojo' || key==='calibre' || key==='precio'){
      const na = Number(a[key]) || 0;
      const nb = Number(b[key]) || 0;
      return (na-nb)*mult;
    }
    if (key==='fecha_ingreso' || key==='fecha_venta'){
      const da = toDate(a[key]) ? toDate(a[key]).getTime() : 0;
      const db = toDate(b[key]) ? toDate(b[key]).getTime() : 0;
      return (da-db)*mult;
    }
    if (va<vb) return -1*mult;
    if (va>vb) return  1*mult;
    return 0;
  });
}

// === FILTRO ===
function filterRows(){
  setLoading(false); // si quedó pegado, lo baja
  const q = $('#q').value.trim().toLowerCase();
  const fam = $('#familia').value;
  const estado = $('#estadoVenta').value; // DISPONIBLE / VENDIDO

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
function clearCacheAndReload(){
  localStorage.removeItem(CACHE_KEY);
  fetchAll();
}

// === FETCH ===
async function fetchAll(){
  setLoading(true);
setStatus('Cargando…');
loadingFailsafe();

  try{
    const res = await fetch(`${API}?todos=true`, { method:'GET' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();

    let rows = [];
    if (json && Array.isArray(json.rows)) {
      const headers = (json.headers || []).map(h => String(h||'').trim());
      const dynamicMap = {};
      headers.forEach(h=>{
        const k = normHeader(h);
        if (MAP[k]) dynamicMap[h] = MAP[k];
      });

      rows = json.rows.map(r=>{
        const rec = (r && typeof r === 'object' && !Array.isArray(r)) ? r :
                    (Array.isArray(r) ? Object.fromEntries(headers.map((h,i)=>[h, r[i]])) : {});
        const o = {};
        Object.keys(rec).forEach(h=>{
          const key = dynamicMap[h] || MAP[normHeader(h)] || null;
          if (key) o[key] = rec[h];
        });
        return o;
      });
    } else if (Array.isArray(json)) {
      rows = json; // compat
    } else {
      throw new Error('Forma de respuesta inesperada');
    }

    // Mostrar SOLO filas válidas de la hoja Stock
    rows = rows.filter(r => {
      const nOk = /\d/.test(String(r.n_anteojo || '').trim());
      const infoOk = (r.marca || r.modelo || r.color || r.codigo_barras);
      return nOk || infoOk;
    });

    // Orden inicial por N°
    sortKey = 'n_anteojo';
    sortDir = 'asc';

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
    setLoading(false);
filterRows();

  }
}

// === INIT ===
function attachEvents(){
  $('#q').addEventListener('input', debounce(filterRows, 200));
  $('#familia').addEventListener('change', filterRows);
  $('#estadoVenta').addEventListener('change', filterRows);
  $('#clearBtn').addEventListener('click', ()=>{
    $('#q').value=''; $('#familia').value=''; $('#estadoVenta').value='';
    filterRows();
  });
  $('#reloadBtn').addEventListener('click', ()=>{ fetchAll(); });
  $('#forceBtn').addEventListener('click', ()=>{ clearCacheAndReload(); });

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
