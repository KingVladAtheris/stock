import { useEffect, useRef, useState } from 'react';
import type {
  Company, Counterparty, Transaction, TransactionCreate,
  Exit, ExitCreate, DailyReport,
} from '../types';
import { getDailyReport, getCounterparties, createTransaction, createExit } from '../api';
import SellerSearch from '../components/SellerSearch';
import styles from './DayView.module.css';

const BASE = 'http://localhost:8000';

interface Props { company: Company; date: string; onBack: () => void; }

// ── Shared editable row shape ─────────────────────────────────────────────

interface EntryRow {
  seller: Counterparty | null;
  invoice: string; register: string;
  purchase_no_tax: string; purchase_tax_amount: string; total_resale: string;
  // computed
  c_total_purchase: number; c_resale_no_tax: number;
  c_resale_vat: number; c_markup: number; c_vat_pct: string;
  accepted: boolean;
}

interface ExitRow {
  buyer: Counterparty | null;
  document: string;
  total_sale: string; vat_amount: string;
  // computed
  c_no_vat: number;
  accepted: boolean;
}

const emptyEntry = (): EntryRow => ({
  seller: null, invoice: '', register: '',
  purchase_no_tax: '', purchase_tax_amount: '', total_resale: '',
  c_total_purchase: 0, c_resale_no_tax: 0, c_resale_vat: 0,
  c_markup: 0, c_vat_pct: '—', accepted: false,
});

const emptyExit = (): ExitRow => ({
  buyer: null, document: '',
  total_sale: '', vat_amount: '',
  c_no_vat: 0, accepted: false,
});

// ── Compute helpers ────────────────────────────────────────────────────────

function computeEntry(r: EntryRow): Partial<EntryRow> {
  const pn = parseFloat(r.purchase_no_tax) || 0;
  const tn = parseFloat(r.purchase_tax_amount) || 0;
  const rs = parseFloat(r.total_resale) || 0;
  const tf = pn > 0 ? 1 + tn / pn : 1;
  const rnt = pn > 0 ? rs / tf : 0;
  return {
    c_total_purchase: pn + tn,
    c_resale_no_tax: rnt,
    c_resale_vat: rs - rnt,
    c_markup: pn > 0 ? rnt - pn : 0,
    c_vat_pct: pn > 0 ? `${Math.round((tn / pn) * 100)}%` : '—',
  };
}

function computeExit(r: ExitRow): Partial<ExitRow> {
  const ts = parseFloat(r.total_sale) || 0;
  const vat = parseFloat(r.vat_amount) || 0;
  return { c_no_vat: ts - vat };
}

const entryValid = (r: EntryRow) =>
  r.seller !== null && parseFloat(r.purchase_no_tax) > 0 && parseFloat(r.total_resale) > 0;
const exitValid = (r: ExitRow) =>
  r.buyer !== null && parseFloat(r.total_sale) > 0;

function txToEntry(t: Transaction, cps: Counterparty[]): EntryRow {
  const base: EntryRow = {
    seller: cps.find(c => c.id === t.seller_id) ?? null,
    invoice: t.invoice_number ?? '', register: t.register_entry_number ?? '',
    purchase_no_tax: String(t.purchase_no_tax),
    purchase_tax_amount: String(t.purchase_tax_amount),
    total_resale: String(t.total_resale),
    c_total_purchase: 0, c_resale_no_tax: 0, c_resale_vat: 0,
    c_markup: 0, c_vat_pct: '—', accepted: true,
  };
  return { ...base, ...computeEntry(base) };
}

function exToExitRow(e: Exit, cps: Counterparty[]): ExitRow {
  const base: ExitRow = {
    buyer: cps.find(c => c.id === e.buyer_id) ?? null,
    document: e.document_number ?? '',
    total_sale: String(e.total_sale), vat_amount: String(e.vat_amount),
    c_no_vat: 0, accepted: true,
  };
  return { ...base, ...computeExit(base) };
}

