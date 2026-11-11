
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
    const names=[...new Set((map.names||[]).map(i=>String(r[i]||'').trim()).filter(Boolean))].join(' / ');
    const iban=map.iban>=0?normIban(r[map.iban]):'';
    const purpose=map.purpose>=0?String(r[map.purpose]||'').replace(/\s+/g,' ').trim():'';
    out.push({date:d,amount:Math.round(amt*100)/100,name:names,iban:/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)?iban:'',purpose});
  }
  return out;
}
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
function migrate(s){
  ['props','units','txs','rules','accounts','plans','fixcosts','devices','meterDevs','notes','reminders'].forEach(k=>s[k]=s[k]||[]);
  if(!s.cats||!s.cats.length)s.cats=EXP_CATS.slice();
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
 up:'<svg viewBox="0 0 24 24"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>'};
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
    if(u.contractEnd&&u.noticeMonths){const ym=addMonth(u.contractEnd.slice(0,7),-u.noticeMonths);const k=ym+'-'+pad(new Date(+ym.slice(0,4),+ym.slice(5,7),0).getDate());const d=daysTo(k);
      if(d<=120&&u.contractEnd>=T)out.push({date:k,t:'Kündigungsfrist '+unitLabel(u),s:d<0?'Frist vorbei, Vertrag läuft bis '+dfmt(u.contractEnd):'Spätestens bis '+dfmt(k)+' kündigen, sonst verlängert sich der Vertrag',lvl:d<0?'late':d<=30?'partial':'pending'})}
    if(u.contractEnd&&daysTo(u.contractEnd)<=120&&u.contractEnd>=T)out.push({date:u.contractEnd,t:'Vertragsende '+unitLabel(u),s:'Läuft am '+dfmt(u.contractEnd)+' aus',lvl:'partial'});
    [monthOf(T),addMonth(monthOf(T),-1)].forEach(m=>{const s=rentStatus(u,m,S.txs,T);if(s&&(s.st==='late'||s.st==='partial'))out.push({date:m+'-'+pad(u.dueDay||5),t:'Miete '+unitLabel(u)+' '+monthLabel(m),s:s.st==='late'?'Noch nicht eingegangen ('+eur(s.exp)+')':'Es fehlen '+eur(s.missing),lvl:'late',act:'immo'})});
    if(u.cl&&u.cl.kind){const L=CL[u.cl.kind],n=L.filter(x=>u.cl.done&&u.cl.done[x[0]]).length;if(n<L.length)out.push({date:u.cl.started||T,t:(u.cl.kind==='auszug'?'Auszug ':'Einzug ')+unitLabel(u),s:n+' von '+L.length+' Aufgaben erledigt',lvl:'pending',act:'cl:'+u.id})}
  });
  const cy=+T.slice(0,4);
  (S.plans||[]).filter(p=>p.status!=='Erledigt'&&p.year&&p.year<=cy).forEach(p=>out.push({date:p.year+'-12-31',t:p.title,s:(p.year<cy?'Überfällig, geplant für ':'Geplant für ')+p.year+((propOf(p.propertyId)||{}).name?' · '+propOf(p.propertyId).name:''),lvl:p.year<cy?'late':'pending',act:'plan:'+p.id}));
  (S.reminders||[]).forEach(r=>{const d=daysTo(r.date);if(d<=(r.lead||30))out.push({date:r.date,t:r.title,s:(d<0?'Fällig seit '+dfmt(r.date):d===0?'Heute fällig':'Fällig am '+dfmt(r.date))+(r.repeat&&r.repeat!=='none'?' · wiederholt sich '+(r.repeat==='yearly'?'jährlich':'monatlich'):''),lvl:d<0?'late':d<=7?'partial':'pending',rid:r.id})});
  return out.sort((a,b)=>a.date.localeCompare(b.date));
}
const LVL={late:'Dringend',partial:'Bald',pending:'Geplant'};
const remRow=x=>'<div class="rem '+x.lvl+'"><span class="it"><strong>'+esc(x.t)+'</strong><small>'+esc(x.s)+'</small></span>'+(x.rid?'<button class="small" data-act="remDone" data-id="'+x.rid+'">Erledigt</button>':x.act?'<button class="small" data-act="remGo" data-v="'+esc(x.act)+'">Öffnen</button>':'')+'</div>';
function remindCard(){if(S.settings&&S.settings.remind===false)return '';const L=remindItems();if(!L.length)return '';
  return '<section class="card"><div class="h2row"><h3>Demnächst</h3>'+(L.length>3?'<button class="small" data-act="remAll">Alle ('+L.length+')</button>':'')+'</div><div class="rems">'+L.slice(0,3).map(remRow).join('')+'</div></section>'}
