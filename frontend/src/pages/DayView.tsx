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
}

const emptyDraft = (): EditableRow => ({
  seller: null, invoice: '', register: '',
  purchase_no_tax: '', purchase_tax_amount: '', total_resale: '',
});

const txToEditable = (t: Transaction, sellers: Seller[]): EditableRow => ({
  seller: sellers.find(s => s.id === t.seller_id) ?? null,
  invoice: t.invoice_number ?? '',
  register: t.register_entry_number ?? '',
  purchase_no_tax: String(t.purchase_no_tax),
  purchase_tax_amount: String(t.purchase_tax_amount),
  total_resale: String(t.total_resale),
});

const fmt = (v: string | number) =>
  Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const taxFactor = (p: string, t: string) => {
  const pn = parseFloat(p);
  const tn = parseFloat(t);
  if (!pn) return 1;
  return 1 + tn / pn;
};

const resaleNoTaxCalc = (resale: string, p: string, t: string) =>
  parseFloat(resale) / taxFactor(p, t);

const markupCalc = (resale: string, p: string, t: string) =>
  resaleNoTaxCalc(resale, p, t) - parseFloat(p || '0');

const vatPct = (p: string, t: string): string => {
  const pn = parseFloat(p);
  const tn = parseFloat(t);
  if (!pn) return '—';
  return `${Math.round((tn / pn) * 100)}%`;
};

const rowValid = (r: EditableRow) =>
  r.seller !== null &&
  parseFloat(r.purchase_no_tax) > 0 &&
  parseFloat(r.total_resale) > 0;

