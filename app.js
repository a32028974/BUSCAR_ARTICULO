// ==============================
//  STOCK – Óptica Cristal (v2)
// ==============================

// --- CONFIG ---
const API = 'https://script.google.com/macros/s/AKfycbwqmOI-R_htTcfnaFrdI8943665CCLHYWr29GiSTw8qaAwzyXsKx4WXpJ2WtqQVWTq5IQ/exec';
const CACHE_KEY = 'stock_cache_v9';
const CACHE_TTL_MIN = 15; // minutos

// Traducción de encabezados de Sheet -> claves internas
const MAP = {
  'N ANTEOJO': 'n_anteojo',
  'N° ANTEOJO': 'n_anteojo',
  'NUMERO': 'n_anteojo',
  'MARCA': 'marca',
  'MODELO': 'modelo',
  'COLOR': 'color',
  'FAMILIA': 'familia',
  'CRISTAL': 'cristal_color',
  'COLOR CRISTAL': 'cristal_color',
  'CALIBRE': 'calibre',
  'PRECIO PUBLICO': 'precio',
  'PRECIO PÚBLICO': 'precio',
  'FECHA INGRESO': 'fecha_ingreso',
  'INGRESO': 'fecha_ingreso',
  'FECHA DE VENTA': 'fecha_venta',
  'VENTA': 'fecha_venta',
  'VENDEDOR': 'vendedor',
  'CODIGO DE BARRAS': 'codigo_barras',
  'CÓDIGO DE BARRAS': 'codigo_barras',
  'OBSERVACIONES': 'observaciones',
  'ARMAZON': 'armazon',
  'ARMAZÓN': 'armazon',
  'FABRICA': 'fabrica',
  'FÁBRICA': 'fabrica',
};

