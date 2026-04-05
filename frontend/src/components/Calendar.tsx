import { useState } from 'react';
import type { DailyReport } from '../types';
import styles from './Calendar.module.css';

interface Props {
  companyName: string;
  activeDays: Set<string>; // ISO date strings that have data
  onDayClick: (date: string) => void;
  onBack: () => void;
}

const MONTHS = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];
const DAYS = ['Lu','Ma','Mi','Jo','Vi','Sâ','Du'];

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export default function Calendar({ companyName, activeDays, onDayClick, onBack }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  // Convert Sunday=0 to Monday=0
  const startOffset = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate());

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backBtn} onClick={onBack}>← Companii</button>
          <div className={styles.companyName}>{companyName}</div>
        </div>
        <div className={styles.nav}>
          <button className={styles.navBtn} onClick={prevMonth}>‹</button>
          <span className={styles.monthLabel}>{MONTHS[month]} {year}</span>
          <button className={styles.navBtn} onClick={nextMonth}>›</button>
        </div>
      </header>

      <div className={styles.calendarWrap}>
        <div className={styles.dayHeaders}>
          {DAYS.map(d => <div key={d} className={styles.dayHeader}>{d}</div>)}
        </div>

        <div className={styles.grid}>
          {cells.map((day, i) => {
            if (!day) return <div key={i} className={styles.cellEmpty} />;
            const iso = isoDate(year, month, day);
            const hasData = activeDays.has(iso);
            const isToday = iso === todayIso;
            return (
              <button
                key={i}
                className={`${styles.cell} ${hasData ? styles.cellActive : styles.cellInactive} ${isToday ? styles.cellToday : ''}`}
                onClick={() => onDayClick(iso)}
              >
                <span className={styles.dayNum}>{day}</span>
                {hasData && <span className={styles.dot} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.legendDotActive}`} /> Zi cu date</span>
        <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.legendDotEmpty}`} /> Zi fără date</span>
      </div>
    </div>
  );
}
