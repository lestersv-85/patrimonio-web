// Accounting records only. The server owns replay, idempotency and concurrency checks.
export function operationRequest(row) {
  if (!['buy','sell','deposit','withdrawal'].includes(row.type)) throw Error('Este tipo requiere conciliación auditada; no se guarda por la ruta antigua.');
  if (row.currency !== 'EUR' || (row.fx != null && row.fx !== 1)) throw Error('La ruta actual requiere liquidación EUR verificada.');
  if (row.tax != null && row.tax !== 0) throw Error('Los impuestos requieren la ruta de conciliación; no se omiten.');
  if (row.commission_ccy && row.commission_ccy !== 'EUR') throw Error('La comisión debe estar expresada en EUR.');
  if (!row.account_id || !row.execution_ref?.trim() || !row.description?.trim()) throw Error('Indica cuenta, referencia única y fuente del movimiento.');
  const trade = ['buy','sell'].includes(row.type);
  if (!trade && row.position_id) throw Error('Este aporte o retirada es efectivo, sin títulos.');
  if (!row.id) throw Error('Falta identificador persistente de la solicitud.');
  return {id:row.id.startsWith('manual-')?row.id:'manual-'+row.id,date:row.date,time:row.time||null,
    account_id:row.account_id,position_id:trade?row.position_id:null,type:row.type,
    qty:trade?row.qty:null,price:trade?row.price:null,currency:'EUR',commission:row.commission,
    total_eur:row.total_eur,total_comm_eur:row.total_comm_eur,execution_ref:row.execution_ref.trim(),
    source_reference:row.description.trim(),asset:trade?'unclassified':'liquidity'};
}
const definitive = new Set(['STALE_REVISION','POSSIBLE_DUPLICATE','AMBIGUOUS_INTRADAY_ORDER','AMBIGUOUS_HISTORICAL_ORDER',
  'POSITION_HISTORY_REQUIRES_RECONCILIATION','TRADE_AMOUNTS_MISMATCH','CASH_FLOW_FIELDS_INVALID',
  'UNKNOWN_OWNED_ACCOUNT_OR_POSITION','INVALID_AMOUNTS','INVALID_DATE','INVALID_TIME',
  'EXECUTION_ALREADY_RECORDED','TRADE_FIELDS_REQUIRED','IDENTITY_OR_EVIDENCE_REQUIRED','AMOUNTS_REQUIRED','UNKNOWN_FIELD','INVALID_EVENT','TYPE_REQUIRES_RECONCILIATION']);
export function createOperationWriter(rpc,journal) {
  let revision=null;const status={enabled:false,pending:0};
  return {status,
    async refresh(){const data=await rpc('cartera_ledger_snapshot',{});if(!Number.isSafeInteger(data.revision))throw Error('Revisión canónica inválida.');revision=data.revision;status.enabled=data.enabled;status.pending=data.pending;return data;},
    pending(){return journal.read();},
    async save(row){
      const payload=operationRequest(row);
      const previous=journal.read();
      if(previous&&JSON.stringify(previous.payload)!==JSON.stringify(payload))throw Error('Hay una solicitud pendiente de confirmación. Reabre y reintenta esa operación antes de registrar otra.');
      if(revision===null)await this.refresh();
      if(!status.enabled||status.pending)throw Error('Escritura pendiente de activación y conciliación.');
      journal.write({payload,row});
      try {
        const result=await rpc('cartera_record_operation',{p_event:payload,p_revision:revision});
        if(!result.id||!Number.isSafeInteger(result.revision))throw Error('Confirmación incompleta. Reintenta la misma solicitud.');
        revision=result.revision;journal.clear();return result;
      } catch(error) {
        if(error.code==='P0001'&&(definitive.has(error.message)||error.message?.startsWith('NEGATIVE_POSITION'))){journal.clear();if(error.message==='STALE_REVISION')await this.refresh();}
        throw error;
      }
    }
  };
}
