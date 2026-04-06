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
  createTransaction, createTransactionItem, deleteTransactionItem,
  createExit, createExitItem, deleteExitItem,
  BASE,
} from '../api';
import SellerSearch from '../components/SellerSearch';
import ProductSearch from '../components/ProductSearch';
import styles from './DayView.module.css';

interface Props { company: Company; date: string; onBack: () => void; }

const fmt = (v: string | number) =>
  Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`;
}

// ── Draft shapes ───────────────────────────────────────────────────────────

interface DraftTx { seller: Counterparty | null; invoice: string; register: string; }
interface DraftEx { buyer: Counterparty | null; document: string; }

interface DraftEntryItem {
  product: Product | null;
  purchase_no_tax: string; purchase_tax_amount: string; total_resale: string;
  // computed preview
  c_tp: number; c_rnt: number; c_rv: number; c_mu: number; c_vat_pct: string;
}
interface DraftExitItem {
  product: Product | null;
  total_sale: string; vat_amount: string;
  c_no_vat: number;
}

const emptyDraftTx = (): DraftTx => ({ seller: null, invoice: '', register: '' });
const emptyDraftEx = (): DraftEx => ({ buyer: null, document: '' });
const emptyEntryItem = (): DraftEntryItem => ({
  product: null, purchase_no_tax: '', purchase_tax_amount: '', total_resale: '',
  c_tp: 0, c_rnt: 0, c_rv: 0, c_mu: 0, c_vat_pct: '—',
});
const emptyExitItem = (): DraftExitItem => ({
  product: null, total_sale: '', vat_amount: '', c_no_vat: 0,
});

function computeEntryItem(d: DraftEntryItem): Partial<DraftEntryItem> {
  const pn = parseFloat(d.purchase_no_tax) || 0;
  const tn = parseFloat(d.purchase_tax_amount) || 0;
  const rs = parseFloat(d.total_resale) || 0;
  const tf = pn > 0 ? 1 + tn / pn : 1;
  const rnt = pn > 0 ? rs / tf : 0;
  return {
    c_tp: pn + tn, c_rnt: rnt, c_rv: rs - rnt,
    c_mu: pn > 0 ? rnt - pn : 0,
    c_vat_pct: pn > 0 ? `${Math.round((tn / pn) * 100)}%` : '—',
  };
}
function computeExitItem(d: DraftExitItem): Partial<DraftExitItem> {
  return { c_no_vat: (parseFloat(d.total_sale) || 0) - (parseFloat(d.vat_amount) || 0) };
}

const entryItemValid = (d: DraftEntryItem) =>
  d.product !== null && parseFloat(d.purchase_no_tax) > 0 && parseFloat(d.total_resale) > 0;
const exitItemValid = (d: DraftExitItem) =>
  d.product !== null && parseFloat(d.total_sale) > 0;

// ── Component ──────────────────────────────────────────────────────────────

export default function DayView({ company, date, onBack }: Props) {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);

  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showToast, setShowToast] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Section open state
  const [entriesOpen, setEntriesOpen] = useState(true);
  const [exitsOpen, setExitsOpen]     = useState(true);

  // Per-transaction open state (id → bool)
  const [txOpen, setTxOpen] = useState<Record<number, boolean>>({});
  const [exOpen, setExOpen] = useState<Record<number, boolean>>({});

  // Draft new counterparty rows
  const [draftTx, setDraftTx] = useState<DraftTx | null>(null);
  const [draftEx, setDraftEx] = useState<DraftEx | null>(null);

  // Draft items per transaction/exit: txId → DraftEntryItem | null
  const [draftEntryItems, setDraftEntryItems] = useState<Record<number, DraftEntryItem | null>>({});
  const [draftExitItems,  setDraftExitItems]  = useState<Record<number, DraftExitItem | null>>({});

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = async () => {
    const [rep, cps, prods, inv] = await Promise.all([
      getDailyReport(company.id, date),
      getCounterparties(),
      getProducts(company.id),
      getInventory(company.id),
    ]);
    setReport(rep);
    setCounterparties(cps);
    setProducts(prods);
    setInventory(inv);
    if (rep.transactions.length > 0 || rep.exits.length > 0) setLocked(true);
  };

  useEffect(() => { load(); }, [company.id, date]);

  const refreshReport = async () => {
    const [rep, inv] = await Promise.all([
      getDailyReport(company.id, date),
      getInventory(company.id),
    ]);
    setReport(rep); setInventory(inv);
  };

  const lock   = () => { setLocked(true);  setDraftTx(null); setDraftEx(null); setDraftEntryItems({}); setDraftExitItems({}); };
  const unlock = () => setLocked(false);

  const triggerToast = () => {
    setShowToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setShowToast(false), 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    try { await refreshReport(); lock(); triggerToast(); }
    catch (e: any) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  // ── Counterparty header actions ───────────────────────────────────────────

  const submitDraftTx = async () => {
    if (!draftTx?.seller) return;
    setSaving(true); setError('');
    try {
      const tx = await createTransaction(company.id, date, {
        seller_id: draftTx.seller.id,
        invoice_number: draftTx.invoice || undefined,
        register_entry_number: draftTx.register || undefined,
      });
      setDraftTx(null);
      setTxOpen(p => ({ ...p, [tx.id]: true }));
      await refreshReport();
    } catch (e: any) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const submitDraftEx = async () => {
    if (!draftEx?.buyer) return;
    setSaving(true); setError('');
    try {
      const ex = await createExit(company.id, date, {
        buyer_id: draftEx.buyer.id,
        document_number: draftEx.document || undefined,
      });
      setDraftEx(null);
      setExOpen(p => ({ ...p, [ex.id]: true }));
      await refreshReport();
    } catch (e: any) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const deleteTx = async (id: number) => {
    try {
      await fetch(`${BASE}/companies/${company.id}/transactions/${id}`, { method: 'DELETE' });
      await refreshReport();
    } catch (e: any) { setError((e as Error).message); }
  };

  const deleteEx = async (id: number) => {
    try {
      await fetch(`${BASE}/companies/${company.id}/exits/${id}`, { method: 'DELETE' });
      await refreshReport();
    } catch (e: any) { setError((e as Error).message); }
  };

  // ── Item actions ──────────────────────────────────────────────────────────

  const submitEntryItem = async (txId: number) => {
    const d = draftEntryItems[txId];
    if (!d || !entryItemValid(d)) return;
    setSaving(true); setError('');
    try {
      await createTransactionItem(company.id, txId, {
        product_id: d.product!.id,
        purchase_no_tax:     parseFloat(d.purchase_no_tax),
        purchase_tax_amount: parseFloat(d.purchase_tax_amount) || 0,
        total_resale:        parseFloat(d.total_resale),
      });
      setDraftEntryItems(p => ({ ...p, [txId]: null }));
      const [rep, inv] = await Promise.all([getDailyReport(company.id, date), getInventory(company.id)]);
      setReport(rep); setInventory(inv);
      const newProds = await getProducts(company.id);
      setProducts(newProds);
    } catch (e: any) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const submitExitItem = async (exId: number) => {
    const d = draftExitItems[exId];
    if (!d || !exitItemValid(d)) return;
    setSaving(true); setError('');
    try {
      await createExitItem(company.id, exId, {
        product_id: d.product!.id,
        total_sale:  parseFloat(d.total_sale),
        vat_amount:  parseFloat(d.vat_amount) || 0,
      });
      setDraftExitItems(p => ({ ...p, [exId]: null }));
      const [rep, inv] = await Promise.all([getDailyReport(company.id, date), getInventory(company.id)]);
      setReport(rep); setInventory(inv);
    } catch (e: any) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  const delEntryItem = async (itemId: number) => {
    try {
      await deleteTransactionItem(company.id, itemId);
      const [rep, inv] = await Promise.all([getDailyReport(company.id, date), getInventory(company.id)]);
      setReport(rep); setInventory(inv);
    } catch (e: any) { setError((e as Error).message); }
  };

  const delExitItem = async (itemId: number) => {
    try {
      await deleteExitItem(company.id, itemId);
      const [rep, inv] = await Promise.all([getDailyReport(company.id, date), getInventory(company.id)]);
      setReport(rep); setInventory(inv);
    } catch (e: any) { setError((e as Error).message); }
  };

  // ── Grand totals ──────────────────────────────────────────────────────────

  const p = report;
  const f = (k: keyof DailyReport) => fmt((p as any)?.[k] ?? 0);

  // Section header sums from report
  const entryTotalTp  = p ? parseFloat(p.total_purchase)     : 0;
  const entryTotalPvat= p ? parseFloat(p.total_purchase_vat) : 0;
  const entryTotalPnt = p ? parseFloat(p.total_purchase_no_tax) : 0;
  const entryTotalTr  = p ? parseFloat(p.total_resale)        : 0;
  const entryTotalRv  = p ? parseFloat(p.total_resale_vat)    : 0;
  const entryTotalRnt = p ? parseFloat(p.total_resale_no_tax) : 0;
  const exitTotalTs   = p ? parseFloat(p.total_exit)          : 0;
  const exitTotalVat  = p ? parseFloat(p.total_exit_vat)      : 0;
  const exitTotalNv   = p ? parseFloat(p.total_exit_no_vat)   : 0;

  // ── Render entry item row (saved) ─────────────────────────────────────────

  const renderSavedEntryItem = (item: TransactionItemSchema) => {
    const prod = products.find(pr => pr.id === item.product_id);
    const pn = parseFloat(item.purchase_no_tax);
    const tn = parseFloat(item.purchase_tax_amount);
    const vat = pn > 0 ? `${Math.round((tn / pn) * 100)}%` : '—';
    return (
      <tr key={item.id} className={styles.itemRow}>
        <td className={`${styles.td} ${styles.itemIndent}`}>
          <span className={styles.productName}>{prod?.name ?? '—'}</span>
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(item.purchase_no_tax)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(item.purchase_tax_amount)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(item.total_purchase)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.resaleCol}`}>{fmt(item.total_resale)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(item.resale_vat)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(item.resale_no_tax)}</td>
        <td className={`${styles.td} ${styles.center}`}><span className={styles.vatBadge}>{vat}</span></td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.markupCell}`}>{fmt(item.markup)}</td>
        <td className={`${styles.td} ${styles.center}`}>
          {!locked && (
            <button className={styles.deleteRowBtn} onClick={() => delEntryItem(item.id)} title="Șterge">✕</button>
          )}
        </td>
      </tr>
    );
  };

  const renderDraftEntryItem = (txId: number) => {
    const d = draftEntryItems[txId];
    if (!d) return null;
    const pre = { ...d, ...computeEntryItem(d) };
    const valid = entryItemValid(d);
    return (
      <tr key="draft" className={`${styles.itemRow} ${styles.draftItemRow}`}>
        <td className={`${styles.td} ${styles.itemIndent}`}>
          <ProductSearch companyId={company.id} products={products}
            onSelect={pr => setDraftEntryItems(p => ({ ...p, [txId]: { ...p[txId]!, product: pr } }))}
            onProductCreated={pr => { setProducts(prev => [...prev, pr]); setDraftEntryItems(p => ({ ...p, [txId]: { ...p[txId]!, product: pr } })); }}
            placeholder="Caută / adaugă produs..."
          />
          {d.product && <div className={styles.selectedSeller}><span>{d.product.name}</span>
            <button className={styles.clearSeller} onClick={() => setDraftEntryItems(p => ({ ...p, [txId]: { ...p[txId]!, product: null } }))}>×</button>
          </div>}
        </td>
        <td className={styles.td}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01"
            value={d.purchase_no_tax} placeholder="0.00"
            onChange={e => setDraftEntryItems(p => ({ ...p, [txId]: { ...p[txId]!, purchase_no_tax: e.target.value } }))} />
        </td>
        <td className={styles.td}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01"
            value={d.purchase_tax_amount} placeholder="0.00"
            onChange={e => setDraftEntryItems(p => ({ ...p, [txId]: { ...p[txId]!, purchase_tax_amount: e.target.value } }))} />
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>{pre.c_tp ? fmt(pre.c_tp) : '—'}</td>
        <td className={`${styles.td} ${styles.resaleCol}`}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01"
            value={d.total_resale} placeholder="0.00"
            onChange={e => setDraftEntryItems(p => ({ ...p, [txId]: { ...p[txId]!, total_resale: e.target.value } }))}
            onKeyDown={e => { if (e.key === 'Enter' && valid) submitEntryItem(txId); }} />
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed} ${styles.resaleCol}`}>{pre.c_rv ? fmt(pre.c_rv) : '—'}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed} ${styles.resaleCol}`}>{pre.c_rnt ? fmt(pre.c_rnt) : '—'}</td>
        <td className={`${styles.td} ${styles.center}`}><span className={styles.vatBadge}>{pre.c_vat_pct}</span></td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>{pre.c_mu ? fmt(pre.c_mu) : '—'}</td>
        <td className={`${styles.td} ${styles.center}`}>
          <div className={styles.rowActions}>
            <button className={styles.acceptBtn} onClick={() => submitEntryItem(txId)} disabled={!valid} title="Confirmă (Enter)">✓</button>
            <button className={styles.deleteRowBtn} onClick={() => setDraftEntryItems(p => ({ ...p, [txId]: null }))} title="Anulează">✕</button>
          </div>
        </td>
      </tr>
    );
  };

  // ── Render exit item rows ─────────────────────────────────────────────────

  const renderSavedExitItem = (item: ExitItemSchema) => {
    const prod = products.find(pr => pr.id === item.product_id);
    return (
      <tr key={item.id} className={styles.itemRow}>
        <td className={`${styles.td} ${styles.itemIndent}`}>
          <span className={styles.productName}>{prod?.name ?? '—'}</span>
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(item.total_sale)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(item.vat_amount)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(item.total_sale_no_vat)}</td>
        <td className={`${styles.td} ${styles.center}`}>
          {!locked && (
            <button className={styles.deleteRowBtn} onClick={() => delExitItem(item.id)} title="Șterge">✕</button>
          )}
        </td>
      </tr>
    );
  };

  const renderDraftExitItem = (exId: number) => {
    const d = draftExitItems[exId];
    if (!d) return null;
    const pre = { ...d, ...computeExitItem(d) };
    const valid = exitItemValid(d);
    // Find which products are in inventory
    const inventoryProductIds = new Set(inventory.filter(i => parseFloat(i.stock_total) > 0).map(i => i.product_id));
    const inventoryProducts = products.filter(p => inventoryProductIds.has(p.id));
    return (
      <tr key="draft" className={`${styles.itemRow} ${styles.draftItemRow}`}>
        <td className={`${styles.td} ${styles.itemIndent}`}>
          <ProductSearch companyId={company.id} products={inventoryProducts}
            onSelect={pr => setDraftExitItems(p => ({ ...p, [exId]: { ...p[exId]!, product: pr } }))}
            onProductCreated={() => setError('Nu poți adăuga produse noi din secțiunea ieșiri.')}
            placeholder="Caută în inventar..."
          />
          {d.product && <div className={styles.selectedSeller}><span>{d.product.name}</span>
            <button className={styles.clearSeller} onClick={() => setDraftExitItems(p => ({ ...p, [exId]: { ...p[exId]!, product: null } }))}>×</button>
          </div>}
        </td>
        <td className={styles.td}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01"
            value={d.total_sale} placeholder="0.00"
            onChange={e => setDraftExitItems(p => ({ ...p, [exId]: { ...p[exId]!, total_sale: e.target.value } }))}
            onKeyDown={e => { if (e.key === 'Enter' && valid) submitExitItem(exId); }} />
        </td>
        <td className={styles.td}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`} type="number" min="0" step="0.01"
            value={d.vat_amount} placeholder="0.00"
            onChange={e => setDraftExitItems(p => ({ ...p, [exId]: { ...p[exId]!, vat_amount: e.target.value } }))} />
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>{pre.c_no_vat ? fmt(pre.c_no_vat) : '—'}</td>
        <td className={`${styles.td} ${styles.center}`}>
          <div className={styles.rowActions}>
            <button className={styles.acceptBtn} onClick={() => submitExitItem(exId)} disabled={!valid} title="Confirmă (Enter)">✓</button>
            <button className={styles.deleteRowBtn} onClick={() => setDraftExitItems(p => ({ ...p, [exId]: null }))} title="Anulează">✕</button>
          </div>
        </td>
      </tr>
    );
  };

  // ── Render transaction (entry) header row ─────────────────────────────────

  const renderTxRow = (tx: Transaction) => {
    const cp = counterparties.find(c => c.id === tx.seller_id);
    const open = txOpen[tx.id] ?? false;
    const hasDraftItem = draftEntryItems[tx.id] !== null && draftEntryItems[tx.id] !== undefined;
    return (
      <>
        {/* Header row */}
        <tr key={`tx-${tx.id}`} className={`${styles.cpRow} ${open ? styles.cpRowOpen : ''}`}>
          <td className={styles.td}>
            <button className={styles.cpToggle} onClick={() => setTxOpen(p => ({ ...p, [tx.id]: !open }))}>
              <span className={styles.cpCaret}>{open ? '▾' : '▸'}</span>
              <span className={styles.cpName}>{cp?.name ?? '—'}</span>
            </button>
          </td>
          <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{cp?.tax_id ?? '—'}</td>
          <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{tx.invoice_number ?? '—'}</td>
          <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{tx.register_entry_number ?? '—'}</td>
          {/* Purchase totals */}
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(tx.purchase_no_tax)}</td>
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(tx.purchase_tax_amount)}</td>
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(tx.total_purchase)}</td>
          {/* Resale totals */}
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold} ${styles.resaleCol}`}>{fmt(tx.total_resale)}</td>
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(tx.resale_vat)}</td>
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(tx.resale_no_tax)}</td>
          <td className={styles.td} />
          <td className={`${styles.td} ${styles.center}`}>
            {!locked && (
              <button className={styles.deleteRowBtn} onClick={() => deleteTx(tx.id)} title="Șterge rândul">✕</button>
            )}
          </td>
        </tr>
        {/* Expanded items */}
        {open && (
          <>
            {/* Item column headers */}
            <tr className={styles.itemHeaderRow}>
              <td className={`${styles.td} ${styles.itemIndent} ${styles.muted}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Produs</td>
              <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Fără TVA</td>
              <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>TVA</td>
              <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Total cump.</td>
              <td className={`${styles.td} ${styles.right} ${styles.muted} ${styles.resaleCol}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Total vânz.</td>
              <td className={`${styles.td} ${styles.right} ${styles.muted} ${styles.resaleCol}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>TVA vânz.</td>
              <td className={`${styles.td} ${styles.right} ${styles.muted} ${styles.resaleCol}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Fără TVA</td>
              <td className={`${styles.td} ${styles.center} ${styles.muted}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Cotă</td>
              <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Adaos</td>
              <td className={styles.td} />
            </tr>
            {tx.items.map(item => renderSavedEntryItem(item))}
            {renderDraftEntryItem(tx.id)}
            {!locked && !hasDraftItem && (
              <tr className={styles.addItemRow}>
                <td colSpan={10} className={styles.td}>
                  <button className={styles.addItemBtn}
                    onClick={() => setDraftEntryItems(p => ({ ...p, [tx.id]: emptyEntryItem() }))}>
                    + Adaugă produs
                  </button>
                </td>
              </tr>
            )}
          </>
        )}
      </>
    );
  };

  // ── Render exit header row ────────────────────────────────────────────────

  const renderExRow = (ex: ExitRecord) => {
    const cp = counterparties.find(c => c.id === ex.buyer_id);
    const open = exOpen[ex.id] ?? false;
    const hasDraftItem = draftExitItems[ex.id] !== null && draftExitItems[ex.id] !== undefined;
    return (
      <>
        <tr key={`ex-${ex.id}`} className={`${styles.cpRow} ${styles.cpRowExit} ${open ? styles.cpRowOpen : ''}`}>
          <td className={styles.td}>
            <button className={styles.cpToggle} onClick={() => setExOpen(p => ({ ...p, [ex.id]: !open }))}>
              <span className={styles.cpCaret}>{open ? '▾' : '▸'}</span>
              <span className={styles.cpName}>{cp?.name ?? '—'}</span>
            </button>
          </td>
          <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{cp?.tax_id ?? '—'}</td>
          <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{ex.document_number ?? '—'}</td>
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(ex.total_sale)}</td>
          <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(ex.vat_amount)}</td>
          <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(ex.total_sale_no_vat)}</td>
          <td className={`${styles.td} ${styles.center}`}>
            {!locked && (
              <button className={styles.deleteRowBtn} onClick={() => deleteEx(ex.id)} title="Șterge">✕</button>
            )}
          </td>
        </tr>
        {open && (
          <>
            <tr className={styles.itemHeaderRow}>
              <td className={`${styles.td} ${styles.itemIndent} ${styles.muted}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Produs</td>
              <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Total cu TVA</td>
              <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>TVA</td>
              <td className={`${styles.td} ${styles.right} ${styles.muted}`} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Fără TVA</td>
              <td className={styles.td} />
            </tr>
            {ex.items.map(item => renderSavedExitItem(item))}
            {renderDraftExitItem(ex.id)}
            {!locked && !hasDraftItem && (
              <tr className={styles.addItemRow}>
                <td colSpan={5} className={styles.td}>
                  <button className={styles.addItemBtn}
                    onClick={() => setDraftExitItems(p => ({ ...p, [ex.id]: emptyExitItem() }))}>
                    + Adaugă produs
                  </button>
                </td>
              </tr>
            )}
          </>
        )}
      </>
    );
  };

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={onBack}>← Calendar</button>
          <div className={styles.title}>
            <span className={styles.company}>{company.name}</span>
            <span className={styles.sep}>·</span>
            <span className={styles.date}>{formatDate(date)}</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          {p && (
            <div className={styles.stockBadge}>
              <span className={styles.stockLabel}>Stoc final</span>
              <span className={styles.stockValue}>{fmt(p.stock_end_of_day.total)} lei</span>
            </div>
          )}
          {locked
            ? <button className={styles.editBtn} onClick={unlock}>✎ Editează</button>
            : <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>{saving ? '...' : '✓ Salvează tot'}</button>
          }
        </div>
      </header>

      {locked && (
        <div className={styles.lockedBar}><span className={styles.lockedDot} />Ziua este salvată. Apasă „Editează" pentru modificări.</div>
      )}
      {error && <div className={styles.errorBar} onClick={() => setError('')}>{error} <span style={{ float: 'right', cursor: 'pointer' }}>×</span></div>}

      <div className={styles.sectionsWrap}>

        {/* ── ENTRIES ─────────────────────────────────────────────────── */}
        <div className={styles.section}>
          <button className={styles.sectionToggle} onClick={() => setEntriesOpen(o => !o)}>
            <span className={styles.sectionToggleLeft}>
              <span className={styles.sectionCaret}>{entriesOpen ? '▾' : '▸'}</span>
              <span className={styles.sectionTitle}>Intrări</span>
            </span>
            <span className={styles.sectionSummary}>
              <span className={styles.sumChip}>Cump. fără TVA <strong>{fmt(entryTotalPnt)}</strong></span>
              <span className={styles.sumChip}>TVA <strong>{fmt(entryTotalPvat)}</strong></span>
              <span className={styles.sumChip}>Total cump. <strong>{fmt(entryTotalTp)}</strong></span>
              <span className={styles.sumDivider} />
              <span className={styles.sumChip}>La preț achiz. <strong>{fmt(entryTotalTr)}</strong></span>
              <span className={styles.sumChip}>TVA vânz. <strong>{fmt(entryTotalRv)}</strong></span>
              <span className={styles.sumChip}>Fără TVA <strong>{fmt(entryTotalRnt)}</strong></span>
            </span>
          </button>

          {entriesOpen && (
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
                    <th className={`${styles.th} ${styles.thActions}`} />
                  </tr>
                  <tr className={styles.subHeaderRow}>
                    <th colSpan={4} /><th colSpan={3} className={`${styles.subHeader} ${styles.subHeaderPurchase}`}>CUMPĂRARE</th>
                    <th colSpan={5} className={`${styles.subHeader} ${styles.subHeaderResale}`}>LA PREȚUL DE ACHIZIȚIE</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(p?.transactions ?? []).length === 0 && !draftTx && (
                    <tr className={styles.emptyRow}><td colSpan={13}>{locked ? 'Nicio intrare.' : 'Nicio intrare. Adaugă un rând.'}</td></tr>
                  )}
                  {(p?.transactions ?? []).map(tx => renderTxRow(tx))}

                  {/* Draft new transaction header */}
                  {!locked && draftTx && (
                    <tr className={`${styles.cpRow} ${styles.draftCpRow}`}>
                      <td className={styles.td}>
                        <SellerSearch sellers={counterparties}
                          onSelect={s => setDraftTx(d => d ? { ...d, seller: s } : d)}
                          onSellerCreated={s => { setCounterparties(p => [...p, s]); setDraftTx(d => d ? { ...d, seller: s } : d); }} />
                        {draftTx.seller && <div className={styles.selectedSeller}><span>{draftTx.seller.name}</span>
                          <button className={styles.clearSeller} onClick={() => setDraftTx(d => d ? { ...d, seller: null } : d)}>×</button></div>}
                      </td>
                      <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{draftTx.seller?.tax_id ?? ''}</td>
                      <td className={styles.td}><input className={styles.cellInput} value={draftTx.invoice} onChange={e => setDraftTx(d => d ? { ...d, invoice: e.target.value } : d)} placeholder="—" /></td>
                      <td className={styles.td}><input className={styles.cellInput} value={draftTx.register} onChange={e => setDraftTx(d => d ? { ...d, register: e.target.value } : d)} placeholder="—" /></td>
                      <td colSpan={8} className={styles.td} />
                      <td className={`${styles.td} ${styles.center}`}>
                        <div className={styles.rowActions}>
                          <button className={styles.acceptBtn} onClick={submitDraftTx} disabled={!draftTx.seller || saving} title="Confirmă">✓</button>
                          <button className={styles.deleteRowBtn} onClick={() => setDraftTx(null)} title="Anulează">✕</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className={styles.totalsRow}>
                    <td colSpan={4} className={styles.td}>
                      {!locked && !draftTx && (
                        <button className={styles.addRowBtn} onClick={() => setDraftTx(emptyDraftTx())}>+ Adaugă furnizor</button>
                      )}
                    </td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal}`}>{fmt(entryTotalPnt)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted}`}>{fmt(entryTotalPvat)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.bold}`}>{fmt(entryTotalTp)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.bold} ${styles.resaleCol}`}>{fmt(entryTotalTr)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted} ${styles.resaleCol}`}>{fmt(entryTotalRv)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted} ${styles.resaleCol}`}>{fmt(entryTotalRnt)}</td>
                    <td className={styles.td} /><td className={styles.td} /><td className={styles.td} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* ── EXITS ───────────────────────────────────────────────────── */}
        <div className={styles.section}>
          <button className={styles.sectionToggle} onClick={() => setExitsOpen(o => !o)}>
            <span className={styles.sectionToggleLeft}>
              <span className={styles.sectionCaret}>{exitsOpen ? '▾' : '▸'}</span>
              <span className={styles.sectionTitle}>Ieșiri</span>
            </span>
            <span className={styles.sectionSummary}>
              <span className={styles.sumChip}>Fără TVA <strong>{fmt(exitTotalNv)}</strong></span>
              <span className={styles.sumChip}>TVA <strong>{fmt(exitTotalVat)}</strong></span>
              <span className={styles.sumChip}>Total <strong>{fmt(exitTotalTs)}</strong></span>
            </span>
          </button>

          {exitsOpen && (
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
                    <th className={`${styles.th} ${styles.thActions}`} />
                  </tr>
                </thead>
                <tbody>
                  {(p?.exits ?? []).length === 0 && !draftEx && (
                    <tr className={styles.emptyRow}><td colSpan={7}>{locked ? 'Nicio ieșire.' : 'Nicio ieșire. Adaugă un rând.'}</td></tr>
                  )}
                  {(p?.exits ?? []).map(ex => renderExRow(ex))}

                  {!locked && draftEx && (
                    <tr className={`${styles.cpRow} ${styles.cpRowExit} ${styles.draftCpRow}`}>
                      <td className={styles.td}>
                        <SellerSearch sellers={counterparties}
                          onSelect={s => setDraftEx(d => d ? { ...d, buyer: s } : d)}
                          onSellerCreated={s => { setCounterparties(p => [...p, s]); setDraftEx(d => d ? { ...d, buyer: s } : d); }} />
                        {draftEx.buyer && <div className={styles.selectedSeller}><span>{draftEx.buyer.name}</span>
                          <button className={styles.clearSeller} onClick={() => setDraftEx(d => d ? { ...d, buyer: null } : d)}>×</button></div>}
                      </td>
                      <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{draftEx.buyer?.tax_id ?? ''}</td>
                      <td className={styles.td}><input className={styles.cellInput} value={draftEx.document} onChange={e => setDraftEx(d => d ? { ...d, document: e.target.value } : d)} placeholder="—" /></td>
                      <td colSpan={3} className={styles.td} />
                      <td className={`${styles.td} ${styles.center}`}>
                        <div className={styles.rowActions}>
                          <button className={styles.acceptBtn} onClick={submitDraftEx} disabled={!draftEx.buyer || saving} title="Confirmă">✓</button>
                          <button className={styles.deleteRowBtn} onClick={() => setDraftEx(null)} title="Anulează">✕</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className={styles.totalsRow}>
                    <td colSpan={3} className={styles.td}>
                      {!locked && !draftEx && (
                        <button className={styles.addRowBtn} onClick={() => setDraftEx(emptyDraftEx())}>+ Adaugă beneficiar</button>
                      )}
                    </td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.bold}`}>{fmt(exitTotalTs)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted}`}>{fmt(exitTotalVat)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal}`}>{fmt(exitTotalNv)}</td>
                    <td className={styles.td} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── BOTTOM TOTALS ─────────────────────────────────────────────────── */}
      {p && (
        <div className={styles.bottomTotals}>
          <div className={styles.totalsBlock}>
            <div className={styles.totalsBlockLabel}>Ziua anterioară</div>
            <div className={styles.totalsGrid}>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Intrări fără TVA</span><span className={styles.totalsCellVal}>{fmt(p.prev_totals.resale_no_tax)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>TVA intrări</span><span className={styles.totalsCellVal}>{fmt(p.prev_totals.resale_vat)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Total intrări</span><span className={`${styles.totalsCellVal} ${styles.bold}`}>{fmt(p.prev_totals.total_resale)}</span></div>
              <div className={styles.totalsDivider} />
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
              <div className={styles.totalsDivider} />
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Ieșiri fără TVA</span><span className={styles.totalsCellVal}>{fmt(p.total_exit_no_vat)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>TVA ieșiri</span><span className={styles.totalsCellVal}>{fmt(p.total_exit_vat)}</span></div>
              <div className={styles.totalsCell}><span className={styles.totalsCellLabel}>Total ieșiri</span><span className={`${styles.totalsCellVal} ${styles.bold}`}>{fmt(p.total_exit)}</span></div>
              <div className={styles.totalsDivider} />
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

      {showToast && <div className={styles.toast}>✓ Ziua a fost salvată</div>}
    </div>
  );
}
