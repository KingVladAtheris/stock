import { useState } from 'react';
import type { Company } from './types';
import { getActiveDays } from './api';
import CompanySelect from './pages/CompanySelect';
import Calendar from './components/Calendar';
import DayView from './pages/DayView';
import MonthlySummary from './pages/MonthlySummary';
import YearlySummary from './pages/YearlySummary';
import InventoryView from './pages/InventoryView';
import './index.css';

type View = 'companies' | 'calendar' | 'day' | 'monthly' | 'yearly' | 'inventory';

export default function App() {
  const [view, setView]           = useState<View>('companies');
  const [company, setCompany]     = useState<Company | null>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [activeDays, setActiveDays]     = useState<Set<string>>(new Set());
  const [summaryYear, setSummaryYear]   = useState(0);
  const [summaryMonth, setSummaryMonth] = useState(0);

  const refreshActiveDays = async (cid: number) => {
    const days = await getActiveDays(cid);
    setActiveDays(new Set(days));
  };

  const selectCompany = async (c: Company) => {
    setCompany(c);
    await refreshActiveDays(c.id);
    setView('calendar');
  };

  const backToCalendar = async () => {
    if (company) await refreshActiveDays(company.id);
    setView('calendar');
  };

  if (view === 'companies') return <CompanySelect onSelect={selectCompany} />;

  if (view === 'calendar' && company) return (
    <Calendar
      companyName={company.name}
      activeDays={activeDays}
      onDayClick={d => { setSelectedDate(d); setView('day'); }}
      onBack={() => setView('companies')}
      onMonthSummary={(y,m) => { setSummaryYear(y); setSummaryMonth(m); setView('monthly'); }}
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
