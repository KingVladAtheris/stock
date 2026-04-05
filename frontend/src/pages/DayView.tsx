import { useEffect, useRef, useState } from 'react';
import type { Company, Seller, Transaction, TransactionCreate, DailyReport } from '../types';
import { getDailyReport, getSellers, createTransaction, setTotalSale } from '../api';
import SellerSearch from '../components/SellerSearch';
import styles from './DayView.module.css';

const BASE = 'http://localhost:8000';

interface Props {
  company: Company;
  date: string;
  onBack: () => void;
}

interface EditableRow {
  seller: Seller | null;
  invoice: string;
  register: string;
  purchase_no_tax: string;
  purchase_tax_amount: string;
  total_resale: string;
  // Computed fields updated after accept — purely local display
  computed_total_purchase: number;
  computed_resale_no_tax: number;
  computed_markup: number;
  computed_vat: string;
  accepted: boolean; // true once the user has accepted at least once
}

const emptyDraft = (): EditableRow => ({
  seller: null, invoice: '', register: '',
  purchase_no_tax: '', purchase_tax_amount: '', total_resale: '',
  computed_total_purchase: 0, computed_resale_no_tax: 0,
  computed_markup: 0, computed_vat: '—', accepted: false,
});

// Given raw string inputs, compute derived display values
function computeRow(r: EditableRow): Pick<EditableRow,
  'computed_total_purchase' | 'computed_resale_no_tax' | 'computed_markup' | 'computed_vat'
> {
  const pn = parseFloat(r.purchase_no_tax) || 0;
  const tn = parseFloat(r.purchase_tax_amount) || 0;
  const rs = parseFloat(r.total_resale) || 0;
  const tf = pn > 0 ? 1 + tn / pn : 1;
  const rnt = pn > 0 ? rs / tf : 0;
  const mu = pn > 0 ? rnt - pn : 0;
  const vat = pn > 0 ? `${Math.round((tn / pn) * 100)}%` : '—';
  return {
    computed_total_purchase: pn + tn,
    computed_resale_no_tax: rnt,
    computed_markup: mu,
    computed_vat: vat,
  };
}

const txToEditable = (t: Transaction, sellers: Seller[]): EditableRow => {
  const base: EditableRow = {
    seller: sellers.find(s => s.id === t.seller_id) ?? null,
    invoice: t.invoice_number ?? '',
    register: t.register_entry_number ?? '',
    purchase_no_tax: String(t.purchase_no_tax),
    purchase_tax_amount: String(t.purchase_tax_amount),
    total_resale: String(t.total_resale),
    computed_total_purchase: 0, computed_resale_no_tax: 0,
    computed_markup: 0, computed_vat: '—', accepted: true,
  };
  return { ...base, ...computeRow(base) };
};

