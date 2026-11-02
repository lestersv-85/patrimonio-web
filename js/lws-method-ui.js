import {calculateLWS,validateConfig} from './lws-method-model.js?v=bb18823';

const euro=v=>Number.isFinite(v)?new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v):'Pendiente';
const pct=v=>Number.isFinite(v)?new Intl.NumberFormat('es-ES',{style:'percent',maximumFractionDigits:2}).format(v):'Pendiente';
const number=v=>Number.isFinite(v)?new Intl.NumberFormat('es-ES',{maximumFractionDigits:2}).format(v):'Pendiente';
function friendly(text){const s=String(text);const translations=[
 ['Pending positions excluded','Hay posiciones pendientes: se conservan sin asignación determinada y sus cupos no se fuerzan.'],
 ['Allocation is a subset','Cálculo parcial de las posiciones con datos suficientes; los pesos pendientes no son ceros de rechazo.'],
 ['Conditioned diagnostic only','Escenarios y probabilidades son hipótesis; este cálculo no aprueba operaciones.'],
 ['Historical window shorter','La historia disponible tiene menos de cinco años; la dependencia futura no está validada.'],
 ['History missing for positive','Faltan series de posiciones con peso: el riesgo agregado permanece pendiente.'],
 ['Solver convergence not established','No se ha certificado la convergencia del cálculo; la distribución permanece pendiente.'],
 ['IPF did not converge','No se pudo ajustar la distribución a las probabilidades indicadas; revisa sus entradas.']];
 for(const [prefix,label]of translations)if(s.startsWith(prefix))return label;
 return s.replace('Mixed horizons require explicit postExitPolicy cash and shorter source horizon','Para combinar horizontes, define qué ocurre después de la salida temporal. No se convierte automáticamente una tesis de tres años en cinco.').replace('Category budgets must sum to one','Los presupuestos de categorías deben sumar100%.');}
