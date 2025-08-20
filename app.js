// === CONFIG ===
const API = 'https://script.google.com/macros/s/AKfycbwqmOI-R_htTcfnaFrdI8943665CCLHYWr29GiSTw8qaAwzyXsKx4WXpJ2WtqQVWTq5IQ/exec';
const CACHE_KEY = 'stock_cache_v8';
const CACHE_TTL_MIN = 15; // minutos

// Traduce encabezados del Sheet a claves internas
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
const $  = (sel) => document.querySelector(sel);
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
    const dt = new Date(`${yy}-${m}-${d}`);
    return isNaN(dt) ? null : dt;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function formatShortDate(s){
  const d = toDate(s);
  return d ? d.toLocaleDateString('es-AR') : '';
}
function debounce(fn, ms=250){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }; }
function setStatus(msg, color){ const el=$('#status'); if (!el) return; el.textContent=msg||''; el.style.color=color||'var(--accent)'; }
function setLastSync(ts){ const el=$('#lastSync'); if(!el) return; el.textContent = ts ? `Actualizado: ${new Date(ts).toLocaleString('es-AR')}` : ''; }
function normHeader(h){ return String(h||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(); }
function norm(s){ return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// --- Resaltado tolerante a tildes ---
function tokenToRegexFrag(t){
  return esc(t)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/a/gi, '[aáàäâã]')
    .replace(/e/gi, '[eéèêë]')
    .replace(/i/gi, '[iíïìî]')
    .replace(/o/gi, '[oóòôöõ]')
    .replace(/u/gi, '[uúùûü]')
    .replace(/n/gi, '[nñ]')
    .replace(/c/gi, '[cç]');
}
function highlightText(str, tokensRaw){
  if (str == null || str === '') return '';
  let s = String(str);
  const toks = (tokensRaw||[]).map(t=>String(t).trim()).filter(Boolean);
  if (!toks.length) return esc(s);
  toks.sort((a,b)=>b.length-a.length);
  for (const t of toks){
    const frag = tokenToRegexFrag(t);
    const re = new RegExp(`(${frag})`, 'gi');
    s = s.replace(re, '\u0001$1\u0002');
  }
  s = esc(s).replace(/\u0001/g, '<span class="hl">').replace(/\u0002/g, '</span>');
  return s;
}

// --- CONTROL DE CARGA (spinner sólido) ---
let LOADING = 0;
function setLoading(on){
  const sp = $('#spinner'); if (!sp) return;
  LOADING = Math.max(0, LOADING + (on ? 1 : -1));
  const show = LOADING > 0;
  sp.hidden = !show;
  if (show) sp.classList.add('show'); else sp.classList.remove('show');
}
function hideSpinnerNow(){ LOADING=0; const sp=$('#spinner'); if(sp){ sp.hidden=true; sp.classList.remove('show'); } }
function loadingFailsafe(){ setTimeout(()=>hideSpinnerNow(), 12000); }

// === ESTADO ===
let DATA = [];
let sortKey = 'n_anteojo';
let sortDir = 'asc';

// === INDEX DE BUSQUEDA (para tokens AND) ===
function buildIndex(arr){
  arr.forEach(r=>{
    r.__q = norm([r.n_anteojo, r.marca, r.modelo, r.color, r.familia, r.cristal_color, r.calibre, r.codigo_barras].join(' '));
  });
}

// === RENDER ===
function render(rows, tokensRaw){
  const tbody = $('#tbody');
  tbody.innerHTML = '';
  if (!rows.length){
    $('#empty').hidden = false;
    $('#count').textContent = '0 resultados';
    hideSpinnerNow();
    return;
  }
  $('#empty').hidden = true;
  $('#count').textContent = `${rows.length} resultado${rows.length!==1?'s':''}`;

  const frag = document.createDocumentFragment();
  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${highlightText(r.n_anteojo, tokensRaw)}</td>
      <td>${highlightText(r.marca, tokensRaw)}</td>
      <td>${highlightText(r.modelo, tokensRaw)}</td>
      <td>${highlightText(r.color, tokensRaw)}</td>
      <td>${highlightText(r.familia, tokensRaw)}</td>
      <td>${highlightText(r.cristal_color, tokensRaw)}</td>
      <td>${highlightText(r.calibre, tokensRaw)}</td>
      <td>${highlightText(formatMoney(r.precio), tokensRaw)}</td>
      <td>${highlightText(formatShortDate(r.fecha_ingreso), tokensRaw)}</td>
      <td>${highlightText(formatShortDate(r.fecha_venta), tokensRaw)}</td>
      <td>${highlightText(r.vendedor, tokensRaw)}</td>
      <td>${highlightText(r.codigo_barras, tokensRaw)}</td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  hideSpinnerNow();
}

// === ORDEN ===
function sortRows(rows, key, dir='asc'){
  const mult = dir==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    const va = (a[key] ?? '').toString().toLowerCase();
    const vb = (b[key] ?? '').toString().toLowerCase();
    if (key==='n_anteojo' || key==='calibre' || key==='precio'){
      const na = Number(a[key]) || 0; const nb = Number(b[key]) || 0; return (na-nb)*mult;
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
  hideSpinnerNow();
  const q = $('#q').value.trim();
  const fam = $('#familia').value;
  const estado = $('#estadoVenta').value;

  let rows = DATA;
  let tokensRaw = [];

  if (q){
    tokensRaw = q.split(/\s+/).filter(Boolean);
    const tokens = tokensRaw.map(norm);
    if (tokens.length){
      rows = rows.filter(r=>{
        const hay = r.__q || (r.__q = norm([r.n_anteojo, r.marca, r.modelo, r.color, r.familia, r.cristal_color, r.calibre, r.codigo_barras].join(' ')));
        return tokens.every(t => hay.includes(t)); // AND
      });
    }
  }

  if (fam){ rows = rows.filter(r=> (r.familia || '').toUpperCase()===fam); }
  if (estado){
    if (estado==='DISPONIBLE') rows = rows.filter(r=> !r.fecha_venta);
    if (estado==='VENDIDO')    rows = rows.filter(r=> !!r.fecha_venta);
  }

  rows = sortRows(rows, sortKey, sortDir);
  render(rows, tokensRaw);
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
function setCache(data){ localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); }
function clearCacheAndReload(){ localStorage.removeItem(CACHE_KEY); fetchAll(); }

// === FETCH ===
let FETCHING = false;
async function fetchAll(){
  if (FETCHING) return;
  FETCHING = true;
  setLoading(true); setStatus('Cargando…'); loadingFailsafe();

  try{
    const res = await fetch(`${API}?todos=true`, { method:'GET' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();

    let rows = [];
    if (json && Array.isArray(json.rows)) {
      const headers = (json.headers || []).map(h => String(h||'').trim());
      const dynamicMap = {};
      headers.forEach(h=>{ const k = normHeader(h); if (MAP[k]) dynamicMap[h] = MAP[k]; });

      rows = json.rows.map(r=>{
        const rec = (r && typeof r === 'object' && !Array.isArray(r)) ? r
                 : (Array.isArray(r) ? Object.fromEntries(headers.map((h,i)=>[h, r[i]])) : {});
        const o = {};
        Object.keys(rec).forEach(h=>{
          const key = dynamicMap[h] || MAP[normHeader(h)] || null;
          if (key) o[key] = rec[h];
        });
        return o;
      });
    } else if (Array.isArray(json)) {
      rows = json;
    } else { throw new Error('Forma de respuesta inesperada'); }

    // Filas válidas de Stock
    rows = rows.filter(r => {
      const nOk = /\d/.test(String(r.n_anteojo || '').trim());
      const infoOk = (r.marca || r.modelo || r.color || r.codigo_barras);
      return nOk || infoOk;
    });

    sortKey = 'n_anteojo'; sortDir = 'asc';
    DATA = rows;
    buildIndex(DATA);
    setCache(DATA);
    setLastSync(Date.now());
    setStatus('Listo', 'var(--accent)');
  }catch(e){
    console.error('fetchAll error:', e);
    setStatus('Error al cargar. Uso copia local si existe.', 'var(--danger)');
    const cached = getCache();
    if (cached){ DATA = cached.data; buildIndex(DATA); setLastSync(cached.ts); } else { DATA = []; }
  }finally{
    FETCHING = false;
    setLoading(false);
    filterRows();
  }
}

// === INIT ===
function attachEvents(){
  $('#q').addEventListener('input', debounce(filterRows, 180));
  $('#familia').addEventListener('change', filterRows);
  $('#estadoVenta').addEventListener('change', filterRows);
  $('#clearBtn').addEventListener('click', ()=>{ $('#q').value=''; $('#familia').value=''; $('#estadoVenta').value=''; filterRows(); });
  $('#reloadBtn').addEventListener('click', ()=>{ fetchAll(); });
  $('#forceBtn').addEventListener('click', ()=>{ clearCacheAndReload(); });

  $$('#tabla thead th[data-sort]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.getAttribute('data-sort');
      if (sortKey===key){ sortDir = (sortDir==='asc'?'desc':'asc'); } else { sortKey=key; sortDir='asc'; }
      filterRows();
    });
  });
}

(function start(){
  attachEvents();
  const cached = getCache();
  if (cached){ DATA = cached.data; buildIndex(DATA); setLastSync(cached.ts); filterRows(); fetchAll(); }
  else { fetchAll(); }
})();
