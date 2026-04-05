import type { Company, CompanyCreate, Seller, SellerCreate, Transaction, TransactionCreate, DailyReport } from '../types';

const BASE = 'http://localhost:8000';

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// Companies
export const getCompanies = () => req<Company[]>('/companies');
export const createCompany = (data: CompanyCreate) =>
  req<Company>('/companies', { method: 'POST', body: JSON.stringify(data) });

// Sellers
export const getSellers = () => req<Seller[]>('/sellers');
export const createSeller = (data: SellerCreate) =>
  req<Seller>('/sellers', { method: 'POST', body: JSON.stringify(data) });

// Transactions
export const getTransactions = (companyId: number, day: string) =>
  req<Transaction[]>(`/companies/${companyId}/days/${day}/transactions`);
export const createTransaction = (companyId: number, day: string, data: TransactionCreate) =>
  req<Transaction>(`/companies/${companyId}/days/${day}/transactions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

// Daily sales
export const setTotalSale = (companyId: number, day: string, total_sale: number) =>
  req(`/companies/${companyId}/days/${day}/total-sale`, {
    method: 'PUT',
    body: JSON.stringify({ total_sale }),
  });

// Active days
export const getActiveDays = (companyId: number) =>
  req<string[]>(`/companies/${companyId}/active-days`);

// Daily report
export const getDailyReport = (companyId: number, day: string) =>
  req<DailyReport>(`/companies/${companyId}/days/${day}`);