const fmt = (v: string | number) =>
  Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const rowValid = (r: EditableRow) =>
  r.seller !== null && parseFloat(r.purchase_no_tax) > 0 && parseFloat(r.total_resale) > 0;

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export default function DayView({ company, date, onBack }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // Stable order: list of IDs in insertion order
  const [txOrder, setTxOrder] = useState<number[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [draft, setDraft] = useState<EditableRow | null>(null);
  // editRows: id → editable state (populated when unlocked)
  const [editRows, setEditRows] = useState<Record<number, EditableRow>>({});
  const [totalSale, setTotalSaleVal] = useState('');
  const [report, setReport] = useState<DailyReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingRowId, setSavingRowId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async () => {
    const [rep, sels] = await Promise.all([
      getDailyReport(company.id, date),
      getSellers(),
    ]);
    // Sort by id to keep stable order
    const sorted = [...rep.transactions].sort((a, b) => a.id - b.id);
    setTransactions(sorted);
    setTxOrder(sorted.map(t => t.id));
    setSellers(sels);
    setReport(rep);
    const ts = parseFloat(String(rep.total_sale_input)) || 0;
    setTotalSaleVal(ts ? String(ts) : '');
    if (sorted.length > 0 || ts > 0) setLocked(true);
  };

  useEffect(() => { load(); }, [company.id, date]);

  const lock = () => { setLocked(true); setDraft(null); setEditRows({}); };

  const unlock = (txs: Transaction[], sels: Seller[]) => {
    const map: Record<number, EditableRow> = {};
    txs.forEach(t => { map[t.id] = txToEditable(t, sels); });
    setEditRows(map);
    setLocked(false);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && draft) setDraft(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [draft]);

  const updateEditRow = (id: number, patch: Partial<EditableRow>) =>
    setEditRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // Accept for existing rows: recalculate computed fields locally + persist to server
  // Does NOT re-fetch the full list → order stays stable
  const acceptRow = async (id: number) => {
    const row = editRows[id];
    if (!row || !rowValid(row)) return;
    const computed = computeRow(row);
    // Update computed fields + mark accepted immediately (no flicker)
    setEditRows(prev => ({
      ...prev,
      [id]: { ...prev[id], ...computed, accepted: true },
    }));
    setSavingRowId(id);
    setError('');
    try {
      const res = await fetch(`${BASE}/companies/${company.id}/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seller_id: row.seller!.id,
          invoice_number: row.invoice || undefined,
          register_entry_number: row.register || undefined,
          purchase_no_tax: parseFloat(row.purchase_no_tax),
          purchase_tax_amount: parseFloat(row.purchase_tax_amount) || 0,
          total_resale: parseFloat(row.total_resale),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      // Only update report totals without touching row order
      const rep = await getDailyReport(company.id, date);
      setReport(rep);
      // Update the canonical transaction data in place
      const updated: Transaction = await res.clone().json().catch(() => null);
      if (updated) {
        setTransactions(prev => prev.map(t => t.id === id ? updated : t));
      }
    } catch (e: any) {
      setError((e as Error).message);
    } finally {
      setSavingRowId(null);
    }
  };

  // Accept for new draft: persist + append to bottom of list
  const acceptDraft = async () => {
    if (!draft || !rowValid(draft)) return;
    const computed = computeRow(draft);
    setDraft(d => d ? { ...d, ...computed, accepted: true } : d);
    setSaving(true);
    setError('');
    try {
      const payload: TransactionCreate = {
        seller_id: draft.seller!.id,
        invoice_number: draft.invoice || undefined,
        register_entry_number: draft.register || undefined,
        purchase_no_tax: parseFloat(draft.purchase_no_tax),
        purchase_tax_amount: parseFloat(draft.purchase_tax_amount) || 0,
        total_resale: parseFloat(draft.total_resale),
      };
      const newTx: Transaction = await createTransaction(company.id, date, payload);
      setTransactions(prev => [...prev, newTx]);
      setTxOrder(prev => [...prev, newTx.id]);
      setEditRows(prev => ({ ...prev, [newTx.id]: txToEditable(newTx, sellers) }));
      setDraft(null);
      const rep = await getDailyReport(company.id, date);
      setReport(rep);
    } catch (e: any) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (id: number) => {
    setSavingRowId(id);
    setError('');
    try {
      const res = await fetch(`${BASE}/companies/${company.id}/transactions/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      setTransactions(prev => prev.filter(t => t.id !== id));
      setTxOrder(prev => prev.filter(i => i !== id));
      setEditRows(prev => { const n = { ...prev }; delete n[id]; return n; });
      const rep = await getDailyReport(company.id, date);
      setReport(rep);
    } catch (e: any) {
      setError((e as Error).message);
    } finally {
      setSavingRowId(null);
    }
  };

  const handleGlobalSave = async () => {
    setSaving(true);
    setError('');
    try {
      await setTotalSale(company.id, date, parseFloat(totalSale) || 0);
      await load();
      lock();
      triggerToast();
    } catch (e: any) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const triggerToast = () => {
    setShowToast(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setShowToast(false), 2000);
  };

  const sum = (key: keyof Transaction) =>
    transactions.reduce((s, t) => s + parseFloat(String(t[key])), 0);

  // ── Shared input row renderer ──────────────────────────────────────────
  const renderInputRow = (
    row: EditableRow,
    onChange: (p: Partial<EditableRow>) => void,
    onAccept: () => void,
    onDelete: () => void,
    busy: boolean,
    isDraft: boolean,
  ) => {
    const valid = rowValid(row);
    // Use accepted computed values if present, else live preview
    const preview = row.accepted ? row : computeRow(row);
    const { computed_total_purchase: tp, computed_resale_no_tax: rnt,
            computed_markup: mu, computed_vat: vat } = preview;

    return (
      <>
        <td className={styles.td}>
          <SellerSearch
            sellers={sellers}
            onSelect={s => onChange({ seller: s })}
            onSellerCreated={s => { setSellers(prev => [...prev, s]); onChange({ seller: s }); }}
          />
          {row.seller && (
            <div className={styles.selectedSeller}>
              <span>{row.seller.name}</span>
              <button className={styles.clearSeller} onClick={() => onChange({ seller: null })}>×</button>
            </div>
          )}
        </td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{row.seller?.tax_id ?? ''}</td>
        <td className={styles.td}>
          <input className={styles.cellInput} value={row.invoice}
            onChange={e => onChange({ invoice: e.target.value })} placeholder="—" />
        </td>
        <td className={styles.td}>
          <input className={styles.cellInput} value={row.register}
            onChange={e => onChange({ register: e.target.value })} placeholder="—" />
        </td>
        <td className={styles.td}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`}
            type="number" min="0" step="0.01"
            value={row.purchase_no_tax}
            onChange={e => onChange({ purchase_no_tax: e.target.value })}
            placeholder="0.00" />
        </td>
        <td className={styles.td}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`}
            type="number" min="0" step="0.01"
            value={row.purchase_tax_amount}
            onChange={e => onChange({ purchase_tax_amount: e.target.value })}
            placeholder="0.00" />
        </td>
        <td className={`${styles.td} ${styles.center}`}>
          <span className={styles.vatBadge}>{vat}</span>
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>
          {tp ? fmt(tp) : '—'}
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed} ${styles.resaleCol}`}>
          {rnt ? fmt(rnt) : '—'}
        </td>
        <td className={`${styles.td} ${styles.resaleCol}`}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`}
            type="number" min="0" step="0.01"
            value={row.total_resale}
            onChange={e => onChange({ total_resale: e.target.value })}
            placeholder="0.00"
            onKeyDown={e => { if (e.key === 'Enter' && valid) onAccept(); }} />
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed} ${styles.markupComputed}`}>
          {mu ? fmt(mu) : '—'}
        </td>
        <td className={`${styles.td} ${styles.center}`}>
          <div className={styles.rowActions}>
            <button className={styles.acceptBtn} title="Confirma calculele (Enter)"
              onClick={onAccept} disabled={!valid || busy}>✓</button>
            <button className={styles.deleteRowBtn}
              title={isDraft ? 'Anulează (Esc)' : 'Șterge rândul'}
              onClick={onDelete} disabled={busy}>✕</button>
          </div>
        </td>
      </>
    );
  };

  // ── JSX ────────────────────────────────────────────────────────────────
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
          {report && (
            <div className={styles.stockBadge}>
              <span className={styles.stockLabel}>Stoc final</span>
              <span className={styles.stockValue}>{fmt(report.stock_end_of_day)} lei</span>
            </div>
          )}
          {locked ? (
            <button className={styles.editBtn} onClick={() => unlock(transactions, sellers)}>✎ Editează</button>
          ) : (
            <button className={styles.saveBtn} onClick={handleGlobalSave} disabled={saving}>
              {saving ? '...' : '✓ Salvează tot'}
            </button>
          )}
        </div>
      </header>

      {locked && (
        <div className={styles.lockedBar}>
          <span className={styles.lockedDot} />
          Ziua este salvată. Apasă „Editează" pentru a face modificări.
        </div>
      )}

      {error && <div className={styles.errorBar}>{error}</div>}

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
              <th className={`${styles.th} ${styles.thPurchase} ${styles.center}`}>Cota</th>
              <th className={`${styles.th} ${styles.thPurchase} ${styles.right}`}>Total cump.</th>
              <th className={`${styles.th} ${styles.thResale} ${styles.right}`}>Fără TVA</th>
              <th className={`${styles.th} ${styles.thResale} ${styles.right}`}>Total vânz.</th>
              <th className={`${styles.th} ${styles.thResale} ${styles.right}`}>Adaos</th>
              <th className={`${styles.th} ${styles.thActions}`}></th>
            </tr>
            <tr className={styles.subHeaderRow}>
              <th colSpan={4} />
              <th colSpan={4} className={`${styles.subHeader} ${styles.subHeaderPurchase}`}>CUMPĂRARE</th>
              <th colSpan={3} className={`${styles.subHeader} ${styles.subHeaderResale}`}>VÂNZARE</th>
              <th />
            </tr>
          </thead>

          <tbody>
            {txOrder.length === 0 && !draft && (
              <tr className={styles.emptyRow}>
                <td colSpan={12}>
                  {locked ? 'Nicio tranzacție înregistrată.' : 'Nicio tranzacție. Adaugă un rând pentru a începe.'}
                </td>
              </tr>
            )}

            {txOrder.map(id => {
              const t = transactions.find(tx => tx.id === id);
              if (!t) return null;
              const editRow = editRows[id];
              const busy = savingRowId === id;

              if (!locked && editRow) {
                return (
                  <tr key={id} className={`${styles.row} ${styles.draftRow}`}>
                    {renderInputRow(
                      editRow,
                      patch => updateEditRow(id, patch),
                      () => acceptRow(id),
                      () => deleteRow(id),
                      busy, false,
                    )}
                  </tr>
                );
              }

              const s = sellers.find(sel => sel.id === t.seller_id);
              const pn = String(t.purchase_no_tax);
              const tn = String(t.purchase_tax_amount);
              const vat = parseFloat(pn) > 0
                ? `${Math.round((parseFloat(tn) / parseFloat(pn)) * 100)}%`
                : '—';
              return (
                <tr key={id} className={styles.row}>
                  <td className={`${styles.td} ${styles.sellerName}`}>{s?.name ?? '—'}</td>
                  <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{s?.tax_id ?? '—'}</td>
                  <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{t.invoice_number ?? '—'}</td>
                  <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{t.register_entry_number ?? '—'}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(t.purchase_no_tax)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(t.purchase_tax_amount)}</td>
                  <td className={`${styles.td} ${styles.center}`}><span className={styles.vatBadge}>{vat}</span></td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(t.total_purchase)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(t.resale_no_tax)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold} ${styles.resaleCol}`}>{fmt(t.total_resale)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.markup}`}>{fmt(t.markup)}</td>
                  <td className={styles.td} />
                </tr>
              );
            })}

            {!locked && draft !== null && (
              <tr className={`${styles.row} ${styles.draftRow} ${styles.draftNew}`}>
                {renderInputRow(
                  draft,
                  patch => setDraft(d => d ? { ...d, ...patch } : d),
                  acceptDraft,
                  () => setDraft(null),
                  saving, true,
                )}
              </tr>
            )}
          </tbody>

          <tfoot>
            <tr className={styles.totalsRow}>
              <td colSpan={4} className={styles.td}>
                {!locked && (
                  <button
                    className={`${styles.addRowBtn} ${draft !== null ? styles.addRowBtnDisabled : ''}`}
                    onClick={() => { if (!draft) { setDraft(emptyDraft()); setError(''); } }}
                    disabled={draft !== null}
                  >
                    + Adaugă rând
                  </button>
                )}
              </td>
              <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal}`}>{fmt(sum('purchase_no_tax'))}</td>
              <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted}`}>{fmt(sum('purchase_tax_amount'))}</td>
              <td className={styles.td} />
              <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.bold}`}>{fmt(sum('total_purchase'))}</td>
              <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted} ${styles.resaleCol}`}>{fmt(sum('resale_no_tax'))}</td>
              <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.bold} ${styles.resaleCol}`}>{fmt(sum('total_resale'))}</td>
              <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.markupTotal}`}>{fmt(sum('markup'))}</td>
              <td className={styles.td} />
            </tr>
            <tr className={styles.saleRow}>
              <td colSpan={4} className={styles.td} />
              <td colSpan={4} className={styles.td} />
              <td colSpan={4} className={styles.td}>
                <div className={styles.saleInner}>
                  <label className={styles.saleLabel}>Vânzări totale (casă)</label>
                  <input
                    className={styles.saleInput}
                    type="number" min="0" step="0.01"
                    value={totalSale}
                    onChange={e => setTotalSaleVal(e.target.value)}
                    disabled={locked}
                    placeholder="0.00"
                  />
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {report && (
        <div className={styles.summaryBar}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Stoc anterior</span>
            <span className={styles.summaryValue}>{fmt(report.previous_stock)} lei</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Intrări (vânz.)</span>
            <span className={styles.summaryValue}>{fmt(report.total_resale)} lei</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Ieșiri (vânzări)</span>
            <span className={styles.summaryValue}>{fmt(report.total_sale_input)} lei</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Variație netă</span>
            <span className={`${styles.summaryValue} ${parseFloat(String(report.net_inventory_change)) >= 0 ? styles.pos : styles.neg}`}>
              {fmt(report.net_inventory_change)} lei
            </span>
          </div>
          <div className={`${styles.summaryItem} ${styles.summaryStock}`}>
            <span className={styles.summaryLabel}>Stoc final</span>
            <span className={styles.summaryValue}>{fmt(report.stock_end_of_day)} lei</span>
          </div>
        </div>
      )}

      {showToast && <div className={styles.toast}>✓ Ziua a fost salvată</div>}
    </div>
  );
}
