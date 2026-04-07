// src/pages/DayView.tsx
import { useEffect, useRef, useState } from 'react';
import type {
  Company, Counterparty, Product, InventoryItem,
  Transaction, TransactionCreate, TransactionItemCreate, TransactionItemSchema,
  ExitRecord, ExitCreate, ExitItemCreate, ExitItemSchema,
  DailyReport,
} from '../types';
import {
  getDailyReport, getCounterparties, getProducts, getInventory,
  createTransaction, updateTransaction,
  createTransactionItem, updateTransactionItem, deleteTransactionItem,
  createExit, updateExit,
  createExitItem, updateExitItem, deleteExitItem,
  BASE,
} from '../api';
import SellerSearch from '../components/SellerSearch';
import ProductSearch from '../components/ProductSearch';
import styles from './DayView.module.css';

// ── Export helpers ─────────────────────────────────────────────────────────
// Dynamic import so bundle stays lean when export isn't used
async function exportDay(report: DailyReport, company: Company, date: string, format: 'pdf' | 'excel') {
  const companyName = company.name;
  const [y, m, d] = date.split('-');
  const dateLabel = `${d}.${m}.${y}`;
  const filename = `${companyName}_${y}${m}${d}`;

  const entryRows: (string | number)[][] = [];
  for (const tx of report.transactions) {
    const cpName = tx.seller?.name ?? `ID:${tx.seller_id}`;
    for (const item of tx.items) {
      entryRows.push([
        cpName,
        tx.invoice_number ?? '—',
        tx.register_entry_number ?? '—',
        item.product?.name ?? `ID:${item.product_id}`,
        parseFloat(item.purchase_no_tax),
        parseFloat(item.purchase_tax_amount),
        parseFloat(item.total_purchase),
        parseFloat(item.total_resale),
        parseFloat(item.resale_vat),
        parseFloat(item.resale_no_tax),
        parseFloat(item.markup),
      ]);
    }
  }
  const entryHeaders = ['Furnizor','Nr. factură','Nr. intrare','Produs','Fără TVA','TVA','Total cump.','Total vânz.','TVA vânz.','Fără TVA vânz.','Adaos'];

  const exitRows: (string | number)[][] = [];
  for (const ex of report.exits) {
    const cpName = ex.buyer?.name ?? `ID:${ex.buyer_id}`;
    for (const item of ex.items) {
      exitRows.push([
        cpName,
        ex.document_number ?? '—',
        item.product?.name ?? `ID:${item.product_id}`,
        parseFloat(item.total_sale),
        parseFloat(item.vat_amount),
        parseFloat(item.total_sale_no_vat),
      ]);
    }
  }
  const exitHeaders = ['Beneficiar','Nr. document','Produs','Total cu TVA','TVA','Fără TVA'];

  if (format === 'pdf') {
    const jsPDF = (await import('jspdf')).default;
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.text(`${companyName} — ${dateLabel}`, 14, 16);

    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(60);
    doc.text('INTRĂRI', 14, 26); doc.setTextColor(0);

    autoTable(doc, {
      startY: 30,
      head: [entryHeaders],
      body: entryRows.map(r => r.map(String)),
      headStyles: { fillColor: [26,25,23], textColor: [245,244,240], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248,247,242] },
      margin: { left: 14, right: 14 },
    });

    const afterEntries = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(60);
    doc.text('IEȘIRI', 14, afterEntries); doc.setTextColor(0);

    autoTable(doc, {
      startY: afterEntries + 4,
      head: [exitHeaders],
      body: exitRows.map(r => r.map(String)),
      headStyles: { fillColor: [26,25,23], textColor: [245,244,240], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248,247,242] },
      margin: { left: 14, right: 14 },
    });

    doc.save(`${filename}.pdf`);
  } else {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    const wsE = XLSX.utils.aoa_to_sheet([entryHeaders, ...entryRows]);
    wsE['!cols'] = entryHeaders.map((_, i) => ({ wch: Math.max(entryHeaders[i].length, ...entryRows.map(r => String(r[i]).length)) + 2 }));
    XLSX.utils.book_append_sheet(wb, wsE, 'Intrări');

    const wsX = XLSX.utils.aoa_to_sheet([exitHeaders, ...exitRows]);
    wsX['!cols'] = exitHeaders.map((_, i) => ({ wch: Math.max(exitHeaders[i].length, ...exitRows.map(r => String(r[i]).length)) + 2 }));
    XLSX.utils.book_append_sheet(wb, wsX, 'Ieșiri');

    XLSX.writeFile(wb, `${filename}.xlsx`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface Props { company: Company; date: string; onBack: () => void; }

const fmt = (v: string | number) =>
  Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`;
}

// ── Editable row shapes ────────────────────────────────────────────────────

interface EditTx { seller: Counterparty | null; invoice: string; register: string; }
interface EditEx { buyer: Counterparty | null; document: string; }

interface EditEntryItem {
  product: Product | null;
  purchase_no_tax: string; purchase_tax_amount: string; total_resale: string;
  c_tp: number; c_rnt: number; c_rv: number; c_mu: number; c_vat_pct: string;
}
interface EditExitItem {
  product: Product | null;
  total_sale: string; vat_amount: string; c_no_vat: number;
}

function computeEntryItem(d: EditEntryItem): Partial<EditEntryItem> {
  const pn = parseFloat(d.purchase_no_tax) || 0;
  const tn = parseFloat(d.purchase_tax_amount) || 0;
  const rs = parseFloat(d.total_resale) || 0;
  const tf = pn > 0 ? 1 + tn / pn : 1;
  const rnt = pn > 0 ? rs / tf : 0;
  return { c_tp: pn+tn, c_rnt: rnt, c_rv: rs-rnt, c_mu: pn>0?rnt-pn:0, c_vat_pct: pn>0?`${Math.round((tn/pn)*100)}%`:'—' };
}
function computeExitItem(d: EditExitItem): Partial<EditExitItem> {
  return { c_no_vat: (parseFloat(d.total_sale)||0) - (parseFloat(d.vat_amount)||0) };
}

const entryItemValid = (d: EditEntryItem) => d.product!==null && parseFloat(d.purchase_no_tax)>0 && parseFloat(d.total_resale)>0;
const exitItemValid  = (d: EditExitItem)  => d.product!==null && parseFloat(d.total_sale)>0;

function txToEdit(tx: Transaction, cps: Counterparty[]): EditTx {
  return { seller: cps.find(c => c.id===tx.seller_id)??null, invoice: tx.invoice_number??'', register: tx.register_entry_number??'' };
}
function exToEdit(ex: ExitRecord, cps: Counterparty[]): EditEx {
  return { buyer: cps.find(c => c.id===ex.buyer_id)??null, document: ex.document_number??'' };
}
function tiToEdit(ti: TransactionItemSchema, prods: Product[]): EditEntryItem {
  const base: EditEntryItem = {
    product: prods.find(p => p.id===ti.product_id)??null,
    purchase_no_tax: String(ti.purchase_no_tax), purchase_tax_amount: String(ti.purchase_tax_amount),
    total_resale: String(ti.total_resale),
    c_tp:0, c_rnt:0, c_rv:0, c_mu:0, c_vat_pct:'—',
  };
  return { ...base, ...computeEntryItem(base) };
}
function eiToEdit(ei: ExitItemSchema, prods: Product[]): EditExitItem {
  const base: EditExitItem = { product: prods.find(p => p.id===ei.product_id)??null, total_sale: String(ei.total_sale), vat_amount: String(ei.vat_amount), c_no_vat:0 };
  return { ...base, ...computeExitItem(base) };
}

const emptyEditTx = (): EditTx => ({ seller: null, invoice: '', register: '' });
const emptyEditEx = (): EditEx => ({ buyer: null, document: '' });
const emptyEditEntryItem = (): EditEntryItem => ({ product:null, purchase_no_tax:'', purchase_tax_amount:'', total_resale:'', c_tp:0, c_rnt:0, c_rv:0, c_mu:0, c_vat_pct:'—' });
const emptyEditExitItem  = (): EditExitItem  => ({ product:null, total_sale:'', vat_amount:'', c_no_vat:0 });

// ── Component ──────────────────────────────────────────────────────────────

export default function DayView({ company, date, onBack }: Props) {
  const [report,         setReport]         = useState<DailyReport | null>(null);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [products,       setProducts]       = useState<Product[]>([]);
  const [inventory,      setInventory]      = useState<InventoryItem[]>([]);

  // Is this day permanently locked by the ledger?
  const ledgerLocked = !!(
    company.ledger_closed_date &&
    date <= company.ledger_closed_date
  );

  const [editUnlocked, setEditUnlocked] = useState(false);
  // effective editable = not ledger-locked AND editUnlocked
  const canEdit = !ledgerLocked && editUnlocked;

  const [saving,    setSaving]    = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error,     setError]     = useState('');
  const [showToast, setShowToast] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [entriesOpen, setEntriesOpen] = useState(true);
  const [exitsOpen,   setExitsOpen]   = useState(true);
  const [txOpen,      setTxOpen]      = useState<Record<number, boolean>>({});
  const [exOpen,      setExOpen]      = useState<Record<number, boolean>>({});

  // Edit state for existing counterparty headers
  const [txEdits, setTxEdits] = useState<Record<number, EditTx | null>>({});
  const [exEdits, setExEdits] = useState<Record<number, EditEx | null>>({});

  // Edit state for existing items (null = display, object = editing)
  const [tiEdits, setTiEdits] = useState<Record<number, EditEntryItem | null>>({});
  const [eiEdits, setEiEdits] = useState<Record<number, EditExitItem  | null>>({});

  // Draft (new) rows
  const [draftTx,         setDraftTx]         = useState<EditTx | null>(null);
  const [draftEx,         setDraftEx]         = useState<EditEx | null>(null);
  const [draftEntryItems, setDraftEntryItems] = useState<Record<number, EditEntryItem | null>>({});
  const [draftExitItems,  setDraftExitItems]  = useState<Record<number, EditExitItem  | null>>({});

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = async () => {
    const [rep, cps, prods, inv] = await Promise.all([
      getDailyReport(company.id, date),
      getCounterparties(),
      getProducts(company.id),
      getInventory(company.id),
    ]);
    setReport(rep); setCounterparties(cps); setProducts(prods); setInventory(inv);
    if (!ledgerLocked && (rep.transactions.length > 0 || rep.exits.length > 0)) {
      setEditUnlocked(false);
    }
  };

  useEffect(() => { load(); }, [company.id, date]);

  const refreshReport = async () => {
    const [rep, inv] = await Promise.all([getDailyReport(company.id, date), getInventory(company.id)]);
    setReport(rep); setInventory(inv);
  };

  const handleLock = async () => { await refreshReport(); setEditUnlocked(false); setDraftTx(null); setDraftEx(null); setTxEdits({}); setExEdits({}); setTiEdits({}); setEiEdits({}); setDraftEntryItems({}); setDraftExitItems({}); triggerToast(); };

  const triggerToast = () => {
    setShowToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setShowToast(false), 2000);
  };

  // ── Tx header CRUD ────────────────────────────────────────────────────────

  const submitNewTx = async () => {
    if (!draftTx?.seller) return;
    setSaving(true); setError('');
    try {
      const tx = await createTransaction(company.id, date, { seller_id: draftTx.seller.id, invoice_number: draftTx.invoice||undefined, register_entry_number: draftTx.register||undefined });
      setDraftTx(null); setTxOpen(p => ({...p,[tx.id]:true})); await refreshReport();
    } catch(e:any){setError((e as Error).message);}
    finally{setSaving(false);}
  };

  const saveExistingTx = async (id: number) => {
    const ed = txEdits[id]; if (!ed?.seller) return;
    setSavingKey(`tx-${id}`); setError('');
    try {
      await updateTransaction(company.id, id, { seller_id: ed.seller.id, invoice_number: ed.invoice||undefined, register_entry_number: ed.register||undefined });
      setTxEdits(p => ({...p,[id]:null})); await refreshReport();
    } catch(e:any){setError((e as Error).message);}
    finally{setSavingKey(null);}
  };

  const deleteTx = async (id: number) => {
    setSavingKey(`tx-${id}`);
    try { await fetch(`${BASE}/companies/${company.id}/transactions/${id}`,{method:'DELETE'}); await refreshReport(); }
    catch(e:any){setError((e as Error).message);}
    finally{setSavingKey(null);}
  };

  // ── Entry item CRUD ───────────────────────────────────────────────────────

  const submitNewEntryItem = async (txId: number) => {
    const d = draftEntryItems[txId]; if(!d||!entryItemValid(d)) return;
    setSavingKey(`dti-${txId}`); setError('');
    try {
      await createTransactionItem(company.id, txId, { product_id:d.product!.id, purchase_no_tax:parseFloat(d.purchase_no_tax), purchase_tax_amount:parseFloat(d.purchase_tax_amount)||0, total_resale:parseFloat(d.total_resale) });
      setDraftEntryItems(p=>({...p,[txId]:null}));
      const [rep,inv,prods]=await Promise.all([getDailyReport(company.id,date),getInventory(company.id),getProducts(company.id)]);
      setReport(rep);setInventory(inv);setProducts(prods);
    } catch(e:any){setError((e as Error).message);}
    finally{setSavingKey(null);}
  };

  const saveExistingEntryItem = async (itemId: number) => {
    const d = tiEdits[itemId]; if(!d||!entryItemValid(d)) return;
    setSavingKey(`ti-${itemId}`); setError('');
    try {
      await updateTransactionItem(company.id, itemId, { product_id:d.product!.id, purchase_no_tax:parseFloat(d.purchase_no_tax), purchase_tax_amount:parseFloat(d.purchase_tax_amount)||0, total_resale:parseFloat(d.total_resale) });
      setTiEdits(p=>({...p,[itemId]:null}));
      const [rep,inv]=await Promise.all([getDailyReport(company.id,date),getInventory(company.id)]);
      setReport(rep);setInventory(inv);
    } catch(e:any){setError((e as Error).message);}
    finally{setSavingKey(null);}
  };

  const delEntryItem = async (itemId: number) => {
    setSavingKey(`ti-${itemId}`);
    try { await deleteTransactionItem(company.id, itemId); const [rep,inv]=await Promise.all([getDailyReport(company.id,date),getInventory(company.id)]); setReport(rep);setInventory(inv); }
    catch(e:any){setError((e as Error).message);}
    finally{setSavingKey(null);}
  };

  // ── Ex header CRUD ────────────────────────────────────────────────────────

  const submitNewEx = async () => {
    if(!draftEx?.buyer) return;
    setSaving(true); setError('');
    try {
      const ex = await createExit(company.id, date, { buyer_id:draftEx.buyer.id, document_number:draftEx.document||undefined });
      setDraftEx(null); setExOpen(p=>({...p,[ex.id]:true})); await refreshReport();
    } catch(e:any){setError((e as Error).message);}
    finally{setSaving(false);}
  };

  const saveExistingEx = async (id: number) => {
    const ed = exEdits[id]; if(!ed?.buyer) return;
    setSavingKey(`ex-${id}`); setError('');
    try {
      await updateExit(company.id, id, { buyer_id:ed.buyer.id, document_number:ed.document||undefined });
      setExEdits(p=>({...p,[id]:null})); await refreshReport();
    } catch(e:any){setError((e as Error).message);}
    finally{setSavingKey(null);}
  };

  const deleteEx = async (id: number) => {
    setSavingKey(`ex-${id}`);
    try { await fetch(`${BASE}/companies/${company.id}/exits/${id}`,{method:'DELETE'}); await refreshReport(); }
    catch(e:any){setError((e as Error).message);}
    finally{setSavingKey(null);}
  };

  // ── Exit item CRUD ────────────────────────────────────────────────────────

  const submitNewExitItem = async (exId: number) => {
    const d = draftExitItems[exId]; if(!d||!exitItemValid(d)) return;
    setSavingKey(`dei-${exId}`); setError('');
    try {
      await createExitItem(company.id, exId, { product_id:d.product!.id, total_sale:parseFloat(d.total_sale), vat_amount:parseFloat(d.vat_amount)||0 });
      setDraftExitItems(p=>({...p,[exId]:null}));
      const [rep,inv]=await Promise.all([getDailyReport(company.id,date),getInventory(company.id)]);
      setReport(rep);setInventory(inv);
    } catch(e:any){setError((e as Error).message);}
    finally{setSavingKey(null);}
  };

  const saveExistingExitItem = async (itemId: number) => {
    const d = eiEdits[itemId]; if(!d||!exitItemValid(d)) return;
    setSavingKey(`ei-${itemId}`); setError('');
    try {
      await updateExitItem(company.id, itemId, { product_id:d.product!.id, total_sale:parseFloat(d.total_sale), vat_amount:parseFloat(d.vat_amount)||0 });
      setEiEdits(p=>({...p,[itemId]:null}));
      const [rep,inv]=await Promise.all([getDailyReport(company.id,date),getInventory(company.id)]);
      setReport(rep);setInventory(inv);
    } catch(e:any){setError((e as Error).message);}
    finally{setSavingKey(null);}
  };

  const delExitItem = async (itemId: number) => {
    setSavingKey(`ei-${itemId}`);
    try { await deleteExitItem(company.id, itemId); const [rep,inv]=await Promise.all([getDailyReport(company.id,date),getInventory(company.id)]); setReport(rep);setInventory(inv); }
    catch(e:any){setError((e as Error).message);}
    finally{setSavingKey(null);}
  };

  // ── Section totals ────────────────────────────────────────────────────────

  const p = report;
  const entryTotalPnt = p?parseFloat(p.total_purchase_no_tax):0;
  const entryTotalPvat= p?parseFloat(p.total_purchase_vat):0;
  const entryTotalTp  = p?parseFloat(p.total_purchase):0;
  const entryTotalTr  = p?parseFloat(p.total_resale):0;
  const entryTotalRv  = p?parseFloat(p.total_resale_vat):0;
  const entryTotalRnt = p?parseFloat(p.total_resale_no_tax):0;
  const exitTotalTs   = p?parseFloat(p.total_exit):0;
  const exitTotalVat  = p?parseFloat(p.total_exit_vat):0;
  const exitTotalNv   = p?parseFloat(p.total_exit_no_vat):0;

  // ── Render helpers ─────────────────────────────────────────────────────────

  const itemColStyle = { fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' as const };

  // Entry item header row
  const entryItemHeaders = (
    <tr className={styles.itemHeaderRow}>
      <td className={`${styles.td} ${styles.itemIndent} ${styles.muted}`} style={itemColStyle}>Produs</td>
      <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={itemColStyle}>Fără TVA</td>
      <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={itemColStyle}>TVA</td>
      <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={itemColStyle}>Total cump.</td>
      <td className={`${styles.td} ${styles.right} ${styles.muted} ${styles.resaleCol}`} style={itemColStyle}>Total vânz.</td>
      <td className={`${styles.td} ${styles.right} ${styles.muted} ${styles.resaleCol}`} style={itemColStyle}>TVA vânz.</td>
      <td className={`${styles.td} ${styles.right} ${styles.muted} ${styles.resaleCol}`} style={itemColStyle}>Fără TVA</td>
      <td className={`${styles.td} ${styles.center} ${styles.muted}`} style={itemColStyle}>Cotă</td>
      <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={itemColStyle}>Adaos</td>
      <td className={styles.td} />
    </tr>
  );

  const renderSavedEntryItem = (item: TransactionItemSchema) => {
    const prod = products.find(pr=>pr.id===item.product_id);
    const pn=parseFloat(item.purchase_no_tax), tn=parseFloat(item.purchase_tax_amount);
    const vat = pn>0?`${Math.round((tn/pn)*100)}%`:'—';
    const editing = tiEdits[item.id];
    const busy = savingKey===`ti-${item.id}`;

    if (canEdit && editing) {
      const pre = {...editing,...computeEntryItem(editing)};
      const valid = entryItemValid(editing);
      return (
        <tr key={item.id} className={`${styles.itemRow} ${styles.itemEditRow}`}>
          <td className={`${styles.td} ${styles.itemIndent}`}>
            <ProductSearch companyId={company.id} products={products}
              onSelect={pr=>setTiEdits(p=>({...p,[item.id]:{...p[item.id]!,product:pr}}))}
              onProductCreated={pr=>{setProducts(prev=>[...prev,pr]);setTiEdits(p=>({...p,[item.id]:{...p[item.id]!,product:pr}}));}}/>
            {editing.product&&<div className={styles.selectedSeller}><span>{editing.product.name}</span><button className={styles.clearSeller} onClick={()=>setTiEdits(p=>({...p,[item.id]:{...p[item.id]!,product:null}}))}>×</button></div>}
          </td>
          <td className={styles.td}><input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01" value={editing.purchase_no_tax} onChange={e=>setTiEdits(p=>({...p,[item.id]:{...p[item.id]!,purchase_no_tax:e.target.value}}))} placeholder="0.00"/></td>
          <td className={styles.td}><input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01" value={editing.purchase_tax_amount} onChange={e=>setTiEdits(p=>({...p,[item.id]:{...p[item.id]!,purchase_tax_amount:e.target.value}}))} placeholder="0.00"/></td>
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>{pre.c_tp?fmt(pre.c_tp):'—'}</td>
          <td className={`${styles.td} ${styles.resaleCol}`}><input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01" value={editing.total_resale} onChange={e=>setTiEdits(p=>({...p,[item.id]:{...p[item.id]!,total_resale:e.target.value}}))} placeholder="0.00" onKeyDown={e=>{if(e.key==='Enter'&&valid)saveExistingEntryItem(item.id);}}/></td>
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed} ${styles.resaleCol}`}>{pre.c_rv?fmt(pre.c_rv):'—'}</td>
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed} ${styles.resaleCol}`}>{pre.c_rnt?fmt(pre.c_rnt):'—'}</td>
          <td className={`${styles.td} ${styles.center}`}><span className={styles.vatBadge}>{pre.c_vat_pct}</span></td>
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>{pre.c_mu?fmt(pre.c_mu):'—'}</td>
          <td className={`${styles.td} ${styles.center}`}>
            <div className={styles.rowActions}>
              <button className={styles.acceptBtn} onClick={()=>saveExistingEntryItem(item.id)} disabled={!valid||busy} title="Salvează (Enter)">✓</button>
              <button className={styles.deleteRowBtn} onClick={()=>setTiEdits(p=>({...p,[item.id]:null}))} title="Anulează">✕</button>
            </div>
          </td>
        </tr>
      );
    }

    return (
      <tr key={item.id} className={styles.itemRow}>
        <td className={`${styles.td} ${styles.itemIndent}`}><span className={styles.productName}>{prod?.name??'—'}</span></td>
        <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(item.purchase_no_tax)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(item.purchase_tax_amount)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(item.total_purchase)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.resaleCol}`}>{fmt(item.total_resale)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(item.resale_vat)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(item.resale_no_tax)}</td>
        <td className={`${styles.td} ${styles.center}`}><span className={styles.vatBadge}>{vat}</span></td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.markupCell}`}>{fmt(item.markup)}</td>
        <td className={`${styles.td} ${styles.center}`}>
          {canEdit && (
            <div className={styles.rowActions}>
              <button className={styles.editItemBtn} onClick={()=>setTiEdits(p=>({...p,[item.id]:tiToEdit(item,products)}))} title="Editează">✎</button>
              <button className={styles.deleteRowBtn} onClick={()=>delEntryItem(item.id)} title="Șterge">✕</button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  const renderDraftEntryItem = (txId: number) => {
    const d = draftEntryItems[txId]; if(!d) return null;
    const pre={...d,...computeEntryItem(d)}; const valid=entryItemValid(d);
    const busy=savingKey===`dti-${txId}`;
    return (
      <tr key="draft" className={`${styles.itemRow} ${styles.draftItemRow}`}>
        <td className={`${styles.td} ${styles.itemIndent}`}>
          <ProductSearch companyId={company.id} products={products} onSelect={pr=>setDraftEntryItems(p=>({...p,[txId]:{...p[txId]!,product:pr}}))} onProductCreated={pr=>{setProducts(prev=>[...prev,pr]);setDraftEntryItems(p=>({...p,[txId]:{...p[txId]!,product:pr}}));}} placeholder="Caută / adaugă produs..."/>
          {d.product&&<div className={styles.selectedSeller}><span>{d.product.name}</span><button className={styles.clearSeller} onClick={()=>setDraftEntryItems(p=>({...p,[txId]:{...p[txId]!,product:null}}))}>×</button></div>}
        </td>
        <td className={styles.td}><input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01" value={d.purchase_no_tax} placeholder="0.00" onChange={e=>setDraftEntryItems(p=>({...p,[txId]:{...p[txId]!,purchase_no_tax:e.target.value}}))}/></td>
        <td className={styles.td}><input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01" value={d.purchase_tax_amount} placeholder="0.00" onChange={e=>setDraftEntryItems(p=>({...p,[txId]:{...p[txId]!,purchase_tax_amount:e.target.value}}))}/></td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>{pre.c_tp?fmt(pre.c_tp):'—'}</td>
        <td className={`${styles.td} ${styles.resaleCol}`}><input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01" value={d.total_resale} placeholder="0.00" onChange={e=>setDraftEntryItems(p=>({...p,[txId]:{...p[txId]!,total_resale:e.target.value}}))} onKeyDown={e=>{if(e.key==='Enter'&&valid)submitNewEntryItem(txId);}}/></td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed} ${styles.resaleCol}`}>{pre.c_rv?fmt(pre.c_rv):'—'}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed} ${styles.resaleCol}`}>{pre.c_rnt?fmt(pre.c_rnt):'—'}</td>
        <td className={`${styles.td} ${styles.center}`}><span className={styles.vatBadge}>{pre.c_vat_pct}</span></td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>{pre.c_mu?fmt(pre.c_mu):'—'}</td>
        <td className={`${styles.td} ${styles.center}`}>
          <div className={styles.rowActions}>
            <button className={styles.acceptBtn} onClick={()=>submitNewEntryItem(txId)} disabled={!valid||busy} title="Confirmă (Enter)">✓</button>
            <button className={styles.deleteRowBtn} onClick={()=>setDraftEntryItems(p=>({...p,[txId]:null}))} title="Anulează">✕</button>
          </div>
        </td>
      </tr>
    );
  };

  const exitItemHeaders = (
    <tr className={styles.itemHeaderRow}>
      <td className={`${styles.td} ${styles.itemIndent} ${styles.muted}`} style={itemColStyle}>Produs</td>
      <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={itemColStyle}>Total cu TVA</td>
      <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={itemColStyle}>TVA</td>
      <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={itemColStyle}>Fără TVA</td>
      <td className={styles.td} />
    </tr>
  );

  const renderSavedExitItem = (item: ExitItemSchema) => {
    const prod = products.find(pr=>pr.id===item.product_id);
    const editing = eiEdits[item.id];
    const busy = savingKey===`ei-${item.id}`;
    const inventoryProductIds = new Set(inventory.filter(i=>parseFloat(i.stock_total)>0).map(i=>i.product_id));
    const invProds = products.filter(p=>inventoryProductIds.has(p.id));

    if (canEdit && editing) {
      const pre={...editing,...computeExitItem(editing)}; const valid=exitItemValid(editing);
      return (
        <tr key={item.id} className={`${styles.itemRow} ${styles.itemEditRow}`}>
          <td className={`${styles.td} ${styles.itemIndent}`}>
            <ProductSearch companyId={company.id} products={invProds} onSelect={pr=>setEiEdits(p=>({...p,[item.id]:{...p[item.id]!,product:pr}}))} onProductCreated={()=>setError('Nu poți adăuga produse noi din ieșiri.')} placeholder="Caută în inventar..."/>
            {editing.product&&<div className={styles.selectedSeller}><span>{editing.product.name}</span><button className={styles.clearSeller} onClick={()=>setEiEdits(p=>({...p,[item.id]:{...p[item.id]!,product:null}}))}>×</button></div>}
          </td>
          <td className={styles.td}><input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01" value={editing.total_sale} placeholder="0.00" onChange={e=>setEiEdits(p=>({...p,[item.id]:{...p[item.id]!,total_sale:e.target.value}}))} onKeyDown={e=>{if(e.key==='Enter'&&valid)saveExistingExitItem(item.id);}}/></td>
          <td className={styles.td}><input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01" value={editing.vat_amount} placeholder="0.00" onChange={e=>setEiEdits(p=>({...p,[item.id]:{...p[item.id]!,vat_amount:e.target.value}}))}/></td>
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>{pre.c_no_vat?fmt(pre.c_no_vat):'—'}</td>
          <td className={`${styles.td} ${styles.center}`}>
            <div className={styles.rowActions}>
              <button className={styles.acceptBtn} onClick={()=>saveExistingExitItem(item.id)} disabled={!valid||busy} title="Salvează (Enter)">✓</button>
              <button className={styles.deleteRowBtn} onClick={()=>setEiEdits(p=>({...p,[item.id]:null}))} title="Anulează">✕</button>
            </div>
          </td>
        </tr>
      );
    }

    return (
      <tr key={item.id} className={styles.itemRow}>
        <td className={`${styles.td} ${styles.itemIndent}`}><span className={styles.productName}>{prod?.name??'—'}</span></td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(item.total_sale)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(item.vat_amount)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(item.total_sale_no_vat)}</td>
        <td className={`${styles.td} ${styles.center}`}>
          {canEdit && (
            <div className={styles.rowActions}>
              <button className={styles.editItemBtn} onClick={()=>setEiEdits(p=>({...p,[item.id]:eiToEdit(item,products)}))} title="Editează">✎</button>
              <button className={styles.deleteRowBtn} onClick={()=>delExitItem(item.id)} title="Șterge">✕</button>
            </div>
          )}
        </td>
      </tr>
    );
  };

  const renderDraftExitItem = (exId: number) => {
    const d = draftExitItems[exId]; if(!d) return null;
    const pre={...d,...computeExitItem(d)}; const valid=exitItemValid(d);
    const busy=savingKey===`dei-${exId}`;
    const inventoryProductIds = new Set(inventory.filter(i=>parseFloat(i.stock_total)>0).map(i=>i.product_id));
    const invProds = products.filter(p=>inventoryProductIds.has(p.id));
    return (
      <tr key="draft" className={`${styles.itemRow} ${styles.draftItemRow}`}>
        <td className={`${styles.td} ${styles.itemIndent}`}>
          <ProductSearch companyId={company.id} products={invProds} onSelect={pr=>setDraftExitItems(p=>({...p,[exId]:{...p[exId]!,product:pr}}))} onProductCreated={()=>setError('Nu poți adăuga produse noi din ieșiri.')} placeholder="Caută în inventar..."/>
          {d.product&&<div className={styles.selectedSeller}><span>{d.product.name}</span><button className={styles.clearSeller} onClick={()=>setDraftExitItems(p=>({...p,[exId]:{...p[exId]!,product:null}}))}>×</button></div>}
        </td>
        <td className={styles.td}><input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01" value={d.total_sale} placeholder="0.00" onChange={e=>setDraftExitItems(p=>({...p,[exId]:{...p[exId]!,total_sale:e.target.value}}))} onKeyDown={e=>{if(e.key==='Enter'&&valid)submitNewExitItem(exId);}}/></td>
        <td className={styles.td}><input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01" value={d.vat_amount} placeholder="0.00" onChange={e=>setDraftExitItems(p=>({...p,[exId]:{...p[exId]!,vat_amount:e.target.value}}))}/></td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>{pre.c_no_vat?fmt(pre.c_no_vat):'—'}</td>
        <td className={`${styles.td} ${styles.center}`}>
          <div className={styles.rowActions}>
            <button className={styles.acceptBtn} onClick={()=>submitNewExitItem(exId)} disabled={!valid||busy} title="Confirmă (Enter)">✓</button>
            <button className={styles.deleteRowBtn} onClick={()=>setDraftExitItems(p=>({...p,[exId]:null}))} title="Anulează">✕</button>
          </div>
        </td>
      </tr>
    );
  };

  const renderTxRow = (tx: Transaction) => {
    const cp = counterparties.find(c=>c.id===tx.seller_id);
    const open = txOpen[tx.id]??false;
    const hasDraft = !!draftEntryItems[tx.id];
    const editing = txEdits[tx.id];
    const busy = savingKey===`tx-${tx.id}`;

    const headerCells = canEdit && editing ? (
      <>
        <td className={styles.td}>
          <SellerSearch sellers={counterparties} onSelect={s=>setTxEdits(p=>({...p,[tx.id]:{...p[tx.id]!,seller:s}}))} onSellerCreated={s=>{setCounterparties(prev=>[...prev,s]);setTxEdits(p=>({...p,[tx.id]:{...p[tx.id]!,seller:s}}));}}/>
          {editing.seller&&<div className={styles.selectedSeller}><span>{editing.seller.name}</span><button className={styles.clearSeller} onClick={()=>setTxEdits(p=>({...p,[tx.id]:{...p[tx.id]!,seller:null}}))}>×</button></div>}
        </td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{editing.seller?.tax_id??''}</td>
        <td className={styles.td}><input className={styles.cellInput} value={editing.invoice} onChange={e=>setTxEdits(p=>({...p,[tx.id]:{...p[tx.id]!,invoice:e.target.value}}))} placeholder="—"/></td>
        <td className={styles.td}><input className={styles.cellInput} value={editing.register} onChange={e=>setTxEdits(p=>({...p,[tx.id]:{...p[tx.id]!,register:e.target.value}}))} placeholder="—"/></td>
        <td colSpan={8} className={styles.td}/>
        <td className={`${styles.td} ${styles.center}`}>
          <div className={styles.rowActions}>
            <button className={styles.acceptBtn} onClick={()=>saveExistingTx(tx.id)} disabled={!editing.seller||busy} title="Salvează">✓</button>
            <button className={styles.deleteRowBtn} onClick={()=>setTxEdits(p=>({...p,[tx.id]:null}))} title="Anulează">✕</button>
          </div>
        </td>
      </>
    ) : (
      <>
        <td className={styles.td}>
          <button className={styles.cpToggle} onClick={()=>setTxOpen(p=>({...p,[tx.id]:!open}))}>
            <span className={styles.cpCaret}>{open?'▾':'▸'}</span>
            <span className={styles.cpName}>{cp?.name??'—'}</span>
          </button>
        </td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{cp?.tax_id??'—'}</td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{tx.invoice_number??'—'}</td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{tx.register_entry_number??'—'}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(tx.purchase_no_tax)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(tx.purchase_tax_amount)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(tx.total_purchase)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold} ${styles.resaleCol}`}>{fmt(tx.total_resale)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(tx.resale_vat)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(tx.resale_no_tax)}</td>
        <td className={styles.td}/>
        <td className={`${styles.td} ${styles.center}`}>
          {canEdit&&(
            <div className={styles.rowActions}>
              <button className={styles.editItemBtn} onClick={()=>setTxEdits(p=>({...p,[tx.id]:txToEdit(tx,counterparties)}))} title="Editează">✎</button>
              <button className={styles.deleteRowBtn} onClick={()=>deleteTx(tx.id)} title="Șterge">✕</button>
            </div>
          )}
        </td>
      </>
    );

    return (
      <>
        <tr key={`tx-${tx.id}`} className={`${styles.cpRow} ${open?styles.cpRowOpen:''} ${canEdit&&editing?styles.draftCpRow:''}`}>
          {headerCells}
        </tr>
        {open&&!editing&&(
          <>
            {entryItemHeaders}
            {tx.items.map(item=>renderSavedEntryItem(item))}
            {canEdit&&renderDraftEntryItem(tx.id)}
            {canEdit&&!hasDraft&&(
              <tr className={styles.addItemRow}><td colSpan={10} className={styles.td}>
                <button className={styles.addItemBtn} onClick={()=>setDraftEntryItems(p=>({...p,[tx.id]:emptyEditEntryItem()}))}>+ Adaugă produs</button>
              </td></tr>
            )}
          </>
        )}
      </>
    );
  };

  const renderExRow = (ex: ExitRecord) => {
    const cp = counterparties.find(c=>c.id===ex.buyer_id);
    const open = exOpen[ex.id]??false;
    const hasDraft = !!draftExitItems[ex.id];
    const editing = exEdits[ex.id];
    const busy = savingKey===`ex-${ex.id}`;

    const headerCells = canEdit && editing ? (
      <>
        <td className={styles.td}>
          <SellerSearch sellers={counterparties} onSelect={s=>setExEdits(p=>({...p,[ex.id]:{...p[ex.id]!,buyer:s}}))} onSellerCreated={s=>{setCounterparties(prev=>[...prev,s]);setExEdits(p=>({...p,[ex.id]:{...p[ex.id]!,buyer:s}}));}}/>
          {editing.buyer&&<div className={styles.selectedSeller}><span>{editing.buyer.name}</span><button className={styles.clearSeller} onClick={()=>setExEdits(p=>({...p,[ex.id]:{...p[ex.id]!,buyer:null}}))}>×</button></div>}
        </td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{editing.buyer?.tax_id??''}</td>
        <td className={styles.td}><input className={styles.cellInput} value={editing.document} onChange={e=>setExEdits(p=>({...p,[ex.id]:{...p[ex.id]!,document:e.target.value}}))} placeholder="—"/></td>
        <td colSpan={3} className={styles.td}/>
        <td className={`${styles.td} ${styles.center}`}>
          <div className={styles.rowActions}>
            <button className={styles.acceptBtn} onClick={()=>saveExistingEx(ex.id)} disabled={!editing.buyer||busy} title="Salvează">✓</button>
            <button className={styles.deleteRowBtn} onClick={()=>setExEdits(p=>({...p,[ex.id]:null}))} title="Anulează">✕</button>
          </div>
        </td>
      </>
    ) : (
      <>
        <td className={styles.td}>
          <button className={styles.cpToggle} onClick={()=>setExOpen(p=>({...p,[ex.id]:!open}))}>
            <span className={styles.cpCaret}>{open?'▾':'▸'}</span>
            <span className={styles.cpName}>{cp?.name??'—'}</span>
          </button>
        </td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{cp?.tax_id??'—'}</td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{ex.document_number??'—'}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(ex.total_sale)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(ex.vat_amount)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(ex.total_sale_no_vat)}</td>
        <td className={`${styles.td} ${styles.center}`}>
          {canEdit&&(
            <div className={styles.rowActions}>
              <button className={styles.editItemBtn} onClick={()=>setExEdits(p=>({...p,[ex.id]:exToEdit(ex,counterparties)}))} title="Editează">✎</button>
              <button className={styles.deleteRowBtn} onClick={()=>deleteEx(ex.id)} title="Șterge">✕</button>
            </div>
          )}
        </td>
      </>
    );

    return (
      <>
        <tr key={`ex-${ex.id}`} className={`${styles.cpRow} ${styles.cpRowExit} ${open?styles.cpRowOpen:''} ${canEdit&&editing?styles.draftCpRow:''}`}>
          {headerCells}
        </tr>
        {open&&!editing&&(
          <>
            {exitItemHeaders}
            {ex.items.map(item=>renderSavedExitItem(item))}
            {canEdit&&renderDraftExitItem(ex.id)}
            {canEdit&&!hasDraft&&(
              <tr className={styles.addItemRow}><td colSpan={5} className={styles.td}>
                <button className={styles.addItemBtn} onClick={()=>setDraftExitItems(p=>({...p,[ex.id]:emptyEditExitItem()}))}>+ Adaugă produs</button>
              </td></tr>
            )}
          </>
        )}
      </>
    );
  };

  // ── JSX ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={onBack}>← Calendar</button>
          <div className={styles.title}>
            <span className={styles.company}>{company.name}</span>
            <span className={styles.sep}>·</span>
            <span className={styles.date}>{formatDate(date)}</span>
            {ledgerLocked && <span className={styles.ledgerBadge}>Închis</span>}
          </div>
        </div>
        <div className={styles.headerRight}>
          {p&&(
            <div className={styles.stockBadge}>
              <span className={styles.stockLabel}>Stoc final</span>
              <span className={styles.stockValue}>{fmt(p.stock_end_of_day.total)} lei</span>
            </div>
          )}
          {/* Export buttons */}
          {p&&(
            <div className={styles.exportGroup}>
              <button className={styles.exportBtn} onClick={()=>exportDay(p,company,date,'pdf')} title="Exportă PDF">↓ PDF</button>
              <button className={styles.exportBtn} onClick={()=>exportDay(p,company,date,'excel')} title="Exportă Excel">↓ Excel</button>
            </div>
          )}
          {!ledgerLocked && (
            editUnlocked
              ? <button className={styles.saveBtn} onClick={handleLock} disabled={saving}>{saving?'...':'✓ Salvează tot'}</button>
              : <button className={styles.editBtn} onClick={()=>setEditUnlocked(true)}>✎ Editează</button>
          )}
        </div>
      </header>

      {ledgerLocked && (
        <div className={styles.lockedBar} style={{background:'#f5f0ff'}}>
          <span className={styles.lockedDot} style={{background:'#7c5cbf'}}/>
          Registrul este închis pentru această zi. Datele sunt doar pentru vizualizare.
        </div>
      )}
      {!ledgerLocked && !editUnlocked && p && (p.transactions.length>0||p.exits.length>0) && (
        <div className={styles.lockedBar}>
          <span className={styles.lockedDot}/>
          Ziua este salvată. Apasă „Editează" pentru modificări.
        </div>
      )}
      {error&&<div className={styles.errorBar} onClick={()=>setError('')}>{error} <span style={{float:'right',cursor:'pointer'}}>×</span></div>}

      <div className={styles.sectionsWrap}>
        {/* ── ENTRIES ── */}
        <div className={styles.section}>
          <button className={styles.sectionToggle} onClick={()=>setEntriesOpen(o=>!o)}>
            <span className={styles.sectionToggleLeft}>
              <span className={styles.sectionCaret}>{entriesOpen?'▾':'▸'}</span>
              <span className={styles.sectionTitle}>Intrări</span>
            </span>
            <span className={styles.sectionSummary}>
              <span className={styles.sumChip}>Cump. fără TVA <strong>{fmt(entryTotalPnt)}</strong></span>
              <span className={styles.sumChip}>TVA <strong>{fmt(entryTotalPvat)}</strong></span>
              <span className={styles.sumChip}>Total cump. <strong>{fmt(entryTotalTp)}</strong></span>
              <span className={styles.sumDivider}/>
              <span className={styles.sumChip}>La preț achiz. <strong>{fmt(entryTotalTr)}</strong></span>
              <span className={styles.sumChip}>TVA vânz. <strong>{fmt(entryTotalRv)}</strong></span>
              <span className={styles.sumChip}>Fără TVA <strong>{fmt(entryTotalRnt)}</strong></span>
            </span>
          </button>
          {entriesOpen&&(
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={`${styles.th} ${styles.thPurchase}`}>Furnizor</th>
                    <th className={`${styles.th} ${styles.thPurchase}`}>CUI</th>
                    <th className={`${styles.th} ${styles.thPurchase}`}>Nr. factură</th>
                    <th className={`${styles.th} ${styles.thPurchase}`}>Nr. intrare</th>
                    <th className={`${styles.th} ${styles.thPurchase} ${styles.right}`}>Fără TVA</th>
                    <th className={`${styles.th} ${styles.thPurchase} ${styles.right}`}>TVA</th>
                    <th className={`${styles.th} ${styles.thPurchase} ${styles.right}`}>Total cump.</th>
                    <th className={`${styles.th} ${styles.thResale} ${styles.right}`}>Total cu TVA</th>
                    <th className={`${styles.th} ${styles.thResale} ${styles.right}`}>TVA</th>
                    <th className={`${styles.th} ${styles.thResale} ${styles.right}`}>Fără TVA</th>
                    <th className={`${styles.th} ${styles.thResale} ${styles.center}`}>Cotă</th>
                    <th className={`${styles.th} ${styles.thResale} ${styles.right}`}>Adaos</th>
                    <th className={`${styles.th} ${styles.thActions}`}/>
                  </tr>
                  <tr className={styles.subHeaderRow}>
                    <th colSpan={4}/><th colSpan={3} className={`${styles.subHeader} ${styles.subHeaderPurchase}`}>CUMPĂRARE</th>
                    <th colSpan={5} className={`${styles.subHeader} ${styles.subHeaderResale}`}>LA PREȚUL DE ACHIZIȚIE</th>
                    <th/>
                  </tr>
                </thead>
                <tbody>
                  {(p?.transactions??[]).length===0&&!draftTx&&(
                    <tr className={styles.emptyRow}><td colSpan={13}>{canEdit?'Nicio intrare. Adaugă un rând.':'Nicio intrare.'}</td></tr>
                  )}
                  {(p?.transactions??[]).map(tx=>renderTxRow(tx))}
                  {canEdit&&draftTx&&(
                    <tr className={`${styles.cpRow} ${styles.draftCpRow}`}>
                      <td className={styles.td}>
                        <SellerSearch sellers={counterparties} onSelect={s=>setDraftTx(d=>d?{...d,seller:s}:d)} onSellerCreated={s=>{setCounterparties(p=>[...p,s]);setDraftTx(d=>d?{...d,seller:s}:d);}}/>
                        {draftTx.seller&&<div className={styles.selectedSeller}><span>{draftTx.seller.name}</span><button className={styles.clearSeller} onClick={()=>setDraftTx(d=>d?{...d,seller:null}:d)}>×</button></div>}
                      </td>
                      <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{draftTx.seller?.tax_id??''}</td>
                      <td className={styles.td}><input className={styles.cellInput} value={draftTx.invoice} onChange={e=>setDraftTx(d=>d?{...d,invoice:e.target.value}:d)} placeholder="—"/></td>
                      <td className={styles.td}><input className={styles.cellInput} value={draftTx.register} onChange={e=>setDraftTx(d=>d?{...d,register:e.target.value}:d)} placeholder="—"/></td>
                      <td colSpan={8} className={styles.td}/>
                      <td className={`${styles.td} ${styles.center}`}>
                        <div className={styles.rowActions}>
                          <button className={styles.acceptBtn} onClick={submitNewTx} disabled={!draftTx.seller||saving} title="Confirmă">✓</button>
                          <button className={styles.deleteRowBtn} onClick={()=>setDraftTx(null)} title="Anulează">✕</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className={styles.totalsRow}>
                    <td colSpan={4} className={styles.td}>
                      {canEdit&&!draftTx&&(<button className={styles.addRowBtn} onClick={()=>setDraftTx(emptyEditTx())}>+ Adaugă furnizor</button>)}
                    </td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal}`}>{fmt(entryTotalPnt)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted}`}>{fmt(entryTotalPvat)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.bold}`}>{fmt(entryTotalTp)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.bold} ${styles.resaleCol}`}>{fmt(entryTotalTr)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted} ${styles.resaleCol}`}>{fmt(entryTotalRv)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted} ${styles.resaleCol}`}>{fmt(entryTotalRnt)}</td>
                    <td className={styles.td}/><td className={styles.td}/><td className={styles.td}/>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* ── EXITS ── */}
        <div className={styles.section}>
          <button className={styles.sectionToggle} onClick={()=>setExitsOpen(o=>!o)}>
            <span className={styles.sectionToggleLeft}>
              <span className={styles.sectionCaret}>{exitsOpen?'▾':'▸'}</span>
              <span className={styles.sectionTitle}>Ieșiri</span>
            </span>
            <span className={styles.sectionSummary}>
              <span className={styles.sumChip}>Fără TVA <strong>{fmt(exitTotalNv)}</strong></span>
              <span className={styles.sumChip}>TVA <strong>{fmt(exitTotalVat)}</strong></span>
              <span className={styles.sumChip}>Total <strong>{fmt(exitTotalTs)}</strong></span>
            </span>
          </button>
          {exitsOpen&&(
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>Beneficiar</th>
                    <th className={styles.th}>CUI</th>
                    <th className={styles.th}>Nr. document</th>
                    <th className={`${styles.th} ${styles.right}`}>Total cu TVA</th>
                    <th className={`${styles.th} ${styles.right}`}>TVA</th>
                    <th className={`${styles.th} ${styles.right}`}>Fără TVA</th>
                    <th className={`${styles.th} ${styles.thActions}`}/>
                  </tr>
                </thead>
                <tbody>
                  {(p?.exits??[]).length===0&&!draftEx&&(
                    <tr className={styles.emptyRow}><td colSpan={7}>{canEdit?'Nicio ieșire. Adaugă un rând.':'Nicio ieșire.'}</td></tr>
                  )}
                  {(p?.exits??[]).map(ex=>renderExRow(ex))}
                  {canEdit&&draftEx&&(
                    <tr className={`${styles.cpRow} ${styles.cpRowExit} ${styles.draftCpRow}`}>
                      <td className={styles.td}>
                        <SellerSearch sellers={counterparties} onSelect={s=>setDraftEx(d=>d?{...d,buyer:s}:d)} onSellerCreated={s=>{setCounterparties(p=>[...p,s]);setDraftEx(d=>d?{...d,buyer:s}:d);}}/>
                        {draftEx.buyer&&<div className={styles.selectedSeller}><span>{draftEx.buyer.name}</span><button className={styles.clearSeller} onClick={()=>setDraftEx(d=>d?{...d,buyer:null}:d)}>×</button></div>}
                      </td>
                      <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{draftEx.buyer?.tax_id??''}</td>
                      <td className={styles.td}><input className={styles.cellInput} value={draftEx.document} onChange={e=>setDraftEx(d=>d?{...d,document:e.target.value}:d)} placeholder="—"/></td>
                      <td colSpan={3} className={styles.td}/>
                      <td className={`${styles.td} ${styles.center}`}>
                        <div className={styles.rowActions}>
                          <button className={styles.acceptBtn} onClick={submitNewEx} disabled={!draftEx.buyer||saving} title="Confirmă">✓</button>
                          <button className={styles.deleteRowBtn} onClick={()=>setDraftEx(null)} title="Anulează">✕</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className={styles.totalsRow}>
                    <td colSpan={3} className={styles.td}>
                      {canEdit&&!draftEx&&(<button className={styles.addRowBtn} onClick={()=>setDraftEx(emptyEditEx())}>+ Adaugă beneficiar</button>)}
                    </td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.bold}`}>{fmt(exitTotalTs)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted}`}>{fmt(exitTotalVat)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal}`}>{fmt(exitTotalNv)}</td>
                    <td className={styles.td}/>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── BOTTOM TOTALS ── */}
      {p&&(
        <div className={styles.bottomTotals}>
          <div className={styles.totalsBlock}>
            <div className={styles.totalsBlockLabel}>Ziua anterioară</div>
            <div className={styles.totalsGrid}>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Intrări fără TVA</span><span className={styles.totalsCellVal}>{fmt(p.prev_totals.resale_no_tax)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>TVA intrări</span><span className={styles.totalsCellVal}>{fmt(p.prev_totals.resale_vat)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Total intrări</span><span className={`${styles.totalsCellVal} ${styles.bold}`}>{fmt(p.prev_totals.total_resale)}</span></div>
              <div className={styles.totalsDivider}/>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Ieșiri fără TVA</span><span className={styles.totalsCellVal}>{fmt(p.prev_totals.exit_no_vat)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>TVA ieșiri</span><span className={styles.totalsCellVal}>{fmt(p.prev_totals.exit_vat)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Total ieșiri</span><span className={`${styles.totalsCellVal} ${styles.bold}`}>{fmt(p.prev_totals.total_exit)}</span></div>
            </div>
          </div>
          <div className={`${styles.totalsBlock} ${styles.totalsBlockToday}`}>
            <div className={styles.totalsBlockLabel}>Ziua curentă</div>
            <div className={styles.totalsGrid}>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Intrări fără TVA</span><span className={styles.totalsCellVal}>{fmt(p.total_resale_no_tax)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>TVA intrări</span><span className={styles.totalsCellVal}>{fmt(p.total_resale_vat)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Total intrări</span><span className={`${styles.totalsCellVal} ${styles.bold}`}>{fmt(p.total_resale)}</span></div>
              <div className={styles.totalsDivider}/>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Ieșiri fără TVA</span><span className={styles.totalsCellVal}>{fmt(p.total_exit_no_vat)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>TVA ieșiri</span><span className={styles.totalsCellVal}>{fmt(p.total_exit_vat)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Total ieșiri</span><span className={`${styles.totalsCellVal} ${styles.bold}`}>{fmt(p.total_exit)}</span></div>
              <div className={styles.totalsDivider}/>
              <div className={styles.totalsCell}>
                <span className={styles.totalsCellLabel}>Stoc anterior</span>
                <div className={styles.stockSplit}>
                  <span className={styles.stockSplitVal}>{fmt(p.previous_stock.no_vat)}</span>
                  <span className={styles.stockSplitSep}>+</span>
                  <span className={styles.stockSplitVal}>{fmt(p.previous_stock.vat)} TVA</span>
                  <span className={styles.stockSplitSep}>=</span>
                  <span className={`${styles.stockSplitVal} ${styles.bold}`}>{fmt(p.previous_stock.total)}</span>
                </div>
              </div>
              <div className={styles.totalsCell}>
                <span className={styles.totalsCellLabel}>Stoc final</span>
                <div className={styles.stockSplit}>
                  <span className={styles.stockSplitVal}>{fmt(p.stock_end_of_day.no_vat)}</span>
                  <span className={styles.stockSplitSep}>+</span>
                  <span className={styles.stockSplitVal}>{fmt(p.stock_end_of_day.vat)} TVA</span>
                  <span className={styles.stockSplitSep}>=</span>
                  <span className={`${styles.stockSplitVal} ${styles.accentVal}`}>{fmt(p.stock_end_of_day.total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showToast&&<div className={styles.toast}>✓ Ziua a fost salvată</div>}
    </div>
  );
}
