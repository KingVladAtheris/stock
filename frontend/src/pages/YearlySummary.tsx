// src/pages/YearlySummary.tsx
import { useEffect, useState } from 'react';
import type { Company, YearlySummaryResponse, SummaryTotalsRow } from '../types';
import { getYearlySummary } from '../api';
import { exportToPDF, exportToExcel, type ExportColumn, type ExportRow } from '../utils/exportUtils';
import styles from './Summary.module.css';

const MONTHS = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie',
                'Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];

const fmt = (v: string | number) =>
  Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props { company: Company; year: number; onBack: () => void; }

const COLS: ExportColumn[] = [
  { header: 'Lună', key: 'label', align: 'left' },
  { header: 'Intr. fără TVA', key: 'tp_nt', align: 'right' },
  { header: 'TVA intr.', key: 'tp_vat', align: 'right' },
  { header: 'Total intr.', key: 'tp', align: 'right' },
  { header: 'Ies. fără TVA', key: 'ex_nt', align: 'right' },
  { header: 'TVA ies.', key: 'ex_vat', align: 'right' },
  { header: 'Total ies.', key: 'ex', align: 'right' },
  { header: 'Stoc final lună', key: 'stock', align: 'right' },
];

function TotalsRow({ label, row, prev }: { label: string; row: SummaryTotalsRow; prev?: boolean }) {
  return (
    <tr className={prev ? styles.prevTotalsRow : styles.periodTotalsRow}>
      <td className={`${styles.td} ${styles.totalsLabel}`}>{label}</td>
      <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(row.purchase_no_tax)}</td>
      <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(row.purchase_vat)}</td>
      <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(row.total_purchase)}</td>
      <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(row.exit_no_vat)}</td>
      <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(row.exit_vat)}</td>
      <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(row.total_exit)}</td>
      <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.stockCol} ${styles.bold}`}>{fmt(row.stock_end)}</td>
    </tr>
  );
}

export default function YearlySummary({ company, year, onBack }: Props) {
  const [data, setData] = useState<YearlySummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    getYearlySummary(company.id, year)
      .then(setData).catch(e => setError((e as Error).message)).finally(() => setLoading(false));
  }, [company.id, year]);

  const title = `Rezumat anual ${year}`;
  const filename = `${company.name}_${year}`;

  const exportRows: ExportRow[] = (data?.rows ?? []).map(r => ({
    label: `${MONTHS[r.month - 1]} ${r.year}`,
    tp_nt: fmt(r.total_purchase_no_tax), tp_vat: fmt(r.total_purchase_vat), tp: fmt(r.total_purchase),
    ex_nt: fmt(r.total_exit_no_vat), ex_vat: fmt(r.total_exit_vat), ex: fmt(r.total_exit),
    stock: fmt(r.stock_end_of_month),
  }));

  const handleExport = (f: 'pdf' | 'excel') => {
    if (f === 'pdf') exportToPDF(title, company.name, COLS, exportRows, filename);
    else exportToExcel(title, COLS, exportRows, filename);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={onBack}>← Înapoi</button>
          <div className={styles.titleBlock}>
            <span className={styles.mainTitle}>{title}</span>
            <span className={styles.subTitle}>{company.name}</span>
          </div>
        </div>
        <div className={styles.headerRight}>
          <button className={styles.exportBtn} onClick={() => handleExport('pdf')}>↓ PDF</button>
          <button className={styles.exportBtn} onClick={() => handleExport('excel')}>↓ Excel</button>
        </div>
      </header>

      <div className={styles.tableWrap}>
        {loading && <div className={styles.empty}>Se încarcă...</div>}
        {error && <div className={styles.errorBar}>{error}</div>}
        {!loading && !error && (!data || data.rows.length === 0) && (
          <div className={styles.empty}>Nu există date pentru acest an.</div>
        )}
        {!loading && data && data.rows.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.th} ${styles.left}`}>Lună</th>
                <th className={`${styles.th} ${styles.right}`}>Intr. fără TVA</th>
                <th className={`${styles.th} ${styles.right}`}>TVA intr.</th>
                <th className={`${styles.th} ${styles.right}`}>Total intr.</th>
                <th className={`${styles.th} ${styles.right}`}>Ies. fără TVA</th>
                <th className={`${styles.th} ${styles.right}`}>TVA ies.</th>
                <th className={`${styles.th} ${styles.right}`}>Total ies.</th>
                <th className={`${styles.th} ${styles.right} ${styles.stockCol}`}>Stoc final lună</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map(r => (
                <tr key={`${r.year}-${r.month}`} className={styles.row}>
                  <td className={`${styles.td} ${styles.left} ${styles.label}`}>{MONTHS[r.month - 1]} {r.year}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(r.total_purchase_no_tax)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(r.total_purchase_vat)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(r.total_purchase)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(r.total_exit_no_vat)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(r.total_exit_vat)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.bold}`}>{fmt(r.total_exit)}</td>
                  <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.stockCol} ${styles.bold}`}>{fmt(r.stock_end_of_month)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <TotalsRow label={`${year - 1} (total)`} row={data.prev_totals} prev />
              <TotalsRow label={`${year} (total)`} row={data.period_totals} />
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
