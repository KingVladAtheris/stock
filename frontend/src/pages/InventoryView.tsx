// src/pages/InventoryView.tsx
import { useEffect, useState } from 'react';
import type { Company, InventoryItem } from '../types';
import { getInventory } from '../api';
import { exportToPDF, exportToExcel, type ExportColumn, type ExportRow } from '../utils/exportUtils';
import styles from './Summary.module.css';

const fmt = (v: string | number) =>
  Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props { company: Company; onBack: () => void; }

const COLS: ExportColumn[] = [
  { header: 'Produs', key: 'name', align: 'left' },
  { header: 'Stoc fără TVA', key: 'no_vat', align: 'right' },
  { header: 'TVA', key: 'vat', align: 'right' },
  { header: 'Stoc total', key: 'total', align: 'right' },
];

export default function InventoryView({ company, onBack }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'positive'>('positive');

  useEffect(() => {
    getInventory(company.id)
      .then(data => setItems(data.sort((a,b) => a.product_name.localeCompare(b.product_name))))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [company.id]);

  const shown = filter === 'positive'
    ? items.filter(i => parseFloat(i.stock_total) > 0)
    : items;

  const totals = shown.reduce((acc, i) => ({
    no_vat: acc.no_vat + parseFloat(i.stock_no_vat),
    vat:    acc.vat    + parseFloat(i.stock_vat),
    total:  acc.total  + parseFloat(i.stock_total),
  }), { no_vat: 0, vat: 0, total: 0 });

  const exportRows: ExportRow[] = shown.map(i => ({
    name: i.product_name,
    no_vat: fmt(i.stock_no_vat),
    vat:    fmt(i.stock_vat),
    total:  fmt(i.stock_total),
  }));

  const handleExport = (f: 'pdf' | 'excel') => {
    const title = `Inventar — ${company.name}`;
    const filename = `${company.name}_inventar`;
    if (f === 'pdf') exportToPDF(title, new Date().toLocaleDateString('ro-RO'), COLS, exportRows, filename);
    else exportToExcel('Inventar', COLS, exportRows, filename);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={onBack}>← Înapoi</button>
          <div className={styles.titleBlock}>
            <span className={styles.mainTitle}>Inventar</span>
            <span className={styles.subTitle}>{company.name}</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <select
            style={{ fontSize: 12, padding: '5px 10px', border: '1px solid #3a3937', borderRadius: 6, background: 'transparent', color: 'var(--chrome-muted)', cursor: 'pointer' }}
            value={filter}
            onChange={e => setFilter(e.target.value as 'all' | 'positive')}
          >
            <option value="positive">Doar în stoc</option>
            <option value="all">Toate produsele</option>
          </select>
          <button className={styles.exportBtn} onClick={() => handleExport('pdf')}>↓ PDF</button>
          <button className={styles.exportBtn} onClick={() => handleExport('excel')}>↓ Excel</button>
        </div>
      </header>

      <div className={styles.tableWrap}>
        {loading && <div className={styles.empty}>Se încarcă...</div>}
        {error && <div className={styles.errorBar}>{error}</div>}
        {!loading && !error && shown.length === 0 && (
          <div className={styles.empty}>
            {filter === 'positive' ? 'Inventarul este gol.' : 'Niciun produs înregistrat.'}
          </div>
        )}
        {!loading && shown.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.th} ${styles.left}`}>Produs</th>
                <th className={`${styles.th} ${styles.right}`}>Stoc fără TVA</th>
                <th className={`${styles.th} ${styles.right}`}>TVA</th>
                <th className={`${styles.th} ${styles.right} ${styles.stockCol}`}>Stoc total</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(i => {
                const isLow = parseFloat(i.stock_total) <= 0;
                return (
                  <tr key={i.product_id} className={styles.row}>
                    <td className={`${styles.td} ${styles.left} ${styles.label}`}>{i.product_name}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${isLow ? styles.neg : ''}`}>{fmt(i.stock_no_vat)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(i.stock_vat)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.stockCol} ${styles.bold} ${isLow ? styles.neg : ''}`}>{fmt(i.stock_total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={styles.periodTotalsRow}>
                <td className={`${styles.td} ${styles.totalsLabel}`}>Total inventar</td>
                <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(totals.no_vat)}</td>
                <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(totals.vat)}</td>
                <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.stockCol} ${styles.bold}`}>{fmt(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
