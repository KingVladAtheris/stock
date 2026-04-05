// src/pages/MonthlySummary.tsx
import { useEffect, useState } from 'react';
import type { Company, DaySummary } from '../types';
import { getMonthlySummary } from '../api';
import { exportToPDF, exportToExcel, type ExportColumn, type ExportRow } from '../utils/exportUtils';
import styles from './Summary.module.css';

const MONTHS = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie',
                'Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];

const DAYS_RO = ['Duminică','Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă'];

const fmt = (v: string | number) =>
  Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDayId(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const [y, m, day] = iso.split('-');
  return `${day}/${m}/${y}, ${DAYS_RO[d.getDay()]}`;
}

interface Props {
  company: Company;
  year: number;
  month: number; // 1-12
  onBack: () => void;
}

const COLUMNS: ExportColumn[] = [
  { header: 'Data', key: 'label', align: 'left' },
  { header: 'Total cumpărări', key: 'total_purchase', align: 'right' },
  { header: 'Total vânzări (intrări)', key: 'total_resale', align: 'right' },
  { header: 'Adaos', key: 'total_markup', align: 'right' },
  { header: 'Vânzări casă', key: 'total_sale', align: 'right' },
  { header: 'Variație netă', key: 'net_change', align: 'right' },
  { header: 'Stoc final zi', key: 'stock_end_of_day', align: 'right' },
];

export default function MonthlySummary({ company, year, month, onBack }: Props) {
  const [rows, setRows] = useState<DaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    getMonthlySummary(company.id, year, month)
      .then(setRows)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [company.id, year, month]);

  const title = `${MONTHS[month - 1]} ${year}`;
  const subtitle = company.name;
  const filename = `${company.name}_${year}_${String(month).padStart(2,'0')}`;

  const exportRows: ExportRow[] = rows.map(r => ({
    label: formatDayId(r.date),
    total_purchase: fmt(r.total_purchase),
    total_resale: fmt(r.total_resale),
    total_markup: fmt(r.total_markup),
    total_sale: fmt(r.total_sale),
    net_change: fmt(r.net_change),
    stock_end_of_day: fmt(r.stock_end_of_day),
  }));

  const handleExport = (format: 'pdf' | 'excel') => {
    if (format === 'pdf') exportToPDF(title, subtitle, COLUMNS, exportRows, filename);
    else exportToExcel(title, COLUMNS, exportRows, filename);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={onBack}>← Înapoi</button>
          <div className={styles.titleBlock}>
            <span className={styles.mainTitle}>{title}</span>
            <span className={styles.subTitle}>{subtitle}</span>
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
        {!loading && !error && rows.length === 0 && (
          <div className={styles.empty}>Nu există date pentru această perioadă.</div>
        )}
        {!loading && rows.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.th} ${styles.left}`}>Data</th>
                <th className={`${styles.th} ${styles.right}`}>Total cumpărări</th>
                <th className={`${styles.th} ${styles.right}`}>Total vânzări (intrări)</th>
                <th className={`${styles.th} ${styles.right}`}>Adaos</th>
                <th className={`${styles.th} ${styles.right}`}>Vânzări casă</th>
                <th className={`${styles.th} ${styles.right}`}>Variație netă</th>
                <th className={`${styles.th} ${styles.right} ${styles.stockCol}`}>Stoc final zi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const nc = parseFloat(String(r.net_change));
                return (
                  <tr key={r.date} className={styles.row}>
                    <td className={`${styles.td} ${styles.left} ${styles.label}`}>{formatDayId(r.date)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(r.total_purchase)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono}`}>{fmt(r.total_resale)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.markup}`}>{fmt(r.total_markup)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.muted}`}>{fmt(r.total_sale)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${nc >= 0 ? styles.pos : styles.neg}`}>{fmt(r.net_change)}</td>
                    <td className={`${styles.td} ${styles.right} ${styles.mono} ${styles.stockCol} ${styles.bold}`}>{fmt(r.stock_end_of_day)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