function remDlg(){const r={title:'',date:todayISO(),repeat:'yearly',lead:30};
  modal('<h3>Neue Erinnerung</h3><label>Woran?<input id="f-rt" placeholder="z. B. Gebäudeversicherung zahlen"></label><div class="grid2"><label>Fällig am<input id="f-rdt" type="date" value="'+r.date+'"></label><label>Wiederholen<select id="f-rrep"><option value="none">Einmalig</option><option value="monthly">Monatlich</option><option value="yearly" selected>Jährlich</option></select></label><label>Vorher anzeigen (Tage)<input id="f-rlead" type="number" min="0" max="365" value="30"></label></div><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveRem">Speichern</button></div>')}
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
  h+='<h2>Immobilien</h2>';
  S.props.forEach(p=>{const units=S.units.filter(u=>u.propertyId===p.id);const rent=L.filter(t=>t.type==='rent'&&(unitOf(t.unitId)||{}).propertyId===p.id);const ex=L.filter(t=>t.type==='expense'&&t.propertyId===p.id);
    const ri=rent.reduce((s,t)=>s+t.amount,0),eo=-ex.reduce((s,t)=>s+t.amount,0);totInc+=ri;totOut+=eo;
    h+='<h3>'+e(p.name)+'</h3><table><tr><th>Einheit</th><th>Mieter</th><th class="r">Monate bezahlt</th><th class="r">Mieteinnahmen</th></tr>'+units.map(u=>{const r=rent.filter(t=>t.unitId===u.id);const ms=new Set(r.map(t=>t.forMonth||monthOf(t.date))).size;return r.length?'<tr><td>'+e(u.name)+'</td><td>'+e(u.tenant||'')+'</td><td class="r">'+ms+'</td><td class="r">'+E(r.reduce((s,t)=>s+t.amount,0))+'</td></tr>':''}).join('')+'<tr class="sum"><td colspan="3">Summe Mieten</td><td class="r">'+E(ri)+'</td></tr></table>';
    if(ex.length)h+='<table><tr><th>Datum</th><th>Ausgabe</th><th>Kategorie</th><th class="r">Betrag</th></tr>'+ex.sort((a,b)=>a.date.localeCompare(b.date)).map(t=>'<tr><td>'+dfmt(t.date)+'</td><td>'+e(t.purpose||t.name)+(t.receipt?' (Beleg in der App)':'')+'</td><td>'+e(t.category||'')+'</td><td class="r">'+E(-t.amount)+'</td></tr>').join('')+'<tr class="sum"><td colspan="3">Summe Ausgaben</td><td class="r">'+E(eo)+'</td></tr></table>';
    const tax=ri*tr.base*tr.rate;h+='<table><tr><td>Ergebnis vor Steuer</td><td class="r"><b>'+E(ri-eo)+'</b></td></tr><tr><td class="muted">Steuer geschätzt ('+Math.round(tr.rate*100)+' % auf '+Math.round(tr.base*100)+' % der Miete)</td><td class="r muted">'+E(tax)+'</td></tr></table>'});
  h+='<table><tr class="sum"><td>Immobilien gesamt: Einnahmen '+E(totInc)+' · Ausgaben '+E(totOut)+'</td><td class="r">'+E(totInc-totOut)+'</td></tr></table>';
  const inc=L.filter(t=>t.type==='income'),pex=L.filter(t=>t.type==='expense'&&!propOf(t.propertyId));
  const grp=(l)=>{const m={};l.forEach(t=>{const c=t.category||'Ohne Kategorie';m[c]=(m[c]||0)+Math.abs(t.amount)});return Object.entries(m).sort((a,b)=>b[1]-a[1])};
  h+='<h2>Weitere Einnahmen</h2><table>'+grp(inc).map(([c,v])=>'<tr><td>'+e(c)+'</td><td class="r">'+E(v)+'</td></tr>').join('')+'<tr class="sum"><td>Summe</td><td class="r">'+E(inc.reduce((s,t)=>s+t.amount,0))+'</td></tr></table>';
  h+='<h2>Private Ausgaben nach Kategorie</h2><table>'+grp(pex).map(([c,v])=>'<tr><td>'+e(c)+'</td><td class="r">'+E(v)+'</td></tr>').join('')+'<tr class="sum"><td>Summe</td><td class="r">'+E(-pex.reduce((s,t)=>s+t.amount,0))+'</td></tr></table>';
  const lo=loans().filter(o=>o.l.some(inY));if(lo.length)h+='<h2>Verliehenes Geld</h2><table>'+lo.map(o=>'<tr><td>'+e(o.p)+'</td><td class="r">'+(Math.abs(o.open)<0.01?'zurückgezahlt':'offen '+E(o.open))+'</td></tr>').join('')+'</table>';
  h+='<h2>Kontostände</h2><table>'+S.accounts.map(a=>{const v=(a.history||[]).filter(x=>x.date<=y+'-12-31').sort((p,q)=>p.date.localeCompare(q.date)).pop();return '<tr><td>'+e(a.name)+'</td><td class="muted">'+(v?'Stand '+dfmt(v.date):'')+'</td><td class="r">'+(v?E(v.value):'–')+'</td></tr>'}).join('')+'</table>';
  h+='<p class="muted">Die Steuerwerte sind eine Schätzung aus der App und ersetzen keine Steuerberatung.</p></body></html>';
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
function ampel(){const a=last3();if(!a.inc&&!a.out)return {c:'grey',t:'Noch zu wenig Daten',d:'Lade Kontoauszüge der letzten Monate hoch, dann zeigt die Ampel deinen Stand.',a};
  const r=a.inc?(a.inc-a.out)/a.inc:-1;
  if(r>=0.4)return {c:'green',t:'Läuft gut',d:'Du gibst im Schnitt '+Math.round((1-r)*100)+' % deiner Einnahmen aus. Es bleiben etwa '+eur(Math.round(a.inc-a.out))+' im Monat übrig.',a};
  if(r>=0)return {c:'yellow',t:'Knapp',d:'Es bleiben nur etwa '+eur(Math.round(a.inc-a.out))+' im Monat übrig ('+Math.round(r*100)+' % der Einnahmen). Grün gibt es ab 40 %.',a};
  return {c:'red',t:'Achtung',d:'Du gibst im Schnitt '+eur(Math.round(a.out-a.inc))+' mehr aus, als reinkommt.',a};
}
function ampelCard(){const x=ampel();
  return '<section class="card ampel '+x.c+'"><div class="alight" aria-hidden="true"><i class="r"></i><i class="y"></i><i class="g"></i></div><div class="atext"><div class="hl">Dein Stand · letzte 3 Monate</div><strong>'+x.t+'</strong><p>'+esc(x.d)+'</p><div class="form"><button data-act="tipsSave">Wo kann ich sparen?</button><button data-act="tipsCash">Was tun mit dem Geld?</button></div></div></section>';
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
function autoAssign2(tx){
  const hay=nrm(tx.name+' '+tx.purpose);
  if(/vlastiti ra|umbuchung|uebertrag eigenes|denis jozi/.test(hay)){tx.type='ignore';return true}
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
function curTab(){const t=(location.hash||'#start').slice(1);return TABS.some(x=>x[0]===t)?t:'start'}
function render(){if(locked)return;document.body.classList.toggle('hide',!!ui.hide);
  const cur=curTab(),openN=S.txs.filter(t=>t.type==='open').length;
  const nav=TABS.map(t=>'<a href="#'+t[0]+'"'+(t[0]===cur?' class="on" aria-current="page"':'')+'>'+ICON[t[2]]+'<span>'+t[1]+'</span>'+(t[0]==='geld'&&openN?'<b class="badge">'+openN+'</b>':'')+'</a>').join('');
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
  return uploadBtn()+receiptBtn()+(openN?'<a class="notice" href="#geld" data-act="goOpen">'+openN+' Umsätze warten auf Zuordnung <span>›</span></a>':'')
  +'<section class="hero"><div class="hl">Gesamtvermögen</div><div class="hv num">'+eur(Math.round(total))+'</div>'+(diff!=null?'<div class="hsub '+(diff>=0?'pos':'neg')+'">'+(diff>=0?'+':'−')+eur(Math.abs(Math.round(diff)))+' seit Jahresbeginn</div>':'')+chart(ser.concat(ser.length?[{date:todayISO(),value:total}]:[]))
  +'</section>'+ampelCard()+remindCard()
  +'<div class="seg"><button data-act="per" data-v="m"'+(yr?'':' class="on"')+'>Monat</button><button data-act="per" data-v="y"'+(yr?' class="on"':'')+'>Jahr</button></div>'
  +(yr?'<div class="mbar"><button class="ic" data-act="yearPrev" aria-label="Vorjahr">‹</button><strong>'+ui.year+'</strong><button class="ic" data-act="yearNext" aria-label="Nächstes Jahr">›</button></div>':monthBar())
  +'<section class="tiles3"><button class="tilebtn" data-act="perList" data-k="inc" data-p="'+(yr?'y:'+ui.year:'m:'+ui.month)+'"><span>Einnahmen ›</span><b class="num pos">'+eur(Math.round(m.inc))+'</b></button><button class="tilebtn" data-act="perList" data-k="out" data-p="'+(yr?'y:'+ui.year:'m:'+ui.month)+'"><span>Ausgaben ›</span><b class="num neg">'+eur(Math.round(m.out))+'</b></button><div><span>Übrig</span><b class="num">'+eur(Math.round(rest))+'</b></div></section>'
  +(yr?'':unusualCard(ui.month))+(cats.length?'<section class="card"><div class="h2row"><h3>Wofür ging das Geld?</h3><a class="lnk" href="#geld">Alle ›</a></div>'+bars(cats,cmax,yr?'y:'+ui.year:'m:'+ui.month)+'</section>':'<div class="empty">'+(yr?'In diesem Jahr':'In diesem Monat')+' gibt es noch keine Ausgaben. Lade einen Kontoauszug hoch.</div>');
}
const bars=(cats,max,pk)=>'<div class="bars">'+cats.map(([c,v])=>'<button class="barrow" data-act="catList" data-p="'+esc(pk||'')+'" data-c="'+esc(c)+'"><div class="bl"><span>'+esc(c)+'</span><b class="num">'+eur(Math.round(v))+' ›</b></div><div class="bt"><i style="width:'+Math.max(3,v/max*100)+'%"></i></div></button>').join('')+'</div>';
function periodTx(pk){const i=pk.indexOf(':'),k=pk.slice(0,i),v=pk.slice(i+1);if(k==='y')return S.txs.filter(t=>(t.type==='rent'?(t.forMonth||t.date):t.date).startsWith(v));const l=monthTx(v);return k==='mp'?l.filter(t=>!propOf(t.propertyId)):l}
const periodLabel=pk=>{const v=pk.slice(pk.indexOf(':')+1);return v.length===4?'Jahr '+v:monthLabel(v)};
function txSource(t){if(t.type==='rent'){const u=unitOf(t.unitId);return 'Miete '+(u?unitLabel(u):'')}return t.category||'Ohne Kategorie'}
function listDlg(title,sub,l,group){
  l=l.slice().sort((a,b)=>b.date.localeCompare(a.date));const tot=l.reduce((s,t)=>s+t.amount,0);
  let body='';
  if(group){const g={};l.forEach(t=>{const k=txSource(t);(g[k]=g[k]||[]).push(t)});body=Object.entries(g).sort((a,b)=>Math.abs(b[1].reduce((s,t)=>s+t.amount,0))-Math.abs(a[1].reduce((s,t)=>s+t.amount,0))).map(([k,a])=>'<h3 class="gt lh">'+esc(k)+' · '+eur(Math.abs(Math.round(a.reduce((s,t)=>s+t.amount,0)*100)/100))+'</h3><div class="elist kvs">'+a.map(txRow).join('')+'</div>').join('')}
  else body='<div class="elist kvs">'+l.map(txRow).join('')+'</div>';
  modal('<div class="mhead"><div><h3>'+esc(title)+'</h3><small>'+esc(sub)+' · '+l.length+' Buchungen · '+eur(Math.abs(Math.round(tot*100)/100))+'</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'+(l.length?body:'<div class="empty sm">Keine Buchungen.</div>'));
}
const txRow=t=>{const acc=accOf(t.accountId),p=propOf(t.propertyId);return '<div class="erow"><span><b>'+esc(t.name||'–')+recChip(t)+'</b><small>'+dfmt(t.date)+(t.purpose?' · '+esc(t.purpose.slice(0,80)):'')+(p?' · '+esc(p.name):'')+(acc?' · '+esc(acc.name):'')+'</small></span><span class="num '+(t.amount<0?'neg':'pos')+'">'+eur(t.amount)+'</span></div>'};
/* ---------- Ausgaben / Umsätze ---------- */
function vGeld(){
  const seg='<div class="seg"><button data-act="geld" data-v="monat"'+(ui.geld==='monat'?' class="on"':'')+'>Monat</button><button data-act="geld" data-v="umsaetze"'+(ui.geld==='umsaetze'?' class="on"':'')+'>Umsätze</button><button data-act="geld" data-v="jahr"'+(ui.geld==='jahr'?' class="on"':'')+'>Jahr</button></div>';
  if(ui.geld==='umsaetze')return '<div class="h2row"><h2>Umsätze</h2><button class="primary" data-act="pickFile">Hochladen</button></div>'+seg+vTx();
  if(ui.geld==='jahr')return '<div class="h2row"><h2>Ausgaben</h2></div>'+seg+vYear();
  const m=monthSums(ui.month),ex=m.l.filter(t=>t.type==='expense');
  const priv=ex.filter(t=>!propOf(t.propertyId)),imm=ex.filter(t=>propOf(t.propertyId));
  const cats=byCat(priv),max=cats.length?cats[0][1]:1;
  return '<div class="h2row"><h2>Ausgaben</h2></div>'+seg+monthBar()
  +'<section class="tiles3"><div><span>Privat</span><b class="num neg">'+eur(Math.round(-priv.reduce((s,t)=>s+t.amount,0)))+'</b></div><div><span>Immobilien</span><b class="num neg">'+eur(Math.round(-imm.reduce((s,t)=>s+t.amount,0)))+'</b></div><div><span>Einnahmen</span><b class="num pos">'+eur(Math.round(m.inc))+'</b></div></section>'
  +(cats.length?'<section class="card"><h3>Privat nach Kategorie</h3>'+bars(cats,max,'mp:'+ui.month)+'</section>':'<div class="empty">Keine privaten Ausgaben in diesem Monat.</div>')
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
  const v=t.type==='rent'?'rent:'+t.unitId:t.type==='expense'?'exp:'+t.category:t.type==='income'?'inc:'+t.category:t.type;
  const og=(lab,arr,pre)=>'<optgroup label="'+lab+'">'+arr.map(c=>'<option value="'+pre+esc(c)+'"'+sel(v===pre+c)+'>'+esc(c)+'</option>').join('')+'</optgroup>';
  const rent='<optgroup label="Miete von">'+S.units.filter(u=>u.rent>0).map(u=>'<option value="rent:'+u.id+'"'+sel(v==='rent:'+u.id)+'>'+esc(unitLabel(u))+'</option>').join('')+'</optgroup>';
  const cats=S.cats.slice();if(t.type==='expense'&&t.category&&!cats.includes(t.category))cats.push(t.category);
  const ic=S.icats.slice();if(t.type==='income'&&t.category&&!ic.includes(t.category))ic.push(t.category);
  return '<select data-tx="'+t.id+'" data-f="assign" aria-label="Zuordnung"><option value="open"'+sel(v==='open')+'>Nicht zugeordnet</option>'+(t.amount>0?rent+og('Einnahme',ic,'inc:')+og('Ausgabe (Rückbuchung)',cats,'exp:'):og('Ausgabe',cats,'exp:')+og('Einnahme',ic,'inc:')+rent)+'<option value="loan"'+sel(v==='loan')+'>Geld verliehen / zurückbekommen</option><option value="ignore"'+sel(v==='ignore')+'>Umbuchung / ignorieren</option></select>';
}
function txCard(t){
  const extra=t.type==='expense'?'<select data-tx="'+t.id+'" data-f="propertyId" aria-label="Wofür"><option value="">Privat</option>'+S.props.map(p=>'<option value="'+p.id+'"'+sel(p.id===t.propertyId)+'>Immobilie: '+esc(p.name)+'</option>').join('')+'</select>':'';
  const acc=accOf(t.accountId);
  return '<div class="tx '+t.type+'"><div class="txt"><div class="txh"><strong>'+esc(t.name||'–')+recChip(t)+'</strong><span class="num '+(t.amount<0?'neg':'pos')+'">'+eur(t.amount)+'</span></div><small>'+dfmt(t.date)+(acc?' · '+esc(acc.name):'')+(t.purpose?' · '+esc(t.purpose):'')+'</small></div><div class="txa">'+assignSelect(t)+extra+'</div></div>';
}
function filtered(){const q=nrm(ui.q);return S.txs.filter(t=>(ui.filter==='all'||t.type===ui.filter||(ui.filter==='income'&&t.type==='rent'))&&(!q||nrm(t.name+' '+t.purpose+' '+t.amount+' '+(t.category||'')).includes(q))).sort((a,b)=>b.date.localeCompare(a.date))}
function txList(){const all=filtered(),l=all.slice(0,ui.limit);if(!all.length)return '<div class="empty">'+(ui.filter==='open'?'Alles zugeordnet.':'Keine Umsätze gefunden.')+'</div>';return l.map(txCard).join('')+(all.length>l.length?'<button class="more" data-act="showMore">Mehr anzeigen ('+(all.length-l.length)+')</button>':'')}
function vTx(){
  const f=[['open','Offen'],['expense','Ausgaben'],['income','Einnahmen'],['all','Alle']];
  return '<div class="chips">'+f.map(x=>'<button class="chipb'+(ui.filter===x[0]?' on':'')+'" data-act="filter" data-v="'+x[0]+'">'+x[1]+'</button>').join('')+'</div>'+(ui.filter==='open'&&S.txs.some(t=>t.type==='open')?'<button data-act="reassignOpen">Automatisch zuordnen</button>':'')+'<input type="search" id="txq" placeholder="Suchen" value="'+esc(ui.q)+'"><div id="txlist" class="txs">'+txList()+'</div>';
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
function unitDetail(id){
  const u=unitOf(id);if(!u)return;const today=todayISO();
  const months=[];for(let i=-11;i<=0;i++)months.push(addMonth(monthOf(today),i));
  const strip=u.rent>0?'<div class="strip">'+months.map(m=>{const s=rentStatus(u,m,S.txs,today);return '<span class="dot '+(s?s.st:'out')+'" title="'+esc(monthLabel(m)+': '+(s?LBL[s.st]:'nicht vermietet'))+'">'+MONTHS[+m.slice(5)-1].slice(0,1)+'</span>'}).join('')+'</div><p class="legend"><span class="dot paid"></span>bezahlt <span class="dot partial"></span>teilweise <span class="dot late"></span>überfällig</p>':'';
  let warn='';if(u.contractEnd&&u.noticeMonths){const ym=addMonth(u.contractEnd.slice(0,7),-u.noticeMonths);const k=ym+'-'+pad(new Date(+ym.slice(0,4),+ym.slice(5,7),0).getDate());if(k>=today)warn='<div class="kv"><span>Kündigung spätestens</span><b>'+dfmt(k)+'</b></div>'}
  const kv=(l,v)=>v?'<div class="kv"><span>'+l+'</span><b>'+v+'</b></div>':'';
  modal('<div class="mhead"><div><h3>'+esc(unitLabel(u))+'</h3><small>'+esc(u.tenant||'Kein Mieter')+'</small></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div>'+strip+'<div class="kvs">'+kv('Miete / Monat',u.rent?eur(u.rent):'')+kv('Fällig am',u.rent?u.dueDay+'. des Monats':'')+kv('Kaution',u.deposit?eur(u.deposit):'')+kv('Vertrag bis',dfmt(u.contractEnd))+warn+kv('IBAN',esc(u.iban))+'</div>'+(u.note?'<p class="note">'+esc(u.note)+'</p>':'')+'<button class="wide" data-act="checklist" data-id="'+u.id+'">Mieterwechsel-Checkliste ›</button><div class="mact"><button class="danger" data-act="delUnit" data-id="'+u.id+'">Löschen</button><button class="primary" data-act="editUnit" data-id="'+u.id+'">Bearbeiten</button></div>');
}
/* ---------- Immobilien: Unterbereiche ---------- */
const IMMO_SEG=[['miete','Miete'],['zaehler','Zähler'],['plan','Modernisierung'],['ruecklage','Rücklagen'],['infos','Infos']];
const MICON={Wasser:'<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',Strom:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',Gas:'<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-6 1 2 2 3 3 3 0-3-1-5 0-8z"/>',Heizung:'<path d="M5 20V8M9 20V8M13 20V8M17 20V8M3 20h18M3 8h18"/>'};
function vZaehler(){const L=S.meterDevs||[];
  return '<div class="h2row"><h3>Zähler für Wasser, Strom und Gas</h3><button class="primary" data-act="addMeterDev">+ Zähler</button></div><p class="hint">Tippe auf einen Zähler, um einen neuen Stand einzutragen.</p>'
  +(L.length?S.props.map(p=>{const all=L.filter(m=>m.propertyId===p.id);if(!all.length)return '';
    return Object.keys(MKIND).map(kind=>{const l=all.filter(m=>m.kind===kind).sort((a,b)=>(a.place||'').localeCompare(b.place||'','de',{numeric:true}));if(!l.length)return '';
    return '<section class="group"><h3 class="gt">'+esc(p.name)+' · '+kind+'</h3><div class="list">'+l.map(m=>{const r=(m.readings||[]).slice().sort((a,b)=>b.date.localeCompare(a.date))[0];
      return '<button class="item plan" data-act="meter" data-id="'+m.id+'"><span class="picon mk-'+(MKIND[m.kind]||'')+'" aria-hidden="true"><svg viewBox="0 0 24 24">'+(MICON[m.kind]||MICON.Wasser)+'</svg></span><span class="it"><strong>'+esc(m.kind)+' · '+esc(m.place||'')+'</strong><small>'+(m.number?'Nr. '+esc(m.number):m.omm?'OMM '+esc(m.omm):m.note?esc(m.note):'Zählernummer fehlt')+(r?' · abgelesen '+dfmt(r.date):' · noch kein Stand')+'</small></span><span class="ir"><span class="num big">'+(r?esc(r.value):'–')+'</span><small class="lnk">Stand eintragen ›</small></span></button>'}).join('')+'</div></section>'}).join('')}).join(''):'<div class="empty">Noch keine Zähler. Lege mit „+ Zähler“ deinen ersten Wasser- oder Stromzähler an.</div>');
}
const immoSeg=()=>'<div class="seg">'+IMMO_SEG.map(x=>'<button data-act="immo" data-v="'+x[0]+'"'+((ui.immo||'miete')===x[0]?' class="on"':'')+'>'+x[1]+'</button>').join('')+'</div>';
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
  const dev=S.units.filter(u=>(S.devices||[]).some(d=>d.unitId===u.id)).map(u=>'<details class="obj"><summary><span class="it"><strong>Geräte '+esc(unitLabel(u))+'</strong><small>'+(S.devices||[]).filter(d=>d.unitId===u.id).length+' Einträge</small></span><span class="chev">›</span></summary><div class="elist">'+(S.devices||[]).filter(d=>d.unitId===u.id).map(d=>'<div class="erow"><span><b>'+esc(d.name)+'</b></span><span class="num">'+esc(d.year)+' <button class="small link" data-act="delDev" data-id="'+d.id+'" aria-label="Löschen">×</button></span></div>').join('')+'</div><div class="form pad"><button data-act="addDev" data-id="'+u.id+'">+ Gerät</button></div></details>').join('');
  const met='';
  const tr=S.taxRate||{base:.7,rate:.12};
  const ren='<details class="obj"><summary><span class="it"><strong>Rendite & Steuer</strong><small>aus Kaufpreis, Miete und Fixkosten</small></span><span class="chev">›</span></summary><div class="elist">'+S.props.map(p=>{const price=(p.buy||[]).reduce((s,b)=>s+b.price,0);const rentM=S.units.filter(u=>u.propertyId===p.id&&(!u.end||u.end>=monthOf(today))).reduce((s,u)=>s+(+u.rent||0),0);const fixM=(S.fixcosts||[]).filter(f=>f.propertyId===p.id).reduce((s,f)=>s+f.amount*f.perYear,0)/12;const taxM=rentM*tr.base*tr.rate;const net=rentM-fixM-taxM;
    return '<div class="erow"><span><b>'+esc(p.name)+'</b><small>Kauf '+(p.buy||[]).map(b=>b.year+': '+eur(b.price)+(b.what&&b.what!=='Haus'?' ('+esc(b.what)+')':'')).join(', ')+'<br>Miete '+eur(rentM)+' · Fixkosten '+eur(Math.round(fixM))+' · Steuer ca. '+eur(Math.round(taxM))+' = '+eur(Math.round(net))+' im Monat<br>Bruttorendite '+(price?(rentM*12/price*100).toFixed(1).replace('.',','):'–')+' % · Nettorendite '+(price?(net*12/price*100).toFixed(1).replace('.',','):'–')+' %'+(price&&net>0?' · Amortisation ca. '+Math.round(price/(net*12))+' Jahre':'')+'</small></span></div>'}).join('')+'</div><p class="hint pad">Steuer gerechnet wie in der Excel: '+Math.round(tr.rate*100)+' % auf '+Math.round(tr.base*100)+' % der Miete.</p></details>';
  const notes=(S.notes||[]).map((n,i)=>'<details class="obj"><summary><span class="it"><strong>'+esc(n.title)+'</strong></span><span class="chev">›</span></summary><p class="ntext">'+esc(n.text).replace(/\n/g,'<br>')+'</p></details>').join('');
  return '<h3>Kosten & Ausstattung</h3>'+fix+dev+met+ren+'<h3 style="margin-top:6px">Steuern & Behörden</h3>'+notes;
}
/* ---------- Konten ---------- */
function vKonten(){
  const groups=Object.keys(ACC_TYPES).map(k=>[k,S.accounts.filter(a=>(a.type||'sonst')===k)]).filter(g=>g[1].length);
  return '<div class="h2row"><h2>Konten</h2><button class="primary" data-act="addAcc">+ Konto</button></div>'
  +'<section class="hero"><div class="hl">Guthaben gesamt</div><div class="hv num">'+eur(Math.round(accTotal()))+'</div><div class="hsub muted">Bank und Bargeld</div></section>'
  +(groups.length?groups.map(([k,l])=>'<section class="group"><h3 class="gt">'+ACC_TYPES[k]+'</h3><div class="list" data-sort="accounts">'+l.map(a=>{const v=accValue(a);return '<button class="item" data-act="acc" data-id="'+a.id+'"><span class="it"><strong>'+esc(a.name)+'</strong><small>'+(v?'Stand '+dfmt(v.date):'Noch kein Stand')+'</small></span><span class="ir"><span class="num big">'+eur(v?v.value:0)+'</span></span></button>'}).join('')+'</div></section>').join(''):'<div class="empty">Noch kein Konto angelegt.</div>')
  +((()=>{const LA=loans(),LO=LA.filter(o=>Math.abs(o.open)>=0.01),LD=LA.filter(o=>Math.abs(o.open)<0.01),LS=ui.showRepaid?LA:LO;return (LO.length||ui.showRepaid)?'<section class="group"><h3 class="gt">Verliehenes Geld</h3>'+(LS.length?'<div class="list">'+LS.map(o=>'<button class="item loan" data-act="loanList" data-k="'+esc(nrm(o.p))+'"><span class="it"><strong>'+esc(o.p)+'</strong><small>'+(Math.abs(o.open)<0.01?'Komplett zurückgezahlt':o.open>0?'Schuldet dir noch':'Du schuldest')+' · '+o.l.length+' Buchungen</small></span><span class="ir"><span class="num big '+(Math.abs(o.open)<0.01?'pos':'')+'">'+eur(Math.abs(Math.round(o.open*100)/100))+'</span></span></button>').join('')+'</div>':'')+(LD.length?'<button class="small link" data-act="toggleRepaid">'+(ui.showRepaid?'Zurückgezahlte ausblenden':'Zurückgezahlte anzeigen ('+LD.length+')')+'</button>':'')+'</section>':''})())
  +'<p class="hint">'+(S.bank&&S.bank.conns&&S.bank.conns.length?'Kontostände verbundener Banken kommen automatisch. Andere Konten antippen und den Stand eintragen.':'Tippe auf ein Konto, um den aktuellen Stand einzutragen.')+'<br><span>'+(S.accounts.length>1?'Zum Sortieren lange gedrückt halten und ziehen.':'')+'</span></p>';
}
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
function vMehr(){
  return '<h2>Mehr</h2>'
  +'<section class="group"><h3>Von Hand eintragen</h3><p class="hint">Für Barzahlungen oder alles, was nicht im Kontoauszug steht.</p><div class="form"><button data-act="addManual" data-v="expense">+ Ausgabe</button><button data-act="addManual" data-v="income">+ Einnahme</button></div></section>'
  +bkSection()+'<section class="group"><h3>Profil & Sicherheit</h3><label>Dein Name (für den Jahresbericht)<input id="f-owner" value="'+esc((S.settings&&S.settings.owner)||'')+'" placeholder="Vor- und Nachname"></label><button data-act="saveOwner">Name speichern</button><div class="h2row" style="margin-top:6px"><span>Fingerabdruck-Sperre</span><button class="small'+(S.settings&&S.settings.lock?' primary':'')+'" data-act="toggleLock">'+(S.settings&&S.settings.lock?'An · ausschalten':'Aus · einschalten')+'</button></div><p class="hint">Beim Öffnen und nach einer Minute im Hintergrund fragt die App nach Fingerabdruck oder Gesichtserkennung. Die Sperre schützt vor neugierigen Blicken, ersetzt aber nicht die Displaysperre deines Handys.</p><label>Sprache · Language · Jezik<select id="f-lang">'+[['auto','Automatisch'],['de','Deutsch'],['en','English'],['hr','Hrvatski']].map(([v,t])=>'<option value="'+v+'"'+sel(((S.settings&&S.settings.lang)||'auto')===v)+'>'+t+'</option>').join('')+'</select></label></section>'
  +'<section class="group"><h3>Jahresbericht</h3><p class="hint">Alle Zahlen eines Jahres als Datei, zum Ausdrucken oder für den Steuerberater.</p><button data-act="report">Jahresbericht erstellen</button></section>'
  +'<section class="group"><div class="h2row"><h3>Erinnerungen</h3><button class="small" data-act="toggleRemind">'+(S.settings&&S.settings.remind===false?'Auf Übersicht zeigen':'Auf Übersicht ausblenden')+'</button></div><p class="hint">Kündigungsfristen, fehlende Mieten und geplante Modernisierungen erkennt die App selbst. Hier legst du eigene Termine an, zum Beispiel Versicherungen oder Komunalna naknada.</p><div class="list">'+(S.reminders||[]).slice().sort((a,b)=>a.date.localeCompare(b.date)).map(x=>'<div class="item static"><span class="it"><strong>'+esc(x.title)+'</strong><small>'+dfmt(x.date)+(x.repeat==='yearly'?' · jährlich':x.repeat==='monthly'?' · monatlich':'')+'</small></span><button class="ic" data-act="delRem" data-id="'+x.id+'" aria-label="Erinnerung löschen">×</button></div>').join('')+'</div><button data-act="addRem">+ Erinnerung</button></section>'
  +'<section class="group"><h3>Automatische Regeln</h3><p class="hint">Steht das Stichwort im Umsatz, wird er beim Hochladen automatisch einsortiert.</p><div class="list">'+S.rules.map((r,i)=>'<div class="item static"><span class="it"><strong>'+esc(r.keyword)+'</strong><small>'+esc(r.category)+(r.propertyId?' · '+esc((propOf(r.propertyId)||{}).name||''):'')+'</small></span><button class="ic" data-act="delRule" data-i="'+i+'" aria-label="Regel löschen">×</button></div>').join('')+'</div>'
  +'<div class="form"><input id="f-rkw" placeholder="Stichwort, z. B. REWE"><select id="f-rcat"><optgroup label="Ausgabe">'+S.cats.map(c=>'<option>'+esc(c)+'</option>').join('')+'</optgroup><optgroup label="Einnahme">'+S.icats.map(c=>'<option>'+esc(c)+'</option>').join('')+'</optgroup></select><select id="f-rprop"><option value="">Privat</option>'+S.props.map(p=>'<option value="'+p.id+'">Immobilie: '+esc(p.name)+'</option>').join('')+'</select><button data-act="addRule">Regel hinzufügen</button></div></section>'
  +'<section class="group"><h3>Kategorien für Ausgaben</h3><div class="chips">'+S.cats.map((c,i)=>'<span class="chip">'+esc(c)+'<button data-act="delCat" data-i="'+i+'" aria-label="'+esc(c)+' entfernen">×</button></span>').join('')+'</div><div class="form"><input id="f-cat" placeholder="Neue Kategorie"><button data-act="addCat">Hinzufügen</button></div></section>'
  +'<section class="group"><h3>Backup</h3><p class="hint">Die Daten liegen nur auf diesem Gerät. Speichere regelmäßig ein Backup, zum Beispiel in Google Drive.</p><div class="form"><button data-act="copyBackup">Backup speichern</button><button data-act="restoreDlg">Backup einspielen</button></div></section>';
}
/* ---------- Formulare ---------- */
function editProp(id){const p=id?propOf(id):{name:'',address:'',country:'Kroatien',value:'',valueNote:''};
  modal('<h3>'+(id?'Objekt bearbeiten':'Neues Objekt')+'</h3><label>Name<input id="f-name" value="'+esc(p.name)+'"></label><label>Adresse<input id="f-addr" value="'+esc(p.address)+'"></label><label>Land<input id="f-country" list="cl" value="'+esc(p.country)+'"></label><datalist id="cl"><option>Kroatien</option><option>Deutschland</option></datalist><div class="mact">'+(id?'<button class="danger" data-act="delProp" data-id="'+id+'">Löschen</button>':'')+'<button data-act="close">Abbrechen</button><button class="primary" data-act="saveProp" data-id="'+(id||'')+'">Speichern</button></div>')}
function editUnit(id){
  if(!S.props.length){toast('Lege zuerst ein Objekt an.');return}
  const u=id?unitOf(id):{propertyId:S.props[0].id,name:'',tenant:'',rent:'',dueDay:5,iban:'',keywords:'',start:monthOf(todayISO()),end:'',deposit:'',contractEnd:'',noticeMonths:3,note:''};
  const n=v=>v===''||v==null||v===0?'':String(v).replace('.',',');
  modal('<h3>'+(id?'Einheit bearbeiten':'Neue Einheit')+'</h3><div class="grid2"><label>Objekt<select id="f-prop">'+S.props.map(p=>'<option value="'+p.id+'"'+sel(p.id===u.propertyId)+'>'+esc(p.name)+'</option>').join('')+'</select></label><label>Bezeichnung<input id="f-name" value="'+esc(u.name)+'"></label><label>Mieter<input id="f-tenant" value="'+esc(u.tenant)+'"></label><label>Miete / Monat (€)<input id="f-rent" inputmode="decimal" value="'+n(u.rent)+'"></label><label>Fällig am Tag<input id="f-due" type="number" min="1" max="28" value="'+esc(u.dueDay||5)+'"></label><label>Kaution (€)<input id="f-dep" inputmode="decimal" value="'+n(u.deposit)+'"></label><label>Vertrag bis<input id="f-cend" type="date" value="'+esc(u.contractEnd)+'"></label><label>Kündigungsfrist (Monate)<input id="f-notice" type="number" min="0" max="24" value="'+esc(u.noticeMonths||3)+'"></label><label>Miete ab<input id="f-start" type="month" value="'+esc(u.start)+'"></label><label>Mietende (leer = läuft)<input id="f-end" type="month" value="'+esc(u.end)+'"></label><label>IBAN des Mieters<input id="f-iban" value="'+esc(u.iban)+'"></label><label>Suchwort im Umsatz<input id="f-kw" value="'+esc(u.keywords)+'" placeholder="z. B. Nachname"></label></div><label>Notiz<textarea id="f-note" rows="2">'+esc(u.note)+'</textarea></label><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveUnit" data-id="'+(id||'')+'">Speichern</button></div>');
}
function manualDlg(kind){
  const cats=kind==='income'?S.icats:S.cats;
  modal('<h3>'+(kind==='income'?'Einnahme':'Ausgabe')+' eintragen</h3><div class="grid2"><label>Datum<input id="f-date" type="date" value="'+todayISO()+'"></label><label>Betrag (€)<input id="f-amt" inputmode="decimal" placeholder="z. B. 120,00"></label><label>Kategorie<select id="f-ecat">'+cats.map(c=>'<option>'+esc(c)+'</option>').join('')+'</select></label>'+(kind==='income'?'':'<label>Wofür<select id="f-eprop"><option value="">Privat</option>'+S.props.map(p=>'<option value="'+p.id+'">Immobilie: '+esc(p.name)+'</option>').join('')+'</select></label>')+'</div><label>Beschreibung<input id="f-desc"></label><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="saveManual" data-v="'+kind+'">Speichern</button></div>');
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
function keyCounts(){const c={};S.txs.forEach(t=>{const k=t.key||txKey(t);c[k]=(c[k]||0)+1});return c}
const impList=()=>imp.pdf?imp.pdf.txs:rowsToTx(imp.parsed.data,imp.map);
function impPreview(){const list=impList(),ex=keyCounts(),seen={};let neu=0,dup=0;list.forEach(t=>{const k=txKey(t);seen[k]=(seen[k]||0)+1;if((ex[k]||0)>=seen[k])dup++;else neu++});
  if(!list.length)return '<p class="neg">Es wurde keine Buchung erkannt. Öffne „Spalten prüfen“ und wähle Datum und Betrag.</p>';
  return '<section class="tiles3 two"><div><span>Neu</span><b class="num">'+neu+'</b></div><div><span>Schon vorhanden</span><b class="num">'+dup+'</b></div></section><div class="elist">'+list.slice(0,3).map(t=>'<div class="erow"><span><b>'+esc(t.name||'–')+'</b><small>'+dfmt(t.date)+' · '+esc(t.purpose.slice(0,50))+'</small></span><span class="num '+(t.amount<0?'neg':'pos')+'">'+eur(t.amount)+'</span></div>').join('')+'</div>'}
function showImport(){if(imp.pdf)return showPdfImport();
  const h=imp.parsed.headers,m=imp.map;const opt=(cur,none)=>'<option value="-1">'+none+'</option>'+h.map((x,i)=>'<option value="'+i+'"'+sel(cur===i)+'>'+esc(x||('Spalte '+(i+1)))+'</option>').join('');
  modal('<h3>Kontoauszug hochladen</h3><p class="hint">'+esc(imp.file)+'</p><label>Von welchem Konto?<select id="f-iacc"><option value="">Nicht angeben</option>'+S.accounts.filter(a=>a.type==='bank').map(a=>'<option value="'+a.id+'"'+sel(a.id===imp.acc)+'>'+esc(a.name)+'</option>').join('')+'</select></label><div id="imppv">'+impPreview()+'</div><details class="cols"><summary>Spalten prüfen</summary><div class="grid2"><label>Datum<select data-imp="date">'+opt(m.date,'–')+'</select></label><label>Betrag<select data-imp="amount">'+opt(m.amount,'–')+'</select></label><label>Verwendungszweck<select data-imp="purpose">'+opt(m.purpose,'keine')+'</select></label><label>IBAN Gegenseite<select data-imp="iban">'+opt(m.iban,'keine')+'</select></label><label>Soll/Haben<select data-imp="sign">'+opt(m.sign,'keine')+'</select></label></div><div class="hint">Name der Gegenseite</div><div class="chips">'+h.map((x,i)=>'<label class="chip"><input type="checkbox" data-imp="name" value="'+i+'"'+(m.names.includes(i)?' checked':'')+'> '+esc(x||('Spalte '+(i+1)))+'</label>').join('')+'</div></details><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="doImport">Übernehmen</button></div>');
}
function dedupeExcel(tx){const m=tx.forMonth||monthOf(tx.date);const i=S.txs.findIndex(x=>x.src==='excel'&&x.type==='rent'&&x.unitId===tx.unitId&&x.forMonth===m);if(i>=0)S.txs.splice(i,1)}
function doImport(){
  const acc=$('#f-iacc').value;ui.lastAcc=acc;const list=impList(),ex=keyCounts(),seen={};let added=0,dup=0,auto=0;
  const bused=new Set();
  for(const t of list){const k=txKey(t);seen[k]=(seen[k]||0)+1;if((ex[k]||0)>=seen[k]){dup++;continue}
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
  case 'saveProp':{const name=$('#f-name').value.trim();if(!name){toast('Bitte einen Namen eingeben.');return}const pv=id?(+propOf(id).value||0):0;
    const v={name,address:$('#f-addr').value.trim(),country:$('#f-country').value.trim(),value:pv,valueNote:id?(propOf(id).valueNote||''):''};if(id)Object.assign(propOf(id),v);else S.props.push(Object.assign({id:uid()},v));closeModal();go();return}
  case 'saveUnit':{const name=$('#f-name').value.trim();if(!name){toast('Bitte eine Bezeichnung eingeben.');return}
    const num=s=>s.trim()===''?0:parseDE(s);const rent=num($('#f-rent').value),dep=num($('#f-dep').value);if(isNaN(rent)||isNaN(dep)){toast('Miete oder Kaution ist keine gültige Zahl.');return}
    const v={propertyId:$('#f-prop').value,name,tenant:$('#f-tenant').value.trim(),rent,deposit:dep,dueDay:Math.min(28,Math.max(1,parseInt($('#f-due').value,10)||5)),contractEnd:$('#f-cend').value,noticeMonths:parseInt($('#f-notice').value,10)||0,start:$('#f-start').value,end:$('#f-end').value,iban:normIban($('#f-iban').value),keywords:$('#f-kw').value.trim(),note:$('#f-note').value.trim()};
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
  case 'catList':{const pk=b.dataset.p,c=b.dataset.c;if(!pk)return;listDlg(c,(pk.startsWith('mp:')?'Privat · ':'')+periodLabel(pk),periodTx(pk).filter(t=>t.type==='expense'&&(t.category||'Ohne Kategorie')===c),false);return}
  case 'perList':{const pk=b.dataset.p,inc=b.dataset.k==='inc';listDlg(inc?'Einnahmen':'Ausgaben',periodLabel(pk),periodTx(pk).filter(t=>inc?isInc(t):t.type==='expense'),true);return}
  case 'tipsSave':saveTips();return;
  case 'tipsCash':cashTips();return;
  case 'toggleRepaid':ui.showRepaid=!ui.showRepaid;saveUi();render();return;
  case 'loanList':{const o=loans().find(x=>nrm(x.p)===b.dataset.k);if(o)listDlg('Darlehen '+o.p,'Offen '+eur(Math.round(o.open*100)/100),o.l,false);return}
  case 'meter':meterDlg(id);return;
  case 'addMeterDev':meterDevDlg();return;case 'editMeterDev':meterDevDlg(id);return;
  case 'saveMeterDev':{S.meterDevs=S.meterDevs||[];const v={propertyId:$('#f-zp').value,kind:$('#f-zk').value,number:$('#f-zn').value.trim(),place:$('#f-zo').value.trim(),omm:$('#f-zomm').value.trim(),account:$('#f-zacc').value.trim(),code:$('#f-zcode').value.trim(),note:$('#f-znote').value.trim()};
    if(id)Object.assign(S.meterDevs.find(x=>x.id===id),v);else{const m=Object.assign({id:uid(),readings:[]},v);const fv=$('#f-zv').value.trim();if(fv)m.readings.push({date:$('#f-zd').value||todayISO(),value:fv});S.meterDevs.push(m)}closeModal();go();return}
  case 'delMeterDev':ask('Zähler mit allen Ständen löschen?','Löschen',()=>{S.meterDevs=S.meterDevs.filter(x=>x.id!==id);go()});return;
  case 'addReading':{const v=$('#f-rv').value.trim();if(!v){toast('Bitte einen Stand eingeben.');return}const m=S.meterDevs.find(x=>x.id===id),d=$('#f-rd').value||todayISO();m.readings=(m.readings||[]).filter(r=>r.date!==d);m.readings.push({date:d,value:v});save();render();meterDlg(id);toast('Stand gespeichert.');return}
  case 'delReading':{const m=S.meterDevs.find(x=>x.id===id);m.readings=m.readings.filter(r=>r.date!==b.dataset.d);save();render();meterDlg(id);return}
  case 'reassignOpen':{let n=0;S.txs.forEach(t=>{if(t.type==='open'&&autoAssign2(t))n++});go();toast(n+' Umsätze zugeordnet.');return}
  case 'remAll':modal('<div class="mhead"><div><h3>Demnächst</h3></div><button class="ic" data-act="close" aria-label="Schließen">×</button></div><div class="rems">'+remindItems().map(remRow).join('')+'</div>');return;
  case 'remGo':{const v=b.dataset.v;closeModal();if(v==='immo'){ui.immo='miete';saveUi();location.hash='#immo'}else if(v.startsWith('plan:')){ui.immo='plan';saveUi();location.hash='#immo';render();planDlg(v.slice(5))}else if(v.startsWith('cl:'))clDlg(v.slice(3));return}
  case 'remDone':{const r=(S.reminders||[]).find(x=>x.id===id);if(!r)return;if(r.repeat==='yearly')r.date=(+r.date.slice(0,4)+1)+r.date.slice(4);else if(r.repeat==='monthly')r.date=addMonth(r.date.slice(0,7),1)+'-'+r.date.slice(8);else S.reminders=S.reminders.filter(x=>x.id!==id);closeModal();go();toast(r.repeat&&r.repeat!=='none'?'Erledigt. Nächster Termin: '+dfmt(r.date):'Erledigt.');return}
  case 'addRem':remDlg();return;
  case 'saveRem':{const t=$('#f-rt').value.trim();if(!t){toast('Bitte eingeben, woran erinnert werden soll.');return}S.reminders=S.reminders||[];S.reminders.push({id:uid(),title:t,date:$('#f-rdt').value||todayISO(),repeat:$('#f-rrep').value,lead:parseInt($('#f-rlead').value,10)||30});closeModal();go();return}
  case 'delRem':S.reminders=(S.reminders||[]).filter(x=>x.id!==id);go();return;
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
  case 'copyBackup':{(async()=>{let rc={};try{rc=await idbAll(RC)}catch(e){}dlBlob(new Blob([JSON.stringify({app:'DJ Capital',date:todayISO(),state:S,receipts:rc})],{type:'application/json'}),'DJ-Capital-Backup-'+todayISO()+'.json');toast('Backup gespeichert. Hebe die Datei gut auf.')})();return}
  case 'restoreDlg':modal('<h3>Backup einspielen</h3><p class="hint">Das ersetzt alle jetzigen Daten. Wähle eine Backup-Datei oder füge den Backup-Text aus der alten Version ein.</p><input type="file" id="f-bkfile" accept=".json,application/json,text/plain"><textarea class="big" id="f-bk" placeholder="Oder Backup-Text hier einfügen"></textarea><div class="mact"><button data-act="close">Abbrechen</button><button class="primary" data-act="restoreOk">Wiederherstellen</button></div>');return;
  case 'restoreOk':{(async()=>{try{const f=$('#f-bkfile').files[0];const txt=f?await f.text():$('#f-bk').value;let x=JSON.parse(txt);let rc=null;if(x&&x.state&&x.app){rc=x.receipts;x=x.state}if(!x||!Array.isArray(x.props))throw 0;S=migrate(x);S.settings=S.settings||{remind:true};if(rc)for(const k of Object.keys(rc))await idbSet(RC,k,rc[k]);await doSave();closeModal();render();toast('Backup eingespielt.')}catch(err){toast('Das ist kein gültiges Backup.')}})();return}
  }
});
document.addEventListener('change',e=>{if(e.target&&e.target.id==='f-lang'){setLang(e.target.value);return}
  const t=e.target;
  if(t.id==='f-file'){if(t.files&&t.files[0])handleFile(t.files[0]);return}
  if(t.id==='f-receipt'){if(t.files&&t.files[0])handleReceipt(t.files[0]);return}
  if(t.dataset.cl){const u=unitOf(t.dataset.id),k=t.dataset.k;if(!u.cl||u.cl.kind!==k)u.cl={kind:k,started:todayISO(),done:{}};if(t.checked)u.cl.done[t.dataset.cl]=todayISO();else delete u.cl.done[t.dataset.cl];save();clDlg(u.id,k);return}
  if(t.dataset.imp){const k=t.dataset.imp;if(k==='name')imp.map.names=[...document.querySelectorAll('[data-imp=name]')].filter(x=>x.checked).map(x=>+x.value);else imp.map[k]=+t.value;$('#imppv').innerHTML=impPreview();return}
  if(t.dataset.tx){const tx=S.txs.find(x=>x.id===t.dataset.tx);if(!tx)return;
    if(t.dataset.f==='assign'){const v=t.value;tx.unitId='';tx.forMonth='';if(!v.startsWith('exp:'))tx.propertyId='';tx.category='';
      if(v.startsWith('rent:')){tx.type='rent';tx.unitId=v.slice(5);tx.forMonth=monthOf(tx.date);dedupeExcel(tx)}else if(v.startsWith('exp:')){tx.type='expense';tx.category=v.slice(4)}else if(v.startsWith('inc:')){tx.type='income';tx.category=v.slice(4)}else{tx.type=v;if(v==='loan'&&!tx.person)tx.person=(tx.name||'').replace(/^PayPal: /,'')}
      save();if(ui.filter==='open'&&tx.type!=='open'){t.closest('.tx').classList.add('done');setTimeout(render,450)}else $('#txlist').innerHTML=txList();return}
    tx[t.dataset.f]=t.value;save()}
});
document.addEventListener('input',e=>{if(e.target.id==='txq'){ui.q=e.target.value;ui.limit=100;saveUi();$('#txlist').innerHTML=txList()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#modal').hidden)closeModal()});
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0)});
let S0=null;(async()=>{S=await loadState();applyLang();S.txs.forEach(t=>{if(t.type==='open')autoAssign2(t)});if(S.settings.lock&&!recentUnlock())showLock();else{render();runGo()}try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}})();
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
  if(g==='miete'){ui.immo='miete';saveUi();if(location.hash!=='#immo')location.hash='#immo';else render();return}
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
const bkReady=()=>{const b=bk();return !!(b.url&&b.key)};
const bkRedirect=()=>location.origin+location.pathname.replace(/index\.html$/,'');
async function bkApi(path,opt){const b=bk();let r;
  try{r=await fetch(b.url.replace(/\/+$/,'')+path,Object.assign({},opt||{},{headers:{'X-DJC-Key':b.key,'Content-Type':'application/json'}}))}catch(e){throw {code:'NETWORK'}}
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok)throw {code:j.error||('HTTP_'+r.status),msg:j.message||'',status:r.status};return j}
function bkErrText(e){const c=e&&e.code;
  if(c==='NETWORK')return 'Der Vermittler ist nicht erreichbar. Prüfe die Adresse und die Internetverbindung.';
  if(c==='WRONG_KEY')return 'Der Zugangsschlüssel passt nicht zu dem bei Cloudflare.';
  if(c==='FORBIDDEN_ORIGIN')return 'Der Vermittler erlaubt diese App-Adresse nicht (ALLOWED_ORIGIN).';
  if(c==='NOT_CONFIGURED')return 'Beim Vermittler fehlen EB_APP_ID, EB_KEY oder ACCESS_KEY.';
  if(c==='EXPIRED_SESSION')return 'Die Freigabe der Bank ist abgelaufen. Bitte neu verbinden.';
  return 'Fehler von der Bank-Schnittstelle'+(c?' ('+c+')':'')+'.'}
function bkSection(){const b=bk();const T=todayISO();
  const conns=b.conns.map((c,i)=>{const until=(c.valid_until||'').slice(0,10),d=until?daysTo(until):999,exp=c.err==='expired'||d<0;
    return '<div class="erow"><span><b>'+esc(c.aspsp.name)+'</b><small>'+(exp?'Abgelaufen, bitte neu verbinden':'Verbunden bis '+dfmt(until))+' · <span>'+c.accounts.length+(c.accounts.length===1?' Konto':' Konten')+'</span></small></span><span class="form" style="margin:0">'+(exp||d<=14?'<button class="small primary" data-act="bkRenew" data-i="'+i+'">Neu verbinden</button>':'')+'<button class="small" data-act="bkRemove" data-i="'+i+'" aria-label="Entfernen">×</button></span></div>'}).join('');
  return '<section class="group"><h3>Bankverbindung</h3>'
    +(bkReady()?(b.conns.length?'<div class="elist">'+conns+'</div>':'<p class="hint">Noch keine Bank verbunden.</p>')
      +'<div class="form"><button class="primary" data-act="bkFetch">Umsätze abrufen</button><button data-act="bkConnect">+ Bank verbinden</button></div>'
      +(b.lastFetch?'<p class="hint">Zuletzt abgerufen: '+dfmt(new Date(b.lastFetch).toISOString().slice(0,10))+' '+new Date(b.lastFetch).toTimeString().slice(0,5)+'</p>':'')
      +'<details class="bkset"'+(b.conns.length?'':' open')+'><summary>Einstellungen</summary>'+bkSetupForm()+'</details>'
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
  await bkFetch(true)}
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
          const used=new Set();
          for(const x of (j.transactions||[])){if(x.status==='PDNG'||x.status==='PNDG')continue;const t=bkMap(x);if(!t.amount)continue;
            if(S.txs.some(y=>y.ebid===t.ebid)){dup++;continue}
            const m=bkFuzzy(a.accId,t.amount,t.date,used,y=>!y.ebid);if(m){used.add(m.id);m.ebid=t.ebid;dup++;continue}
            const tx={id:uid(),key:txKey(t),ebid:t.ebid,src:'bank',date:t.date,amount:t.amount,name:t.name,iban:t.iban,purpose:t.purpose,type:'open',unitId:'',propertyId:'',category:'',forMonth:'',accountId:a.accId};
            if(autoAssign2(tx)){auto++;if(tx.type==='rent')dedupeExcel(tx)}S.txs.push(tx);added++}
          try{const bj=await bkApi('/balances?uid='+encodeURIComponent(a.uid));const L=bj.balances||[];const pick=BK_BAL.map(k=>L.find(z=>z.balance_type===k)).find(Boolean)||L[0];
            if(pick&&pick.balance_amount){const ac=accOf(a.accId);if(ac){const v=Math.round(parseFloat(pick.balance_amount.amount)*100)/100;if(isFinite(v)){ac.history=(ac.history||[]).filter(h=>h.date!==T);ac.history.push({date:T,value:v})}}}}catch(e){}
          a.last=T;
        }catch(e){if(e.code==='EXPIRED_SESSION'){c.err='expired'}errs.push(c.aspsp.name+': '+bkErrText(e))}
      }
    }
    b.lastFetch=Date.now();save();render();
    if(errs.length)toast(errs[0]);
    else if(added)toast(added+' neue Umsätze von der Bank, davon '+auto+' automatisch zugeordnet.');
    else if(manual)toast('Keine neuen Umsätze.');
  }finally{bkBusy=false}}
