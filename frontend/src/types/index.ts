export interface Company {
  id: number; name: string; tax_id: string;
  chamber_id?: string; opening_stock: string;
}
export interface CompanyCreate {
  name: string; tax_id: string; chamber_id?: string; opening_stock: number;
}
export interface Counterparty {
  id: number; name: string; tax_id: string;
}
export type Seller = Counterparty;
export interface CounterpartyCreate { name: string; tax_id: string; }
export type SellerCreate = CounterpartyCreate;

export interface Transaction {
  id: number; date: string; seller_id: number; seller?: Counterparty;
  invoice_number?: string; register_entry_number?: string;
  purchase_no_tax: string; purchase_tax_amount: string; total_purchase: string;
  tax_factor: number; total_resale: string;
  resale_no_tax: string; resale_vat: string; markup: string;
}
export interface TransactionCreate {
  seller_id: number; invoice_number?: string; register_entry_number?: string;
  purchase_no_tax: number; purchase_tax_amount: number; total_resale: number;
}

export interface Exit {
  id: number; date: string; buyer_id: number; buyer?: Counterparty;
  document_number?: string;
  total_sale: string; vat_amount: string; total_sale_no_vat: string;
}
export interface ExitCreate {
  buyer_id: number; document_number?: string;
  total_sale: number; vat_amount: number;
}

export interface PeriodTotals {
  purchase_no_tax: string; purchase_vat: string; total_purchase: string;
  exit_no_vat: string; exit_vat: string; total_exit: string;
}

export interface DailyReport {
  date: string;
  transactions: Transaction[];
  exits: Exit[];
  total_purchase_no_tax: string; total_purchase_vat: string; total_purchase: string;
  total_resale_no_tax: string; total_resale_vat: string; total_resale: string;
  total_markup: string;
  total_exit_no_vat: string; total_exit_vat: string; total_exit: string;
  net_inventory_change: string;
  stock_end_of_day: string; previous_stock: string;
  prev_totals: PeriodTotals;
}

export interface DaySummary {
  date: string;
  total_purchase_no_tax: string; total_purchase_vat: string; total_purchase: string;
  total_resale_no_tax: string; total_resale_vat: string; total_resale: string;
  total_markup: string;
  total_exit_no_vat: string; total_exit_vat: string; total_exit: string;
  net_change: string; stock_end_of_day: string;
}

export interface MonthSummary {
  month: number; year: number;
  total_purchase_no_tax: string; total_purchase_vat: string; total_purchase: string;
  total_resale_no_tax: string; total_resale_vat: string; total_resale: string;
  total_markup: string;
  total_exit_no_vat: string; total_exit_vat: string; total_exit: string;
  net_change: string; stock_end_of_month: string;
}

export interface SummaryTotalsRow {
  purchase_no_tax: string; purchase_vat: string; total_purchase: string;
  resale_no_tax: string; resale_vat: string; total_resale: string;
  exit_no_vat: string; exit_vat: string; total_exit: string;
  stock_start: string; stock_end: string;
}

export interface MonthlySummaryResponse {
  rows: DaySummary[];
  period_totals: SummaryTotalsRow;
  prev_totals: SummaryTotalsRow;
}

export interface YearlySummaryResponse {
  rows: MonthSummary[];
  period_totals: SummaryTotalsRow;
  prev_totals: SummaryTotalsRow;
}
