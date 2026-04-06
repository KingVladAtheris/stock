// src/pages/InventoryView.tsx
import { useEffect, useState } from 'react';
import type { Company, InventoryItem } from '../types';
import { getInventory } from '../api';
import { exportToPDF, exportToExcel, type ExportColumn, type ExportRow } from '../utils/exportUtils';
import styles from './Summary.module.css';
import invStyles from './InventoryView.module.css';

const fmt = (v: string | number) =>
  Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props { company: Company; onBack: () => void; }

const COLS: ExportColumn[] = [
  { header: 'Produs', key: 'name', align: 'left' },
  { header: 'Stoc total', key: 'total', align: 'right' },
];

export default function InventoryView({ company, onBack }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [textFilter, setTextFilter] = useState('');

  useEffect(() => {
    getInventory(company.id)
      .then(data => setItems(data.sort((a, b) => a.product_name.localeCompare(b.product_name))))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [company.id]);

  // Only show items with stock > 0, then apply text filter
  const shown = items
    .filter(i => parseFloat(i.stock_total) > 0)
    .filter(i => !textFilter.trim() || i.product_name.toLowerCase().includes(textFilter.toLowerCase()));

  const grandTotal = shown.reduce((acc, i) => acc + parseFloat(i.stock_total), 0);

  const exportRows: ExportRow[] = shown.map(i => ({
    name: i.product_name,
    total: fmt(i.stock_total),
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
          <button className={styles.exportBtn} onClick={() => handleExport('pdf')}>↓ PDF</button>
          <button className={styles.exportBtn} onClick={() => handleExport('excel')}>↓ Excel</button>
        </div>
      </header>

      <div className={invStyles.filterBar}>
        <input
          className={invStyles.filterInput}
          type="text"
          placeholder="Filtrează produse..."
          value={textFilter}
          onChange={e => setTextFilter(e.target.value)}
          autoFocus
        />
        {textFilter && (
          <button className={invStyles.filterClear} onClick={() => setTextFilter('')}>×</button>
        )}
        <span className={invStyles.filterCount}>
          {shown.length} {shown.length === 1 ? 'produs' : 'produse'}
        </span>
      </div>

      <div className={styles.tableWrap}>
        {loading && <div className={styles.empty}>Se încarcă...</div>}
        {error && <div className={styles.errorBar}>{error}</div>}
        {!loading && !error && shown.length === 0 && (
          <div className={styles.empty}>
            {textFilter ? 'Niciun produs nu corespunde filtrului.' : 'Inventarul este gol.'}
          </div>
        )}
        {!loading && shown.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.th} ${styles.left}`}>Produs</th>
                <th className={`${styles.th} ${styles.right} ${styles.stockCol}`}>Stoc total</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(i => (
                <tr key={i.product_id} className={styles.row}>
                  <td className={`${styles.td} ${styles.left} ${styles.label}`}>{i.product_name}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.stockCol} ${styles.bold}`}>
                    {fmt(i.stock_total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={styles.periodTotalsRow}>
                <td className={`${styles.td} ${styles.totalsLabel}`}>
                  Total inventar{textFilter ? ` (filtrat)` : ''}
                </td>
                <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.stockCol} ${styles.bold}`}>
                  {fmt(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