const COLORS=['#5aa99a','#91b2d6','#a2c79e','#d6b965','#b5c2cc','#d49d77','#ad9bc9','#70b6c8','#cb90b1','#ef936d'];
function el(tag,text,parent,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;if(parent)parent.append(n);return n;}
function help(parent,text){const b=el('span','ⓘ',parent,'lws-help');b.tabIndex=0;b.title=text;b.setAttribute('aria-label',text);return b;}
function button(parent,label,fn){const b=el('button',label,parent,'lws-button');b.type='button';b.addEventListener('click',fn);return b;}
function table(parent,heads){const wrap=el('div',undefined,parent,'lws-scroll');const t=el('table',undefined,wrap),h=el('tr',undefined,el('thead',undefined,t));heads.forEach(x=>el('th',x,h));return el('tbody',undefined,t);}
function input(parent,label,value,change,{percent=false,min=null,max=null}={}){
 const l=el('label',label,parent),i=el('input',undefined,l);i.type='number';i.step='any';
 i.value=Number.isFinite(value)?String(percent?value*100:value):'';
 if(min!==null)i.min=min;if(max!==null)i.max=max;
 i.addEventListener('change',()=>change(i.value===''?null:Number(i.value)/(percent?100:1)));return i;
}
function download(value,name){const u=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=el('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function donut(parent,categories,weights,title){
 const card=el('article',undefined,parent,'lws-panel');el('h3',title,card);
 const layout=el('div',undefined,card,'lws-donut-layout'),ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 220 220');svg.setAttribute('role','img');svg.setAttribute('aria-label',title);layout.append(svg);
 const list=el('div',undefined,layout,'lws-legend');let offset=0;
 const total=categories.reduce((sum,c)=>sum+(Number.isFinite(weights[c.id])?weights[c.id]:0),0);
 categories.forEach((c,i)=>{const w=weights[c.id];if(!Number.isFinite(w)||w<=1e-10)return;
  const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx','110');circle.setAttribute('cy','110');circle.setAttribute('r','78');circle.setAttribute('fill','none');circle.setAttribute('stroke',COLORS[i%COLORS.length]);circle.setAttribute('stroke-width','39');circle.setAttribute('pathLength','100');circle.setAttribute('stroke-dasharray',`${w/total*100} ${100-w/total*100}`);circle.setAttribute('stroke-dashoffset',String(-offset));circle.setAttribute('transform','rotate(-90 110 110)');offset+=w/total*100;svg.append(circle);
  const row=el('div',undefined,list);const dot=el('span','●',row);dot.style.color=COLORS[i%COLORS.length];el('span',c.label,row);el('strong',pct(w),row);
 });
 const text=document.createElementNS(ns,'text');text.setAttribute('x','110');text.setAttribute('y','117');text.setAttribute('text-anchor','middle');text.textContent=pct(total);svg.append(text);
}

/** Same UI + model in both origins; adapters hold authentication outside this module. */
export async function mountLWSMethod(host,{loadData,loadSaved,saveSaved,loadHistory,storageScope='shared'}={}){
 const generation=Symbol('lws-mount');host.lwsGeneration=generation;
 host.classList.add('lws-plan');host.replaceChildren();el('p','Cargando método y configuración privada…',host);
 let bundle,config,revision=0,result=null,busy=false,dirty=false,error='',savedAt='';
 try{bundle=await loadData();if(!bundle?.config||!bundle.history||!bundle.uniforms)throw Error('Paquete de método incompleto.');const saved=loadSaved?await loadSaved():null;config=structuredClone(saved?.config||bundle.config);revision=saved?.revision||0;}
 catch(e){host.replaceChildren();el('h2','Método LWS',host);el('p',e.message,host,'lws-notice');
  const label=el('label','Abrir un paquete privado exportado desde este método',host),file=el('input',undefined,label);file.type='file';file.accept='.json,application/json';
  file.onchange=async()=>{try{const f=file.files?.[0];if(!f)return;if(f.size>12_000_000)throw Error('Paquete demasiado grande.');const data=JSON.parse(await f.text());if(!data.config||!data.history||!data.uniforms)throw Error('Se requiere un paquete completo, no solo los parámetros.');await mountLWSMethod(host,{loadData:async()=>data,loadSaved:async()=>null});}catch(err){el('p',err.message,host,'lws-error');}};
  return;}
 function changed(){result=null;dirty=true;error='';render();}
 async function calculate(){
  if(busy)return;busy=true;error='';render();
  try{const snapshot=structuredClone(config),key=JSON.stringify(snapshot);await new Promise(r=>setTimeout(r,20));const computed=await calculateLWS(snapshot,bundle,{onProgress:message=>{const n=host.querySelector('[data-progress]');if(n)n.textContent=String(message);}});if(key===JSON.stringify(config)){result=computed;dirty=false;}else{result=null;dirty=true;}}
  catch(e){result=null;error=e.message;}
  finally{busy=false;render();}
 }
 function render(){
  if(host.lwsGeneration!==generation)return;
  host.replaceChildren();const hero=el('header',undefined,host,'lws-hero');el('p','LWS · MÉTODO COMPARTIDO',hero,'lws-eyebrow');el('h2','Diseño por categorías',hero);
  el('p','Escenarios por empresa · Kelly individual y conjunto · cupos máximos · reserva visible',hero);
  const toolbar=el('div',undefined,hero,'lws-toolbar');
  button(toolbar,busy?'Calculando…':'Calcular distribución',calculate).disabled=busy;
  const save=button(toolbar,storageScope==='local'?'Guardar en este navegador':'Guardar en ambas webs',async()=>{
   if(!saveSaved){error='Guardado en la nube no disponible.';render();return;}
   const check=validateConfig(config);if(check.errors?.length){error=check.errors.join(' · ');render();return;}
   try{save.disabled=true;const response=await saveSaved(structuredClone(config),revision);revision=typeof response==='number'?response:response.revision;savedAt=new Date().toLocaleString('es-ES');error='';render();}
   catch(e){error=e.message;render();}
  });save.disabled=busy||!saveSaved;
  button(toolbar,'Exportar configuración',()=>download({methodVersion:bundle.methodVersion,config,revision},'metodo-lws-configuracion.json'));
  button(toolbar,'Exportar paquete privado',()=>download({...bundle,config},'metodo-lws-paquete-privado.json'));
  button(toolbar,'Recargar configuración guardada',()=>mountLWSMethod(host,{loadData,loadSaved,saveSaved,loadHistory,storageScope})).disabled=busy;
  if(loadHistory)button(toolbar,'Descargar últimas100 versiones',async()=>{try{download({current:{config,revision},versions:await loadHistory()},'metodo-lws-historial.json');}catch(e){error=e.message;render();}});
  const importLabel=el('label','Importar configuración',toolbar,'lws-button');const upload=el('input',undefined,importLabel);upload.type='file';upload.accept='.json,application/json';upload.className='lws-file';
  upload.onchange=async()=>{try{const file=upload.files?.[0];if(!file)return;if(file.size>1_000_000)throw Error('Importa solo la configuración, sin el paquete de series.');const parsed=JSON.parse(await file.text()),next=parsed.config||parsed;const check=validateConfig(next);if(check.errors?.length)throw Error(check.errors.join(' · '));config=next;changed();}catch(e){error=e.message;render();}};
  el('p','DIAGNÓSTICO CONDICIONADO · los escenarios heredados y la dependencia simulada no son probabilidades futuras comprobadas.',host,'lws-notice');
  if(dirty)el('p','Entradas modificadas: resultados anteriores ocultos hasta volver a calcular.',host,'lws-notice');
  if(error)el('p',error,host,'lws-error');
  for(const message of result?.errors||[])el('p',friendly(message),host,'lws-error');
  if(busy){const progress=el('p','Optimizando la ley de escenarios…',host,'lws-notice');progress.dataset.progress='1';}
  if(savedAt)el('p',`Configuración guardada · revisión ${revision} · ${savedAt}`,host,'lws-saved');
  if(storageScope==='local')el('p','Modo local: estos cambios se guardan solo en este navegador. La sincronización entre webs requiere iniciar sesión.',host,'lws-muted');
  const categories=config.categories||[],params=config.parameters||{},positions=config.positions||[];
  const cards=el('div',undefined,host,'lws-kpis');
  function card(label,value,description){const c=el('article',undefined,cards,'lws-panel');const h=el('p',label,c,'lws-kpi-label');help(h,description);el('strong',value,c,'lws-kpi-value');}
  const risks=result?.historyRisk;
  card('Base parcial del ejercicio',euro(config.baseValueEUR),config.baseScope||'Base editable del ejercicio, distinta del patrimonio total y del saldo real.');
  card('Capital asignado',Number.isFinite(result?.cashFractional)?pct(1-result.cashFractional):'Pendiente','Suma de pesos fraccionados de instrumentos. Cupos sin ventaja o sin datos pueden permanecer en efectivo.');
  card('Efectivo del plan',result?pct(result.cashFractional):'Pendiente','Reserva resultante del cálculo, no saldo bancario. No confundir con el presupuesto estratégico de liquidez.');
  card('Acciones con peso',result?.solver?.converged&&Number.isFinite(result?.cashFractional)?String((result.positions||[]).filter(p=>p.type==='stock'&&p.weight>1e-8).length):'Pendiente','Se cuentan emisores únicos; fondos, oro y bloques cripto se presentan aparte. Máximo operativo de20 acciones.');
  card('Volatilidad histórica',pct(risks?.volatility),'Calculada con los pesos nuevos y retornos simultáneos EUR. Algunas series son representativas; cash se modela determinista. No es riesgo de todo el patrimonio ni previsión.');
  card('Diversificación',risks?.diversificationRatio==null?'Pendiente':number(risks.diversificationRatio)+'×','Volatilidad individual ponderada dividida por volatilidad de cartera. Más alto indica reducción histórica por dependencia imperfecta; no calidad empresarial.');
  card('Correlación de pares',number(risks?.weightedPairCorrelation),'Media ponderada entre pares distintos, excluyendo efectivo. >0,60 alerta de riesgo compartido; <0,30 favorable para diversificar, nunca señal de compra.');
  card('Entradas pendientes',Array.isArray(result?.pending)?String(result.pending.length):'Pendiente','Una entrada desconocida se muestra pendiente y no como rechazo económico con peso0. El cálculo parcial conserva el cupo sin invertir.');
  const diagrams=el('div',undefined,host,'lws-charts');donut(diagrams,categories,Object.fromEntries(categories.map(c=>[c.id,c.budget])),'Presupuesto estratégico');
  if(Number.isFinite(result?.cashFractional))donut(diagrams,categories,result.categoryWeights||Object.fromEntries(categories.map(c=>[c.id,c.id==='cash'?result.cashFractional:(result.positions||[]).filter(p=>p.categoryId===c.id).reduce((a,p)=>a+(p.weight||0),0)])),'Distribución calculada · fraccionada');
  const settings=el('section',undefined,host,'lws-panel');el('h3','Configuración del método',settings);const grid=el('div',undefined,settings,'lws-inputs');
  input(grid,'Base del ejercicio · EUR',config.baseValueEUR,v=>{config.baseValueEUR=v;changed();},{min:0});
  input(grid,'Liquidez anual · hipótesis %',params.cashAnnual,v=>{params.cashAnnual=v;changed();},{percent:true,min:-99.99});
  input(grid,'Fracción Kelly %',params.kellyFraction,v=>{params.kellyFraction=v;changed();},{percent:true,min:0,max:100});
  input(grid,'Reserva mínima %',params.minimumCash,v=>{params.minimumCash=v;changed();},{percent:true,min:0,max:100});
  input(grid,'Horizonte común · años',params.horizonYears,v=>{params.horizonYears=v;changed();},{min:1,max:30});
  const pl=el('label','Después de una salida temporal',grid),policy=el('select',undefined,pl);
  for(const [v,t]of [['pending','Pendiente: no combinar horizontes'],['cash','Reinvertir en efectivo al tipo configurado']]){const o=el('option',t,policy);o.value=v;}policy.value=params.postExitPolicy;policy.onchange=()=>{params.postExitPolicy=policy.value;changed();};
  const ml=el('label','Probabilidades utilizadas',grid),mode=el('select',undefined,ml);
  for(const [v,t]of [['inherited-diagnostic','Hipótesis heredadas · diagnóstico'],['documented','Documentadas por empresa']]){const o=el('option',t,mode);o.value=v;}mode.value=params.probabilityMode;mode.onchange=()=>{params.probabilityMode=mode.value;changed();};
  const categoryBody=table(settings,['Categoría','Bloque','Máximo de capital %']);
  for(const c of categories){const tr=el('tr',undefined,categoryBody);el('td',c.label,tr);el('td',c.block==='stable'?'Estable':'Convexo',tr);input(el('td',undefined,tr),'',c.budget,v=>{c.budget=v;changed();},{percent:true,min:0,max:100});}
  el('p','La liquidez pertenece al estable y se muestra por separado. Los máximos no obligan a invertir. Medio Kelly escala todo el vector y deja el remanente en efectivo.',settings,'lws-muted');
  const galaxy=el('details',undefined,host,'lws-panel');el('summary','Galaxy · catalizador BTC a tres años',galaxy);
  const thesis=config.galaxyThesis||{};el('p',thesis.catalyst||'Hipótesis pendiente',galaxy);const gg=el('div',undefined,galaxy,'lws-inputs');
  if(thesis.btcThreeYearRange)el('p',`Rango indicado por el usuario: ${number(thesis.btcThreeYearRange.low)}–${number(thesis.btcThreeYearRange.high)} ${thesis.btcThreeYearRange.currency||'moneda pendiente'}. No define por sí solo tres escenarios ni sus probabilidades.`,galaxy,'lws-notice');
  const range=thesis.btcThreeYearRange||{low:null,high:null,currency:null};
  for(const [key,label]of [['low','Rango terminal BTC3a · mínimo'],['high','Rango terminal BTC3a · máximo']])input(gg,label,range[key],v=>{range[key]=v;thesis.btcThreeYearRange=range;config.galaxyThesis=thesis;changed();},{min:0});
  const currencyLabel=el('label','Divisa del rango de BTC',gg),currency=el('select',undefined,currencyLabel);for(const [v,t]of [['','Pendiente de confirmar'],['USD','USD'],['EUR','EUR']]){const o=el('option',t,currency);o.value=v;}currency.value=range.currency||'';currency.onchange=()=>{range.currency=currency.value||null;thesis.btcThreeYearRange=range;config.galaxyThesis=thesis;changed();};
  for(const [key,label]of [['btcBearTargetUSD','BTC bajista · USD'],['btcBaseTargetUSD','BTC neutro · USD'],['btcBullTargetUSD','BTC alcista · USD']])input(gg,label,thesis[key],v=>{thesis[key]=v;config.galaxyThesis=thesis;changed();},{min:0});
  el('p','Una subida de BTC no se traslada mecánicamente a Galaxy. Se necesita un puente que separe Tesorería, Trading/gestión, Helios, deuda, inversión y dilución. Los campos vacíos permanecen pendientes.',galaxy,'lws-notice');
  if(bundle.galaxyResearch)button(galaxy,'Descargar expediente y fuentes de Galaxy',()=>download(bundle.galaxyResearch,'GLXY-expediente-fuentes.json'));
  if(bundle.galaxyResearch){const facts=el('details',undefined,galaxy);el('summary','Datos observados y fechas del expediente',facts);const body=table(facts,['Dato','Valor','Unidad','Fecha','Fuente']);for(const f of bundle.galaxyResearch.facts||[]){const tr=el('tr',undefined,body);[f.id,typeof f.value==='number'?number(f.value):String(f.value??'Pendiente'),f.unit,f.data_date,f.source_id].forEach(v=>el('td',v,tr));}const pending=el('details',undefined,galaxy);el('summary','Puentes económicos pendientes',pending);for(const m of bundle.galaxyResearch.missing||[])el('p',m.needed||m.id,pending,'lws-notice');}
  const results=new Map((result?.positions||[]).map(p=>[p.id,p]));
  function list(origin,title){
   const section=el('section',undefined,host,'lws-panel');el('h3',title,section);
   const body=table(section,['Incluir','Posición / categoría','Estado / horizonte','LWS exceso','Individual exacto','Conjunto pleno','Fraccionado','Importe EUR']);
   for(const p of positions.filter(p=>(p.origin||'holding')===origin)){
    const row=el('tr',undefined,body),check=el('input',undefined,el('td',undefined,row));check.type='checkbox';check.checked=p.enabled;check.onchange=()=>{p.enabled=check.checked;changed();};
    const name=el('td',undefined,row);el('strong',p.name,name);const select=el('select',undefined,name);
    for(const c of categories.filter(c=>c.id!=='cash')){const o=el('option',c.label,select);o.value=c.id;}select.value=p.categoryId;select.onchange=()=>{p.categoryId=select.value;p.temporary=select.value==='opportunities';changed();};
    const r=results.get(p.id);el('td',(p.enabled?(r?.weight===null?'Pendiente':r?'Condicional':'Sin calcular'):'Excluida')+' · '+(p.horizonYears==null?'plazo pendiente':p.horizonYears+'a'),row);
    el('td',number(r?.diagnostic?.score),row);el('td',pct(r?.diagnostic?.exact),row);el('td',pct(r?.fullWeight),row);el('td',pct(r?.weight),row);el('td',euro(r?.amountEUR),row);
    const detailRow=el('tr',undefined,body),cell=el('td',undefined,detailRow);cell.colSpan=8;const detail=el('details',undefined,cell);el('summary','Escenarios, tesis y fuentes · '+p.ticker,detail);
    const fields=el('div',undefined,detail,'lws-inputs');input(fields,'Horizonte propio · años',p.horizonYears,v=>{p.horizonYears=v;changed();},{min:1,max:30});input(fields,'Tope por emisor %',p.cap,v=>{p.cap=v;changed();},{percent:true,min:0,max:100});
    const scenarios=table(detail,['Escenario','Retorno acumulado %','Probabilidad %']);
    ['Bajista','Neutro','Alcista'].forEach((label,i)=>{const tr=el('tr',undefined,scenarios);el('td',label,tr);input(el('td',undefined,tr),'',p.returns?.[i],v=>{p.returns??=[null,null,null];p.returns[i]=v;p.inputStatus='conditional';changed();},{percent:true,min:-100});input(el('td',undefined,tr),'',p.probabilities?.[i],v=>{p.probabilities??=[null,null,null];p.probabilities[i]=v;changed();},{percent:true,min:0,max:100});});
    const evidence=el('label','Fuente y razonamiento de las probabilidades',detail),area=el('textarea',undefined,evidence);area.value=p.probabilityEvidence||'';area.rows=2;area.onchange=()=>{p.probabilityEvidence=area.value;changed();};
    const catalyst=el('label','Catalizador / tesis temporal',detail),ct=el('textarea',undefined,catalyst);ct.value=p.catalyst||'';ct.rows=2;ct.onchange=()=>{p.catalyst=ct.value;changed();};
    const exit=el('label','Condiciones de revisión o salida',detail),ex=el('textarea',undefined,exit);ex.value=p.exitRule||'';ex.rows=2;ex.onchange=()=>{p.exitRule=ex.value;changed();};
    el('p',p.sourceNote||'Procedencia pendiente.',detail,'lws-muted');
    if(p.legacy5y){const legacy=el('p','Matriz anterior a cinco años archivada: '+p.legacy5y.returns.map(pct).join(' / ')+'. No se usa para inferir automáticamente el horizonte temporal.',detail,'lws-muted');help(legacy,'Cambiar la duración de una tesis exige nuevos escenarios; no se divide un retorno por años ni se copia una probabilidad sin justificarla.');}
   }
  }
  list('holding','Posiciones del archivo de cartera');list('candidate','Candidatas y watchlist');
  const risk=el('details',undefined,host,'lws-panel');el('summary','Correlaciones y riesgo compartido',risk);
  el('p',bundle.provenance?.historyStatus||'Historia pendiente',risk,'lws-notice');
  if(risks?.pairs?.length){const representatives=new Set(bundle.history?.representativeCodes||[]);const body=table(risk,['Par','Correlación','Lectura','Series']);for(const p of [...risks.pairs].sort((a,b)=>(b.correlation??-2)-(a.correlation??-2))){const tr=el('tr',undefined,body);el('td',p.a+' / '+p.b,tr);el('td',number(p.correlation),tr);el('td',!Number.isFinite(p.correlation)?'Pendiente':p.correlation>.6?'Alerta: riesgo compartido':p.correlation<.3?'Diversificación favorable':'Intermedia',tr);el('td',[p.a,p.b].filter(id=>representatives.has(id)).map(id=>id+' representativa').join(' · ')||'Del archivo',tr);}}
  const notices=el('section',undefined,host,'lws-panel');el('h3','Lectura y pendientes',notices);
  if(bundle.userDecisions?.atlas&&!bundle.userDecisions.atlas.ticker)el('p','Atlas: expediente solicitado; identidad pendiente de confirmar. No se sustituye por otra empresa con nombre parecido.',notices,'lws-notice');
  const selectedStocks=(result?.positions||[]).filter(p=>p.type==='stock'&&p.weight>1e-8).length;
  if(result?.solver?.converged&&selectedStocks>0&&selectedStocks<8)el('p',`El diagnóstico asigna peso a ${selectedStocks} acciones: queda por debajo de la preferencia de8–10. No se admite una candidata sin tesis suficiente para completar el número.`,notices,'lws-notice');
  for(const message of result?.warnings||[])el('p',friendly(typeof message==='string'?message:JSON.stringify(message)),notices,'lws-notice');
  if(result?.solver)el('p',`Solver: ${result.solver.converged?'convergencia numérica':'revisar convergencia'} · gap ${number(result.solver.gap)}. Precisión matemática sobre una ley hipotética; no valida sus previsiones.`,notices,'lws-muted');
  el('p',bundle.provenance?.dependence||'',notices,'lws-muted');el('p',`Datos base: ${config.sourceCutoff||'fecha pendiente'} · parámetros revisados: ${config.asOf||'sin fecha'}. No se ejecutan operaciones ni se sobrescribe la doctrina de patrimonio.`,notices,'lws-muted');
  if(bundle.candidates){const d=el('details',undefined,notices);el('summary','Investigación de candidatas y fuentes',d);button(d,'Descargar investigación',()=>download(bundle.candidates,'candidatos-categorias.json'));}
  if(busy)host.querySelectorAll('input,select,textarea').forEach(n=>n.disabled=true);
 }
 render();await calculate();return {getConfiguration:()=>structuredClone(config),getResult:()=>result};
}
