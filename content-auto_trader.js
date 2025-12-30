// content.js — Auto Trader (v2.9.0 — Pocket Scout v3.0 support with Market Regime & MTF)
(function(){
  'use strict';
  if (window.__AT_CONTENT_290) return; // v2.9.0
  window.__AT_CONTENT_290 = true;
  console.log('[AutoTrader] v2.9.0 - Pocket Scout v3.0 support (Market Regime Detection, Multi-Timeframe Analysis, Win Rate tracking)');

  /* ===================== PERSIST / KEYS ===================== */
  const LS = {
    THRESHOLD:'AT_THRESHOLD',      // próg wejścia % (SZANUJEMY W 100%)
    ACTIVE:'AT_ACTIVE',            // ON/OFF (pauza)
    STOP_ABS:'AT_STOP_BAL',        // STOP kwotowy (saldo)
    DD_PCT:'AT_DD_PCT',            // maks. spadek od piku (%)
    PEAK:'AT_PEAK_BAL',            // zapamiętany szczyt salda
    PEAK_TS:'AT_PEAK_TS',
    MIN_PAYOUT:'AT_MIN_PAYOUT',    // minimalny payout % (WYMAGANY)
    COOLDOWN:'AT_COOLDOWN_SEC',    // cooldown symbolu (sek)
    MINIMIZED:'AT_PANEL_MIN',      // panel zwinięty (true/false)
    SKIP_LOW_RW:'AT_SKIP_LOW_RW'   // blokada sygnałów gdy Rolling Window ≤ 15m
  };
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const lsNum=(k,d)=>{ const v=localStorage.getItem(k); const n=v==null?NaN:parseFloat(v); return Number.isFinite(n)?n:d; };
  const lsBool=(k,d)=>{ const v=localStorage.getItem(k); return v==null?d:(v==='true'); };

  /**
   * ✅ v2.7.0: Read Rolling Window from Pocket Scout Adaptive DOM
   * Priority:
   * 1. DOM input element #ps-rolling-window-input (PS Adaptive v18)
   * 2. localStorage PS_ROLLING_WINDOW_MINUTES (legacy fallback)
   * 3. null if not available
   */
  function getPocketScoutRollingWindow(){
    try {
      // ✅ PRIMARY: Read from PS Adaptive v18 DOM input element
      const inputEl = document.querySelector('#ps-rolling-window-input');
      if (inputEl && inputEl.value) {
        const val = parseInt(inputEl.value, 10);
        if (Number.isFinite(val) && val >= 5 && val <= 180) {
          return val;
        }
      }
      
      // ✅ SECONDARY: Try to find RW from PS panel text (e.g., "Current: 15min")
      const rwValueEl = document.querySelector('#ps-rolling-window-value');
      if (rwValueEl) {
        const text = rwValueEl.textContent || '';
        const match = text.match(/(\d+)\s*min/i);
        if (match) {
          const val = parseInt(match[1], 10);
          if (Number.isFinite(val) && val >= 5 && val <= 180) {
            return val;
          }
        }
      }
      
      // ✅ FALLBACK: localStorage (legacy)
      const raw = localStorage.getItem('PS_ROLLING_WINDOW_MINUTES');
      if (raw != null) {
        const val = parseInt(raw, 10);
        if (Number.isFinite(val) && val > 0) return val;
      }
    } catch(e) {
      console.warn('[AutoTrader] Error reading Rolling Window:', e);
    }
    return null;
  }

  /* ===================== FEED z Pocket Scout ===================== */
  function readPSFeed(){
    try{ 
      const raw = localStorage.getItem('PS_AT_FEED'); 
      if (!raw) {
        // Debug: Log when feed is empty
        if (Date.now() % 10000 < 1500) { // Log roughly every 10 seconds
          console.log('[AutoTrader] ℹ️ No feed data in PS_AT_FEED');
        }
        return null;
      }
      const parsed = JSON.parse(raw);
      
      // COMPATIBILITY FIX: Support arrays, {signals:[]}, {signals:[], bestSignal:{}} etc.
      let signals = null;
      if (Array.isArray(parsed)) {
        signals = parsed; // legacy array
      } else if (parsed && Array.isArray(parsed.signals)) {
        signals = [...parsed.signals];
        if (parsed.bestSignal) signals.unshift(parsed.bestSignal); // ensure best goes first
      } else if (parsed && parsed.bestSignal) {
        signals = [parsed.bestSignal];
      } else if (parsed && parsed.action && Number.isFinite(parsed.confidence)) {
        // ✅ Pocket Scout v3.0: Single signal object (no wrapper)
        signals = [parsed];
      }
      
      // Debug: Log feed contents periodically
      if (signals && signals.length > 0 && Date.now() % 10000 < 1500) {
        // Detect if signal is from Pocket Scout v3.0 (has duration, wr, entryPrice fields)
        const isPS3 = signals.some(s => s.duration !== undefined && s.wr !== undefined && s.entryPrice !== undefined);
        const source = isPS3 ? 'Pocket Scout v3.0' : 'Pocket Scout Legacy';
        console.log(`[AutoTrader] ✅ Feed read from ${source}: ${signals.length} signal(s) - ${signals.map(s => {
          const wr = s.wr !== undefined ? ` WR:${s.wr.toFixed(1)}%` : '';
          const promo = s.isAutoPromoted ? '⭐' : '';
          return `${s.action || '?'}@${s.confidence || 0}%${wr}${promo}`;
        }).join(', ')}`);
      }
      
      return signals;
    }
    catch(e){ 
      console.warn('[AutoTrader] ❌ Error reading PS feed:', e);
      return null; 
    }
  }

  function getMinutes(sig){
    // ✅ Primary: explicit minutes or duration (Pocket Scout v3.0)
    if (Number.isFinite(sig.minutes)) return sig.minutes;
    if (Number.isFinite(sig.duration)) return sig.duration; // Pocket Scout v3.0 uses "duration"
    // ✅ From optimalExpiry (Pocket Scout v18 feed) in seconds
    if (Number.isFinite(sig.optimalExpiry)) return Math.round(sig.optimalExpiry / 60);
    // ✅ From expirySeconds (bridge) in seconds
    if (Number.isFinite(sig.expirySeconds)) return Math.round(sig.expirySeconds / 60);
    // ✅ From expiry in seconds (Pocket Scout v3.0)
    if (Number.isFinite(sig.expiry) && sig.expiry > 15) return Math.round(sig.expiry / 60); // If >15, assume seconds
    // ✅ From expiry in minutes (legacy)
    if (Number.isFinite(sig.expiry)) return sig.expiry;
    if (Number.isFinite(sig.expiryMinutes)) return sig.expiryMinutes;
    return null;
  }

  function getConfidence(sig){
    // ✅ V18.0.16: Support all known confidence fields from Pocket Scout v18 feed
    // Priority: explicit confidence > displayConf > other fields
    // Auto-promoted signals have confidence set to 70%+ even if base was lower
    const conf = sig.confidence
        ?? sig.displayConf
        ?? sig.confDisplay
        ?? sig.autoConfidence
        ?? sig.bestConfidence
        ?? sig.winRate // fallback: use WR if confidence missing
        ?? 0;
    
    // V18.0.16: Log auto-promoted signals for debugging
    if (sig.isAutoPromoted && conf >= 70) {
      console.log(`[AutoTrader] ✅ Auto-promoted signal detected: ${sig.model || sig.groupId} @ ${conf}% confidence`);
    }
    
    return conf;
  }

  // wybór NAJWIĘKSZEGO sygnału ≥ próg (confidence desc, potem minuty asc)
  // V18.0.17: Enhanced to properly handle auto-promoted signals and timestamp freshness
  function pickSignal(feed, thr){
    if(!feed || !Array.isArray(feed)) return null;
    
    const now = Date.now();
    const MAX_SIGNAL_AGE_MS = 15 * 1000; // Signals older than 15s are considered stale
    
    const candidates = feed.filter(it=>{
      const mins = getMinutes(it);
      const action = (it.action || '').toUpperCase();
      const okMin = Number.isFinite(mins) && mins>=1 && mins<=15;
      const okAct = action==='BUY' || action==='SELL';
      const conf = getConfidence(it);
      
      // V2.9.0: Check signal freshness using timestamp (Pocket Scout v3.0 compatibility)
      const signalTimestamp = it.timestamp || 0;
      const signalAge = now - signalTimestamp;
      const isFresh = signalTimestamp > 0 && signalAge <= MAX_SIGNAL_AGE_MS;
      
      // V2.9.0: Support both auto-promoted signals and Pocket Scout v3.0 signals
      const isValid = okMin && okAct && conf >= thr && isFresh;
      
      // V2.9.0: Enhanced logging for Pocket Scout v3.0 signals
      if (isValid) {
        const source = it.duration !== undefined && it.wr !== undefined ? 'PS v3.0' : (it.isAutoPromoted ? 'Auto-promoted' : 'Legacy');
        const wr = it.wr !== undefined ? ` | WR:${it.wr.toFixed(1)}%` : '';
        console.log(`[AutoTrader] ✅ Valid candidate [${source}]: ${action} @ ${conf}%${wr} (${mins}min, age: ${Math.round(signalAge/1000)}s)`);
      }
      
      if (!isFresh && signalTimestamp > 0) {
        console.log(`[AutoTrader] ⏸️ Signal too old: ${it.model || it.groupId || 'signal'} (age: ${Math.round(signalAge/1000)}s > ${MAX_SIGNAL_AGE_MS/1000}s)`);
      }
      
      return isValid;
    });
    
    if(!candidates.length) return null;
    
    // V2.9.0: Sort with preference for higher confidence, then WR, then auto-promoted
    return candidates
      .map((it,idx)=>({
        ...it,
        action: (it.action || '').toUpperCase(),
        minutes: getMinutes(it),
        confidence: getConfidence(it),
        wr: it.wr || 0, // Include WR in sorting
        __i: idx,
        __isAutoPromoted: it.isAutoPromoted || false
      }))
      .sort((a,b)=> {
        // Primary: confidence (desc)
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        // Secondary: WR (desc) - prefer signals with better historical performance
        if (b.wr !== a.wr) return b.wr - a.wr;
        // Tertiary: auto-promoted signals preferred (same confidence & WR)
        if (a.__isAutoPromoted !== b.__isAutoPromoted) return b.__isAutoPromoted ? 1 : -1;
        // Quaternary: minutes (asc) - prefer shorter duration
        if (a.minutes !== b.minutes) return a.minutes - b.minutes;
        // Quinary: original index
        return a.__i - b.__i;
      })[0];
  }

  /* ===================== HELPERS (DOM/PO) ===================== */
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const pad2 = n => String(n).padStart(2,'0');

  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
  const setInput=(el,val)=>{ if(!el) return; if(nativeSetter) nativeSetter.call(el,val); else el.value=val;
    el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };

  function isVisible(el){ if(!el) return false; const s=getComputedStyle(el);
    if (s.display==='none'||s.visibility==='hidden'||s.opacity==='0') return false;
    const r=el.getBoundingClientRect(); return r.width>0 && r.height>0; }

  // payout % (0..1)
  window.__psGetPayoutFraction = window.__psGetPayoutFraction || function(){
    try{
      const primarySel = '#put-call-buttons-chart-1 .value__val-start';
      let n = document.querySelector(primarySel);
      if(!n){
        const generic = Array.from(document.querySelectorAll('[id^="put-call-buttons-chart"] .value__val-start')).filter(isVisible);
        if (generic.length) n = generic[0];
      }
      if (n){
        const raw=(n.textContent||'').trim(); const m = raw.match(/(\d{1,3})(?:[.,](\d+))?/);
        if(m){ const num=parseFloat(m[1].replace(',','.') + (m[2]?'.'+m[2]:'')); if(Number.isFinite(num) && num>=0 && num<=100) return num/100; }
      }
      const sels=['.payout__percent','[class*="payout"][class*="percent"]','.payout .payout__value','.payout__text'];
      for(const sel of sels){
        for(const el of Array.from(document.querySelectorAll(sel)).filter(isVisible)){
          const t=(el.textContent||'').trim(); const mm=t.match(/(\d{1,3})(?:[.,](\d+))?\s*%/);
          if(mm){ const p=parseFloat(mm[1]+(mm[2]?'.'+mm[2]:'')); if(Number.isFinite(p)) return p/100; }
        }
      }
    }catch(e){}
    return null;
  };

  // odczyt salda
  function getBalance(){
    const sels=[
      'header .balance-info-block__data .balance-info-block__balance > span[data-hd-status="show"]',
      'span.js-hd.js-balance-real[data-hd-status="show"]','span.js-hd.js-balance-demo[data-hd-status="show"]',
      'span.js-balance-real','span.js-balance-demo'
    ];
    for(const sel of sels){
      const el = Array.from(document.querySelectorAll(sel)).find(isVisible);
      if(!el) continue;
      let raw=(el.textContent||'').trim();
      if(!raw || !/[0-9]/.test(raw)){
        const attrs=['data-hd-show','data-balance','data-balance-usd']; for(const a of attrs){ const v=el.getAttribute(a); if(v){ raw=v; break; } }
      }
      if(!raw) continue;
      let s=raw.replace(/\s|\u00A0/g,'').replace(/[^0-9.,]/g,''); if(!s) continue;
      const hasDot=s.includes('.'), hasCom=s.includes(',');
      const join=(str,pos)=>str.slice(0,pos).replace(/[.,]/g,'')+'.'+str.slice(pos+1).replace(/[.,]/g,'');
      if (hasDot && hasCom){ const pos=Math.max(s.lastIndexOf('.'), s.lastIndexOf(',')); s=join(s,pos); }
      else if (hasDot || hasCom){
        const sep=hasCom?',':'.', pos=s.lastIndexOf(sep), right=s.length-pos-1, count=(s.match(new RegExp('\\'+sep,'g'))||[]).length;
        if(count===1 && right===3) s=s.replace(new RegExp('\\'+sep,'g'),''); else if(right===2||count>1) s=join(s,pos); else s=s.replace(new RegExp('\\'+sep,'g'),'');
      }
      const n=Number(s); if(Number.isFinite(n)) return n;
    }
    return null;
  }

  // Cena bieżąca z DOM
  function readPrice(){
    try{
      const sels = [
        'span.open-time-number',
        'span.one-time-number',
        '.trading-chart__price, .chart-price'
      ];
      for (const sel of sels){
        const nodes = Array.from(document.querySelectorAll(sel)).filter(isVisible);
        if (!nodes.length) continue;
        const n = nodes[0];
        let t = (n.textContent||'').trim();
        if(!t) continue;
        t = t.replace(/\u00A0/g,'').replace(/\s/g,'');
        if (t.includes(',') && t.includes('.')){
          const last = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
          t = t.slice(0,last).replace(/[.,]/g,'') + '.' + t.slice(last+1).replace(/[.,]/g,'');
        } else if (t.includes(',')) {
          const parts = t.split(',');
          if (parts[parts.length-1].length===2 || parts[parts.length-1].length===3) {
            t = parts.slice(0,-1).join('').replace(/[.,]/g,'') + '.' + parts[parts.length-1];
          } else {
            t = t.replace(/,/g,'');
          }
        } else {
          const parts = t.split('.');
          if (parts.length>2){
            const last = t.lastIndexOf('.');
            t = t.slice(0,last).replace(/[.]/g,'') + '.' + t.slice(last+1);
          }
        }
        const v = Number(t.replace(/[^\d.-]/g,''));
        if (Number.isFinite(v)) return v;
      }
    }catch(e){}
    return null;
  }

  // ustawienie czasu (HH:MM:SS)
  async function openTimeModal(){
    const trg = document.querySelector('.control__value.value.value--several-items');
    if (!trg) return null; trg.click(); await sleep(250);
    const inputs = Array.from(document.querySelectorAll('.trading-panel-modal__in input[type=text]'));
    return { trg, inputs };
  }
  async function setTimeInputs(hh, mm, ss){
    const res = await openTimeModal(); if (!res || !res.inputs.length) return false;
    let [hEl, mEl, sEl] = res.inputs.length >= 3 ? [res.inputs[0], res.inputs[1], res.inputs[2]] : [null, res.inputs[0], res.inputs[1] || null];
    if (hEl){ hEl.focus(); setInput(hEl, pad2(hh)); }
    if (mEl){ mEl.focus(); setInput(mEl, pad2(mm)); }
    if (sEl){ sEl.focus(); setInput(sEl, pad2(ss)); }
    document.activeElement?.blur?.(); res.trg.click(); await sleep(200);
    const lbl = document.querySelector('.control__value.value.value--several-items .value__val');
    const expected = `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
    return !!(lbl && lbl.textContent && lbl.textContent.trim() === expected);
  }
  async function spinMinutesTo(targetMin){
    const res = await openTimeModal(); if (!res || !res.inputs.length) return false;
    const mEl = (res.inputs.length >= 3) ? res.inputs[1] : res.inputs[0];
    if (!mEl) return false;
    const row = mEl.closest('.rw'); const plus=row?.querySelector('.btn-plus'); const minus=row?.querySelector('.btn-minus');
    const readInt = (v)=>parseInt((v||'0').replace(/\D+/g,''),10)||0;
    let cur = readInt(mEl.value), steps=0; const MAX=160;
    while (cur !== targetMin && steps < MAX){ (targetMin>cur?plus:minus)?.click(); steps++; await new Promise(r=>setTimeout(r,35)); cur = readInt(mEl.value); }
    mEl.blur(); res.trg.click(); await new Promise(r=>setTimeout(r,200));
    const lbl = document.querySelector('.control__value.value.value--several-items .value__val');
    return !!(lbl && lbl.textContent && lbl.textContent.includes(`:${pad2(targetMin)}:`));
  }
  async function ensureExpirationMinutes(total){
    const hh = Math.floor(total/60), mm = total % 60, ss = 0;
    if (await setTimeInputs(hh,mm,ss)) return true;
    if (await spinMinutesTo(mm)) return true;
    const inp = document.querySelector('input[name="minutes"], [data-role="minutes"]');
    if (inp){ setInput(inp, String(total)); return true; }
    return false;
  }

  function findButtonByLabel(label){
    const spans = Array.from(document.querySelectorAll('span.payout__text-lh, span.payout__text, .buttons__wrap .value__val-start')).filter(isVisible);
    const span = spans.find(n => (n.textContent||'').trim().toLowerCase().includes(label.toLowerCase()));
    if(!span) return null; const btn = span.closest('a,button'); return btn||span;
  }
  async function executeTrade(sig){
    await ensureExpirationMinutes(sig.minutes);
    await sleep(200);
    if (sig.action==='BUY'){ const b=findButtonByLabel('kup'); if(b) b.click(); }
    else if(sig.action==='SELL'){ const s=findButtonByLabel('sprzedaj'); if(s) s.click(); }
  }

  // === SYMBOL ===
  window.__psGetSymbol = function(){
    try {
      const hard = document.querySelector('#pending-trades_asset > div > button > div > div > div');
      if (hard && hard.textContent) {
        const t = hard.textContent.trim();
        if (t) return t.toUpperCase();
      }
      const bad = new Set(['M1','M2','M3','M5','M10','M15','M30','H1','H2','H3','H4','H6','H8','H12','D1','W1','1M','3M','6M','Y1']);
      const looksTF  = s => bad.has(String(s).toUpperCase());
      const looksSym = s => {
        const u = String(s).trim().toUpperCase();
        if (!u || looksTF(u)) return false;
        if (u.includes('/')) return true;
        if (/\bOTC\b/.test(u)) return true;
        if (/^[A-Z0-9]{4,12}$/.test(u)) return true;
        return false;
      };
      const nodes = Array.from(document.querySelectorAll('div.filter-option-inner-inner'));
      for (const n of nodes) {
        const t = (n.textContent || '').trim();
        if (looksSym(t)) return t.toUpperCase();
      }
      const sels=['.trading__pair .pair__name','.pair__name','.header__pair .pair__name'];
      for (const sel of sels) {
        const n = document.querySelector(sel);
        if (n && n.textContent) {
          const t = n.textContent.trim();
          if (looksSym(t)) return t.toUpperCase();
        }
      }
      const raw = localStorage.getItem('PS_AT_FEED');
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && obj.symbol) return String(obj.symbol).trim().toUpperCase();
      }
      const symbolRaw = localStorage.getItem('PS_SYMBOL');
      if (symbolRaw) return String(symbolRaw).trim().toUpperCase();
    } catch(e) {}
    return null;
  };

  /* ===================== COOLDOWN / RE-ENTRY ===================== */
  const COOLDOWN_SEC_DEFAULT = 15;
  const cdMap = {};
  function canTrade(sym){
    const now=Date.now(); const last=cdMap[sym]||0; const cd=(lsNum(LS.COOLDOWN,COOLDOWN_SEC_DEFAULT))*1000;
    return (now - last) >= cd;
  }
  function markTrade(sym){ cdMap[sym]=Date.now(); }

  window.__AT_lastEntry = window.__AT_lastEntry || {};
  const REENTRY_LOOKBACK_MS = 5*60*1000;

  const AT_DUP_COOLDOWN_SEC = parseInt(localStorage.getItem('AT_DUP_COOLDOWN_SEC') || '60', 10);
  const DUP_COOLDOWN_MS = Math.max(0, AT_DUP_COOLDOWN_SEC) * 1000;
  const AT_LAST_EXEC_KEY = 'AT_LAST_EXEC_TS';
  let __AT_LAST_EXEC = {};
  try { __AT_LAST_EXEC = JSON.parse(localStorage.getItem(AT_LAST_EXEC_KEY) || '{}'); } catch (e) { __AT_LAST_EXEC = {}; }

  function flash(msg, isErr){
    const c = isErr?'#f33':'#0f0';
    console.log('[AT]', msg);
    const el = document.getElementById('at-info');
    if(el){
      el.textContent = msg; el.style.color = c;
      setTimeout(()=>{ if(el.textContent===msg) el.textContent=''; }, isErr?6000:4000);
    }
  }

  const state = {
    active: lsBool(LS.ACTIVE, true),
    thr: lsNum(LS.THRESHOLD, 70),
    stopAbs: lsNum(LS.STOP_ABS, 0),
    ddPct: lsNum(LS.DD_PCT, 20),
    peak: lsNum(LS.PEAK, NaN),
    peakTs: localStorage.getItem(LS.PEAK_TS) || null,
    minPayout: lsNum(LS.MIN_PAYOUT, 70),
    cooldown: lsNum(LS.COOLDOWN, COOLDOWN_SEC_DEFAULT),
    minimized: lsBool(LS.MINIMIZED, false),
    skipLowRW: lsBool(LS.SKIP_LOW_RW, true) // ✅ DEFAULT: ON (block RW ≤15min)
  };

  let box, statusSpan, rows;
  let executing=false;

  function ensurePanel(){
    if(box && box.isConnected) return;
    box = document.createElement('div');
    box.id='at-panel';
    box.style.cssText='position:fixed;bottom:10px;left:10px;z-index:999999;background:#000;border:2px solid #234;color:#eee;font:12px/1.4 monospace;width:700px;user-select:none;transition:all 0.3s ease;';
    box.innerHTML=`
      <div style="background:#123;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #234;cursor:move;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span id="at-badge" style="padding:3px 8px;border-radius:999px;background:#555;color:#0f0;font-weight:700;font-size:11px;">AKTYWNE</span>
          <strong style="color:#fff;">AutoTrader v2.8.1</strong>
        </div>
        <div style="display:flex;gap:6px;">
          <button id="at-minimize" style="background:#123;border:1px solid #345;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-weight:700;">−</button>
          <button id="at-toggle" style="background:#555;border:none;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;">Pauza</button>
          <button id="at-peak" style="background:#123;border:1px solid #345;color:#eee;padding:4px 10px;border-radius:6px;cursor:pointer;">Reset peak</button>
        </div>
      </div>
      <div id="at-content" style="display:block;">
        <div style="display:grid;grid-template-columns:1fr 120px;gap:8px;padding:6px 10px;border-bottom:1px solid #234;font-size:12px;">
          <label>Próg wejścia (%)</label>
          <input id="at-thr" type="number" min="1" max="100" step="1" style="width:120px;background:#000;color:#0f0;border:1px solid #345;border-radius:6px;padding:2px 6px;text-align:right;">
          <label>Min payout (%)</label>
          <input id="at-payout" type="number" min="1" max="100" step="1" style="width:120px;background:#000;color:#0f0;border:1px solid #345;border-radius:6px;padding:2px 6px;text-align:right;">
          <label>Cooldown (sekundy) <span style="color:#888;font-size:10px;">0-300</span></label>
          <input id="at-cooldown" type="number" min="0" max="300" step="1" style="width:120px;background:#000;color:#0f0;border:1px solid #345;border-radius:6px;padding:2px 6px;text-align:right;">
          <label>STOP saldo (kwota)</label>
          <input id="at-stop" type="number" min="0" step="0.01" style="width:120px;background:#000;color:#0f0;border:1px solid #345;border-radius:6px;padding:2px 6px;text-align:right;">
          <label>Maks. spadek od szczytu (%)</label>
          <input id="at-dd" type="number" min="0" max="100" step="0.1" style="width:120px;background:#000;color:#0f0;border:1px solid #345;border-radius:6px;padding:2px 6px;text-align:right;">
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-bottom:1px solid #234;font-size:12px;">
          <div style="color:#cfe;">Blokuj sygnały gdy Rolling Window ≤ 15 min</div>
          <button id="at-skip-low-rw" style="background:#123;border:1px solid #345;color:#fff;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:700;">—</button>
        </div>
        <div id="at-rows" style="padding:6px 10px; border-top:1px solid #234; border-bottom:1px solid #234;"></div>
        <div style="padding:6px 10px; font-size:12px;">
          <div id="at-status">status: init</div>
          <div id="at-info"   style="color:#9cf;margin-top:4px;"></div>
        </div>
        <div id="at-foot" style="display:grid;grid-template-columns: repeat(7, 1fr); gap:6px; padding:6px 10px; border-top:1px solid #234; font-size:12px; color:#cfe;">
          <div><span style="color:#88a">SYM:</span> <span id="at-f-sym">—</span></div>
          <div><span style="color:#88a">Saldo:</span> <span id="at-f-bal">—</span></div>
          <div><span style="color:#88a">PEAK:</span> <span id="at-f-peak">—</span></div>
          <div><span style="color:#88a">Floor:</span> <span id="at-f-floor">—</span></div>
          <div><span style="color:#88a">Payout:</span> <span id="at-f-payout">—</span></div>
          <div><span style="color:#88a">LVL:</span> <span id="at-f-lvl">—</span></div>
          <div><span style="color:#88a">Max DD:</span> <span id="at-f-dd">—</span></div>
        </div>
      </div>
    `;
    document.body.appendChild(box);

    statusSpan = box.querySelector('#at-status');
    rows = box.querySelector('#at-rows');

    const thrInput = box.querySelector('#at-thr'); thrInput.value = String(state.thr);
    const payoutInput = box.querySelector('#at-payout'); payoutInput.value = String(state.minPayout);
    const cooldownInput = box.querySelector('#at-cooldown'); cooldownInput.value = String(state.cooldown);
    const stopInput = box.querySelector('#at-stop'); stopInput.value = state.stopAbs>0 ? String(state.stopAbs.toFixed(2)) : '0';
    const ddInput = box.querySelector('#at-dd'); ddInput.value = state.ddPct>0 ? String(state.ddPct) : '0';

    function renderHeader(){
      const badge = box.querySelector('#at-badge');
      if (badge) {
        badge.textContent = state.active ? 'AKTYWNE' : 'OFF';
        badge.style.background = state.active ? '#555' : '#f33';
        badge.style.color = state.active ? '#0f0' : '#f66';
      }
      const tgl = box.querySelector('#at-toggle');
      if (tgl) tgl.textContent = state.active ? 'Pauza' : 'Włącz';
    }
    renderHeader();

    box.querySelector('#at-toggle').addEventListener('click', ()=>{
      state.active = !state.active; localStorage.setItem(LS.ACTIVE, String(state.active));
      renderHeader(); window.__AT_renderFooter && window.__AT_renderFooter();
    });
    box.querySelector('#at-peak').addEventListener('click', ()=>{
      const bal=getBalance(); if(bal==null){ flash('Brak salda do resetu PEAK', true); return; }
      state.peak = bal; state.peakTs=new Date().toISOString();
      localStorage.setItem(LS.PEAK,String(state.peak)); localStorage.setItem(LS.PEAK_TS,state.peakTs);
      flash(`Reset PEAK: ${bal.toFixed(2)}`); window.__AT_renderFooter && window.__AT_renderFooter();
    });

    thrInput.addEventListener('change', ()=>{ state.thr = clamp(parseInt(thrInput.value||'50',10)||50,1,100);
      localStorage.setItem(LS.THRESHOLD,String(state.thr)); });
    payoutInput.addEventListener('change', ()=>{ state.minPayout = clamp(parseInt(payoutInput.value||'70',10)||70,1,100);
      localStorage.setItem(LS.MIN_PAYOUT,String(state.minPayout)); });
    cooldownInput.addEventListener('change', ()=>{
      const v = clamp(parseInt(cooldownInput.value||'15',10)||15, 0, 300);
      state.cooldown = v; 
      cooldownInput.value = String(v);
      localStorage.setItem(LS.COOLDOWN, String(v));
      console.log(`[AT] Cooldown zmieniony na ${v}s`);
    });
    stopInput.addEventListener('change', ()=>{ const v=Math.max(0, parseFloat((stopInput.value||'0').replace(',','.'))||0);
      state.stopAbs=v; stopInput.value=String(v.toFixed(2)); localStorage.setItem(LS.STOP_ABS,String(v)); window.__AT_renderFooter && window.__AT_renderFooter(); });
    ddInput.addEventListener('change', ()=>{ const v=clamp(parseFloat((ddInput.value||'0').replace(',','.'))||0,0,100);
      state.ddPct=v; ddInput.value=String(v); localStorage.setItem(LS.DD_PCT,String(v)); window.__AT_renderFooter && window.__AT_renderFooter(); });
    
    const skipBtn = box.querySelector('#at-skip-low-rw');
    function renderSkipButton(){
      if(!skipBtn) return;
      skipBtn.textContent = state.skipLowRW ? 'Blokada: AKTYWNA' : 'Blokada: WYŁ.';
      skipBtn.style.background = state.skipLowRW ? '#8b0000' : '#123';
      skipBtn.style.borderColor = state.skipLowRW ? '#f55' : '#345';
    }
    renderSkipButton();
    skipBtn.addEventListener('click', ()=>{
      state.skipLowRW = !state.skipLowRW;
      localStorage.setItem(LS.SKIP_LOW_RW, String(state.skipLowRW));
      renderSkipButton();
      console.log(`[AT] Blokada RW≤15min: ${state.skipLowRW ? 'AKTYWNA' : 'WYŁĄCZONA'}`);
    });

    // Minimize/expand toggle
    const minimizeBtn = box.querySelector('#at-minimize');
    const contentDiv = box.querySelector('#at-content');
    function applyMinimized(){
      if(state.minimized){
        contentDiv.style.display = 'none';
        minimizeBtn.textContent = '+';
        box.style.width = 'auto';
      } else {
        contentDiv.style.display = 'block';
        minimizeBtn.textContent = '−';
        box.style.width = '700px';
      }
    }
    applyMinimized();
    minimizeBtn.addEventListener('click', ()=>{
      state.minimized = !state.minimized;
      localStorage.setItem(LS.MINIMIZED, String(state.minimized));
      applyMinimized();
    });

    // Footer renderer
    window.__AT_renderFooter = function(){
      const bal = getBalance();
      const sym = window.__psGetSymbol() || '—';
      const payout = window.__psGetPayoutFraction();
      const payoutPct = payout!=null ? (payout*100).toFixed(0)+'%' : '—';
      
      let floor = '—';
      if (Number.isFinite(state.peak) && state.ddPct > 0){
        floor = (state.peak * (1 - state.ddPct/100)).toFixed(2);
      }
      
      let lvl = '—';
      if(bal!=null && Number.isFinite(state.peak) && state.ddPct > 0){
        const floorVal = state.peak * (1 - state.ddPct/100);
        const range = state.peak - floorVal;
        if(range > 0){
          const pct = ((bal - floorVal) / range * 100).toFixed(1);
          lvl = pct + '%';
        }
      }
      
      const ddDisplay = state.ddPct > 0 ? state.ddPct.toFixed(1) + '%' : '—';
      
      document.getElementById('at-f-sym').textContent = sym;
      document.getElementById('at-f-bal').textContent = bal!=null ? bal.toFixed(2) : '—';
      document.getElementById('at-f-peak').textContent = Number.isFinite(state.peak) ? state.peak.toFixed(2) : '—';
      document.getElementById('at-f-floor').textContent = floor;
      document.getElementById('at-f-payout').textContent = payoutPct;
      document.getElementById('at-f-lvl').textContent = lvl;
      document.getElementById('at-f-dd').textContent = ddDisplay;
    };
    
    setInterval(window.__AT_renderFooter, 1000);
    window.__AT_renderFooter();
  }

  /* ===================== MAIN LOOP ===================== */
  async function tick(){
    ensurePanel();
    
    if(!state.active){
      statusSpan.textContent = 'status: OFF (pauza)';
      return;
    }

    // ✅ v2.7.0: Check Rolling Window from DOM and block if ≤15min
    if (state.skipLowRW) {
      const rw = getPocketScoutRollingWindow();
      if (rw !== null && rw <= 15) {
        statusSpan.textContent = `status: ⛔ BLOKADA RW=${rw}min (≤15min)`;
        statusSpan.style.color = '#f55';
        console.log(`[AutoTrader] ⛔ Signal blocked: Rolling Window = ${rw}min (≤15min threshold)`);
        return;
      }
    }

    const bal = getBalance();
    if(bal == null){
      statusSpan.textContent = 'status: brak salda';
      return;
    }
    
    // Peak tracking
    if(!Number.isFinite(state.peak) || bal > state.peak){
      state.peak = bal;
      state.peakTs = new Date().toISOString();
      localStorage.setItem(LS.PEAK, String(state.peak));
      localStorage.setItem(LS.PEAK_TS, state.peakTs);
      window.__AT_renderFooter && window.__AT_renderFooter();
    }
    
    // STOP: absolute balance
    if(state.stopAbs > 0 && bal <= state.stopAbs){
      statusSpan.textContent = `status: STOP saldo ${bal.toFixed(2)} ≤ ${state.stopAbs.toFixed(2)}`;
      return;
    }
    
    // STOP: drawdown from peak
    if(state.ddPct > 0 && Number.isFinite(state.peak)){
      const floor = state.peak * (1 - state.ddPct/100);
      if(bal <= floor){
        statusSpan.textContent = `status: STOP drawdown ${bal.toFixed(2)} ≤ floor ${floor.toFixed(2)}`;
        return;
      }
    }
    
    // Payout check
    const payout = window.__psGetPayoutFraction();
    if(payout == null || payout*100 < state.minPayout){
      statusSpan.textContent = `status: payout ${payout!=null?(payout*100).toFixed(0):'?'}% < min ${state.minPayout}%`;
      return;
    }
    
    // Symbol check
    const sym = window.__psGetSymbol();
    if(!sym){
      statusSpan.textContent = 'status: brak symbolu';
      return;
    }
    
    // Cooldown check
    if(!canTrade(sym)){
      const remaining = Math.ceil((state.cooldown*1000 - (Date.now() - (cdMap[sym]||0)))/1000);
      statusSpan.textContent = `status: cooldown ${sym} (${remaining}s)`;
      return;
    }
    
    // Read feed and pick signal
    const feed = readPSFeed();
    const sig = pickSignal(feed, state.thr);
    
    if(!sig){
      statusSpan.textContent = `status: brak sygnału ≥${state.thr}%`;
      statusSpan.style.color = '#ccc';
      return;
    }
    
    // Duplicate check
    const sigKey = `${sym}_${sig.action}_${sig.minutes}`;
    const lastExec = __AT_LAST_EXEC[sigKey] || 0;
    if(Date.now() - lastExec < DUP_COOLDOWN_MS){
      const remaining = Math.ceil((DUP_COOLDOWN_MS - (Date.now() - lastExec))/1000);
      statusSpan.textContent = `status: dup cooldown ${remaining}s`;
      return;
    }
    
    // Execute trade
    if(executing) return;
    executing = true;
    
    const conf = getConfidence(sig); // V18.0.16: Use getConfidence() for consistency
    const isAutoPromoted = sig.isAutoPromoted || false;
    const signalType = isAutoPromoted ? 'AUTO-PROMOTED' : 'STANDARD';
    
    statusSpan.textContent = `EXEC: ${sig.action} ${sig.minutes}min @${conf}% ${isAutoPromoted ? '⭐' : ''}`;
    statusSpan.style.color = sig.action === 'BUY' ? '#0f0' : '#f55';
    
    console.log(`[AutoTrader] 🎯 Executing ${signalType}: ${sig.action} ${sig.minutes}min @${conf}% (${sym})${isAutoPromoted ? ' - Group WR-based promotion' : ''}`);
    
    try {
      await executeTrade(sig);
      markTrade(sym);
      __AT_LAST_EXEC[sigKey] = Date.now();
      localStorage.setItem(AT_LAST_EXEC_KEY, JSON.stringify(__AT_LAST_EXEC));
      
      window.__AT_lastEntry[sym] = {
        ts: Date.now(),
        action: sig.action,
        price: readPrice()
      };
      
      const flashMsg = isAutoPromoted 
        ? `✅ ${sig.action} ${sig.minutes}min @${conf}% ⭐ AUTO-PROMOTED`
        : `✅ ${sig.action} ${sig.minutes}min @${conf}%`;
      flash(flashMsg, false);
    } catch(e) {
      console.error('[AutoTrader] Execution error:', e);
      flash(`❌ Błąd: ${e.message}`, true);
    }
    
    executing = false;
  }

  // Start main loop
  setInterval(tick, 1500);
  console.log('[AutoTrader] v2.8.1 started - Auto-promoted signals support for PS Adaptive v18.0.17');
})();
