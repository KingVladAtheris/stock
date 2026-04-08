import { useState, useEffect } from 'react';
import type { Company } from './types';
import { getToken, logout, getActiveDays, closeLedger, reopenLedger } from './api';
import AuthPage from './pages/AuthPage';
import CompanySelect from './pages/CompanySelect';
import Calendar from './components/Calendar';
import DayView from './pages/DayView';
import MonthlySummary from './pages/MonthlySummary';
import YearlySummary from './pages/YearlySummary';
import InventoryView from './pages/InventoryView';
import './index.css';

type View = 'companies' | 'calendar' | 'day' | 'monthly' | 'yearly' | 'inventory';

export default function App() {
  // Auth gate — token presence is the source of truth
  const [authed, setAuthed] = useState<boolean>(() => !!getToken());

  const [view,         setView]         = useState<View>('companies');
  const [company,      setCompany]      = useState<Company | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [activeDays,   setActiveDays]   = useState<Set<string>>(new Set());
  const [summaryYear,  setSummaryYear]  = useState(0);
  const [summaryMonth, setSummaryMonth] = useState(0);

  // If token disappears (e.g. cleared by 401 handler), drop back to auth screen
  useEffect(() => {
    const interval = setInterval(() => {
      if (!getToken() && authed) { setAuthed(false); setView('companies'); setCompany(null); }
    }, 2000);
    return () => clearInterval(interval);
  }, [authed]);

  if (!authed) {
    return <AuthPage onAuth={() => setAuthed(true)} />;
  }

  const handleLogout = () => { logout(); setAuthed(false); setView('companies'); setCompany(null); };

  const refreshActiveDays = async (cid: number) => {
    const days = await getActiveDays(cid);
    setActiveDays(new Set(days));
  };

  const selectCompany = async (c: Company) => {
    setCompany(c);
    await refreshActiveDays(c.id);
    setView('calendar');
  };

  // Keep company object fresh after ledger changes
  const updateCompany = (updated: Company) => setCompany(updated);

  const backToCalendar = async () => {
    if (company) await refreshActiveDays(company.id);
    setView('calendar');
  };

  if (view === 'companies') return (
    <CompanySelect onSelect={selectCompany} onLogout={handleLogout} />
  );

  if (view === 'calendar' && company) return (
    <Calendar
      company={company}
      activeDays={activeDays}
      onDayClick={d => { setSelectedDate(d); setView('day'); }}
      onBack={() => setView('companies')}
      onMonthSummary={(y, m) => { setSummaryYear(y); setSummaryMonth(m); setView('monthly'); }}
      onYearSummary={y => { setSummaryYear(y); setView('yearly'); }}
      onInventory={() => setView('inventory')}
    />
  );

  if (view === 'day' && company && selectedDate) return (
    <DayView company={company} date={selectedDate} onBack={backToCalendar} />
  );

  if (view === 'monthly' && company) return (
    <MonthlySummary company={company} year={summaryYear} month={summaryMonth} onBack={backToCalendar} />
  );

  if (view === 'yearly' && company) return (
    <YearlySummary company={company} year={summaryYear} onBack={backToCalendar} />
  );

  if (view === 'inventory' && company) return (
    <InventoryView company={company} onBack={backToCalendar} />
  );

  return null;
}
