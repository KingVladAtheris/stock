import type {
  Company, CompanyCreate, Counterparty, CounterpartyCreate,
  Product, ProductCreate, InventoryItem,
  Transaction, TransactionCreate, TransactionItemSchema, TransactionItemCreate,
  ExitRecord, ExitCreate, ExitItemSchema, ExitItemCreate,
  DailyReport, MonthlySummaryResponse, YearlySummaryResponse,
} from '../types';

export const BASE = 'http://localhost:8000';

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

// Companies
export const getCompanies = () => req<Company[]>('/companies');
export const createCompany = (d: CompanyCreate) =>
  req<Company>('/companies', { method: 'POST', body: JSON.stringify(d) });

// Counterparties
export const getCounterparties = () => req<Counterparty[]>('/counterparties');
export const createCounterparty = (d: CounterpartyCreate) =>
  req<Counterparty>('/counterparties', { method: 'POST', body: JSON.stringify(d) });
export const getSellers = getCounterparties;
export const createSeller = createCounterparty;

// Products
export const getProducts = (cid: number) => req<Product[]>(`/companies/${cid}/products`);
export const createProduct = (cid: number, d: ProductCreate) =>
  req<Product>(`/companies/${cid}/products`, { method: 'POST', body: JSON.stringify(d) });

// Inventory
export const getInventory = (cid: number) => req<InventoryItem[]>(`/companies/${cid}/inventory`);

// Transactions
export const getDailyReport = (cid: number, day: string) =>
  req<DailyReport>(`/companies/${cid}/days/${day}`);
export const createTransaction = (cid: number, day: string, d: TransactionCreate) =>
  req<Transaction>(`/companies/${cid}/days/${day}/transactions`, { method: 'POST', body: JSON.stringify(d) });

// Transaction items
export const createTransactionItem = (cid: number, tid: number, d: TransactionItemCreate) =>
  req<TransactionItemSchema>(`/companies/${cid}/transactions/${tid}/items`, { method: 'POST', body: JSON.stringify(d) });
export const deleteTransactionItem = (cid: number, itemId: number) =>
  fetch(`${BASE}/companies/${cid}/transaction-items/${itemId}`, { method: 'DELETE' });

// Exits
export const createExit = (cid: number, day: string, d: ExitCreate) =>
  req<ExitRecord>(`/companies/${cid}/days/${day}/exits`, { method: 'POST', body: JSON.stringify(d) });

// Exit items
export const createExitItem = (cid: number, eid: number, d: ExitItemCreate) =>
  req<ExitItemSchema>(`/companies/${cid}/exits/${eid}/items`, { method: 'POST', body: JSON.stringify(d) });
export const deleteExitItem = (cid: number, itemId: number) =>
  fetch(`${BASE}/companies/${cid}/exit-items/${itemId}`, { method: 'DELETE' });

// Active days
export const getActiveDays = (cid: number) => req<string[]>(`/companies/${cid}/active-days`);

// Summaries
export const getMonthlySummary = (cid: number, year: number, month: number) =>
  req<MonthlySummaryResponse>(`/companies/${cid}/summary/month/${year}/${month}`);
export const getYearlySummary = (cid: number, year: number) =>
  req<YearlySummaryResponse>(`/companies/${cid}/summary/year/${year}`);