const computedPreview = (r: EditableRow) => ({
  totalPurchase: (parseFloat(r.purchase_no_tax) || 0) + (parseFloat(r.purchase_tax_amount) || 0),
  rnt: r.total_resale && r.purchase_no_tax
    ? resaleNoTaxCalc(r.total_resale, r.purchase_no_tax, r.purchase_tax_amount)
    : 0,
  mu: r.purchase_no_tax && r.total_resale
    ? markupCalc(r.total_resale, r.purchase_no_tax, r.purchase_tax_amount)
    : 0,
  vat: vatPct(r.purchase_no_tax, r.purchase_tax_amount),
});

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export default function DayView({ company, date, onBack }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [draft, setDraft] = useState<EditableRow | null>(null);
  // Map: transaction id → editable state (only populated when unlocked)
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
    setTransactions(rep.transactions);
    setSellers(sels);
    setReport(rep);
    const ts = parseFloat(String(rep.total_sale_input)) || 0;
    setTotalSaleVal(ts ? String(ts) : '');
    if (rep.transactions.length > 0 || ts > 0) setLocked(true);
  };

  useEffect(() => { load(); }, [company.id, date]);

  const lock = () => {
    setLocked(true);
    setDraft(null);
    setEditRows({});
  };

  const unlock = (txs: Transaction[], sels: Seller[]) => {
    const map: Record<number, EditableRow> = {};
    txs.forEach(t => { map[t.id] = txToEditable(t, sels); });
    setEditRows(map);
    setLocked(false);
  };

  // Escape cancels new draft row only
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && draft) setDraft(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [draft]);

  const updateEditRow = (id: number, patch: Partial<EditableRow>) =>
    setEditRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // ── Submit new draft ────────────────────────────────────────────────────
  const submitDraft = async () => {
    if (!draft || !rowValid(draft)) return;
    setError('');
    setSaving(true);
    try {
      const payload: TransactionCreate = {
        seller_id: draft.seller!.id,
        invoice_number: draft.invoice || undefined,
        register_entry_number: draft.register || undefined,
        purchase_no_tax: parseFloat(draft.purchase_no_tax),
        purchase_tax_amount: parseFloat(draft.purchase_tax_amount) || 0,
        total_resale: parseFloat(draft.total_resale),
      };
      await createTransaction(company.id, date, payload);
      setDraft(null);
      const rep = await getDailyReport(company.id, date);
      setTransactions(rep.transactions);
      setReport(rep);
      // add new rows to editRows (keep existing edits intact)
      setEditRows(prev => {
        const next = { ...prev };
        rep.transactions.forEach(t => {
          if (!next[t.id]) next[t.id] = txToEditable(t, sellers);
        });
        return next;
      });
    } catch (e: any) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ── Save existing row ───────────────────────────────────────────────────
  const saveRow = async (id: number) => {
    const row = editRows[id];
    if (!row || !rowValid(row)) return;
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
      const rep = await getDailyReport(company.id, date);
      setTransactions(rep.transactions);
      setReport(rep);
      const updated = rep.transactions.find(t => t.id === id);
      if (updated) setEditRows(prev => ({ ...prev, [id]: txToEditable(updated, sellers) }));
    } catch (e: any) {
      setError((e as Error).message);
    } finally {
      setSavingRowId(null);
    }
  };

  // ── Delete existing row ─────────────────────────────────────────────────
  const deleteRow = async (id: number) => {
    setSavingRowId(id);
    setError('');
    try {
      const res = await fetch(`${BASE}/companies/${company.id}/transactions/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
      }
      const rep = await getDailyReport(company.id, date);
      setTransactions(rep.transactions);
      setReport(rep);
      setEditRows(prev => { const next = { ...prev }; delete next[id]; return next; });
    } catch (e: any) {
      setError((e as Error).message);
    } finally {
      setSavingRowId(null);
    }
  };

  // ── Global save ─────────────────────────────────────────────────────────
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

  // ── Totals ──────────────────────────────────────────────────────────────
  const sum = (key: keyof Transaction) =>
    transactions.reduce((s, t) => s + parseFloat(String(t[key])), 0);

  // ── Shared row renderer ─────────────────────────────────────────────────
  const renderInputRow = (
    row: EditableRow,
    onChange: (p: Partial<EditableRow>) => void,
    onAccept: () => void,
    onDelete: () => void,
    busy: boolean,
    isDraft: boolean,
  ) => {
    const { totalPurchase, rnt, mu, vat } = computedPreview(row);
    const valid = rowValid(row);
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
          {totalPurchase ? fmt(totalPurchase) : '—'}
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
            onKeyDown={e => e.key === 'Enter' && valid && onAccept()} />
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed} ${styles.markupComputed}`}>
          {mu ? fmt(mu) : '—'}
        </td>
        <td className={`${styles.td} ${styles.center}`}>
          <div className={styles.rowActions}>
            <button className={styles.acceptBtn} title="Acceptă (Enter)"
              onClick={onAccept} disabled={!valid || busy}>✓</button>
            <button className={styles.deleteRowBtn}
              title={isDraft ? 'Anulează (Esc)' : 'Șterge rândul'}
              onClick={onDelete}>✕</button>
          </div>
        </td>
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
            <button className={styles.editBtn} onClick={() => unlock(transactions, sellers)}>
              ✎ Editează
            </button>
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
              <th className={`${styles.th} ${styles.thPurchase} ${styles.mono}`}>Nr. factură</th>
              <th className={`${styles.th} ${styles.thPurchase} ${styles.mono}`}>Nr. intrare</th>
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
            {transactions.length === 0 && !draft && (
              <tr className={styles.emptyRow}>
                <td colSpan={12}>
                  {locked
                    ? 'Nicio tranzacție înregistrată.'
                    : 'Nicio tranzacție. Adaugă un rând pentru a începe.'}
                </td>
              </tr>
            )}

            {transactions.map(t => {
              const editRow = editRows[t.id];
              const busy = savingRowId === t.id;

              if (!locked && editRow) {
                return (
                  <tr key={t.id} className={`${styles.row} ${styles.draftRow}`}>
                    {renderInputRow(
                      editRow,
                      patch => updateEditRow(t.id, patch),
                      () => saveRow(t.id),
                      () => deleteRow(t.id),
                      busy,
                      false,
                    )}
                  </tr>
                );
              }

              // Locked display row
              const s = sellers.find(sel => sel.id === t.seller_id);
              const vat = vatPct(String(t.purchase_no_tax), String(t.purchase_tax_amount));
              return (
                <tr key={t.id} className={styles.row}>
                  <td className={`${styles.td} ${styles.sellerName}`}>{s?.name ?? '—'}</td>
                  <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{s?.tax_id ?? '—'}</td>
                  <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{t.invoice_number ?? '—'}</td>
                  <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{t.register_entry_number ?? '—'}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(t.purchase_no_tax)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(t.purchase_tax_amount)}</td>
                  <td className={`${styles.td} ${styles.center}`}>
                    <span className={styles.vatBadge}>{vat}</span>
                  </td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(t.total_purchase)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(t.resale_no_tax)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold} ${styles.resaleCol}`}>{fmt(t.total_resale)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.markup}`}>{fmt(t.markup)}</td>
                  <td className={styles.td} />
                </tr>
              );
            })}

            {/* New draft row — always at the bottom when present */}
            {!locked && draft !== null && (
              <tr className={`${styles.row} ${styles.draftRow} ${styles.draftNew}`}>
                {renderInputRow(
                  draft,
                  patch => setDraft(d => d ? { ...d, ...patch } : d),
                  submitDraft,
                  () => setDraft(null),
                  saving,
                  true,
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
                    title={draft !== null ? 'Acceptă sau anulează rândul curent mai întâi' : ''}
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

      {showToast && (
        <div className={styles.toast}>✓ Ziua a fost salvată</div>
      )}
    </div>
  );
}
