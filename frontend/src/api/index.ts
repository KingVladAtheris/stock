import type {
  Company, CompanyCreate, Counterparty, CounterpartyCreate,
  Transaction, TransactionCreate, Exit, ExitCreate,
  DailyReport, MonthlySummaryResponse, YearlySummaryResponse,
} from '../types';

const BASE = 'http://localhost:8000';

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' }, ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const getCompanies = () => req<Company[]>('/companies');
export const createCompany = (data: CompanyCreate) =>
  req<Company>('/companies', { method: 'POST', body: JSON.stringify(data) });

export const getCounterparties = () => req<Counterparty[]>('/counterparties');
export const createCounterparty = (data: CounterpartyCreate) =>
  req<Counterparty>('/counterparties', { method: 'POST', body: JSON.stringify(data) });
// Compat aliases
export const getSellers = getCounterparties;
export const createSeller = createCounterparty;

export const createTransaction = (companyId: number, day: string, data: TransactionCreate) =>
  req<Transaction>(`/companies/${companyId}/days/${day}/transactions`, {
    method: 'POST', body: JSON.stringify(data),
  });

export const createExit = (companyId: number, day: string, data: ExitCreate) =>
  req<Exit>(`/companies/${companyId}/days/${day}/exits`, {
    method: 'POST', body: JSON.stringify(data),
  });

export const getActiveDays = (companyId: number) =>
  req<string[]>(`/companies/${companyId}/active-days`);

export const getDailyReport = (companyId: number, day: string) =>
  req<DailyReport>(`/companies/${companyId}/days/${day}`);

export const getMonthlySummary = (companyId: number, year: number, month: number) =>
  req<MonthlySummaryResponse>(`/companies/${companyId}/summary/month/${year}/${month}`);

export const getYearlySummary = (companyId: number, year: number) =>
  req<YearlySummaryResponse>(`/companies/${companyId}/summary/year/${year}`);
