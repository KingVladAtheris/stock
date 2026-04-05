import { useState } from 'react';
import type { Company } from './types';
import { getActiveDays } from './api';
import CompanySelect from './pages/CompanySelect';
import Calendar from './components/Calendar';
import DayView from './pages/DayView';
import './index.css';

type View = 'companies' | 'calendar' | 'day';

export default function App() {
  const [view, setView] = useState<View>('companies');
  const [company, setCompany] = useState<Company | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [activeDays, setActiveDays] = useState<Set<string>>(new Set());

  const refreshActiveDays = async (companyId: number) => {
    const days = await getActiveDays(companyId);
    setActiveDays(new Set(days));
  };

  const selectCompany = async (c: Company) => {
    setCompany(c);
    await refreshActiveDays(c.id);
    setView('calendar');
  };

  const selectDay = (date: string) => {
    setSelectedDate(date);
    setView('day');
  };

  // Re-fetch active days when returning from DayView so any newly entered
  // transactions immediately darken the calendar cell.
  const backToCalendar = async () => {
    if (company) await refreshActiveDays(company.id);
    setView('calendar');
  };

  if (view === 'companies') {
    return <CompanySelect onSelect={selectCompany} />;
  }

  if (view === 'calendar' && company) {
    return (
      <Calendar
        companyName={company.name}
        activeDays={activeDays}
        onDayClick={selectDay}
        onBack={() => setView('companies')}
      />
    );
  }

  if (view === 'day' && company && selectedDate) {
    return (
      <DayView
        company={company}
        date={selectedDate}
        onBack={backToCalendar}
      />
    );
  }

  return null;
}