// --- SHORTCUTS/HELPERS DOM ---
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- UTILIDADES ---
function onlyDigits(s){ return String(s||'').replace(/\D+/g,''); }
function normHeader(h){
  return String(h||'')
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase();
}
function norm(s){
  return String(s||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase();
}
function esc(s){
  return String(s??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}
function setStatus(msg, color){
  const el = $('#status'); if (!el) return;
  el.textContent = msg || '';
  el.style.color = color || 'var(--accent)';
}
function setLastSync(ts){
  const el = $('#lastSync'); if (!el) return;
  el.textContent = ts ? `Actualizado: ${new Date(ts).toLocaleString('es-AR')}` : '';
}
function debounce(fn, ms=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

// --- FORMATEOS ---
function formatMoney(v){
  if (v == null || v === '') return '';
  const num = Number(String(v).replace(/\./g,'').replace(',', '.'));
  if (Number.isNaN(num)) return v;
  return num.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

// ⚠️ Conversión segura a Date en HORA LOCAL (evita -1 día)
function toDate(s){
  if (!s) return null;

  if (s instanceof Date) return s;

  if (typeof s === 'number') {
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  const str = String(s).trim();

  // dd/mm/aa(aa)
  let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m){
    const d  = parseInt(m[1],10);
    const mo = parseInt(m[2],10) - 1;
    const yy = m[3].length === 2 ? 2000 + parseInt(m[3],10) : parseInt(m[3],10);
    return new Date(yy, mo, d); // LOCAL
  }

  // yyyy-mm-dd  (NO usar Date("yyyy-mm-dd") por UTC)
  m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m){
    const yy = parseInt(m[1],10);
    const mo = parseInt(m[2],10) - 1;
    const d  = parseInt(m[3],10);
    return new Date(yy, mo, d); // LOCAL
  }

  const d2 = new Date(str);
  return isNaN(d2) ? null : d2;
}

function formatShortDate(s){
  const d = toDate(s);
  return d ? d.toLocaleDateString('es-AR') : '';
}

// --- RESALTADO TOLERANTE A TILDES ---
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

// --- SPINNER SÓLIDO ---
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

// --- ESTADO GLOBAL ---
let DATA = [];
let sortKey = 'n_anteojo';
let sortDir = 'asc';

// --- INDEX DE BÚSQUEDA (para tokens AND rápidos) ---
function buildIndex(arr){
  arr.forEach(r=>{
    r.__q = norm([
      r.n_anteojo, r.marca, r.modelo, r.color,
      r.familia, r.cristal_color, r.calibre, r.codigo_barras
    ].join(' '));
  });
}

// --- RENDER ---
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
  for (const r of rows){
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
  }
  tbody.appendChild(frag);
  hideSpinnerNow();
}

// --- ORDEN ---
function sortRows(rows, key, dir='asc'){
  const mult = dir==='asc' ? 1 : -1;
  return [...rows].sort((a,b)=>{
    // numéricos
    if (key==='n_anteojo' || key==='calibre' || key==='precio'){
      const na = Number(a[key]) || 0;
      const nb = Number(b[key]) || 0;
      return (na - nb) * mult;
    }
    // fechas (comparar por timestamp local)
    if (key==='fecha_ingreso' || key==='fecha_venta'){
      const da = toDate(a[key]); const ta = da ? da.getTime() : 0;
      const db = toDate(b[key]); const tb = db ? db.getTime() : 0;
      return (ta - tb) * mult;
    }
    // texto
    const va = (a[key] ?? '').toString().toLowerCase();
    const vb = (b[key] ?? '').toString().toLowerCase();
    if (va<vb) return -1*mult;
    if (va>vb) return  1*mult;
    return 0;
  });
}

// --- FILTRO / BUSCADOR ---
function filterRows(){
  hideSpinnerNow();

  const qraw   = $('#q').value.trim();
  const fam    = $('#familia').value;       // valor exacto del <select>
  const estado = $('#estadoVenta').value;   // '', 'DISPONIBLE', 'VENDIDO'

  let rows = DATA;

  // Partimos en tokens preservando "frases entre comillas"
  const parts = qraw ? (qraw.match(/"[^"]+"|\S+/g) || []) : [];

  const exactNums = [];       // @123, #123 o "123"
  const freeTokens = [];      // tokens normales (AND)
  const highlightTokens = []; // para resaltar (sin prefijos)

  for (const p of parts){
    const s = p.trim();

    // @123 o #123
    let m = s.match(/^[#@](\d+)$/);
    if (m){
      exactNums.push(m[1]);
      highlightTokens.push(m[1]);
      continue;
    }

    // "123" (solo dígitos)
    m = s.match(/^"(\d+)"$/);
    if (m){
      exactNums.push(m[1]);
      highlightTokens.push(m[1]);
      continue;
    }

    // token normal
    freeTokens.push(s);
    highlightTokens.push(s.replace(/^["']|["']$/g,''));
  }

  // 1) Filtro por número exacto si se pidió
  if (exactNums.length){
    rows = rows.filter(r=>{
      const n = onlyDigits(r.n_anteojo);
      return exactNums.every(x => onlyDigits(x) === n);
    });
  }

  // 2) AND por palabras
  if (freeTokens.length){
    const tokens = freeTokens.map(norm).filter(Boolean);
    rows = rows.filter(r=> tokens.every(t => (r.__q||'').includes(t)));
  }

  // 3) filtros extra
  if (fam){ rows = rows.filter(r => (r.familia||'').toUpperCase() === fam); }
  if (estado){
    if (estado==='DISPONIBLE') rows = rows.filter(r => !r.fecha_venta);
    if (estado==='VENDIDO')    rows = rows.filter(r => !!r.fecha_venta);
  }

  // Orden + render
  rows = sortRows(rows, sortKey, sortDir);
  render(rows, highlightTokens);
}

// --- CACHE ---
function getCache(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const ageMin = (Date.now() - obj.ts) / 60000;
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

// --- FETCH ---
let FETCHING = false;
async function fetchAll(){
  if (FETCHING) return;
  FETCHING = true;

  setLoading(true);
  setStatus('Cargando…');
  loadingFailsafe();

  try{
    const res = await fetch(`${API}?todos=true`, { method:'GET' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();

    let rows = [];

    // Soportar dos formatos: {headers, rows[]} o array de objetos
    if (json && Array.isArray(json.rows)) {
      const headers = (json.headers || []).map(h => String(h||'').trim());
      const dynamicMap = {};
      headers.forEach(h=>{
        const k = normHeader(h);
        if (MAP[k]) dynamicMap[h] = MAP[k];
      });

      rows = json.rows.map(r=>{
        // r puede venir como array o como objeto
        const rec = (r && typeof r === 'object' && !Array.isArray(r)) ? r
                 : (Array.isArray(r) ? Object.fromEntries(headers.map((h,i)=>[h, r[i]])) : {});
        const o = {};
        for (const h of Object.keys(rec)){
          const key = dynamicMap[h] || MAP[normHeader(h)];
          if (key) o[key] = rec[h];
        }
        return o;
      });

    } else if (Array.isArray(json)) {
      rows = json;
    } else {
      throw new Error('Formato de respuesta inesperado');
    }

    // Filas válidas
    rows = rows.filter(r => {
      const nOk = /\d/.test(String(r.n_anteojo || '').trim());
      const infoOk = (r.marca || r.modelo || r.color || r.codigo_barras);
      return nOk || infoOk;
    });

    // Estado global
    sortKey = 'n_anteojo';
    sortDir = 'asc';
    DATA = rows;
    buildIndex(DATA);
    setCache(DATA);
    setLastSync(Date.now());
    setStatus('Listo', 'var(--accent)');

  }catch(e){
    console.error('fetchAll error:', e);
    setStatus('Error al cargar. Uso copia local si existe.', 'var(--danger)');
    const cached = getCache();
    if (cached){
      DATA = cached.data;
      buildIndex(DATA);
      setLastSync(cached.ts);
    } else {
      DATA = [];
    }
  }finally{
    FETCHING = false;
    setLoading(false);
    filterRows();
  }
}

// --- INIT / EVENTOS ---
function attachEvents(){
  $('#q').addEventListener('input', debounce(filterRows, 180));
  $('#familia').addEventListener('change', filterRows);
  $('#estadoVenta').addEventListener('change', filterRows);

  $('#clearBtn').addEventListener('click', ()=>{
    $('#q').value = '';
    $('#familia').value = '';
    $('#estadoVenta').value = '';
    filterRows();
  });

  $('#reloadBtn').addEventListener('click', ()=> fetchAll());
  $('#forceBtn').addEventListener('click', ()=> clearCacheAndReload());

  $$('#tabla thead th[data-sort]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.getAttribute('data-sort');
      if (sortKey === key) {
        sortDir = (sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        sortKey = key;
        sortDir = 'asc';
      }
      filterRows();
    });
  });
}

// Autostart
(function start(){
  attachEvents();
  const cached = getCache();
  if (cached){
    DATA = cached.data;
    buildIndex(DATA);
    setLastSync(cached.ts);
    filterRows();
    fetchAll(); // refresco silencioso
  } else {
    fetchAll();
  }
})();
