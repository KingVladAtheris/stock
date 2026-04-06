// src/components/Calendar.tsx
import { useState } from 'react';
import styles from './Calendar.module.css';

interface Props {
  companyName: string;
  activeDays: Set<string>;
  onDayClick: (date: string) => void;
  onBack: () => void;
  onMonthSummary: (year: number, month: number) => void;
  onYearSummary: (year: number) => void;
  onInventory: () => void;
}

const MONTHS = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie'];
const DAYS   = ['Lu','Ma','Mi','Jo','Vi','Sâ','Du'];

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

type PickerMode = 'month' | 'year' | null;

export default function Calendar({ companyName, activeDays, onDayClick, onBack, onMonthSummary, onYearSummary, onInventory }: Props) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [pickerMode, setPickerMode]   = useState<PickerMode>(null);
  const [pickerYear, setPickerYear]   = useState(today.getFullYear());
  const [pickerMonth, setPickerMonth] = useState(today.getMonth() + 1);

  const firstDay   = new Date(year, month, 1).getDay();
  const startOffset = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso    = isoDate(today.getFullYear(), today.getMonth(), today.getDate());

  const cells: (number|null)[] = [...Array(startOffset).fill(null), ...Array.from({length: daysInMonth}, (_,i) => i+1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => { if (month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); };
  const nextMonth = () => { if (month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); };
  const yearOptions = Array.from({length:10},(_,i)=>today.getFullYear()-i);

  const confirmPicker = () => {
    if (pickerMode==='month') onMonthSummary(pickerYear, pickerMonth);
    else if (pickerMode==='year') onYearSummary(pickerYear);
    setPickerMode(null);
  };

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
        <div className={styles.dayHeaders}>{DAYS.map(d=><div key={d} className={styles.dayHeader}>{d}</div>)}</div>
        <div className={styles.grid}>
          {cells.map((day,i) => {
            if (!day) return <div key={i} className={styles.cellEmpty}/>;
            const iso = isoDate(year, month, day);
            const hasData = activeDays.has(iso);
            return (
              <button key={i}
                className={`${styles.cell} ${hasData?styles.cellActive:styles.cellInactive} ${iso===todayIso?styles.cellToday:''}`}
                onClick={() => onDayClick(iso)}>
                <span className={styles.dayNum}>{day}</span>
                {hasData && <span className={styles.dot}/>}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.summaryPanel}>
        <span className={styles.summaryPanelLabel}>Rapoarte</span>
        <div className={styles.summaryBtns}>
          <button className={styles.summaryBtn} onClick={() => { setPickerYear(today.getFullYear()); setPickerMonth(today.getMonth()+1); setPickerMode('month'); }}>
            <span className={styles.summaryBtnIcon}>📅</span> Lunar
          </button>
          <button className={styles.summaryBtn} onClick={() => { setPickerYear(today.getFullYear()); setPickerMode('year'); }}>
            <span className={styles.summaryBtnIcon}>📊</span> Anual
          </button>
          <button className={styles.summaryBtn} onClick={onInventory}>
            <span className={styles.summaryBtnIcon}>📦</span> Inventar
          </button>
        </div>
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.legendDotActive}`}/> Zi cu date</span>
        <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.legendDotEmpty}`}/> Zi fără date</span>
      </div>

      {pickerMode && (
        <div className={styles.pickerBackdrop} onClick={e => e.target===e.currentTarget && setPickerMode(null)}>
          <div className={styles.pickerModal}>
            <h3 className={styles.pickerTitle}>{pickerMode==='month'?'Selectează luna':'Selectează anul'}</h3>
            {pickerMode==='month' && (
              <div className={styles.pickerField}>
                <label className={styles.pickerLabel}>Luna</label>
                <select className={styles.pickerSelect} value={pickerMonth} onChange={e=>setPickerMonth(Number(e.target.value))}>
                  {MONTHS.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
                </select>
              </div>
            )}
            <div className={styles.pickerField}>
              <label className={styles.pickerLabel}>Anul</label>
              <select className={styles.pickerSelect} value={pickerYear} onChange={e=>setPickerYear(Number(e.target.value))}>
                {yearOptions.map(y=><option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className={styles.pickerActions}>
              <button className={styles.pickerCancel} onClick={()=>setPickerMode(null)}>Anulare</button>
              <button className={styles.pickerConfirm} onClick={confirmPicker}>Vezi raportul</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
