// Auth
export interface UserOut { id: number; email: string; }
export interface Token { access_token: string; token_type: string; }
export interface LoginRequest { email: string; password: string; }
export interface RegisterRequest { email: string; password: string; }

// Company
export interface Company {
  id: number; name: string; tax_id: string; chamber_id?: string;
  opening_stock_no_vat: string; opening_stock_vat: string; opening_stock_total: string;
  ledger_closed_date?: string | null;
}
export interface CompanyCreate {
  name: string; tax_id: string; chamber_id?: string;
  opening_stock_no_vat: number; opening_stock_vat: number; opening_stock_total: number;
}
export interface Counterparty { id: number; name: string; tax_id: string; }
export type Seller = Counterparty;
export interface CounterpartyCreate { name: string; tax_id: string; }
export type SellerCreate = CounterpartyCreate;

export interface Product { id: number; company_id: number; name: string; }
export interface ProductCreate { name: string; }

export interface InventoryItem {
  product_id: number; product_name: string;
  stock_no_vat: string; stock_vat: string; stock_total: string;
}

export interface TransactionItemSchema {
  id: number; transaction_id: number; product_id: number; product?: Product;
  purchase_no_tax: string; purchase_tax_amount: string; total_purchase: string;
  tax_factor: number; total_resale: string;
  resale_no_tax: string; resale_vat: string; markup: string;
}
export interface TransactionItemCreate {
  product_id: number; purchase_no_tax: number;
  purchase_tax_amount: number; total_resale: number;
}

export interface Transaction {
  id: number; date: string; seller_id: number; seller?: Counterparty;
  invoice_number?: string; register_entry_number?: string;
  purchase_no_tax: string; purchase_tax_amount: string; total_purchase: string;
  total_resale: string; resale_no_tax: string; resale_vat: string; markup: string;
  items: TransactionItemSchema[];
}
export interface TransactionCreate {
  seller_id: number; invoice_number?: string; register_entry_number?: string;
}

export interface ExitItemSchema {
  id: number; exit_id: number; product_id: number; product?: Product;
  total_sale: string; vat_amount: string; total_sale_no_vat: string;
}
export interface ExitItemCreate { product_id: number; total_sale: number; vat_amount: number; }

export interface ExitRecord {
  id: number; date: string; buyer_id: number; buyer?: Counterparty;
  document_number?: string;
  total_sale: string; vat_amount: string; total_sale_no_vat: string;
  items: ExitItemSchema[];
}
export interface ExitCreate { buyer_id: number; document_number?: string; }

export interface StockTriple { no_vat: string; vat: string; total: string; }

export interface PeriodTotals {
  resale_no_tax: string; resale_vat: string; total_resale: string;
  exit_no_vat: string; exit_vat: string; total_exit: string;
}

export interface DailyReport {
  date: string;
  transactions: Transaction[];
  exits: ExitRecord[];
  total_purchase_no_tax: string; total_purchase_vat: string; total_purchase: string;
  total_resale_no_tax: string; total_resale_vat: string; total_resale: string;
  total_markup: string;
  total_exit_no_vat: string; total_exit_vat: string; total_exit: string;
  previous_stock: StockTriple; stock_end_of_day: StockTriple;
  prev_totals: PeriodTotals;
}

export interface DaySummary {
  date: string;
  total_purchase_no_tax: string; total_purchase_vat: string; total_purchase: string;
  total_resale_no_tax: string; total_resale_vat: string; total_resale: string;
  total_markup: string;
  total_exit_no_vat: string; total_exit_vat: string; total_exit: string;
  net_change_no_vat: string; net_change_vat: string; net_change: string;
  stock_no_vat: string; stock_vat: string; stock_total: string;
}

export interface MonthSummary {
  month: number; year: number;
  total_purchase_no_tax: string; total_purchase_vat: string; total_purchase: string;
  total_resale_no_tax: string; total_resale_vat: string; total_resale: string;
  total_markup: string;
  total_exit_no_vat: string; total_exit_vat: string; total_exit: string;
  net_change_no_vat: string; net_change_vat: string; net_change: string;
  stock_no_vat: string; stock_vat: string; stock_total: string;
}

export interface SummaryTotalsRow {
  purchase_no_tax: string; purchase_vat: string; total_purchase: string;
  resale_no_tax: string; resale_vat: string; total_resale: string;
  exit_no_vat: string; exit_vat: string; total_exit: string;
  stock_start_no_vat: string; stock_start_vat: string; stock_start: string;
  stock_end_no_vat: string; stock_end_vat: string; stock_end: string;
}

export interface MonthlySummaryResponse {
  rows: DaySummary[]; period_totals: SummaryTotalsRow; prev_totals: SummaryTotalsRow;
}
export interface YearlySummaryResponse {
  rows: MonthSummary[]; period_totals: SummaryTotalsRow; prev_totals: SummaryTotalsRow;
}