const fmt = (v: string | number) =>
  Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function DayView({ company, date, onBack }: Props) {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);

  // Stable-ordered IDs + editable maps
  const [txOrder, setTxOrder] = useState<number[]>([]);
  const [txMap, setTxMap] = useState<Record<number, Transaction>>({});
  const [entryRows, setEntryRows] = useState<Record<number, EntryRow>>({});

  const [exOrder, setExOrder] = useState<number[]>([]);
  const [exMap, setExMap] = useState<Record<number, Exit>>({});
  const [exitRows, setExitRows] = useState<Record<number, ExitRow>>({});

  const [draftEntry, setDraftEntry] = useState<EntryRow | null>(null);
  const [draftExit, setDraftExit] = useState<ExitRow | null>(null);

  const [entriesOpen, setEntriesOpen] = useState(true);
  const [exitsOpen, setExitsOpen] = useState(true);

  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showToast, setShowToast] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────

  const load = async () => {
    const [rep, cps] = await Promise.all([
      getDailyReport(company.id, date),
      getCounterparties(),
    ]);
    const sortedTx = [...rep.transactions].sort((a, b) => a.id - b.id);
    const sortedEx = [...rep.exits].sort((a, b) => a.id - b.id);
    setReport(rep);
    setCounterparties(cps);
    setTxOrder(sortedTx.map(t => t.id));
    setTxMap(Object.fromEntries(sortedTx.map(t => [t.id, t])));
    setExOrder(sortedEx.map(e => e.id));
    setExMap(Object.fromEntries(sortedEx.map(e => [e.id, e])));
    if (sortedTx.length > 0 || sortedEx.length > 0) setLocked(true);
  };

  useEffect(() => { load(); }, [company.id, date]);

  // ── Lock / unlock ──────────────────────────────────────────────────────

  const lock = () => {
    setLocked(true); setDraftEntry(null); setDraftExit(null);
    setEntryRows({}); setExitRows({});
  };

  const unlock = () => {
    const er: Record<number, EntryRow> = {};
    txOrder.forEach(id => { er[id] = txToEntry(txMap[id], counterparties); });
    const xr: Record<number, ExitRow> = {};
    exOrder.forEach(id => { xr[id] = exToExitRow(exMap[id], counterparties); });
    setEntryRows(er); setExitRows(xr); setLocked(false);
  };

  // Escape cancels draft rows
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDraftEntry(null); setDraftExit(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ── Entry CRUD ─────────────────────────────────────────────────────────

  const acceptEntry = async (id: number) => {
    const row = entryRows[id];
    if (!row || !entryValid(row)) return;
    const computed = computeEntry(row);
    setEntryRows(p => ({ ...p, [id]: { ...p[id], ...computed, accepted: true } }));
    setSavingId(`tx-${id}`);
    try {
      const res = await fetch(`${BASE}/companies/${company.id}/transactions/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seller_id: row.seller!.id,
          invoice_number: row.invoice || undefined,
          register_entry_number: row.register || undefined,
          purchase_no_tax: parseFloat(row.purchase_no_tax),
          purchase_tax_amount: parseFloat(row.purchase_tax_amount) || 0,
          total_resale: parseFloat(row.total_resale),
        }),
      });
      if (!res.ok) throw new Error(((await res.json()) as any).detail);
      const updated: Transaction = await res.json();
      setTxMap(p => ({ ...p, [id]: updated }));
      const rep = await getDailyReport(company.id, date);
      setReport(rep);
    } catch (e: any) { setError(e.message); }
    finally { setSavingId(null); }
  };

  const deleteEntry = async (id: number) => {
    setSavingId(`tx-${id}`);
    try {
      const res = await fetch(`${BASE}/companies/${company.id}/transactions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(((await res.json()) as any).detail);
      setTxOrder(p => p.filter(i => i !== id));
      setTxMap(p => { const n = { ...p }; delete n[id]; return n; });
      setEntryRows(p => { const n = { ...p }; delete n[id]; return n; });
      const rep = await getDailyReport(company.id, date);
      setReport(rep);
    } catch (e: any) { setError(e.message); }
    finally { setSavingId(null); }
  };

  const submitDraftEntry = async () => {
    if (!draftEntry || !entryValid(draftEntry)) return;
    setSaving(true);
    try {
      const payload: TransactionCreate = {
        seller_id: draftEntry.seller!.id,
        invoice_number: draftEntry.invoice || undefined,
        register_entry_number: draftEntry.register || undefined,
        purchase_no_tax: parseFloat(draftEntry.purchase_no_tax),
        purchase_tax_amount: parseFloat(draftEntry.purchase_tax_amount) || 0,
        total_resale: parseFloat(draftEntry.total_resale),
      };
      const newTx = await createTransaction(company.id, date, payload);
      setTxOrder(p => [...p, newTx.id]);
      setTxMap(p => ({ ...p, [newTx.id]: newTx }));
      setEntryRows(p => ({ ...p, [newTx.id]: txToEntry(newTx, counterparties) }));
      setDraftEntry(null);
      const rep = await getDailyReport(company.id, date);
      setReport(rep);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  // ── Exit CRUD ──────────────────────────────────────────────────────────

  const acceptExit = async (id: number) => {
    const row = exitRows[id];
    if (!row || !exitValid(row)) return;
    const computed = computeExit(row);
    setExitRows(p => ({ ...p, [id]: { ...p[id], ...computed, accepted: true } }));
    setSavingId(`ex-${id}`);
    try {
      const res = await fetch(`${BASE}/companies/${company.id}/exits/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyer_id: row.buyer!.id,
          document_number: row.document || undefined,
          total_sale: parseFloat(row.total_sale),
          vat_amount: parseFloat(row.vat_amount) || 0,
        }),
      });
      if (!res.ok) throw new Error(((await res.json()) as any).detail);
      const updated: Exit = await res.json();
      setExMap(p => ({ ...p, [id]: updated }));
      const rep = await getDailyReport(company.id, date);
      setReport(rep);
    } catch (e: any) { setError(e.message); }
    finally { setSavingId(null); }
  };

  const deleteExit = async (id: number) => {
    setSavingId(`ex-${id}`);
    try {
      const res = await fetch(`${BASE}/companies/${company.id}/exits/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(((await res.json()) as any).detail);
      setExOrder(p => p.filter(i => i !== id));
      setExMap(p => { const n = { ...p }; delete n[id]; return n; });
      setExitRows(p => { const n = { ...p }; delete n[id]; return n; });
      const rep = await getDailyReport(company.id, date);
      setReport(rep);
    } catch (e: any) { setError(e.message); }
    finally { setSavingId(null); }
  };

  const submitDraftExit = async () => {
    if (!draftExit || !exitValid(draftExit)) return;
    setSaving(true);
    try {
      const payload: ExitCreate = {
        buyer_id: draftExit.buyer!.id,
        document_number: draftExit.document || undefined,
        total_sale: parseFloat(draftExit.total_sale),
        vat_amount: parseFloat(draftExit.vat_amount) || 0,
      };
      const newEx = await createExit(company.id, date, payload);
      setExOrder(p => [...p, newEx.id]);
      setExMap(p => ({ ...p, [newEx.id]: newEx }));
      setExitRows(p => ({ ...p, [newEx.id]: exToExitRow(newEx, counterparties) }));
      setDraftExit(null);
      const rep = await getDailyReport(company.id, date);
      setReport(rep);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  // ── Global save ────────────────────────────────────────────────────────

  const handleGlobalSave = async () => {
    setSaving(true);
    try {
      await load(); lock();
      setShowToast(true);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setShowToast(false), 2000);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  // ── Section header totals ──────────────────────────────────────────────

  const entryTotals = txOrder.reduce((acc, id) => {
    const t = txMap[id];
    if (!t) return acc;
    return {
      pnt: acc.pnt + parseFloat(String(t.purchase_no_tax)),
      pvat: acc.pvat + parseFloat(String(t.purchase_tax_amount)),
      tp: acc.tp + parseFloat(String(t.total_purchase)),
      rnt: acc.rnt + parseFloat(String(t.resale_no_tax)),
      rvat: acc.rvat + parseFloat(String(t.resale_vat)),
      tr: acc.tr + parseFloat(String(t.total_resale)),
      mu: acc.mu + parseFloat(String(t.markup)),
    };
  }, { pnt: 0, pvat: 0, tp: 0, rnt: 0, rvat: 0, tr: 0, mu: 0 });

  const exitTotals = exOrder.reduce((acc, id) => {
    const e = exMap[id];
    if (!e) return acc;
    return {
      nv: acc.nv + parseFloat(String(e.total_sale_no_vat)),
      vat: acc.vat + parseFloat(String(e.vat_amount)),
      ts: acc.ts + parseFloat(String(e.total_sale)),
    };
  }, { nv: 0, vat: 0, ts: 0 });

  // ── Entry input row renderer ───────────────────────────────────────────

  const renderEntryInputCells = (
    row: EntryRow,
    onChange: (p: Partial<EntryRow>) => void,
    onAccept: () => void,
    onDelete: () => void,
    busy: boolean,
    isDraft: boolean,
  ) => {
    const preview = row.accepted ? row : { ...row, ...computeEntry(row) };
    const valid = entryValid(row);
    return (
      <>
        <td className={styles.td}>
          <SellerSearch sellers={counterparties}
            onSelect={s => onChange({ seller: s })}
            onSellerCreated={s => { setCounterparties(p => [...p, s]); onChange({ seller: s }); }} />
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
        {/* Purchase side */}
        <td className={styles.td}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`}
            type="number" min="0" step="0.01" value={row.purchase_no_tax}
            onChange={e => onChange({ purchase_no_tax: e.target.value })} placeholder="0.00" />
        </td>
        <td className={styles.td}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`}
            type="number" min="0" step="0.01" value={row.purchase_tax_amount}
            onChange={e => onChange({ purchase_tax_amount: e.target.value })} placeholder="0.00" />
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>
          {preview.c_total_purchase ? fmt(preview.c_total_purchase) : '—'}
        </td>
        {/* Resale side */}
        <td className={`${styles.td} ${styles.resaleCol}`}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`}
            type="number" min="0" step="0.01" value={row.total_resale}
            onChange={e => onChange({ total_resale: e.target.value })} placeholder="0.00"
            onKeyDown={e => { if (e.key === 'Enter' && valid) onAccept(); }} />
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed} ${styles.resaleCol}`}>
          {preview.c_resale_vat ? fmt(preview.c_resale_vat) : '—'}
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed} ${styles.resaleCol}`}>
          {preview.c_resale_no_tax ? fmt(preview.c_resale_no_tax) : '—'}
        </td>
        <td className={`${styles.td} ${styles.center}`}>
          <span className={styles.vatBadge}>{preview.c_vat_pct}</span>
        </td>
        <td className={`${styles.td} ${styles.center}`}>
          <div className={styles.rowActions}>
            <button className={styles.acceptBtn} onClick={onAccept} disabled={!valid || busy} title="Confirmă (Enter)">✓</button>
            <button className={styles.deleteRowBtn} onClick={onDelete} disabled={busy} title={isDraft ? 'Anulează (Esc)' : 'Șterge'}>✕</button>
          </div>
        </td>
      </>
    );
  };

  const renderEntryDisplayCells = (t: Transaction) => {
    const pn = parseFloat(String(t.purchase_no_tax));
    const tn = parseFloat(String(t.purchase_tax_amount));
    const vat = pn > 0 ? `${Math.round((tn / pn) * 100)}%` : '—';
    const cp = counterparties.find(c => c.id === t.seller_id);
    return (
      <>
        <td className={`${styles.td} ${styles.bold}`}>{cp?.name ?? '—'}</td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{cp?.tax_id ?? '—'}</td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{t.invoice_number ?? '—'}</td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{t.register_entry_number ?? '—'}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(t.purchase_no_tax)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(t.purchase_tax_amount)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(t.total_purchase)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.resaleCol}`}>{fmt(t.total_resale)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(t.resale_vat)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted} ${styles.resaleCol}`}>{fmt(t.resale_no_tax)}</td>
        <td className={`${styles.td} ${styles.center}`}><span className={styles.vatBadge}>{vat}</span></td>
        <td className={styles.td} />
      </>
    );
  };

  // ── Exit input row renderer ────────────────────────────────────────────

  const renderExitInputCells = (
    row: ExitRow,
    onChange: (p: Partial<ExitRow>) => void,
    onAccept: () => void,
    onDelete: () => void,
    busy: boolean,
    isDraft: boolean,
  ) => {
    const preview = row.accepted ? row : { ...row, ...computeExit(row) };
    const valid = exitValid(row);
    return (
      <>
        <td className={styles.td}>
          <SellerSearch sellers={counterparties}
            onSelect={s => onChange({ buyer: s })}
            onSellerCreated={s => { setCounterparties(p => [...p, s]); onChange({ buyer: s }); }} />
          {row.buyer && (
            <div className={styles.selectedSeller}>
              <span>{row.buyer.name}</span>
              <button className={styles.clearSeller} onClick={() => onChange({ buyer: null })}>×</button>
            </div>
          )}
        </td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{row.buyer?.tax_id ?? ''}</td>
        <td className={styles.td}>
          <input className={styles.cellInput} value={row.document}
            onChange={e => onChange({ document: e.target.value })} placeholder="—" />
        </td>
        <td className={styles.td}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`}
            type="number" min="0" step="0.01" value={row.total_sale}
            onChange={e => onChange({ total_sale: e.target.value })} placeholder="0.00"
            onKeyDown={e => { if (e.key === 'Enter' && valid) onAccept(); }} />
        </td>
        <td className={styles.td}>
          <input className={`${styles.cellInput} ${styles.right} ${styles.mono}`}
            type="number" min="0" step="0.01" value={row.vat_amount}
            onChange={e => onChange({ vat_amount: e.target.value })} placeholder="0.00" />
        </td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.computed}`}>
          {preview.c_no_vat ? fmt(preview.c_no_vat) : '—'}
        </td>
        <td className={`${styles.td} ${styles.center}`}>
          <div className={styles.rowActions}>
            <button className={styles.acceptBtn} onClick={onAccept} disabled={!valid || busy} title="Confirmă (Enter)">✓</button>
            <button className={styles.deleteRowBtn} onClick={onDelete} disabled={busy} title={isDraft ? 'Anulează (Esc)' : 'Șterge'}>✕</button>
          </div>
        </td>
      </>
    );
  };

  const renderExitDisplayCells = (e: Exit) => {
    const cp = counterparties.find(c => c.id === e.buyer_id);
    return (
      <>
        <td className={`${styles.td} ${styles.bold}`}>{cp?.name ?? '—'}</td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{cp?.tax_id ?? '—'}</td>
        <td className={`${styles.td} ${styles.mono} ${styles.muted}`}>{e.document_number ?? '—'}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(e.total_sale)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(e.vat_amount)}</td>
        <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(e.total_sale_no_vat)}</td>
        <td className={styles.td} />
      </>
    );
  };

  // ── JSX ────────────────────────────────────────────────────────────────

  const p = report;

  // Bottom totals data
  const prevT = p?.prev_totals;

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
              <span className={styles.stockValue}>{fmt(p.stock_end_of_day)} lei</span>
            </div>
          )}
          {locked ? (
            <button className={styles.editBtn} onClick={unlock}>✎ Editează</button>
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

      <div className={styles.sectionsWrap}>

        {/* ── ENTRIES SECTION ─────────────────────────────────────────── */}
        <div className={styles.section}>
          <button className={styles.sectionToggle} onClick={() => setEntriesOpen(o => !o)}>
            <span className={styles.sectionToggleLeft}>
              <span className={styles.sectionCaret}>{entriesOpen ? '▾' : '▸'}</span>
              <span className={styles.sectionTitle}>Intrări</span>
            </span>
            <span className={styles.sectionSummary}>
              <span className={styles.sumChip}>Cump. fără TVA <strong>{fmt(entryTotals.pnt)}</strong></span>
              <span className={styles.sumChip}>TVA <strong>{fmt(entryTotals.pvat)}</strong></span>
              <span className={styles.sumChip}>Total cump. <strong>{fmt(entryTotals.tp)}</strong></span>
              <span className={styles.sumDivider} />
              <span className={styles.sumChip}>Vânz. la preț achiz. fără TVA <strong>{fmt(entryTotals.rnt)}</strong></span>
              <span className={styles.sumChip}>TVA vânz. <strong>{fmt(entryTotals.rvat)}</strong></span>
              <span className={styles.sumChip}>Total vânz. la preț achiz. <strong>{fmt(entryTotals.tr)}</strong></span>
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
                    <th className={`${styles.th} ${styles.thActions}`}></th>
                  </tr>
                  <tr className={styles.subHeaderRow}>
                    <th colSpan={4} />
                    <th colSpan={3} className={`${styles.subHeader} ${styles.subHeaderPurchase}`}>CUMPĂRARE</th>
                    <th colSpan={4} className={`${styles.subHeader} ${styles.subHeaderResale}`}>LA PREȚUL DE VANZARE</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {txOrder.length === 0 && !draftEntry && (
                    <tr className={styles.emptyRow}><td colSpan={12}>
                      {locked ? 'Nicio intrare.' : 'Nicio intrare. Adaugă un rând.'}
                    </td></tr>
                  )}
                  {txOrder.map(id => {
                    const t = txMap[id];
                    const row = entryRows[id];
                    const busy = savingId === `tx-${id}`;
                    if (!t) return null;
                    if (!locked && row) {
                      return (
                        <tr key={id} className={`${styles.row} ${styles.editRow}`}>
                          {renderEntryInputCells(row, p => setEntryRows(prev => ({ ...prev, [id]: { ...prev[id], ...p } })),
                            () => acceptEntry(id), () => deleteEntry(id), busy, false)}
                        </tr>
                      );
                    }
                    return <tr key={id} className={styles.row}>{renderEntryDisplayCells(t)}</tr>;
                  })}
                  {!locked && draftEntry && (
                    <tr className={`${styles.row} ${styles.draftNew}`}>
                      {renderEntryInputCells(draftEntry, p => setDraftEntry(d => d ? { ...d, ...p } : d),
                        submitDraftEntry, () => setDraftEntry(null), saving, true)}
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className={styles.totalsRow}>
                    <td colSpan={4} className={styles.td}>
                      {!locked && (
                        <button className={`${styles.addRowBtn} ${draftEntry ? styles.addRowBtnDisabled : ''}`}
                          onClick={() => { if (!draftEntry) { setDraftEntry(emptyEntry()); setError(''); } }}
                          disabled={!!draftEntry}>
                          + Adaugă intrare
                        </button>
                      )}
                    </td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal}`}>{fmt(entryTotals.pnt)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted}`}>{fmt(entryTotals.pvat)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.bold}`}>{fmt(entryTotals.tp)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.bold} ${styles.resaleCol}`}>{fmt(entryTotals.tr)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted} ${styles.resaleCol}`}>{fmt(entryTotals.rvat)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted} ${styles.resaleCol}`}>{fmt(entryTotals.rnt)}</td>
                    <td className={styles.td} /><td className={styles.td} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* ── EXITS SECTION ───────────────────────────────────────────── */}
        <div className={styles.section}>
          <button className={styles.sectionToggle} onClick={() => setExitsOpen(o => !o)}>
            <span className={styles.sectionToggleLeft}>
              <span className={styles.sectionCaret}>{exitsOpen ? '▾' : '▸'}</span>
              <span className={styles.sectionTitle}>Ieșiri</span>
            </span>
            <span className={styles.sectionSummary}>
              <span className={styles.sumChip}>Fără TVA <strong>{fmt(exitTotals.nv)}</strong></span>
              <span className={styles.sumChip}>TVA <strong>{fmt(exitTotals.vat)}</strong></span>
              <span className={styles.sumChip}>Total vânzări <strong>{fmt(exitTotals.ts)}</strong></span>
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
                    <th className={`${styles.th} ${styles.thActions}`}></th>
                  </tr>
                </thead>
                <tbody>
                  {exOrder.length === 0 && !draftExit && (
                    <tr className={styles.emptyRow}><td colSpan={7}>
                      {locked ? 'Nicio ieșire.' : 'Nicio ieșire. Adaugă un rând.'}
                    </td></tr>
                  )}
                  {exOrder.map(id => {
                    const e = exMap[id];
                    const row = exitRows[id];
                    const busy = savingId === `ex-${id}`;
                    if (!e) return null;
                    if (!locked && row) {
                      return (
                        <tr key={id} className={`${styles.row} ${styles.exitEditRow}`}>
                          {renderExitInputCells(row, p => setExitRows(prev => ({ ...prev, [id]: { ...prev[id], ...p } })),
                            () => acceptExit(id), () => deleteExit(id), busy, false)}
                        </tr>
                      );
                    }
                    return <tr key={id} className={styles.row}>{renderExitDisplayCells(e)}</tr>;
                  })}
                  {!locked && draftExit && (
                    <tr className={`${styles.row} ${styles.draftNew}`}>
                      {renderExitInputCells(draftExit, p => setDraftExit(d => d ? { ...d, ...p } : d),
                        submitDraftExit, () => setDraftExit(null), saving, true)}
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className={styles.totalsRow}>
                    <td colSpan={3} className={styles.td}>
                      {!locked && (
                        <button className={`${styles.addRowBtn} ${draftExit ? styles.addRowBtnDisabled : ''}`}
                          onClick={() => { if (!draftExit) { setDraftExit(emptyExit()); setError(''); } }}
                          disabled={!!draftExit}>
                          + Adaugă ieșire
                        </button>
                      )}
                    </td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.bold}`}>{fmt(exitTotals.ts)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal} ${styles.muted}`}>{fmt(exitTotals.vat)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.totalVal}`}>{fmt(exitTotals.nv)}</td>
                    <td className={styles.td} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── BOTTOM TOTALS ────────────────────────────────────────────────── */}
      {p && (
        <div className={styles.bottomTotals}>
          {/* Previous day */}
          {prevT && (
            <div className={styles.totalsBlock}>
              <div className={styles.totalsBlockLabel}>Ziua anterioară</div>
              <div className={styles.totalsGrid}>
                <div className={styles.totalsCell}>
                  <span className={styles.totalsCellLabel}>Intrări fără TVA</span>
                  <span className={styles.totalsCellVal}>{fmt(prevT.purchase_no_tax)}</span>
                </div>
                <div className={styles.totalsCell}>
                  <span className={styles.totalsCellLabel}>TVA intrări</span>
                  <span className={styles.totalsCellVal}>{fmt(prevT.purchase_vat)}</span>
                </div>
                <div className={styles.totalsCell}>
                  <span className={styles.totalsCellLabel}>Total intrări</span>
                  <span className={`${styles.totalsCellVal} ${styles.bold}`}>{fmt(prevT.total_purchase)}</span>
                </div>
                <div className={styles.totalsDivider} />
                <div className={styles.totalsCell}>
                  <span className={styles.totalsCellLabel}>Ieșiri fără TVA</span>
                  <span className={styles.totalsCellVal}>{fmt(prevT.exit_no_vat)}</span>
                </div>
                <div className={styles.totalsCell}>
                  <span className={styles.totalsCellLabel}>TVA ieșiri</span>
                  <span className={styles.totalsCellVal}>{fmt(prevT.exit_vat)}</span>
                </div>
                <div className={styles.totalsCell}>
                  <span className={styles.totalsCellLabel}>Total ieșiri</span>
                  <span className={`${styles.totalsCellVal} ${styles.bold}`}>{fmt(prevT.total_exit)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Today */}
          <div className={`${styles.totalsBlock} ${styles.totalsBlockToday}`}>
            <div className={styles.totalsBlockLabel}>Ziua curentă</div>
            <div className={styles.totalsGrid}>
              <div className={styles.totalsCell}>
                <span className={styles.totalsCellLabel}>Intrări fără TVA</span>
                <span className={styles.totalsCellVal}>{fmt(p.total_purchase_no_tax)}</span>
              </div>
              <div className={styles.totalsCell}>
                <span className={styles.totalsCellLabel}>TVA intrări</span>
                <span className={styles.totalsCellVal}>{fmt(p.total_purchase_vat)}</span>
              </div>
              <div className={styles.totalsCell}>
                <span className={styles.totalsCellLabel}>Total intrări</span>
                <span className={`${styles.totalsCellVal} ${styles.bold}`}>{fmt(p.total_purchase)}</span>
              </div>
              <div className={styles.totalsDivider} />
              <div className={styles.totalsCell}>
                <span className={styles.totalsCellLabel}>Ieșiri fără TVA</span>
                <span className={styles.totalsCellVal}>{fmt(p.total_exit_no_vat)}</span>
              </div>
              <div className={styles.totalsCell}>
                <span className={styles.totalsCellLabel}>TVA ieșiri</span>
                <span className={styles.totalsCellVal}>{fmt(p.total_exit_vat)}</span>
              </div>
              <div className={styles.totalsCell}>
                <span className={styles.totalsCellLabel}>Total ieșiri</span>
                <span className={`${styles.totalsCellVal} ${styles.bold}`}>{fmt(p.total_exit)}</span>
              </div>
              <div className={styles.totalsDivider} />
              <div className={styles.totalsCell}>
                <span className={styles.totalsCellLabel}>Stoc anterior</span>
                <span className={styles.totalsCellVal}>{fmt(p.previous_stock)}</span>
              </div>
              <div className={styles.totalsCell}>
                <span className={styles.totalsCellLabel}>Stoc final</span>
                <span className={`${styles.totalsCellVal} ${styles.accentVal}`}>{fmt(p.stock_end_of_day)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {showToast && <div className={styles.toast}>✓ Ziua a fost salvată</div>}
    </div>
  );
}
