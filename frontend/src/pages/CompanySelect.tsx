// src/pages/CompanySelect.tsx
import { useEffect, useState } from 'react';
import { getCompanies, createCompany, closeLedger, reopenLedger } from '../api';
import type { Company } from '../types';
import styles from './CompanySelect.module.css';

const BASE = 'http://localhost:8000';

interface Props { onSelect: (company: Company) => void; onLogout: () => void; }
type ModalMode = 'create' | 'edit' | 'delete' | 'close_ledger' | null;

interface StockForm { no_vat: string; vat: string; total: string; }
const emptyStock = (): StockForm => ({ no_vat: '', vat: '', total: '' });

const MONTHS = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];

export default function CompanySelect({ onSelect, onLogout }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [target, setTarget] = useState<Company | null>(null);
  const [form, setForm] = useState({ name: '', tax_id: '', chamber_id: '' });
  const [stock, setStock] = useState<StockForm>(emptyStock());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Close ledger date picker state
  const today = new Date();
  const [closeDay,   setCloseDay]   = useState(today.getDate());
  const [closeMonth, setCloseMonth] = useState(today.getMonth() + 1);
  const [closeYear,  setCloseYear]  = useState(today.getFullYear());

  useEffect(() => { getCompanies().then(setCompanies).finally(() => setLoading(false)); }, []);

  const openCreate = () => {
    setForm({ name: '', tax_id: '', chamber_id: '' }); setStock(emptyStock()); setError(''); setTarget(null); setModalMode('create');
  };
  const openEdit = (c: Company, e: React.MouseEvent) => {
    e.stopPropagation();
    setForm({ name: c.name, tax_id: c.tax_id, chamber_id: c.chamber_id??'' });
    setStock({ no_vat: String(c.opening_stock_no_vat), vat: String(c.opening_stock_vat), total: String(c.opening_stock_total) });
    setError(''); setTarget(c); setModalMode('edit');
  };
  const openDelete = (c: Company, e: React.MouseEvent) => { e.stopPropagation(); setTarget(c); setError(''); setModalMode('delete'); };
  const openCloseLedger = (c: Company, e: React.MouseEvent) => {
    e.stopPropagation(); setTarget(c); setError('');
    // Pre-fill with existing close date or today
    if (c.ledger_closed_date) {
      const [y,m,d] = c.ledger_closed_date.split('-');
      setCloseYear(parseInt(y)); setCloseMonth(parseInt(m)); setCloseDay(parseInt(d));
    } else {
      setCloseDay(today.getDate()); setCloseMonth(today.getMonth()+1); setCloseYear(today.getFullYear());
    }
    setModalMode('close_ledger');
  };
  const close = () => { setModalMode(null); setTarget(null); setError(''); };

  const payload = () => ({
    name: form.name.trim(), tax_id: form.tax_id.trim(),
    chamber_id: form.chamber_id.trim() || undefined,
    opening_stock_no_vat: parseFloat(stock.no_vat)||0,
    opening_stock_vat:    parseFloat(stock.vat)||0,
    opening_stock_total:  parseFloat(stock.total)||0,
  });

  const handleCreate = async () => {
    if (!form.name.trim() || !form.tax_id.trim()) { setError('Denumirea și CUI-ul sunt obligatorii.'); return; }
    try { const c = await createCompany(payload()); setCompanies(p=>[...p,c]); close(); onSelect(c); }
    catch(e:any){setError((e as Error).message);}
  };

  const handleEdit = async () => {
    if (!form.name.trim() || !form.tax_id.trim() || !target) { setError('Câmpuri obligatorii lipsă.'); return; }
    try {
      const res = await fetch(`${BASE}/companies/${target.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload())});
      if(!res.ok) throw new Error(((await res.json()) as any).detail);
      const updated: Company = await res.json();
      setCompanies(p=>p.map(c=>c.id===updated.id?updated:c)); close();
    } catch(e:any){setError((e as Error).message);}
  };

  const handleDelete = async () => {
    if (!target) return;
    try {
      const res = await fetch(`${BASE}/companies/${target.id}`,{method:'DELETE'});
      if(!res.ok) throw new Error(((await res.json()) as any).detail);
      setCompanies(p=>p.filter(c=>c.id!==target.id)); close();
    } catch(e:any){setError((e as Error).message);}
  };

  const handleCloseLedger = async () => {
    if (!target) return;
    const daysInMonth = new Date(closeYear, closeMonth, 0).getDate();
    const safeDay = Math.min(closeDay, daysInMonth);
    const iso = `${closeYear}-${String(closeMonth).padStart(2,'0')}-${String(safeDay).padStart(2,'0')}`;
    try {
      const updated = await closeLedger(target.id, iso);
      setCompanies(p=>p.map(c=>c.id===updated.id?updated:c)); close();
    } catch(e:any){setError((e as Error).message);}
  };

  const handleReopenLedger = async (c: Company, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const updated = await reopenLedger(c.id);
      setCompanies(p=>p.map(co=>co.id===updated.id?updated:co));
    } catch(e:any){setError((e as Error).message);}
  };

  const sf = (k: keyof StockForm, v: string) => setStock(s=>({...s,[k]:v}));
  const yearOptions = Array.from({length:10},(_,i)=>today.getFullYear()-i);
  const daysInSelectedMonth = new Date(closeYear, closeMonth, 0).getDate();

  return (
    <div className={styles.page}>
      <div className={styles.left}>
        <div className={styles.brand}><span className={styles.brandMark}>◆</span><span className={styles.brandName}>Evidența stocurilor</span></div>
        <p className={styles.tagline}>Selectați sau creați o companie pentru a continua.</p>
      </div>
      <div className={styles.right}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Companii</h2>
            <div style={{display:'flex',gap:8}}>
              <button className={styles.btnLogout} onClick={onLogout} title="Deconectare">⎋ Ieșire</button>
              <button className={styles.btnNew} onClick={openCreate}>+ Companie nouă</button>
            </div>
          </div>
          {loading ? <div className={styles.empty}>Se încarcă...</div>
            : companies.length===0 ? <div className={styles.empty}>Nicio companie înregistrată.</div>
            : (
              <ul className={styles.list}>
                {companies.map(c=>(
                  <li key={c.id} className={styles.listItem}>
                    <div className={styles.listClickable} onClick={()=>onSelect(c)}>
                      <div className={styles.listMain}>
                        <span className={styles.listName}>
                          {c.name}
                          {c.ledger_closed_date && <span className={styles.closedBadge}>Închis {c.ledger_closed_date.split('-').reverse().join('.')}</span>}
                        </span>
                        <span className={styles.listSub}>{c.tax_id}{c.chamber_id?` · ${c.chamber_id}`:''}</span>
                      </div>
                      <span className={styles.listArrow}>→</span>
                    </div>
                    <div className={styles.listActions}>
                      <button className={styles.iconBtn} title="Editează" onClick={e=>openEdit(c,e)}>✎</button>
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnLedger}`}
                        title={c.ledger_closed_date ? 'Redeschide registrul' : 'Închide registrul'}
                        onClick={c.ledger_closed_date ? e=>handleReopenLedger(c,e) : e=>openCloseLedger(c,e)}
                      >
                        {c.ledger_closed_date ? '🔓' : '🔒'}
                      </button>
                      <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} title="Șterge" onClick={e=>openDelete(c,e)}>✕</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>

      {/* Create / Edit modal */}
      {(modalMode==='create'||modalMode==='edit')&&(
        <div className={styles.modalBackdrop} onClick={e=>e.target===e.currentTarget&&close()}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>{modalMode==='create'?'Companie nouă':'Editează compania'}</h3>
            <label className={styles.label}>Denumire *</label>
            <input className={styles.input} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="ex. SC Exemplu SRL" autoFocus/>
            <label className={styles.label}>CUI / Tax ID *</label>
            <input className={`${styles.input} ${styles.mono}`} value={form.tax_id} onChange={e=>setForm(f=>({...f,tax_id:e.target.value}))} placeholder="ex. RO12345678"/>
            <label className={styles.label}>Nr. Reg. Comerț</label>
            <input className={styles.input} value={form.chamber_id} onChange={e=>setForm(f=>({...f,chamber_id:e.target.value}))} placeholder="ex. J40/1234/2020"/>
            <label className={styles.label}>Stoc inițial</label>
            <div className={styles.stockRow}>
              <div className={styles.stockField}><span className={styles.stockFieldLabel}>Fără TVA</span><input className={`${styles.input} ${styles.mono}`} type="number" min="0" step="0.01" value={stock.no_vat} onChange={e=>sf('no_vat',e.target.value)} placeholder="0.00"/></div>
              <div className={styles.stockField}><span className={styles.stockFieldLabel}>TVA</span><input className={`${styles.input} ${styles.mono}`} type="number" min="0" step="0.01" value={stock.vat} onChange={e=>sf('vat',e.target.value)} placeholder="0.00"/></div>
              <div className={styles.stockField}><span className={styles.stockFieldLabel}>Total</span><input className={`${styles.input} ${styles.mono}`} type="number" min="0" step="0.01" value={stock.total} onChange={e=>sf('total',e.target.value)} placeholder="0.00"/></div>
            </div>
            {error&&<p className={styles.error}>{error}</p>}
            <div className={styles.modalActions}>
              <button className={styles.btnCancel} onClick={close}>Anulare</button>
              <button className={styles.btnConfirm} onClick={modalMode==='create'?handleCreate:handleEdit}>{modalMode==='create'?'Creează':'Salvează'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {modalMode==='delete'&&target&&(
        <div className={styles.modalBackdrop} onClick={e=>e.target===e.currentTarget&&close()}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Șterge compania</h3>
            <p className={styles.confirmBody}>Ești sigur că vrei să ștergi <span className={styles.confirmName}>{target.name}</span>? Aceasta va șterge toate datele asociate și nu poate fi anulată.</p>
            {error&&<p className={styles.error}>{error}</p>}
            <div className={styles.modalActions}>
              <button className={styles.btnCancel} onClick={close}>Anulare</button>
              <button className={styles.btnDanger} onClick={handleDelete}>Șterge definitiv</button>
            </div>
          </div>
        </div>
      )}

      {/* Close ledger modal */}
      {modalMode==='close_ledger'&&target&&(
        <div className={styles.modalBackdrop} onClick={e=>e.target===e.currentTarget&&close()}>
          <div className={styles.modal}>
            <h3 className={styles.modalTitle}>Închide registrul</h3>
            <p className={styles.confirmBody}>
              Selectează ziua de închidere pentru <span className={styles.confirmName}>{target.name}</span>.
              Toate zilele până la și inclusiv această dată vor fi blocate pentru editare.
            </p>
            <label className={styles.label}>Ziua de închidere</label>
            <div className={styles.datePickerRow}>
              <select className={styles.datePart} value={closeDay} onChange={e=>setCloseDay(Number(e.target.value))}>
                {Array.from({length:daysInSelectedMonth},(_,i)=>i+1).map(d=><option key={d} value={d}>{String(d).padStart(2,'0')}</option>)}
              </select>
              <select className={styles.datePart} value={closeMonth} onChange={e=>setCloseMonth(Number(e.target.value))}>
                {MONTHS.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
              </select>
              <select className={styles.datePart} value={closeYear} onChange={e=>setCloseYear(Number(e.target.value))}>
                {yearOptions.map(y=><option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {error&&<p className={styles.error}>{error}</p>}
            <div className={styles.modalActions}>
              <button className={styles.btnCancel} onClick={close}>Anulare</button>
              <button className={styles.btnLedger} onClick={handleCloseLedger}>🔒 Închide registrul</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
