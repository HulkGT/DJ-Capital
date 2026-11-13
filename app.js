
const MONTHS=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
function uid(){return Math.random().toString(36).slice(2,10)}
function pad(n){return String(n).padStart(2,'0')}
function normIban(s){return String(s||'').replace(/\s+/g,'').toUpperCase()}
function nrm(s){return String(s||'').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/đ/g,'d').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ')}
function iso(y,m,d){if(m<1||m>12||d<1||d>31)return null;return y+'-'+pad(m)+'-'+pad(d)}
function todayISO(){const d=new Date();return iso(d.getFullYear(),d.getMonth()+1,d.getDate())}
function monthOf(d){return String(d).slice(0,7)}
function addMonth(ym,n){let y=+ym.slice(0,4),m=+ym.slice(5,7)-1+n;y+=Math.floor(m/12);m=((m%12)+12)%12;return y+'-'+pad(m+1)}
function monthLabel(ym){return MONTHS[+ym.slice(5,7)-1]+' '+ym.slice(0,4)}
function parseDE(s){
  if(s==null)return NaN;let t=String(s).trim().replace(/EUR|€|\s/gi,'');if(!t)return NaN;
  let neg=false;
  if(/^\(.*\)$/.test(t)){neg=true;t=t.slice(1,-1)}
  if(t.endsWith('-')){neg=true;t=t.slice(0,-1)}
  if(t.startsWith('−')||t.startsWith('–')){neg=true;t=t.slice(1)}
  if(t.startsWith('-')){neg=true;t=t.slice(1)}
  if(t.startsWith('+'))t=t.slice(1);
  if(t.includes(',')&&t.includes('.')){
    if(t.lastIndexOf(',')>t.lastIndexOf('.'))t=t.replace(/\./g,'').replace(',','.');else t=t.replace(/,/g,'');
  }else if(t.includes(','))t=t.replace(',','.');
  else if((t.match(/\./g)||[]).length>1)t=t.replace(/\./g,'');
  if(!/^\d*\.?\d+$|^\d+\.$/.test(t))return NaN;
  const n=parseFloat(t);return isNaN(n)?NaN:(neg?-n:n);
}
function parseDate(s){
  s=String(s||'').trim();let m;
  if((m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/))){let y=+m[3];if(y<100)y+=2000;return iso(y,+m[2],+m[1])}
  if((m=s.match(/^(\d{4})-(\d{2})-(\d{2})/)))return iso(+m[1],+m[2],+m[3]);
  if((m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)))return iso(+m[3],+m[2],+m[1]);
  return null;
}
function detectDelim(text){
  const lines=text.split(/\r?\n/).slice(0,12);const cands=[';',',','\t'];const score={';':0,',':0,'\t':0};
  for(const l of lines){let q=false;for(const c of l){if(c==='"')q=!q;else if(!q&&score[c]!==undefined)score[c]++}}
  return cands.sort((a,b)=>score[b]-score[a])[0];
}
function splitRows(text,d){
  const rows=[];let row=[],f='',q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;
    else if(c===d){row.push(f);f=''}
    else if(c==='\n'){row.push(f.replace(/\r$/,''));rows.push(row);row=[];f=''}
    else f+=c;
  }
  if(f!==''||row.length){row.push(f.replace(/\r$/,''));rows.push(row)}
  return rows.filter(r=>r.some(x=>String(x).trim()!==''));
}
function parseCSV(text){
  text=text.replace(/^﻿/,'');const d=detectDelim(text);const rows=splitRows(text,d);
  let h=-1;
  for(let i=0;i<Math.min(rows.length,40);i++){
    const j=rows[i].map(x=>String(x).toLowerCase()).join('|');
    if(rows[i].length>=3&&/betrag|amount|umsatz/.test(j)&&/datum|buchung|date|valuta/.test(j)){h=i;break}
  }
  if(h<0)h=0;
  return {delim:d,rows,headerIdx:h,headers:(rows[h]||[]).map(x=>String(x).trim()),data:rows.slice(h+1)};
}
function guessCols(headers){
  const L=headers.map(x=>nrm(x).trim());
  const find=(...res)=>{for(const re of res){const i=L.findIndex(x=>re.test(x));if(i>=0)return i}return -1};
  const names=[];
  L.forEach((x,i)=>{if(/iban|bic|konto|glaeubiger|mandat|kundenreferenz/.test(x))return;
    if(/beguenstigt|zahlungspflichtig|zahlungsempf|auftraggeber|empfaenger|zahlungsbeteiligt|^name|counterparty|payee|payer|beneficiary/.test(x))names.push(i)});
  let iban=-1;
  L.forEach((x,i)=>{if(iban<0&&/iban/.test(x)&&!/auftragskonto|eigene|own/.test(x))iban=i});
  return {
    date:find(/^(buchungstag|buchungsdatum|buchung|datum|booking date|date)$/,/buchungstag|buchungsdatum|datum|date/,/valuta|wert/),
    amount:find(/^betrag|^umsatz$|^amount/,/betrag|amount|umsatz/),
    sign:find(/soll\/haben|^s\/h$|^soll haben/),
    names,iban,
    purpose:find(/verwendungszweck/,/zahlungsreferenz|zweck|referenz|buchungstext|beschreibung|description/)
  };
}
function rowsToTx(rows,map){
  const out=[];
  for(const r of rows){
    const d=parseDate(r[map.date]);const a=parseDE(r[map.amount]);if(!d||isNaN(a))continue;
    let amt=a;
    if(map.sign>=0){const s=String(r[map.sign]||'').trim().toUpperCase();
      if(s==='S'||s==='D'||s==='SOLL'||s==='DEBIT')amt=-Math.abs(a);else if(s==='H'||s==='C'||s==='HABEN'||s==='CREDIT')amt=Math.abs(a)}
    let names=[...new Set((map.names||[]).map(i=>String(r[i]||'').trim()).filter(Boolean))].join(' / ');
    let iban=map.iban>=0?normIban(r[map.iban]):'';
    if(map.purpose>=0&&(!names||!iban)){const g=cpFromText(String(r[map.purpose]||''));if(!names)names=g.name;if(!iban)iban=g.iban}
    const purpose=map.purpose>=0?String(r[map.purpose]||'').replace(/\s+/g,' ').trim():'';
    out.push({date:d,amount:Math.round(amt*100)/100,name:names,iban:/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)?iban:'',purpose});
  }
  return out;
}
/* Gegenseite aus dem Verwendungszweck lesen (z. B. Santander-CSV: alles in einer Spalte) */
function cpFromText(raw){const t=String(raw||'');let iban='';const m=t.match(/IBAN\s*:?\s*([A-Z]{2}\d{2}(?:\s?[A-Z0-9]){10,30})/);if(m)iban=normIban(m[1]).replace(/BIC.*$/,'');
  let name='';const seg=t.split(/\s{2,}/).map(x=>x.trim()).filter(Boolean);
  const pre=/^(SEPA-LASTSCHRIFT VON|SEPA-UEBERWEISUNG AN|SEPA-ÜBERWEISUNG AN|ÜBERWEISUNG AN|ÜBERWEISUNG VON|UEBERWEISUNG AN|UEBERWEISUNG VON|ECHTZEIT-ÜBERWEISUNG AN|ECHTZEIT-ÜBERWEISUNG VON|GUTSCHRIFT VON|LASTSCHRIFT VON|DAUERAUFTRAG AN)\b\s*/i;
  for(let i=0;i<seg.length;i++){if(pre.test(seg[i])){let rest=seg[i].replace(pre,'').trim();if(!rest&&seg[i+1])rest=seg[i+1];
    rest=rest.split(/\s+/).filter(w=>!/\d{6,}|^IBAN$|^BIC$/i.test(w)).join(' ');const cut=rest.search(/\s(IBAN|BIC|EREF|MREF|CRED|SVWZ)\b/i);name=(cut>0?rest.slice(0,cut):rest).replace(/\s+-\s*$/,'').trim();break}}
  return {name:name.slice(0,80),iban:/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)?iban:''}}
function txKey(t){return [t.date,t.amount.toFixed(2),t.iban,nrm(t.name),nrm(t.purpose)].join('|')}
function unitMatches(u,hay){
  const ex=(u.keywords||'').split(',').map(s=>nrm(s).trim()).filter(Boolean);
  if(ex.length)return ex.some(k=>hay.includes(k));
  const toks=nrm(u.tenant).split(/[\s,]+/).filter(x=>x.length>=4);
  return toks.length>0&&toks.every(k=>hay.includes(k));
}
function pickUnit(cands,amount){return cands.find(u=>Math.abs((u.rent||0)-amount)<0.005)||cands[0]||null}
function autoAssign(tx,S){
  const hay=nrm(tx.name+' '+tx.purpose);
  if(tx.amount>0){
    let c=tx.iban?S.units.filter(u=>u.iban&&normIban(u.iban)===tx.iban):[];
    if(!c.length)c=S.units.filter(u=>unitMatches(u,hay));
    const u=pickUnit(c,tx.amount);
    if(u){tx.type='rent';tx.unitId=u.id;return true}
  }else{
    const r=(S.rules||[]).find(r=>r.keyword&&hay.includes(nrm(r.keyword)));
    if(r){tx.type='expense';tx.category=r.category||'';tx.propertyId=r.propertyId||'';return true}
  }
  tx.type='open';return false;
}
function rentStatus(unit,ym,txs,today){
  if(unit.start&&ym<unit.start)return null;if(unit.end&&ym>unit.end)return null;
  const exp=unit.rent||0;if(exp<=0)return {exp:0,got:0,st:'none',missing:0};
  const got=txs.filter(t=>t.type==='rent'&&t.unitId===unit.id&&(t.forMonth||monthOf(t.date))===ym).reduce((s,t)=>s+t.amount,0);
  const due=ym+'-'+pad(Math.min(Math.max(unit.dueDay||3,1),28));
  let st;
  if(exp>0&&got>=exp-0.005)st=got>exp+0.005?'over':'paid';
  else if(got>0.005)st='partial';
  else st=today>due?'late':'pending';
  return {exp,got,st,missing:Math.max(0,exp-got)};
}

/* ---------- Zustand & Migration ---------- */
const EXP_CATS=['Lebensmittel','Wohnen & Nebenkosten','Auto & Tanken','Versicherung','Handy, Internet & Abos','Familie & Kinder','Freizeit & Restaurant','Gesundheit','Kleidung','Reisen','Steuern','Kredit & Zinsen','Firma','Reparatur & Instandhaltung','Komunalna naknada','Müllabfuhr','HRT','Klima-Service','Sonstiges'];
const INC_CATS=['Firma','Gehalt','Zinsen & Dividenden','Erstattung','Sonstige Einnahmen'];
const ACC_TYPES={bank:'Bankkonto',bar:'Bargeld',depot:'Depot',sonst:'Sonstiges'};
const LSKEY='jozic-v3';
let S=null;
function dedupeEbid(s){const seen={},drop=new Set();const score=t=>(t.type&&t.type!=='open'?4:0)+(t.receipt?2:0)+(t.propertyId?1:0);
  (s.txs||[]).forEach(t=>{if(!t||!t.ebid)return;const o=seen[t.ebid];if(!o){seen[t.ebid]=t;return}if(score(t)>score(o)){drop.add(o.id);seen[t.ebid]=t}else drop.add(t.id)});
  if(drop.size)s.txs=s.txs.filter(t=>!drop.has(t.id));return drop.size}
function migrate(s){
  ['props','units','txs','rules','accounts','plans','fixcosts','devices','meterDevs','notes','reminders','wishes','docs','credits'].forEach(k=>s[k]=s[k]||[]);
  if(!s.cats||!s.cats.length)s.cats=EXP_CATS.slice();
  (s.notes||[]).forEach(n=>{if(n&&!n.id)n.id=uid()});
  dedupeEbid(s);
  if(!s.icats||!s.icats.length)s.icats=INC_CATS.slice();
  if((s.v||0)<10){
    ['Werbung & Marketing (Firma)','Mobilität','Kreditkarte','Fitness & Sport','Online-Shopping'].forEach(c=>{if(!s.cats.includes(c))s.cats.push(c)});
    ['Kindergeld','Krankenkasse','Steuererstattung'].forEach(c=>{if(!s.icats.includes(c))s.icats.push(c)});
    if(s.meters){s.meterDevs=s.meterDevs.concat(s.meters.map(m=>({id:m.id,propertyId:m.propertyId,kind:'Wasser',number:'',place:m.title||'',readings:m.value?[{date:m.date,value:m.value}]:[]})));delete s.meters}
    s.accounts=s.accounts.filter(a=>a.type!=='krypto');
    s.v=10;
  }
  s.taxRate=s.taxRate||{base:0.7,rate:0.12};s.settings=s.settings||{remind:true};
  return s;
}
/* ---------- Speichern (auf dem Gerät) ---------- */
const DBN='djcapital',KV='kv',RC='receipts';
let dbP=null;
function idb(){if(!dbP)dbP=new Promise((res,rej)=>{const r=indexedDB.open(DBN,1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(KV))d.createObjectStore(KV);if(!d.objectStoreNames.contains(RC))d.createObjectStore(RC)};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});return dbP}
async function idbGet(st,k){const d=await idb();return new Promise((res,rej)=>{const q=d.transaction(st).objectStore(st).get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
async function idbSet(st,k,v){const d=await idb();return new Promise((res,rej)=>{const t=d.transaction(st,'readwrite');t.objectStore(st).put(v,k);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}
async function idbAll(st){const d=await idb();return new Promise((res,rej)=>{const o={},t=d.transaction(st),c=t.objectStore(st).openCursor();c.onsuccess=()=>{const x=c.result;if(x){o[x.key]=x.value;x.continue()}else res(o)};c.onerror=()=>rej(c.error)})}
function blankState(){return {v:10,props:[],units:[],txs:[],rules:[],cats:EXP_CATS.slice(),icats:INC_CATS.slice(),accounts:[],plans:[],reserve:null,fixcosts:[],devices:[],meterDevs:[],taxRate:{base:0.7,rate:0.12},notes:[],reminders:[],settings:{remind:true,owner:''}}}
async function loadState(){let s=null;try{s=await idbGet(KV,'state')}catch(e){}if(!s||!s.v)s=blankState();s.settings=s.settings||{remind:true};return migrate(s)}
let saveT=null;
function setStatus(t,c){const el=document.getElementById('savest');if(el){el.textContent=t;el.className='savest '+(c||'')}}
function save(){setStatus('Nicht gespeichert','wait');clearTimeout(saveT);saveT=setTimeout(()=>{saveT=null;doSave()},60)}
async function doSave(){try{await idbSet(KV,'state',S);setStatus('Gespeichert','ok')}catch(e){setStatus('Fehler beim Speichern','bad');toast('Speichern fehlgeschlagen. Bitte unter „Mehr“ ein Backup speichern.')}}
window.addEventListener('pagehide',()=>{if(saveT){clearTimeout(saveT);doSave()}});
function dlBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000)}
async function shrink(file){try{const bmp=await createImageBitmap(file);const k=Math.min(1,1400/Math.max(bmp.width,bmp.height));const c=document.createElement('canvas');c.width=Math.round(bmp.width*k);c.height=Math.round(bmp.height*k);c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);return c.toDataURL('image/jpeg',0.75)}catch(e){return await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(file)})}}
async function recSrc(ref){if(!ref)return '';if(ref.startsWith('local:')){try{return await idbGet(RC,ref.slice(6))||''}catch(e){return ''}}return ''}
/* ---------- Fingerabdruck-Sperre ---------- */
const b64=a=>btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0));
async function lockAvailable(){try{return !!(window.PublicKeyCredential&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())}catch(e){return false}}
async function lockEnable(){const c=await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rp:{name:'DJ Capital'},user:{id:crypto.getRandomValues(new Uint8Array(16)),name:'djcapital',displayName:'DJ Capital'},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'discouraged'},timeout:60000}});S.settings.lock=b64(c.rawId);await doSave()}
async function lockVerify(){await navigator.credentials.get({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),allowCredentials:[{type:'public-key',id:unb64(S.settings.lock)}],userVerification:'required',timeout:60000}})}
let locked=false,hiddenAt=0;
/* Neu laden (z. B. nach unten ziehen) innerhalb einer Minute fragt nicht erneut */
function markUnlocked(){try{localStorage.setItem('djc-unl',String(Date.now()))}catch(e){}}
function recentUnlock(){try{return Date.now()-(+localStorage.getItem('djc-unl')||0)<60000}catch(e){return false}}
setInterval(()=>{if(!locked&&!document.hidden&&S&&S.settings&&S.settings.lock)markUnlocked()},15000);
window.addEventListener('pagehide',()=>{if(!locked&&S&&S.settings&&S.settings.lock&&!document.hidden)markUnlocked()});
function showLock(){locked=true;closeModal();$('#root').innerHTML='<div class="lock"><div class="logo big" aria-hidden="true"><span>DJ</span></div><h2>DJ Capital</h2><p class="hint">Gesperrt. Entsperre mit Fingerabdruck oder Gesichtserkennung.</p><button class="primary" data-act="unlock">Entsperren</button></div>';autoUnlock()}
let unlocking=false;
function autoUnlock(){const go=()=>{if(locked&&!unlocking&&!document.hidden)unlock(true)};if(document.hasFocus())setTimeout(go,150);else window.addEventListener('focus',()=>setTimeout(go,150),{once:true})}
async function unlock(auto){if(unlocking)return;unlocking=true;try{await lockVerify();locked=false;markUnlocked();render();runGo()}catch(e){if(!auto)toast('Entsperren abgebrochen. Bitte erneut versuchen.')}finally{unlocking=false}}
document.addEventListener('visibilitychange',()=>{if(document.hidden){hiddenAt=Date.now();if(!locked&&S&&S.settings&&S.settings.lock)markUnlocked()}else if(S&&S.settings&&S.settings.lock&&!locked&&Date.now()-hiddenAt>60000)showLock()});
/* ---------- Hilfen ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const sel=c=>c?' selected':'';
const eur=n=>{n=n||0;return n.toLocaleString('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:Math.round(n)===n?0:2})};
const eurK=n=>Math.abs(n)>=10000?(n/1000).toLocaleString('de-DE',{maximumFractionDigits:0})+' Tsd. €':eur(Math.round(n));
const dfmt=d=>d?d.slice(8,10)+'.'+d.slice(5,7)+'.'+d.slice(0,4):'';
const propOf=id=>S.props.find(p=>p.id===id);
const unitOf=id=>S.units.find(u=>u.id===id);
const accOf=id=>S.accounts.find(a=>a.id===id);
const unitLabel=u=>{const p=propOf(u.propertyId);const s=p?p.name.split(/[\s,]+/)[0]:'';return (s&&s!==u.name?s+' ':'')+u.name};
function toast(t){const el=$('#toast');el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,4200)}
function modal(html){const m=$('#modal');m.innerHTML='<div class="mbox" role="dialog" aria-modal="true">'+html+'</div>';m.hidden=false;const f=m.querySelector('input:not([type=file]):not([type=checkbox]),select,textarea');if(f&&!f.readOnly)f.focus()}
function closeModal(){const m=$('#modal');m.hidden=true;m.innerHTML=''}
let pendingFn=null;
function ask(msg,ok,fn){pendingFn=fn;modal('<h3>Bitte bestätigen</h3><p>'+esc(msg)+'</p><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="confirmOk">'+esc(ok)+'</button></div>')}
const ui={month:monthOf(todayISO()),year:+todayISO().slice(0,4),filter:'open',q:'',limit:100,geld:'monat'};
try{const u=JSON.parse(sessionStorage.getItem('jui3')||'null');if(u)Object.assign(ui,u)}catch(e){}
function saveUi(){try{sessionStorage.setItem('jui3',JSON.stringify(ui))}catch(e){}}
const LBL={paid:'Bezahlt',late:'Überfällig',partial:'Teilweise',over:'Mehr bezahlt',pending:'Offen',none:'Keine Miete'};
const pill=st=>'<span class="pill '+st+'">'+LBL[st]+'</span>';
const ICON={
 home:'<svg viewBox="0 0 24 24"><path d="M3 12l9-8 9 8M5 10v10h14V10"/></svg>',
 geld:'<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
 immo:'<svg viewBox="0 0 24 24"><path d="M4 21V5l8-3v19M12 21h8V9l-8-3"/><path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2"/></svg>',
 konten:'<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>',
 more:'<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
 up:'<svg viewBox="0 0 24 24"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>',
 pay:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v12H3zM3 10h18M7 15h4"/></svg>',
 bill:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4"/></svg>'};
/* ---------- Berechnungen ---------- */
const accValue=a=>{const h=(a.history||[]).slice().sort((x,y)=>x.date.localeCompare(y.date));return h.length?h[h.length-1]:null};
const accValueAt=(a,d)=>{let v=0;(a.history||[]).forEach(h=>{if(h.date<=d)v=h.value});const f=(a.history||[]).filter(h=>h.date<=d).sort((x,y)=>x.date.localeCompare(y.date));return f.length?f[f.length-1].value:0};
const propTotal=()=>0;
const accTotal=()=>S.accounts.reduce((s,a)=>s+((accValue(a)||{}).value||0),0);
function worthSeries(){
  const dates=[...new Set(S.accounts.flatMap(a=>(a.history||[]).map(h=>h.date)))].sort();
  return dates.map(d=>({date:d,value:S.accounts.reduce((s,a)=>s+accValueAt(a,d),0)+propTotal()}));
}
const isInc=t=>t.type==='rent'||t.type==='income';
const monthTx=ym=>S.txs.filter(t=>(t.type==='rent'?(t.forMonth||monthOf(t.date)):monthOf(t.date))===ym);
function monthSums(ym){const l=monthTx(ym);const inc=l.filter(isInc).reduce((s,t)=>s+t.amount,0);const out=-l.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);return {inc,out,l}}
function byCat(list){const m={};list.forEach(t=>{const c=t.category||'Ohne Kategorie';m[c]=(m[c]||0)+Math.abs(t.amount)});return Object.entries(m).sort((a,b)=>b[1]-a[1])}
/* ---------- Erinnerungen ---------- */
const daysTo=d=>Math.round((Date.parse(d)-Date.parse(todayISO()))/864e5);
function remindItems(){
  const T=todayISO(),out=[];
  S.units.forEach(u=>{
    if(u.rpo==='open'){const d0=(u.start||monthOf(T))+'-01',dl=new Date(Date.parse(d0)+8*864e5).toISOString().slice(0,10);out.push({date:dl,t:'Mietvertrag melden '+unitLabel(u),s:'Über ePorezna → Zahtjevi → RPO, Vertrag als Anhang. Frist 8 Tage ab Mietbeginn. Danach in der Einheit auf „erledigt“ stellen.',lvl:daysTo(dl)<0?'late':'partial'})}
    if(u.contractEnd&&u.noticeMonths){const ym=addMonth(u.contractEnd.slice(0,7),-u.noticeMonths);const k=ym+'-'+pad(new Date(+ym.slice(0,4),+ym.slice(5,7),0).getDate());const d=daysTo(k);
      if(d<=120&&u.contractEnd>=T)out.push({date:k,t:'Kündigungsfrist '+unitLabel(u),s:d<0?'Frist vorbei, Vertrag läuft bis '+dfmt(u.contractEnd):'Spätestens bis '+dfmt(k)+' kündigen, sonst verlängert sich der Vertrag',lvl:d<0?'late':d<=30?'partial':'pending'})}
    if(u.contractEnd&&daysTo(u.contractEnd)<=120&&u.contractEnd>=T)out.push({date:u.contractEnd,t:'Vertragsende '+unitLabel(u),s:'Läuft am '+dfmt(u.contractEnd)+' aus',lvl:'partial'});
    [monthOf(T),addMonth(monthOf(T),-1)].forEach(m=>{const s=rentStatus(u,m,S.txs,T);if(s&&(s.st==='late'||s.st==='partial'))out.push({date:m+'-'+pad(u.dueDay||5),t:'Miete '+unitLabel(u)+' '+monthLabel(m),s:s.st==='late'?'Noch nicht eingegangen ('+eur(s.exp)+')':'Es fehlen '+eur(s.missing),lvl:'late',act:'immo'})});
    if(u.cl&&u.cl.kind){const L=CL[u.cl.kind],n=L.filter(x=>u.cl.done&&u.cl.done[x[0]]).length;if(n<L.length)out.push({date:u.cl.started||T,t:(u.cl.kind==='auszug'?'Auszug ':'Einzug ')+unitLabel(u),s:n+' von '+L.length+' Aufgaben erledigt',lvl:'pending',act:'cl:'+u.id})}
  });
  const cy=+T.slice(0,4);
  (S.plans||[]).filter(p=>p.status!=='Erledigt'&&p.year&&p.year<=cy).forEach(p=>out.push({date:p.year+'-12-31',t:p.title,s:(p.year<cy?'Überfällig, geplant für ':'Geplant für ')+p.year+((propOf(p.propertyId)||{}).name?' · '+propOf(p.propertyId).name:''),lvl:p.year<cy?'late':'pending',act:'plan:'+p.id}));
  (S.reminders||[]).forEach(r=>{const d=daysTo(r.date);if(d<=(r.lead||30))out.push({date:r.date,t:r.title,s:(d<0?'Fällig seit '+dfmt(r.date):d===0?'Heute fällig':'Fällig am '+dfmt(r.date))+(r.repeat&&r.repeat!=='none'?' · wiederholt sich '+(r.repeat==='yearly'?'jährlich':'monatlich'):''),lvl:d<0?'late':d<=7?'partial':'pending',rid:r.id})});
  (S.bills||[]).filter(b=>b.status==='open'&&b.due).forEach(b=>{const d=daysTo(b.due);if(d<=14)out.push({date:b.due,t:'Rechnung '+(b.payee||''),s:(d<0?'Fällig seit '+dfmt(b.due):d===0?'Heute fällig':'Fällig am '+dfmt(b.due))+(b.amount!=null?' · '+eur(b.amount):''),lvl:d<0?'late':d<=3?'partial':'pending',act:'bill:'+b.id,app:1})});
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
const LVL={late:'Dringend',partial:'Bald',pending:'Geplant'};
const remRow=x=>'<div class="rem '+x.lvl+'"><span class="it"><strong>'+esc(x.t)+'</strong><small>'+esc(x.s)+'</small></span>'+(x.rid?'<button class="small" data-act="remDone" data-id="'+x.rid+'">Erledigt</button>':x.act?'<button class="small" data-act="remGo" data-v="'+esc(x.act)+'">Öffnen</button>':'')+'</div>';
function remindCard(){if(S.settings&&S.settings.remind===false)return '';const L=remindItems();if(!L.length)return '';
  return '<section class="card accent ay"><div class="h2row"><h3><span class="hic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/></svg></span>Demnächst</h3>'+(L.length>3?'<button class="small" data-act="remAll">Alle ('+L.length+')</button>':'')+'</div><div class="rems">'+L.slice(0,3).map(remRow).join('')+'</div></section>'}
/* ---------- Monatsvergleich ---------- */
function unusual(ym){
  const cur=byCat(monthTx(ym).filter(t=>t.type==='expense')),prev={};
  [1,2,3].forEach(i=>monthTx(addMonth(ym,-i)).filter(t=>t.type==='expense').forEach(t=>{const c=t.category||'Ohne Kategorie';prev[c]=(prev[c]||0)+Math.abs(t.amount)/3}));
  const has=[1,2,3].some(i=>monthTx(addMonth(ym,-i)).some(t=>t.type==='expense'&&t.src!=='excel'));if(!has)return [];
  return cur.map(([c,v])=>({c,v,p:prev[c]||0,d:v-(prev[c]||0)})).filter(x=>x.d>=50&&(x.p===0||x.d/x.p>=0.3)&&!/reparatur/i.test(x.c)).sort((a,b)=>b.d-a.d).slice(0,3);
}
function unusualCard(ym){const L=unusual(ym);if(!L.length)return '';
  return '<section class="card"><h3>Auffällig in '+esc(MONTHS[+ym.slice(5)-1])+'</h3><div class="rems">'+L.map(x=>'<button class="rem partial btnrow" data-act="catList" data-p="m:'+ym+'" data-c="'+esc(x.c)+'"><span class="it"><strong>'+esc(x.c)+'</strong><small>'+(x.p?eur(Math.round(x.d))+' mehr als im Schnitt der letzten 3 Monate ('+eur(Math.round(x.p))+')':'Neu diesen Monat')+'</small></span><span class="num neg">'+eur(Math.round(x.v))+' ›</span></button>').join('')+'</div></section>'}
/* ---------- Mieterwechsel ---------- */
const CL={
 auszug:[['kuend','Kündigung erhalten und schriftlich bestätigt'],['termin','Übergabetermin mit dem Mieter vereinbart'],['zaehler','Zählerstände Wasser und Strom am Auszugstag abgelesen und in der App eingetragen'],['pruef','Wohnung geprüft, Schäden mit Fotos dokumentiert'],['schluessel','Schlüssel zurück, Smart-Lock-Codes geändert'],['kaution','Kaution abgerechnet und zurückgezahlt'],['eporezna','Raskid ugovora in ePorezna gemeldet (Zahtjevi → RPO → Prilog)'],['versorger','HEP und Vodovod umgemeldet'],['app','Mietende in der App eingetragen']],
 einzug:[['vertrag','Mietvertrag unterschrieben (ggf. beim Notar beglaubigt)'],['kaution','Kaution erhalten'],['miete','Erste Miete erhalten'],['protokoll','Übergabeprotokoll mit Fotos gemacht'],['zaehler','Zählerstände am Einzugstag abgelesen und eingetragen'],['schluessel','Schlüssel und Smart-Lock-Code übergeben'],['eporezna','Vertrag in ePorezna gemeldet (Zahtjevi → RPO → Ugovor o najmu)'],['versorger','HEP und Vodovod umgemeldet'],['app','Mieter, Miete, IBAN und Vertragsende in der App eingetragen']]};
function clDlg(id,kind){const u=unitOf(id);if(!u)return;kind=kind||(u.cl&&u.cl.kind)||'auszug';const st=(u.cl&&u.cl.kind===kind)?u.cl:{kind,done:{}};const L=CL[kind],n=L.filter(x=>st.done[x[0]]).length;
  modal('<div class="mhead"><div><h3>Mieterwechsel '+esc(unitLabel(u))+'</h3><small>'+n+' von '+L.length+' erledigt</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div><div class="seg"><button data-act="clKind" data-id="'+id+'" data-v="auszug"'+(kind==='auszug'?' class="on"':'')+'>Auszug</button><button data-act="clKind" data-id="'+id+'" data-v="einzug"'+(kind==='einzug'?' class="on"':'')+'>Einzug</button></div><div class="meter"><i style="width:'+(n/L.length*100)+'%"></i></div><div class="cl">'+L.map(([k,t])=>'<label class="chk clrow'+(st.done[k]?' done':'')+'"><input type="checkbox" data-cl="'+k+'" data-id="'+id+'" data-k="'+kind+'"'+(st.done[k]?' checked':'')+'><span>'+esc(t)+(st.done[k]?'<small> · '+dfmt(st.done[k])+'</small>':'')+'</span></label>').join('')+'</div><div class="mact"><button data-act="clReset" data-id="'+id+'">Liste zurücksetzen</button><button class="primary" data-act="close">Fertig</button></div>')}
/* ---------- Belege ---------- */
let samP=null,assP=null,dlP=null;
const cap=(n)=>Promise.resolve(n==='downloads'?{save:async r=>{dlBlob(new Blob([r.data],{type:/\.html$/.test(r.filename)?'text/html':'application/octet-stream'}),r.filename);return {status:'saved'}}}:null);
const getSample=()=>samP||(samP=cap('sample'));const getAssets=()=>assP||(assP=cap('assets'));const getDl=()=>dlP||(dlP=cap('downloads'));
const receiptBtn=()=>'<button class="receipt" data-act="pickReceipt"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span><strong>Beleg fotografieren</strong><small>Foto speichern und Ausgabe eintragen</small></span></button>';
let rec=null;
async function handleReceipt(file){
  rec={file,url:URL.createObjectURL(file),data:{},assetId:'',status:'Wird gelesen …'};recDlg();
  const [assets,sample]=await Promise.all([getAssets(),getSample()]);
  {const rid=uid();rec.assetId='local:'+rid;shrink(file).then(u=>idbSet(RC,rid,u)).catch(()=>{})}
  if(!sample){rec.status='Foto ist gespeichert. Bitte Betrag und Datum eintragen.';recDlg();return}
  try{
    const prompt='Das Bild ist ein Kassenbon, eine Rechnung oder ein Beleg. Lies ihn aus und antworte nur mit JSON: {"date":"YYYY-MM-DD oder leer","amount":Gesamtbetrag als Zahl in EUR (Brutto, positiv),"vendor":"Händler oder Firma","description":"was gekauft wurde, kurz auf Deutsch, max. 60 Zeichen","category":"eine aus der Liste"}. Kategorien: '+S.cats.join(' | ')+'. Wenn etwas nicht lesbar ist, lass das Feld leer. Heute ist '+todayISO()+'.';
    const d=await sample.json(prompt,{images:[file],modelTier:'quick'});
    rec.data=d||{};rec.status=d&&d.amount?'Erkannt. Bitte prüfen und zuordnen.':'Nicht alles erkannt. Bitte ergänzen.';
  }catch(e){rec.status=e&&e.code==='not_granted'?'Automatisches Lesen wurde nicht erlaubt. Bitte Betrag und Datum eintragen.':'Der Beleg konnte nicht gelesen werden. Bitte Betrag und Datum eintragen.'}
  if(rec)recDlg();
}
function recMatches(){const a=parseDE(String(rec.data.amount||$('#f-bamt')&&$('#f-bamt').value||''));const d=rec.data.date||todayISO();if(isNaN(a)||!a)return [];
  return S.txs.filter(t=>t.amount<0&&Math.abs(Math.abs(t.amount)-Math.abs(a))<0.01&&Math.abs(daysTo(t.date)-daysTo(d))<=14&&!t.receipt).slice(0,3)}
function recDlg(){if(!rec)return;const d=rec.data||{};const cats=S.cats.slice();if(d.category&&!cats.includes(d.category))cats.unshift(d.category);
  const m=recMatches();
  modal('<div class="mhead"><div><h3>Beleg</h3><small>'+esc(rec.status)+'</small></div><button class="ic" data-act="recCancel" aria-label="Schließen">×</button></div><img class="recimg" src="'+rec.url+'" alt="Foto des Belegs">'
  +(m.length?'<div class="tips"><div class="tip done"><b>Passende Buchung gefunden</b><span>'+m.map(t=>esc(dfmt(t.date)+' · '+(t.name||'')+' · '+eur(t.amount))).join('<br>')+'</span><button data-act="recAttach" data-id="'+m[0].id+'">Beleg an diese Buchung hängen</button></div></div><p class="hint">Oder als neue Ausgabe speichern:</p>':'')
  +'<div class="grid2"><label>Datum<input id="f-bdate" type="date" value="'+esc(d.date||todayISO())+'"></label><label>Betrag (€)<input id="f-bamt" inputmode="decimal" value="'+esc(d.amount?String(d.amount).replace('.',','):'')+'"></label><label>Händler<input id="f-bven" value="'+esc(d.vendor||'')+'"></label><label>Kategorie<select id="f-bcat">'+cats.map(c=>'<option'+sel(c===d.category)+'>'+esc(c)+'</option>').join('')+'</select></label><label>Wofür<select id="f-bprop"><option value="">Privat</option>'+S.props.map(p=>'<option value="'+p.id+'">Immobilie: '+esc(p.name)+'</option>').join('')+'</select></label><label>Einheit (optional)<select id="f-bunit"><option value="">–</option>'+S.units.map(u=>'<option value="'+u.id+'">'+esc(unitLabel(u))+'</option>').join('')+'</select></label></div><label>Beschreibung<input id="f-bdesc" value="'+esc(d.description||'')+'"></label><div class="mact"><button data-act="recCancel">Abbrechen</button><button class="primary" data-act="recSave">Als Ausgabe speichern</button></div>')}
function receiptView(id){const t=S.txs.find(x=>x.id===id);if(!t||!t.receipt)return;modal('<div class="mhead"><div><h3>Beleg</h3><small>'+esc(dfmt(t.date)+' · '+(t.name||'')+' · '+eur(t.amount))+'</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div><img class="recimg" id="recv" alt="Beleg">');recSrc(t.receipt).then(u=>{const i=$('#recv');if(i){if(u)i.src=u;else i.replaceWith(Object.assign(document.createElement('p'),{className:'hint',textContent:'Dieses Foto wurde in der alten Version gespeichert und ist hier nicht verfügbar.'}))}})}
const recChip=t=>t.receipt?' <button class="small link clip" data-act="receiptView" data-id="'+t.id+'" aria-label="Beleg ansehen"><svg viewBox="0 0 24 24"><path d="M8 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l7-7"/></svg></button>':'';
/* ---------- Jahresbericht ---------- */
function reportHtml(y){y=String(y);
  const inY=t=>(t.type==='rent'?(t.forMonth||t.date):t.date).startsWith(y),L=S.txs.filter(inY);
  const e=s=>esc(s),E=n=>eur(Math.round(n*100)/100);
  let h='<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Jahresbericht '+y+'</title><style>body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:820px;margin:30px auto;padding:0 20px;font-size:13px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:2px solid #ff5b2e;padding-bottom:4px}h3{font-size:14px;margin:16px 0 6px}table{border-collapse:collapse;width:100%;margin:4px 0 10px}td,th{padding:5px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}td.r,th.r{text-align:right;white-space:nowrap}tr.sum td{font-weight:bold;border-top:2px solid #111}.muted{color:#666}@media print{h2{break-after:avoid}}</style></head><body><h1>Jahresbericht '+y+'</h1><div class="muted">'+e((S.settings&&S.settings.owner)||'')+' · erstellt am '+dfmt(todayISO())+' mit DJ Capital</div>';
  const tr=S.taxRate||{base:.7,rate:.12};let totInc=0,totOut=0;
  const IO=immoOn();if(IO)h+='<h2>Immobilien</h2>';
  (IO?S.props:[]).forEach(p=>{const units=S.units.filter(u=>u.propertyId===p.id);const rent=L.filter(t=>t.type==='rent'&&(unitOf(t.unitId)||{}).propertyId===p.id);const ex=L.filter(t=>t.type==='expense'&&t.propertyId===p.id);
    const ri=rent.reduce((s,t)=>s+t.amount,0),eo=-ex.reduce((s,t)=>s+t.amount,0);totInc+=ri;totOut+=eo;
    h+='<h3>'+e(p.name)+'</h3><table><tr><th>Einheit</th><th>Mieter</th><th class="r">Monate bezahlt</th><th class="r">Mieteinnahmen</th></tr>'+units.map(u=>{const r=rent.filter(t=>t.unitId===u.id);const ms=new Set(r.map(t=>t.forMonth||monthOf(t.date))).size;return r.length?'<tr><td>'+e(u.name)+'</td><td>'+e(u.tenant||'')+'</td><td class="r">'+ms+'</td><td class="r">'+E(r.reduce((s,t)=>s+t.amount,0))+'</td></tr>':''}).join('')+'<tr class="sum"><td colspan="3">Summe Mieten</td><td class="r">'+E(ri)+'</td></tr></table>';
    if(ex.length)h+='<table><tr><th>Datum</th><th>Ausgabe</th><th>Kategorie</th><th class="r">Betrag</th></tr>'+ex.sort((a,b)=>a.date.localeCompare(b.date)).map(t=>'<tr><td>'+dfmt(t.date)+'</td><td>'+e(t.purpose||t.name)+(t.receipt?' (Beleg in der App)':'')+'</td><td>'+e(t.category||'')+'</td><td class="r">'+E(-t.amount)+'</td></tr>').join('')+'<tr class="sum"><td colspan="3">Summe Ausgaben</td><td class="r">'+E(eo)+'</td></tr></table>';
    const tax=ri*tr.base*tr.rate;h+='<table><tr><td>Ergebnis vor Steuer</td><td class="r"><b>'+E(ri-eo)+'</b></td></tr><tr><td class="muted">Steuer geschätzt ('+Math.round(tr.rate*100)+' % auf '+Math.round(tr.base*100)+' % der Miete)</td><td class="r muted">'+E(tax)+'</td></tr></table>'});
  if(IO)h+='<table><tr class="sum"><td>Immobilien gesamt: Einnahmen '+E(totInc)+' · Ausgaben '+E(totOut)+'</td><td class="r">'+E(totInc-totOut)+'</td></tr></table>';
  const inc=L.filter(t=>t.type==='income'),pex=L.filter(t=>t.type==='expense'&&(!IO||!propOf(t.propertyId)));
  const grp=(l)=>{const m={};l.forEach(t=>{const c=t.category||'Ohne Kategorie';m[c]=(m[c]||0)+Math.abs(t.amount)});return Object.entries(m).sort((a,b)=>b[1]-a[1])};
  h+='<h2>Weitere Einnahmen</h2><table>'+grp(inc).map(([c,v])=>'<tr><td>'+e(c)+'</td><td class="r">'+E(v)+'</td></tr>').join('')+'<tr class="sum"><td>Summe</td><td class="r">'+E(inc.reduce((s,t)=>s+t.amount,0))+'</td></tr></table>';
  h+='<h2>'+(IO?'Private Ausgaben nach Kategorie':'Ausgaben nach Kategorie')+'</h2><table>'+grp(pex).map(([c,v])=>'<tr><td>'+e(c)+'</td><td class="r">'+E(v)+'</td></tr>').join('')+'<tr class="sum"><td>Summe</td><td class="r">'+E(-pex.reduce((s,t)=>s+t.amount,0))+'</td></tr></table>';
  const lo=loans().filter(o=>o.l.some(inY));if(lo.length)h+='<h2>Verliehenes Geld</h2><table>'+lo.map(o=>'<tr><td>'+e(o.p)+'</td><td class="r">'+(Math.abs(o.open)<0.01?'zurückgezahlt':'offen '+E(o.open))+'</td></tr>').join('')+'</table>';
  h+='<h2>Kontostände</h2><table>'+S.accounts.map(a=>{const v=(a.history||[]).filter(x=>x.date<=y+'-12-31').sort((p,q)=>p.date.localeCompare(q.date)).pop();return '<tr><td>'+e(a.name)+'</td><td class="muted">'+(v?'Stand '+dfmt(v.date):'')+'</td><td class="r">'+(v?E(v.value):'–')+'</td></tr>'}).join('')+'</table>';
  if(IO)h+='<p class="muted">Die Steuerwerte sind eine Schätzung aus der App und ersetzen keine Steuerberatung.</p></body></html>';
  return h;
}
async function saveReport(){const y=+$('#f-ry').value;const dl=await getDl();const html=trHtml(reportHtml(y));
  if(!dl){modal('<h3>Jahresbericht '+y+'</h3><p class="hint">Speichern ist hier nicht möglich. Kopiere den Bericht und speichere ihn als .html-Datei.</p><textarea class="big" readonly>'+esc(html)+'</textarea><div class="mact"><button data-act="close">Schließen</button></div>');return}
  try{await dl.save({filename:tr('Jahresbericht').replace(/ /g,'_')+'_'+y+'.html',data:html});closeModal();toast('Jahresbericht gespeichert. Öffnen, dann „Drucken → Als PDF speichern“.')}catch(e){if(e&&e.code!=='declined')toast('Speichern hat nicht geklappt.')}}
/* ---------- Automatische Erkennung ---------- */
const DICT=[
 [/meta platforms|facebook|instagram|google ads|linkedin ads/,'Werbung & Marketing (Firma)'],
 [/rewe|edeka|aldi|lidl|penny|netto|kaufland|tegut|alnatura|spar |konzum|plodine|tommy|studenac/,'Lebensmittel'],
 [/aral|shell|esso|tankstelle|jet tank|total energies|ina d\.d|petrol|tank & rast/,'Auto & Tanken'],
 [/verkehrsverbund|rmv|deutsche bahn|db vertrieb|flixbus|uber|bolt|miles mobility|share now/,'Mobilität'],
 [/vodafone|telekom|o2 |telefonica|1&1|congstar|netflix|spotify|disney|amazon prime|apple\.com|icloud|youtube|a1 hrvatska|hrvatski telekom/,'Handy, Internet & Abos'],
 [/fitseveneleven|fit711|mcfit|fitness|gym|urban sports/,'Fitness & Sport'],
 [/booking\.com|airbnb|ryanair|lufthansa|eurowings|croatia airlines|hotel/,'Reisen'],
 [/temu|amazon|zalando|ebay|otto |shein|aliexpress/,'Online-Shopping'],
 [/kartenabrechnung|kreditkarte|hanseatic/,'Kreditkarte'],
 [/allianz|huk|axa|ergo|generali|versicherung|osiguranje/,'Versicherung'],
 [/apotheke|ljekarna|arzt|zahnarzt/,'Gesundheit'],
 [/restaurant|lieferando|wolt|mcdonald|burger king|cafe|bistro/,'Freizeit & Restaurant'],
 [/finanzamt|porezna/,'Steuern'],
 [/\bmiete\b|hausverwaltung|treuverwaltung|nebenkosten|stadtwerke|mainova|strom|gas /,'Wohnen & Nebenkosten']
];
const IDICT=[[/familienkasse|kindergeld/,'Kindergeld'],[/finanzamt.*erstatt|steuererstatt/,'Steuererstattung'],[/aok|krankenkasse|tk |barmer|dak /,'Krankenkasse']];
function dictAssign(tx,hay){
  const D=tx.amount<0?DICT:IDICT,C=tx.amount<0?S.cats:S.icats;
  for(const [re,c] of D){if(re.test(hay)){if(!C.includes(c))C.push(c);tx.type=tx.amount<0?'expense':'income';tx.category=c;return true}}
  return false;
}
/* ---------- Darlehen ---------- */
function loans(){const m={};S.txs.filter(t=>t.type==='loan').forEach(t=>{const p=t.person||t.name||'Unbekannt',k=nrm(p);(m[k]=m[k]||{p,l:[],open:0}).l.push(t);m[k].open-=t.amount});return Object.values(m)}
/* ---------- Ampel & Empfehlungen ---------- */
function last3(){const cm=monthOf(todayISO()),ms=[1,2,3].map(i=>addMonth(cm,-i));const l=S.txs.filter(t=>ms.includes(t.type==='rent'?(t.forMonth||monthOf(t.date)):monthOf(t.date)));
  const inc=l.filter(isInc).reduce((s,t)=>s+t.amount,0)/3,out=-l.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)/3;return {l,inc,out,ms}}
function ampel(){const b=wishBase(),a={inc:b.inc,out:b.out};if(!b.has||(!a.inc&&!a.out))return {c:'grey',t:'Noch zu wenig Daten',d:'Lade Kontoauszüge der letzten Monate hoch, dann zeigt die Ampel deinen Stand.',a};
  if(!a.inc)return {c:'grey',t:'Keine regelmäßige Einnahme erkannt',d:'Tippe auf „Rechnung ansehen“ und wähle, welche Einnahmen jeden Monat kommen.',a};
  const r=a.inc?(a.inc-a.out)/a.inc:-1;
  if(r>=0.4)return {c:'green',t:'Läuft gut',d:'Du gibst im Schnitt '+Math.round((1-r)*100)+' % deiner Einnahmen aus. Es bleiben etwa '+eur(Math.round(a.inc-a.out))+' im Monat übrig.',a};
  if(r>=0)return {c:'yellow',t:'Knapp',d:'Es bleiben nur etwa '+eur(Math.round(a.inc-a.out))+' im Monat übrig ('+Math.round(r*100)+' % der Einnahmen). Grün gibt es ab 40 %.',a};
  return {c:'red',t:'Achtung',d:'Du gibst im Schnitt '+eur(Math.round(a.out-a.inc))+' mehr aus, als reinkommt.',a};
}
function ampelCard(){const x=ampel();
  return '<section class="card ampel '+x.c+'"><div class="alight" aria-hidden="true"><i class="r"></i><i class="y"></i><i class="g"></i></div><div class="atext"><div class="hl">Dein Stand · üblicher Monat</div><strong>'+x.t+'</strong><p>'+esc(x.d)+' <button class="lnk" data-act="wishRate">Rechnung ansehen</button></p><div class="form"><button data-act="wishPlan">Wo kann ich sparen?</button><button data-act="tipsCash">Was tun mit dem Geld?</button></div></div></section>';
}
const mkey=t=>nrm(t.name||'').replace(/^paypal: /,'').replace(/[^a-z ]/g,' ').trim().split(/\s+/).slice(0,2).join(' ');
function saveTips(){
  const x=ampel(),a=x.a,ex=a.l.filter(t=>t.type==='expense'&&!propOf(t.propertyId)),g={};
  ex.forEach(t=>{const k=mkey(t);if(!k)return;(g[k]=g[k]||{name:(t.name||'').replace(/^PayPal: /,''),cat:t.category,l:[]}).l.push(t)});
  const tips=[];
  Object.values(g).forEach(o=>{const sum=-o.l.reduce((s,t)=>s+t.amount,0),months=new Set(o.l.map(t=>monthOf(t.date))).size,avg=sum/3;
    if(o.l.length>=5&&sum/o.l.length<30)tips.push({v:avg,h:o.name+': '+o.l.length+' kleine Zahlungen',d:'Zusammen etwa '+eur(Math.round(avg))+' im Monat. Viele kleine Beträge fallen kaum auf. Prüfe, ob sich das lohnt'+(/werbung/i.test(o.cat||'')?' und ob die Werbung Kunden bringt.':'.')});
    else if(months>=2&&o.l.length<=months+1&&/abo|handy|fitness|internet/i.test(o.cat||''))tips.push({v:avg,h:o.name+': regelmäßige Zahlung',d:'Etwa '+eur(Math.round(avg))+' im Monat. Brauchst du das noch, oder gibt es einen günstigeren Tarif?'})});
  const cats=byCat(ex).slice(0,3);const tot=-ex.reduce((s,t)=>s+t.amount,0)||1;
  cats.forEach(([c,v])=>{if(v/tot>0.25&&!/wohnen|steuer|versicherung|kreditkarte/i.test(c))tips.push({v:v/3,h:c+' ist dein größter Posten',d:Math.round(v/tot*100)+' % deiner privaten Ausgaben, etwa '+eur(Math.round(v/3))+' im Monat. Hier lohnt sich ein genauer Blick.'})});
  const kk=ex.filter(t=>t.category==='Kreditkarte');if(kk.length)tips.push({v:-kk.reduce((s,t)=>s+t.amount,0)/3,h:'Kreditkarte',d:'Die Kreditkartenabrechnung zeigt nicht, wofür das Geld ausgegeben wurde. Schau in die Abrechnung, dort stecken oft Abos und Spontankäufe.'});
  tips.sort((p,q)=>q.v-p.v);
  const head=x.c==='green'&&!tips.length?'<p class="okline">Dein Cashflow ist gerade gut. Es gibt keine auffälligen Posten.</p>':x.c==='green'?'<p class="hint">Dein Cashflow ist gut. Das hier sind trotzdem die Posten, bei denen sich Sparen am ehesten lohnt:</p>':'<p class="hint">Diese Posten bringen am meisten, wenn du sie reduzierst:</p>';
  modal('<div class="mhead"><div><h3>Wo kann ich sparen?</h3><small>Private Ausgaben der letzten 3 Monate</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'+head+(tips.length?'<div class="tips">'+tips.slice(0,6).map(t=>'<div class="tip"><b>'+esc(t.h)+'</b><span>'+esc(t.d)+'</span></div>').join('')+'</div>':'')+'<p class="hint">Die Hinweise rechnet die App aus deinen Buchungen. Ob eine Ausgabe sinnvoll ist, weißt nur du.</p>');
}
function cashTips(){
  const a=last3(),cash=accTotal(),outM=Math.max(a.out,1),buf=outM*6,free=cash-buf;
  const r=S.reserve||{},cy=+todayISO().slice(0,4);
  const due=(S.plans||[]).filter(p=>p.status!=='Erledigt'&&p.year&&p.year<=cy+1);const dueSum=due.reduce((s,p)=>s+(+p.est||0),0);
  const lent=loans().reduce((s,o)=>s+Math.max(0,o.open),0);
  const items=[];
  items.push({h:'1. Notgroschen',ok:cash>=buf,d:'Empfohlen sind 3 bis 6 Monatsausgaben auf dem Tagesgeld- oder Girokonto. Bei dir sind das etwa '+eur(Math.round(buf))+'. Du hast '+eur(Math.round(cash))+'.'});
  if(r.target)items.push({h:'2. Rücklage für die Häuser',ok:false,d:'Ziel '+eur(r.target)+' als 10-Jahres-Puffer, geplant mit '+eur(r.yearly)+' im Jahr ab '+r.startYear+'. Ein Teil des freien Geldes kann die Rücklage schneller auffüllen.'});
  if(due.length)items.push({h:'3. Fällige Modernisierungen',ok:false,d:due.length+' Maßnahmen bis '+(cy+1)+' für etwa '+eur(dueSum)+': '+due.map(p=>p.title).join(', ')+'. Was den Mietwert erhöht oder Reparaturen vermeidet, zuerst.'});
  if(lent>0)items.push({h:'Verliehenes Geld',ok:false,d:eur(lent)+' sind noch nicht zurückgezahlt.'});
  items.push({h:'Danach: anlegen',ok:null,d:'Übliche Möglichkeiten für Geld, das du länger nicht brauchst: Tagesgeld oder Festgeld (sicher, wenig Zinsen), breit gestreute ETFs (langfristig, schwankt), Sondertilgung eines Kredits (sicherer „Zins“ in Höhe des Kreditzinses). Was zu dir passt, hängt von deinen Zielen und deinem Risiko ab.'});
  modal('<div class="mhead"><div><h3>Was tun mit dem Geld?</h3><small>'+(free>0?'Etwa '+eur(Math.round(free))+' über dem Notgroschen':'Der Notgroschen ist noch nicht voll')+'</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div><div class="tips">'+items.map(i=>'<div class="tip'+(i.ok===true?' done':'')+'"><b>'+(i.ok===true?'✓ ':'')+esc(i.h)+'</b><span>'+esc(i.d)+'</span></div>').join('')+'</div><p class="hint">Das ist eine Reihenfolge, wie sie in Ratgebern üblich ist, keine Anlageberatung. Für größere Beträge lohnt sich ein unabhängiger Honorarberater.</p>');
}
/* ---------- Wunschliste & Sparplan ---------- */
const SAVE_FIX=/wohnen|steuer|versicherung|kredit|gesundheit|firma|komunalna|müll|hrt|familie|reparatur|klima/i;
function saveRule(c,mode,l){const ag=mode==='a',n=l.length,sum=-l.reduce((s,t)=>s+t.amount,0),avg=sum/3;
  if(/kreditkarte/i.test(c))return null;
  if(/restaurant|freizeit/i.test(c)){if(!ag)return {cut:avg*0.3,how:'Etwa ein Drittel weniger: seltener essen gehen, öfter zu Hause kochen.'};
    const one=Math.min(avg,sum/Math.max(n,1));return {cut:Math.max(0,avg-one),how:'Zu Hause kochen. Höchstens 1-mal im Monat ins Restaurant (etwa '+eur(Math.round(one))+').'}}
  if(/abo|handy|internet/i.test(c))return ag?{cut:avg*0.5,how:'Alle Abos kündigen oder pausieren, die du nicht täglich brauchst. Handy- und Internettarif auf den günstigsten umstellen.'}:{cut:avg*0.15,how:'Abos durchgehen: Was du seit einem Monat nicht benutzt hast, kündigen.'};
  if(/kleidung|shopping/i.test(c))return ag?{cut:avg*0.9,how:'Kaufstopp, bis der Wunsch erfüllt ist. Nur ersetzen, was kaputt ist.'}:{cut:avg*0.3,how:'Nur gezielt kaufen, keine Spontankäufe. 24 Stunden warten, bevor du bestellst.'};
  if(/reise/i.test(c))return ag?{cut:avg*0.8,how:'Urlaub verschieben oder günstig bei Familie verbringen.'}:{cut:avg*0.25,how:'Früher buchen, Nebensaison, kürzere Reisen.'};
  if(/lebensmittel/i.test(c))return ag?{cut:avg*0.15,how:'Wochenplan und Einkaufszettel, Eigenmarken, nichts wegwerfen. Mehr als 15 % ist hier kaum drin, weil du öfter zu Hause kochst.'}:{cut:avg*0.05,how:'Einkaufszettel schreiben und Angebote nutzen.'};
  if(/auto|tanken/i.test(c))return ag?{cut:avg*0.2,how:'Kurze Wege zu Fuß oder mit dem Rad, Fahrten zusammenlegen.'}:{cut:avg*0.05,how:'Günstig tanken (abends), Reifendruck prüfen.'};
  return ag?{cut:avg*0.5,how:'Auf das Nötigste beschränken, bis der Wunsch erfüllt ist.'}:{cut:avg*0.15,how:'Jede Ausgabe kurz prüfen: brauche ich das wirklich?'}}
function wishBase(){const cm=monthOf(todayISO()),ms=[1,2,3,4,5,6].map(i=>addMonth(cm,-i));const mOf=t=>t.type==='rent'?(t.forMonth||monthOf(t.date)):monthOf(t.date);
  const all=S.txs.filter(t=>ms.includes(mOf(t))&&(isInc(t)||t.type==='expense')&&!isOwnTransfer(t));
  const have=ms.filter(m=>all.some(t=>mOf(t)===m)),nM=have.length;
  const med=v=>{if(!v.length)return 0;const s=v.slice().sort((x,y)=>x-y),h=s.length>>1;return s.length%2?s[h]:(s[h-1]+s[h])/2};
  const nm=t=>{const n=payeeKey(String(t.name||'').replace(/^PayPal: /i,''));return n&&n!=='von hand'&&n!=='–'&&n!=='-'?n:''};
  const srcKey=t=>t.type==='rent'?'r:'+(t.unitId||''):'i:'+(nm(t)?'n:'+nm(t):t.iban?'b:'+t.iban:(learnKey(t)||'c:'+nrm(t.category||'')));
  const g={};all.filter(isInc).forEach(t=>{const k=srcKey(t);const o=g[k]=g[k]||{k,name:t.type==='rent'?('Miete '+((unitOf(t.unitId)&&unitLabel(unitOf(t.unitId)))||'')):(t.name||t.category||'Einnahme'),cat:t.type==='rent'?'Miete':(t.category||''),pm:{},l:[]};if(!t.xr)o.pm[mOf(t)]=(o.pm[mOf(t)]||0)+t.amount;o.l.push(t)});
  const ov=S.wishInc||{};const accFirst={};S.txs.forEach(t=>{const k=t.accountId||'';const m=monthOf(t.date);if(!accFirst[k]||m<accFirst[k])accFirst[k]=m});
  const src=Object.values(g).map(o=>{const n=Object.keys(o.pm).length;o.xn=o.l.filter(t=>t.xr).length;let amt=med(Object.values(o.pm));
    const first=o.l.reduce((s,t)=>{const f=t.type==='rent'?ms[5]:(accFirst[t.accountId||'']||ms[5]);return f<s?f:s},'9999-99');const el=Math.max(1,ms.filter(m=>m>=first&&have.includes(m)).length),need=Math.max(2,Math.ceil(el*2/3));o.el=el;if(n<el)amt=!n?0:Object.values(o.pm).reduce((s,v)=>s+v,0)/el;const auto=n>=need;const on=n>0&&(ov[o.k]!=null?!!ov[o.k]:auto);return Object.assign(o,{n,amt,auto,on})}).sort((p,q)=>(q.on-p.on)||q.amt-p.amt);
  const inc=src.filter(s=>s.on).reduce((s,o)=>s+o.amt,0);
  const out=med(have.map(m=>-all.filter(t=>t.type==='expense'&&mOf(t)===m).reduce((s,t)=>s+t.amount,0)));
  const auto=inc-out,man=S.settings&&S.settings.saveRate,manual=man!=null&&man!=='';
  return {src,nM,inc,out,auto,manual,rate:manual?+man:auto,has:nM>0}}
function wishRateDlg(){const b=wishBase();const row=s=>'<div class="erow"><span><button class="lnk" data-act="wishSrc" data-k="'+esc(s.k)+'">'+esc(s.name)+' ›</button><small>'+(s.cat?esc(s.cat)+' · ':'')+s.l.length+(s.l.length===1?' Buchung':' Buchungen')+(s.xn?', '+s.xn+' davon '+(s.xn===1?'zählt':'zählen')+' nicht':'')+' · in '+s.n+' von '+s.el+(s.el===1?' Monat':' Monaten')+'</small></span><span class="form" style="margin:0;align-items:center"><span class="num '+(s.on?'pos':'')+'">'+eur(Math.round(s.amt))+'</span><button class="small" data-act="wishInc" data-k="'+esc(s.k)+'" data-v="'+(s.on?0:1)+'">'+(s.on?'Rausnehmen':'Mitzählen')+'</button></span></div>';
  const reg=b.src.filter(s=>s.on),one=b.src.filter(s=>!s.on);
  modal('<div class="mhead"><div><h3>Was bleibt im Monat übrig?</h3><small>Regelmäßige Einnahmen minus übliche Ausgaben</small></div><button class="ic" data-act="wishPlan" aria-label="Zurück">×</button></div>'
    +'<h3 class="gt lh">Regelmäßige Einnahmen · '+eur(Math.round(b.inc))+' im Monat</h3>'+(reg.length?'<div class="elist kvs">'+reg.map(row).join('')+'</div>':'<p class="hint">Die App hat noch keine regelmäßige Einnahme erkannt. Tippe unten bei deinem Gehalt auf „Mitzählen“.</p>')
    +(one.length?'<h3 class="gt lh">Einmalig oder unregelmäßig · zählt nicht mit</h3><div class="elist kvs">'+one.map(row).join('')+'</div>':'')
    +'<p class="hint">Als regelmäßig gilt, was in den meisten Monaten vom selben Absender kam, zum Beispiel Gehalt oder Miete. Gezählt werden nur Monate, für die das Konto schon Daten hat. Gerechnet wird mit dem üblichen Monatsbetrag. Tippe auf einen Namen, um die einzelnen Buchungen zu sehen. Mit dem Knopf rechts änderst du, was zählt.</p>'
    +'<div class="erow"><span><b>Übliche Ausgaben</b><small>mittlerer Monat der letzten sechs Monate</small></span><span class="num neg">−'+eur(Math.round(b.out))+'</span></div>'
    +'<div class="erow"><span><b>Bleibt im Monat</b></span><span class="num">'+eur(Math.round(b.auto))+'</span></div>'
    +'<label>Oder eigener Betrag pro Monat (€)<input id="f-wr" inputmode="decimal" value="'+(b.manual?String(b.rate).replace('.',','):'')+'" placeholder="leer = automatisch"></label>'
    +'<div class="mact"><button data-act="wishPlan">Zurück</button><button class="primary" data-act="wishRateSave">Speichern</button></div>');if(document.activeElement&&document.activeElement.id==='f-wr')document.activeElement.blur();const mb=$('#modal .mbox');if(mb)mb.scrollTop=0;$('#modal').scrollTop=0}
function wishSrcDlg(k,keep){const b=wishBase(),s=b.src.find(x=>x.k===k);if(!s){wishRateDlg();return}const mOf=t=>t.type==='rent'?(t.forMonth||monthOf(t.date)):monthOf(t.date);
  const old=keep&&$('#modal .mbox')?$('#modal .mbox').scrollTop:0,old2=keep?$('#modal').scrollTop:0;
  const months=[...new Set(s.l.map(mOf))].sort().reverse();const sum=l=>Math.round(l.reduce((x,t)=>x+t.amount,0)*100)/100;
  modal('<div class="mhead"><div><h3>'+esc(s.name)+'</h3><small>'+s.l.length+(s.l.length===1?' Buchung':' Buchungen')+(s.xn?', '+s.xn+' davon '+(s.xn===1?'zählt':'zählen')+' nicht':'')+' · in '+s.n+' von '+s.el+(s.el===1?' Monat':' Monaten')+' · üblich '+eur(Math.round(s.amt))+' im Monat</small></div><button class="ic" data-act="wishRate" aria-label="Zurück">×</button></div>'
    +'<p class="hint">'+(s.on?'Zählt als regelmäßige Einnahme mit.':s.n?'Zählt nicht mit.':'Keine Buchung ist ausgewählt.')+(s.n&&s.auto!==s.on?' Von dir so eingestellt.':'')+(s.n&&s.n<s.el?' In '+(s.el-s.n)+(s.el-s.n===1?' Monat':' Monaten')+' kam nichts, deshalb ist „üblich“ der Durchschnitt über alle '+s.el+' Monate.':'')+'</p>'
    +'<div class="form">'+(s.n?'<button class="primary" data-act="wishInc" data-k="'+esc(s.k)+'" data-v="'+(s.on?0:1)+'" data-back="src">'+(s.on?'Alle rausnehmen':'Mitzählen')+'</button>':'')+'<button data-act="wishRate">Zurück</button></div>'
    +'<p class="hint">Mit dem Haken wählst du bei jeder Buchung, ob sie zum regelmäßigen Einkommen gehört. Einmalige Rechnungen nimmst du so heraus.</p>'
    +months.map(m=>{const L=s.l.filter(t=>mOf(t)===m).sort((x,y)=>y.date.localeCompare(x.date)),c=L.filter(t=>!t.xr);return '<h3 class="gt lh">'+esc(monthLabel(m))+' · '+eur(sum(c))+(c.length<L.length?' von '+eur(sum(L)):'')+'</h3><div class="elist kvs">'+L.map(t=>'<label class="erow xrow'+(t.xr?' off':'')+'"><input type="checkbox" data-xr="'+t.id+'" data-k="'+esc(s.k)+'"'+(t.xr?'':' checked')+' aria-label="Zählt mit"><span><b>'+esc(t.name||t.category||'–')+'</b><small>'+dfmt(t.date)+(accOf(t.accountId)?' · '+esc(accOf(t.accountId).name):'')+(t.category?' · '+esc(t.category):'')+(t.purpose?'<br>'+esc(t.purpose):'')+'</small></span><span class="num '+(t.xr?'':'pos')+'">'+eur(t.amount)+'</span></label>').join('')+'</div>'}).join(''));
  if(keep){const mb=$('#modal .mbox');if(mb)mb.scrollTop=old;$('#modal').scrollTop=old2}}
function wishCalc(mode){const a=last3(),keep=S.wishKeep||[];const ex=a.l.filter(t=>t.type==='expense'&&!propOf(t.propertyId)),g={};
  ex.forEach(t=>{const c=t.category||'Ohne Kategorie';(g[c]=g[c]||[]).push(t)});
  const rows=[];Object.entries(g).forEach(([c,l])=>{const avg=-l.reduce((s,t)=>s+t.amount,0)/3;if(avg<5)return;const fix=SAVE_FIX.test(c),kept=keep.includes(c);
    const r=fix?null:saveRule(c,mode,l);rows.push({c,avg,fix,kept,cut:r&&!kept?Math.round(r.cut):0,how:r?r.how:'',unknown:/kreditkarte/i.test(c)})});
  rows.sort((p,q)=>q.cut-p.cut||q.avg-p.avg);
  const wb=wishBase(),base=wb.rate,extra=rows.reduce((s,r)=>s+r.cut,0);return {a,rows,base,extra,wb,has:wb.has||wb.manual}}
function wishEta(rate){let left=0;const cm=monthOf(todayISO());return (S.wishes||[]).filter(w=>!w.done).map(w=>{left+=Math.max(0,(+w.price||0)-(+w.saved||0));
  if(rate<=0)return {w,m:null};const m=Math.ceil(left/rate);return {w,m,ym:addMonth(cm,m)}})}
const etaText=e=>e.m==null?'so nicht erreichbar':e.m<=0?'schon möglich':monthLabel(e.ym)+' (in '+e.m+(e.m===1?' Monat':' Monaten')+')';
function wishCard(){const W=(S.wishes||[]).filter(w=>!w.done),mode=(S.settings&&S.settings.saveMode)||'n';const x=wishCalc(mode),E=wishEta(x.base+x.extra);
  return '<section class="card wish accent av"><div class="h2row"><h3><span class="hic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-4-6-4-6-1.5S9 7 12 7c3 0 6-1 6-1.5S14 3 12 7"/></svg></span>Wunschliste</h3><button class="small" data-act="wishAdd">+ Wunsch</button></div>'
    +(W.length?'<div class="elist">'+E.map(e=>'<button class="erow btnrow" data-act="wishPlan"><span><b>'+esc(e.w.title)+'</b><small>'+(x.has?esc(etaText(e)):'Noch zu wenig Daten')+'</small><span class="wbar"><i style="width:'+Math.min(100,Math.round((+e.w.saved||0)/(+e.w.price||1)*100))+'%"></i></span></span><span class="num">'+eur(+e.w.price||0)+'</span></button>').join('')+'</div>'
      +'<button class="primary" data-act="wishPlan">Sparplan ansehen · '+(mode==='a'?'aggressiv':'normal')+'</button>'
      :'<p class="hint">Was möchtest du dir kaufen? Trag es ein, dann rechnet die App aus, wann du es dir leisten kannst und wo du dafür sparen kannst.</p>')+'</section>'}
function wishDlg(id){const w=id?(S.wishes||[]).find(x=>x.id===id):{title:'',price:'',saved:''};const n=v=>v===''||v==null||v===0?'':String(v).replace('.',',');
  modal('<h3>'+(id?'Wunsch bearbeiten':'Neuer Wunsch')+'</h3><label>Was möchtest du kaufen?<input id="f-wt" value="'+esc(w.title)+'" placeholder="z. B. Neues Auto"></label><div class="grid2"><label>Preis (€)<input id="f-wp" inputmode="decimal" value="'+n(w.price)+'" placeholder="z. B. 15000"></label><label>Schon gespart (€)<input id="f-ws" inputmode="decimal" value="'+n(w.saved)+'" placeholder="optional"></label></div>'
    +'<div class="mact">'+(id?'<button class="danger" data-act="wishDel" data-id="'+id+'">Löschen</button>':'')+'<button data-act="wishPlan">Abbrechen</button><button class="primary" data-act="wishSave" data-id="'+(id||'')+'">Speichern</button></div>')}
/* ---------- Icons Modernisierung ---------- */
const PICON=[
 [/glasfaser|internet|wlan/,'<path d="M5 12a10 10 0 0 1 14 0M8 15a6 6 0 0 1 8 0"/><circle cx="12" cy="18" r="1.3"/><path d="M2 9a14 14 0 0 1 20 0"/>'],
 [/sprechanlage|klingel|intercom/,'<rect x="7" y="3" width="10" height="18" rx="2"/><circle cx="12" cy="8" r="2"/><path d="M10 13h4M10 16h4"/>'],
 [/rollo|jalousie/,'<rect x="4" y="3" width="16" height="4" rx="1"/><path d="M6 7v10h12V7M6 10h12M6 13h12M12 17v3"/>'],
 [/sonne|segel|beschattung/,'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'],
 [/lüftung|lueftung|ventil/,'<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 2-6 4-5s0 5-4 5M14 12c4 0 6 2 5 4s-5 0-5-4M12 14c0 4-2 6-4 5s0-5 4-5M10 12c-4 0-6-2-5-4s5 0 5 4"/>'],
 [/dusche|bad|wc/,'<path d="M5 21V8a4 4 0 0 1 8 0"/><path d="M10 11h6M11 14v1M13 15v1M15 14v1M12 17v1M14 18v1"/>'],
 [/boiler|bojler|heizung|warmwasser/,'<rect x="7" y="3" width="10" height="18" rx="3"/><path d="M10 15c0-2 2-2 2-4 0 2 2 2 2 4a2 2 0 0 1-4 0z"/>'],
 [/dach|krov/,'<path d="M3 12l9-7 9 7"/><path d="M6 10v10h12V10"/>'],
 [/fenster|prozor/,'<rect x="5" y="4" width="14" height="16" rx="1"/><path d="M12 4v16M5 12h14"/>'],
 [/klima/,'<path d="M12 3v18M4 7.5l16 9M20 7.5l-16 9"/>'],
 [/maler|farbe|streichen/,'<rect x="4" y="3" width="13" height="6" rx="1"/><path d="M17 6h3v5h-8v3M11 14h2v7h-2z"/>'],
 [/solar|photovoltaik/,'<path d="M3 18l3-10h12l3 10z"/><path d="M4.5 13h15M9 8l-1 10M15 8l1 10"/>']];
const DEF_ICON='<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.4-.4-2.6z"/>';
const planIcon=t=>{const n=nrm(t);const f=PICON.find(([re])=>re.test(n));return '<span class="picon" aria-hidden="true"><svg viewBox="0 0 24 24">'+(f?f[1]:DEF_ICON)+'</svg></span>'};
/* ---------- Zähler ---------- */
const MKIND={Wasser:'blue',Strom:'yellow',Gas:'red',Heizung:'red'};
function metersBlock(){
  const L=S.meterDevs||[];
  return '<details class="obj"><summary><span class="it"><strong>Zähler</strong><small>'+L.length+' Zähler für Wasser, Strom und Gas</small></span><span class="chev">›</span></summary><div class="elist">'+L.map(m=>{const r=(m.readings||[]).slice().sort((a,b)=>b.date.localeCompare(a.date))[0];
    return '<button class="erow mrow" data-act="meter" data-id="'+m.id+'"><span><b><i class="mk '+(MKIND[m.kind]||'')+'"></i>'+esc(m.kind)+' · '+esc(m.place||'')+'</b><small>'+esc((propOf(m.propertyId)||{}).name||'')+(m.number?' · Nr. '+esc(m.number):' · Zählernummer fehlt')+(r?' · zuletzt '+dfmt(r.date):'')+'</small></span><span class="num">'+(r?esc(r.value):'–')+' ›</span></button>'}).join('')+'</div><div class="form pad"><button data-act="addMeterDev">+ Zähler</button></div></details>';
}
function meterDlg(id){const m=(S.meterDevs||[]).find(x=>x.id===id);if(!m)return;const R=(m.readings||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));
  modal('<div class="mhead"><div><h3>'+esc(m.kind)+' · '+esc(m.place||'')+'</h3><small>'+esc((propOf(m.propertyId)||{}).name||'')+(m.number?' · Nr. '+esc(m.number):'')+(m.omm?' · OMM '+esc(m.omm):'')+(m.account?' · Vertrag '+esc(m.account):'')+(m.code?' · Code '+esc(m.code):'')+(m.note?'<br>'+esc(m.note):'')+'</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div><div class="grid2"><label>Neuer Stand<input id="f-rv" inputmode="decimal"></label><label>Datum<input id="f-rd" type="date" value="'+todayISO()+'"></label></div><button class="primary" data-act="addReading" data-id="'+m.id+'">Stand speichern</button>'
  +(R.length?'<div class="kvs">'+R.map((r,i)=>'<div class="kv"><span>'+dfmt(r.date)+'</span><b class="num">'+esc(r.value)+(i<R.length-1&&!isNaN(parseDE(r.value))&&!isNaN(parseDE(R[i+1].value))?' <small class="muted">(+'+(parseDE(r.value)-parseDE(R[i+1].value)).toLocaleString('de-DE')+')</small>':'')+' <button class="small link" data-act="delReading" data-id="'+m.id+'" data-d="'+r.date+'" aria-label="Löschen">×</button></b></div>').join('')+'</div>':'')
  +'<div class="mact"><button class="danger" data-act="delMeterDev" data-id="'+m.id+'">Zähler löschen</button><button data-act="editMeterDev" data-id="'+m.id+'">Bearbeiten</button></div>')}
function meterDevDlg(id){const m=id?(S.meterDevs||[]).find(x=>x.id===id):{propertyId:S.props[0]&&S.props[0].id,kind:'Wasser',number:'',place:''};
  modal('<h3>'+(id?'Zähler bearbeiten':'Neuer Zähler')+'</h3><div class="grid2"><label>Objekt<select id="f-zp">'+S.props.map(p=>'<option value="'+p.id+'"'+sel(p.id===m.propertyId)+'>'+esc(p.name)+'</option>').join('')+'</select></label><label>Art<select id="f-zk">'+Object.keys(MKIND).map(k=>'<option'+sel(k===m.kind)+'>'+k+'</option>').join('')+'</select></label><label>Zählernummer<input id="f-zn" value="'+esc(m.number)+'"></label><label>Wo / welche Einheit<input id="f-zo" value="'+esc(m.place)+'" placeholder="z. B. 1. Kat, Keller"></label><label>OMM (Messstelle, Strom)<input id="f-zomm" value="'+esc(m.omm||'')+'"></label><label>Vertragskonto / Šifra potrošača<input id="f-zacc" value="'+esc(m.account||'')+'"></label><label>Code / Mjerno mjesto<input id="f-zcode" value="'+esc(m.code||'')+'"></label><label>Notiz<input id="f-znote" value="'+esc(m.note||'')+'"></label></div>'+(id?'':'<div class="grid2"><label>Erster Stand (optional)<input id="f-zv" inputmode="decimal"></label><label>Datum<input id="f-zd" type="date" value="'+todayISO()+'"></label></div>')+'<div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveMeterDev" data-id="'+(id||'')+'">Speichern</button></div>')}
/* Eigene Umbuchung: Gegenkonto ist eines der eigenen Konten, oder Gegenseite heißt wie der Inhaber (Mehr → Profil) */
function isOwnTransfer(tx){if(tx.iban&&S.accounts.some(a=>a.iban&&normIban(a.iban)===tx.iban))return true;
  const on=nrm((S.settings&&S.settings.owner)||'').trim();if(on.length<5||!tx.name)return false;const nn=nrm(tx.name);
  const parts=on.split(/\s+/);return parts.length>1&&parts.every(p=>nn.includes(p))}
/* Einmalig: früher wurden Überweisungen an einen festen Namen als Umbuchung versteckt. Jetzt nur noch eigene Konten. */
function mig11(){if(S.mig11)return;let n=0;S.txs.forEach(t=>{if(t.type!=='ignore')return;const hay=nrm((t.name||'')+' '+(t.purpose||''));if(/vlastiti ra|umbuchung|uebertrag eigenes/.test(hay))return;
  const g=cpFromText(t.purpose||'');const ib=t.iban||g.iban;if(!ib||S.accounts.some(a=>a.iban&&normIban(a.iban)===ib))return;if(!t.iban)t.iban=ib;if(!t.name&&g.name)t.name=g.name;t.type='open';autoAssign2(t);n++});S.mig11=1;if(n)save()}
/* Gelernte Zuordnungen: Empfänger (oder Händler aus dem Zweck) → Kategorie */
const L_STOP=/^(pos|kartica|karticom|visa|mastercard|maestro|kupnja|kupovina|placanje|plaćanje|zahlung|kartenzahlung|lastschrift|sepa|paypal|debit|kreditkarte|girocard|ec|nr|br|ref|www|http|https|the|und|von)$/;
const L_CHAIN=/^(ina|konzum|lidl|kaufland|plodine|spar|interspar|tifon|petrol|crodux|dm|muller|mueller|müller|rewe|aldi|edeka|penny|netto|rossmann|ikea|tommy|studenac|bauhaus|pevex|hofer|billa|shell|aral|omv|mcdonalds|amazon)$/;
function learnKey(tx){const sg=tx.amount<0?'-':'+';const n=payeeKey(String(tx.name||'').replace(/^PayPal: /i,''));if(n&&n!=='–'&&n!=='-')return sg+'n:'+n;
  const tok=nrm(tx.purpose||'').split(/\s+/).map(w=>w.replace(/^[^a-z0-9čćžšđäöüß]+|[^a-z0-9čćžšđäöüß.]+$/g,'')).map(w=>w.replace(/-[a-z]?\d+$/,'')).filter(w=>w&&!/^\d+$/.test(w)&&!L_STOP.test(w));
  if(!tok.length)return '';return sg+'p:'+(L_CHAIN.test(tok[0])?tok[0]:tok.slice(0,2).join(' '))}
function learnLabel(k){return k.slice(3)+(k[1]==='p'?' (im Zweck)':'')}
function learnApply(tx,v){tx.unitId='';tx.forMonth='';tx.category='';tx.propertyId='';tx.creditId='';
  if(v.t==='rent'){if(!unitOf(v.u))return false;tx.type='rent';tx.unitId=v.u;tx.forMonth=monthOf(tx.date)}
  else if(v.t==='expense'){tx.type='expense';tx.category=v.c||'';tx.propertyId=v.p&&propOf(v.p)?v.p:'';if(v.k&&creditOf(v.k))tx.creditId=v.k}
  else if(v.t==='income'){tx.type='income';tx.category=v.c||''}
  else if(v.t==='ignore')tx.type='ignore';else return false;return true}
function learnFrom(tx){const k=learnKey(tx);if(!k)return 0;S.learn=S.learn||{};
  if(tx.type==='open'){delete S.learn[k];return 0}
  if(!['rent','expense','income','ignore'].includes(tx.type))return 0;
  const v={t:tx.type};if(tx.type==='rent')v.u=tx.unitId;else if(tx.type!=='ignore'){v.c=tx.category||'';if(tx.propertyId)v.p=tx.propertyId;if(tx.creditId)v.k=tx.creditId}
  S.learn[k]=v;let n=0;S.txs.forEach(o=>{if(o!==tx&&o.type==='open'&&learnKey(o)===k&&learnApply(o,v)){n++;if(o.type==='rent')dedupeExcel(o)}});return n}
function learnSection(){const E=Object.entries(S.learn||{});const what=v=>v.t==='rent'?'Miete '+((unitOf(v.u)&&unitLabel(unitOf(v.u)))||''):v.t==='ignore'?'Umbuchung / ignorieren':(v.c||'')+(v.p&&propOf(v.p)?' · '+propOf(v.p).name:'');
  return '<section class="group"><h3>Gelernte Zuordnungen</h3><p class="hint">Ordnest du einen Umsatz zu, merkt sich die App den Empfänger. Alle offenen und alle neuen Umsätze von ihm werden genauso einsortiert.</p>'
    +(E.length?'<div class="list">'+E.sort((p,q)=>p[0].slice(3).localeCompare(q[0].slice(3))).map(([k,v])=>'<div class="item static"><span class="it"><strong>'+esc(learnLabel(k))+'</strong><small>'+esc(what(v))+'</small></span><button class="ic" data-act="delLearn" data-k="'+esc(k)+'" aria-label="Zuordnung vergessen">×</button></div>').join('')+'</div>':'<p class="hint">Noch nichts gelernt.</p>')+'</section>'}
function autoAssign2(tx){
  const hay=nrm(tx.name+' '+tx.purpose);
  if(/vlastiti ra|umbuchung|uebertrag eigenes/.test(hay)||isOwnTransfer(tx)){tx.type='ignore';return true}
  {const lv=S.learn&&S.learn[learnKey(tx)];if(lv&&learnApply(tx,lv))return true}
  if(tx.amount<0){const hay=nrm((tx.name||'')+' '+(tx.purpose||''));const c=(S.credits||[]).find(c=>c.keyword&&hay.includes(nrm(c.keyword)));if(c){tx.type='expense';tx.category='Kredit & Zinsen';tx.creditId=c.id;tx.propertyId=c.propertyId||'';return true}}
  if(tx.amount>0&&/kamat|habenzins|zinsgutschrift/.test(hay)&&S.icats.includes('Zinsen & Dividenden')){tx.type='income';tx.category='Zinsen & Dividenden';return true}
  if(tx.amount>0){
    let c=tx.iban?S.units.filter(u=>u.iban&&normIban(u.iban)===tx.iban):[];
    if(!c.length)c=S.units.filter(u=>u.rent>0&&unitMatches(u,hay));
    const u=pickUnit(c,tx.amount);if(u){tx.type='rent';tx.unitId=u.id;tx.forMonth=monthOf(tx.date);return true}
  }
  for(const r of S.rules){if(!r.keyword||!hay.includes(nrm(r.keyword)))continue;
    if(tx.amount<0&&S.cats.includes(r.category)){tx.type='expense';tx.category=r.category;tx.propertyId=r.propertyId||'';return true}
    if(tx.amount>0&&S.icats.includes(r.category)){tx.type='income';tx.category=r.category;return true}}
  if(dictAssign(tx,hay))return true;
  tx.type='open';return false;
}
/* ---------- Rahmen ---------- */
const TABS=[['start','Übersicht','home'],['geld','Ausgaben','geld'],['immo','Immobilien','immo'],['konten','Konten','konten'],['mehr','Mehr','more']];
const immoOn=()=>!(S&&S.settings&&S.settings.immo===false);
function curTab(){const t=(location.hash||'#start').slice(1).split('/')[0];return TABS.some(x=>x[0]===t)&&(t!=='immo'||immoOn())?t:'start'}
function render(){if(locked||authOpen)return;document.body.classList.toggle('hide',!!ui.hide);
  const cur=curTab(),openN=S.txs.filter(t=>t.type==='open').length;
  const nav=TABS.filter(t=>t[0]!=='immo'||immoOn()).map(t=>'<a href="#'+t[0]+'"'+(t[0]===cur?' class="on" aria-current="page"':'')+'>'+ICON[t[2]]+'<span>'+t[1]+'</span>'+(t[0]==='geld'&&openN?'<b class="badge">'+openN+'</b>':'')+'</a>').join('');
  const V={start:vStart,geld:vGeld,immo:vImmo,konten:vKonten,mehr:vMehr};
  $('#root').innerHTML='<header class="top"><div class="logo" aria-hidden="true"><span>DJ</span></div><div class="brand">My Capital<small>by DJ Capital</small></div><span class="savest" id="savest" aria-live="polite"></span><button class="ic eye'+(ui.hide?' on':'')+'" data-act="hide" aria-pressed="'+(ui.hide?'true':'false')+'" aria-label="'+(ui.hide?'Beträge zeigen':'Beträge verstecken')+'" title="'+(ui.hide?'Beträge zeigen':'Beträge verstecken')+'">'+(ui.hide?'<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6.1A9.9 9.9 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.7 3.3M6.2 7.6A17 17 0 0 0 3 12s4 6 9 6a9 9 0 0 0 3.9-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>':'<svg viewBox="0 0 24 24"><path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="3"/></svg>')+'</button></header><main class="stack">'+V[cur]()+'</main><nav class="bar" aria-label="Bereiche">'+nav+'</nav><input type="file" id="f-file" accept=".csv,.txt,.pdf,text/csv,application/pdf" hidden><input type="file" id="f-receipt" accept="image/*" capture="environment" hidden>';
}
const monthBar=()=>'<div class="mbar"><button class="ic" data-act="prevMonth" aria-label="Vorheriger Monat">‹</button><strong>'+esc(monthLabel(ui.month))+'</strong><button class="ic" data-act="nextMonth" aria-label="Nächster Monat">›</button></div>';
const uploadBtn=()=>'<button class="upload" data-act="pickFile">'+ICON.up+'<span><strong>Kontoauszug hochladen</strong><small>PDF oder CSV aus dem Online-Banking</small></span></button>';
function chart(series){
  if(series.length<2)return '';
  const W=320,H=90,P=4,vals=series.map(s=>s.value),mn=Math.min(...vals),mx=Math.max(...vals),rg=mx-mn||1;
  const t0=Date.parse(series[0].date),t1=Date.parse(series[series.length-1].date)||t0+1;
  const pts=series.map(s=>[P+(Date.parse(s.date)-t0)/(t1-t0||1)*(W-2*P),P+(1-(s.value-mn)/rg)*(H-2*P)]);
  const line=pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const last=pts[pts.length-1];
  return '<svg class="chart" viewBox="0 0 '+W+' '+(H+18)+'" role="img" aria-label="Verlauf des Vermögens"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".45"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs><polygon points="'+P+','+H+' '+line+' '+last[0]+','+H+'" fill="url(#ga)"/><polyline points="'+line+'" fill="none" stroke="var(--accent2)" stroke-width="2.5" stroke-linejoin="round"/><circle cx="'+last[0]+'" cy="'+last[1]+'" r="4.5" fill="var(--accent2)"/><text x="'+P+'" y="'+(H+15)+'" class="ct">'+series[0].date.slice(0,4)+'</text><text x="'+(W-P)+'" y="'+(H+15)+'" class="ct" text-anchor="end">heute</text></svg>';
}
/* ---------- Übersicht ---------- */
function vStart(){
  const total=accTotal()+propTotal(),ser=worthSeries();
  const prevY=ser.filter(s=>s.date.endsWith('-12-31')&&s.date<todayISO().slice(0,4)+'-01-01').pop();
  const diff=prevY?total-prevY.value:null;
  const yr=ui.per==='y';let m;if(yr){const y=String(ui.year),l=S.txs.filter(t=>(t.type==='rent'?(t.forMonth||t.date):t.date).startsWith(y));m={l,inc:l.filter(isInc).reduce((s,t)=>s+t.amount,0),out:-l.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0)}}else m=monthSums(ui.month);const rest=m.inc-m.out;
  const cats=byCat(m.l.filter(t=>t.type==='expense')).slice(0,4),cmax=cats.length?cats[0][1]:1;
  const openN=S.txs.filter(t=>t.type==='open').length;
  return (openN?'<a class="notice" href="#geld" data-act="goOpen">'+openN+' Umsätze warten auf Zuordnung <span>›</span></a>':'')
  +'<section class="hero"><div class="hl">Gesamtvermögen</div><div class="hv num">'+eur(Math.round(total))+'</div>'+(diff!=null?'<div class="hsub '+(diff>=0?'pos':'neg')+'">'+(diff>=0?'+':'−')+eur(Math.abs(Math.round(diff)))+' seit Jahresbeginn</div>':'')+creditHero(total)+chart(ser.concat(ser.length?[{date:todayISO(),value:total}]:[]))+'<div class="hbtn"><button class="pillb" data-act="upAuszug">'+ICON.up+'Kontoauszug</button><button class="pillb" data-act="upBeleg">'+ICON.up+'Beleg</button></div>'
  +'</section>'+billCard()+ampelCard()+wishCard()+remindCard()
  +'<div class="seg"><button data-act="per" data-v="m"'+(yr?'':' class="on"')+'>Monat</button><button data-act="per" data-v="y"'+(yr?' class="on"':'')+'>Jahr</button></div>'
  +(yr?'<div class="mbar"><button class="ic" data-act="yearPrev" aria-label="Vorjahr">‹</button><strong>'+ui.year+'</strong><button class="ic" data-act="yearNext" aria-label="Nächstes Jahr">›</button></div>':monthBar())
  +'<section class="tiles3"><button class="tilebtn" data-act="perList" data-k="inc" data-p="'+(yr?'y:'+ui.year:'m:'+ui.month)+'"><span>Einnahmen ›</span><b class="num pos">'+eur(Math.round(m.inc))+'</b></button><button class="tilebtn" data-act="perList" data-k="out" data-p="'+(yr?'y:'+ui.year:'m:'+ui.month)+'"><span>Ausgaben ›</span><b class="num neg">'+eur(Math.round(m.out))+'</b></button><div><span>Übrig</span><b class="num">'+eur(Math.round(rest))+'</b></div></section>'
  +(yr?'':unusualCard(ui.month))+(cats.length?'<section class="card"><div class="h2row"><h3>Wofür ging das Geld?</h3><a class="lnk" href="#geld">Alle ›</a></div>'+bars(cats,cmax,yr?'y:'+ui.year:'m:'+ui.month)+'</section>':'<div class="empty">'+(yr?'In diesem Jahr':'In diesem Monat')+' gibt es noch keine Ausgaben. Lade einen Kontoauszug hoch.</div>');
}
const bars=(cats,max,pk)=>'<div class="bars">'+cats.map(([c,v])=>'<button class="barrow" data-act="catList" data-p="'+esc(pk||'')+'" data-c="'+esc(c)+'"><div class="bl"><span>'+esc(c)+'</span><b class="num">'+eur(Math.round(v))+' ›</b></div><div class="bt"><i style="width:'+Math.max(3,v/max*100)+'%"></i></div></button>').join('')+'</div>';
function periodTx(pk){const i=pk.indexOf(':'),k=pk.slice(0,i),v=pk.slice(i+1);if(k==='y')return S.txs.filter(t=>(t.type==='rent'?(t.forMonth||t.date):t.date).startsWith(v));const l=monthTx(v);return k==='mp'?l.filter(t=>!propOf(t.propertyId)):l}
const periodLabel=pk=>{const v=pk.slice(pk.indexOf(':')+1);return v.length===4?'Jahr '+v:monthLabel(v)};
function txSource(t){if(t.type==='rent'){const u=unitOf(t.unitId);return 'Miete '+(u?unitLabel(u):'')}return t.category||'Ohne Kategorie'}
let LIST_PK='',PAYEE_IN=false;
const payeeKey=s=>nrm(String(s||'')).replace(/\s+/g,' ').trim();
function payeeDlg(name,mode,anchor){const k=payeeKey(name);const all=S.txs.filter(t=>t.type!=='ignore'&&payeeKey(t.name)===k);
  const sel_=t=>mode==='a'?true:t.date.startsWith(anchor);const l=all.filter(sel_).sort((a,b)=>b.date.localeCompare(a.date));
  const tot=Math.round(l.reduce((s,t)=>s+t.amount,0)*100)/100;
  const lab=mode==='m'?monthLabel(anchor):mode==='y'?anchor:'Alle Zahlungen';
  const nav=mode==='a'?'':'<div class="mbar"><button class="ic" data-act="payeeStep" data-v="-1" aria-label="Zurück">‹</button><strong>'+esc(lab)+'</strong><button class="ic" data-act="payeeStep" data-v="1" aria-label="Weiter">›</button></div>';
  const months=mode==='y'?new Set(l.map(t=>t.date.slice(0,7))).size:0;
  PAYEE_IN=true;let rows;try{rows=l.map(txRow).join('')}finally{PAYEE_IN=false}
  modal('<div class="mhead"><div><h3>'+esc(name)+'</h3><small>'+l.length+(l.length===1?' Zahlung · ':' Zahlungen · ')+eur(Math.abs(tot))+(mode==='y'&&months>1?' · Ø '+eur(Math.abs(Math.round(tot/12*100)/100))+' pro Monat':'')+'</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'
    +'<div class="seg" role="tablist">'+[['m','Monat'],['y','Jahr'],['a','Alles']].map(([v,t])=>'<button data-act="payeeMode" data-v="'+v+'"'+(v===mode?' class="on" aria-selected="true"':'')+'>'+t+'</button>').join('')+'</div>'+nav
    +(l.length?'<div class="elist kvs">'+rows+'</div>':'<div class="empty sm">Keine Zahlungen in diesem Zeitraum.</div>'));
  payeeDlg.cur={name,mode,anchor}}
function payeeOpen(name,date){const pk=LIST_PK||'';let mode='m',anchor=(date||todayISO()).slice(0,7);
  if(pk.startsWith('y:')){mode='y';anchor=pk.slice(2)}else if(/^m?p?:\d{4}-\d{2}/.test(pk)){anchor=pk.slice(pk.indexOf(':')+1,pk.indexOf(':')+8)}
  payeeDlg(name,mode,anchor)}
function payeeStep(d){const c=payeeDlg.cur;if(!c)return;let a=c.anchor;
  if(c.mode==='y')a=String(+a+d);else{const [y,m]=a.split('-').map(Number);const t=new Date(y,m-1+d,1);a=t.getFullYear()+'-'+String(t.getMonth()+1).padStart(2,'0')}
  payeeDlg(c.name,c.mode,a)}
function payeeMode(v){const c=payeeDlg.cur;if(!c)return;let a=c.anchor;if(v==='y')a=a.slice(0,4);else if(v==='m'&&c.mode!=='m'){const last=S.txs.filter(t=>payeeKey(t.name)===payeeKey(c.name)&&(c.mode==='a'||t.date.startsWith(a))).map(t=>t.date).sort().pop();a=(last||todayISO()).slice(0,7)}payeeDlg(c.name,v,a)}
function dupPairs(){const g={},out=[],ign=S.dupOk||[];S.txs.forEach(t=>{if(!t.amount||t.type==='ignore'||t.type==='loan')return;(g[t.amount.toFixed(2)]=g[t.amount.toFixed(2)]||[]).push(t)});
  const same=(p,q)=>p.name&&q.name?nameSim(p.name,q.name):(!p.name&&!q.name&&(p.accountId||'')===(q.accountId||'')&&nrm(p.purpose||'').slice(0,20)===nrm(q.purpose||'').slice(0,20)&&!!p.purpose);
  Object.values(g).forEach(l=>{if(l.length<2)return;l.sort((p,q)=>p.date.localeCompare(q.date));const hit=new Set();
    for(let i=0;i<l.length;i++)for(let k=i+1;k<l.length;k++){const p=l[i],q=l[k];if(Date.parse(q.date)-Date.parse(p.date)>2*864e5)break;if(hit.has(p.id)||hit.has(q.id))continue;
      if(same(p,q)&&!ign.includes(p.id+'~'+q.id)){out.push([p,q]);hit.add(p.id);hit.add(q.id)}}});
  return out.sort((x,y)=>y[1].date.localeCompare(x[1].date))}
function dupDlg(){const P=dupPairs();PAYEE_IN=true;let h;try{h=P.map(([p,q])=>'<div class="elist kvs" style="margin-bottom:10px">'+txRow(p)+txRow(q)+'<div class="erow"><span class="form" style="margin:0;flex-direction:row;flex-wrap:wrap"><button class="small primary" data-act="dupDel" data-id="'+p.id+'">Obere löschen</button><button class="small primary" data-act="dupDel" data-id="'+q.id+'">Untere löschen</button><button class="small" data-act="dupKeep" data-k="'+p.id+'~'+q.id+'">Beide behalten</button></span></div></div>').join('')}finally{PAYEE_IN=false}
  modal('<div class="mhead"><div><h3>Doppelte prüfen</h3><small>Gleicher Betrag und Absender innerhalb von 2 Tagen</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'+(P.length?'<p class="hint">Vergleiche mit deinem Konto bei der Bank. Steht die Zahlung dort nur einmal, lösche eine.</p>'+h:'<p class="okline">Keine doppelten Umsätze gefunden.</p>'))}
function listDlg(title,sub,l,group){
  l=l.slice().sort((a,b)=>b.date.localeCompare(a.date));const tot=l.reduce((s,t)=>s+t.amount,0);
  let body='';
  if(group){const g={};l.forEach(t=>{const k=txSource(t);(g[k]=g[k]||[]).push(t)});body=Object.entries(g).sort((a,b)=>Math.abs(b[1].reduce((s,t)=>s+t.amount,0))-Math.abs(a[1].reduce((s,t)=>s+t.amount,0))).map(([k,a])=>'<h3 class="gt lh">'+esc(k)+' · '+eur(Math.abs(Math.round(a.reduce((s,t)=>s+t.amount,0)*100)/100))+'</h3><div class="elist kvs">'+a.map(txRow).join('')+'</div>').join('')}
  else body='<div class="elist kvs">'+l.map(txRow).join('')+'</div>';
  modal('<div class="mhead"><div><h3>'+esc(title)+'</h3><small>'+esc(sub)+' · '+l.length+' Buchungen · '+eur(Math.abs(Math.round(tot*100)/100))+'</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'+(l.length?body:'<div class="empty sm">Keine Buchungen.</div>'));
}
const txRow=t=>{const acc=accOf(t.accountId),p=propOf(t.propertyId);return '<div class="erow"><span><b>'+(t.name&&!PAYEE_IN?'<button class="lnk" data-act="payee" data-n="'+esc(t.name)+'" data-d="'+t.date+'">'+esc(t.name)+'</button>':esc(t.name||'–'))+recChip(t)+'</b><small>'+dfmt(t.date)+(t.purpose?' · '+esc(t.purpose.slice(0,80)):'')+(p?' · '+esc(p.name):'')+(acc?' · '+esc(acc.name):'')+'</small></span><span class="num '+(t.amount<0?'neg':'pos')+'">'+eur(t.amount)+'</span></div>'};
/* ---------- Ausgaben / Umsätze ---------- */
function vGeld(){
  const seg='<div class="seg"><button data-act="geld" data-v="monat"'+(ui.geld==='monat'?' class="on"':'')+'>Monat</button><button data-act="geld" data-v="umsaetze"'+(ui.geld==='umsaetze'?' class="on"':'')+'>Umsätze</button><button data-act="geld" data-v="jahr"'+(ui.geld==='jahr'?' class="on"':'')+'>Jahr</button></div>';
  if(ui.geld==='umsaetze')return '<div class="h2row"><h2>Umsätze</h2><button class="primary" data-act="pickFile">Hochladen</button></div>'+seg+vTx();
  if(ui.geld==='jahr')return '<div class="h2row"><h2>Ausgaben</h2></div>'+seg+vYear();
  const m=monthSums(ui.month),ex=m.l.filter(t=>t.type==='expense');
  const IO=immoOn(),priv=ex.filter(t=>!IO||!propOf(t.propertyId)),imm=IO?ex.filter(t=>propOf(t.propertyId)):[];
  const cats=byCat(priv),max=cats.length?cats[0][1]:1;
  return '<div class="h2row"><h2>Ausgaben</h2></div>'+seg+monthBar()
  +'<section class="tiles3'+(IO?'':' two')+'"><div><span>'+(IO?'Privat':'Ausgaben')+'</span><b class="num neg">'+eur(Math.round(-priv.reduce((s,t)=>s+t.amount,0)))+'</b></div>'+(IO?'<div><span>Immobilien</span><b class="num neg">'+eur(Math.round(-imm.reduce((s,t)=>s+t.amount,0)))+'</b></div>':'')+'<div><span>Einnahmen</span><b class="num pos">'+eur(Math.round(m.inc))+'</b></div></section>'
  +(cats.length?'<section class="card"><h3>'+(IO?'Privat nach Kategorie':'Ausgaben nach Kategorie')+'</h3>'+bars(cats,max,'mp:'+ui.month)+'</section>':'<div class="empty">Keine privaten Ausgaben in diesem Monat.</div>')
  +(imm.length?'<details class="obj"><summary><span class="it"><strong>Ausgaben für Immobilien</strong><small>'+imm.length+' Buchungen</small></span><span class="chev">›</span></summary>'+expDetail(imm)+'</details>':'');
}
function vYear(){
  const y=String(ui.year),L=S.txs.filter(t=>(t.type==='rent'?(t.forMonth||t.date):t.date).startsWith(y));
  const inc=L.filter(isInc).reduce((s,t)=>s+t.amount,0),out=-L.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount,0);
  const mon=[];for(let i=1;i<=12;i++){const ym=y+'-'+pad(i);const s=monthSums(ym);mon.push([ym,s.inc,s.out])}
  const mx=Math.max(1,...mon.map(x=>Math.max(x[1],x[2])));
  const cats=byCat(L.filter(t=>t.type==='expense')),cm=cats.length?cats[0][1]:1;
  return '<div class="mbar"><button class="ic" data-act="yearPrev" aria-label="Vorjahr">‹</button><strong>'+y+'</strong><button class="ic" data-act="yearNext" aria-label="Nächstes Jahr">›</button></div>'
  +'<section class="tiles3"><div><span>Einnahmen</span><b class="num pos">'+eurK(inc)+'</b></div><div><span>Ausgaben</span><b class="num neg">'+eurK(out)+'</b></div><div><span>Übrig</span><b class="num">'+eurK(inc-out)+'</b></div></section>'
  +'<section class="card"><h3>Monate</h3><div class="cols">'+mon.map(([ym,i,o])=>'<div class="col" title="'+esc(monthLabel(ym)+': +'+eur(i)+' / −'+eur(o))+'"><div class="cb"><i class="ci" style="height:'+(i/mx*100)+'%"></i><i class="co" style="height:'+(o/mx*100)+'%"></i></div><span>'+MONTHS[+ym.slice(5)-1].slice(0,1)+'</span></div>').join('')+'</div><p class="legend"><span class="sw pos"></span>Einnahmen <span class="sw neg"></span>Ausgaben</p></section>'
  +(cats.length?'<section class="card"><h3>Alle Ausgaben nach Kategorie</h3>'+bars(cats,cm,'y:'+y)+'</section>':'');
}
function assignSelect(t){
  const v=t.type==='rent'?'rent:'+t.unitId:t.type==='expense'&&t.creditId&&creditOf(t.creditId)?'cr:'+t.creditId:t.type==='expense'?'exp:'+t.category:t.type==='income'?'inc:'+t.category:t.type;
  const og=(lab,arr,pre)=>'<optgroup label="'+lab+'">'+arr.map(c=>'<option value="'+pre+esc(c)+'"'+sel(v===pre+c)+'>'+esc(c)+'</option>').join('')+'</optgroup>';
  const rent=!immoOn()&&t.type!=='rent'?'':'<optgroup label="Miete von">'+S.units.filter(u=>u.rent>0).map(u=>'<option value="rent:'+u.id+'"'+sel(v==='rent:'+u.id)+'>'+esc(unitLabel(u))+'</option>').join('')+'</optgroup>';
  const cats=S.cats.slice();if(t.type==='expense'&&t.category&&!cats.includes(t.category))cats.push(t.category);
  const ic=S.icats.slice();if(t.type==='income'&&t.category&&!ic.includes(t.category))ic.push(t.category);
  return '<select data-tx="'+t.id+'" data-f="assign" aria-label="Zuordnung"><option value="open"'+sel(v==='open')+'>Nicht zugeordnet</option>'+(t.amount>0?rent+og('Einnahme',ic,'inc:')+og('Ausgabe (Rückbuchung)',cats,'exp:'):og('Ausgabe',cats,'exp:')+(creditOn()&&(S.credits||[]).length?'<optgroup label="Kreditrate">'+S.credits.map(c=>'<option value="cr:'+c.id+'"'+sel(v==='cr:'+c.id)+'>'+esc(c.name)+'</option>').join('')+'</optgroup>':'')+og('Einnahme',ic,'inc:')+rent)+'<option value="loan"'+sel(v==='loan')+'>Geld verliehen / zurückbekommen</option><option value="ignore"'+sel(v==='ignore')+'>Umbuchung / ignorieren</option></select>';
}
function txCard(t){
  const extra=t.type==='expense'&&(immoOn()||t.propertyId)?'<select data-tx="'+t.id+'" data-f="propertyId" aria-label="Wofür"><option value="">Privat</option>'+S.props.map(p=>'<option value="'+p.id+'"'+sel(p.id===t.propertyId)+'>Immobilie: '+esc(p.name)+'</option>').join('')+'</select>':'';
  const acc=accOf(t.accountId);
  return '<div class="tx '+t.type+'"><div class="txt"><div class="txh"><strong>'+esc(t.name||'–')+recChip(t)+'</strong><span class="num '+(t.amount<0?'neg':'pos')+'">'+eur(t.amount)+'</span></div><small>'+dfmt(t.date)+(acc?' · '+esc(acc.name):'')+(t.purpose?' · '+esc(t.purpose):'')+'</small></div><div class="txa">'+assignSelect(t)+extra+'</div></div>';
}
function filtered(){const q=nrm(ui.q);return S.txs.filter(t=>(ui.filter==='all'||t.type===ui.filter||(ui.filter==='income'&&t.type==='rent'))&&(!q||nrm(t.name+' '+t.purpose+' '+t.amount+' '+(t.category||'')).includes(q))).sort((a,b)=>b.date.localeCompare(a.date))}
function txList(){const all=filtered(),l=all.slice(0,ui.limit);if(!all.length)return '<div class="empty">'+(ui.filter==='open'?'Alles zugeordnet.':'Keine Umsätze gefunden.')+'</div>';return l.map(txCard).join('')+(all.length>l.length?'<button class="more" data-act="showMore">Mehr anzeigen ('+(all.length-l.length)+')</button>':'')}
function vTx(){
  const f=[['open','Offen'],['expense','Ausgaben'],['income','Einnahmen'],['all','Alle']];
  return '<div class="chips">'+f.map(x=>'<button class="chipb'+(ui.filter===x[0]?' on':'')+'" data-act="filter" data-v="'+x[0]+'">'+x[1]+'</button>').join('')+'</div>'+(ui.filter==='open'&&S.txs.some(t=>t.type==='open')?'<button data-act="reassignOpen">Automatisch zuordnen</button>':'')+(dupPairs().length?'<button data-act="dupFind">Doppelte prüfen ('+dupPairs().length+')</button>':'')+'<input type="search" id="txq" placeholder="Suchen" value="'+esc(ui.q)+'"><div id="txlist" class="txs">'+txList()+'</div>';
}
function expDetail(list){
  if(!list.length)return '<div class="empty sm">Keine Ausgaben.</div>';
  return '<div class="elist">'+list.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(t=>'<div class="erow"><span><b>'+esc(t.purpose||t.name)+'</b><small>'+dfmt(t.date)+' · '+esc(t.category||'Ohne Kategorie')+'</small></span><span class="num">'+eur(-t.amount)+'</span></div>').join('')+'</div>';
}
/* ---------- Immobilien ---------- */
function vImmo(){
  const v=ui.immo||'miete',head='<div class="h2row"><h2>Immobilien</h2></div>';
  if(v==='plan')return head+immoSeg()+vPlan();if(v==='ruecklage')return head+immoSeg()+vReserve();if(v==='infos')return head+immoSeg()+vInfos();if(v==='zaehler')return head+immoSeg()+vZaehler();
  const today=todayISO();
  const rows=S.units.map(u=>({u,s:rentStatus(u,ui.month,S.txs,today)})).filter(r=>r.s&&r.s.st!=='none');
  const exp=rows.reduce((a,r)=>a+r.s.exp,0),got=rows.reduce((a,r)=>a+r.s.got,0),miss=rows.reduce((a,r)=>a+r.s.missing,0),pct=exp?Math.min(100,Math.round(got/exp*100)):0;
  const order={late:0,partial:1,pending:2,over:3,paid:4};rows.sort((a,b)=>order[a.s.st]-order[b.s.st]);
  const others=S.units.filter(u=>!rows.some(r=>r.u.id===u.id));
  const y=String(ui.year),ex=S.txs.filter(t=>t.type==='expense'&&t.date.startsWith(y));
  const objs=S.props.map(p=>{const inc=S.txs.filter(t=>t.type==='rent'&&(t.forMonth||t.date).startsWith(y)&&(unitOf(t.unitId)||{}).propertyId===p.id).reduce((a,t)=>a+t.amount,0);const out=-ex.filter(t=>t.propertyId===p.id).reduce((a,t)=>a+t.amount,0);return {p,inc,out}});
  return '<div class="h2row"><h2>Immobilien</h2><button class="primary" data-act="addUnit">+ Einheit</button></div>'+immoSeg()+monthBar()
  +'<section class="hero"><div class="hl">Miete eingegangen</div><div class="hv num">'+eur(got)+' <span>von '+eur(exp)+'</span></div><div class="meter"><i style="width:'+pct+'%"></i></div><div class="hsub">'+(miss>0.005?'<span class="neg">Noch offen: '+eur(miss)+'</span>':(exp?'<span class="pos">Alle Mieten sind da</span>':'Keine Miete fällig'))+'</div></section>'
  +'<div class="list" data-sort="units">'+rows.map(r=>'<button class="item" data-act="unit" data-id="'+r.u.id+'"><span class="it"><strong>'+esc(unitLabel(r.u))+'</strong><small>'+esc(r.u.tenant||'–')+'</small></span><span class="ir"><span class="num">'+eur(r.s.got)+' / '+eur(r.s.exp)+'</span>'+pill(r.s.st)+'</span></button>').join('')
  +others.map(u=>'<button class="item dim" data-act="unit" data-id="'+u.id+'"><span class="it"><strong>'+esc(unitLabel(u))+'</strong><small>'+esc(u.tenant||'Leer')+'</small></span><span class="ir">'+pill('none')+'</span></button>').join('')+'</div>'
  +'<div class="h2row" style="margin-top:8px"><h3>Ergebnis '+y+'</h3><div class="mbar sm"><button class="ic" data-act="yearPrev" aria-label="Vorjahr">‹</button><button class="ic" data-act="yearNext" aria-label="Nächstes Jahr">›</button></div></div>'
  +objs.map(o=>'<details class="obj"><summary><span class="it"><strong>'+esc(o.p.name)+'</strong><small>Miete '+eur(o.inc)+' · Ausgaben '+eur(o.out)+'</small></span><span class="num big '+(o.inc-o.out<0?'neg':'pos')+'">'+eur(o.inc-o.out)+'</span></summary>'+expDetail(ex.filter(t=>t.propertyId===o.p.id))+'</details>').join('')
  +'<div class="h2row" style="margin-top:8px"><h3>Objekte</h3><button data-act="addProp">+ Objekt</button></div><div class="list">'+S.props.map(p=>'<button class="item" data-act="editProp" data-id="'+p.id+'"><span class="it"><strong>'+esc(p.name)+'</strong><small>'+esc([p.address,p.country].filter(Boolean).join(' · '))+'</small></span><span class="chev">›</span></button>').join('')+'</div>';
}
/* ---------- Verträge & Dokumente: Ende-zu-Ende verschlüsselt, getrennt vom Datenstand ---------- */
function docSection(u){const L=(S.docs||[]).filter(d=>d.unitId===u.id).sort((x,y)=>(y.date||'').localeCompare(x.date||''));
  return '<div class="h2row" style="margin-top:10px"><h3>Verträge & Dokumente</h3><button class="small" data-act="docAdd" data-id="'+u.id+'">+ Vertrag</button></div>'
    +(L.length?'<div class="elist kvs">'+L.map(d=>'<div class="erow"><span><button class="lnk" data-act="docOpen" data-id="'+d.id+'">'+esc(d.title||d.name)+'</button><small>'+dfmt(d.date)+' · '+(d.size>1048576?(d.size/1048576).toFixed(1).replace('.',',')+' MB':Math.max(1,Math.round(d.size/1024))+' KB')+(d.rpo==='open'?' · <span class="neg">noch bei Porezna melden</span>':'')+'</small></span><button class="ic" data-act="docDel" data-id="'+d.id+'" aria-label="Dokument löschen">×</button></div>').join('')+'</div>'
    :'<p class="hint">Lade den Mietvertrag als PDF oder Foto hoch. Er wird verschlüsselt gespeichert, nur du kannst ihn öffnen.</p>')}
function docPick(unitId){const inp=document.createElement('input');inp.type='file';inp.accept='application/pdf,image/*';inp.multiple=true;
  inp.onchange=async()=>{const F=[...inp.files];if(!F.length)return;
    modal('<h3>Dokument speichern</h3><label>Bezeichnung<input id="f-dt" value="'+esc(F.length===1?F[0].name.replace(/\.[a-z0-9]+$/i,''):'Mietvertrag')+'"></label><label>Datum<input id="f-dd" type="date" value="'+todayISO()+'"></label><label>Bei der Porezna gemeldet?<select id="f-drpo"><option value="ok">Ja, erledigt oder vom Notar</option><option value="open">Nein, muss ich noch einreichen</option><option value="na">Betrifft nicht (kein Mietvertrag)</option></select></label><p class="hint">'+F.length+(F.length===1?' Datei':' Dateien')+'. Fotos werden verkleinert, PDFs bis 5 MB.</p><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="docSave">Speichern</button></div>');
    docPick.pending={unitId,files:F}};
  inp.click()}
async function docShrink(f){if(!/^image\//.test(f.type))return {buf:new Uint8Array(await f.arrayBuffer()),type:f.type||'application/pdf'};
  const img=await createImageBitmap(f);const m=Math.min(1,2000/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*m);c.height=Math.round(img.height*m);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  const bl=await new Promise(r=>c.toBlob(r,'image/jpeg',.82));return {buf:new Uint8Array(await bl.arrayBuffer()),type:'image/jpeg'}}
async function docSave(){const p=docPick.pending;if(!p)return;const title=$('#f-dt').value.trim()||'Dokument',date=$('#f-dd').value||todayISO(),rpo=$('#f-drpo').value;closeModal();
  let n=0;for(const f of p.files){try{const {buf,type}=await docShrink(f);if(buf.length>5*1048576){toast(f.name+' ist größer als 5 MB.');continue}
    const id=uid();toast('Wird verschlüsselt gespeichert …');await docPut(id,buf);S.docs=S.docs||[];S.docs.push({id,unitId:p.unitId,title:p.files.length>1?title+' ('+(n+1)+')':title,name:f.name,type,size:buf.length,date,rpo});n++}
    catch(e){toast('Speichern fehlgeschlagen: '+(e.code==='QUOTA'?'Speicher voll.':e.code==='NETWORK'?'keine Verbindung.':'bitte erneut versuchen.'))}}
  if(n){if(rpo==='open'){const u=unitOf(p.unitId);if(u)u.rpo='open'}save();toast(n===1?'Dokument gespeichert.':n+' Dokumente gespeichert.');unitDetail(p.unitId)}docPick.pending=null}
async function docKey(){if(loggedIn())return await getMK();let k=await idbGet(KV,'doc-key');if(!k){k=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await idbSet(KV,'doc-key',k)}return k}
async function docPut(id,buf){const ct=await gcmEnc(await docKey(),buf);
  if(!loggedIn()){await idbSet(KV,'doc:'+id,ct);return}
  let r;try{r=await fetch(SRV+'/file/'+id,{method:'PUT',headers:{'Content-Type':'application/octet-stream',Authorization:'Bearer '+acct.token},body:ct})}catch(e){throw {code:'NETWORK'}}
  if(!r.ok){let j={};try{j=await r.json()}catch(e){}throw {code:j.error||'HTTP'}}}
async function docGet(id){let ct;if(!loggedIn())ct=await idbGet(KV,'doc:'+id);
  else{const r=await fetch(SRV+'/file/'+id,{headers:{Authorization:'Bearer '+acct.token}});if(!r.ok)throw {code:r.status===404?'NOT_FOUND':'HTTP'};ct=new Uint8Array(await r.arrayBuffer())}
  if(!ct)throw {code:'NOT_FOUND'};return await gcmDec(await docKey(),new Uint8Array(ct))}
async function docOpen(id){const d=(S.docs||[]).find(x=>x.id===id);if(!d)return;const w=window.open('','_blank');toast('Wird geladen …');
  try{const bl=new Blob([await docGet(id)],{type:d.type||'application/pdf'}),url=URL.createObjectURL(bl);
    if(w){w.location.href=url}else{const a=document.createElement('a');a.href=url;a.download=(d.title||'Dokument')+(d.type==='image/jpeg'?'.jpg':'.pdf');document.body.appendChild(a);a.click();a.remove()}setTimeout(()=>URL.revokeObjectURL(url),120000)}
  catch(e){if(w)w.close();toast(e.code==='NOT_FOUND'?'Datei nicht gefunden. Sie liegt evtl. nur auf einem anderen Gerät.':'Öffnen fehlgeschlagen.')}}
async function docDel(id){const d=(S.docs||[]).find(x=>x.id===id);if(!d||!confirm('„'+(d.title||d.name)+'“ löschen?'))return;
  try{if(loggedIn())await fetch(SRV+'/file/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+acct.token}});else{const db=await idb();await new Promise(r=>{const t=db.transaction(KV,'readwrite');t.objectStore(KV).delete('doc:'+id);t.oncomplete=r;t.onerror=r})}}catch(e){}
  S.docs=S.docs.filter(x=>x.id!==id);save();unitDetail(d.unitId)}
function unitDetail(id){
  const u=unitOf(id);if(!u)return;const today=todayISO();
  const months=[];for(let i=-11;i<=0;i++)months.push(addMonth(monthOf(today),i));
  const strip=u.rent>0?'<div class="strip">'+months.map(m=>{const s=rentStatus(u,m,S.txs,today);return '<span class="dot '+(s?s.st:'out')+'" title="'+esc(monthLabel(m)+': '+(s?LBL[s.st]:'nicht vermietet'))+'">'+MONTHS[+m.slice(5)-1].slice(0,1)+'</span>'}).join('')+'</div><p class="legend"><span class="dot paid"></span>bezahlt <span class="dot partial"></span>teilweise <span class="dot late"></span>überfällig</p>':'';
  let warn='';if(u.contractEnd&&u.noticeMonths){const ym=addMonth(u.contractEnd.slice(0,7),-u.noticeMonths);const k=ym+'-'+pad(new Date(+ym.slice(0,4),+ym.slice(5,7),0).getDate());if(k>=today)warn='<div class="kv"><span>Kündigung spätestens</span><b>'+dfmt(k)+'</b></div>'}
  const kv=(l,v)=>v?'<div class="kv"><span>'+l+'</span><b>'+v+'</b></div>':'';
  modal('<div class="mhead"><div><h3>'+esc(unitLabel(u))+'</h3><small>'+esc(u.tenant||'Kein Mieter')+'</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'+strip+'<div class="kvs">'+kv('Miete / Monat',u.rent?eur(u.rent):'')+kv('Fällig am',u.rent?u.dueDay+'. des Monats':'')+kv('Kaution',u.deposit?eur(u.deposit):'')+kv('Vertrag bis',dfmt(u.contractEnd))+warn+kv('IBAN',esc(u.iban))+'</div>'+(u.note?'<p class="note">'+esc(u.note)+'</p>':'')+docSection(u)+'<button class="wide" data-act="checklist" data-id="'+u.id+'">Mieterwechsel-Checkliste ›</button><div class="mact"><button class="danger" data-act="delUnit" data-id="'+u.id+'">Löschen</button><button class="primary" data-act="editUnit" data-id="'+u.id+'">Bearbeiten</button></div>');
}
/* ---------- Immobilien: Unterbereiche ---------- */
const IMMO_SEG=[['miete','Miete','g','<path d="M3 7h18v10H3zM7 12h.01M17 12h.01"/><circle cx="12" cy="12" r="2.2"/>'],['zaehler','Zähler','b','<path d="M4 16a8 8 0 1 1 16 0M12 16l4-5M3 20h18"/>'],['plan','Modernisierungsplan','o','<path d="M14 6l4 4-9 9H5v-4zM13 7l4 4M4 4l4 4M4 8l4-4"/>'],['ruecklage','Rücklagen','y','<path d="M4 12a7 5.5 0 0 1 14-1.5l2 .5v3l-2 .8a7 5.5 0 0 1-2 2.2V19h-3v-1.5h-2V19H8v-2a6 5 0 0 1-4-5zM9 8.5h3"/>'],['infos','Infos','v','<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>']];
const MICON={Wasser:'<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',Strom:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',Gas:'<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-6 1 2 2 3 3 3 0-3-1-5 0-8z"/>',Heizung:'<path d="M5 20V8M9 20V8M13 20V8M17 20V8M3 20h18M3 8h18"/>'};
function vZaehler(){const L=S.meterDevs||[];
  return '<div class="h2row"><h3>Zähler für Wasser, Strom und Gas</h3><button class="primary" data-act="addMeterDev">+ Zähler</button></div><p class="hint">Tippe auf einen Zähler, um einen neuen Stand einzutragen.</p>'
  +(L.length?S.props.map(p=>{const all=L.filter(m=>m.propertyId===p.id);if(!all.length)return '';
    return Object.keys(MKIND).map(kind=>{const l=all.filter(m=>m.kind===kind).sort((a,b)=>(a.place||'').localeCompare(b.place||'','de',{numeric:true}));if(!l.length)return '';
    return '<section class="group"><h3 class="gt">'+esc(p.name)+' · '+kind+'</h3><div class="list">'+l.map(m=>{const r=(m.readings||[]).slice().sort((a,b)=>b.date.localeCompare(a.date))[0];
      return '<button class="item plan" data-act="meter" data-id="'+m.id+'"><span class="picon mk-'+(MKIND[m.kind]||'')+'" aria-hidden="true"><svg viewBox="0 0 24 24">'+(MICON[m.kind]||MICON.Wasser)+'</svg></span><span class="it"><strong>'+esc(m.kind)+' · '+esc(m.place||'')+'</strong><small>'+(m.number?'Nr. '+esc(m.number):m.omm?'OMM '+esc(m.omm):m.note?esc(m.note):'Zählernummer fehlt')+(r?' · abgelesen '+dfmt(r.date):' · noch kein Stand')+'</small></span><span class="ir"><span class="num big">'+(r?esc(r.value):'–')+'</span><small class="lnk">Stand eintragen ›</small></span></button>'}).join('')+'</div></section>'}).join('')}).join(''):'<div class="empty">Noch keine Zähler. Lege mit „+ Zähler“ deinen ersten Wasser- oder Stromzähler an.</div>');
}
const immoSeg=()=>'<div class="itabs" role="tablist">'+IMMO_SEG.map(x=>'<button role="tab" data-act="immo" data-v="'+x[0]+'"'+((ui.immo||'miete')===x[0]?' class="on" aria-selected="true"':'')+'><span class="tic t'+x[2]+'"><svg viewBox="0 0 24 24" aria-hidden="true">'+x[3]+'</svg></span><span>'+x[1]+'</span></button>').join('')+'</div>';
const propExp=(pid,y)=>-S.txs.filter(t=>t.type==='expense'&&t.propertyId===pid&&t.date.startsWith(String(y))).reduce((s,t)=>s+t.amount,0);
const allImmoExp=y=>-S.txs.filter(t=>t.type==='expense'&&propOf(t.propertyId)&&t.date.startsWith(String(y))).reduce((s,t)=>s+t.amount,0);
const PRIO={Hoch:'late',Mittel:'partial',Niedrig:'pending'};
function vPlan(){
  const cur=+todayISO().slice(0,4);
  return '<div class="h2row"><h3>Modernisierungsplan</h3><button class="primary" data-act="addPlan">+ Maßnahme</button></div>'+S.props.map(p=>{
    const l=(S.plans||[]).filter(x=>x.propertyId===p.id).sort((a,b)=>(a.status==='Erledigt')-(b.status==='Erledigt')||(a.year||9999)-(b.year||9999));
    const sum=l.filter(x=>x.status!=='Erledigt').reduce((s,x)=>s+(+x.est||0),0);
    return '<section class="group"><div class="gh"><h3 class="gt">'+esc(p.name)+'</h3><small>offen geschätzt '+eur(sum)+'</small></div><div class="list">'+(l.length?l.map(x=>{const late=x.status!=='Erledigt'&&x.year&&x.year<cur;
      return '<button class="item plan'+(x.status==='Erledigt'?' dim':'')+'" data-act="plan" data-id="'+x.id+'">'+planIcon(x.title)+'<span class="it"><strong>'+esc(x.title)+'</strong><small>'+(x.status==='Erledigt'?'Erledigt':(x.year?(late?'Überfällig, geplant ':'Geplant für ')+x.year:'Ohne Termin'))+(x.est?' · ca. '+eur(+x.est):'')+(x.act?' · bezahlt '+eur(+x.act):'')+'</small></span><span class="ir">'+(x.status==='Erledigt'?'<span class="pill paid">Erledigt</span>':'<span class="pill '+(PRIO[x.prio]||'pending')+'">'+esc(x.prio||'–')+'</span>')+'</span></button>'}).join(''):'<div class="empty sm">Keine Maßnahmen geplant.</div>')+'</div></section>'}).join('');
}
function planDlg(id){const x=id?(S.plans||[]).find(p=>p.id===id):{propertyId:S.props[0]&&S.props[0].id,title:'',prio:'Mittel',year:+todayISO().slice(0,4)+1,est:'',act:'',status:'Geplant',note:''};
  const n=v=>v==null||v===''?'':String(v).replace('.',',');
  modal('<h3>'+(id?'Maßnahme bearbeiten':'Neue Maßnahme')+'</h3><label>Maßnahme<input id="f-ptitle" value="'+esc(x.title)+'"></label><div class="grid2"><label>Objekt<select id="f-pprop">'+S.props.map(p=>'<option value="'+p.id+'"'+sel(p.id===x.propertyId)+'>'+esc(p.name)+'</option>').join('')+'</select></label><label>Geplant für (Jahr)<input id="f-pyear" type="number" min="2000" max="2100" value="'+esc(x.year||'')+'"></label><label>Priorität<select id="f-pprio">'+['Hoch','Mittel','Niedrig'].map(v=>'<option'+sel(v===x.prio)+'>'+v+'</option>').join('')+'</select></label><label>Status<select id="f-pstat">'+['Geplant','In Arbeit','Erledigt'].map(v=>'<option'+sel(v===x.status)+'>'+v+'</option>').join('')+'</select></label><label>Kosten geschätzt (€)<input id="f-pest" inputmode="decimal" value="'+n(x.est)+'"></label><label>Kosten tatsächlich (€)<input id="f-pact" inputmode="decimal" value="'+n(x.act)+'"></label></div><label>Notiz<textarea id="f-pnote2" rows="2">'+esc(x.note)+'</textarea></label><div class="mact">'+(id?'<button class="danger" data-act="delPlan" data-id="'+id+'">Löschen</button>':'')+'<button data-act="close">Abbrechen</button><button class="primary" data-act="savePlan" data-id="'+(id||'')+'">Speichern</button></div>')}
function vReserve(){
  const r=S.reserve||{startYear:+todayISO().slice(0,4),yearly:0,target:0,special:{}};const yrs=[];let bal=0;
  for(let i=0;i<4;i++){const y=r.startYear+i,sp=+(r.special||{})[y]||0,cost=allImmoExp(y);const a=bal;bal=a+(+r.yearly||0)+sp-cost;yrs.push({y,a,sp,cost,e:bal})}
  const cy=+todayISO().slice(0,4),now=yrs.find(x=>x.y===cy)||yrs[0],pct=r.target?Math.max(0,Math.min(100,now.e/r.target*100)):0;
  return '<div class="h2row"><h3>Rücklagen</h3><button data-act="editReserve">Bearbeiten</button></div>'
  +'<section class="hero"><div class="hl">Rücklage Ende '+now.y+'</div><div class="hv num">'+eur(Math.round(now.e))+' <span>von '+eur(Math.round(r.target||0))+'</span></div><div class="meter"><i style="width:'+pct+'%"></i></div><div class="hsub">'+(now.e>=r.target?'<span class="pos">Ziel erreicht</span>':'<span class="muted">Noch '+eur(Math.round((r.target||0)-now.e))+' bis zum 10-Jahres-Puffer</span>')+'</div></section>'
  +'<section class="tiles3 two"><div><span>Einzahlung / Jahr</span><b class="num">'+eur(+r.yearly||0)+'</b></div><div><span>pro Monat</span><b class="num">'+eur(Math.round((+r.yearly||0)/12))+'</b></div></section>'
  +'<section class="card"><h3>Verlauf</h3><div class="elist">'+yrs.map(x=>'<div class="erow"><span><b>'+x.y+'</b><small>Start '+eur(Math.round(x.a))+' · + '+eur(+r.yearly||0)+(x.sp?' · Sonderzahlung '+eur(x.sp):'')+' · − Reparaturen '+eur(Math.round(x.cost))+'</small></span><span class="num '+(x.e<0?'neg':'')+'">'+eur(Math.round(x.e))+'</span></div>').join('')+'</div><p class="hint">Reparaturen werden automatisch aus den Ausgaben für die Immobilien abgezogen.</p></section>'
  +(r.note?'<p class="note">'+esc(r.note)+'</p>':'');
}
function reserveDlg(){const r=S.reserve||{startYear:+todayISO().slice(0,4),yearly:0,target:0,special:{}};
  modal('<h3>Rücklagen</h3><div class="grid2"><label>Start (Jahr)<input id="f-rstart" type="number" value="'+esc(r.startYear)+'"></label><label>Einzahlung pro Jahr (€)<input id="f-ryear" inputmode="decimal" value="'+esc(String(r.yearly||'').replace('.',','))+'"></label><label>Ziel (€)<input id="f-rtarget" inputmode="decimal" value="'+esc(String(Math.round(r.target||0)))+'"></label><label>Sonderzahlung im Jahr<input id="f-rspy" type="number" placeholder="z. B. 2027"></label><label>Sonderzahlung (€)<input id="f-rspv" inputmode="decimal"></label></div><label>Notiz<textarea id="f-rnote" rows="3">'+esc(r.note)+'</textarea></label><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveReserve">Speichern</button></div>')}
function vInfos(){
  const today=todayISO();
  const fix=S.props.map(p=>{const l=(S.fixcosts||[]).filter(f=>f.propertyId===p.id);const y=l.reduce((s,f)=>s+f.amount*f.perYear,0);
    return '<details class="obj"><summary><span class="it"><strong>Fixkosten '+esc(p.name)+'</strong><small>'+eur(Math.round(y))+' im Jahr</small></span><span class="num big">'+eur(Math.round(y/12))+'<small> /Mt.</small></span></summary><div class="elist">'+l.map(f=>'<div class="erow"><span><b>'+esc(f.title)+'</b><small>'+eur(f.amount)+' '+(f.perYear===12?'monatlich':f.perYear===1?'jährlich':f.perYear+'× im Jahr')+'</small></span><span class="num">'+eur(Math.round(f.amount*f.perYear))+' <button class="small link" data-act="delFix" data-id="'+f.id+'" aria-label="Löschen">×</button></span></div>').join('')+'</div><div class="form pad"><button data-act="addFix" data-id="'+p.id+'">+ Fixkosten</button></div></details>'}).join('');
  const dev=S.units.map(u=>{const L=(S.devices||[]).filter(d=>d.unitId===u.id);return '<details class="obj"><summary><span class="it"><strong>Geräte '+esc(unitLabel(u))+'</strong><small>'+(L.length?L.length+(L.length===1?' Eintrag':' Einträge'):'Noch keine – z. B. Herd, Boiler, Klimaanlage')+'</small></span><span class="chev">›</span></summary><div class="elist">'+L.map(d=>'<div class="erow"><span><b>'+esc(d.name)+'</b></span><span class="num">'+esc(d.year)+' <button class="small link" data-act="delDev" data-id="'+d.id+'" aria-label="Löschen">×</button></span></div>').join('')+'</div><div class="form pad"><button data-act="addDev" data-id="'+u.id+'">+ Gerät</button></div></details>'}).join('');
  const met='';
  const tr=S.taxRate||{base:.7,rate:.12};
  const ren=S.props.map(p=>rendCard(p,tr,today)).join('');
  (S.notes||[]).forEach(n=>{if(!n.id)n.id=uid()});const notes=(S.notes||[]).map(n=>'<details class="obj"><summary><span class="it"><strong>'+esc(n.title)+'</strong></span><span class="chev">›</span></summary><p class="ntext">'+esc(n.text).replace(/\n/g,'<br>')+'</p><div class="form pad"><button class="small" data-act="editNote" data-id="'+n.id+'">Bearbeiten</button></div></details>').join('');
  return '<h3>Rendite</h3>'+(S.props.length?ren+'<p class="hint">Steuer gerechnet mit '+Math.round(tr.base*100)+' % der Miete × '+String(Math.round(tr.rate*1000)/10).replace('.',',')+' % · <button class="lnk" data-act="taxDlg">ändern</button>. Eine Schätzung, keine Steuerberatung.</p>':'<p class="hint">Lege zuerst ein Objekt an.</p>')
    +'<h3 style="margin-top:6px">Kosten & Ausstattung</h3>'+(fix||'')+dev+met
    +'<div class="h2row" style="margin-top:6px"><h3>Notizen & Unterlagen</h3><button class="small" data-act="editNote">+ Notiz</button></div>'+(notes||'<p class="hint">Hier notierst du z. B. Steuernummern, Ansprechpartner bei Behörden oder wo Unterlagen liegen.</p>');
}
function rendCard(p,tr,today){const price=(p.buy||[]).reduce((s,b)=>s+(+b.price||0),0);const rentM=S.units.filter(u=>u.propertyId===p.id&&(!u.end||u.end>=monthOf(today))).reduce((s,u)=>s+(+u.rent||0),0);
  const fixM=(S.fixcosts||[]).filter(f=>f.propertyId===p.id).reduce((s,f)=>s+f.amount*f.perYear,0)/12,taxM=rentM*tr.base*tr.rate,net=rentM-fixM-taxM;
  if(!price)return '<div class="rend"><div class="h2row"><b>'+esc(p.name)+'</b><button class="small" data-act="editProp" data-id="'+p.id+'">Kaufpreis eintragen</button></div><small class="hint">Ohne Kaufpreis kann die App keine Rendite rechnen.</small></div>';
  const br=rentM*12/price*100,nr=net*12/price*100,lv=nr<3?['neg','schwach','Unter 3 % netto: Das Geld wäre anderswo oft ähnlich gut angelegt. Prüfe Miete und Fixkosten.']:nr<5?['warn','solide','3–5 % netto: ein ordentlicher Wert für vermietete Wohnungen.']:['pos','gut','Über 5 % netto: ein guter Wert.'];
  const pct=v=>v.toFixed(1).replace('.',',')+' %';
  return '<div class="rend"><div class="h2row"><b>'+esc(p.name)+'</b><span class="pill '+lv[0]+'">'+lv[1]+'</span></div>'
    +'<div class="rgrid"><div><span>Brutto</span><b>'+pct(br)+'</b></div><div><span>Netto</span><b class="'+lv[0]+'">'+pct(nr)+'</b></div><div><span>Überschuss</span><b>'+eur(Math.round(net))+'<small>/Mt.</small></b></div><div><span>Amortisiert</span><b>'+(net>0?'ca. '+Math.round(price/(net*12))+' J.':'–')+'</b></div></div>'
    +'<small class="hint">Kaufpreis '+eur(price)+' · Miete '+eur(rentM)+' · Fixkosten '+eur(Math.round(fixM))+' · Steuer ca. '+eur(Math.round(taxM))+' im Monat. '+lv[2]+'</small>'
    +(+p.value?(()=>{const g=+p.value-price,gp=g/price*100,cr=net*12/(+p.value)*100;return '<div class="kvs"><div class="kv"><span>Heutiger Wert'+(p.valueDate?' ('+monthLabel(p.valueDate)+')':'')+'</span><b>'+eur(+p.value)+'</b></div><div class="kv"><span>Wertzuwachs seit Kauf</span><b class="'+(g>=0?'pos':'neg')+'">'+(g>=0?'+':'')+eur(Math.round(g))+' ('+(g>=0?'+':'')+gp.toFixed(0)+' %)</b></div><div class="kv"><span>Netto-Rendite auf heutigen Wert</span><b>'+cr.toFixed(1).replace('.',',')+' %</b></div></div><small class="hint">Die Rendite auf den heutigen Wert zeigt, was dein Geld bringt, wenn du jetzt verkaufen könntest. Liegt sie deutlich unter der Kauf-Rendite, ist das Objekt vor allem im Wert gestiegen.</small>'})():'<small class="hint"><button class="lnk" data-act="editProp" data-id="'+p.id+'">Heutigen Wert eintragen</button> – dann siehst du Wertzuwachs und Rendite auf den aktuellen Wert.</small>')
    +creditRend(p,price,net)
    +rendUnits(p,price,fixM,tr,today)
    +'<details class="rhelp"><summary>Was bedeuten die Zahlen?</summary><p class="hint"><b>Brutto:</b> Jahresmiete geteilt durch Kaufpreis. <b>Netto:</b> nach Fixkosten und geschätzter Steuer. <b>Überschuss:</b> was im Monat übrig bleibt. <b>Amortisiert:</b> nach so vielen Jahren hat das Objekt den Kaufpreis wieder eingespielt. Kredite, Leerstand und Wertsteigerung sind nicht eingerechnet. Die Ampel-Grenzen (3 % und 5 %) sind übliche Faustregeln.</p></details></div>'}
function rendUnits(p,price,fixM,tr,today){const U=S.units.filter(u=>u.propertyId===p.id&&(!u.end||u.end>=monthOf(today)));if(U.length<2)return '';
  const byM=U.every(u=>+u.sqm>0),W=u=>byM?+u.sqm:(+u.rent||0),rentAll=U.reduce((s,u)=>s+W(u),0),own=U.reduce((s,u)=>s+(+u.buyShare||0),0),noOwn=U.filter(u=>!(+u.buyShare)),restRent=noOwn.reduce((s,u)=>s+W(u),0),rest=Math.max(0,price-own);
  const pct=v=>v.toFixed(1).replace('.',',')+' %';
  const rows=U.map(u=>{const r=+u.rent||0,share=rentAll?W(u)/rentAll:1/U.length,pr=+u.buyShare||(restRent?rest*W(u)/restRent:rest/Math.max(1,noOwn.length)),fx=fixM*share,tx=r*tr.base*tr.rate,net=r-fx-tx,nr=pr?net*12/pr*100:0,c=nr<3?'neg':nr<5?'warn':'pos';
    if(!r)return '<div class="erow"><span><b>'+esc(u.name||unitLabel(u))+'</b><small>Nicht vermietet oder selbst genutzt'+(+u.sqm?' · '+String(+u.sqm).replace('.',',')+' m²':'')+'<br>Anteil Kaufpreis '+eur(Math.round(pr))+(+p.value&&price?' · heutiger Wert anteilig '+eur(Math.round(pr/price*p.value)):'')+'<br>Fixkosten-Anteil '+eur(Math.round(fx))+'/Mt.</small></span><span class="num">–</span></div>';
    return '<div class="erow"><span><b>'+esc(u.name||unitLabel(u))+'</b><small>'+(u.tenant?esc(u.tenant)+' · ':'')+'Miete '+eur(r)+' · Anteil Kaufpreis '+eur(Math.round(pr))+(+u.buyShare?'':' (geschätzt)')+(+p.value&&price?'<br>Heutiger Wert anteilig '+eur(Math.round(pr/price*p.value))+' · Netto darauf '+pct(net*12/(pr/price*p.value)*100):'')+(+u.sqm?'<br>'+String(+u.sqm).replace('.',',')+' m²'+(r?' · Miete '+(r/u.sqm).toFixed(2).replace('.',',')+' €/m²':''):'')+'<br>Überschuss '+eur(Math.round(net))+'/Mt. · Brutto '+(pr?pct(r*12/pr*100):'–')+(net>0&&pr?' · amortisiert ca. '+Math.round(pr/(net*12))+' J.':'')+'</small></span><span class="num '+c+'">'+(pr?pct(nr):'–')+'</span></div>'}).join('');
  return '<details class="rhelp"><summary>Pro Wohnung ('+U.length+')</summary><div class="elist kvs">'+rows+'</div><p class="hint">Kaufpreis'+(+p.value?', heutiger Wert':'')+' und Fixkosten sind '+(byM?'nach Wohnfläche (m²)':'nach Miethöhe')+' auf die Wohnungen verteilt.'+(byM?'':' Trägst du bei allen Wohnungen die m² ein, verteilt die App nach Fläche.')+' Die Prozentzahl rechts bezieht sich auf den Kaufpreis. Kennst du den echten Anteil einer Wohnung, trag ihn unter Wohnung → Bearbeiten → „Anteil am Kaufpreis“ ein.</p></details>'}
function taxDlg(){const tr=S.taxRate||{base:.7,rate:.12};const f=v=>String(Math.round(v*1000)/10).replace('.',',');
  modal('<h3>Steuer auf Mieteinnahmen</h3><p class="hint">Die App rechnet: Miete × versteuerter Anteil × Steuersatz. Nur eine Schätzung für die Rendite.</p><div class="form"><button class="small" data-act="taxPreset" data-v="hr">Kroatien (70 % × 12 %)</button><button class="small" data-act="taxPreset" data-v="de">Deutschland (100 % × 30 %)</button></div>'
    +'<div class="grid2"><label>Versteuerter Anteil (%)<input id="f-tb" inputmode="decimal" value="'+f(tr.base)+'"></label><label>Steuersatz (%)<input id="f-tr" inputmode="decimal" value="'+f(tr.rate)+'"></label></div>'
    +'<p class="hint">Kroatien: 30 % der Miete gelten pauschal als Kosten; der Satz hängt von deiner Gemeinde ab. Deutschland: Trage deinen persönlichen Grenzsteuersatz ein; der Anteil sinkt, wenn du Abschreibung und Werbungskosten berücksichtigst.</p>'
    +'<div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="taxSave">Speichern</button></div>')}
function noteDlg(id){const n=id?(S.notes||[]).find(x=>x.id===id):{title:'',text:''};
  modal('<h3>'+(id?'Notiz bearbeiten':'Neue Notiz')+'</h3><label>Titel<input id="f-nt" value="'+esc(n.title)+'" placeholder="z. B. Porezna uprava Pula"></label><label>Text<textarea id="f-nx" rows="6">'+esc(n.text)+'</textarea></label><div class="mact">'+(id?'<button class="danger" data-act="delNote" data-id="'+id+'">Löschen</button>':'')+'<button data-act="close">Abbrechen</button><button class="primary" data-act="saveNote" data-id="'+(id||'')+'">Speichern</button></div>')}
/* ---------- Konten ---------- */
function vKonten(){
  const groups=Object.keys(ACC_TYPES).map(k=>[k,S.accounts.filter(a=>(a.type||'sonst')===k)]).filter(g=>g[1].length);
  return '<div class="h2row"><h2>Konten</h2><button class="primary" data-act="addAcc">+ Konto</button></div>'
  +'<div class="kline"><span>Guthaben gesamt</span><b class="num">'+eur(Math.round(accTotal()))+'</b></div>'+(creditTotal()>0?'<div class="kline"><span>Kredite</span><b class="num neg">−'+eur(Math.round(creditTotal()))+'</b></div><div class="kline"><span>Netto</span><b class="num">'+eur(Math.round(accTotal()-creditTotal()))+'</b></div>':'')
  +(groups.length?groups.map(([k,l])=>'<section class="group"><h3 class="gt">'+ACC_TYPES[k]+'</h3><div class="list" data-sort="accounts">'+l.map(a=>{const v=accValue(a);return '<button class="item bk" style="'+bankStyle(a)[1]+'" data-act="acc" data-id="'+a.id+'"><span class="blg" style="'+bankStyle(a)[2]+'">'+bankStyle(a)[0]+'</span><span class="it"><strong>'+esc(a.name)+'</strong><small>'+(v?'Stand '+dfmt(v.date):'Noch kein Stand')+'</small></span><span class="ir"><span class="num big">'+eur(v?v.value:0)+'</span></span></button>'}).join('')+'</div></section>').join(''):'<div class="empty">Noch kein Konto angelegt.</div>')
  +creditSection()+loanSection()
  +'<p class="hint">'+(S.bank&&S.bank.conns&&S.bank.conns.length?'Kontostände verbundener Banken kommen automatisch. Andere Konten antippen und den Stand eintragen.':'Tippe auf ein Konto, um den aktuellen Stand einzutragen.')+'<br><span>'+(S.accounts.length>1?'Zum Sortieren lange gedrückt halten und ziehen.':'')+'</span></p>';
}
const BANKS=[[/raiffeisen|\brba\b/i,'RBA','255,230,0','#ffe600','#1a1a1a'],[/\bdkb\b|kreditbank/i,'DKB','27,143,224','#1b8fe0','#fff'],[/santander/i,'S','236,0,0','#ec0000','#fff'],[/sparkasse/i,'S','255,0,0','#ff1a1a','#fff'],[/erste/i,'E','42,100,200','#2a64c8','#fff'],[/\bpbz\b|privredna/i,'PBZ','0,150,90','#00965a','#fff'],[/zaba|zagrebačka|zagrebacka/i,'Z','226,0,26','#e2001a','#fff'],[/paypal/i,'P','0,48,135','#003087','#fff'],[/otp/i,'OTP','82,174,50','#52ae32','#fff'],[/addiko/i,'A','0,160,175','#00a0af','#fff'],[/commerz/i,'C','255,204,0','#ffcc00','#1a1a1a'],[/deutsche bank/i,'DB','0,24,168','#0018a8','#fff'],[/\bing\b/i,'ING','255,98,0','#ff6200','#fff'],[/n26/i,'N26','54,161,139','#36a18b','#fff'],[/revolut/i,'R','90,100,255','#5a64ff','#fff']];
function bankStyle(a){const conn=(bk().conns||[]).find(c=>c.accounts.some(x=>x.accId===a.id));const txt=[a.name,a.bank,conn&&conn.aspsp&&conn.aspsp.name].filter(Boolean).join(' ');
  let m=BANKS.find(b=>b[0].test(txt));if(!m){if(a.type==='bar')m=[0,'€','61,220,151','#3ddc97','#0b2a1d'];else if(a.type==='depot')m=[0,'D','167,139,250','#a78bfa','#1a1033'];else m=[0,(a.name||'?').trim().slice(0,2).toUpperCase(),'144,153,173','#3a4252','#fff']}
  return [esc(m[1]),'border-color:rgba('+m[2]+',.45);background:linear-gradient(90deg,rgba('+m[2]+',.13),var(--surface) 70%)','background:'+m[3]+';color:'+m[4]]}
/* ---------- Kredite (Bankdarlehen) ---------- */
const creditOn=()=>{const v=S&&S.settings&&S.settings.credit;return v===true||(v==null&&(S.credits||[]).length>0)};
const creditOf=id=>(S.credits||[]).find(c=>c.id===id);
function creditProj(bal,r,pay){let m=0,ti=0;if(bal<=0.005)return {months:0,ti:0,never:false};while(bal>0.005&&m<720){const i=bal*r/12;if(pay<=i+0.005)return {months:null,ti:null,never:true};ti+=i;bal=bal+i-pay;m++}return {months:m,ti,never:m>=720&&bal>0.005}}
function creditCalc(c){const r=(+c.rate||0)/100,pay=+c.payment||0,d0=c.balanceDate||todayISO(),T=todayISO();let bal=+c.balance||0,mode='plan',n=0;
  const L=S.txs.filter(t=>t.creditId===c.id&&t.date>d0&&t.amount<0).sort((a,b)=>a.date.localeCompare(b.date));
  if(L.length){mode='tx';let last=d0;for(const t of L){const days=Math.max(0,(Date.parse(t.date)-Date.parse(last))/864e5);bal=bal+bal*r*days/365+t.amount;last=t.date;n++}}
  else{const [y0,m0,dd0]=d0.split('-').map(Number),[y1,m1,dd1]=T.split('-').map(Number);let k=(y1-y0)*12+(m1-m0)-(dd1<dd0?1:0);for(let i=0;i<k&&bal>0.005;i++){bal=bal+bal*r/12-pay;n++}}
  bal=Math.max(0,Math.round(bal*100)/100);const intM=bal*r/12,p=creditProj(bal,r,pay);
  return {bal,intM,tilM:Math.max(0,pay-intM),pay,r,mode,n,L,months:p.months,ti:p.ti,never:p.never,endYm:p.months!=null?addMonth(monthOf(T),p.months):''}}
const creditTotal=()=>creditOn()?(S.credits||[]).reduce((s,c)=>s+creditCalc(c).bal,0):0;
function creditHero(total){const d=creditTotal();return d>0?'<div class="hsub muted">Kredite −'+eur(Math.round(d))+' · Netto <b class="num">'+eur(Math.round(total-d))+'</b></div>':''}
function creditSection(){if(!creditOn())return '';const L=S.credits||[];
  return '<section class="group"><div class="h2row"><h3 class="gt">Kredite</h3><button class="small" data-act="creditAdd">+ Kredit</button></div>'
    +(L.length?'<div class="list">'+L.map(c=>{const x=creditCalc(c);return '<button class="item bk" style="border-color:rgba(255,107,107,.4);background:linear-gradient(90deg,rgba(255,107,107,.10),var(--surface) 70%)" data-act="credit" data-id="'+c.id+'"><span class="blg" style="background:#ff6b6b;color:#2a0a0a">%</span><span class="it"><strong>'+esc(c.name)+'</strong><small>Rate '+eur(x.pay)+' · '+(x.bal<=0?'abbezahlt':x.never?'Rate deckt die Zinsen nicht':'abbezahlt '+monthLabel(x.endYm))+'</small></span><span class="ir"><span class="num big neg">−'+eur(Math.round(x.bal))+'</span></span></button>'}).join('')+'</div>'
      :'<p class="hint">Trag deine Bankkredite ein, z. B. Immobilien- oder Autokredit. Die App rechnet Restschuld, Zins und Tilgung und zeigt dein Vermögen nach Abzug der Schulden.</p>')+'</section>'}
function creditDlg(id){const c=id?creditOf(id):{name:'',bank:'',principal:'',balance:'',balanceDate:todayISO(),rate:'',payment:'',fixedUntil:'',propertyId:'',keyword:''};const n=v=>v===''||v==null?'':String(v).replace('.',',');
  modal('<h3>'+(id?'Kredit bearbeiten':'Neuer Kredit')+'</h3><div class="grid2"><label>Bezeichnung<input id="f-cn" value="'+esc(c.name)+'" placeholder="z. B. Hauskredit"></label><label>Bank<input id="f-cb" value="'+esc(c.bank||'')+'"></label></div>'
    +'<div class="grid2"><label>Restschuld (€)<input id="f-cbal" inputmode="decimal" value="'+n(c.balance)+'"></label><label>Stand am<input id="f-cbd" type="date" value="'+esc(c.balanceDate||todayISO())+'"></label></div>'
    +'<div class="grid2"><label>Zinssatz (% im Jahr)<input id="f-cr" inputmode="decimal" value="'+n(c.rate)+'" placeholder="z. B. 3,5"></label><label>Rate im Monat (€)<input id="f-cp" inputmode="decimal" value="'+n(c.payment)+'"></label></div>'
    +'<div class="grid2"><label>Ursprüngliche Summe (€)<input id="f-cpr" inputmode="decimal" value="'+n(c.principal)+'" placeholder="optional"></label><label>Zinsbindung bis<input id="f-cfu" type="month" value="'+esc(c.fixedUntil||'')+'"></label></div>'
    +(immoOn()&&S.props.length?'<label>Gehört zu<select id="f-cprop"><option value="">Privat</option>'+S.props.map(p=>'<option value="'+p.id+'"'+sel(p.id===c.propertyId)+'>Immobilie: '+esc(p.name)+'</option>').join('')+'</select></label>':'')
    +'<label>Suchwort im Umsatz<input id="f-ckw" value="'+esc(c.keyword||'')+'" placeholder="optional, z. B. Darlehen 4711"></label><p class="hint">Restschuld und Stand findest du im Kontoauszug oder Jahresauszug der Bank. Mit dem Suchwort erkennt die App die Rate im Bankabruf und rechnet die Restschuld selbst weiter.</p>'
    +'<div class="mact">'+(id?'<button class="danger" data-act="creditDel" data-id="'+id+'">Löschen</button>':'')+'<button data-act="close">Abbrechen</button><button class="primary" data-act="creditSave" data-id="'+(id||'')+'">Speichern</button></div>')}
function creditDetail(id){const c=creditOf(id);if(!c)return;const x=creditCalc(c),p=propOf(c.propertyId);const kv=(l,v,cl)=>'<div class="kv"><span>'+l+'</span><b class="num '+(cl||'')+'">'+v+'</b></div>';
  modal('<div class="mhead"><div><h3>'+esc(c.name)+'</h3><small>'+esc([c.bank,p&&p.name].filter(Boolean).join(' · ')||'Kredit')+'</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'
    +'<div class="kvs">'+kv('Restschuld heute','−'+eur(x.bal),'neg')+kv('Rate im Monat',eur(x.pay))+kv('davon Zinsen',eur(Math.round(x.intM*100)/100))+kv('davon Tilgung',eur(Math.round(x.tilM*100)/100),'pos')
      +kv('Abbezahlt',x.bal<=0?'ja':x.never?'so nie':monthLabel(x.endYm)+' ('+(x.months>=24?Math.round(x.months/12)+' Jahre':x.months+' Monate')+')')+(x.ti!=null?kv('Zinsen bis dahin',eur(Math.round(x.ti))):'')+(c.fixedUntil?kv('Zinsbindung bis',monthLabel(c.fixedUntil)):'')+'</div>'
    +(x.never?'<p class="hint neg">Die Rate ist nicht höher als die Zinsen. So wird der Kredit nie kleiner. Prüfe Zinssatz und Rate.</p>':'')
    +'<p class="hint">'+(x.mode==='tx'?'Gerechnet aus '+x.n+(x.n===1?' erkannten Rate':' erkannten Raten')+' seit '+dfmt(c.balanceDate)+'.':'Gerechnet nach Plan seit '+dfmt(c.balanceDate)+' (eine Rate pro Monat). Ordnest du die Raten im Umsatz diesem Kredit zu, rechnet die App mit den echten Zahlungen.')+' Kleine Abweichungen zur Bank sind normal. Korrigiere die Restschuld einmal im Jahr über „Bearbeiten“.</p>'
    +(x.bal>0&&!x.never?'<h3 class="gt lh">Sondertilgung</h3><div class="form"><input id="f-cx" inputmode="decimal" placeholder="Betrag, z. B. 5000"><button data-act="creditExtra" data-id="'+c.id+'">Berechnen</button></div><div id="cxout"></div>':'')
    +'<div class="mact">'+(x.L.length?'<button data-act="creditTx" data-id="'+c.id+'">Raten ansehen</button>':'')+'<button class="primary" data-act="creditEdit" data-id="'+c.id+'">Bearbeiten</button></div>')}
function creditRend(p,price,net){if(!creditOn())return '';const C=(S.credits||[]).filter(c=>c.propertyId===p.id);if(!C.length)return '';const X=C.map(creditCalc);
  const pay=X.reduce((s,x)=>s+x.pay,0),intM=X.reduce((s,x)=>s+x.intM,0),bal=X.reduce((s,x)=>s+x.bal,0),pr=C.reduce((s,c)=>s+(+c.principal||0),0),eq=pr?price-pr:0,cf=net-pay;
  return '<div class="kvs"><div class="kv"><span>Kreditrate im Monat</span><b class="num">'+eur(Math.round(pay))+'</b></div><div class="kv"><span>Überschuss nach Rate</span><b class="num '+(cf<0?'neg':'pos')+'">'+eur(Math.round(cf))+'</b></div><div class="kv"><span>Restschuld</span><b class="num neg">−'+eur(Math.round(bal))+'</b></div>'
    +(eq>0?'<div class="kv"><span>Eigenkapital eingesetzt</span><b class="num">'+eur(Math.round(eq))+'</b></div><div class="kv"><span>Rendite auf Eigenkapital</span><b class="num">'+((net-intM)*12/eq*100).toFixed(1).replace('.',',')+' %</b></div>':'')+'</div>'
    +'<small class="hint">'+(eq>0?'Rendite auf Eigenkapital: Überschuss minus Kreditzinsen, geteilt durch dein eigenes Geld im Objekt. Die Tilgung zählt nicht als Kosten, weil sie deine Schulden senkt.':pr?'Der Kredit ist so hoch wie der Kaufpreis oder höher, deshalb gibt es keine Eigenkapital-Rendite.':'Trag beim Kredit die ursprüngliche Summe ein, dann rechnet die App die Rendite auf dein Eigenkapital.')+'</small>'}
function creditAsk(){if(!S||locked||authOpen)return;S.settings=S.settings||{};if(S.settings.credit!=null)return;if((S.credits||[]).length){S.settings.credit=true;return}
  if(!$('#modal')||!$('#modal').hidden||BK_CB)return;
  modal('<h3>Hast du Kredite bei einer Bank?</h3><p class="hint">Dann zeigt die App unter Konten deine Restschuld, Zins und Tilgung und dein Vermögen nach Abzug der Schulden. Du kannst das später unter Mehr → Konto, Sicherheit & Backup ändern.</p><div class="mact"><button data-act="creditAsk" data-v="0">Nein</button><button class="primary" data-act="creditAsk" data-v="1">Ja</button></div>')}
/* ---------- Verliehenes Geld: von Hand ---------- */
function loanSection(){const LA=loans(),LO=LA.filter(o=>Math.abs(o.open)>=0.01),LD=LA.filter(o=>Math.abs(o.open)<0.01),LS=ui.showRepaid?LA:LO;
  return '<section class="group"><div class="h2row"><h3 class="gt">Verliehenes Geld</h3><button class="small" data-act="lendAdd">+ Verliehen</button></div>'
    +(LS.length?'<div class="list">'+LS.map(o=>'<button class="item loan" data-act="loanList" data-k="'+esc(nrm(o.p))+'"><span class="it"><strong>'+esc(o.p)+'</strong><small>'+(Math.abs(o.open)<0.01?'Komplett zurückgezahlt':o.open>0?'Schuldet dir noch':'Du schuldest')+' · '+o.l.length+(o.l.length===1?' Buchung':' Buchungen')+'</small></span><span class="ir"><span class="num big '+(Math.abs(o.open)<0.01?'pos':'')+'">'+eur(Math.abs(Math.round(o.open*100)/100))+'</span></span></button>').join('')+'</div>'
      :'<p class="hint">'+(LD.length?'Alles zurückgezahlt.':'Hast du jemandem Geld geliehen? Trag es hier ein, auch Bargeld. Die App merkt sich, was noch offen ist.')+'</p>')
    +(LD.length?'<button class="small link" data-act="toggleRepaid">'+(ui.showRepaid?'Zurückgezahlte ausblenden':'Zurückgezahlte anzeigen ('+LD.length+')')+'</button>':'')+'</section>'}
function loanDlg(k){const o=loans().find(x=>nrm(x.p)===k);if(!o){closeModal();return}const open=Math.round(o.open*100)/100;const l=o.l.slice().sort((a,b)=>b.date.localeCompare(a.date));
  modal('<div class="mhead"><div><h3>'+esc(o.p)+'</h3><small>'+(Math.abs(open)<0.01?'Komplett zurückgezahlt':open>0?'Schuldet dir noch '+eur(open):'Du schuldest '+eur(-open))+'</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'
    +'<div class="form"><button class="primary" data-act="lendBack" data-k="'+esc(k)+'">Rückzahlung eintragen</button><button data-act="lendMore" data-k="'+esc(k)+'">Weiter verliehen</button></div>'
    +'<div class="elist kvs">'+l.map(t=>'<div class="erow"><span><b>'+(t.amount<0?'Verliehen':'Zurückbekommen')+'</b><small>'+dfmt(t.date)+(t.src==='manual'?' · von Hand':accOf(t.accountId)?' · '+esc(accOf(t.accountId).name):'')+(t.purpose?' · '+esc(t.purpose):'')+'</small></span><span class="num '+(t.amount<0?'neg':'pos')+'">'+eur(Math.abs(t.amount))+(t.src==='manual'?' <button class="small link" data-act="lendDel" data-id="'+t.id+'" data-k="'+esc(k)+'" aria-label="Eintrag löschen">×</button>':'')+'</span></div>').join('')+'</div>')}
function lendDlg(kind,k){const o=k?loans().find(x=>nrm(x.p)===k):null;
  modal('<h3>'+(kind==='back'?'Rückzahlung eintragen':'Geld verliehen')+'</h3><label>Person<input id="f-lp" value="'+esc(o?o.p:'')+'"'+(o?' readonly':'')+' placeholder="Name"></label><div class="grid2"><label>Betrag (€)<input id="f-la" inputmode="decimal" value="'+(kind==='back'&&o&&o.open>0?String(Math.round(o.open*100)/100).replace('.',','):'')+'"></label><label>Datum<input id="f-ld" type="date" value="'+todayISO()+'"></label></div><label>Notiz<input id="f-ln" placeholder="optional, z. B. bar"></label>'
    +'<div class="mact"><button data-act="'+(k?'loanList':'close')+'" data-k="'+esc(k||'')+'">Abbrechen</button><button class="primary" data-act="lendSave" data-v="'+kind+'">Speichern</button></div>')}
function accDetail(id){
  const a=accOf(id);if(!a)return;const h=(a.history||[]).slice().sort((x,y)=>y.date.localeCompare(x.date));
  modal('<div class="mhead"><div><h3>'+esc(a.name)+'</h3><small>'+esc(ACC_TYPES[a.type]||'')+'</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'
  +'<div class="grid2"><label>Neuer Stand (€)<input id="f-val" inputmode="decimal" placeholder="z. B. 14.250,00"></label><label>Datum<input id="f-vdate" type="date" value="'+todayISO()+'"></label></div><button class="primary" data-act="addVal" data-id="'+a.id+'">Stand speichern</button>'
  +(h.length?'<div class="kvs">'+h.map((x,i)=>'<div class="kv"><span>'+dfmt(x.date)+'</span><b class="num">'+eur(x.value)+' <button class="small link" data-act="delVal" data-id="'+a.id+'" data-d="'+x.date+'" aria-label="Eintrag löschen">×</button></b></div>').join('')+'</div>':'')
  +(a.note?'<p class="note">'+esc(a.note)+'</p>':'')
  +'<div class="mact"><button class="danger" data-act="delAcc" data-id="'+a.id+'">Löschen</button><button data-act="editAcc" data-id="'+a.id+'">Umbenennen</button></div>');
}
function editAcc(id){const a=id?accOf(id):{name:'',type:'bank',note:''};
  modal('<h3>'+(id?'Konto bearbeiten':'Neues Konto')+'</h3><label>Name<input id="f-aname" value="'+esc(a.name)+'" placeholder="z. B. Sparkasse, Bitcoin, Bargeld"></label><label>Art<select id="f-atype">'+Object.entries(ACC_TYPES).map(([k,v])=>'<option value="'+k+'"'+sel(k===a.type)+'>'+v+'</option>').join('')+'</select></label>'+(id?'':'<label>Aktueller Stand (€)<input id="f-aval" inputmode="decimal"></label>')+'<label>IBAN (damit Auszüge automatisch dem Konto zugeordnet werden)<input id="f-aiban" value="'+esc(a.iban||'')+'"></label><label>Notiz<input id="f-anote" value="'+esc(a.note)+'"></label><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveAcc" data-id="'+(id||'')+'">Speichern</button></div>')}
/* ---------- Mehr ---------- */
const MI={
 bank:'<path d="M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18M12 3l9 5H3z"/>',
 pen:'<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
 bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
 wand:'<path d="M4 20 16 8M14 4v2M20 10h-2M18.5 5.5 17 7M15 3l1 1M21 9l-1-1"/>',
 file:'<path d="M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6"/>',
 lock:'<path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
 eye:'<path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="3"/>',
 immo:'<path d="M4 21V5l8-3v19M12 21h8V9l-8-3M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2"/>',
 globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
 cloud:'<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 9zM9.5 13.5l2 2 3.5-4"/>'};
const mic=(k,c)=>'<span class="mic '+c+'"><svg viewBox="0 0 24 24" aria-hidden="true">'+MI[k]+'</svg></span>';
const MEHR_SUB={bank:'Bankverbindungen',bills:'Rechnungen',remind:'Erinnerungen',rules:'Regeln & Kategorien',report:'Jahresbericht',acct:'Konto, Sicherheit & Backup'};
function mehrSub(){const s=(location.hash.split('/')[1]||'');return MEHR_SUB[s]?s:''}
const hm=t=>{const d=new Date(t);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
function bkNextRun(){const H=(bkSched.hours||[9,14,18]).slice().sort((x,y)=>x-y),n=new Date();for(const h of H){if(n.getHours()<h)return String(h).padStart(2,'0')+':00'}return 'morgen '+String(H[0]).padStart(2,'0')+':00'}
function mehrStatus(){const b=bk(),n=b.conns.length,LI=loggedIn();let h='<section class="mstat">';
  if(bkReady()&&n){const errC=b.conns.filter(c=>c.err==='expired'||c.lastErr);
    h+='<a class="mstat-top" href="#mehr/bank">'+mic('bank','c1')+'<span><b>Bank · '+n+' verbunden</b><small>'+(b.lastFetch?'Zuletzt '+(new Date(b.lastFetch).toDateString()===new Date().toDateString()?'heute':dfmt(new Date(b.lastFetch).toISOString().slice(0,10)))+' '+hm(b.lastFetch)+(b.lastNew!=null?' · '+b.lastNew+' neu':''):'Noch nicht abgerufen')+'</small>'
      +(LI&&bkSched.active?'<small>Nächster Abruf '+bkNextRun()+'</small>':'')+(errC.length?'<small class="neg">'+esc(errC.map(c=>c.aspsp.name).join(', '))+': '+(errC.some(c=>c.err==='expired')?'neu verbinden':'Fehler beim letzten Abruf')+'</small>':'')+'</span><span class="chev">›</span></a>'}
  else if(LI&&!acct.bank)h+='';
  else h+='<a class="mstat-top" href="#mehr/bank">'+mic('bank','c1')+'<span><b>Bank verbinden</b><small>Umsätze kommen dann automatisch</small></span><span class="chev">›</span></a>';
  return h+'<div class="form"><button data-act="addManual" data-v="expense">+ Ausgabe</button><button data-act="addManual" data-v="income">+ Einnahme</button></div></section>'}
function vMehr(){const s=mehrSub();
  if(s)return '<div class="subhead"><a class="back" href="#mehr" aria-label="Zurück zu Mehr">‹</a><h2>'+MEHR_SUB[s]+'</h2></div>'+MEHR_P[s]();
  const rc=remindItems().length,b=bk();
  const row=(k,ic,c,t,x)=>'<a class="mrow" href="#mehr/'+k+'">'+mic(ic,c)+'<span>'+t+'</span>'+(x?'<em>'+x+'</em>':'')+'<span class="chev">›</span></a>';
  return '<h2>Mehr</h2>'+mehrStatus()+'<nav class="mlist">'
    +row('bills','file','c1','Rechnungen',(S.bills||[]).filter(b=>b.status==='open').length||'')+row('remind','bell','c2','Erinnerungen',rc||'')+row('rules','wand','c3','Regeln & Kategorien',S.rules.length||'')
    +row('report','file','c4','Jahresbericht','')+row('acct','lock','c5','Konto, Sicherheit & Backup','')+'</nav>'}
const MEHR_P={
 bills:()=>billPage(),
 bank:()=>bkSection().replace('<h3>Bankverbindung</h3>','')+bkSchedInfo(),
 report:()=>'<section class="group"><p class="hint">Alle Zahlen eines Jahres als Datei, zum Ausdrucken oder für den Steuerberater.</p><button data-act="report">Jahresbericht erstellen</button></section>',
 remind:()=>remPage(),
 rules:()=>'<section class="group"><h3>Automatische Regeln</h3><p class="hint">Steht das Stichwort im Umsatz, wird er beim Abruf oder Hochladen automatisch einsortiert.</p><div class="list">'+S.rules.map((r,i)=>'<div class="item static"><span class="it"><strong>'+esc(r.keyword)+'</strong><small>'+esc(r.category)+(r.propertyId?' · '+esc((propOf(r.propertyId)||{}).name||''):'')+'</small></span><button class="ic" data-act="delRule" data-i="'+i+'" aria-label="Regel löschen">×</button></div>').join('')+'</div>'
  +'<div class="form"><input id="f-rkw" placeholder="Stichwort, z. B. REWE"><select id="f-rcat"><optgroup label="Ausgabe">'+S.cats.map(c=>'<option>'+esc(c)+'</option>').join('')+'</optgroup><optgroup label="Einnahme">'+S.icats.map(c=>'<option>'+esc(c)+'</option>').join('')+'</optgroup></select>'+(immoOn()?'<select id="f-rprop"><option value="">Privat</option>'+S.props.map(p=>'<option value="'+p.id+'">Immobilie: '+esc(p.name)+'</option>').join('')+'</select>':'')+'<button data-act="addRule">Regel hinzufügen</button></div></section>'+learnSection()
  +'<section class="group"><h3>Kategorien für Ausgaben</h3><div class="chips">'+S.cats.map((c,i)=>'<span class="chip">'+esc(c)+'<button data-act="delCat" data-i="'+i+'" aria-label="'+esc(c)+' entfernen">×</button></span>').join('')+'</div><div class="form"><input id="f-cat" placeholder="Neue Kategorie"><button data-act="addCat">Hinzufügen</button></div></section>',
 acct:()=>acctPage()
};
/* ---------- Formulare ---------- */
function editProp(id){const p=id?propOf(id):{name:'',address:'',country:'Kroatien',value:'',valueNote:''};
  modal('<h3>'+(id?'Objekt bearbeiten':'Neues Objekt')+'</h3><label>Name<input id="f-name" value="'+esc(p.name)+'"></label><label>Adresse<input id="f-addr" value="'+esc(p.address)+'"></label><label>Land<input id="f-country" list="cl" value="'+esc(p.country)+'"></label><datalist id="cl"><option>Kroatien</option><option>Deutschland</option></datalist><div class="grid2"><label>Heutiger Wert (€, optional)<input id="f-pval" inputmode="decimal" value="'+(p.value?String(p.value).replace('.',','):'')+'" placeholder="z. B. Schätzung Makler"></label><label>Stand<input id="f-pvd" type="month" value="'+esc(p.valueDate||'')+'"></label></div><h3 class="gt lh">Kauf und Investitionen</h3><p class="hint">Für die Rendite. Z. B. Kauf 2015 und später ein Ausbau.</p>'+[0,1,2].map(i=>{const b=(p.buy||[])[i]||{};return '<div class="grid3"><label>Jahr<input id="f-by'+i+'" inputmode="numeric" value="'+esc(b.year||'')+'"></label><label>Betrag (€)<input id="f-bp'+i+'" inputmode="decimal" value="'+(b.price?String(b.price).replace('.',','):'')+'"></label><label>Was<input id="f-bw'+i+'" value="'+esc(b.what||(i?'':'Kauf'))+'"></label></div>'}).join('')+'<div class="mact">'+(id?'<button class="danger" data-act="delProp" data-id="'+id+'">Löschen</button>':'')+'<button data-act="close">Abbrechen</button><button class="primary" data-act="saveProp" data-id="'+(id||'')+'">Speichern</button></div>')}
function editUnit(id){
  if(!S.props.length){toast('Lege zuerst ein Objekt an.');return}
  const u=id?unitOf(id):{propertyId:S.props[0].id,name:'',tenant:'',rent:'',dueDay:5,iban:'',keywords:'',start:monthOf(todayISO()),end:'',deposit:'',contractEnd:'',noticeMonths:3,note:''};
  const n=v=>v===''||v==null||v===0?'':String(v).replace('.',',');
  modal('<h3>'+(id?'Einheit bearbeiten':'Neue Einheit')+'</h3><div class="grid2"><label>Objekt<select id="f-prop">'+S.props.map(p=>'<option value="'+p.id+'"'+sel(p.id===u.propertyId)+'>'+esc(p.name)+'</option>').join('')+'</select></label><label>Bezeichnung<input id="f-name" value="'+esc(u.name)+'"></label><label>Mieter<input id="f-tenant" value="'+esc(u.tenant)+'"></label><label>Miete / Monat (€)<input id="f-rent" inputmode="decimal" value="'+n(u.rent)+'"></label><label>Fällig am Tag<input id="f-due" type="number" min="1" max="28" value="'+esc(u.dueDay||5)+'"></label><label>Kaution (€)<input id="f-dep" inputmode="decimal" value="'+n(u.deposit)+'"></label><label>Vertrag bis<input id="f-cend" type="date" value="'+esc(u.contractEnd)+'"></label><label>Kündigungsfrist (Monate)<input id="f-notice" type="number" min="0" max="24" value="'+esc(u.noticeMonths||3)+'"></label><label>Miete ab<input id="f-start" type="month" value="'+esc(u.start)+'"></label><label>Mietende (leer = läuft)<input id="f-end" type="month" value="'+esc(u.end)+'"></label><label>IBAN des Mieters<input id="f-iban" value="'+esc(u.iban)+'"></label><label>Suchwort im Umsatz<input id="f-kw" value="'+esc(u.keywords)+'" placeholder="z. B. Nachname"></label></div><label>Notiz<textarea id="f-note" rows="2">'+esc(u.note)+'</textarea></label><label>Wohnfläche (m², optional)<input id="f-sqm" inputmode="decimal" value="'+n(u.sqm)+'"></label><label>Anteil am Kaufpreis (€, optional)<input id="f-bshare" inputmode="decimal" value="'+n(u.buyShare)+'" placeholder="leer = nach Miete verteilt"></label><label>Vertrag bei der Porezna gemeldet?<select id="f-rpo"><option value="ok"'+sel(u.rpo!=='open')+'>Ja, erledigt oder vom Notar</option><option value="open"'+sel(u.rpo==='open')+'>Nein, muss ich noch einreichen</option></select></label><p class="hint">Kroatien: Mietvertrag innerhalb von 8 Tagen über <a href="https://e-porezna.porezna-uprava.hr" target="_blank" rel="noopener">ePorezna</a> → Zahtjevi → RPO mit Vertrag als Anhang. Bei Beglaubigung oder Solemnisierung meldet der Notar ihn selbst.</p><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveUnit" data-id="'+(id||'')+'">Speichern</button></div>');
}
function manualDlg(kind){
  const cats=kind==='income'?S.icats:S.cats;
  modal('<h3>'+(kind==='income'?'Einnahme':'Ausgabe')+' eintragen</h3><div class="grid2"><label>Datum<input id="f-date" type="date" value="'+todayISO()+'"></label><label>Betrag (€)<input id="f-amt" inputmode="decimal" placeholder="z. B. 120,00"></label><label>Kategorie<select id="f-ecat">'+cats.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></label>'+(kind==='income'||!immoOn()?'':'<label>Wofür<select id="f-eprop"><option value="">Privat</option>'+S.props.map(p=>'<option value="'+p.id+'">Immobilie: '+esc(p.name)+'</option>').join('')+'</select></label>')+'</div><label>Beschreibung<input id="f-desc"></label><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveManual" data-v="'+kind+'">Speichern</button></div>');
}
/* ---------- PDF ---------- */
const PDFJS='./lib/';
let pdfjsP=null;
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('load'));document.head.appendChild(s)})}
function loadPdfjs(){if(!pdfjsP)pdfjsP=loadScript(PDFJS+'pdf.worker.min.js').then(()=>loadScript(PDFJS+'pdf.min.js')).then(()=>{const L=window.pdfjsLib;L.GlobalWorkerOptions.workerSrc=PDFJS+'pdf.worker.min.js';return L});pdfjsP.catch(()=>{pdfjsP=null});return pdfjsP}
// shared: build lines from pdf.js textContent
async function pdfToLines(pdf){
  const out=[];
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);const tc=await page.getTextContent();
    const its=tc.items.filter(i=>i.str!==undefined&&i.str!=='').map(i=>({x:i.transform[4],y:i.transform[5],w:i.width,fs:Math.hypot(i.transform[2],i.transform[3])||10,s:i.str}));
    its.sort((a,b)=>b.y-a.y||a.x-b.x);
    const rows=[];
    for(const it of its){let r=rows.find(r=>Math.abs(r.y-it.y)<2.5);if(!r){r={y:it.y,items:[]};rows.push(r)}r.items.push(it)}
    rows.sort((a,b)=>b.y-a.y);
    for(const r of rows){
      r.items.sort((a,b)=>a.x-b.x);
      const cells=[];let cur=null;
      for(const it of r.items){
        if(cur){const gap=it.x-(cur.x2);
          if(gap>it.fs*1.2){cells.push(cur);cur=null}
          else{cur.t+=(gap>it.fs*0.28&&!/\s$/.test(cur.t)&&!/^\s/.test(it.s)?' ':'')+it.s;cur.x2=it.x+it.w;continue}}
        cur={x:it.x,x2:it.x+it.w,t:it.s};
      }
      if(cur)cells.push(cur);
      const cl=cells.map(c=>({x:Math.round(c.x),t:c.t.replace(/\s+/g,' ').trim()})).filter(c=>c.t);
      if(cl.length)out.push({page:p,cells:cl,text:cl.map(c=>c.t).join('  ')});
    }
  }
  return out;
}
/*PDFPARSE*/
function fixSpaced(s){let p;do{p=s;s=s.replace(/([ao123]) (?=[a-z0-9.,äöüß])/g,'$1')}while(s!==p);return s}
const pdfNum=s=>parseDE(String(s).replace(/\s+/g,''));
function cleanName(s){return s.replace(/\s+/g,' ').trim()}
function parseBankPdf(lines){
  const all=lines.map(l=>l.text).join('\n');
  if(/Deutsche Kreditbank/i.test(all))return pdfDKB(lines);
  if(/IZVADAK/i.test(all)&&/rba\.hr|Raiffeisen/i.test(all))return pdfRBA(lines);
  if(/SCFBDE|Santander|openbank|ALTER SALDO/i.test(all.replace(/ /g,'')))return pdfSAN(lines);
  return null;
}
function pdfDKB(lines){
  const out=[];let cur=null,start=null,end=null;
  const close=()=>{if(cur){const d=cur.desc;let name=(d[0]||'').replace(/\s\d{6,}.*$/,'').trim();cur.name=name||cur.kind;cur.purpose=(cur.kind+' · '+d.join(' ')).replace(/\s+/g,' ').trim();cur.iban='';delete cur.desc;delete cur.kind;out.push(cur);cur=null}};
  for(const l of lines){
    const c0=l.cells[0],t=l.text;let m;
    if((m=c0.t.match(/^(\d\d\.\d\d\.\d{4}) (.+)$/))&&l.cells.length>1){close();const amt=pdfNum(l.cells[l.cells.length-1].t);if(isNaN(amt))continue;cur={date:parseDate(m[1]),amount:amt,kind:m[2].trim(),desc:[]};continue}
    if((m=t.match(/^Kontostand am (\d\d\.\d\d\.\d{4}).*?(-?[\d.]+,\d\d)$/))){close();const v={date:parseDate(m[1]),value:pdfNum(m[2])};if(!start)start=v;else end=v;continue}
    if(cur&&c0.x>100&&c0.x<200)cur.desc.push(t);else close();
  }
  close();return {bank:'DKB',txs:out,start,end};
}
function pdfRBA(lines){
  const out=[];let cur=null,prev=null,start=null,end=null;
  const close=()=>{if(cur){cur.purpose=cur.desc.join(' ').replace(/\s+/g,' ').trim();delete cur.desc;out.push(cur);cur=null}};
  for(const l of lines){
    const t=l.text.replace(/\s+/g,' ').trim(),c0=l.cells[0];let m;
    if((m=t.match(/POČETNO STANJE (-?[\d,]+\.\d\d)\s*EUR/))){prev=pdfNum(m[1]);continue}
    if((m=t.match(/^(\d\d\.\d\d\.\d{4})\. (.*?) (-?[\d,]+\.\d\d) (-?[\d,]+\.\d\d)\s*EUR$/))){
      close();const amt=pdfNum(m[3]),bal=pdfNum(m[4]);let sign=1;
      if(prev!=null)sign=bal<prev-0.004?-1:1;else if(/isplata/i.test(t))sign=-1;
      if(start==null&&prev!=null)start={value:prev};
      prev=bal;cur={date:parseDate(m[1]),amount:sign*amt,name:cleanName(m[2]),iban:'',desc:[]};continue}
    if((m=t.match(/STANJE NA DAN (\d\d\.\d\d\.\d{4})\.? (-?[\d,]+\.\d\d)/))){close();end={date:parseDate(m[1]),value:pdfNum(m[2])};continue}
    if(cur&&c0.x>60&&c0.x<120){
      if(/^Referenca:/i.test(t))continue;
      const ib=t.match(/\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})$/);
      if(ib){if(!cur.iban)cur.iban=ib[1];const rest=t.slice(0,-ib[1].length).trim();if(rest)cur.desc.push(rest);continue}
      cur.desc.push(t);continue}
    if(cur&&(c0.x<60))close();
  }
  close();return {bank:'RBA',txs:out,start,end};
}
function pdfSAN(lines){
  const L=lines.map(l=>({cells:l.cells.map(c=>({x:c.x,t:fixSpaced(c.t)}))})).map(l=>Object.assign(l,{text:l.cells.map(c=>c.t).join('  ')}));
  const all=L.map(l=>l.text).join('\n');
  let y1=+todayISO().slice(0,4),m1=12;const pm=all.match(/UMSÄTZE VOM\s*\d\d\.\d\d\.\d{4}\s*BIS\s*\d\d\.(\d\d)\.(\d{4})/);if(pm){m1=+pm[1];y1=+pm[2]}
  const out=[];let cur=null,start=null,end=null;
  const close=()=>{if(!cur)return;let d=cur.desc.join(' ').replace(/\s+/g,' ').trim();
    let m=d.match(/^(.*?\b(?:VON|AN))\s+(.*)$/);let kind=m?m[1]:'',rest=m?m[2]:d;
    let name=rest.replace(/\s*\d[\d ]{6,}.*$/,'').replace(/\s+(IBAN|EREF|MREF|SVWZ|CRED)\b.*$/,'').trim();
    const ib=d.match(/IBAN ([A-Z]{2}\d{2}[A-Z0-9]{10,30})/);cur.iban=ib?ib[1]:'';
    const sv=d.match(/SVWZ\+(.*)$/);let purpose=sv?sv[1]:rest;
    const shop=d.match(/Ihr Einkauf bei (.+?)(?:,? Inc\.?)?$/i);if(/paypal/i.test(name)&&shop)name='PayPal: '+shop[1].replace(/,\s*$/,'').trim();
    cur.name=name||kind;cur.purpose=((kind?kind+' · ':'')+purpose.replace(/^[\d ./A-Z]{6,}\/\.?\s*/,'')).trim();delete cur.desc;out.push(cur);cur=null};
  for(const l of L){
    const c0=l.cells[0],t=l.text;let m;
    if(/^\d\d\.\d\d\.$/.test(c0.t)&&l.cells.length>=3){close();
      const amtCell=l.cells.find(c=>c.x>150&&c.x<280),txtCell=l.cells.find(c=>c.x>=280);
      const amt=amtCell?pdfNum(amtCell.t):NaN;if(isNaN(amt))continue;
      const dd=+c0.t.slice(0,2),mm=+c0.t.slice(3,5);const yy=mm>m1?y1-1:y1;
      cur={date:iso(yy,mm,dd),amount:amt,desc:txtCell?[txtCell.t]:[]};continue}
    if((m=t.match(/^(-?[\d.]+,\d\d\s*-?)\s+(ALTER SALDO|NEUER SALDO)/))){close();const v=pdfNum(m[1]);if(m[2]==='ALTER SALDO')start={value:v};else end={value:v};continue}
    if(/ZWISCHENSALDO|ÜBERTRAG/.test(t))continue;
    if(cur&&c0.x>=280&&!/Wichtige Hinweise|SOLL-ZINSEN/.test(t)){cur.desc.push(t);continue}
    if(cur&&/SOLL-ZINSEN|Wichtige Hinweise/.test(t))close();
  }
  close();if(end&&!end.date){const pd=all.match(/Auszug-Datum\s*(\d\d\.\d\d\.\d{4})/);if(pd)end.date=parseDate(pd[1])}
  return {bank:'Santander',txs:out,start,end};
}
/*ENDPDFPARSE*/

const BANK_ACC={DKB:/dkb|kreditbank/,RBA:/rba|raiffeisen/,Santander:/santander/};
async function handlePdf(buf,name){
  toast('PDF wird gelesen …');
  let L;try{L=await loadPdfjs()}catch(e){toast('Der PDF-Leser konnte nicht geladen werden. Prüfe die Internetverbindung.');return}
  let lines;try{const pdf=await L.getDocument({data:new Uint8Array(buf),isEvalSupported:false}).promise;lines=await pdfToLines(pdf)}catch(e){toast('Die PDF konnte nicht gelesen werden.');return}
  if(!lines.length){toast('In der PDF ist kein Text. Ein eingescannter Auszug oder ein Foto geht leider nicht.');return}
  const r=parseBankPdf(lines);
  if(!r){toast('Diese Bank kennt die App noch nicht. Schick Claude einen Auszug, dann wird sie eingebaut.');return}
  if(!r.txs.length){toast('In dieser PDF wurden keine Buchungen gefunden.');return}
  const flat=lines.map(l=>l.text).join(' ').replace(/\s+/g,'');const re=BANK_ACC[r.bank];const acc=(S.accounts.find(a=>a.iban&&flat.includes(a.iban))||S.accounts.find(a=>re&&re.test(nrm(a.name)))||{}).id||'';
  imp={file:name,pdf:r,acc};showImport();
}
function showPdfImport(){
  const r=imp.pdf,sum=r.txs.reduce((s,t)=>s+t.amount,0);
  const ok=r.start&&r.end?Math.abs(r.start.value+sum-r.end.value)<0.01:null;
  modal('<h3>Kontoauszug '+esc(r.bank)+'</h3><p class="hint">'+esc(imp.file)+'</p><label>Konto<select id="f-iacc"><option value="">Nicht angeben</option>'+S.accounts.filter(a=>a.type==='bank').map(a=>'<option value="'+a.id+'"'+sel(a.id===imp.acc)+'>'+esc(a.name)+'</option>').join('')+'</select></label><div id="imppv">'+impPreview()+'</div>'
  +(ok===true?'<p class="okline">✓ Alle Buchungen erkannt, die Summe passt zum Saldo auf dem Auszug.</p>':ok===false?'<p class="neg">Achtung: Die Summe passt nicht zum Saldo auf dem Auszug. Vielleicht fehlt eine Buchung.</p>':'')
  +(r.end&&r.end.value!=null?'<label class="chk"><input type="checkbox" id="f-setbal" checked> Kontostand '+eur(r.end.value)+(r.end.date?' vom '+dfmt(r.end.date):'')+' übernehmen</label>':'')
  +'<div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="doImport">Übernehmen</button></div>');
}
/* ---------- Import ---------- */
let imp=null;
async function handleFile(file){
  const buf=await file.arrayBuffer();let text;
  if(/\.pdf$/i.test(file.name)||file.type==='application/pdf'){await handlePdf(buf,file.name);return}try{text=new TextDecoder('utf-8',{fatal:true}).decode(buf)}catch(e){text=new TextDecoder('windows-1252').decode(buf)}
  const parsed=parseCSV(text);if(!parsed.data.length){toast('In der Datei wurden keine Zeilen gefunden.');return}
  const fn=nrm(file.name);const guess=(S.accounts.find(a=>a.type==='bank'&&fn.includes(nrm(a.name).split(/[\s(]/)[0]))||{}).id||ui.lastAcc||'';
  imp={file:file.name,parsed,map:guessCols(parsed.headers),acc:guess};showImport();
}
function altKey(t){return [t.date,(+t.amount).toFixed(2),nrm(t.purpose||'').replace(/\s+/g,' ').slice(0,120)].join('|')}
function altCounts(){const c={};S.txs.forEach(t=>{const k=altKey(t);c[k]=(c[k]||0)+1});return c}
function keyCounts(){const c={};S.txs.forEach(t=>{const k=t.key||txKey(t);c[k]=(c[k]||0)+1});return c}
const impList=()=>imp.pdf?imp.pdf.txs:rowsToTx(imp.parsed.data,imp.map);
function impPreview(){const list=impList(),ex=keyCounts(),ea=altCounts(),seen={},sa={};let neu=0,dup=0;list.forEach(t=>{const k=txKey(t),a=altKey(t);seen[k]=(seen[k]||0)+1;sa[a]=(sa[a]||0)+1;if((ex[k]||0)>=seen[k]||(t.purpose&&(ea[a]||0)>=sa[a]))dup++;else neu++});
  if(!list.length)return '<p class="neg">Es wurde keine Buchung erkannt. Öffne „Spalten prüfen“ und wähle Datum und Betrag.</p>';
  return '<section class="tiles3 two"><div><span>Neu</span><b class="num">'+neu+'</b></div><div><span>Schon vorhanden</span><b class="num">'+dup+'</b></div></section><div class="elist">'+list.slice(0,3).map(t=>'<div class="erow"><span><b>'+esc(t.name||'–')+'</b><small>'+dfmt(t.date)+' · '+esc(t.purpose.slice(0,50))+'</small></span><span class="num '+(t.amount<0?'neg':'pos')+'">'+eur(t.amount)+'</span></div>').join('')+'</div>'}
function showImport(){if(imp.pdf)return showPdfImport();
  const h=imp.parsed.headers,m=imp.map;const opt=(cur,none)=>'<option value="-1">'+none+'</option>'+h.map((x,i)=>'<option value="'+i+'"'+sel(cur===i)+'>'+esc(x||('Spalte '+(i+1)))+'</option>').join('');
  modal('<h3>Kontoauszug hochladen</h3><p class="hint">'+esc(imp.file)+'</p><label>Von welchem Konto?<select id="f-iacc"><option value="">Nicht angeben</option>'+S.accounts.filter(a=>a.type==='bank').map(a=>'<option value="'+a.id+'"'+sel(a.id===imp.acc)+'>'+esc(a.name)+'</option>').join('')+'</select></label><div id="imppv">'+impPreview()+'</div><details class="cols"><summary>Spalten prüfen</summary><div class="grid2"><label>Datum<select data-imp="date">'+opt(m.date,'–')+'</select></label><label>Betrag<select data-imp="amount">'+opt(m.amount,'–')+'</select></label><label>Verwendungszweck<select data-imp="purpose">'+opt(m.purpose,'keine')+'</select></label><label>IBAN Gegenseite<select data-imp="iban">'+opt(m.iban,'keine')+'</select></label><label>Soll/Haben<select data-imp="sign">'+opt(m.sign,'keine')+'</select></label></div><div class="hint">Name der Gegenseite</div><div class="chips">'+h.map((x,i)=>'<label class="chip"><input type="checkbox" data-imp="name" value="'+i+'"'+(m.names.includes(i)?' checked':'')+'> '+esc(x||('Spalte '+(i+1)))+'</label>').join('')+'</div></details><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="doImport">Übernehmen</button></div>');
}
function dedupeExcel(tx){const m=tx.forMonth||monthOf(tx.date);const i=S.txs.findIndex(x=>x.src==='excel'&&x.type==='rent'&&x.unitId===tx.unitId&&x.forMonth===m);if(i>=0)S.txs.splice(i,1)}
function doImport(){
  const acc=$('#f-iacc').value;ui.lastAcc=acc;const list=impList(),ex=keyCounts(),ea=altCounts(),sa={},seen={};let added=0,dup=0,auto=0;
  const bused=new Set();
  for(const t of list){const k=txKey(t),ak=altKey(t);seen[k]=(seen[k]||0)+1;sa[ak]=(sa[ak]||0)+1;if((ex[k]||0)>=seen[k]||(t.purpose&&(ea[ak]||0)>=sa[ak])){dup++;continue}
    {const m=typeof bkFuzzy==='function'&&bkFuzzy(acc,t.amount,t.date,bused,y=>!!y.ebid&&!y.pdfMatched);if(m){bused.add(m.id);m.pdfMatched=1;dup++;continue}}
    const tx={id:uid(),key:k,date:t.date,amount:t.amount,name:t.name,iban:t.iban,purpose:t.purpose,type:'open',unitId:'',propertyId:'',category:'',forMonth:'',accountId:acc};
    if(autoAssign2(tx)){auto++;if(tx.type==='rent')dedupeExcel(tx)}S.txs.push(tx);added++}
  const sb=$('#f-setbal');if(imp.pdf&&sb&&sb.checked&&acc&&imp.pdf.end){const ac=accOf(acc),d=imp.pdf.end.date||todayISO();ac.history=(ac.history||[]).filter(h=>h.date!==d);ac.history.push({date:d,value:imp.pdf.end.value})}
  closeModal();ui.filter='open';ui.geld='umsaetze';saveUi();save();
  if(location.hash!=='#geld')location.hash='#geld';else render();
  toast(added+' neu, davon '+auto+' automatisch zugeordnet. '+dup+' waren schon da.');
}
/* ---------- Aktionen ---------- */
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act,id=b.dataset.id,i=+b.dataset.i;const go=()=>{save();render()};
  switch(a){
  case 'close':closeModal();return;
  case 'confirmOk':{const f=pendingFn;pendingFn=null;closeModal();if(f)f();return}
  case 'prevMonth':case 'nextMonth':ui.month=addMonth(ui.month,a==='prevMonth'?-1:1);saveUi();render();return;
  case 'yearPrev':case 'yearNext':ui.year+=a==='yearPrev'?-1:1;saveUi();render();return;
  case 'geld':ui.geld=b.dataset.v;saveUi();render();return;
  case 'goOpen':ui.geld='umsaetze';ui.filter='open';saveUi();return;
  case 'filter':ui.filter=b.dataset.v;ui.limit=100;saveUi();render();return;
  case 'showMore':ui.limit+=100;$('#txlist').innerHTML=txList();return;
  case 'pickFile':{const f=$('#f-file');f.value='';f.click();return}
  case 'unit':unitDetail(id);return;
  case 'addProp':editProp();return;case 'editProp':editProp(id);return;
  case 'addUnit':editUnit();return;case 'editUnit':editUnit(id);return;
  case 'acc':accDetail(id);return;case 'addAcc':editAcc();return;case 'editAcc':editAcc(id);return;
  case 'addManual':manualDlg(b.dataset.v);return;
  case 'saveManual':{const amt=parseDE($('#f-amt').value);if(isNaN(amt)||amt===0){toast('Bitte einen Betrag eingeben.');return}const inc=b.dataset.v==='income';
    S.txs.push({id:uid(),date:$('#f-date').value||todayISO(),amount:inc?Math.abs(amt):-Math.abs(amt),name:'Von Hand',purpose:$('#f-desc').value.trim(),iban:'',type:inc?'income':'expense',category:$('#f-ecat').value,propertyId:inc?'':$('#f-eprop').value,unitId:'',forMonth:'',src:'manual'});closeModal();go();toast('Gespeichert.');return}
  case 'saveAcc':{const name=$('#f-aname').value.trim();if(!name){toast('Bitte einen Namen eingeben.');return}
    const v={name,type:$('#f-atype').value,note:$('#f-anote').value.trim(),iban:normIban($('#f-aiban').value)};
    if(id)Object.assign(accOf(id),v);else{const x=Object.assign({id:uid(),history:[]},v);const val=parseDE($('#f-aval').value);if(!isNaN(val))x.history.push({date:todayISO(),value:val});S.accounts.push(x)}
    closeModal();go();return}
  case 'addVal':{const val=parseDE($('#f-val').value);if(isNaN(val)){toast('Bitte einen Betrag eingeben.');return}const d=$('#f-vdate').value||todayISO();const ac=accOf(id);ac.history=(ac.history||[]).filter(h=>h.date!==d);ac.history.push({date:d,value:val});save();render();accDetail(id);toast('Stand gespeichert.');return}
  case 'delVal':{const ac=accOf(id);ac.history=ac.history.filter(h=>h.date!==b.dataset.d);save();render();accDetail(id);return}
  case 'delAcc':{const ac=accOf(id);ask('Konto „'+ac.name+'“ löschen?','Löschen',()=>{S.accounts=S.accounts.filter(x=>x.id!==id);S.txs.forEach(t=>{if(t.accountId===id)t.accountId=''});go()});return}
  case 'saveProp':{const name=$('#f-name').value.trim();if(!name){toast('Bitte einen Namen eingeben.');return}const pvs=$('#f-pval').value.trim(),pv=pvs===''?0:parseDE(pvs);if(isNaN(pv)){toast('Heutiger Wert ist keine gültige Zahl.');return}
    const v={name,address:$('#f-addr').value.trim(),country:$('#f-country').value.trim(),value:pv,valueDate:$('#f-pvd').value||(pv?monthOf(todayISO()):''),valueNote:id?(propOf(id).valueNote||''):''};
    const buy=[];for(const i of [0,1,2]){const y=$('#f-by'+i).value.trim(),pr=$('#f-bp'+i).value.trim();if(!pr)continue;const n=parseDE(pr);if(isNaN(n)){toast('Betrag in Zeile '+(i+1)+' ist keine gültige Zahl.');return}buy.push({year:y,price:n,what:$('#f-bw'+i).value.trim()})}v.buy=buy;if(id)Object.assign(propOf(id),v);else S.props.push(Object.assign({id:uid()},v));closeModal();go();return}
  case 'saveUnit':{const name=$('#f-name').value.trim();if(!name){toast('Bitte eine Bezeichnung eingeben.');return}
    const num=s=>s.trim()===''?0:parseDE(s);const rent=num($('#f-rent').value),dep=num($('#f-dep').value);if(isNaN(rent)||isNaN(dep)){toast('Miete oder Kaution ist keine gültige Zahl.');return}
    const v={propertyId:$('#f-prop').value,name,tenant:$('#f-tenant').value.trim(),rent,deposit:dep,dueDay:Math.min(28,Math.max(1,parseInt($('#f-due').value,10)||5)),contractEnd:$('#f-cend').value,noticeMonths:parseInt($('#f-notice').value,10)||0,start:$('#f-start').value,end:$('#f-end').value,iban:normIban($('#f-iban').value),keywords:$('#f-kw').value.trim(),note:$('#f-note').value.trim(),rpo:$('#f-rpo').value,buyShare:num($('#f-bshare').value),sqm:num($('#f-sqm').value)};if(isNaN(v.sqm)){toast('Wohnfläche ist keine gültige Zahl.');return}if(isNaN(v.buyShare)){toast('Anteil am Kaufpreis ist keine gültige Zahl.');return}
    if(id)Object.assign(unitOf(id),v);else S.units.push(Object.assign({id:uid()},v));closeModal();go();return}
  case 'delProp':{const p=propOf(id);ask('„'+p.name+'“ mit allen Einheiten löschen? Die Umsätze bleiben erhalten.','Löschen',()=>{const ids=S.units.filter(u=>u.propertyId===id).map(u=>u.id);S.txs.forEach(t=>{if(t.type==='rent'&&ids.includes(t.unitId)){t.type='open';t.unitId=''}if(t.propertyId===id)t.propertyId=''});S.units=S.units.filter(u=>u.propertyId!==id);S.props=S.props.filter(x=>x.id!==id);go()});return}
  case 'delUnit':{const u=unitOf(id);ask('„'+unitLabel(u)+'“ löschen? Zugeordnete Mieten werden wieder offen.','Löschen',()=>{S.txs.forEach(t=>{if(t.type==='rent'&&t.unitId===id){t.type='open';t.unitId=''}});S.units=S.units.filter(x=>x.id!==id);go()});return}
  case 'immo':ui.immo=b.dataset.v;saveUi();render();return;
  case 'plan':planDlg(id);return;case 'addPlan':planDlg();return;
  case 'savePlan':{const title=$('#f-ptitle').value.trim();if(!title){toast('Bitte die Maßnahme eingeben.');return}const num=s=>s.trim()===''?null:parseDE(s);
    const v={title,propertyId:$('#f-pprop').value,year:parseInt($('#f-pyear').value,10)||null,prio:$('#f-pprio').value,status:$('#f-pstat').value,est:num($('#f-pest').value),act:num($('#f-pact').value),note:$('#f-pnote2').value.trim()};
    S.plans=S.plans||[];if(id)Object.assign(S.plans.find(x=>x.id===id),v);else S.plans.push(Object.assign({id:uid()},v));closeModal();go();return}
  case 'delPlan':ask('Maßnahme löschen?','Löschen',()=>{S.plans=S.plans.filter(x=>x.id!==id);go()});return;
  case 'editReserve':reserveDlg();return;
  case 'saveReserve':{const r=S.reserve=S.reserve||{special:{}};r.startYear=parseInt($('#f-rstart').value,10)||r.startYear;const yv=parseDE($('#f-ryear').value);if(!isNaN(yv))r.yearly=yv;const tv=parseDE($('#f-rtarget').value);if(!isNaN(tv))r.target=tv;const sy=parseInt($('#f-rspy').value,10),sv=parseDE($('#f-rspv').value);r.special=r.special||{};if(sy&&!isNaN(sv))r.special[sy]=(+r.special[sy]||0)+sv;r.note=$('#f-rnote').value.trim();closeModal();go();return}
  case 'addFix':modal('<h3>Fixkosten</h3><label>Bezeichnung<input id="f-ftitle" placeholder="z. B. Wasser Grundgebühr"></label><div class="grid2"><label>Betrag (€)<input id="f-famt" inputmode="decimal"></label><label>Wie oft<select id="f-fper"><option value="12">monatlich</option><option value="4">vierteljährlich</option><option value="1">jährlich</option></select></label></div><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveFix" data-id="'+id+'">Speichern</button></div>');return;
  case 'saveFix':{const t=$('#f-ftitle').value.trim(),am=parseDE($('#f-famt').value);if(!t||isNaN(am)){toast('Bitte Bezeichnung und Betrag eingeben.');return}S.fixcosts=S.fixcosts||[];S.fixcosts.push({id:uid(),propertyId:id,title:t,amount:am,perYear:+$('#f-fper').value});closeModal();go();return}
  case 'delFix':S.fixcosts=S.fixcosts.filter(x=>x.id!==id);go();return;
  case 'addDev':modal('<h3>Gerät</h3><div class="grid2"><label>Gerät<input id="f-dname" placeholder="z. B. Klimaanlage"></label><label>Gekauft (Jahr)<input id="f-dyear"></label></div><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveDev" data-id="'+id+'">Speichern</button></div>');return;
  case 'saveDev':{const n=$('#f-dname').value.trim();if(!n){toast('Bitte das Gerät eingeben.');return}S.devices=S.devices||[];S.devices.push({id:uid(),unitId:id,name:n,year:$('#f-dyear').value.trim()});closeModal();go();return}
  case 'delDev':S.devices=S.devices.filter(x=>x.id!==id);go();return;
  case 'per':ui.per=b.dataset.v;saveUi();render();return;
  case 'hide':ui.hide=!ui.hide;saveUi();render();toast(ui.hide?'Beträge versteckt':'Beträge sichtbar');return;
  case 'payee':payeeOpen(b.dataset.n,b.dataset.d);return;
  case 'payeeStep':payeeStep(+b.dataset.v);return;
  case 'payeeMode':payeeMode(b.dataset.v);return;
  case 'catList':{const pk=b.dataset.p,c=b.dataset.c;if(!pk)return;LIST_PK=pk;listDlg(c,(pk.startsWith('mp:')?'Privat · ':'')+periodLabel(pk),periodTx(pk).filter(t=>t.type==='expense'&&(t.category||'Ohne Kategorie')===c),false);return}
  case 'perList':{const pk=b.dataset.p,inc=b.dataset.k==='inc';LIST_PK=pk;listDlg(inc?'Einnahmen':'Ausgaben',periodLabel(pk),periodTx(pk).filter(t=>inc?isInc(t):t.type==='expense'),true);return}
  case 'tipsSave':saveTips();return;
  case 'wishPlan':wishPlanDlg();return;
  case 'wishRate':wishRateDlg();return;
  case 'wishInc':{S.wishInc=S.wishInc||{};S.wishInc[b.dataset.k]=b.dataset.v==='1';save();render();if(b.dataset.back==='src')wishSrcDlg(b.dataset.k);else wishRateDlg();return}
  case 'wishSrc':wishSrcDlg(b.dataset.k);return;
  case 'wishRateSave':{const v=$('#f-wr').value.trim();S.settings=S.settings||{};if(v==='')delete S.settings.saveRate;else{const n=parseDE(v);if(isNaN(n)){toast('Bitte einen gültigen Betrag eingeben.');return}S.settings.saveRate=n}save();render();wishPlanDlg();return}
  case 'wishAdd':wishDlg();return;case 'wishEdit':wishDlg(id);return;
  case 'wishMode':S.settings=S.settings||{};S.settings.saveMode=b.dataset.v;save();render();wishPlanDlg();return;
  case 'wishKeep':{S.wishKeep=S.wishKeep||[];const c=b.dataset.c,i=S.wishKeep.indexOf(c);if(i>=0)S.wishKeep.splice(i,1);else S.wishKeep.push(c);save();render();wishPlanDlg();return}
  case 'wishSave':{const t=$('#f-wt').value.trim(),p=parseDE($('#f-wp').value),sv=$('#f-ws').value.trim()===''?0:parseDE($('#f-ws').value);if(!t){toast('Bitte eingeben, was du kaufen möchtest.');return}if(isNaN(p)||p<=0||isNaN(sv)||sv<0){toast('Bitte einen gültigen Betrag eingeben.');return}
    S.wishes=S.wishes||[];if(id)Object.assign(S.wishes.find(x=>x.id===id),{title:t,price:p,saved:sv});else S.wishes.push({id:uid(),title:t,price:p,saved:sv});save();render();wishPlanDlg();return}
  case 'wishDel':S.wishes=(S.wishes||[]).filter(x=>x.id!==id);save();render();wishPlanDlg();return;
  case 'wishDone':{const w=(S.wishes||[]).find(x=>x.id===id);if(w){w.done=true;save();render();wishPlanDlg();toast('Glückwunsch! Wunsch erfüllt.')}return}
  case 'tipsCash':cashTips();return;
  case 'toggleRepaid':ui.showRepaid=!ui.showRepaid;saveUi();render();return;
  case 'loanList':loanDlg(b.dataset.k);return;
  case 'lendAdd':lendDlg('lend');return;case 'lendMore':lendDlg('lend',b.dataset.k);return;case 'lendBack':lendDlg('back',b.dataset.k);return;
  case 'lendSave':{const p=$('#f-lp').value.trim(),am=parseDE($('#f-la').value);if(!p){toast('Bitte einen Namen eingeben.');return}if(isNaN(am)||am<=0){toast('Bitte einen gültigen Betrag eingeben.');return}
    S.txs.push({id:uid(),date:$('#f-ld').value||todayISO(),amount:b.dataset.v==='back'?Math.abs(am):-Math.abs(am),name:p,person:p,purpose:$('#f-ln').value.trim(),iban:'',type:'loan',category:'',propertyId:'',unitId:'',forMonth:'',src:'manual'});save();render();loanDlg(nrm(p));toast('Gespeichert.');return}
  case 'lendDel':S.txs=S.txs.filter(t=>t.id!==id);save();render();loanDlg(b.dataset.k);return;
  case 'creditAdd':creditDlg();return;case 'creditEdit':creditDlg(id);return;case 'credit':creditDetail(id);return;
  case 'creditTx':{const c=creditOf(id);if(c)listDlg('Raten '+c.name,'',creditCalc(c).L,false);return}
  case 'creditSave':{const g=x=>{const s=$(x).value.trim();return s===''?'':parseDE(s)};const name=$('#f-cn').value.trim(),bal=g('#f-cbal'),rate=g('#f-cr'),pay=g('#f-cp'),pr=g('#f-cpr');
    if(!name){toast('Bitte eine Bezeichnung eingeben.');return}if(bal===''||isNaN(bal)||bal<0){toast('Bitte die Restschuld eingeben.');return}if(rate===''||isNaN(rate)||rate<0||rate>30){toast('Bitte einen gültigen Zinssatz eingeben.');return}if(pay===''||isNaN(pay)||pay<=0){toast('Bitte die Monatsrate eingeben.');return}if(pr!==''&&isNaN(pr)){toast('Ursprüngliche Summe ist keine gültige Zahl.');return}
    const v={name,bank:$('#f-cb').value.trim(),balance:bal,balanceDate:$('#f-cbd').value||todayISO(),rate,payment:pay,principal:pr,fixedUntil:$('#f-cfu').value||'',propertyId:$('#f-cprop')?$('#f-cprop').value:(id?creditOf(id).propertyId||'':''),keyword:$('#f-ckw').value.trim()};
    S.credits=S.credits||[];S.settings=S.settings||{};S.settings.credit=true;let cid=id;if(id)Object.assign(creditOf(id),v);else{cid=uid();S.credits.push(Object.assign({id:cid},v))}save();render();creditDetail(cid);return}
  case 'creditDel':{if(!confirm(tr('Diesen Kredit löschen?')))return;S.credits=(S.credits||[]).filter(c=>c.id!==id);S.txs.forEach(t=>{if(t.creditId===id)t.creditId=''});closeModal();go();return}
  case 'creditExtra':{const c=creditOf(id),e=parseDE($('#f-cx').value);if(!c||isNaN(e)||e<=0){toast('Bitte einen Betrag eingeben.');return}const x=creditCalc(c),nb=Math.max(0,x.bal-e),q=creditProj(nb,x.r,x.pay);
    $('#cxout').innerHTML='<div class="kvs"><div class="kv"><span>Zinsen gespart</span><b class="num pos">'+eur(Math.round(x.ti-q.ti))+'</b></div><div class="kv"><span>Früher fertig</span><b class="num pos">'+(x.months-q.months)+(x.months-q.months===1?' Monat':' Monate')+'</b></div><div class="kv"><span>Neu abbezahlt</span><b class="num">'+(q.months?monthLabel(addMonth(monthOf(todayISO()),q.months)):'sofort')+'</b></div></div><p class="hint">Gerechnet mit gleicher Rate. Prüfe im Kreditvertrag, ob und wie viel Sondertilgung erlaubt ist und ob die Bank dafür eine Gebühr verlangt.</p>';return}
  case 'creditAsk':S.settings=S.settings||{};S.settings.credit=b.dataset.v==='1';closeModal();go();if(b.dataset.v==='1')toast('Kredite findest du unter Konten.');return;
  case 'toggleCredit':S.settings=S.settings||{};S.settings.credit=!creditOn();go();toast(creditOn()?'Kredite sind eingeschaltet. Du findest sie unter Konten.':'Kredite sind ausgeblendet. Deine Daten bleiben gespeichert.');return;
  case 'meter':meterDlg(id);return;
  case 'addMeterDev':meterDevDlg();return;case 'editMeterDev':meterDevDlg(id);return;
  case 'saveMeterDev':{S.meterDevs=S.meterDevs||[];const v={propertyId:$('#f-zp').value,kind:$('#f-zk').value,number:$('#f-zn').value.trim(),place:$('#f-zo').value.trim(),omm:$('#f-zomm').value.trim(),account:$('#f-zacc').value.trim(),code:$('#f-zcode').value.trim(),note:$('#f-znote').value.trim()};
    if(id)Object.assign(S.meterDevs.find(x=>x.id===id),v);else{const m=Object.assign({id:uid(),readings:[]},v);const fv=$('#f-zv').value.trim();if(fv)m.readings.push({date:$('#f-zd').value||todayISO(),value:fv});S.meterDevs.push(m)}closeModal();go();return}
  case 'delMeterDev':ask('Zähler mit allen Ständen löschen?','Löschen',()=>{S.meterDevs=S.meterDevs.filter(x=>x.id!==id);go()});return;
  case 'addReading':{const v=$('#f-rv').value.trim();if(!v){toast('Bitte einen Stand eingeben.');return}const m=S.meterDevs.find(x=>x.id===id),d=$('#f-rd').value||todayISO();m.readings=(m.readings||[]).filter(r=>r.date!==d);m.readings.push({date:d,value:v});save();render();meterDlg(id);toast('Stand gespeichert.');return}
  case 'delReading':{const m=S.meterDevs.find(x=>x.id===id);m.readings=m.readings.filter(r=>r.date!==b.dataset.d);save();render();meterDlg(id);return}
  case 'reassignOpen':{let n=0;S.txs.forEach(t=>{if(t.type==='open'&&autoAssign2(t))n++});go();toast(n+' Umsätze zugeordnet.');return}
  case 'remAll':modal('<div class="mhead"><div><h3>Demnächst</h3></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div><div class="rems">'+remindItems().map(remRow).join('')+'</div>');return;
  case 'remGo':{const v=b.dataset.v;closeModal();if(v.startsWith('bill:')){location.hash='#mehr/bills';return}if(v==='immo'){ui.immo='miete';saveUi();location.hash='#immo'}else if(v.startsWith('plan:')){ui.immo='plan';saveUi();location.hash='#immo';render();planDlg(v.slice(5))}else if(v.startsWith('cl:'))clDlg(v.slice(3));return}
  case 'remDone':{const r=(S.reminders||[]).find(x=>x.id===id);if(!r)return;if(r.repeat==='yearly')r.date=(+r.date.slice(0,4)+1)+r.date.slice(4);else if(r.repeat==='monthly')r.date=addMonth(r.date.slice(0,7),1)+'-'+r.date.slice(8);else S.reminders=S.reminders.filter(x=>x.id!==id);closeModal();go();toast(r.repeat&&r.repeat!=='none'?'Erledigt. Nächster Termin: '+dfmt(r.date):'Erledigt.');return}
  case 'addRem':remDlg();return;
  case 'saveRem':{const t=$('#f-rt').value.trim();if(!t){toast('Bitte eingeben, woran erinnert werden soll.');return}S.reminders=S.reminders||[];const v={title:t,date:$('#f-rdt').value||todayISO(),repeat:$('#f-rrep').value,lead:parseInt($('#f-rlead').value,10)||30};const ex=id&&S.reminders.find(x=>x.id===id);if(ex)Object.assign(ex,v);else S.reminders.push(Object.assign({id:uid()},v));closeModal();go();return}
  case 'delRem':S.reminders=(S.reminders||[]).filter(x=>x.id!==id);closeModal();go();return;
  case 'toggleImmo':S.settings=S.settings||{};S.settings.immo=!immoOn();go();toast(immoOn()?'Immobilien sind eingeschaltet.':'Immobilien sind ausgeblendet. Deine Daten bleiben gespeichert.');return;
  case 'immoAsk':S.settings=S.settings||{};S.settings.immo=b.dataset.v==='1';closeModal();go();setTimeout(creditAsk,500);return;
  case 'dupFind':dupDlg();return;
  case 'dupDel':S.txs=S.txs.filter(t=>t.id!==id);save();render();dupDlg();return;
  case 'dupKeep':S.dupOk=S.dupOk||[];S.dupOk.push(b.dataset.k);save();render();dupDlg();return;
  case 'taxDlg':taxDlg();return;
  case 'taxPreset':{const v=b.dataset.v==='de'?[100,30]:[70,12];$('#f-tb').value=v[0];$('#f-tr').value=v[1];return}
  case 'taxSave':{const bs=parseDE($('#f-tb').value),rt=parseDE($('#f-tr').value);if(isNaN(bs)||isNaN(rt)||bs<0||bs>100||rt<0||rt>60){toast('Bitte gültige Prozentwerte eingeben.');return}S.taxRate={base:bs/100,rate:rt/100};closeModal();go();return}
  case 'editNote':noteDlg(id);return;
  case 'saveNote':{const t=$('#f-nt').value.trim(),x=$('#f-nx').value;if(!t){toast('Bitte einen Titel eingeben.');return}S.notes=S.notes||[];if(id)Object.assign(S.notes.find(n=>n.id===id),{title:t,text:x});else S.notes.push({id:uid(),title:t,text:x});closeModal();go();return}
  case 'delNote':S.notes=(S.notes||[]).filter(n=>n.id!==id);closeModal();go();return;
  case 'docAdd':docPick(id);return;case 'docSave':docSave();return;case 'docOpen':docOpen(id);return;case 'docDel':docDel(id);return;
  case 'delLearn':if(S.learn)delete S.learn[b.dataset.k];go();return;
  case 'toggleRemind':S.settings=S.settings||{};S.settings.remind=S.settings.remind===false;go();return;
  case 'checklist':clDlg(id);return;
  case 'clKind':clDlg(id,b.dataset.v);return;
  case 'clReset':{const u=unitOf(id);u.cl=null;save();render();clDlg(id);return}
  case 'pickReceipt':{const f=$('#f-receipt');f.value='';f.click();return}
  case 'recCancel':rec=null;closeModal();return;
  case 'recAttach':{const t=S.txs.find(x=>x.id===id);if(t&&rec){if(!rec.assetId){toast('Das Foto wird noch gespeichert, bitte kurz warten.');return}t.receipt=rec.assetId;if(!t.category&&t.type==='expense')t.category=$('#f-bcat').value}rec=null;closeModal();go();toast('Beleg angehängt.');return}
  case 'recSave':{const amt=parseDE($('#f-bamt').value);if(isNaN(amt)||!amt){toast('Bitte den Betrag eintragen.');return}const ven=$('#f-bven').value.trim(),u=$('#f-bunit').value;let pid=$('#f-bprop').value;if(u&&!pid)pid=(unitOf(u)||{}).propertyId||'';
    S.txs.push({id:uid(),date:$('#f-bdate').value||todayISO(),amount:-Math.abs(amt),name:ven||'Beleg',purpose:[$('#f-bdesc').value.trim(),u?unitLabel(unitOf(u)):''].filter(Boolean).join(' · '),iban:'',type:'expense',category:$('#f-bcat').value,propertyId:pid,unitId:'',forMonth:'',src:'receipt',receipt:rec&&rec.assetId||''});
    rec=null;closeModal();go();toast('Ausgabe mit Beleg gespeichert.');return}
  case 'receiptView':receiptView(id);return;
  case 'report':modal('<h3>Jahresbericht</h3><p class="hint">Mieten, Ausgaben und Ergebnis pro Objekt, weitere Einnahmen, private Ausgaben und Kontostände. Die Datei öffnest du im Browser und speicherst sie über „Drucken“ als PDF.</p><label>Jahr<select id="f-ry">'+[...new Set(S.txs.map(t=>t.date.slice(0,4)))].sort().reverse().map(y=>'<option'+sel(+y===+todayISO().slice(0,4))+'>'+y+'</option>').join('')+'</select></label><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveReport">Bericht speichern</button></div>');return;
  case 'saveReport':saveReport();return;
  case 'unlock':unlock();return;
  case 'saveOwner':S.settings.owner=$('#f-owner').value.trim();go();toast('Gespeichert.');return;
  case 'toggleLock':{(async()=>{if(S.settings.lock){S.settings.lock='';go();toast('Sperre ausgeschaltet.');return}if(!await lockAvailable()){toast('Dein Gerät bietet keinen Fingerabdruck für Web-Apps an.');return}try{await lockEnable();render();toast('Sperre eingeschaltet.')}catch(e){toast('Einrichten abgebrochen.')}})();return}
  case 'doImport':doImport();return;
  case 'addCat':{const v=$('#f-cat').value.trim();if(v&&!S.cats.includes(v)){S.cats.push(v);go()}return}
  case 'delCat':{const c=S.cats[i];ask('Kategorie „'+c+'“ entfernen?','Entfernen',()=>{S.cats.splice(i,1);go()});return}
  case 'addRule':{const k=$('#f-rkw').value.trim();if(!k){toast('Bitte ein Stichwort eingeben.');return}S.rules.push({keyword:k,category:$('#f-rcat').value,propertyId:$('#f-rprop').value});let n=0;S.txs.forEach(t=>{if(t.type==='open'&&autoAssign2(t))n++});go();if(n)toast(n+' offene Umsätze zugeordnet.');return}
  case 'delRule':S.rules.splice(i,1);go();return;
  case 'copyBackup':{(async()=>{let rc={};try{rc=await idbAll(RC)}catch(e){}dlBlob(new Blob([JSON.stringify({app:'DJ Capital',date:todayISO(),state:S,receipts:rc})],{type:'application/json'}),'DJ-Capital-Backup-'+todayISO()+'.json');S.settings=S.settings||{};S.settings.lastBackup=todayISO();save();render();toast('Backup gespeichert. Hebe die Datei gut auf.')})();return}
  case 'restoreDlg':modal('<h3>Backup einspielen</h3><p class="hint">Das ersetzt alle jetzigen Daten. Wähle eine Backup-Datei oder füge den Backup-Text aus der alten Version ein.</p><input type="file" id="f-bkfile" accept=".json,application/json,text/plain"><textarea class="big" id="f-bk" placeholder="Oder Backup-Text hier einfügen"></textarea><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="restoreOk">Wiederherstellen</button></div>');return;
  case 'restoreOk':{(async()=>{try{const f=$('#f-bkfile').files[0];const txt=f?await f.text():$('#f-bk').value;let x=JSON.parse(txt);let rc=null;if(x&&x.state&&x.app){rc=x.receipts;x=x.state}if(!x||!Array.isArray(x.props))throw 0;S=migrate(x);S.settings=S.settings||{remind:true};if(rc)for(const k of Object.keys(rc))await idbSet(RC,k,rc[k]);await doSave();closeModal();render();toast('Backup eingespielt.')}catch(err){toast('Das ist kein gültiges Backup.')}})();return}
  }
});
document.addEventListener('change',e=>{if(e.target&&e.target.id==='f-lang'){setLang(e.target.value);return}
  const t=e.target;
  if(t.id==='f-file'){if(t.files&&t.files[0])handleFile(t.files[0]);return}
  if(t.id==='f-receipt'){if(t.files&&t.files[0])handleReceipt(t.files[0]);return}
  if(t.dataset.xr){const tx=S.txs.find(x=>x.id===t.dataset.xr);if(tx){if(t.checked)delete tx.xr;else tx.xr=true;save();render();wishSrcDlg(t.dataset.k,true)}return}
  if(t.dataset.cl){const u=unitOf(t.dataset.id),k=t.dataset.k;if(!u.cl||u.cl.kind!==k)u.cl={kind:k,started:todayISO(),done:{}};if(t.checked)u.cl.done[t.dataset.cl]=todayISO();else delete u.cl.done[t.dataset.cl];save();clDlg(u.id,k);return}
  if(t.dataset.imp){const k=t.dataset.imp;if(k==='name')imp.map.names=[...document.querySelectorAll('[data-imp=name]')].filter(x=>x.checked).map(x=>+x.value);else imp.map[k]=+t.value;$('#imppv').innerHTML=impPreview();return}
  if(t.dataset.tx){const tx=S.txs.find(x=>x.id===t.dataset.tx);if(!tx)return;
    if(t.dataset.f==='assign'){const v=t.value;tx.unitId='';tx.forMonth='';tx.creditId='';if(!v.startsWith('exp:'))tx.propertyId='';tx.category='';
      if(v.startsWith('cr:')){const c=creditOf(v.slice(3));tx.type='expense';tx.category='Kredit & Zinsen';tx.creditId=c?c.id:'';tx.propertyId=(c&&c.propertyId)||''}else
      if(v.startsWith('rent:')){tx.type='rent';tx.unitId=v.slice(5);tx.forMonth=monthOf(tx.date);dedupeExcel(tx)}else if(v.startsWith('exp:')){tx.type='expense';tx.category=v.slice(4)}else if(v.startsWith('inc:')){tx.type='income';tx.category=v.slice(4)}else{tx.type=v;if(v==='loan'&&!tx.person)tx.person=(tx.name||'').replace(/^PayPal: /,'')}
      const more=learnFrom(tx);if(more)toast('Gemerkt. '+more+(more===1?' weiterer offener Umsatz':' weitere offene Umsätze')+' von diesem Empfänger wurde'+(more===1?'':'n')+' gleich mit zugeordnet.');
      save();if(ui.filter==='open'&&tx.type!=='open'){t.closest('.tx').classList.add('done');setTimeout(render,450)}else if(more)render();else $('#txlist').innerHTML=txList();return}
    const old=tx[t.dataset.f];tx[t.dataset.f]=t.value;
    if(t.dataset.f==='propertyId'&&tx.type==='expense'){const k=learnKey(tx);if(k){S.learn=S.learn||{};const v={t:'expense',c:tx.category||''};if(tx.propertyId)v.p=tx.propertyId;S.learn[k]=v;
      S.txs.forEach(o=>{if(o!==tx&&o.type==='expense'&&(o.category||'')===(tx.category||'')&&(o.propertyId||'')===(old||'')&&learnKey(o)===k)o.propertyId=tx.propertyId})}}
    save()}
});
document.addEventListener('input',e=>{if(e.target.id==='txq'){ui.q=e.target.value;ui.limit=100;saveUi();$('#txlist').innerHTML=txList()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#modal').hidden)closeModal()});
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0)});
let S0=null;(async()=>{S=await loadState();applyLang();mig11();S.txs.forEach(t=>{if(t.type==='open')autoAssign2(t)});if(needAuth())showAuth('login');else if(S.settings.lock&&!recentUnlock())showLock();else{render();runGo()}try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}})();
try{const y=+sessionStorage.getItem('scrollY');if(y)window.scrollTo(0,y);sessionStorage.removeItem('scrollY')}catch(e){}

/* ---------- Sprachen: [Deutsch, English, Hrvatski] ---------- */
const I18N=[
['Übersicht','Overview','Pregled'],['Ausgaben','Expenses','Troškovi'],['Immobilien','Properties','Nekretnine'],['Konten','Accounts','Računi'],['Mehr','More','Više'],
['Bereiche','Sections','Odjeljci'],['by DJ Capital','by DJ Capital','by DJ Capital'],
['Kontoauszug hochladen','Upload bank statement','Učitaj izvadak'],['PDF oder CSV aus dem Online-Banking','PDF or CSV from online banking','PDF ili CSV iz internetskog bankarstva'],
['Beleg fotografieren','Photograph receipt','Fotografiraj račun'],['Foto speichern und Ausgabe eintragen','Save photo and enter expense','Spremi fotografiju i unesi trošak'],['Betrag und Datum werden automatisch erkannt','Amount and date are recognised automatically','Iznos i datum prepoznaju se automatski'],
['{n} Umsätze warten auf Zuordnung','{n} transactions waiting to be assigned','{n} transakcija čeka na razvrstavanje'],
['Gesamtvermögen','Total assets','Ukupna imovina'],['{n} seit Jahresbeginn','{n} since start of year','{n} od početka godine'],['Verlauf des Vermögens','Asset history','Kretanje imovine'],['heute','today','danas'],
['Dein Stand · letzte {n} Monate','Your status · last {n} months','Tvoje stanje · zadnja {n} mjeseca'],['Läuft gut','Going well','Ide dobro'],['Knapp','Tight','Tijesno'],['Achtung','Warning','Pažnja'],['Noch zu wenig Daten','Not enough data yet','Još premalo podataka'],
['Lade Kontoauszüge der letzten Monate hoch, dann zeigt die Ampel deinen Stand.','Upload statements from recent months and the traffic light will show your status.','Učitaj izvatke zadnjih mjeseci, onda semafor pokazuje tvoje stanje.'],
['Du gibst im Schnitt {n} deiner Einnahmen aus. Es bleiben etwa {n} im Monat übrig.','On average you spend {n} of your income. About {n} per month is left over.','U prosjeku trošiš {n} svojih primitaka. Ostaje oko {n} mjesečno.'],
['Es bleiben nur etwa {n} im Monat übrig ({n} der Einnahmen). Grün gibt es ab {n}.','Only about {n} per month is left over ({n} of income). Green starts at {n}.','Ostaje samo oko {n} mjesečno ({n} primitaka). Zeleno je od {n}.'],
['Du gibst im Schnitt {n} mehr aus, als reinkommt.','On average you spend {n} more than comes in.','U prosjeku trošiš {n} više nego što dolazi.'],
['Wo kann ich sparen?','Where can I save?','Gdje mogu uštedjeti?'],['Was tun mit dem Geld?','What to do with the money?','Što s novcem?'],
['Demnächst','Coming up','Uskoro'],['Alle ({n})','All ({n})','Sve ({n})'],['Öffnen','Open','Otvori'],['Erledigt','Done','Gotovo'],
['Monat','Month','Mjesec'],['Jahr','Year','Godina'],['Vorheriger Monat','Previous month','Prethodni mjesec'],['Nächster Monat','Next month','Sljedeći mjesec'],['Vorjahr','Previous year','Prethodna godina'],['Nächstes Jahr','Next year','Sljedeća godina'],
['Einnahmen','Income','Primici'],['Einnahmen ›','Income ›','Primici ›'],['Ausgaben ›','Expenses ›','Troškovi ›'],['Übrig','Left over','Preostalo'],
['Wofür ging das Geld?','Where did the money go?','Kamo je otišao novac?'],['Alle ›','All ›','Sve ›'],['Auffällig in {m}','Unusual in {m}','Neuobičajeno u {m}'],['Neu diesen Monat','New this month','Novo ovaj mjesec'],
['{n} mehr als im Schnitt der letzten {n} Monate ({n})','{n} more than the average of the last {n} months ({n})','{n} više od prosjeka zadnja {n} mjeseca ({n})'],
['In diesem Monat gibt es noch keine Ausgaben. Lade einen Kontoauszug hoch.','No expenses this month yet. Upload a bank statement.','Ovaj mjesec još nema troškova. Učitaj izvadak.'],
['In diesem Jahr gibt es noch keine Ausgaben. Lade einen Kontoauszug hoch.','No expenses this year yet. Upload a bank statement.','Ove godine još nema troškova. Učitaj izvadak.'],
['Privat','Private','Privatno'],['Privat nach Kategorie','Private by category','Privatno po kategoriji'],['Keine privaten Ausgaben in diesem Monat.','No private expenses this month.','Ovaj mjesec nema privatnih troškova.'],['Ausgaben für Immobilien','Property expenses','Troškovi nekretnina'],['{n} Buchungen','{n} transactions','{n} transakcija'],
['Monate','Months','Mjeseci'],['Alle Ausgaben nach Kategorie','All expenses by category','Svi troškovi po kategoriji'],
['Umsätze','Transactions','Transakcije'],['Hochladen','Upload','Učitaj'],['Offen','Open','Otvoreno'],['Alle','All','Sve'],['Suchen','Search','Traži'],['Automatisch zuordnen','Assign automatically','Razvrstaj automatski'],
['Alles zugeordnet.','Everything assigned.','Sve je razvrstano.'],['Keine Umsätze gefunden.','No transactions found.','Nema pronađenih transakcija.'],['Mehr anzeigen ({n})','Show more ({n})','Prikaži više ({n})'],
['Zuordnung','Assignment','Razvrstavanje'],['Nicht zugeordnet','Not assigned','Nije razvrstano'],['Miete von','Rent from','Najamnina od'],['Einnahme','Income','Primitak'],['Ausgabe','Expense','Trošak'],['Ausgabe (Rückbuchung)','Expense (refund)','Trošak (povrat)'],
['Geld verliehen / zurückbekommen','Money lent / paid back','Posuđeno / vraćeno'],['Umbuchung / ignorieren','Transfer / ignore','Prijenos / zanemari'],['Wofür','For what','Za što'],
['Miete','Rent','Najam'],['Zähler','Meters','Brojila'],['Modernisierung','Modernisation','Modernizacija'],['Rücklagen','Reserves','Pričuva'],['Infos','Info','Info'],
['+ Einheit','+ Unit','+ Jedinica'],['+ Objekt','+ Property','+ Objekt'],['+ Konto','+ Account','+ Račun'],['+ Maßnahme','+ Measure','+ Mjera'],['+ Zähler','+ Meter','+ Brojilo'],['+ Fixkosten','+ Fixed cost','+ Fiksni trošak'],['+ Gerät','+ Appliance','+ Uređaj'],['+ Erinnerung','+ Reminder','+ Podsjetnik'],['+ Ausgabe','+ Expense','+ Trošak'],['+ Einnahme','+ Income','+ Primitak'],
['Miete eingegangen','Rent received','Primljena najamnina'],['von {n}','of {n}','od {n}'],['Noch offen: {n}','Still open: {n}','Još otvoreno: {n}'],['Alle Mieten sind da','All rents received','Sve najamnine su stigle'],['Keine Miete fällig','No rent due','Nema dospjele najamnine'],
['Bezahlt','Paid','Plaćeno'],['Überfällig','Overdue','Kasni'],['Teilweise','Partial','Djelomično'],['Mehr bezahlt','Overpaid','Preplaćeno'],['Keine Miete','No rent','Bez najma'],['Leer','Vacant','Prazno'],
['Ergebnis {n}','Result {n}','Rezultat {n}'],['Miete {n} · Ausgaben {n}','Rent {n} · Expenses {n}','Najam {n} · Troškovi {n}'],['Keine Ausgaben.','No expenses.','Nema troškova.'],['Objekte','Properties','Objekti'],
['Kein Mieter','No tenant','Nema najmoprimca'],['Miete / Monat','Rent / month','Najam / mjesec'],['Fällig am','Due on','Dospijeće'],['{n}. des Monats','day {n} of the month','{n}. u mjesecu'],['Kaution','Deposit','Polog'],['Vertrag bis','Contract until','Ugovor do'],['Kündigung spätestens','Notice by','Otkaz najkasnije do'],['IBAN','IBAN','IBAN'],
['bezahlt','paid','plaćeno'],['teilweise','partial','djelomično'],['überfällig','overdue','kasni'],['nicht vermietet','not rented','nije iznajmljeno'],
['Löschen','Delete','Obriši'],['Bearbeiten','Edit','Uredi'],['Speichern','Save','Spremi'],['Abbrechen','Cancel','Odustani'],['Schließen','Close','Zatvori'],['Fertig','Done','Gotovo'],['Entfernen','Remove','Ukloni'],['Hinzufügen','Add','Dodaj'],['Übernehmen','Import','Preuzmi'],['Umbenennen','Rename','Preimenuj'],['Bitte bestätigen','Please confirm','Molim potvrdi'],
['Mieterwechsel-Checkliste ›','Tenant change checklist ›','Popis za promjenu najmoprimca ›'],['Auszug','Move-out','Iseljenje'],['Einzug','Move-in','Useljenje'],['{n} von {n} erledigt','{n} of {n} done','{n} od {n} gotovo'],['Liste zurücksetzen','Reset list','Resetiraj popis'],
['Kündigung erhalten und schriftlich bestätigt','Notice received and confirmed in writing','Otkaz primljen i pisano potvrđen'],['Übergabetermin mit dem Mieter vereinbart','Handover date agreed with tenant','Dogovoren termin primopredaje'],['Zählerstände Wasser und Strom am Auszugstag abgelesen und in der App eingetragen','Water and electricity readings taken on move-out day and entered in the app','Očitana brojila vode i struje na dan iseljenja i unesena u aplikaciju'],['Wohnung geprüft, Schäden mit Fotos dokumentiert','Flat inspected, damage documented with photos','Stan pregledan, oštećenja dokumentirana fotografijama'],['Schlüssel zurück, Smart-Lock-Codes geändert','Keys returned, smart lock codes changed','Ključevi vraćeni, kodovi pametne brave promijenjeni'],['Kaution abgerechnet und zurückgezahlt','Deposit settled and returned','Polog obračunat i vraćen'],['Raskid ugovora in ePorezna gemeldet (Zahtjevi → RPO → Prilog)','Termination reported in ePorezna (Zahtjevi → RPO → Prilog)','Raskid ugovora prijavljen u ePoreznoj (Zahtjevi → RPO → Prilog)'],['HEP und Vodovod umgemeldet','HEP and Vodovod transferred','HEP i Vodovod prepisani'],['Mietende in der App eingetragen','End of tenancy entered in the app','Kraj najma unesen u aplikaciju'],
['Mietvertrag unterschrieben (ggf. beim Notar beglaubigt)','Lease signed (notarised if needed)','Ugovor o najmu potpisan (po potrebi ovjeren kod javnog bilježnika)'],['Kaution erhalten','Deposit received','Polog primljen'],['Erste Miete erhalten','First rent received','Prva najamnina primljena'],['Übergabeprotokoll mit Fotos gemacht','Handover report with photos done','Zapisnik o primopredaji s fotografijama napravljen'],['Zählerstände am Einzugstag abgelesen und eingetragen','Meter readings taken on move-in day and entered','Brojila očitana na dan useljenja i unesena'],['Schlüssel und Smart-Lock-Code übergeben','Keys and smart lock code handed over','Ključevi i kod pametne brave predani'],['Vertrag in ePorezna gemeldet (Zahtjevi → RPO → Ugovor o najmu)','Contract reported in ePorezna (Zahtjevi → RPO → Ugovor o najmu)','Ugovor prijavljen u ePoreznoj (Zahtjevi → RPO → Ugovor o najmu)'],['Mieter, Miete, IBAN und Vertragsende in der App eingetragen','Tenant, rent, IBAN and contract end entered in the app','Najmoprimac, najam, IBAN i kraj ugovora uneseni u aplikaciju'],
['Neue Einheit','New unit','Nova jedinica'],['Einheit bearbeiten','Edit unit','Uredi jedinicu'],['Objekt','Property','Objekt'],['Bezeichnung','Name','Naziv'],['Mieter','Tenant','Najmoprimac'],['Miete / Monat (€)','Rent / month (€)','Najam / mjesec (€)'],['Fällig am Tag','Due on day','Dospijeće na dan'],['Kaution (€)','Deposit (€)','Polog (€)'],['Kündigungsfrist (Monate)','Notice period (months)','Otkazni rok (mjeseci)'],['Miete ab','Rent from','Najam od'],['Mietende (leer = läuft)','End of tenancy (empty = ongoing)','Kraj najma (prazno = traje)'],['IBAN des Mieters','Tenant IBAN','IBAN najmoprimca'],['Suchwort im Umsatz','Keyword in transaction','Ključna riječ u transakciji'],['z. B. Nachname','e.g. surname','npr. prezime'],['Notiz','Note','Bilješka'],
['Neues Objekt','New property','Novi objekt'],['Objekt bearbeiten','Edit property','Uredi objekt'],['Name','Name','Naziv'],['Adresse','Address','Adresa'],['Land','Country','Država'],['Kroatien','Croatia','Hrvatska'],['Deutschland','Germany','Njemačka'],
['Zähler für Wasser, Strom und Gas','Meters for water, electricity and gas','Brojila za vodu, struju i plin'],['Tippe auf einen Zähler, um einen neuen Stand einzutragen.','Tap a meter to enter a new reading.','Dodirni brojilo za unos novog stanja.'],['Stand eintragen ›','Enter reading ›','Unesi stanje ›'],['Zählernummer fehlt','Meter number missing','Nedostaje broj brojila'],['noch kein Stand','no reading yet','još nema stanja'],['abgelesen {n}','read {n}','očitano {n}'],
['Wasser','Water','Voda'],['Strom','Electricity','Struja'],['Gas','Gas','Plin'],['Heizung','Heating','Grijanje'],['Neuer Zähler','New meter','Novo brojilo'],['Zähler bearbeiten','Edit meter','Uredi brojilo'],['Art','Type','Vrsta'],['Zählernummer','Meter number','Broj brojila'],['Wo / welche Einheit','Where / which unit','Gdje / koja jedinica'],['OMM (Messstelle, Strom)','OMM (metering point, electricity)','OMM (obračunsko mjerno mjesto)'],['Vertragskonto / Šifra potrošača','Contract account / Šifra potrošača','Ugovorni račun / Šifra potrošača'],['Code / Mjerno mjesto','Code / Mjerno mjesto','Šifra / Mjerno mjesto'],['Erster Stand (optional)','First reading (optional)','Prvo stanje (opcionalno)'],['Neuer Stand','New reading','Novo stanje'],['Stand speichern','Save reading','Spremi stanje'],['Zähler löschen','Delete meter','Obriši brojilo'],['Zähler mit allen Ständen löschen?','Delete meter with all readings?','Obrisati brojilo sa svim stanjima?'],
['Modernisierungsplan','Modernisation plan','Plan modernizacije'],['offen geschätzt {n}','open, estimated {n}','otvoreno, procjena {n}'],['Geplant für {n}','Planned for {n}','Planirano za {n}'],['Geplant für {n} · ca. {n}','Planned for {n} · approx. {n}','Planirano za {n} · oko {n}'],['Überfällig, geplant {n}','Overdue, planned {n}','Kasni, planirano {n}'],['Ohne Termin','No date','Bez termina'],['Keine Maßnahmen geplant.','No measures planned.','Nema planiranih mjera.'],
['Hoch','High','Visok'],['Mittel','Medium','Srednji'],['Niedrig','Low','Nizak'],['Geplant','Planned','Planirano'],['In Arbeit','In progress','U tijeku'],
['Neue Maßnahme','New measure','Nova mjera'],['Maßnahme bearbeiten','Edit measure','Uredi mjeru'],['Maßnahme','Measure','Mjera'],['Geplant für (Jahr)','Planned for (year)','Planirano za (godina)'],['Priorität','Priority','Prioritet'],['Status','Status','Status'],['Kosten geschätzt (€)','Estimated cost (€)','Procijenjeni trošak (€)'],['Kosten tatsächlich (€)','Actual cost (€)','Stvarni trošak (€)'],['Maßnahme löschen?','Delete measure?','Obrisati mjeru?'],
['Rücklage Ende {n}','Reserve end of {n}','Pričuva krajem {n}'],['Ziel erreicht','Target reached','Cilj postignut'],['Noch {n} bis zum {n}-Jahres-Puffer','{n} to go until the {n}-year buffer','Još {n} do pričuve za {n} godina'],['Einzahlung / Jahr','Contribution / year','Uplata / godina'],['pro Monat','per month','mjesečno'],['Verlauf','History','Tijek'],['Start {n} · + {n} · − Reparaturen {n}','Start {n} · + {n} · − repairs {n}','Početak {n} · + {n} · − popravci {n}'],['Reparaturen werden automatisch aus den Ausgaben für die Immobilien abgezogen.','Repairs are deducted automatically from property expenses.','Popravci se automatski oduzimaju od troškova nekretnina.'],
['Start (Jahr)','Start (year)','Početak (godina)'],['Einzahlung pro Jahr (€)','Contribution per year (€)','Uplata godišnje (€)'],['Ziel (€)','Target (€)','Cilj (€)'],['Sonderzahlung im Jahr','Extra payment in year','Izvanredna uplata u godini'],['Sonderzahlung (€)','Extra payment (€)','Izvanredna uplata (€)'],
['Kosten & Ausstattung','Costs & equipment','Troškovi i oprema'],['{n} im Jahr','{n} per year','{n} godišnje'],['/Mt.','/mo.','/mj.'],['{n} monatlich','{n} monthly','{n} mjesečno'],['{n} jährlich','{n} yearly','{n} godišnje'],['{n} {n} im Jahr','{n} {n} per year','{n} {n} godišnje'],['{n} Einträge','{n} entries','{n} unosa'],['Gerät','Appliance','Uređaj'],['Gekauft (Jahr)','Bought (year)','Kupljeno (godina)'],['z. B. Klimaanlage','e.g. air conditioner','npr. klima uređaj'],['Wie oft','How often','Koliko često'],['monatlich','monthly','mjesečno'],['vierteljährlich','quarterly','tromjesečno'],['jährlich','yearly','godišnje'],['z. B. Wasser Grundgebühr','e.g. water base fee','npr. osnovna naknada za vodu'],
['Rendite & Steuer','Yield & tax','Prinos i porez'],['aus Kaufpreis, Miete und Fixkosten','from purchase price, rent and fixed costs','iz kupovne cijene, najma i fiksnih troškova'],['Steuer gerechnet wie in der Excel: {n} auf {n} der Miete.','Tax calculated as in the Excel: {n} on {n} of rent.','Porez izračunat kao u Excelu: {n} na {n} najma.'],['Steuern & Behörden','Taxes & authorities','Porezi i uprava'],
['Guthaben gesamt','Total balance','Ukupno stanje'],['Bank und Bargeld','Bank and cash','Banka i gotovina'],['Bankkonto','Bank account','Bankovni račun'],['Bargeld','Cash','Gotovina'],['Depot','Securities account','Depo'],['Stand {n}','Balance {n}','Stanje {n}'],['Noch kein Stand','No balance yet','Još nema stanja'],
['Tippe auf ein Konto, um den aktuellen Stand einzutragen. Die App darf keine Kurse oder Kontostände aus dem Internet holen.','Tap an account to enter the current balance.','Dodirni račun za unos trenutnog stanja.'],
['Verliehenes Geld','Money lent','Posuđeni novac'],['Komplett zurückgezahlt · {n} Buchungen','Fully repaid · {n} transactions','Potpuno vraćeno · {n} transakcija'],['Schuldet dir noch · {n} Buchungen','Still owes you · {n} transactions','Još ti duguje · {n} transakcija'],['Du schuldest · {n} Buchungen','You owe · {n} transactions','Ti duguješ · {n} transakcija'],
['Neues Konto','New account','Novi račun'],['Konto bearbeiten','Edit account','Uredi račun'],['z. B. Sparkasse, Bitcoin, Bargeld','e.g. Sparkasse, cash','npr. Erste, gotovina'],['Aktueller Stand (€)','Current balance (€)','Trenutno stanje (€)'],['IBAN (damit Auszüge automatisch dem Konto zugeordnet werden)','IBAN (so statements are matched to the account automatically)','IBAN (da se izvaci automatski povežu s računom)'],['Neuer Stand (€)','New balance (€)','Novo stanje (€)'],['Datum','Date','Datum'],['Eintrag löschen','Delete entry','Obriši unos'],
['Von Hand eintragen','Enter manually','Unesi ručno'],['Für Barzahlungen oder alles, was nicht im Kontoauszug steht.','For cash payments or anything not on the statement.','Za gotovinska plaćanja ili sve što nije na izvatku.'],['Ausgabe eintragen','Enter expense','Unesi trošak'],['Einnahme eintragen','Enter income','Unesi primitak'],['Betrag (€)','Amount (€)','Iznos (€)'],['Kategorie','Category','Kategorija'],['Beschreibung','Description','Opis'],
['Profil & Sicherheit','Profile & security','Profil i sigurnost'],['Dein Name (für den Jahresbericht)','Your name (for the annual report)','Tvoje ime (za godišnji izvještaj)'],['Vor- und Nachname','First and last name','Ime i prezime'],['Name speichern','Save name','Spremi ime'],['Fingerabdruck-Sperre','Fingerprint lock','Zaključavanje otiskom'],['Aus · einschalten','Off · turn on','Isključeno · uključi'],['An · ausschalten','On · turn off','Uključeno · isključi'],
['Beim Öffnen und nach einer Minute im Hintergrund fragt die App nach Fingerabdruck oder Gesichtserkennung. Die Sperre schützt vor neugierigen Blicken, ersetzt aber nicht die Displaysperre deines Handys.','When opening and after one minute in the background, the app asks for fingerprint or face unlock. It protects against curious eyes but does not replace your phone lock.','Pri otvaranju i nakon minute u pozadini aplikacija traži otisak prsta ili prepoznavanje lica. Štiti od znatiželjnih pogleda, ali ne zamjenjuje zaključavanje mobitela.'],
['Sprache','Language','Jezik'],['Sprache · Language · Jezik','Sprache · Language · Jezik','Sprache · Language · Jezik'],['Automatisch','Automatic','Automatski'],
['Jahresbericht','Annual report','Godišnji izvještaj'],['Alle Zahlen eines Jahres als Datei, zum Ausdrucken oder für den Steuerberater.','All figures for a year as a file, for printing or your tax adviser.','Sve brojke jedne godine kao datoteka, za ispis ili poreznog savjetnika.'],['Jahresbericht erstellen','Create annual report','Izradi godišnji izvještaj'],['Bericht speichern','Save report','Spremi izvještaj'],
['Mieten, Ausgaben und Ergebnis pro Objekt, weitere Einnahmen, private Ausgaben und Kontostände. Die Datei öffnest du im Browser und speicherst sie über „Drucken“ als PDF.','Rents, expenses and result per property, other income, private expenses and balances. Open the file in your browser and save it as PDF via “Print”.','Najamnine, troškovi i rezultat po objektu, ostali primici, privatni troškovi i stanja. Datoteku otvori u pregledniku i spremi kao PDF preko „Ispis“.'],
['Erinnerungen','Reminders','Podsjetnici'],['Auf Übersicht ausblenden','Hide on overview','Sakrij na pregledu'],['Auf Übersicht zeigen','Show on overview','Prikaži na pregledu'],
['Kündigungsfristen, fehlende Mieten und geplante Modernisierungen erkennt die App selbst. Hier legst du eigene Termine an, zum Beispiel Versicherungen oder Komunalna naknada.','The app detects notice deadlines, missing rents and planned modernisations itself. Add your own dates here, e.g. insurance payments.','Otkazne rokove, nedostajuće najamnine i planirane modernizacije aplikacija prepoznaje sama. Ovdje dodaj vlastite termine, npr. osiguranje ili komunalnu naknadu.'],
['Neue Erinnerung','New reminder','Novi podsjetnik'],['Woran?','What about?','Na što?'],['Wiederholen','Repeat','Ponavljaj'],['Einmalig','Once','Jednokratno'],['Monatlich','Monthly','Mjesečno'],['Jährlich','Yearly','Godišnje'],['Vorher anzeigen (Tage)','Show in advance (days)','Prikaži unaprijed (dana)'],['Erinnerung löschen','Delete reminder','Obriši podsjetnik'],
['Automatische Regeln','Automatic rules','Automatska pravila'],['Steht das Stichwort im Umsatz, wird er beim Hochladen automatisch einsortiert.','If the keyword appears in a transaction, it is sorted automatically on upload.','Ako se ključna riječ nalazi u transakciji, automatski se razvrstava pri učitavanju.'],['Stichwort, z. B. REWE','Keyword, e.g. REWE','Ključna riječ, npr. Konzum'],['Regel hinzufügen','Add rule','Dodaj pravilo'],['Regel löschen','Delete rule','Obriši pravilo'],
['Kategorien für Ausgaben','Expense categories','Kategorije troškova'],['Neue Kategorie','New category','Nova kategorija'],
['Backup','Backup','Sigurnosna kopija'],['Backup speichern','Save backup','Spremi kopiju'],['Backup einspielen','Restore backup','Vrati kopiju'],['Die Daten liegen nur auf diesem Gerät. Speichere regelmäßig ein Backup, zum Beispiel in Google Drive.','Data is stored only on this device. Save a backup regularly, e.g. to Google Drive.','Podaci su samo na ovom uređaju. Redovito spremaj kopiju, npr. na Google Drive.'],
['Das ersetzt alle jetzigen Daten. Wähle eine Backup-Datei oder füge den Backup-Text aus der alten Version ein.','This replaces all current data. Choose a backup file or paste the backup text from the old version.','Ovo zamjenjuje sve trenutne podatke. Odaberi datoteku kopije ili zalijepi tekst kopije iz stare verzije.'],['Oder Backup-Text hier einfügen','Or paste backup text here','Ili zalijepi tekst kopije ovdje'],['Wiederherstellen','Restore','Vrati'],
['Gespeichert','Saved','Spremljeno'],['Nicht gespeichert','Not saved','Nije spremljeno'],['Fehler beim Speichern','Error saving','Greška pri spremanju'],['Beträge verstecken','Hide amounts','Sakrij iznose'],['Beträge zeigen','Show amounts','Prikaži iznose'],['Beträge versteckt','Amounts hidden','Iznosi sakriveni'],['Beträge sichtbar','Amounts visible','Iznosi vidljivi'],
['Gesperrt. Entsperre mit Fingerabdruck oder Gesichtserkennung.','Locked. Unlock with fingerprint or face.','Zaključano. Otključaj otiskom prsta ili licem.'],['Entsperren','Unlock','Otključaj'],
['Kontoauszug {s}','Statement {s}','Izvadak {s}'],['Konto','Account','Račun'],['Nicht angeben','Not specified','Nije navedeno'],['Neu','New','Novo'],['Schon vorhanden','Already there','Već postoji'],['✓ Alle Buchungen erkannt, die Summe passt zum Saldo auf dem Auszug.','✓ All transactions recognised, the total matches the statement balance.','✓ Sve transakcije prepoznate, zbroj odgovara saldu na izvatku.'],['Achtung: Die Summe passt nicht zum Saldo auf dem Auszug. Vielleicht fehlt eine Buchung.','Warning: the total does not match the statement balance. A transaction may be missing.','Pažnja: zbroj ne odgovara saldu na izvatku. Možda nedostaje transakcija.'],['Kontostand {n} vom {n} übernehmen','Use balance {n} from {n}','Preuzmi stanje {n} od {n}'],['Spalten prüfen','Check columns','Provjeri stupce'],
['Beleg','Receipt','Račun'],['Beleg ansehen','View receipt','Prikaži račun'],['Händler','Merchant','Trgovac'],['Einheit (optional)','Unit (optional)','Jedinica (opcionalno)'],['Als Ausgabe speichern','Save as expense','Spremi kao trošak'],['Passende Buchung gefunden','Matching transaction found','Pronađena odgovarajuća transakcija'],['Beleg an diese Buchung hängen','Attach receipt to this transaction','Priloži račun ovoj transakciji'],['Oder als neue Ausgabe speichern:','Or save as a new expense:','Ili spremi kao novi trošak:'],['Wird gelesen …','Reading …','Čitam …'],['Foto ist gespeichert. Bitte Betrag und Datum eintragen.','Photo saved. Please enter amount and date.','Fotografija je spremljena. Unesi iznos i datum.'],['Erkannt. Bitte prüfen und zuordnen.','Recognised. Please check and assign.','Prepoznato. Provjeri i razvrstaj.'],
['Private Ausgaben der letzten {n} Monate','Private expenses of the last {n} months','Privatni troškovi zadnja {n} mjeseca'],['Dein Cashflow ist gerade gut. Es gibt keine auffälligen Posten.','Your cash flow is good. Nothing stands out.','Tvoj novčani tok je dobar. Ništa ne odskače.'],['Dein Cashflow ist gut. Das hier sind trotzdem die Posten, bei denen sich Sparen am ehesten lohnt:','Your cash flow is good. These are still the items where saving pays off most:','Tvoj novčani tok je dobar. Ovo su ipak stavke na kojima se štednja najviše isplati:'],['Diese Posten bringen am meisten, wenn du sie reduzierst:','These items help most if you reduce them:','Ove stavke najviše pomažu ako ih smanjiš:'],['Die Hinweise rechnet die App aus deinen Buchungen. Ob eine Ausgabe sinnvoll ist, weißt nur du.','The app calculates these hints from your transactions. Only you know whether an expense makes sense.','Aplikacija računa savjete iz tvojih transakcija. Samo ti znaš ima li trošak smisla.'],
['Die Kreditkartenabrechnung zeigt nicht, wofür das Geld ausgegeben wurde. Schau in die Abrechnung, dort stecken oft Abos und Spontankäufe.','The credit card statement does not show what the money was spent on. Check it, subscriptions and impulse buys often hide there.','Izvod kreditne kartice ne pokazuje na što je novac potrošen. Pogledaj ga, tamo se često kriju pretplate i spontane kupnje.'],
['Etwa {n} über dem Notgroschen','About {n} above your emergency fund','Oko {n} iznad rezerve za nuždu'],['Der Notgroschen ist noch nicht voll','Emergency fund not yet full','Rezerva za nuždu još nije puna'],['{n}. Notgroschen','{n}. Emergency fund','{n}. Rezerva za nuždu'],['✓ {n}. Notgroschen','✓ {n}. Emergency fund','✓ {n}. Rezerva za nuždu'],
['Empfohlen sind {n} bis {n} Monatsausgaben auf dem Tagesgeld- oder Girokonto. Bei dir sind das etwa {n}. Du hast {n}.','{n} to {n} months of expenses in an instant-access or current account are recommended. For you that is about {n}. You have {n}.','Preporučuje se {n} do {n} mjesečnih troškova na štednom ili tekućem računu. Kod tebe je to oko {n}. Imaš {n}.'],
['{n}. Rücklage für die Häuser','{n}. Reserve for the properties','{n}. Pričuva za nekretnine'],['{n}. Fällige Modernisierungen','{n}. Modernisations due','{n}. Dospjele modernizacije'],['Danach: anlegen','Then: invest','Zatim: ulaganje'],
['Übliche Möglichkeiten für Geld, das du länger nicht brauchst: Tagesgeld oder Festgeld (sicher, wenig Zinsen), breit gestreute ETFs (langfristig, schwankt), Sondertilgung eines Kredits (sicherer „Zins“ in Höhe des Kreditzinses). Was zu dir passt, hängt von deinen Zielen und deinem Risiko ab.','Common options for money you will not need for a while: instant-access or fixed-term savings (safe, low interest), broadly diversified ETFs (long term, fluctuates), extra loan repayment (a safe “return” equal to the loan rate). What suits you depends on your goals and risk.','Uobičajene mogućnosti za novac koji ti dulje ne treba: štednja po viđenju ili oročena štednja (sigurno, niske kamate), široko diverzificirani ETF-ovi (dugoročno, oscilira), izvanredna otplata kredita (siguran „prinos“ u visini kamate). Što ti odgovara ovisi o ciljevima i riziku.'],
['Das ist eine Reihenfolge, wie sie in Ratgebern üblich ist, keine Anlageberatung. Für größere Beträge lohnt sich ein unabhängiger Honorarberater.','This is an order commonly found in guides, not investment advice. For larger amounts an independent fee-based adviser is worthwhile.','Ovo je redoslijed uobičajen u savjetnicima, a ne savjet o ulaganju. Za veće iznose isplati se neovisni savjetnik.'],
['Verliehenes Geld','Money lent','Posuđeni novac'],
['Speichern fehlgeschlagen. Bitte unter „Mehr“ ein Backup speichern.','Saving failed. Please save a backup under “More”.','Spremanje nije uspjelo. Spremi kopiju pod „Više“.'],['Backup gespeichert. Hebe die Datei gut auf.','Backup saved. Keep the file safe.','Kopija spremljena. Dobro čuvaj datoteku.'],['Backup eingespielt.','Backup restored.','Kopija vraćena.'],['Das ist kein gültiges Backup.','This is not a valid backup.','Ovo nije valjana kopija.'],
['Ausgabe mit Beleg gespeichert.','Expense with receipt saved.','Trošak s računom spremljen.'],['Beleg angehängt.','Receipt attached.','Račun priložen.'],['Gespeichert.','Saved.','Spremljeno.'],['Stand gespeichert.','Reading saved.','Stanje spremljeno.'],['Sperre eingeschaltet.','Lock turned on.','Zaključavanje uključeno.'],['Sperre ausgeschaltet.','Lock turned off.','Zaključavanje isključeno.'],['Einrichten abgebrochen.','Setup cancelled.','Postavljanje otkazano.'],['Entsperren abgebrochen. Bitte erneut versuchen.','Unlock cancelled. Please try again.','Otključavanje otkazano. Pokušaj ponovno.'],['Dein Gerät bietet keinen Fingerabdruck für Web-Apps an.','Your device does not offer fingerprint unlock for web apps.','Tvoj uređaj ne nudi otisak prsta za web aplikacije.'],
['Bitte einen Betrag eingeben.','Please enter an amount.','Unesi iznos.'],['Bitte den Betrag eintragen.','Please enter the amount.','Unesi iznos.'],['Bitte einen Namen eingeben.','Please enter a name.','Unesi naziv.'],['Bitte eine Bezeichnung eingeben.','Please enter a name.','Unesi naziv.'],['Bitte ein Stichwort eingeben.','Please enter a keyword.','Unesi ključnu riječ.'],['Bitte einen Stand eingeben.','Please enter a reading.','Unesi stanje.'],['Bitte das Gerät eingeben.','Please enter the appliance.','Unesi uređaj.'],['Bitte die Maßnahme eingeben.','Please enter the measure.','Unesi mjeru.'],['Bitte Bezeichnung und Betrag eingeben.','Please enter name and amount.','Unesi naziv i iznos.'],['Bitte eingeben, woran erinnert werden soll.','Please enter what to remind you of.','Unesi na što te treba podsjetiti.'],['Lege zuerst ein Objekt an.','Create a property first.','Najprije dodaj objekt.'],['Miete oder Kaution ist keine gültige Zahl.','Rent or deposit is not a valid number.','Najam ili polog nije valjani broj.'],
['PDF wird gelesen …','Reading PDF …','Čitam PDF …'],['Die PDF konnte nicht gelesen werden.','The PDF could not be read.','PDF se nije mogao pročitati.'],['In der PDF ist kein Text. Ein eingescannter Auszug oder ein Foto geht leider nicht.','The PDF contains no text. Scanned statements or photos do not work.','PDF ne sadrži tekst. Skenirani izvadak ili fotografija nažalost ne rade.'],['Diese Bank kennt die App noch nicht. Schick Claude einen Auszug, dann wird sie eingebaut.','This bank is not supported yet.','Ova banka još nije podržana.'],['In dieser PDF wurden keine Buchungen gefunden.','No transactions found in this PDF.','U ovom PDF-u nema transakcija.'],['In der Datei wurden keine Zeilen gefunden.','No rows found in the file.','U datoteci nema redaka.'],['Der PDF-Leser konnte nicht geladen werden. Prüfe die Internetverbindung.','The PDF reader could not be loaded. Check your internet connection.','PDF čitač nije učitan. Provjeri internetsku vezu.'],
['{n} neu, davon {n} automatisch zugeordnet. {n} waren schon da.','{n} new, {n} assigned automatically. {n} were already there.','{n} novih, od toga {n} automatski razvrstano. {n} je već postojalo.'],['{n} Umsätze zugeordnet.','{n} transactions assigned.','{n} transakcija razvrstano.'],['{n} offene Umsätze zugeordnet.','{n} open transactions assigned.','{n} otvorenih transakcija razvrstano.'],
['Jahresbericht gespeichert. Öffnen, dann „Drucken → Als PDF speichern“.','Annual report saved. Open it, then “Print → Save as PDF”.','Godišnji izvještaj spremljen. Otvori ga, zatim „Ispis → Spremi kao PDF“.'],['Speichern hat nicht geklappt.','Saving did not work.','Spremanje nije uspjelo.'],
['Spätestens bis {n} kündigen, sonst verlängert sich der Vertrag','Give notice by {n}, otherwise the contract renews','Otkaži najkasnije do {n}, inače se ugovor produljuje'],['Frist vorbei, Vertrag läuft bis {n}','Deadline passed, contract runs until {n}','Rok je prošao, ugovor traje do {n}'],['Läuft am {n} aus','Expires on {n}','Ističe {n}'],['Noch nicht eingegangen ({n})','Not received yet ({n})','Još nije stiglo ({n})'],['Es fehlen {n}','{n} missing','Nedostaje {n}'],['{n} von {n} Aufgaben erledigt','{n} of {n} tasks done','{n} od {n} zadataka gotovo'],['Fällig am {n}','Due on {n}','Dospijeva {n}'],['Fällig seit {n}','Due since {n}','Dospjelo od {n}'],['Heute fällig','Due today','Dospijeva danas'],
['Lebensmittel','Groceries','Namirnice'],['Wohnen & Nebenkosten','Housing & utilities','Stanovanje i režije'],['Auto & Tanken','Car & fuel','Auto i gorivo'],['Versicherung','Insurance','Osiguranje'],['Handy, Internet & Abos','Phone, internet & subscriptions','Mobitel, internet i pretplate'],['Familie & Kinder','Family & children','Obitelj i djeca'],['Freizeit & Restaurant','Leisure & restaurants','Slobodno vrijeme i restorani'],['Gesundheit','Health','Zdravlje'],['Kleidung','Clothing','Odjeća'],['Reisen','Travel','Putovanja'],['Steuern','Taxes','Porezi'],['Steuer','Tax','Porez'],['Kredit & Zinsen','Loans & interest','Krediti i kamate'],['Firma','Business','Tvrtka'],['Reparatur & Instandhaltung','Repairs & maintenance','Popravci i održavanje'],['Müllabfuhr','Waste collection','Odvoz smeća'],['Klima-Service','AC service','Servis klime'],['Sonstiges','Other','Ostalo'],['Werbung & Marketing (Firma)','Advertising & marketing (business)','Oglašavanje i marketing (tvrtka)'],['Mobilität','Mobility','Mobilnost'],['Kreditkarte','Credit card','Kreditna kartica'],['Fitness & Sport','Fitness & sport','Fitness i sport'],['Online-Shopping','Online shopping','Online kupnja'],
['Gehalt','Salary','Plaća'],['Zinsen & Dividenden','Interest & dividends','Kamate i dividende'],['Erstattung','Refund','Povrat'],['Sonstige Einnahmen','Other income','Ostali primici'],['Kindergeld','Child benefit','Dječji doplatak'],['Krankenkasse','Health insurance','Zdravstveno osiguranje'],['Steuererstattung','Tax refund','Povrat poreza'],['Ohne Kategorie','Uncategorised','Bez kategorije'],['Allgemein','General','Općenito'],
['Kühlschrank','Fridge','Hladnjak'],['Ofen','Oven','Pećnica'],['Kochfeld','Hob','Ploča za kuhanje'],['Boiler','Water heater','Bojler'],['Waschmaschine','Washing machine','Perilica rublja'],['Spülmaschine','Dishwasher','Perilica posuđa'],['Wasserpumpe','Water pump','Pumpa za vodu'],['Neue Dusche','New shower','Novi tuš'],['Smart-Lock-Schlüssel','Smart lock keys','Ključevi pametne brave'],['TV','TV','TV'],['{n} Stück','{n} pcs','{n} kom'],
['Glasfaser ans Haus anschließen','Connect the house to fibre','Spojiti kuću na optiku'],['Neue Sprechanlage (Tuya)','New intercom (Tuya)','Novi interfon (Tuya)'],['Sonnenschutzsegel über dem Hof','Shade sail over the courtyard','Jedro za sjenu iznad dvorišta'],['Lüftung (unten Eingangsbereich, Waschküche/WC oben)','Ventilation (entrance below, laundry/WC above)','Ventilacija (dolje ulaz, praonica/WC gore)'],['Rollos auf Elektro umrüsten (Tuya)','Convert blinds to electric (Tuya)','Rolete na električne (Tuya)'],
['My Capital','My Capital','My Capital']
];
const PREFIX=[['Kündigungsfrist ','Notice deadline ','Otkazni rok '],['Vertragsende ','Contract end ','Kraj ugovora '],['Mieterwechsel ','Tenant change ','Promjena najmoprimca '],['Fixkosten ','Fixed costs ','Fiksni troškovi '],['Geräte ','Appliances ','Uređaji '],['Immobilie: ','Property: ','Nekretnina: '],['Darlehen ','Loan ','Zajam '],['Miete ','Rent ','Najam '],['Auszug ','Move-out ','Iseljenje '],['Einzug ','Move-in ','Useljenje '],['Offen ','Open ','Otvoreno '],['Privat · ','Private · ','Privatno · '],['Rollos auf Elektro umrüsten (Tuya), ','Convert blinds to electric (Tuya), ','Rolete na električne (Tuya), ']];
I18N.push(['Jahresbericht {n}','Annual report {n}','Godišnji izvještaj {n}'],['Einheit','Unit','Jedinica'],['Monate bezahlt','Months paid','Plaćeni mjeseci'],['Mieteinnahmen','Rental income','Prihod od najma'],['Summe Mieten','Total rent','Ukupno najam'],['Summe Ausgaben','Total expenses','Ukupno troškovi'],['Betrag','Amount','Iznos'],['Ergebnis vor Steuer','Result before tax','Rezultat prije poreza'],['Steuer geschätzt ({n} auf {n} der Miete)','Estimated tax ({n} on {n} of rent)','Procijenjeni porez ({n} na {n} najma)'],['Immobilien gesamt: Einnahmen {n} · Ausgaben {n}','Properties total: income {n} · expenses {n}','Nekretnine ukupno: primici {n} · troškovi {n}'],['Weitere Einnahmen','Other income','Ostali primici'],['Summe','Total','Ukupno'],['Private Ausgaben nach Kategorie','Private expenses by category','Privatni troškovi po kategoriji'],['zurückgezahlt','repaid','vraćeno'],['offen {n}','open {n}','otvoreno {n}'],['Kontostände','Account balances','Stanja računa'],['Die Steuerwerte sind eine Schätzung aus der App und ersetzen keine Steuerberatung.','Tax figures are an estimate from the app and do not replace tax advice.','Porezni iznosi su procjena aplikacije i ne zamjenjuju porezno savjetovanje.'],[' (Beleg in der App)',' (receipt in app)',' (račun u aplikaciji)']);
PREFIX.push(['Auffällig in ','Unusual in ','Neuobičajeno u '],['Kontoauszug ','Statement ','Izvadak '],['Stand ','Balance ','Stanje '],['offen ','open ','otvoreno ']);
I18N.push(['Fixkosten','Fixed costs','Fiksni troškovi'],['z. B. 1. Kat, Keller','e.g. 1st floor, basement','npr. 1. kat, podrum'],['z. B. Gebäudeversicherung zahlen','e.g. pay building insurance','npr. platiti osiguranje zgrade'],
['Zusammen etwa {n} im Monat. Viele kleine Beträge fallen kaum auf. Prüfe, ob sich das lohnt.','Together about {n} per month. Many small amounts go unnoticed. Check whether it is worth it.','Ukupno oko {n} mjesečno. Mnogi mali iznosi jedva se primijete. Provjeri isplati li se.'],
['Zusammen etwa {n} im Monat. Viele kleine Beträge fallen kaum auf. Prüfe, ob sich das lohnt und ob die Werbung Kunden bringt.','Together about {n} per month. Many small amounts go unnoticed. Check whether it is worth it and whether the ads bring customers.','Ukupno oko {n} mjesečno. Mnogi mali iznosi jedva se primijete. Provjeri isplati li se i donosi li oglašavanje kupce.'],
['Etwa {n} im Monat. Brauchst du das noch, oder gibt es einen günstigeren Tarif?','About {n} per month. Do you still need it, or is there a cheaper plan?','Oko {n} mjesečno. Treba li ti to još ili postoji jeftinija tarifa?'],
['{n} deiner privaten Ausgaben, etwa {n} im Monat. Hier lohnt sich ein genauer Blick.','{n} of your private expenses, about {n} per month. Worth a closer look.','{n} tvojih privatnih troškova, oko {n} mjesečno. Vrijedi pogledati pobliže.'],
['Ziel {n} als {n}-Jahres-Puffer, geplant mit {n} im Jahr ab {n}. Ein Teil des freien Geldes kann die Rücklage schneller auffüllen.','Target {n} as a {n}-year buffer, planned with {n} per year from {n}. Part of the spare money can fill the reserve faster.','Cilj {n} kao pričuva za {n} godina, planirano {n} godišnje od {n}. Dio slobodnog novca može brže napuniti pričuvu.'],
['{n} sind noch nicht zurückgezahlt.','{n} not yet repaid.','{n} još nije vraćeno.'],
['Miete {n} · Fixkosten {n} · Steuer ca. {n} = {n} im Monat','Rent {n} · fixed costs {n} · tax approx. {n} = {n} per month','Najam {n} · fiksni troškovi {n} · porez oko {n} = {n} mjesečno'],
['Bruttorendite {n} · Nettorendite {n} · Amortisation ca. {n} Jahre','Gross yield {n} · net yield {n} · payback approx. {n} years','Bruto prinos {n} · neto prinos {n} · povrat oko {n} godina'],
['Bruttorendite {n} · Nettorendite {n}','Gross yield {n} · net yield {n}','Bruto prinos {n} · neto prinos {n}'],
['{n} Buchungen · {n}','{n} transactions · {n}','{n} transakcija · {n}'],['{n} · Miete als bezahlt markiert','{n} · Rent marked as paid','{n} · Najam označen kao plaćen'],['Miete als bezahlt markiert','Rent marked as paid','Najam označen kao plaćen'],['Verträge','Contracts','Ugovori']);
PREFIX.push(['Kauf ','Purchase ','Kupnja ']);
const RX=[[/^(.+): (\d+) kleine Zahlungen$/,(m,L)=>m[1]+': '+m[2]+(L==='en'?' small payments':' malih plaćanja')],[/^(.+): regelmäßige Zahlung$/,(m,L)=>m[1]+(L==='en'?': regular payment':': redovito plaćanje')],[/^(.+) ist dein größter Posten$/,(m,L)=>(TMAP.get(m[1])||m[1])+(L==='en'?' is your biggest item':' je tvoja najveća stavka')],
[/^(\d+) Maßnahmen bis (\d+) für etwa (.+?): (.+)\. Was den Mietwert erhöht oder Reparaturen vermeidet, zuerst\.$/,(m,L)=>L==='en'?m[1]+' measures by '+m[2]+' for about '+m[3]+': '+m[4]+'. Do whatever raises rental value or prevents repairs first.':m[1]+' mjera do '+m[2]+' za oko '+m[3]+': '+m[4]+'. Najprije ono što povećava vrijednost najma ili sprječava popravke.']];
/* ---------- Übersetzungs-Maschine ---------- */
const MONTHS_L={de:MONTHS.slice(),en:['January','February','March','April','May','June','July','August','September','October','November','December'],hr:['Siječanj','Veljača','Ožujak','Travanj','Svibanj','Lipanj','Srpanj','Kolovoz','Rujan','Listopad','Studeni','Prosinac']};
const NUMRE=/[−+\-]?\d(?:[\d.,]*\d)?(?:\s?(?:Tsd\.\s)?€)?(?:\s?%)?×?/g;
let LANG='de',TMAP=null;const TRDONE=new WeakMap();
function langPref(){try{return (S&&S.settings&&S.settings.lang)||localStorage.getItem('djc-lang')||'auto'}catch(e){return 'auto'}}
function resolveLang(p){if(p==='de'||p==='en'||p==='hr')return p;const n=((navigator.languages&&navigator.languages[0])||navigator.language||'de').slice(0,2).toLowerCase();return n==='de'?'de':['hr','bs','sr','sh','me'].includes(n)?'hr':'en'}
function applyLang(){LANG=resolveLang(langPref());MONTHS.splice(0,12,...MONTHS_L[LANG]);document.documentElement.lang=LANG;
  const i=LANG==='en'?1:2;TMAP=new Map();if(LANG!=='de')I18N.forEach(r=>{TMAP.set(r[0],r[i])})}
function fillN(t,nums){let k=0;return t.replace(/\{n\}/g,()=>{const v=nums[k++]||'';return LANG==='de'?v:v.replace('Tsd.',LANG==='en'?'k':'tis.')})}
function trCore(s){if(TMAP.has(s))return TMAP.get(s);
  const nums=[];const k=s.replace(NUMRE,m=>{nums.push(m);return '{n}'});if(nums.length&&TMAP.has(k))return fillN(TMAP.get(k),nums);
  const i=LANG==='en'?1:2;
  for(const p of PREFIX)if(s.startsWith(p[0])&&s.length>p[0].length){const r=s.slice(p[0].length);const rt=TMAP.has(r)?TMAP.get(r):r;return p[i]+rt}
  for(const [re,f] of RX){const mm=s.match(re);if(mm)return f(mm,LANG)}
  for(const sep of [' · ',': ']){if(s.includes(sep)){let ch=false;const parts=s.split(sep).map(x=>{const r=trCore(x);if(r!=null){ch=true;return r}return x});if(ch)return parts.join(sep)}}
  let m=s.match(/^Kategorie „(.+)“ entfernen\?$/);if(m){const c=TMAP.get(m[1])||m[1];return (LANG==='en'?'Remove category “'+c+'”?':'Ukloniti kategoriju „'+c+'“?')};
  m=s.match(/^(.+) entfernen$/);if(m)return (LANG==='en'?'Remove ':'Ukloni ')+(TMAP.get(m[1])||m[1]);
  if(nums.length){/* Zahlen mit Tsd. trotzdem anpassen */const t=s.replace(/Tsd\. €/g,LANG==='en'?'k €':'tis. €');if(t!==s)return t}
  return null}
function tr(s){if(LANG==='de'||!s)return s;const a=s.match(/^\s*/)[0],b=s.match(/\s*$/)[0],c=s.trim();if(!c||!/[A-Za-zÄÖÜäöüß]/.test(c))return s;const r=trCore(c);return r==null?s:a+r+b}
const TR_ATTR=['placeholder','aria-label','title'];
function trNode(root){if(LANG==='de'||!root)return;
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;const L=[];while(n=w.nextNode())L.push(n);
  L.forEach(t=>{const p=t.parentNode;if(!p||p.nodeName==='SCRIPT'||p.nodeName==='STYLE'||p.nodeName==='TEXTAREA')return;if(TRDONE.get(t)===t.nodeValue)return;const o=t.nodeValue,r=tr(o);
    if(r!==o){if(p.nodeName==='OPTION'&&!p.hasAttribute('value'))p.setAttribute('value',o.trim());t.nodeValue=r}TRDONE.set(t,t.nodeValue)});
  if(root.querySelectorAll)[root,...root.querySelectorAll('[placeholder],[aria-label],[title]')].forEach(el=>{if(!el.getAttribute)return;TR_ATTR.forEach(a=>{const v=el.getAttribute(a);if(v){const r=tr(v);if(r!==v)el.setAttribute(a,r)}})})}
function trHtml(html){if(LANG==='de')return html;const d=new DOMParser().parseFromString(html,'text/html');trNode(d.body);d.title=tr(d.title);d.documentElement.lang=LANG;return '<!DOCTYPE html>'+d.documentElement.outerHTML}
let trBusy=false;const trObs=new MutationObserver(ms=>{if(trBusy||LANG==='de')return;trBusy=true;try{ms.forEach(m=>{if(m.type==='characterData')trNode(m.target.parentNode);else trNode(m.target)})}finally{trObs.takeRecords();trBusy=false}});
function trStart(){['root','modal','toast'].forEach(id=>{const el=document.getElementById(id);if(el){trObs.observe(el,{childList:true,subtree:true,characterData:true});trNode(el)}})}
function setLang(v){S.settings=S.settings||{};S.settings.lang=v;try{localStorage.setItem('djc-lang',v)}catch(e){}save();applyLang();render();toast(tr('Gespeichert.'))}
applyLang();trStart();

/* ---------- Schnellbefehle (langes Drücken aufs App-Symbol) ---------- */
let GO=null;try{const q=new URLSearchParams(location.search);GO=q.get('go');if(GO)history.replaceState(null,'',location.pathname+location.hash)}catch(e){}
function runGo(){const g=GO;GO=null;if(!g)return;
  if(g==='miete'&&immoOn()){ui.immo='miete';saveUi();if(location.hash!=='#immo')location.hash='#immo';else render();return}
  if(location.hash&&location.hash!=='#start'){location.hash='#start'}
  setTimeout(()=>{
    if(g==='ausgabe')manualDlg('expense');
    else if(g==='upload')modal('<h3>Kontoauszug hochladen</h3><p class="hint">PDF oder CSV aus dem Online-Banking</p><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="pickFile">Datei auswählen</button></div>');
    else if(g==='beleg')modal('<h3>Beleg fotografieren</h3><p class="hint">Foto speichern und Ausgabe eintragen</p><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="pickReceipt">Kamera öffnen</button></div>');
  },80)}
I18N.push(['Datei auswählen','Choose file','Odaberi datoteku'],['Kamera öffnen','Open camera','Otvori kameru']);

/* ---------- Bankverbindung (Enable Banking über eigenen Cloudflare-Vermittler) ---------- */
const BK_CB=(()=>{try{const q=new URLSearchParams(location.search);if(q.get('code')||q.get('error')){const r={code:q.get('code'),state:q.get('state'),error:q.get('error'),desc:q.get('error_description')};history.replaceState(null,'',location.pathname+location.hash);return r}}catch(e){}return null})();
let bkBusy=false;
const bk=()=>{S.bank=S.bank||{url:'',key:'',conns:[],lastFetch:0};S.bank.conns=S.bank.conns||[];return S.bank};
const bkReady=()=>{if(loggedIn())return !!acct.bank;const b=bk();return !!(b.url&&b.key)};
const bkRedirect=()=>location.origin+location.pathname.replace(/index\.html$/,'');
async function bkApi(path,opt){const b=bk();let r;const li=loggedIn();
  try{r=await fetch((li?SRV:b.url.replace(/\/+$/,''))+path,Object.assign({},opt||{},{headers:li?{Authorization:'Bearer '+acct.token,'Content-Type':'application/json'}:{'X-DJC-Key':b.key,'Content-Type':'application/json'}}))}catch(e){throw {code:'NETWORK'}}
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok)throw {code:j.error||('HTTP_'+r.status),msg:j.message||'',status:r.status};return j}
function bkErrText(e){const c=e&&e.code;
  if(c==='NETWORK')return 'Der Vermittler ist nicht erreichbar. Prüfe die Adresse und die Internetverbindung.';
  if(c==='WRONG_KEY')return 'Der Zugangsschlüssel passt nicht zu dem bei Cloudflare.';
  if(c==='FORBIDDEN_ORIGIN')return 'Der Vermittler erlaubt diese App-Adresse nicht (ALLOWED_ORIGIN).';
  if(c==='NOT_CONFIGURED')return 'Beim Vermittler fehlen EB_APP_ID, EB_KEY oder ACCESS_KEY.';
  if(c==='NO_SESSION')return 'Bitte melde dich erneut an.';
  if(c==='BANK_NOT_ALLOWED')return 'Bankverbindung ist für dein Konto nicht freigeschaltet.';
  if(c==='EXPIRED_SESSION')return 'Die Freigabe der Bank ist abgelaufen. Bitte neu verbinden.';
  return 'Fehler von der Bank-Schnittstelle'+(c?' ('+c+')':'')+'.'}
function bkSection(){const b=bk();const T=todayISO();const LI=loggedIn();if(LI&&!acct.bank)return '<section class="group"><h3>Bankverbindung</h3><p class="hint">Bankverbindung ist für dein Konto nicht freigeschaltet.</p></section>';
  const conns=b.conns.map((c,i)=>{const until=(c.valid_until||'').slice(0,10),d=until?daysTo(until):999,exp=c.err==='expired'||d<0;
    return '<div class="erow"><span><b>'+esc(c.aspsp.name)+'</b><small>'+(exp?'Abgelaufen, bitte neu verbinden':'Verbunden bis '+dfmt(until))+' · <span>'+c.accounts.length+(c.accounts.length===1?' Konto':' Konten')+'</span></small></span><span class="form" style="margin:0">'+(exp||d<=14?'<button class="small primary" data-act="bkRenew" data-i="'+i+'">Neu verbinden</button>':'')+'<button class="small" data-act="bkRemove" data-i="'+i+'" aria-label="Entfernen">×</button></span></div>'}).join('');
  return '<section class="group"><h3>Bankverbindung</h3>'
    +(bkReady()?(b.conns.length?'<div class="elist">'+conns+'</div>':'<p class="hint">Noch keine Bank verbunden.</p>')
      +'<div class="form"><button data-act="bkConnect">+ Bank verbinden</button>'+(LI?'':'<button data-act="bkFetch">Jetzt abrufen</button>')+'</div>'
      +(b.lastFetch&&!LI?'<p class="hint">Zuletzt abgerufen: '+dfmt(new Date(b.lastFetch).toISOString().slice(0,10))+' '+new Date(b.lastFetch).toTimeString().slice(0,5)+'</p>':'')
      +(LI?'':'<details class="bkset"'+(b.conns.length?'':' open')+'><summary>Einstellungen</summary>'+bkSetupForm()+'</details>')
      :'<p class="hint">Holt Umsätze und Kontostände direkt von der Bank. Dafür brauchst du einmalig ein kostenloses Konto bei Enable Banking und einen eigenen Vermittler bei Cloudflare.</p>'+bkSetupForm())
    +'</section>'}
function bkSetupForm(){const b=bk();return '<label>Adresse des Vermittlers<input id="f-bkurl" value="'+esc(b.url||'')+'" placeholder="https://djc-bank.….workers.dev" inputmode="url"></label>'
  +'<label>Zugangsschlüssel<input id="f-bkkey" value="'+esc(b.key||'')+'" autocomplete="off" spellcheck="false"></label>'
  +'<div class="form"><button data-act="bkGenKey">Schlüssel erzeugen</button><button data-act="bkCopyKey">Schlüssel kopieren</button><button class="primary" data-act="bkSave">Speichern & testen</button></div>'
  +'<p class="hint">Den Zugangsschlüssel trägst du bei Cloudflare als ACCESS_KEY ein. Er steht nur hier in der App und in deinem Backup.</p>'}
function bkGenKey(){const a=new Uint8Array(24);crypto.getRandomValues(a);return Array.from(a,x=>x.toString(16).padStart(2,'0')).join('')}
async function bkSaveSetup(){const b=bk();b.url=$('#f-bkurl').value.trim().replace(/\/+$/,'');b.key=$('#f-bkkey').value.trim();
  if(b.url&&!/^https:\/\//.test(b.url)&&!/^http:\/\/localhost/.test(b.url)){toast('Die Adresse muss mit https:// beginnen.');return}
  save();render();if(!bkReady()){toast('Gespeichert.');return}
  try{await bkApi('/ping');toast('Verbindung zum Vermittler klappt.')}catch(e){toast(bkErrText(e))}}
const BK_COUNTRIES=[['DE','Deutschland'],['HR','Kroatien'],['AT','Österreich']];
function bkConnectDlg(country){country=country||'DE';
  modal('<div class="mhead"><div><h3>Bank verbinden</h3><small>Du meldest dich gleich direkt bei deiner Bank an.</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'
    +'<label>Land<select id="f-bkc">'+BK_COUNTRIES.map(([v,t])=>'<option value="'+v+'"'+sel(v===country)+'>'+t+'</option>').join('')+'</select></label>'
    +'<label>Bank suchen<input id="f-bkq" placeholder="z. B. DKB, Santander, Raiffeisen"></label><div id="bklist" class="elist"><p class="hint">Wird geladen …</p></div>');
  bkLoadList(country)}
let bkList=[];
async function bkLoadList(c){const el=$('#bklist');try{const j=await bkApi('/aspsps?country='+c);bkList=j.aspsps||[];bkRenderList()}catch(e){if(el)el.innerHTML='<p class="neg">'+esc(tr(bkErrText(e)))+'</p>'}}
function bkRenderList(){const el=$('#bklist');if(!el)return;const q=nrm(($('#f-bkq')||{}).value||'');const L=bkList.filter(a=>!q||nrm(a.name).includes(q)).slice(0,40);
  el.innerHTML=L.length?L.map(a=>'<button class="erow btnrow" data-act="bkStart" data-v="'+esc(a.name)+'" data-c="'+esc(a.country)+'"><span><b>'+esc(a.name)+'</b></span><span>›</span></button>').join(''):'<p class="hint">Keine Bank gefunden.</p>'}
async function bkStart(name,country){const st=bkGenKey();try{localStorage.setItem('djc-bstate',JSON.stringify({st,name,country,t:Date.now()}))}catch(e){}
  toast('Weiter zur Bank …');
  try{const j=await bkApi('/auth',{method:'POST',body:JSON.stringify({name,country,state:st,redirect_url:bkRedirect()})});save();setTimeout(()=>{location.href=j.url},50)}catch(e){toast(bkErrText(e))}}
async function bkCallback(cb){let st=null;try{st=JSON.parse(localStorage.getItem('djc-bstate')||'null')}catch(e){}
  if(cb.error){toast('Die Bank hat die Freigabe abgebrochen.');return}
  if(!st||st.st!==cb.state){toast('Die Rückmeldung der Bank passt nicht zu dieser App. Bitte erneut verbinden.');return}
  try{localStorage.removeItem('djc-bstate')}catch(e){}
  if(!bkReady()){toast('Bitte zuerst den Vermittler unter „Mehr“ einrichten.');return}
  toast('Bank wird verbunden …');
  let j;try{j=await bkApi('/session',{method:'POST',body:JSON.stringify({code:cb.code})})}catch(e){toast(bkErrText(e));return}
  const b=bk();const name=(j.aspsp&&j.aspsp.name)||st.name,country=(j.aspsp&&j.aspsp.country)||st.country;
  const old=b.conns.filter(c=>c.aspsp.name===name&&c.aspsp.country===country);
  const accounts=(j.accounts||[]).map(a=>{const iban=normIban(a.iban);let acc=iban&&S.accounts.find(x=>normIban(x.iban)===iban);
    if(!acc){acc={id:uid(),name:name+(a.name?' '+a.name:iban?' …'+iban.slice(-4):''),type:'bank',iban,history:[],note:''};S.accounts.push(acc)}
    const prev=old.flatMap(c=>c.accounts).find(x=>x.iban&&x.iban===iban);
    return {uid:a.uid,iban,name:a.name||'',accId:acc.id,last:prev?prev.last:''}});
  b.conns=b.conns.filter(c=>!old.includes(c));
  b.conns.push({sid:j.session_id,aspsp:{name,country},valid_until:j.valid_until||'',accounts,err:''});
  save();render();
  if(!accounts.length){toast('Verbunden, aber die Bank hat keine Konten geliefert. Ist das Konto bei Enable Banking freigeschaltet (Linked Accounts)?');return}
  await bkFetch(true);bkSchedPush(true).then(()=>render())}
function nameSim(x,y){const A=payeeKey(x).split(' ').filter(w=>w.length>1),B=payeeKey(y).split(' ').filter(w=>w.length>1);if(!A.length||!B.length)return false;const [s,l]=A.length<=B.length?[A,B]:[B,A];return s.length>=2?s.every(w=>l.includes(w)):(l.length<=2&&l.includes(s[0]))}
const txSig=(acc,t)=>[acc||'',t.amount.toFixed(2),nrm(t.name||''),nrm(t.purpose||'')].join('|');
function bkIngest(a,txs,bals,T){let added=0,auto=0,dup=0;const used=new Set();
  const inc=txs.filter(x=>x.status!=='PDNG'&&x.status!=='PNDG').map(bkMap),incIds=new Set(inc.map(t=>t.ebid));
  for(const t of inc){if(!t.amount)continue;
    if(S.txs.some(y=>y.ebid===t.ebid)){dup++;continue}
    {const sg=txSig(a.accId,t),d0=Date.parse(t.date),long=(t.name+t.purpose).length>=6;
      const tw=S.txs.find(y=>y.ebid&&!incIds.has(y.ebid)&&!used.has(y.id)&&(y.accountId||'')===(a.accId||'')&&txSig(y.accountId,y)===sg&&Math.abs(Date.parse(y.date)-d0)<=(long?2:0)*864e5);
      if(tw){used.add(tw.id);dup++;continue}
      const cx=t.name&&S.txs.find(y=>!used.has(y.id)&&(y.accountId||'')!==(a.accId||'')&&y.type!=='ignore'&&y.date===t.date&&Math.abs(y.amount-t.amount)<0.005&&(!y.ebid||!incIds.has(y.ebid))&&nameSim(y.name,t.name));
      if(cx){used.add(cx.id);dup++;continue}}
    const m=bkFuzzy(a.accId,t.amount,t.date,used,y=>!y.ebid);if(m){used.add(m.id);m.ebid=t.ebid;dup++;continue}
    const tx={id:uid(),key:txKey(t),ebid:t.ebid,src:'bank',date:t.date,amount:t.amount,name:t.name,iban:t.iban,purpose:t.purpose,type:'open',unitId:'',propertyId:'',category:'',forMonth:'',accountId:a.accId};
    if(autoAssign2(tx)){auto++;if(tx.type==='rent')dedupeExcel(tx)}S.txs.push(tx);added++}
  const L=bals||[];const pick=BK_BAL.map(k=>L.find(z=>z.balance_type===k)).find(Boolean)||L[0];
  if(pick&&pick.balance_amount){const ac=accOf(a.accId);if(ac){const v=Math.round(parseFloat(pick.balance_amount.amount)*100)/100;if(isFinite(v)){ac.history=(ac.history||[]).filter(h=>h.date!==T);ac.history.push({date:T,value:v})}}}
  if(!a.last||a.last<T)a.last=T;return {added,auto,dup}}
/* ---------- Automatischer Abruf (Worker-Zeitplan 9/14/18 Uhr, Ende-zu-Ende verschlüsselt) ---------- */
let bkSched={active:false,hours:[9,14,18],last_run:0,ok:null};
const b64d=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function bkKeys(){const b=bk();if(b.ek&&b.ek.priv&&b.ek.pub)return b.ek;
  const k=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);
  const pub=await crypto.subtle.exportKey('jwk',k.publicKey),priv=await crypto.subtle.exportKey('jwk',k.privateKey);
  b.ek={pub:{kty:'EC',crv:'P-256',x:pub.x,y:pub.y},priv};save();return b.ek}
async function bkOpenBlob(blob){const o=JSON.parse(blob),ek=bk().ek;if(!ek)throw new Error('nokey');
  const priv=await crypto.subtle.importKey('jwk',ek.priv,{name:'ECDH',namedCurve:'P-256'},false,['deriveKey']);
  const pub=await crypto.subtle.importKey('jwk',o.epk,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const key=await crypto.subtle.deriveKey({name:'ECDH',public:pub},priv,{name:'AES-GCM',length:256},false,['decrypt']);
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:b64d(o.iv)},key,b64d(o.ct))))}
async function bkSchedPush(force){if(!loggedIn()||!acct.bank)return;const b=bk();
  const acc=b.conns.filter(c=>c.err!=='expired').flatMap(c=>c.accounts.map(a=>({uid:a.uid,last:a.last||''})));
  let ek=null;if(acc.length)ek=await bkKeys();
  const body={pub:ek?JSON.stringify(ek.pub):'',accounts:acc},sig=JSON.stringify([ek&&ek.pub.x,acc.map(a=>a.uid)]);
  let prev=null;try{prev=JSON.parse(localStorage.getItem('djc-sched')||'null')}catch(e){}
  try{if(force||!prev||prev.sig!==sig||Date.now()-prev.t>12*3600e3){const j=await bkApi('/sched',{method:'PUT',body:JSON.stringify(body)});bkSched.active=!!j.active;if(j.hours)bkSched.hours=j.hours;try{localStorage.setItem('djc-sched',JSON.stringify({sig,t:Date.now()}))}catch(e){}}
    const g=await bkApi('/sched');Object.assign(bkSched,g,{ok:true})}
  catch(e){bkSched.ok=false;bkSched.active=false}}
let bkInboxBusy=false,bkInboxT=0;
async function bkInbox(){if(bkInboxBusy||!loggedIn()||!acct.bank||!bk().ek)return;bkInboxBusy=true;bkInboxT=Date.now();
  try{const j=await bkApi('/inbox');const items=j.items||[];if(!items.length)return;const b=bk();let added=0,auto=0,ids=[],last=0;
    for(const it of items){let p;try{p=await bkOpenBlob(it.blob)}catch(e){continue}ids.push(it.id);const T=new Date(p.at||it.created).toISOString().slice(0,10);last=Math.max(last,p.at||it.created);
      for(const r of p.results||[]){const c=b.conns.find(c=>c.accounts.some(a=>a.uid===r.uid));if(!c)continue;const a=c.accounts.find(a=>a.uid===r.uid);
        if(r.err){if(r.err==='EXPIRED_SESSION')c.err='expired';else c.lastErr=r.err;continue}
        const x=bkIngest(a,r.transactions||[],r.balances||[],T);added+=x.added;auto+=x.auto;c.lastErr=''}}
    if(!ids.length)return;
    if(last>(b.lastFetch||0)){b.lastFetch=last;b.lastNew=added}save();render();
    await bkApi('/inbox/ack',{method:'POST',body:JSON.stringify({ids})});
    if(added)toast(added+' neue Umsätze von der Bank, davon '+auto+' automatisch zugeordnet.')}
  catch(e){}finally{bkInboxBusy=false}}
function bkSchedInfo(){if(!loggedIn()||!acct.bank||!bk().conns.length)return '';const b=bk();
  const errs=b.conns.filter(c=>c.lastErr&&c.err!=='expired');
  return '<section class="group"><h3>Automatischer Abruf</h3>'+(bkSched.active?'<p class="hint">Die Umsätze werden täglich um '+(bkSched.hours||[]).map(h=>h+':00').join(', ')+' Uhr abgerufen und verschlüsselt für dich bereitgelegt. Nächster Abruf: '+bkNextRun()+'.</p>'
    :bkSched.ok===false?'<p class="hint">Der Server unterstützt den automatischen Abruf noch nicht. Bis dahin ruft die App beim Öffnen ab.</p>':'<p class="hint">Wird eingerichtet …</p>')
    +errs.map(c=>'<p class="hint neg">'+esc(c.aspsp.name)+': Beim letzten Abruf kam ein Fehler von der Bank ('+esc(c.lastErr)+'). Meist ist das vorübergehend.</p>').join('')
    +'<button class="small" data-act="bkFetch">Jetzt abrufen</button></section>'}
function bkFuzzy(accId,amount,date,used,pred){const d0=Date.parse(date);
  return S.txs.find(t=>!used.has(t.id)&&pred(t)&&(t.accountId||'')===(accId||'')&&Math.abs(t.amount-amount)<0.005&&Math.abs(Date.parse(t.date)-d0)<=3*864e5)}
function bkMap(x){const deb=x.credit_debit_indicator==='DBIT';let amt=Math.abs(parseFloat(x.transaction_amount&&x.transaction_amount.amount)||0);if(deb)amt=-amt;
  const cp=deb?x.creditor:x.debtor,cpa=deb?x.creditor_account:x.debtor_account;
  const purpose=(Array.isArray(x.remittance_information)?x.remittance_information.join(' '):String(x.remittance_information||'')).replace(/\s+/g,' ').trim();
  const date=(x.booking_date||x.value_date||x.transaction_date||todayISO()).slice(0,10);
  const name=((cp&&cp.name)||'').replace(/\s+/g,' ').trim();const iban=normIban(cpa&&cpa.iban);
  const id='eb:'+(x.entry_reference||x.transaction_id||[date,amt.toFixed(2),name,purpose].join('|'));
  return {ebid:id,date,amount:Math.round(amt*100)/100,name,iban:/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)?iban:'',purpose}}
const BK_BAL=['CLBD','ITBD','XPCD','ITAV','CLAV','OPBD','PRCD','FWAV','INFO'];
async function bkFetch(manual){if(bkBusy||!bkReady())return;const b=bk();if(!b.conns.length){if(manual)toast('Noch keine Bank verbunden.');return}
  bkBusy=true;if(manual)toast('Umsätze werden abgerufen …');
  let added=0,auto=0,dup=0,errs=[];const T=todayISO();
  try{
    for(const c of b.conns){if(c.err==='expired')continue;
      for(const a of c.accounts){
        const from=a.last?new Date(Date.parse(a.last)-5*864e5).toISOString().slice(0,10):new Date(Date.now()-89*864e5).toISOString().slice(0,10);
        try{
          const j=await bkApi('/transactions?uid='+encodeURIComponent(a.uid)+'&from='+from);
          let bals=[];try{bals=(await bkApi('/balances?uid='+encodeURIComponent(a.uid))).balances||[]}catch(e){}
          const r=bkIngest(a,j.transactions||[],bals,T);added+=r.added;auto+=r.auto;dup+=r.dup;c.lastErr='';
        }catch(e){if(e.code==='EXPIRED_SESSION'){c.err='expired'}else c.lastErr=e.code||'ERROR';errs.push(c.aspsp.name+': '+bkErrText(e))}
      }
    }
    b.lastFetch=Date.now();b.lastNew=added;save();render();
    if(errs.length)toast(errs[0]);
    else if(added)toast(added+' neue Umsätze von der Bank, davon '+auto+' automatisch zugeordnet.');
    else if(manual)toast('Keine neuen Umsätze.');
  }finally{bkBusy=false}}
function bankAfterBoot(){if(BK_CB&&!bankAfterBoot.done){bankAfterBoot.done=true;bkCallback(BK_CB);return}
  if(bankAfterBoot.done)return;bankAfterBoot.done=true;
  bkAuto();if(typeof mailPull==='function')setTimeout(()=>mailPull(),1500)}
async function bkAuto(){if(!bkReady()||!bk().conns.length)return;
  if(loggedIn()){await bkSchedPush(false);await bkInbox();
    if(bkSched.active&&bkSched.last_run&&Date.now()-bkSched.last_run<16*3600e3)return}
  if(Date.now()-(bk().lastFetch||0)>4*3600e3)bkFetch(false)}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S&&!locked&&loggedIn()&&Date.now()-bkInboxT>120e3)bkInbox().then(()=>{if(curTab()==='mehr')render()})});
setInterval(()=>{if(!document.hidden&&S&&!locked&&loggedIn())bkInbox()},15*60e3);
{const _rg=runGo;runGo=function(){try{if(!sessionStorage.getItem('djc-hs')){sessionStorage.setItem('djc-hs','1');if(S&&S.settings&&S.settings.hideStart&&!ui.hide){ui.hide=true;saveUi();render()}}}catch(e){}_rg();(async()=>{try{if(loggedIn())await syncPull(true)}catch(e){}bankAfterBoot()})()}}
{const _ri=remindItems;remindItems=function(){const out=_ri();if(S.bank&&S.bank.conns)S.bank.conns.forEach(c=>{const u=(c.valid_until||'').slice(0,10);const d=u?daysTo(u):999;
  if(c.err==='expired'||d<=14)out.push({date:u||todayISO(),t:'Bankverbindung '+c.aspsp.name,s:c.err==='expired'||d<0?'Abgelaufen, bitte neu verbinden':'Läuft am '+dfmt(u)+' ab, bitte neu verbinden',lvl:c.err==='expired'||d<0?'late':'partial',act:'bank'})});
  return out.sort((a,b)=>a.date.localeCompare(b.date))}}
/* Mehrere Fenster (App + Browser nach der Bankanmeldung): neueren Stand übernehmen */
{const _ds=doSave;doSave=async function(){S._t=Date.now();return _ds()}}
document.addEventListener('visibilitychange',async()=>{if(document.hidden||!S||locked)return;try{const s=await idbGet(KV,'state');if(s&&s._t&&s._t>(S._t||0)){S=migrate(s);render()}}catch(e){}});
document.addEventListener('input',e=>{if(e.target&&e.target.id==='f-bkq')bkRenderList()});
document.addEventListener('change',e=>{if(e.target&&e.target.id==='f-bkc')bkLoadList(e.target.value)});
document.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='remGo'&&b.dataset.v==='bank'){location.hash='#mehr/bank';return}
  if(!a.startsWith('bk'))return;
  if(a==='bkConnect')bkConnectDlg();
  else if(a==='bkStart')bkStart(b.dataset.v,b.dataset.c);
  else if(a==='bkFetch')bkFetch(true);
  else if(a==='bkSave')bkSaveSetup();
  else if(a==='bkGenKey'){const i=$('#f-bkkey');if(i&&(!i.value||confirm(tr('Neuen Schlüssel erzeugen? Dann musst du ihn auch bei Cloudflare ändern.'))))i.value=bkGenKey()}
  else if(a==='bkCopyKey'){const v=($('#f-bkkey')||{}).value||'';if(!v){toast('Erst einen Schlüssel erzeugen.');return}(navigator.clipboard?navigator.clipboard.writeText(v):Promise.reject()).then(()=>toast('Schlüssel kopiert.'),()=>{const i=$('#f-bkkey');i.select();toast('Schlüssel markiert, bitte kopieren.')})}
  else if(a==='bkRenew'){const c=bk().conns[+b.dataset.i];if(c)bkStart(c.aspsp.name,c.aspsp.country)}
  else if(a==='bkRemove'){const c=bk().conns[+b.dataset.i];if(c&&confirm(tr('Verbindung zu dieser Bank entfernen? Die Umsätze bleiben in der App.'))){bk().conns.splice(+b.dataset.i,1);save();render();bkSchedPush(true);bkApi('/session?id='+encodeURIComponent(c.sid),{method:'DELETE'}).catch(()=>{})}}
});
I18N.push(['Bankverbindung','Bank connection','Bankovna veza'],['Umsätze abrufen','Fetch transactions','Dohvati transakcije'],['+ Bank verbinden','+ Connect bank','+ Poveži banku'],['Bank verbinden','Connect bank','Poveži banku'],['Noch keine Bank verbunden.','No bank connected yet.','Još nijedna banka nije povezana.'],['Einstellungen','Settings','Postavke'],
['Holt Umsätze und Kontostände direkt von der Bank. Dafür brauchst du einmalig ein kostenloses Konto bei Enable Banking und einen eigenen Vermittler bei Cloudflare.','Fetches transactions and balances directly from the bank. This needs a free Enable Banking account and your own relay on Cloudflare, set up once.','Dohvaća transakcije i stanja izravno iz banke. Za to jednom trebaš besplatan račun kod Enable Bankinga i vlastitog posrednika na Cloudflareu.'],
['Adresse des Vermittlers','Relay address','Adresa posrednika'],['Zugangsschlüssel','Access key','Pristupni ključ'],['Schlüssel erzeugen','Generate key','Generiraj ključ'],['Schlüssel kopieren','Copy key','Kopiraj ključ'],['Speichern & testen','Save & test','Spremi i testiraj'],
['Den Zugangsschlüssel trägst du bei Cloudflare als ACCESS_KEY ein. Er steht nur hier in der App und in deinem Backup.','Enter the access key on Cloudflare as ACCESS_KEY. It is stored only here in the app and in your backup.','Pristupni ključ unesi na Cloudflareu kao ACCESS_KEY. Spremljen je samo ovdje u aplikaciji i u tvojoj kopiji.'],
['Du meldest dich gleich direkt bei deiner Bank an.','You will sign in directly with your bank.','Prijavit ćeš se izravno u svojoj banci.'],['Bank suchen','Search bank','Traži banku'],['z. B. DKB, Santander, Raiffeisen','e.g. DKB, Santander, Raiffeisen','npr. DKB, Santander, Raiffeisen'],['Wird geladen …','Loading …','Učitavanje …'],['Keine Bank gefunden.','No bank found.','Banka nije pronađena.'],['Österreich','Austria','Austrija'],
['Weiter zur Bank …','Continuing to bank …','Nastavak prema banci …'],['Bank wird verbunden …','Connecting bank …','Povezivanje banke …'],['Umsätze werden abgerufen …','Fetching transactions …','Dohvaćanje transakcija …'],['Keine neuen Umsätze.','No new transactions.','Nema novih transakcija.'],
['{n} neue Umsätze von der Bank, davon {n} automatisch zugeordnet.','{n} new transactions from the bank, {n} assigned automatically.','{n} novih transakcija iz banke, od toga {n} automatski razvrstano.'],
['Verbindung zum Vermittler klappt.','Connection to relay works.','Veza s posrednikom radi.'],['Die Adresse muss mit https:// beginnen.','The address must start with https://.','Adresa mora počinjati s https://.'],
['Der Vermittler ist nicht erreichbar. Prüfe die Adresse und die Internetverbindung.','The relay cannot be reached. Check the address and internet connection.','Posrednik nije dostupan. Provjeri adresu i internetsku vezu.'],
['Der Zugangsschlüssel passt nicht zu dem bei Cloudflare.','The access key does not match the one on Cloudflare.','Pristupni ključ ne odgovara onome na Cloudflareu.'],
['Der Vermittler erlaubt diese App-Adresse nicht (ALLOWED_ORIGIN).','The relay does not allow this app address (ALLOWED_ORIGIN).','Posrednik ne dopušta ovu adresu aplikacije (ALLOWED_ORIGIN).'],
['Beim Vermittler fehlen EB_APP_ID, EB_KEY oder ACCESS_KEY.','The relay is missing EB_APP_ID, EB_KEY or ACCESS_KEY.','Posredniku nedostaje EB_APP_ID, EB_KEY ili ACCESS_KEY.'],
['Die Freigabe der Bank ist abgelaufen. Bitte neu verbinden.','The bank authorisation has expired. Please reconnect.','Odobrenje banke je isteklo. Poveži ponovno.'],
['Die Bank hat die Freigabe abgebrochen.','The bank cancelled the authorisation.','Banka je prekinula odobrenje.'],['Die Rückmeldung der Bank passt nicht zu dieser App. Bitte erneut verbinden.','The bank response does not match this app. Please connect again.','Odgovor banke ne odgovara ovoj aplikaciji. Poveži ponovno.'],
['Bitte zuerst den Vermittler unter „Mehr“ einrichten.','Please set up the relay under “More” first.','Najprije postavi posrednika pod „Više“.'],
['Verbunden, aber die Bank hat keine Konten geliefert. Ist das Konto bei Enable Banking freigeschaltet (Linked Accounts)?','Connected, but the bank returned no accounts. Is the account linked in Enable Banking (Linked Accounts)?','Povezano, ali banka nije vratila račune. Je li račun povezan u Enable Bankingu (Linked Accounts)?'],
['Abgelaufen, bitte neu verbinden','Expired, please reconnect','Isteklo, poveži ponovno'],['Neu verbinden','Reconnect','Poveži ponovno'],['Erst einen Schlüssel erzeugen.','Generate a key first.','Najprije generiraj ključ.'],['Schlüssel kopiert.','Key copied.','Ključ kopiran.'],['Schlüssel markiert, bitte kopieren.','Key selected, please copy.','Ključ označen, kopiraj ga.'],
['Neuen Schlüssel erzeugen? Dann musst du ihn auch bei Cloudflare ändern.','Generate a new key? You will also need to change it on Cloudflare.','Generirati novi ključ? Tada ga moraš promijeniti i na Cloudflareu.'],
['Verbindung zu dieser Bank entfernen? Die Umsätze bleiben in der App.','Remove the connection to this bank? Transactions stay in the app.','Ukloniti vezu s ovom bankom? Transakcije ostaju u aplikaciji.']);
PREFIX.push(['Verbunden bis ','Connected until ','Povezano do '],['Zuletzt abgerufen: ','Last fetched: ','Zadnje dohvaćeno: '],['Bankverbindung ','Bank connection ','Bankovna veza '],['Fehler von der Bank-Schnittstelle','Error from bank interface','Greška bankovnog sučelja']);
I18N.push(['Läuft am {n} ab, bitte neu verbinden','Expires on {n}, please reconnect','Ističe {n}, poveži ponovno']);

I18N.push(['{n} Konten','{n} accounts','{n} računa'],['{n} Konto','{n} account','{n} račun']);

I18N.push(['Zurückgezahlte ausblenden','Hide repaid','Sakrij vraćeno'],['Zurückgezahlte anzeigen ({n})','Show repaid ({n})','Prikaži vraćeno ({n})']);

I18N.push(['Kontostände verbundener Banken kommen automatisch. Andere Konten antippen und den Stand eintragen.','Balances of connected banks update automatically. Tap other accounts to enter the balance.','Stanja povezanih banaka dolaze automatski. Ostale račune dodirni i unesi stanje.'],['Tippe auf ein Konto, um den aktuellen Stand einzutragen.','Tap an account to enter the current balance.','Dodirni račun za unos trenutnog stanja.']);

/* ---------- Zurück-Taste des Handys schließt offene Fenster ---------- */
{let mh=false;const _m=modal,_c=closeModal;
  modal=function(html){_m(html);if(!mh){mh=true;try{history.pushState({djcModal:1},'',location.href)}catch(e){}}};
  closeModal=function(){_c();if(mh)setTimeout(()=>{if(mh&&$('#modal').hidden){mh=false;if(history.state&&history.state.djcModal)history.back()}},0)};
  window.addEventListener('popstate',()=>{if(mh){mh=false;if(!$('#modal').hidden)_c()}});
}

/* ---------- Reihenfolge per langem Drücken ändern (Konten, Einheiten) ---------- */
{let st=null,drag=null,eatClick=false;
  const items=c=>[...c.children].filter(x=>x.dataset&&x.dataset.id);
  const cancel=()=>{if(st){clearTimeout(st.t);st=null}};
  document.addEventListener('pointerdown',e=>{const it=e.target.closest('[data-sort] > [data-id]');if(!it||e.button>0)return;cancel();
    st={it,x:e.clientX,y:e.clientY,id:e.pointerId,t:setTimeout(()=>{const c=it.parentNode;if(items(c).length<2){st=null;return}
      drag={it,c,list:c.dataset.sort};st=null;it.classList.add('dragging');document.body.classList.add('sorting');try{navigator.vibrate&&navigator.vibrate(25)}catch(_){}},450)}});
  document.addEventListener('pointermove',e=>{if(st&&(Math.abs(e.clientX-st.x)>8||Math.abs(e.clientY-st.y)>8))cancel();
    if(!drag)return;e.preventDefault();const L=items(drag.c);
    const O=L.filter(o=>o!==drag.it);let k=O.findIndex(o=>{const r=o.getBoundingClientRect();return e.clientY<r.top+r.height/2});
    const ref=k<0?(O.length?O[O.length-1].nextSibling:null):O[k];if(ref!==drag.it&&drag.it.nextSibling!==ref)drag.c.insertBefore(drag.it,ref);
    const vh=window.innerHeight;if(e.clientY<80)window.scrollBy(0,-12);else if(e.clientY>vh-120)window.scrollBy(0,12)},{passive:false});
  document.addEventListener('touchmove',e=>{if(drag)e.preventDefault()},{passive:false});
  const end=()=>{cancel();if(!drag)return;const d=drag;drag=null;d.it.classList.remove('dragging');document.body.classList.remove('sorting');eatClick=true;setTimeout(()=>eatClick=false,400);
    const ids=items(d.c).map(x=>x.dataset.id),arr=d.list==='accounts'?S.accounts:d.list==='units'?S.units:null;if(!arr)return;
    const pos=arr.map((x,i)=>ids.includes(x.id)?i:-1).filter(i=>i>=0),moved=ids.map(id=>arr.find(x=>x.id===id)).filter(Boolean);
    if(moved.length!==pos.length)return;pos.forEach((p,k)=>arr[p]=moved[k]);save();render();toast('Reihenfolge gespeichert.')};
  document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
  document.addEventListener('click',e=>{if(eatClick){e.stopPropagation();e.preventDefault();eatClick=false}},true);
  document.addEventListener('contextmenu',e=>{if(e.target.closest('[data-sort] > [data-id]'))e.preventDefault()});
}
I18N.push(['Reihenfolge gespeichert.','Order saved.','Redoslijed spremljen.'],['Zum Sortieren lange gedrückt halten und ziehen.','Press and hold, then drag to reorder.','Za razvrstavanje drži pritisnuto i povuci.']);

/* ====================================================================
   Konto: Anmeldung, Ende-zu-Ende-Verschlüsselung, Sync über den eigenen Server
   Das Passwort verlässt nie das Gerät. Aus ihm werden zwei Schlüssel abgeleitet:
   einer zum Anmelden (geht zum Server) und einer zum Entschlüsseln (bleibt hier).
   ==================================================================== */
const SRV=(window.DJC_SERVER||'').replace(/\/+$/,'');
let acct=null,authOpen=false,syncBusy=false,pushT=null,applying=false;
try{acct=JSON.parse(localStorage.getItem('djc-acct')||'null')}catch(e){}
const saveAcct=()=>{try{acct?localStorage.setItem('djc-acct',JSON.stringify(acct)):localStorage.removeItem('djc-acct')}catch(e){}};
const loggedIn=()=>!!(SRV&&acct&&acct.token);
const localMode=()=>{try{return localStorage.getItem('djc-local')==='1'}catch(e){return false}};
function needAuth(){return !!SRV&&!loggedIn()&&!localMode()}
/* --- Kryptografie --- */
const TE=new TextEncoder(),TD=new TextDecoder();
const b2a=u=>{u=new Uint8Array(u);let s='';for(let i=0;i<u.length;i+=8192)s+=String.fromCharCode.apply(null,u.subarray(i,i+8192));return btoa(s)};
const a2b=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function derive(secret,salt){const base=await crypto.subtle.importKey('raw',TE.encode(secret),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:TE.encode(salt),iterations:310000},base,512));
  return {auth:b2a(bits.slice(0,32)),kek:await crypto.subtle.importKey('raw',bits.slice(32),'AES-GCM',false,['encrypt','decrypt'])}}
const pwSalt=e=>'djc-capital-pw|'+e,recSalt=e=>'djc-capital-rec|'+e;
async function gcmEnc(key,data){const iv=crypto.getRandomValues(new Uint8Array(12));const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,data));const o=new Uint8Array(12+ct.length);o.set(iv);o.set(ct,12);return o}
async function gcmDec(key,buf){return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:buf.slice(0,12)},key,buf.slice(12)))}
async function mkKey(raw){return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt'])}
async function zip(u){if(typeof CompressionStream==='undefined')return [0,u];const s=new Blob([u]).stream().pipeThrough(new CompressionStream('gzip'));return [1,new Uint8Array(await new Response(s).arrayBuffer())]}
async function unzip(f,u){if(!f)return u;const s=new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));return new Uint8Array(await new Response(s).arrayBuffer())}
async function getMK(){try{return await idbGet(KV,'acct-mk')}catch(e){return null}}
async function sealState(obj){const mk=await getMK();if(!mk)throw new Error('NO_KEY');const [f,z]=await zip(TE.encode(JSON.stringify(obj)));const ct=await gcmEnc(mk,z);const o=new Uint8Array(1+ct.length);o[0]=f;o.set(ct,1);return b2a(o)}
async function openState(b64){const mk=await getMK();const u=a2b(b64);return JSON.parse(TD.decode(await unzip(u[0],await gcmDec(mk,u.slice(1)))))}
function recoveryCode(){const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',r=crypto.getRandomValues(new Uint8Array(20));let s='';r.forEach((x,i)=>{s+=A[x%32];if(i%4===3&&i<19)s+='-'});return s}
const normCode=c=>String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/(.{4})(?=.)/g,'$1-');
/* --- Server --- */
async function api(path,opt){let r;try{r=await fetch(SRV+path,Object.assign({},opt||{},{headers:Object.assign({'Content-Type':'application/json'},acct&&acct.token?{Authorization:'Bearer '+acct.token}:{})}))}catch(e){throw {code:'NETWORK'}}
  let j={};try{j=await r.json()}catch(e){}if(!r.ok)throw {code:j.error||('HTTP_'+r.status),status:r.status,version:j.version};return j}
function authErr(e){const c=e&&e.code;return ({NETWORK:'Keine Verbindung zum Server. Prüfe das Internet.',WRONG_LOGIN:'E-Mail oder Passwort stimmt nicht.',WRONG_CODE:'E-Mail oder Wiederherstellungscode stimmt nicht.',TOO_MANY:'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.',NOT_INVITED:'Für diese E-Mail-Adresse ist die Registrierung nicht freigeschaltet.',EXISTS:'Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.',NO_DATABASE:'Beim Server fehlt die Datenbank (Bindung DB).',FORBIDDEN_ORIGIN:'Der Server erlaubt diese App-Adresse nicht (ALLOWED_ORIGIN).'})[c]||('Fehler'+(c?' ('+c+')':'')+'.')}
/* --- Zustand für den Tresor --- */
const ARR_KEYS=['props','units','txs','rules','accounts','plans','fixcosts','devices','meterDevs','notes','reminders','wishes','docs','credits'];
function exportS(){const o=JSON.parse(JSON.stringify(S));if(o.settings)delete o.settings.lock;delete o._t;return o}
const hasData=s=>!!s&&ARR_KEYS.some(k=>Array.isArray(s[k])&&s[k].length);
function mergeInto(local,server){/* Neues vom anderen Gerät übernehmen, eigene Änderungen behalten */
  ARR_KEYS.forEach(k=>{const L=local[k]=local[k]||[];const ids=new Set(L.map(x=>x&&x.id).filter(Boolean));(server[k]||[]).forEach(x=>{if(x&&x.id&&!ids.has(x.id))L.push(x)})});
  dedupeEbid(local);
  if(server.learn||local.learn)local.learn=Object.assign({},server.learn||{},local.learn||{});
  if(server.bank&&server.bank.conns){local.bank=local.bank||{conns:[]};local.bank.conns=local.bank.conns||[];const sid=new Set(local.bank.conns.map(c=>c.sid));server.bank.conns.forEach(c=>{if(!sid.has(c.sid))local.bank.conns.push(c)});local.bank.lastFetch=Math.max(local.bank.lastFetch||0,server.bank.lastFetch||0)}
  (server.cats||[]).forEach(c=>{if(!(local.cats||[]).includes(c))(local.cats=local.cats||[]).push(c)});
  return local}
async function applyServer(obj){const lock=S&&S.settings&&S.settings.lock;obj.settings=obj.settings||{};if(lock)obj.settings.lock=lock;else delete obj.settings.lock;
  applying=true;try{S=migrate(obj);await idbSet(KV,'state',S)}finally{applying=false}if(!locked&&!authOpen)render()}
/* --- Sync --- */
function schedulePush(ms){if(!loggedIn())return;clearTimeout(pushT);pushT=setTimeout(()=>syncPush(),ms==null?2500:ms)}
async function syncPush(){if(!loggedIn()||syncBusy)return;if(!acct.dirty)return;if(!navigator.onLine){setSync('offline');return}
  syncBusy=true;setSync('busy');
  try{const blob=await sealState(exportS());
    try{const j=await api('/vault',{method:'PUT',body:JSON.stringify({base:acct.version||0,blob})});acct.version=j.version;acct.dirty=false;acct.lastSync=Date.now();saveAcct();setSync('ok')}
    catch(e){if(e.code==='CONFLICT'){const j=await api('/vault');if(j.blob){const srv=await openState(j.blob);mergeInto(S,srv);acct.version=j.version;saveAcct();applying=true;try{await idbSet(KV,'state',S)}finally{applying=false}render();syncBusy=false;return syncPush()}}else throw e}
  }catch(e){syncFail(e)}finally{syncBusy=false}}
async function syncPull(quiet){if(!loggedIn()||syncBusy)return;if(!navigator.onLine){setSync('offline');return}
  syncBusy=true;setSync('busy');
  try{const j=await api('/vault?since='+(acct.version||0));
    if(j.blob&&j.version>(acct.version||0)){const srv=await openState(j.blob);
      if(acct.dirty){mergeInto(S,srv);acct.version=j.version;saveAcct();applying=true;try{await idbSet(KV,'state',S)}finally{applying=false}render();syncBusy=false;await syncPush();return}
      acct.version=j.version;await applyServer(srv);if(!quiet)toast('Neuer Stand von einem anderen Gerät geladen.')}
    else if(!j.version&&acct.dirty!==false){acct.dirty=true}
    acct.lastSync=Date.now();saveAcct();setSync('ok');
  }catch(e){syncFail(e)}finally{syncBusy=false}
  if(acct&&acct.dirty)schedulePush(500)}
function syncFail(e){if(e&&(e.code==='NO_SESSION'||e.status===401)){acct.token=null;saveAcct();setSync('');toast('Bitte melde dich erneut an.');showAuth('login');return}setSync(e&&e.code==='NETWORK'?'offline':'err')}
let syncState='';function setSync(s){syncState=s;const el=document.getElementById('syncst');if(el)el.innerHTML=syncText()}
function syncText(){if(!loggedIn())return '';const t=acct.lastSync?new Date(acct.lastSync):null;
  return syncState==='busy'?'Wird synchronisiert …':syncState==='offline'?'Offline. Änderungen werden später übertragen.':syncState==='err'?'Synchronisieren hat nicht geklappt.':acct.dirty?'Änderungen werden übertragen …':t?'Synchronisiert '+dfmt(t.toISOString().slice(0,10))+' '+t.toTimeString().slice(0,5):'Noch nicht synchronisiert.'}
{const _ds=doSave;doSave=async function(){const r=await _ds();if(!applying&&loggedIn()){acct.dirty=true;saveAcct();schedulePush()}return r}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&loggedIn()&&!locked&&!authOpen)syncPull(true);else if(document.hidden&&loggedIn()&&acct.dirty)syncPush()});
window.addEventListener('online',()=>{if(loggedIn()){syncPull(true)}});
setInterval(()=>{if(loggedIn()&&!document.hidden&&!locked&&!authOpen)syncPull(true)},5*60e3);
/* --- Anmeldebildschirm --- */
let authView='login';
function showAuth(view){authOpen=true;authView=view||authView;closeModal();const e=esc((acct&&acct.email)||'');
  const head='<div class="logo big" aria-hidden="true"><span>DJ</span></div><h2>My Capital</h2>';
  let body='';
  if(authView==='login')body='<p class="hint">Melde dich an. Deine Daten sind dann auf allen Geräten gleich und sicher gespeichert.</p>'
    +'<form class="authf" data-auth="login"><label>E-Mail<input id="a-email" type="email" autocomplete="username" value="'+e+'" required></label><label>Passwort<input id="a-pw" type="password" autocomplete="current-password" required></label><button class="primary" type="submit">Anmelden</button></form>'
    +'<div class="authl"><button class="link" data-act="authView" data-v="register">Konto erstellen</button><button class="link" data-act="authView" data-v="recover">Passwort vergessen?</button></div>';
  else if(authView==='register')body='<p class="hint">Neues Konto. Das Passwort kann niemand zurücksetzen, auch nicht der Server. Dafür bekommst du gleich einen Wiederherstellungscode.</p>'
    +'<form class="authf" data-auth="register"><label>E-Mail<input id="a-email" type="email" autocomplete="username" value="'+e+'" required></label><label>Passwort (mind. 8 Zeichen)<input id="a-pw" type="password" autocomplete="new-password" minlength="8" required></label><label>Passwort wiederholen<input id="a-pw2" type="password" autocomplete="new-password" minlength="8" required></label><button class="primary" type="submit">Konto erstellen</button></form>'
    +'<div class="authl"><button class="link" data-act="authView" data-v="login">Ich habe schon ein Konto</button></div>';
  else body='<p class="hint">Mit deinem Wiederherstellungscode legst du ein neues Passwort fest. Deine Daten bleiben erhalten.</p>'
    +'<form class="authf" data-auth="recover"><label>E-Mail<input id="a-email" type="email" autocomplete="username" value="'+e+'" required></label><label>Wiederherstellungscode<input id="a-code" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" required></label><label>Neues Passwort (mind. 8 Zeichen)<input id="a-pw" type="password" autocomplete="new-password" minlength="8" required></label><label>Passwort wiederholen<input id="a-pw2" type="password" autocomplete="new-password" minlength="8" required></label><button class="primary" type="submit">Neues Passwort festlegen</button></form>'
    +'<div class="authl"><button class="link" data-act="authView" data-v="login">Zurück zur Anmeldung</button></div>';
  $('#root').innerHTML='<div class="lock auth">'+head+body+'<div class="authl"><button class="link dim" data-act="authLocal">Ohne Konto nur auf diesem Gerät nutzen</button></div></div>'}
function authDone(){authOpen=false;try{localStorage.removeItem('djc-local')}catch(e){}markUnlocked&&markUnlocked();render();runGo()}
async function doLogin(email,pw){const k=await derive(pw,pwSalt(email));const j=await api('/auth/login',{method:'POST',body:JSON.stringify({email,auth:k.auth})});
  const raw=await gcmDec(k.kek,a2b(j.mkPw));await idbSet(KV,'acct-mk',await mkKey(raw));
  const keepDirty=!!(acct&&acct.email===j.email&&acct.dirty);acct={email:j.email,token:j.token,bank:!!j.bank,version:keepDirty?acct.version:0,dirty:keepDirty,lastSync:0};saveAcct();await afterLogin(keepDirty)}
async function afterLogin(keepDirty){const v=await api('/vault');
  if(v.blob){const srv=await openState(v.blob);
    if(keepDirty){mergeInto(S,srv);acct.version=v.version;acct.dirty=true;saveAcct();await idbSet(KV,'state',S)}
    else{if(hasData(S)&&JSON.stringify(exportS())!==JSON.stringify(srv)){try{await idbSet(KV,'state-before-login',{date:Date.now(),state:JSON.parse(JSON.stringify(S))})}catch(e){}}
      acct.version=v.version;acct.dirty=false;acct.lastSync=Date.now();saveAcct();await applyServer(srv)}}
  else{acct.version=v.version||0;acct.dirty=true;saveAcct()}
  schedulePush(300)}
async function doRegister(email,pw){const k=await derive(pw,pwSalt(email)),code=recoveryCode(),r=await derive(code.replace(/-/g,''),recSalt(email));
  const raw=crypto.getRandomValues(new Uint8Array(32));const mk=await mkKey(raw);
  const mkPw=b2a(await gcmEnc(k.kek,raw)),mkRec=b2a(await gcmEnc(r.kek,raw));
  await idbSet(KV,'acct-mk',mk);const blob=await sealState(exportS());
  const j=await api('/auth/register',{method:'POST',body:JSON.stringify({email,auth:k.auth,recAuth:r.auth,mkPw,mkRec,blob})});
  acct={email:j.email,token:j.token,bank:!!j.bank,version:j.version||1,dirty:false,lastSync:Date.now()};saveAcct();return code}
async function doRecover(email,code,pw){const r=await derive(code.replace(/-/g,''),recSalt(email));
  const c=await api('/auth/recover',{method:'POST',body:JSON.stringify({email,recAuth:r.auth,check:1})});
  const raw=await gcmDec(r.kek,a2b(c.mkRec));const k=await derive(pw,pwSalt(email));const mkPw=b2a(await gcmEnc(k.kek,raw));
  const j=await api('/auth/recover',{method:'POST',body:JSON.stringify({email,recAuth:r.auth,auth:k.auth,mkPw})});
  await idbSet(KV,'acct-mk',await mkKey(raw));acct={email:j.email,token:j.token,bank:!!j.bank,version:0,dirty:false,lastSync:0};saveAcct();await afterLogin(false)}
function showRecoveryCode(code,after){modal('<h3>Dein Wiederherstellungscode</h3><p class="hint">Damit kommst du an deine Daten, wenn du das Passwort vergisst. Ohne Code und Passwort kann sie niemand wiederherstellen, auch nicht der Server.</p><div class="reccode" id="reccode">'+esc(code)+'</div><div class="form"><button data-act="recCopy">Kopieren</button><button data-act="recFile">Als Datei speichern</button></div><label class="chk"><input type="checkbox" id="f-recok"> Ich habe den Code sicher gespeichert (z. B. Passwort-Manager oder ausgedruckt).</label><div class="mact"><button class="primary" data-act="recDone" disabled>Weiter</button></div>');
  showRecoveryCode.code=code;showRecoveryCode.after=after}
document.addEventListener('change',e=>{if(e.target&&e.target.id==='f-recok'){const b=document.querySelector('[data-act=recDone]');if(b)b.disabled=!e.target.checked}});
document.addEventListener('submit',async e=>{const f=e.target.closest('form.authf');if(!f)return;e.preventDefault();const btn=f.querySelector('button[type=submit]');
  const email=($('#a-email').value||'').trim().toLowerCase(),pw=($('#a-pw')||{}).value||'',pw2=($('#a-pw2')||{}).value;
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){toast('Bitte eine gültige E-Mail eingeben.');return}
  if(f.dataset.auth!=='login'&&pw.length<8){toast('Das Passwort braucht mindestens 8 Zeichen.');return}
  if(pw2!=null&&pw2!==pw){toast('Die Passwörter stimmen nicht überein.');return}
  btn.disabled=true;const old=btn.textContent;btn.textContent=tr('Bitte warten …');
  try{
    if(f.dataset.auth==='login'){await doLogin(email,pw);toast('Angemeldet.');authDone()}
    else if(f.dataset.auth==='register'){const code=await doRegister(email,pw);authOpen=false;try{localStorage.removeItem('djc-local')}catch(_){}render();showRecoveryCode(code,()=>{toast('Konto erstellt. Deine Daten werden jetzt synchronisiert.');runGo()})}
    else{const code=normCode($('#a-code').value);await doRecover(email,code,pw);toast('Neues Passwort gespeichert.');authDone()}
  }catch(err){toast(authErr(err));btn.disabled=false;btn.textContent=old}});
async function doLogout(){if(acct&&acct.dirty){try{await syncPush()}catch(e){}}
  if(acct&&acct.dirty&&!confirm(tr('Einige Änderungen sind noch nicht übertragen. Trotzdem abmelden?')))return;
  try{await api('/auth/logout',{method:'POST'})}catch(e){}
  const lock=S.settings&&S.settings.lock;acct=null;saveAcct();
  try{await idbSet(KV,'acct-mk',null);await idbSet(KV,'state',null);const d=await idb();await new Promise(r=>{const t=d.transaction(RC,'readwrite');t.objectStore(RC).clear();t.oncomplete=r;t.onerror=r})}catch(e){}
  S=blankState();if(lock)S.settings.lock=lock;await idbSet(KV,'state',S);try{localStorage.removeItem('djc-local')}catch(e){}
  closeModal();showAuth('login');toast('Abgemeldet. Die Daten wurden von diesem Gerät entfernt.')}
async function receiptCount(){try{const d=await idb();return await new Promise(r=>{const q=d.transaction(RC).objectStore(RC).count();q.onsuccess=()=>r(q.result);q.onerror=()=>r(0)})}catch(e){return 0}}
function acctSection(){if(!SRV)return '';
  if(loggedIn())return '<section class="group"><h3>Konto & Sync</h3><div class="erow"><span><b>'+esc(acct.email)+'</b><small id="syncst">'+esc(tr(syncText()))+'</small></span></div><div class="form"><button data-act="syncNow">Jetzt synchronisieren</button><button data-act="logout">Abmelden</button></div><p class="hint">Deine Daten sind verschlüsselt in deinem Konto gespeichert und auf allen Geräten gleich, auf denen du angemeldet bist. Belegfotos bleiben auf dem Gerät, auf dem sie aufgenommen wurden.</p></section>';
  return '<section class="group"><h3>Konto & Sync</h3><p class="hint">Mit einem Konto sind deine Daten auf allen Geräten gleich und sicher verschlüsselt gespeichert.</p><div class="form"><button class="primary" data-act="authOpen">Anmelden oder Konto erstellen</button></div></section>'}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='authView'){showAuth(b.dataset.v)}
  else if(a==='authLocal'){try{localStorage.setItem('djc-local','1')}catch(_){}authOpen=false;render();runGo()}
  else if(a==='authOpen'){showAuth(acct&&acct.email?'login':'register')}
  else if(a==='syncNow'){if(acct.dirty)await syncPush();await syncPull(false);toast(syncState==='ok'?'Synchronisiert.':tr(syncText()))}
  else if(a==='logout'){const n=await receiptCount();modal('<h3>Abmelden?</h3><p>Die Daten werden von diesem Gerät entfernt. In deinem Konto bleiben sie verschlüsselt gespeichert und kommen bei der nächsten Anmeldung zurück.</p>'+(n?'<p class="neg">'+n+' Belegfotos sind nur auf diesem Gerät gespeichert und gehen dabei verloren.</p>':'')+'<div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="logoutOk">Abmelden</button></div>')}
  else if(a==='logoutOk'){doLogout()}
  else if(a==='recCopy'){const c=showRecoveryCode.code;(navigator.clipboard?navigator.clipboard.writeText(c):Promise.reject()).then(()=>toast('Code kopiert.'),()=>toast(c))}
  else if(a==='recFile'){dlBlob(new Blob(['DJ Capital – Wiederherstellungscode\r\n\r\nE-Mail: '+(acct&&acct.email)+'\r\nCode: '+showRecoveryCode.code+'\r\n\r\nGut aufbewahren. Damit kann man ein neues Passwort festlegen.\r\n'],{type:'text/plain'}),'DJ-Capital-Wiederherstellungscode.txt')}
  else if(a==='recDone'){closeModal();const f=showRecoveryCode.after;showRecoveryCode.code=null;if(f)f()}
});
I18N.push(['Konto & Sync','Account & sync','Račun i sinkronizacija'],['Jetzt synchronisieren','Sync now','Sinkroniziraj sada'],['Abmelden','Sign out','Odjava'],['Abmelden?','Sign out?','Odjaviti se?'],['Anmelden','Sign in','Prijava'],['Anmelden oder Konto erstellen','Sign in or create account','Prijava ili novi račun'],['Konto erstellen','Create account','Izradi račun'],['Passwort vergessen?','Forgot password?','Zaboravljena lozinka?'],['Ich habe schon ein Konto','I already have an account','Već imam račun'],['Zurück zur Anmeldung','Back to sign in','Natrag na prijavu'],['Ohne Konto nur auf diesem Gerät nutzen','Use without account, only on this device','Koristi bez računa, samo na ovom uređaju'],
['E-Mail','Email','E-pošta'],['Passwort','Password','Lozinka'],['Passwort (mind. 8 Zeichen)','Password (min. 8 characters)','Lozinka (najmanje 8 znakova)'],['Passwort wiederholen','Repeat password','Ponovi lozinku'],['Neues Passwort (mind. 8 Zeichen)','New password (min. 8 characters)','Nova lozinka (najmanje 8 znakova)'],['Wiederherstellungscode','Recovery code','Kod za oporavak'],['Neues Passwort festlegen','Set new password','Postavi novu lozinku'],['Bitte warten …','Please wait …','Pričekaj …'],
['Melde dich an. Deine Daten sind dann auf allen Geräten gleich und sicher gespeichert.','Sign in. Your data will then be the same on all devices and stored securely.','Prijavi se. Tvoji podaci tada su isti na svim uređajima i sigurno spremljeni.'],
['Neues Konto. Das Passwort kann niemand zurücksetzen, auch nicht der Server. Dafür bekommst du gleich einen Wiederherstellungscode.','New account. Nobody can reset the password, not even the server. You will get a recovery code for that.','Novi račun. Lozinku nitko ne može resetirati, ni poslužitelj. Za to ćeš dobiti kod za oporavak.'],
['Mit deinem Wiederherstellungscode legst du ein neues Passwort fest. Deine Daten bleiben erhalten.','Use your recovery code to set a new password. Your data is kept.','Kodom za oporavak postavljaš novu lozinku. Podaci ostaju sačuvani.'],
['Dein Wiederherstellungscode','Your recovery code','Tvoj kod za oporavak'],['Damit kommst du an deine Daten, wenn du das Passwort vergisst. Ohne Code und Passwort kann sie niemand wiederherstellen, auch nicht der Server.','You need it to access your data if you forget the password. Without code and password nobody can recover it, not even the server.','Trebaš ga ako zaboraviš lozinku. Bez koda i lozinke podatke nitko ne može vratiti, ni poslužitelj.'],
['Kopieren','Copy','Kopiraj'],['Als Datei speichern','Save as file','Spremi kao datoteku'],['Ich habe den Code sicher gespeichert (z. B. Passwort-Manager oder ausgedruckt).','I have stored the code safely (e.g. password manager or printed).','Kod sam sigurno spremio (npr. upravitelj lozinki ili ispis).'],['Weiter','Continue','Dalje'],['Code kopiert.','Code copied.','Kod kopiran.'],
['Mit einem Konto sind deine Daten auf allen Geräten gleich und sicher verschlüsselt gespeichert.','With an account your data is the same on all devices and stored securely encrypted.','S računom su tvoji podaci isti na svim uređajima i sigurno šifrirani.'],
['Deine Daten sind verschlüsselt in deinem Konto gespeichert und auf allen Geräten gleich, auf denen du angemeldet bist. Belegfotos bleiben auf dem Gerät, auf dem sie aufgenommen wurden.','Your data is stored encrypted in your account and is the same on all devices where you are signed in. Receipt photos stay on the device where they were taken.','Podaci su šifrirani u tvom računu i isti na svim uređajima na kojima si prijavljen. Fotografije računa ostaju na uređaju na kojem su snimljene.'],
['Die Daten werden von diesem Gerät entfernt. In deinem Konto bleiben sie verschlüsselt gespeichert und kommen bei der nächsten Anmeldung zurück.','The data will be removed from this device. It stays encrypted in your account and comes back at the next sign-in.','Podaci će se ukloniti s ovog uređaja. Ostaju šifrirani u tvom računu i vraćaju se pri sljedećoj prijavi.'],
['{n} Belegfotos sind nur auf diesem Gerät gespeichert und gehen dabei verloren.','{n} receipt photos are only on this device and will be lost.','{n} fotografija računa postoji samo na ovom uređaju i bit će izgubljeno.'],
['Wird synchronisiert …','Syncing …','Sinkronizacija …'],['Offline. Änderungen werden später übertragen.','Offline. Changes will be sent later.','Izvan mreže. Promjene će se poslati kasnije.'],['Synchronisieren hat nicht geklappt.','Sync failed.','Sinkronizacija nije uspjela.'],['Änderungen werden übertragen …','Sending changes …','Slanje promjena …'],['Noch nicht synchronisiert.','Not synced yet.','Još nije sinkronizirano.'],['Synchronisiert.','Synced.','Sinkronizirano.'],
['Neuer Stand von einem anderen Gerät geladen.','Loaded newer data from another device.','Učitano novije stanje s drugog uređaja.'],['Bitte melde dich erneut an.','Please sign in again.','Prijavi se ponovno.'],['Angemeldet.','Signed in.','Prijavljen.'],['Neues Passwort gespeichert.','New password saved.','Nova lozinka spremljena.'],['Konto erstellt. Deine Daten werden jetzt synchronisiert.','Account created. Your data is now being synced.','Račun izrađen. Podaci se sada sinkroniziraju.'],['Abgemeldet. Die Daten wurden von diesem Gerät entfernt.','Signed out. The data was removed from this device.','Odjavljen. Podaci su uklonjeni s ovog uređaja.'],
['Bitte eine gültige E-Mail eingeben.','Please enter a valid email.','Unesi valjanu e-poštu.'],['Das Passwort braucht mindestens 8 Zeichen.','The password needs at least 8 characters.','Lozinka treba najmanje 8 znakova.'],['Die Passwörter stimmen nicht überein.','The passwords do not match.','Lozinke se ne podudaraju.'],['Einige Änderungen sind noch nicht übertragen. Trotzdem abmelden?','Some changes have not been sent yet. Sign out anyway?','Neke promjene još nisu poslane. Ipak se odjaviti?'],
['Keine Verbindung zum Server. Prüfe das Internet.','No connection to the server. Check the internet.','Nema veze s poslužiteljem. Provjeri internet.'],['E-Mail oder Passwort stimmt nicht.','Email or password is wrong.','E-pošta ili lozinka nije točna.'],['E-Mail oder Wiederherstellungscode stimmt nicht.','Email or recovery code is wrong.','E-pošta ili kod za oporavak nije točan.'],['Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.','Too many attempts. Please try again in 15 minutes.','Previše pokušaja. Pokušaj ponovno za 15 minuta.'],['Für diese E-Mail-Adresse ist die Registrierung nicht freigeschaltet.','Registration is not enabled for this email address.','Registracija za ovu adresu e-pošte nije omogućena.'],['Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.','An account already exists for this email. Please sign in.','Za ovu e-poštu već postoji račun. Prijavi se.'],['Beim Server fehlt die Datenbank (Bindung DB).','The server is missing the database (binding DB).','Poslužitelju nedostaje baza podataka (veza DB).'],['Der Server erlaubt diese App-Adresse nicht (ALLOWED_ORIGIN).','The server does not allow this app address (ALLOWED_ORIGIN).','Poslužitelj ne dopušta ovu adresu aplikacije (ALLOWED_ORIGIN).'],
['Bankverbindung ist für dein Konto nicht freigeschaltet.','Bank connection is not enabled for your account.','Bankovna veza nije omogućena za tvoj račun.']);
PREFIX.push(['Synchronisiert ','Synced ','Sinkronizirano ']);
I18N.push(['Bankverbindungen','Bank connections','Bankovne veze'],['Regeln & Kategorien','Rules & categories','Pravila i kategorije'],['Konto, Sicherheit & Backup','Account, security & backup','Račun, sigurnost i sigurnosna kopija'],
 ['Bank verbinden','Connect bank','Poveži banku'],['Umsätze kommen dann automatisch','Transactions then arrive automatically','Transakcije tada stižu automatski'],['Noch nicht abgerufen','Not fetched yet','Još nije dohvaćeno'],
 ['Automatischer Abruf','Automatic fetch','Automatsko dohvaćanje'],['Jetzt abrufen','Fetch now','Dohvati sada'],['Wird eingerichtet …','Setting up …','Postavlja se …'],
 ['Der Server unterstützt den automatischen Abruf noch nicht. Bis dahin ruft die App beim Öffnen ab.','The server does not support automatic fetching yet. Until then the app fetches when opened.','Poslužitelj još ne podržava automatsko dohvaćanje. Do tada aplikacija dohvaća pri otvaranju.'],
 ['Monat','Month','Mjesec'],['Jahr','Year','Godina'],['Alles','All','Sve'],['Alle Zahlungen','All payments','Sva plaćanja'],['Keine Zahlungen in diesem Zeitraum.','No payments in this period.','Nema plaćanja u tom razdoblju.'],
 ['Deine Daten werden verschlüsselt mit deinem Konto synchronisiert. Ein zusätzliches Backup schadet trotzdem nicht.','Your data is synced encrypted with your account. An extra backup still does no harm.','Tvoji podaci šifrirano se sinkroniziraju s tvojim računom. Dodatna sigurnosna kopija ipak ne škodi.'],
 ['Steht das Stichwort im Umsatz, wird er beim Abruf oder Hochladen automatisch einsortiert.','If the keyword appears in a transaction, it is sorted automatically when fetched or uploaded.','Ako se ključna riječ pojavi u transakciji, automatski se razvrstava pri dohvaćanju ili učitavanju.']);
PREFIX.push(['Bank · ','Bank · ','Banka · '],['Zuletzt heute ','Last today ','Zadnje danas '],['Zuletzt ','Last ','Zadnje '],['Nächster Abruf ','Next fetch ','Sljedeće dohvaćanje '],
 ['Die Umsätze werden täglich um ','Transactions are fetched daily at ','Transakcije se dohvaćaju svaki dan u '],[' Zahlungen · ',' payments · ',' plaćanja · ']);
I18N.push(['Wunschliste','Wish list','Lista želja'],['+ Wunsch','+ Wish','+ Želja'],['Sparplan','Savings plan','Plan štednje'],['Normal','Normal','Normalno'],['Aggressiv','Aggressive','Agresivno'],
 ['Neuer Wunsch','New wish','Nova želja'],['Wunsch bearbeiten','Edit wish','Uredi želju'],['Was möchtest du kaufen?','What do you want to buy?','Što želiš kupiti?'],['Preis (€)','Price (€)','Cijena (€)'],['Schon gespart (€)','Already saved (€)','Već ušteđeno (€)'],
 ['Hier sparst du','Where you save','Ovdje štediš'],['Nicht anfassen','Leave as is','Ne diraj'],['Doch sparen','Save here after all','Ipak štedi'],['Bleibt jetzt','Left now','Sada ostaje'],['Pro Monat','Per month','Mjesečno'],
 ['Einzelne Posten ansehen','View individual items','Pogledaj pojedine stavke'],['Noch zu wenig Daten','Not enough data yet','Još premalo podataka'],
 ['Was möchtest du dir kaufen? Trag es ein, dann rechnet die App aus, wann du es dir leisten kannst und wo du dafür sparen kannst.','What would you like to buy? Enter it and the app works out when you can afford it and where you can save for it.','Što si želiš kupiti? Upiši, a aplikacija izračuna kada si to možeš priuštiti i gdje za to možeš štedjeti.'],
 ['Der Plan ist eine Rechnung aus deinen Buchungen, keine Finanzberatung. Was verzichtbar ist, entscheidest du.','The plan is a calculation from your transactions, not financial advice. You decide what is dispensable.','Plan je izračun iz tvojih knjiženja, a ne financijski savjet. Što je suvišno, odlučuješ ti.'],
 ['Glückwunsch! Wunsch erfüllt.','Congratulations! Wish fulfilled.','Čestitamo! Želja ispunjena.']);
PREFIX.push(['Sparplan ansehen · ','View savings plan · ','Pogledaj plan štednje · '],['Ohne Sparen: ','Without saving: ','Bez štednje: '],['Mit Sparplan: ','With savings plan: ','S planom štednje: '],['Schon gespart: ','Already saved: ','Već ušteđeno: ']);
I18N.push(['Was bleibt im Monat übrig?','What is left per month?','Što ostaje mjesečno?'],['Eigener Betrag pro Monat (€)','Own amount per month (€)','Vlastiti iznos mjesečno (€)'],['Zurück','Back','Natrag'],['Einnahmen und Ausgaben','Income and expenses','Prihodi i rashodi'],['Bleibt jetzt ›','Left now ›','Sada ostaje ›']);
I18N.push(['Zählt','Counts','Računa se'],['Zählt nicht','Not counted','Ne računa se'],['Übliche Ausgaben','Usual expenses','Uobičajeni rashodi'],['Bleibt im Monat','Left per month','Ostaje mjesečno'],['Regelmäßige Einnahmen minus übliche Ausgaben','Regular income minus usual expenses','Redoviti prihodi minus uobičajeni rashodi']);
PREFIX.push(['Regelmäßige Einnahmen · ','Regular income · ','Redoviti prihodi · '],['Einmalig oder unregelmäßig','One-off or irregular','Jednokratno ili neredovito']);
/* Immobilien aus: keine Miet-/Vertrags-/Modernisierungs-Hinweise, keine Rücklagen-Tipps */
{const _r=remindItems;remindItems=function(){if(immoOn())return _r();const u=S.units,p=S.plans;S.units=[];S.plans=[];try{return _r()}finally{S.units=u;S.plans=p}}}
{const _c=cashTips;cashTips=function(){if(immoOn())return _c();const r=S.reserve,p=S.plans;S.reserve=null;S.plans=[];try{return _c()}finally{S.reserve=r;S.plans=p}}}
function immoAsk(){if(!S||locked||authOpen)return;S.settings=S.settings||{};if(S.settings.immo!=null)return;
  if(S.props.length||S.units.length){S.settings.immo=true;return}
  if(!$('#modal')||!$('#modal').hidden||BK_CB)return;
  modal('<h3>Hast du vermietete Immobilien?</h3><p class="hint">Dann zeigt die App einen eigenen Bereich für Mieteingang, Mieter, Zähler und Modernisierung. Du kannst das später unter Mehr → Konto, Sicherheit & Backup ändern.</p><div class="mact"><button data-act="immoAsk" data-v="0">Nein</button><button class="primary" data-act="immoAsk" data-v="1">Ja</button></div>')}
{const _rg2=runGo;runGo=function(){_rg2();setTimeout(()=>{immoAsk();creditAsk()},1200)}}
I18N.push(['Immobilien verwenden','Use properties','Koristi nekretnine'],['Hast du vermietete Immobilien?','Do you have rental properties?','Imaš li nekretnine u najmu?'],['Ja','Yes','Da'],['Nein','No','Ne'],['Ausgaben nach Kategorie','Expenses by category','Rashodi po kategoriji'],
 ['Immobilien sind eingeschaltet.','Properties are switched on.','Nekretnine su uključene.'],['Immobilien sind ausgeblendet. Deine Daten bleiben gespeichert.','Properties are hidden. Your data stays saved.','Nekretnine su skrivene. Tvoji podaci ostaju spremljeni.'],
 ['Für vermietete Wohnungen und Häuser: Mieteingang, Mieter, Zähler, Modernisierung. Wenn du keine hast, schalte den Bereich aus. Es wird nichts gelöscht.','For rented flats and houses: rent received, tenants, meters, modernisation. If you have none, switch the section off. Nothing is deleted.','Za iznajmljene stanove i kuće: najam, najmoprimci, brojila, modernizacija. Ako ih nemaš, isključi ovaj dio. Ništa se ne briše.'],
 ['Dann zeigt die App einen eigenen Bereich für Mieteingang, Mieter, Zähler und Modernisierung. Du kannst das später unter Mehr → Konto, Sicherheit & Backup ändern.','Then the app shows a separate section for rent, tenants, meters and modernisation. You can change this later under More → Account, security & backup.','Tada aplikacija prikazuje poseban dio za najam, najmoprimce, brojila i modernizaciju. To možeš kasnije promijeniti pod Više → Račun, sigurnost i sigurnosna kopija.']);
I18N.push(['Gelernte Zuordnungen','Learned assignments','Naučena razvrstavanja'],['Noch nichts gelernt.','Nothing learned yet.','Još ništa nije naučeno.'],
 ['Ordnest du einen Umsatz zu, merkt sich die App den Empfänger. Alle offenen und alle neuen Umsätze von ihm werden genauso einsortiert.','When you assign a transaction, the app remembers the payee. All open and all new transactions from them are sorted the same way.','Kad razvrstaš transakciju, aplikacija pamti primatelja. Sve otvorene i sve nove transakcije od njega razvrstavaju se jednako.']);
PREFIX.push(['Gemerkt. ','Remembered. ','Zapamćeno. ']);
I18N.push(['Doppelte prüfen','Check duplicates','Provjeri duplikate'],['Eine löschen','Delete one','Obriši jednu'],['Beide behalten','Keep both','Zadrži obje'],['Keine doppelten Umsätze gefunden.','No duplicate transactions found.','Nema dvostrukih transakcija.'],
 ['Gleicher Betrag und Absender innerhalb von 2 Tagen','Same amount and sender within 2 days','Isti iznos i pošiljatelj unutar 2 dana'],['Vergleiche mit deinem Konto bei der Bank. Steht die Zahlung dort nur einmal, lösche eine.','Compare with your bank account. If the payment appears there only once, delete one.','Usporedi s računom u banci. Ako je uplata tamo samo jednom, obriši jednu.']);
PREFIX.push(['Doppelte prüfen (','Check duplicates (','Provjeri duplikate (']);
I18N.push(['Obere löschen','Delete upper','Obriši gornju'],['Untere löschen','Delete lower','Obriši donju']);
I18N.push(['Rendite','Yield','Prinos'],['Notizen & Unterlagen','Notes & documents','Bilješke i dokumenti'],['+ Notiz','+ Note','+ Bilješka'],['Neue Notiz','New note','Nova bilješka'],['Notiz bearbeiten','Edit note','Uredi bilješku'],['Titel','Title','Naslov'],['Text','Text','Tekst'],
 ['Kaufpreis eintragen','Enter purchase price','Unesi kupovnu cijenu'],['Ohne Kaufpreis kann die App keine Rendite rechnen.','Without a purchase price the app cannot calculate the yield.','Bez kupovne cijene aplikacija ne može izračunati prinos.'],['Was bedeuten die Zahlen?','What do the numbers mean?','Što znače brojevi?'],
 ['Brutto','Gross','Bruto'],['Netto','Net','Neto'],['Überschuss','Surplus','Višak'],['Amortisiert','Paid back','Isplaćeno'],['schwach','weak','slabo'],['solide','solid','solidno'],['gut','good','dobro'],
 ['Steuer auf Mieteinnahmen','Tax on rental income','Porez na najamninu'],['Kauf und Investitionen','Purchase and investments','Kupnja i ulaganja'],['Was','What','Što'],['Vertrag bei der Porezna gemeldet?','Contract reported to the tax office?','Ugovor prijavljen Poreznoj?'],['Ja, erledigt oder vom Notar','Yes, done or by the notary','Da, obavljeno ili putem javnog bilježnika'],['Nein, muss ich noch einreichen','No, still need to submit','Ne, moram još predati']);
PREFIX.push(['Mietvertrag melden ','Report rental contract ','Prijavi ugovor o najmu '],['Geräte ','Appliances ','Uređaji ']);
I18N.push(['Verträge & Dokumente','Contracts & documents','Ugovori i dokumenti'],['+ Vertrag','+ Contract','+ Ugovor'],['Dokument speichern','Save document','Spremi dokument'],['Bezeichnung','Name','Naziv'],['Betrifft nicht (kein Mietvertrag)','Not applicable (no rental contract)','Ne odnosi se (nije ugovor o najmu)'],
 ['Lade den Mietvertrag als PDF oder Foto hoch. Er wird verschlüsselt gespeichert, nur du kannst ihn öffnen.','Upload the rental contract as PDF or photo. It is stored encrypted, only you can open it.','Učitaj ugovor o najmu kao PDF ili fotografiju. Sprema se šifrirano, samo ga ti možeš otvoriti.'],['Dokument gespeichert.','Document saved.','Dokument spremljen.'],['Wird geladen …','Loading …','Učitava se …']);
I18N.push(['Anteil am Kaufpreis (€, optional)','Share of purchase price (€, optional)','Udio u kupovnoj cijeni (€, neobavezno)']);PREFIX.push(['Pro Wohnung (','Per flat (','Po stanu (']);
I18N.push(['Heutiger Wert (€, optional)','Current value (€, optional)','Današnja vrijednost (€, neobavezno)'],['Stand','As of','Stanje'],['Wertzuwachs seit Kauf','Value gain since purchase','Porast vrijednosti od kupnje'],['Netto-Rendite auf heutigen Wert','Net yield on current value','Neto prinos na današnju vrijednost'],['Heutigen Wert eintragen','Enter current value','Unesi današnju vrijednost']);PREFIX.push(['Heutiger Wert','Current value','Današnja vrijednost']);
I18N.push(['Wohnfläche (m², optional)','Living area (m², optional)','Stambena površina (m², neobavezno)']);
{const _rc=remindItems;remindItems=function(){const out=_rc();if(creditOn())(S.credits||[]).forEach(c=>{if(!c.fixedUntil)return;const d=c.fixedUntil+'-01',n=daysTo(d);if(n<=365&&n>-60)out.push({date:d,t:'Zinsbindung endet: '+c.name,s:'Sprich rechtzeitig mit der Bank über die Anschlussfinanzierung und hol Vergleichsangebote ein.',lvl:n<90?'late':'partial'})});return out.sort((a,b)=>a.date.localeCompare(b.date))}}
I18N.push(['Kredite','Loans','Krediti'],['+ Kredit','+ Loan','+ Kredit'],['Neuer Kredit','New loan','Novi kredit'],['Kredit bearbeiten','Edit loan','Uredi kredit'],['Bezeichnung','Name','Naziv'],['Bank','Bank','Banka'],['Restschuld (€)','Remaining debt (€)','Ostatak duga (€)'],['Stand am','As of','Stanje na dan'],
 ['Zinssatz (% im Jahr)','Interest rate (% per year)','Kamatna stopa (% godišnje)'],['Rate im Monat (€)','Monthly payment (€)','Mjesečna rata (€)'],['Ursprüngliche Summe (€)','Original amount (€)','Izvorni iznos (€)'],['Zinsbindung bis','Fixed rate until','Fiksna kamata do'],['Gehört zu','Belongs to','Pripada'],
 ['Restschuld heute','Remaining debt today','Ostatak duga danas'],['Rate im Monat','Monthly payment','Mjesečna rata'],['davon Zinsen','of which interest','od toga kamate'],['davon Tilgung','of which repayment','od toga otplata glavnice'],['Abbezahlt','Paid off','Otplaćeno'],['Zinsen bis dahin','Interest until then','Kamate do tada'],
 ['Sondertilgung','Extra repayment','Izvanredna otplata'],['Berechnen','Calculate','Izračunaj'],['Zinsen gespart','Interest saved','Ušteđene kamate'],['Früher fertig','Finished earlier','Ranije gotovo'],['Neu abbezahlt','New payoff date','Novi datum otplate'],['Raten ansehen','View payments','Pogledaj rate'],
 ['Kreditrate','Loan payment','Rata kredita'],['Kreditrate im Monat','Loan payment per month','Rata kredita mjesečno'],['Überschuss nach Rate','Surplus after payment','Višak nakon rate'],['Restschuld','Remaining debt','Ostatak duga'],['Eigenkapital eingesetzt','Equity invested','Uloženi vlastiti kapital'],['Rendite auf Eigenkapital','Return on equity','Prinos na vlastiti kapital'],
 ['Kredite verwenden','Use loans','Koristi kredite'],['Hast du Kredite bei einer Bank?','Do you have bank loans?','Imaš li kredite u banci?'],['Netto','Net','Neto'],['Diesen Kredit löschen?','Delete this loan?','Obrisati ovaj kredit?'],
 ['+ Verliehen','+ Lent','+ Posuđeno'],['Geld verliehen','Money lent','Posuđen novac'],['Rückzahlung eintragen','Enter repayment','Unesi povrat'],['Weiter verliehen','Lent more','Još posuđeno'],['Person','Person','Osoba'],['Verliehen','Lent','Posuđeno'],['Zurückbekommen','Received back','Vraćeno'],['Alles zurückgezahlt.','Everything repaid.','Sve je vraćeno.'],
 ['Hast du jemandem Geld geliehen? Trag es hier ein, auch Bargeld. Die App merkt sich, was noch offen ist.','Have you lent someone money? Enter it here, cash too. The app remembers what is still open.','Jesi li nekome posudio novac? Upiši ovdje, i gotovinu. Aplikacija pamti što je još otvoreno.']);
PREFIX.push(['Zinsbindung endet: ','Fixed rate ends: ','Fiksna kamata istječe: '],['Schuldet dir noch ','Still owes you ','Još ti duguje '],['Du schuldest ','You owe ','Duguješ ']);
I18N.push(['Mitzählen','Count it','Uračunaj'],['Rausnehmen','Leave out','Izuzmi'],['Zählt als regelmäßige Einnahme mit.','Counts as regular income.','Računa se kao redoviti prihod.'],['Zählt nicht mit.','Not counted.','Ne računa se.']);
I18N.push(['Dein Stand · üblicher Monat','Your status · typical month','Tvoje stanje · uobičajeni mjesec'],['Rechnung ansehen','View calculation','Pogledaj izračun'],['Keine regelmäßige Einnahme erkannt','No regular income detected','Nije prepoznat redoviti prihod'],['Tippe auf „Rechnung ansehen“ und wähle, welche Einnahmen jeden Monat kommen.','Tap "View calculation" and choose which income arrives every month.','Dodirni „Pogledaj izračun“ i odaberi koji prihodi stižu svaki mjesec.']);
I18N.push(['Alle rausnehmen','Leave all out','Izuzmi sve'],['Keine Buchung ist ausgewählt.','No transaction is selected.','Nijedna transakcija nije odabrana.'],['Mit dem Haken wählst du bei jeder Buchung, ob sie zum regelmäßigen Einkommen gehört. Einmalige Rechnungen nimmst du so heraus.','Use the tick to choose for each transaction whether it belongs to your regular income. This is how you take out one-off invoices.','Kvačicom za svaku transakciju biraš pripada li redovitom prihodu. Tako izuzimaš jednokratne račune.']);
/* ---------- Eingangsrechnungen (Gmail → Worker → App) ---------- */
var RBA_PKG='co.infinum.rba.eva';
var billBusy=false,billT=0;
function bills(){return S.bills||(S.bills=[])}
function billOpen(){return bills().filter(b=>b.status==='open')}
function mailOn(){return !!(S.mail&&S.mail.on)}
function slug(s){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[đĐ]/g,'d').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,30)||'Racun'}
function hrNum(s){s=String(s||'').trim();if(!s)return NaN;if(/,\d{1,2}$/.test(s))s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');return parseFloat(s)}
function parseHub3(t){const L=String(t).replace(/\r/g,'').split('\n');if(!/^HRVHUB30/i.test(L[0]||''))return null;
  const amt=parseInt((L[2]||'').replace(/\D/g,''),10)/100;
  return {kind:'hub3',cur:(L[1]||'EUR').trim(),amount:isFinite(amt)?amt:null,payee:(L[6]||'').trim(),payeeAddr:[(L[7]||'').trim(),(L[8]||'').trim()].filter(Boolean).join(', '),iban:(L[9]||'').replace(/\s/g,'').toUpperCase(),ref:[(L[10]||'').trim(),(L[11]||'').trim()].filter(Boolean).join(' '),purpose:(L[13]||'').trim()}}
function parseEpc(t){const L=String(t).replace(/\r/g,'').split('\n');if((L[0]||'').trim()!=='BCD')return null;
  const m=(L[7]||'').match(/^([A-Z]{3})?([\d.]+)/);
  return {kind:'epc',cur:(m&&m[1])||'EUR',amount:m?parseFloat(m[2]):null,payee:(L[5]||'').trim(),iban:(L[6]||'').replace(/\s/g,'').toUpperCase(),ref:(L[9]||'').trim(),purpose:(L[10]||L[9]||'').trim()}}
function textGuess(text){const T=String(text||'').replace(/\s+/g,' ');const o={};
  const dm=T.match(/(datum\s+dospije.{1,3}a|rok\s+(?:za\s+)?pla.{1,3}anj[ae]|dospije.{1,3}e|valuta\s+pla.{1,3}anja|platiti\s+do|f.{1,2}llig(?:\s+am|\s+bis)?|zahlbar\s+bis|zahlungsziel|due\s+date)[^0-9]{0,25}(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/i);
  if(dm){let y=+dm[4];if(y<100)y+=2000;o.due=y+'-'+String(dm[3]).padStart(2,'0')+'-'+String(dm[2]).padStart(2,'0')}
  const am=T.match(/(ukupno\s+za\s+(?:platiti|pla.{1,3}anje)|za\s+platiti|iznos\s+za\s+pla.{1,3}anje|ukupan\s+iznos|ukupno|gesamtbetrag|rechnungsbetrag|zu\s+zahlen|endbetrag|total)[^0-9]{0,30}(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+(?:[.,]\d{2}))/i);
  if(am){const v=hrNum(am[2].replace(/\s/g,''));if(v>0)o.amount=v}
  const ib=T.match(/\b(HR\d{2}\s?(?:\d{4}\s?){4}\d{1}|DE\d{2}\s?(?:\d{4}\s?){4}\d{2})\b/);if(ib)o.iban=ib[1].replace(/\s/g,'');
  return o}
async function scanBill(bytes,type){const out={text:'',code:'',fmt:'',crop:''};const cv=[];
  try{if(/pdf/i.test(type)){const L=await loadPdfjs();const doc=await L.getDocument({data:bytes.slice(0)}).promise;
      for(let p=1;p<=Math.min(doc.numPages,3);p++){const pg=await doc.getPage(p);try{const tc=await pg.getTextContent();out.text+=tc.items.map(i=>i.str).join(' ')+'\n'}catch(e){}
        const vp=pg.getViewport({scale:3});const c=document.createElement('canvas');c.width=Math.round(vp.width);c.height=Math.round(vp.height);const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);await pg.render({canvasContext:x,viewport:vp}).promise;cv.push(c)}}
    else{const bmp=await createImageBitmap(new Blob([bytes],{type}));const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;c.getContext('2d').drawImage(bmp,0,0);cv.push(c)}}catch(e){out.err='render'}
  if(!('BarcodeDetector' in window)){out.noDetector=true;return out}
  let det;try{det=new BarcodeDetector({formats:['pdf417','qr_code']})}catch(e){out.noDetector=true;return out}
  let best=null;
  for(const c of cv){let L=[];try{L=await det.detect(c)}catch(e){}
    for(const r of L){const v=r.rawValue||'';const score=/^HRVHUB30/i.test(v)?3:/^BCD\n/.test(v)?2:1;if(!best||score>best.score)best={score,r,c}}
    if(best&&best.score>=2)break}
  if(best){out.code=best.r.rawValue;out.fmt=best.r.format;const bb=best.r.boundingBox,c=best.c;
    const m=Math.max(bb.width,bb.height)*0.08,x0=Math.max(0,bb.x-m),y0=Math.max(0,bb.y-m),w=Math.min(c.width-x0,bb.width+2*m),h=Math.min(c.height-y0,bb.height+2*m);
    const k=Math.max(1,900/w),o=document.createElement('canvas');o.width=Math.round(w*k)+80;o.height=Math.round(h*k)+80;const g=o.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,o.width,o.height);g.imageSmoothingEnabled=false;g.drawImage(c,x0,y0,w,h,40,40,w*k,h*k);out.crop=o.toDataURL('image/png')}
  return out}
async function openSealed(text){const o=JSON.parse(text),ek=bk().ek;if(!ek)throw new Error('nokey');
  const priv=await crypto.subtle.importKey('jwk',ek.priv,{name:'ECDH',namedCurve:'P-256'},false,['deriveKey']);
  const pub=await crypto.subtle.importKey('jwk',o.epk,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const key=await crypto.subtle.deriveKey({name:'ECDH',public:pub},priv,{name:'AES-GCM',length:256},false,['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:b64d(o.iv)},key,b64d(o.ct)))}
async function mailFile(fid){const r=await fetch(SRV+'/file/'+encodeURIComponent(fid),{headers:{Authorization:'Bearer '+acct.token}});if(!r.ok)throw new Error('file');return await openSealed(await r.text())}
function billWhere(b,text){const T=String(text||'')+' '+(b.ref||'')+' '+(b.purpose||'');const N=T.replace(/[^0-9A-Za-z]/g,'').toUpperCase();let best=null;
  for(const m of S.meterDevs||[]){for(const k of ['number','omm','account','code']){const v=String(m[k]||'').replace(/[^0-9A-Za-z]/g,'').toUpperCase();if(v.length<4)continue;if(N.includes(v)&&(!best||v.length>best.len))best={m,len:v.length}}}
  if(best){const m=best.m;b.meterId=m.id;b.propertyId=m.propertyId;b.place=m.place||'';b.kind=m.kind||'';return}
  const low=T.toLowerCase();for(const p of S.props||[]){const st=String(p.address||'').toLowerCase().split(',')[0].trim();if(st.length>=6&&low.includes(st)){b.propertyId=p.id;return}}}
function billWhereText(b){const p=propOf(b.propertyId);if(!p)return '';return [p.name,b.place,b.kind].filter(Boolean).join(' · ')}
async function billFromMail(meta){const id=uid(),f=(meta.files||[])[0];
  const b={id,mid:meta.id,from:meta.from||'',subject:meta.subject||'',recv:(meta.date||new Date().toISOString()).slice(0,10),files:meta.files||[],status:'open',created:Date.now()};
  const em=(b.from.match(/<([^>]+)>/)||[0,b.from])[1].trim().toLowerCase();b.email=em;
  b.payee=(b.from.replace(/<[^>]*>/,'').replace(/"/g,'').trim())||em;
  let scan=null;for(const ff of meta.files||[]){try{const bytes=await mailFile(ff.fid);const s=await scanBill(bytes,ff.type);if(!scan||(s.code&&!scan.code))scan=s;if(s.code)break}catch(e){}}
  const g=textGuess((scan&&scan.text||'')+' '+(meta.text||''));
  const p=scan&&scan.code?(parseHub3(scan.code)||parseEpc(scan.code)):null;
  if(p){b.amount=p.amount;b.payee=p.payee||b.payee;b.iban=p.iban;b.ref=p.ref;b.purpose=p.purpose;b.code=p.kind}
  billWhere(b,(scan&&scan.text||'')+' '+(meta.text||'')+' '+(meta.subject||''));
  if(b.amount==null&&g.amount)b.amount=g.amount;if(!b.iban&&g.iban)b.iban=g.iban;if(g.due)b.due=g.due;
  if(scan&&scan.crop)try{await idbSet(KV,'bc:'+id,scan.crop)}catch(e){}
  b.hasCode=!!(scan&&scan.crop);b.noDetector=!!(scan&&scan.noDetector);
  return b}
async function mailPull(){if(billBusy||!loggedIn()||!mailOn()||!bk().ek)return 0;billBusy=true;billT=Date.now();let added=0;
  try{const j=await bkApi('/mail/inbox');const ids=[];
    for(const it of j.items||[]){let meta;try{meta=JSON.parse(new TextDecoder().decode(await openSealed(it.meta)))}catch(e){continue}
      const em=((meta.from||'').match(/<([^>]+)>/)||[0,meta.from||''])[1].trim().toLowerCase();
      if(bills().some(b=>b.mid===meta.id)){ids.push(it.id);continue}
      if((S.billIgnore||[]).includes(em)){ids.push(it.id);for(const f of meta.files||[])bkApi('/file/'+f.fid,{method:'DELETE'}).catch(()=>{});continue}
      bills().unshift(await billFromMail(meta));ids.push(it.id);added++}
    if(ids.length){save();await bkApi('/mail/ack',{method:'POST',body:JSON.stringify({ids})})}
    if(billMatch()||added){save();render()}
    if(added)toast(added===1?'Neue Rechnung eingegangen.':added+' neue Rechnungen eingegangen.')}
  catch(e){}finally{billBusy=false}return added}
function billMatch(){let n=0;const used=new Set(bills().filter(b=>b.paidTx).map(b=>b.paidTx));
  for(const b of billOpen()){if(!(b.amount>0))continue;const from=Date.parse(b.recv||todayISO())-3*864e5;
    const C=S.txs.filter(t=>t.amount<0&&Math.abs(t.amount+b.amount)<0.011&&Date.parse(t.date)>=from&&!used.has(t.id));if(!C.length)continue;
    const ib=String(b.iban||'').replace(/\s/g,'').toUpperCase(),ref=String(b.ref||'').replace(/^HR\d\d\s*/,'').replace(/\s/g,'');
    const strong=C.find(t=>(ib&&String(t.iban||'').replace(/\s/g,'').toUpperCase()===ib)||(b.payee&&nameSim(t.name||'',b.payee))||(ref.length>=4&&String(t.purpose||'').replace(/\s/g,'').includes(ref)));
    const t=strong||(C.length===1&&Date.parse(C[0].date)-from<50*864e5?C[0]:null);
    if(t){b.status='paid';b.paidTx=t.id;b.paidDate=t.date;used.add(t.id);n++;
      if(b.propertyId&&(t.type==='open'||(t.type==='expense'&&!t.propertyId))){const wasOpen=t.type==='open';t.type='expense';t.propertyId=b.propertyId;if(wasOpen||!t.category){const c=(S.cats||[]).find(c=>b.kind&&nrm(c).includes(nrm(b.kind)))||(S.cats||[]).find(c=>/nebenkost|betriebskost|rezij|strom|wasser/i.test(nrm(c)));if(c)t.category=c}}}}
  return n}
function rbaOpen(){location.href='intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package='+RBA_PKG+';S.browser_fallback_url='+encodeURIComponent('https://play.google.com/store/apps/details?id='+RBA_PKG)+';end'}
async function billCodeImg(b){let u=null;try{u=await idbGet(KV,'bc:'+b.id)}catch(e){}
  if(!u&&b.files&&b.files.length){for(const f of b.files){try{const s=await scanBill(await mailFile(f.fid),f.type);if(s.crop){u=s.crop;await idbSet(KV,'bc:'+b.id,u);break}}catch(e){}}}
  return u}
async function billSaveCode(b){const u=await billCodeImg(b);if(!u){toast('Auf dieser Rechnung wurde kein Barcode gefunden.');return false}
  const bl=await (await fetch(u)).blob();dlBlob(bl,'Racun_'+slug(b.payee)+(b.amount?'_'+String(b.amount.toFixed(2)).replace('.',',')+'EUR':'')+'.png');return true}
async function billPay(id){const b=bills().find(x=>x.id===id);if(!b)return;const u=await billCodeImg(b);b.payAt=Date.now();save();
  if(!u){toast('Auf dieser Rechnung wurde kein Barcode gefunden.');return}
  const name='Racun_'+slug(b.payee)+(b.amount?'_'+String(b.amount.toFixed(2)).replace('.',',')+'EUR':'')+'.png';
  const bl=await (await fetch(u)).blob();dlBlob(bl,name);
  const file=new File([bl],name,{type:'image/png'}),data={files:[file]};
  if(navigator.canShare&&navigator.canShare(data)){try{await navigator.share(data);toast('In mojaRBA im Scanner auf das Galerie-Symbol tippen und den Barcode wählen.');return}catch(e){if(e&&e.name==='AbortError')return}}
  toast('Barcode liegt in der Galerie (Album Download). mojaRBA öffnet sich …');setTimeout(rbaOpen,1400)}
async function billView(id){const b=bills().find(x=>x.id===id);if(!b||!b.files||!b.files[0])return;const f=b.files[0];const w=window.open('','_blank');
  try{const bytes=await mailFile(f.fid);const url=URL.createObjectURL(new Blob([bytes],{type:f.type}));if(w)w.location.href=url;else{const a=document.createElement('a');a.href=url;a.download=f.name;a.click()}setTimeout(()=>URL.revokeObjectURL(url),120000)}
  catch(e){if(w)w.close();toast('Die Rechnung konnte nicht geladen werden.')}}
function billDue(b){if(!b.due)return '';const d=daysTo(b.due);return d<0?'seit '+(-d)+(d===-1?' Tag':' Tagen')+' fällig':d===0?'heute fällig':'fällig in '+d+(d===1?' Tag':' Tagen')}
function billRow(b,compact){const late=b.due&&daysTo(b.due)<0&&b.status==='open';
  return '<div class="bill'+(b.status!=='open'?' done':'')+(late?' late':'')+'"><div class="bhead"><span class="bic">'+ICON.bill+'</span><span class="bt2"><b>'+esc(b.payee||'Rechnung')+'</b><small>'+(billWhereText(b)?'<i class="bwhere">'+esc(billWhereText(b))+'</i>':'')+(b.status==='paid'?'Bezahlt am '+dfmt(b.paidDate||todayISO()):b.status==='ignored'?'Keine Rechnung':(b.due?esc(billDue(b))+' · '+dfmt(b.due):'Eingegangen am '+dfmt(b.recv)))+'</small></span><span class="num'+(b.status==='open'?'':' muted')+'">'+(b.amount!=null?eur(b.amount):'–')+'</span></div>'
    +(compact?'':'<div class="bmeta">'+(b.subject?'<small>'+esc(b.subject)+'</small>':'')+(b.iban?'<small>IBAN '+esc(b.iban)+(b.ref?' · '+esc(b.ref):'')+'</small>':'')+(!b.hasCode&&b.status==='open'?'<small class="neg">'+(b.noDetector?'Dieses Gerät kann Barcodes nicht lesen.':'Kein Barcode gefunden.')+'</small>':'')+'</div>')
    +(b.status==='open'?'<div class="form bact"><button class="primary" data-act="billPay" data-id="'+b.id+'">'+ICON.pay+' In mojaRBA bezahlen</button>'+(compact?'':'<button data-act="billCode" data-id="'+b.id+'">Barcode speichern</button><button data-act="billView" data-id="'+b.id+'">Rechnung ansehen</button><button data-act="billMore" data-id="'+b.id+'">…</button>')+'</div>':'')+'</div>'}
function billCard(){if(!mailOn())return '';const L=billOpen();if(!L.length)return '';
  return '<section class="card accent ab"><div class="h2row"><h3><span class="hic">'+ICON.bill+'</span>Rechnungen · '+L.length+' offen</h3><a class="lnk" href="#mehr/bills">Alle ›</a></div>'+L.slice(0,2).map(b=>billRow(b,true)).join('')+'</section>'}
function billPage(){if(!SRV)return '<p class="hint">Für Rechnungen aus Gmail brauchst du ein Konto in der App.</p>';
  if(!loggedIn())return '<section class="group"><p class="hint">Melde dich an, damit Rechnungen aus deiner Gmail automatisch hier erscheinen.</p><button class="primary" data-act="authOpen">Anmelden</button></section>';
  const L=bills(),open=L.filter(b=>b.status==='open'),done=L.filter(b=>b.status!=='open').slice(0,15);
  const pushOk=pushState();
  let h='';
  if(!mailOn()||!pushOk)h+='<section class="card accent ab"><h3>Einrichten</h3><div class="steps">'
    +'<div class="step'+(mailOn()?' ok':'')+'"><span class="sn">1</span><span><b>Gmail verbinden</b><small>Ein kleines Skript in deinem Google-Konto schickt neue Rechnungen verschlüsselt an die App.</small></span>'+(mailOn()?'<em>✓</em>':'<button class="small primary" data-act="mailSetup">Starten</button>')+'</div>'
    +'<div class="step'+(pushOk?' ok':'')+'"><span class="sn">2</span><span><b>Mitteilungen erlauben</b><small>Dein Handy meldet sich, sobald eine Rechnung da ist, auch wenn die App zu ist.</small></span>'+(pushOk?'<em>✓</em>':'<button class="small primary" data-act="pushOn">Erlauben</button>')+'</div></div></section>';
  h+=open.length?'<h3 class="gt lh">Offen · '+open.length+'</h3>'+open.map(b=>billRow(b)).join(''):(mailOn()?'<div class="empty">Keine offenen Rechnungen. Neue Rechnungen aus Gmail erscheinen hier von selbst.</div>':'');
  if(done.length)h+='<h3 class="gt lh">Erledigt</h3>'+done.map(b=>billRow(b,true)).join('');
  if(mailOn())h+='<section class="group"><div class="form"><button data-act="mailPull">Jetzt prüfen</button><button data-act="mailSetup">Skript neu erstellen</button>'+(pushOk?'<button data-act="pushTest">Mitteilung testen</button>':'')+'</div><p class="hint">Das Skript in deinem Google-Konto prüft jede Stunde. Die App hakt Rechnungen von selbst ab, sobald die Zahlung im Bankabruf auftaucht.</p></section>';
  return h}
function scriptText(u){return [
'// DJ Capital – Rechnungen aus Gmail',
'// Läuft in deinem eigenen Google-Konto. Schickt neue Rechnungen verschlüsselt an deine App.',
'// Suchbegriffe kannst du unten bei SUCHE anpassen.',
'var ZIEL = "'+u+'";',
'var SUCHE = \'has:attachment newer_than:3d -in:sent -label:djc (filename:pdf OR filename:jpg OR filename:png) (rechnung OR račun OR racun OR faktura OR invoice OR uplatnica OR "za plaćanje" OR "zur zahlung")\';',
'',
'function einrichten() {',
'  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });',
'  ScriptApp.newTrigger("pruefen").timeBased().everyHours(1).create();',
'  pruefen();',
'}',
'',
'function pruefen() {',
'  var lab = GmailApp.getUserLabelByName("djc") || GmailApp.createLabel("djc");',
'  GmailApp.search(SUCHE, 0, 20).forEach(function (th) {',
'    var ok = true;',
'    th.getMessages().forEach(function (m) {',
'      var files = m.getAttachments().filter(function (a) {',
'        return /^(application\\/pdf|image\\/(jpeg|png))$/i.test(a.getContentType()) && a.getSize() < 6000000;',
'      }).slice(0, 5).map(function (a) {',
'        return { name: a.getName(), type: a.getContentType(), data: Utilities.base64Encode(a.getBytes()) };',
'      });',
'      if (!files.length) return;',
'      var r = UrlFetchApp.fetch(ZIEL, { method: "post", contentType: "application/json", muteHttpExceptions: true,',
'        payload: JSON.stringify({ id: m.getId(), from: m.getFrom(), subject: m.getSubject(), date: m.getDate().toISOString(), text: m.getPlainBody().slice(0, 3000), files: files }) });',
'      if (r.getResponseCode() !== 200) ok = false;',
'    });',
'    if (ok) th.addLabel(lab);',
'  });',
'}'].join('\n')}
async function mailSetup(){if(!loggedIn())return;let j;try{const ek=await bkKeys();j=await bkApi('/mail/setup',{method:'POST',body:JSON.stringify({pub:JSON.stringify(ek.pub)})})}catch(e){toast('Der Server ist nicht erreichbar. Ist der neue Worker eingespielt?');return}
  S.mail={on:true,since:Date.now()};save();render();const code=scriptText(j.url);
  modal('<div class="mhead"><div><h3>Gmail verbinden</h3><small>Einmalig, dauert etwa 3 Minuten</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'
    +'<ol class="howto"><li>Tippe auf <b>Skript kopieren</b>.</li><li>Öffne <b>script.google.com</b> (am besten am Computer), melde dich mit deinem Gmail-Konto an und tippe auf <b>Neues Projekt</b>.</li><li>Lösche den vorhandenen Text, füge das Skript ein und speichere (Diskette oben).</li><li>Wähle oben die Funktion <b>einrichten</b> und tippe auf <b>Ausführen</b>.</li><li>Google fragt nach Berechtigungen: <b>Berechtigungen prüfen</b> → dein Konto → <b>Erweitert</b> → <b>Zu Unbenanntes Projekt (unsicher) wechseln</b> → <b>Zulassen</b>. Die Warnung kommt, weil Google dein eigenes Skript nicht geprüft hat.</li><li>Fertig. Das Skript schaut jetzt jede Stunde nach neuen Rechnungen.</li></ol>'
    +'<textarea id="f-script" class="code" readonly rows="8">'+esc(code)+'</textarea><div class="mact"><button data-act="close">Schließen</button><button class="primary" data-act="copyScript">Skript kopieren</button></div>'
    +'<p class="hint">Im Skript steht ein geheimer Schlüssel nur für dein Konto. Gib es nicht weiter. „Skript neu erstellen“ macht den alten Schlüssel ungültig.</p>')}
function pushState(){try{return 'Notification' in window&&Notification.permission==='granted'&&!!localStorage.getItem('djc-push')}catch(e){return false}}
function b64uDec(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function pushOn(){if(!loggedIn())return;if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){toast('Dieses Gerät oder dieser Browser kann keine Mitteilungen empfangen. Installiere die App über Chrome.');return}
  const perm=await Notification.requestPermission();if(perm!=='granted'){toast('Mitteilungen sind blockiert. Erlaube sie in den Einstellungen des Handys für My Capital.');return}
  try{const reg=await navigator.serviceWorker.ready;const {key}=await bkApi('/push/key');let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64uDec(key)});
    await bkApi('/push/sub',{method:'POST',body:JSON.stringify({sub:sub.toJSON()})});localStorage.setItem('djc-push',sub.endpoint);render();toast('Mitteilungen sind eingeschaltet.')}
  catch(e){toast('Mitteilungen konnten nicht eingeschaltet werden.')}}
async function pushOff(){try{const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();if(sub){await bkApi('/push/sub',{method:'DELETE',body:JSON.stringify({endpoint:sub.endpoint})}).catch(()=>{});await sub.unsubscribe()}}catch(e){}localStorage.removeItem('djc-push');render()}
function billMoreDlg(id){const b=bills().find(x=>x.id===id);if(!b)return;
  modal('<h3>'+esc(b.payee||'Rechnung')+'</h3><div class="grid2"><label>Betrag (€)<input id="f-bamt" inputmode="decimal" value="'+(b.amount!=null?String(b.amount).replace('.',','):'')+'"></label><label>Fällig am<input id="f-bdue" type="date" value="'+esc(b.due||'')+'"></label></div><label>Empfänger<input id="f-bpay" value="'+esc(b.payee||'')+'"></label>'+(immoOn()&&S.props.length?'<label>Für welche Immobilie<select id="f-bprop"><option value="">Privat</option>'+S.props.map(p=>'<option value="'+p.id+'"'+(p.id===b.propertyId?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>':'')
    +'<div class="mact"><button data-act="billPaid" data-id="'+id+'">Schon bezahlt</button><button data-act="billIgnore" data-id="'+id+'">Keine Rechnung</button><button class="primary" data-act="billSave" data-id="'+id+'">Speichern</button></div>')}
document.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act,id=b.dataset.id;
  if(!/^(bill|mail|push|copyScript)/.test(a))return;const B=id?bills().find(x=>x.id===id):null;
  if(a==='billPay')billPay(id);
  else if(a==='billCode'&&B)billSaveCode(B).then(ok=>{if(ok)toast('Barcode gespeichert (Galerie, Album Download).')});
  else if(a==='billView')billView(id);
  else if(a==='billMore')billMoreDlg(id);
  else if(a==='billSave'&&B){const v=hrNum($('#f-bamt').value);B.amount=isFinite(v)?v:null;B.due=$('#f-bdue').value||'';B.payee=$('#f-bpay').value.trim()||B.payee;if($('#f-bprop')){const np=$('#f-bprop').value;if(np!==(B.propertyId||'')){B.propertyId=np;B.meterId='';B.place='';B.kind=''}}closeModal();billMatch();save();render()}
  else if(a==='billPaid'&&B){B.status='paid';B.paidDate=todayISO();closeModal();save();render()}
  else if(a==='billIgnore'&&B){B.status='ignored';if(B.email){S.billIgnore=S.billIgnore||[];if(!S.billIgnore.includes(B.email))S.billIgnore.push(B.email)}closeModal();save();render();toast('Von diesem Absender kommen keine Rechnungen mehr.')}
  else if(a==='mailSetup')mailSetup();
  else if(a==='mailPull')mailPull().then(n=>{if(!n)toast('Keine neuen Rechnungen.')});
  else if(a==='pushOn')pushOn();
  else if(a==='pushOff')pushOff();
  else if(a==='pushTest')bkApi('/push/test',{method:'POST'}).then(j=>toast(j.sent?'Mitteilung ist unterwegs.':'Kein Gerät für Mitteilungen angemeldet.')).catch(()=>toast('Der Server ist nicht erreichbar.'));
  else if(a==='copyScript'){const t=$('#f-script');(navigator.clipboard?navigator.clipboard.writeText(t.value):Promise.reject()).then(()=>toast('Skript kopiert.')).catch(()=>{t.select();document.execCommand('copy');toast('Skript kopiert.')})}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&S&&!locked&&loggedIn()&&mailOn()&&Date.now()-billT>60e3)mailPull()});
setInterval(()=>{if(!document.hidden&&S&&!locked&&loggedIn()&&mailOn())mailPull()},15*60e3);
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',e=>{if(e.data&&e.data.t==='bill'&&S&&loggedIn())mailPull()});
function swBtn(on,act,label,extra){return '<button class="sw'+(on?' on':'')+'" role="switch" aria-checked="'+(on?'true':'false')+'" aria-label="'+esc(label)+'" data-act="'+act+'"'+(extra||'')+'><i></i></button>'}
var SCAT=[[/restaurant|caf|essen geh|lieferdienst/i,'<path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 3-3 6s1 4 3 4v8"/>'],[/shopping|kleidung|amazon|online/i,'<path d="M6 7h12l-1 13H7zM9 7a3 3 0 0 1 6 0"/>'],[/lebensmittel|supermarkt|einkauf/i,'<path d="M3 4h2l2 11h11l2-8H7M9 20h.01M17 20h.01"/>'],[/abo|stream|netflix|spotify/i,'<path d="M3 6h18v11H3zM8 21h8M12 17v4"/>'],[/auto|tank|kfz|benzin/i,'<path d="M5 16l1-5 2-4h8l2 4 1 5zM5 16v3M19 16v3M7 13h.01M17 13h.01"/>'],[/freizeit|hobby|urlaub|reise/i,'<path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8z"/>'],[/drogerie|gesundheit|apotheke/i,'<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>']];
function scatIcon(c){const m=SCAT.find(x=>x[0].test(c));return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(m?m[1]:'<circle cx="12" cy="12" r="4"/>')+'</svg>'}
function wishPlanDlg(){S.settings=S.settings||{};const mode=S.settings.saveMode||'n';const x=wishCalc(mode),o=wishCalc(mode==='a'?'n':'a');
  const W=(S.wishes||[]).filter(w=>!w.done),E0=wishEta(x.base),E=wishEta(x.base+x.extra);const openN=S.txs.filter(t=>t.type==='open').length;
  const pct=w=>Math.min(100,Math.round((+w.saved||0)/((+w.price)||1)*100));
  let h='<div class="mhead"><div><h3>Sparplan</h3><small>Aus deinen Buchungen der letzten Monate</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'
    +'<div class="seg" role="tablist"><button data-act="wishMode" data-v="n"'+(mode==='n'?' class="on" aria-selected="true"':'')+'>Normal</button><button data-act="wishMode" data-v="a" class="'+(mode==='a'?'on ':'')+'aggr"'+(mode==='a'?' aria-selected="true"':'')+'><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-6 1 2 2 3 3 3 0-3-1-5 0-8z"/></svg>Aggressiv</button></div>';
  if(W.length){const e=E[0],d=E0[0].m!=null&&e.m!=null?E0[0].m-e.m:null,p=pct(e.w),C=2*Math.PI*32;
    h+='<section class="goal"><svg viewBox="0 0 80 80" class="ring" aria-hidden="true"><circle cx="40" cy="40" r="32"/><circle cx="40" cy="40" r="32" class="rv" stroke-dasharray="'+(C*p/100).toFixed(1)+' '+C.toFixed(1)+'" transform="rotate(-90 40 40)"/><text x="40" y="45" text-anchor="middle">'+p+' %</text></svg><div><small>Nächstes Ziel</small><b>'+esc(e.w.title)+' · '+eur(+e.w.price||0)+'</b><span class="'+(e.m==null?'neg':'pos')+'">'+(x.has?esc(etaText(e))+(d>0?' · '+d+(d===1?' Monat':' Monate')+' früher':''):'Noch zu wenig Daten')+'</span>'+(+e.w.saved?'<small>'+eur(+e.w.saved)+' schon gespart</small>':'')+'</div></section>'}
  h+='<div class="sec"><span class="sno s1">1</span><b>Dein Monat</b></div><section class="secbox">';
  if(x.has){const inc=Math.max(1,x.wb.inc||0),out=Math.max(0,x.wb.out||0),ex=Math.max(0,x.extra),rest=Math.max(0,inc-out-ex);const P=v=>Math.max(0,Math.min(100,v/inc*100)).toFixed(1);
    h+='<div class="flow" aria-hidden="true"><i class="fo" style="width:'+P(out)+'%"></i><i class="fr" style="width:'+P(rest)+'%"></i><i class="fx" style="width:'+P(ex)+'%"></i></div>'
      +'<div class="g2"><div><small>Einnahmen</small><b class="num">'+eur(Math.round(x.wb.inc||0))+'</b></div><div><small>Ausgaben</small><b class="num neg">'+eur(Math.round(out))+'</b></div><div><small>Bleibt jetzt</small><b class="num'+(x.base<0?' neg':'')+'">'+eur(Math.round(x.base))+'</b></div><div><small>Mit Sparplan</small><b class="num pos">'+eur(Math.round(x.base+x.extra))+' <em class="chip2">+'+eur(x.extra)+'</em></b></div></div>'
      +'<button class="lnk" data-act="wishRate">Rechnung ansehen ›</button>'
      +'<p class="hint">'+(mode==='a'?'Aggressiv: alles Verzichtbare fällt weg. Normal brächte '+eur(o.extra)+' im Monat.':'Normal: überall etwas weniger, ohne großen Verzicht. Aggressiv brächte '+eur(o.extra)+' im Monat.')+'</p>'}
  else h+='<p class="hint">Noch zu wenig Daten. Sobald Umsätze aus drei Monaten da sind, rechnet die App den Plan aus.</p>';
  if(openN)h+='<p class="hint neg">'+openN+' Umsätze sind noch nicht zugeordnet. Der Plan wird genauer, wenn du sie einsortierst.</p>';
  h+='</section><div class="sec"><span class="sno s2">2</span><b>Deine Wünsche</b><button class="small" data-act="wishAdd">+ Wunsch</button></div><section class="secbox">';
  h+=W.length?E.map((e,i)=>'<div class="wrow"><div class="h2row"><b>'+esc(e.w.title)+'</b><span class="num">'+eur(+e.w.price||0)+'</span></div><span class="wbar big"><i style="width:'+pct(e.w)+'%"></i></span><div class="wfoot"><small>Ohne Sparen: '+esc(etaText(E0[i]))+'</small><small class="'+(e.m==null?'neg':'pos')+'">Mit Plan: '+esc(etaText(e))+'</small></div><div class="wact"><button class="ic sm" data-act="wishDone" data-id="'+e.w.id+'" aria-label="Als gekauft markieren">✓</button><button class="ic sm" data-act="wishEdit" data-id="'+e.w.id+'" aria-label="Wunsch bearbeiten">✎</button></div></div>').join(''):'<p class="hint">Noch kein Wunsch eingetragen. Der Sparplan zeigt trotzdem, was möglich ist.</p>';
  const cutRows=x.rows.filter(r=>!r.fix&&!r.unknown);
  h+='</section><div class="sec"><span class="sno s3">3</span><b>Hier sparst du</b><small>'+eur(x.extra)+' im Monat</small></div><section class="secbox cuts">';
  h+=cutRows.length?cutRows.map(r=>'<div class="cut'+(r.kept?' off':'')+'"><span class="cic">'+scatIcon(r.c)+'</span><span class="ct2"><b>'+esc(r.c)+'</b><small>'+(r.kept?'Bleibt, hier sparst du nicht':eur(Math.round(r.avg))+' → '+eur(Math.max(0,Math.round(r.avg)-r.cut))+' · '+esc(r.how))+'</small></span>'+(r.kept||!r.cut?'':'<em class="chip2">−'+eur(r.cut)+'</em>')+swBtn(!r.kept,'wishKeep',r.c,' data-c="'+esc(r.c)+'"')+'</div>').join(''):'<p class="hint">Noch keine Ausgaben, bei denen sich Sparen lohnt.</p>';
  h+='</section>'+(x.rows.some(r=>r.unknown)?'<p class="hint">Kreditkarte: Die Abrechnung zeigt nicht, wofür das Geld ausgegeben wurde. Schau hinein, dort stecken oft Abos und Spontankäufe.</p>':'')
    +(x.rows.some(r=>r.fix)?'<p class="hint">Nicht angetastet: '+esc(x.rows.filter(r=>r.fix).map(r=>r.c).join(', '))+'.</p>':'')
    +'<div class="form"><button data-act="tipsSave">Einzelne Posten ansehen</button></div><p class="hint">Der Plan ist eine Rechnung aus deinen Buchungen, keine Finanzberatung. Was verzichtbar ist, entscheidest du.</p>';
  const mb=$('#modal .mbox'),st=mb?mb.scrollTop:0,keep=!$('#modal').hidden&&$('#modal .goal,#modal .sec');modal(h);if(keep){const m2=$('#modal .mbox');if(m2)m2.scrollTop=st}}
function upChooser(kind){if(kind==='auszug'){const f=$('#f-file');f.value='';f.click();return}
  modal('<h3>Beleg hinzufügen</h3><p class="hint">Foto vom Kassenbon oder ein Bild aus der Galerie.</p><div class="choose2"><button data-act="upCam"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><b>Kamera</b></button><button data-act="upGal"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v10H3zM12 12v5M9.5 14.5 12 12l2.5 2.5"/></svg><b>Datei suchen</b></button></div><div class="mact"><button data-act="close">Abbrechen</button></div>')}
function remRows(){const T=todayISO(),A=remindItems(),own=(S.reminders||[]).filter(r=>!A.some(x=>x.rid===r.id)).map(r=>({date:r.date,t:r.title,rid:r.id,later:1}));
  const L=A.concat(own).sort((a,b)=>a.date.localeCompare(b.date));const MS=['JAN','FEB','MÄR','APR','MAI','JUN','JUL','AUG','SEP','OKT','NOV','DEZ'];
  const row=x=>{const d=daysTo(x.date),r=x.rid?(S.reminders||[]).find(y=>y.id===x.rid):null,cls=d<0?'late':d<=7?'soon':'later';
    return '<div class="ritem '+cls+'"><span class="dblk"><b>'+x.date.slice(8,10)+'</b><span>'+MS[+x.date.slice(5,7)-1]+'</span></span><button class="rt" '+(r?'data-act="editRem" data-id="'+r.id+'"':x.act?'data-act="remGo" data-v="'+esc(x.act)+'"':'')+'><b>'+esc(x.t)+'</b><small>'+(d<0?'seit '+(-d)+(d===-1?' Tag':' Tagen'):d===0?'heute':'in '+d+(d===1?' Tag':' Tagen'))+(x.s&&!r?' · '+esc(x.s):'')+'</small>'+(r?(r.repeat==='yearly'||r.repeat==='monthly'?'<em class="rchip">↻ '+(r.repeat==='yearly'?'jährlich':'monatlich')+'</em>':''):'<em class="rchip app">von der App</em>')+'</button>'+(r?'<button class="okb" data-act="remDone" data-id="'+r.id+'" aria-label="Erledigt">✓</button>':x.act?'<button class="okb go" data-act="remGo" data-v="'+esc(x.act)+'" aria-label="Öffnen">›</button>':'')+'</div>'};
  const G=[['late','Überfällig',L.filter(x=>daysTo(x.date)<0)],['soon','Heute und diese Woche',L.filter(x=>{const d=daysTo(x.date);return d>=0&&d<=7})],['later','Später',L.filter(x=>daysTo(x.date)>7)]];
  return G.filter(g=>g[2].length).map(g=>'<div class="rgh '+g[0]+'"><i></i>'+g[1]+'</div>'+g[2].map(row).join('')).join('')||'<div class="empty">Keine Termine. Mit + legst du eigene an, zum Beispiel Versicherungen oder Komunalna naknada.</div>'}
function remDlg(id){const r=id?(S.reminders||[]).find(x=>x.id===id):{title:'',date:todayISO(),repeat:'yearly',lead:30};if(!r)return;
  modal('<h3>'+(id?'Erinnerung bearbeiten':'Neue Erinnerung')+'</h3><label>Woran?<input id="f-rt" value="'+esc(r.title)+'" placeholder="z. B. Gebäudeversicherung zahlen"></label><div class="grid2"><label>Fällig am<input id="f-rdt" type="date" value="'+esc(r.date)+'"></label><label>Wiederholen<select id="f-rrep"><option value="none"'+sel(r.repeat==='none')+'>Einmalig</option><option value="monthly"'+sel(r.repeat==='monthly')+'>Monatlich</option><option value="yearly"'+sel(r.repeat==='yearly')+'>Jährlich</option></select></label><label>Vorher anzeigen (Tage)<input id="f-rlead" type="number" min="0" max="365" value="'+(r.lead||30)+'"></label></div><div class="mact">'+(id?'<button class="danger" data-act="delRem" data-id="'+id+'">Löschen</button>':'')+'<button data-act="close">Abbrechen</button><button class="primary" data-act="saveRem" data-id="'+(id||'')+'">Speichern</button></div>')}
function acctPage(){const LI=loggedIn(),st=S.settings||{},nm=st.owner||(LI?acct.email:''),ini=(nm||'DJ').split(/[\s@.]+/).filter(Boolean).slice(0,2).map(s=>s[0].toUpperCase()).join('')||'DJ';
  const row=(ic,c,t,s,right,act)=>'<div class="srow"'+(act?' data-act="'+act+'" role="button" tabindex="0"':'')+'>'+mic(ic,c)+'<span class="stx"><b>'+t+'</b>'+(s?'<small>'+s+'</small>':'')+'</span>'+right+'</div>';
  let h='<section class="prof">'+(LI?'<span class="pav">'+esc(ini)+'</span><span class="ptx"><b>'+esc(nm)+'</b><small>'+esc(acct.email)+'</small><small id="syncst">'+esc(tr(syncText()))+'</small><em class="pos">🔒 Ende-zu-Ende verschlüsselt</em></span>':SRV?'<span class="pav">DJ</span><span class="ptx"><b>Nur auf diesem Gerät</b><small>Mit einem Konto sind deine Daten auf allen Geräten gleich und verschlüsselt gespeichert.</small><button class="primary" data-act="authOpen">Anmelden oder Konto erstellen</button></span>':'<span class="pav">DJ</span><span class="ptx"><b>Nur auf diesem Gerät</b></span>')+'</section>'
    +(LI?'<div class="form"><button data-act="syncNow">Jetzt synchronisieren</button></div>':'');
  h+='<div class="sgh">Sicherheit</div><section class="sbox">'+row('lock','c4','Fingerabdruck-Sperre','Beim Öffnen und nach 1 Minute im Hintergrund',swBtn(!!st.lock,'toggleLock','Fingerabdruck-Sperre'))
    +row('eye','c4','Beträge beim Start verbergen','Für unterwegs, antippen des Auges zeigt sie',swBtn(!!st.hideStart,'toggleHideStart','Beträge beim Start verbergen'))
    +(LI?row('bell','c4','Mitteilungen','Neue Rechnungen melden, auch wenn die App zu ist',swBtn(pushState(),pushState()?'pushOff':'pushOn','Mitteilungen')):'')+'</section>';
  h+='<div class="sgh">Bereiche der App</div><section class="sbox">'+row('immo','c3','Immobilien','Mieten, Mieter, Zähler, Modernisierung',swBtn(immoOn(),'toggleImmo','Immobilien'))
    +row('bank','c3','Kredite','Restschuld, Zins und Tilgung, unter Konten',swBtn(creditOn(),'toggleCredit','Kredite'))
    +row('globe','c3','Sprache','Language · Jezik','<select id="f-lang" aria-label="Sprache">'+[['auto','Automatisch'],['de','Deutsch'],['en','English'],['hr','Hrvatski']].map(([v,t])=>'<option value="'+v+'"'+sel((st.lang||'auto')===v)+'>'+t+'</option>').join('')+'</select>')
    +row('user','c3','Name im Jahresbericht',esc(st.owner||'Noch nicht eingetragen'),'<span class="chev">›</span>','ownerDlg')+'</section>';
  h+='<div class="sgh">Backup</div><section class="sbox">'+row('cloud','c2','Letztes Backup',st.lastBackup?dfmt(st.lastBackup)+' · '+(daysTo(st.lastBackup)===0?'heute':'vor '+(-daysTo(st.lastBackup))+(daysTo(st.lastBackup)===-1?' Tag':' Tagen')):(LI?'Deine Daten werden verschlüsselt synchronisiert. Ein Backup schadet trotzdem nicht.':'Noch keins. Die Daten liegen nur auf diesem Gerät.'),'')
    +'<div class="form sbtn"><button data-act="copyBackup">↓ Speichern</button><button data-act="restoreDlg">↑ Einspielen</button></div></section>';
  if(LI)h+='<button class="logout" data-act="logout">Abmelden</button>';
  return h}
function remPage(){return '<div class="h2row remtop"><span class="hint">Eigene Termine und was die App selbst erkennt.</span><button class="primary plus" data-act="addRem" aria-label="Neue Erinnerung">+</button></div>'+remRows()
  +'<div class="srow solo"><span class="stx"><b>Auf der Übersicht zeigen</b></span>'+swBtn(!(S.settings&&S.settings.remind===false),'toggleRemind','Auf der Übersicht zeigen')+'</div>'}
document.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='upAuszug')upChooser('auszug');else if(a==='upBeleg')upChooser('beleg');
  else if(a==='upCam'){closeModal();const f=$('#f-receipt');f.value='';f.setAttribute('capture','environment');f.click()}
  else if(a==='upGal'){closeModal();const f=$('#f-receipt');f.value='';f.removeAttribute('capture');f.click()}
  else if(a==='editRem')remDlg(b.dataset.id);
  else if(a==='toggleHideStart'){S.settings=S.settings||{};S.settings.hideStart=!S.settings.hideStart;save();render()}
  else if(a==='ownerDlg')modal('<h3>Name im Jahresbericht</h3><label>Vor- und Nachname<input id="f-owner" value="'+esc((S.settings&&S.settings.owner)||'')+'"></label><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveOwner">Speichern</button></div>');
});
I18N.push(['Rechnungen','Invoices','Računi'],['Einrichten','Set up','Postavljanje'],['Gmail verbinden','Connect Gmail','Poveži Gmail'],['Mitteilungen erlauben','Allow notifications','Dopusti obavijesti'],['Erlauben','Allow','Dopusti'],['Starten','Start','Pokreni'],['Jetzt prüfen','Check now','Provjeri sada'],['Skript neu erstellen','Create new script','Izradi novu skriptu'],['Mitteilung testen','Test notification','Testiraj obavijest'],['Barcode speichern','Save barcode','Spremi barkod'],['Rechnung ansehen','View invoice','Pogledaj račun'],['Erledigt','Done','Riješeno'],['Schon bezahlt','Already paid','Već plaćeno'],['Keine Rechnung','Not an invoice','Nije račun'],['Skript kopieren','Copy script','Kopiraj skriptu'],['Kontoauszug','Bank statement','Izvod'],['Beleg','Receipt','Račun'],['Kamera','Camera','Kamera'],['Datei suchen','Find file','Traži datoteku'],['Beleg hinzufügen','Add receipt','Dodaj račun'],['Dein Monat','Your month','Tvoj mjesec'],['Deine Wünsche','Your wishes','Tvoje želje'],['Hier sparst du','Where you save','Ovdje štediš'],['Nächstes Ziel','Next goal','Sljedeći cilj'],['Einnahmen','Income','Prihodi'],['Ausgaben','Expenses','Rashodi'],['Bleibt jetzt','Left now','Ostaje sada'],['Mit Sparplan','With savings plan','S planom štednje'],['Überfällig','Overdue','Dospjelo'],['Heute und diese Woche','Today and this week','Danas i ovaj tjedan'],['Später','Later','Kasnije'],['von der App','from the app','iz aplikacije'],['jährlich','yearly','godišnje'],['monatlich','monthly','mjesečno'],['Auf der Übersicht zeigen','Show on overview','Prikaži na pregledu'],['Sicherheit','Security','Sigurnost'],['Bereiche der App','App sections','Dijelovi aplikacije'],['Fingerabdruck-Sperre','Fingerprint lock','Zaključavanje otiskom'],['Beträge beim Start verbergen','Hide amounts on start','Sakrij iznose pri pokretanju'],['Mitteilungen','Notifications','Obavijesti'],['Immobilien','Properties','Nekretnine'],['Kredite','Loans','Krediti'],['Sprache','Language','Jezik'],['Name im Jahresbericht','Name in annual report','Ime u godišnjem izvješću'],['Letztes Backup','Last backup','Zadnja sigurnosna kopija'],['Abmelden','Sign out','Odjava'],['Nur auf diesem Gerät','Only on this device','Samo na ovom uređaju'],['Jetzt synchronisieren','Sync now','Sinkroniziraj sada'],['Gmail verbinden','Connect Gmail','Poveži Gmail']);