function bankAfterBoot(){if(BK_CB&&!bankAfterBoot.done){bankAfterBoot.done=true;bkCallback(BK_CB);return}
  if(bankAfterBoot.done)return;bankAfterBoot.done=true;
  if(bkReady()&&bk().conns.length&&Date.now()-(bk().lastFetch||0)>4*3600e3)bkFetch(false)}
{const _rg=runGo;runGo=function(){_rg();bankAfterBoot()}}
{const _ri=remindItems;remindItems=function(){const out=_ri();if(S.bank&&S.bank.conns)S.bank.conns.forEach(c=>{const u=(c.valid_until||'').slice(0,10);const d=u?daysTo(u):999;
  if(c.err==='expired'||d<=14)out.push({date:u||todayISO(),t:'Bankverbindung '+c.aspsp.name,s:c.err==='expired'||d<0?'Abgelaufen, bitte neu verbinden':'Läuft am '+dfmt(u)+' ab, bitte neu verbinden',lvl:c.err==='expired'||d<0?'late':'partial',act:'bank'})});
  return out.sort((a,b)=>a.date.localeCompare(b.date))}}
/* Mehrere Fenster (App + Browser nach der Bankanmeldung): neueren Stand übernehmen */
{const _ds=doSave;doSave=async function(){S._t=Date.now();return _ds()}}
document.addEventListener('visibilitychange',async()=>{if(document.hidden||!S||locked)return;try{const s=await idbGet(KV,'state');if(s&&s._t&&s._t>(S._t||0)){S=migrate(s);render()}}catch(e){}});
document.addEventListener('input',e=>{if(e.target&&e.target.id==='f-bkq')bkRenderList()});
document.addEventListener('change',e=>{if(e.target&&e.target.id==='f-bkc')bkLoadList(e.target.value)});
document.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='remGo'&&b.dataset.v==='bank'){location.hash='#mehr';return}
  if(!a.startsWith('bk'))return;
  if(a==='bkConnect')bkConnectDlg();
  else if(a==='bkStart')bkStart(b.dataset.v,b.dataset.c);
  else if(a==='bkFetch')bkFetch(true);
  else if(a==='bkSave')bkSaveSetup();
  else if(a==='bkGenKey'){const i=$('#f-bkkey');if(i&&(!i.value||confirm(tr('Neuen Schlüssel erzeugen? Dann musst du ihn auch bei Cloudflare ändern.'))))i.value=bkGenKey()}
  else if(a==='bkCopyKey'){const v=($('#f-bkkey')||{}).value||'';if(!v){toast('Erst einen Schlüssel erzeugen.');return}(navigator.clipboard?navigator.clipboard.writeText(v):Promise.reject()).then(()=>toast('Schlüssel kopiert.'),()=>{const i=$('#f-bkkey');i.select();toast('Schlüssel markiert, bitte kopieren.')})}
  else if(a==='bkRenew'){const c=bk().conns[+b.dataset.i];if(c)bkStart(c.aspsp.name,c.aspsp.country)}
  else if(a==='bkRemove'){const c=bk().conns[+b.dataset.i];if(c&&confirm(tr('Verbindung zu dieser Bank entfernen? Die Umsätze bleiben in der App.'))){bk().conns.splice(+b.dataset.i,1);save();render();bkApi('/session?id='+encodeURIComponent(c.sid),{method:'DELETE'}).catch(()=>{})}}
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
