// Quantity-only replay; no prices, FX, cash balance or valuation inferred.
export function canonicalQuantities(events){
 const decimal=n=>{const [mantissa,exponent='0']=String(n).toLowerCase().split('e'),parts=mantissa.split('.');let scale=(parts[1]||'').length-Number(exponent),value=BigInt(parts.join(''));if(scale<0){value*=10n**BigInt(-scale);scale=0;}return {value,scale};};
 const combine=(a,b,subtract=false)=>{const scale=Math.max(a.scale,b.scale);return {value:a.value*10n**BigInt(scale-a.scale)+(subtract?-1n:1n)*b.value*10n**BigInt(scale-b.scale),scale};};
 const holdings=new Map(),order={switch:0,sell:1,optionSell:1,withdrawal:1,commission:1,spinOff:2,split:3,buy:4,optionBuy:4,switchBuy:5,spinOffBuy:5,deposit:6,interest:6,stakeReward:6,scrip:6,adjust:9};
 const add=new Set(['buy','optionBuy','scrip','switchBuy','spinOffBuy','stakeReward','interest','deposit','adjust']);
 const sub=new Set(['sell','optionSell','switch','withdrawal','commission']);
 for(const e of [...events].sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||'')||(order[a.type]??5)-(order[b.type]??5)||a.id.localeCompare(b.id))){
  if(e.ticker==='CASH_EUR')continue;
  const key=e.broker+'|'+e.ticker,h=holdings.get(key)||{ticker:e.ticker,broker:e.broker,quantity:0,pending:false,decimal:decimal(0)};holdings.set(key,h);
  if(e.type==='spinOff')continue;
  if(!Number.isFinite(e.quantity)){h.pending=true;continue;}
  const q=decimal(e.quantity);if(add.has(e.type))h.decimal=combine(h.decimal,q);else if(sub.has(e.type))h.decimal=combine(h.decimal,q,true);else if(e.type==='split'){const f=decimal(e.quantity||1);h.decimal={value:h.decimal.value*f.value,scale:h.decimal.scale+f.scale};}else h.pending=true;
 }
 return [...holdings.values()].map(({decimal:d,...h})=>({...h,quantity:Number(String(d.value)+'e-'+d.scale)})).sort((a,b)=>a.ticker.localeCompare(b.ticker)||a.broker.localeCompare(b.broker));
}
