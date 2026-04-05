export interface Company {
  id: number;
  name: string;
  tax_id: string;
  chamber_id?: string;
  opening_stock: string;
}

export interface CompanyCreate {
  name: string;
  tax_id: string;
  chamber_id?: string;
  opening_stock: number;
}

export interface Seller {
  id: number;
  name: string;
  tax_id: string;
}

export interface SellerCreate {
  name: string;
  tax_id: string;
}

export interface Transaction {
  id: number;
  date: string;
  seller_id: number;
  seller?: Seller;
  invoice_number?: string;
  register_entry_number?: string;
  purchase_no_tax: string;
  purchase_tax_amount: string;
  total_purchase: string;
  tax_factor: number;
  total_resale: string;
  resale_no_tax: string;
  markup: string;
}

export interface TransactionCreate {
  seller_id: number;
  invoice_number?: string;
  register_entry_number?: string;
  purchase_no_tax: number;
  purchase_tax_amount: number;
  total_resale: number;
}

export interface DailyReport {
  date: string;
  transactions: Transaction[];
  total_purchase: string;
  total_resale: string;
  total_markup: string;
  total_sale_input: string;
  net_inventory_change: string;
  stock_end_of_day: string;
  previous_stock: string;
}

export interface DaySummary {
  date: string;           // "YYYY-MM-DD"
  total_purchase: string;
  total_resale: string;
  total_markup: string;
  total_sale: string;
  net_change: string;
  stock_end_of_day: string;
}

export interface MonthSummary {
  month: number;          // 1-12
  year: number;
  total_purchase: string;
  total_resale: string;
  total_markup: string;
  total_sale: string;
  net_change: string;
  stock_end_of_month: string;
}
