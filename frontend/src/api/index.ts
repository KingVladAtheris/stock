import type {
  Company, CompanyCreate, Counterparty, CounterpartyCreate,
  Product, ProductCreate, InventoryItem,
  Transaction, TransactionCreate, TransactionItemSchema, TransactionItemCreate,
  ExitRecord, ExitCreate, ExitItemSchema, ExitItemCreate,
  DailyReport, MonthlySummaryResponse, YearlySummaryResponse,
  Token, LoginRequest, RegisterRequest, UserOut,
} from '../types';

export const BASE = 'http://localhost:8000';

// ── Token storage ──────────────────────────────────────────────────────────

const TOKEN_KEY = 'auth_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ── Core fetch wrapper ─────────────────────────────────────────────────────

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    // Trigger a page reload so the app falls back to the login screen
    window.location.href = '/';
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ── Auth ───────────────────────────────────────────────────────────────────

export async function login(data: LoginRequest): Promise<Token> {
  const token = await req<Token>('/auth/login', { method: 'POST', body: JSON.stringify(data) });
  setToken(token.access_token);
  return token;
}

export async function register(data: RegisterRequest): Promise<Token> {
  const token = await req<Token>('/auth/register', { method: 'POST', body: JSON.stringify(data) });
  setToken(token.access_token);
  return token;
}

export function logout(): void {
  clearToken();
}

export const getMe = () => req<UserOut>('/auth/me');

// ── Companies ──────────────────────────────────────────────────────────────

export const getCompanies = () => req<Company[]>('/companies');
export const createCompany = (d: CompanyCreate) =>
  req<Company>('/companies', { method: 'POST', body: JSON.stringify(d) });
export const closeLedger = (cid: number, closed_date: string) =>
  req<Company>(`/companies/${cid}/close-ledger`, { method: 'PUT', body: JSON.stringify({ closed_date }) });
export const reopenLedger = (cid: number) =>
  req<Company>(`/companies/${cid}/close-ledger`, { method: 'DELETE' });

// ── Counterparties ─────────────────────────────────────────────────────────

export const getCounterparties = () => req<Counterparty[]>('/counterparties');
export const createCounterparty = (d: CounterpartyCreate) =>
  req<Counterparty>('/counterparties', { method: 'POST', body: JSON.stringify(d) });
export const getSellers = getCounterparties;
export const createSeller = createCounterparty;

// ── Products ───────────────────────────────────────────────────────────────

export const getProducts = (cid: number) => req<Product[]>(`/companies/${cid}/products`);
export const createProduct = (cid: number, d: ProductCreate) =>
  req<Product>(`/companies/${cid}/products`, { method: 'POST', body: JSON.stringify(d) });

// ── Inventory ──────────────────────────────────────────────────────────────

export const getInventory = (cid: number) => req<InventoryItem[]>(`/companies/${cid}/inventory`);

// ── Daily report ───────────────────────────────────────────────────────────

export const getDailyReport = (cid: number, day: string) =>
  req<DailyReport>(`/companies/${cid}/days/${day}`);

// ── Transactions ───────────────────────────────────────────────────────────

export const createTransaction = (cid: number, day: string, d: TransactionCreate) =>
  req<Transaction>(`/companies/${cid}/days/${day}/transactions`, { method: 'POST', body: JSON.stringify(d) });
export const updateTransaction = (cid: number, tid: number, d: TransactionCreate) =>
  req<Transaction>(`/companies/${cid}/transactions/${tid}`, { method: 'PUT', body: JSON.stringify(d) });

export const createTransactionItem = (cid: number, tid: number, d: TransactionItemCreate) =>
  req<TransactionItemSchema>(`/companies/${cid}/transactions/${tid}/items`, { method: 'POST', body: JSON.stringify(d) });
export const updateTransactionItem = (cid: number, itemId: number, d: TransactionItemCreate) =>
  req<TransactionItemSchema>(`/companies/${cid}/transaction-items/${itemId}`, { method: 'PUT', body: JSON.stringify(d) });
export const deleteTransactionItem = (cid: number, itemId: number) =>
  req<void>(`/companies/${cid}/transaction-items/${itemId}`, { method: 'DELETE' });

// ── Exits ──────────────────────────────────────────────────────────────────

export const createExit = (cid: number, day: string, d: ExitCreate) =>
  req<ExitRecord>(`/companies/${cid}/days/${day}/exits`, { method: 'POST', body: JSON.stringify(d) });
export const updateExit = (cid: number, eid: number, d: ExitCreate) =>
  req<ExitRecord>(`/companies/${cid}/exits/${eid}`, { method: 'PUT', body: JSON.stringify(d) });

export const createExitItem = (cid: number, eid: number, d: ExitItemCreate) =>
  req<ExitItemSchema>(`/companies/${cid}/exits/${eid}/items`, { method: 'POST', body: JSON.stringify(d) });
export const updateExitItem = (cid: number, itemId: number, d: ExitItemCreate) =>
  req<ExitItemSchema>(`/companies/${cid}/exit-items/${itemId}`, { method: 'PUT', body: JSON.stringify(d) });
export const deleteExitItem = (cid: number, itemId: number) =>
  req<void>(`/companies/${cid}/exit-items/${itemId}`, { method: 'DELETE' });

// ── Active days ────────────────────────────────────────────────────────────

export const getActiveDays = (cid: number) => req<string[]>(`/companies/${cid}/active-days`);

// ── Summaries ──────────────────────────────────────────────────────────────

export const getMonthlySummary = (cid: number, year: number, month: number) =>
  req<MonthlySummaryResponse>(`/companies/${cid}/summary/month/${year}/${month}`);
export const getYearlySummary = (cid: number, year: number) =>
  req<YearlySummaryResponse>(`/companies/${cid}/summary/year/${year}`);
