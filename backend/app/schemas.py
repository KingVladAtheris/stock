# backend/app/schemas.py
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import List, Optional


# ── Counterparty ───────────────────────────────────────────────────────────

class CounterpartyCreate(BaseModel):
    name: str
    tax_id: str

class Counterparty(CounterpartyCreate):
    id: int
    class Config: from_attributes = True

SellerCreate = CounterpartyCreate
Seller = Counterparty


# ── Company ────────────────────────────────────────────────────────────────

class CompanyCreate(BaseModel):
    name: str
    tax_id: str
    chamber_id: Optional[str] = None
    opening_stock_no_vat: Decimal = Decimal(0)
    opening_stock_vat:    Decimal = Decimal(0)
    opening_stock_total:  Decimal = Decimal(0)

class Company(BaseModel):
    id: int
    name: str
    tax_id: str
    chamber_id: Optional[str] = None
    opening_stock_no_vat: Decimal
    opening_stock_vat:    Decimal
    opening_stock_total:  Decimal
    class Config: from_attributes = True


# ── Product ────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    name: str

class Product(BaseModel):
    id: int
    company_id: int
    name: str
    class Config: from_attributes = True


# ── Inventory ──────────────────────────────────────────────────────────────

class InventoryItem(BaseModel):
    product_id:   int
    product_name: str
    stock_no_vat: Decimal
    stock_vat:    Decimal
    stock_total:  Decimal
    class Config: from_attributes = True


# ── Transaction items ──────────────────────────────────────────────────────

class TransactionItemCreate(BaseModel):
    product_id:          int
    purchase_no_tax:     Decimal
    purchase_tax_amount: Decimal
    total_resale:        Decimal

class TransactionItemSchema(TransactionItemCreate):
    id:            int
    transaction_id: int
    total_purchase: Decimal
    tax_factor:     float
    resale_no_tax:  Decimal
    resale_vat:     Decimal
    markup:         Decimal
    product:        Optional[Product] = None
    class Config: from_attributes = True


# ── Transaction (entry header) ─────────────────────────────────────────────

class TransactionCreate(BaseModel):
    seller_id:             int
    invoice_number:        Optional[str] = None
    register_entry_number: Optional[str] = None

class Transaction(TransactionCreate):
    id:         int
    date:       date
    # Aggregated totals (computed from items)
    purchase_no_tax:     Decimal = Decimal(0)
    purchase_tax_amount: Decimal = Decimal(0)
    total_purchase:      Decimal = Decimal(0)
    total_resale:        Decimal = Decimal(0)
    resale_no_tax:       Decimal = Decimal(0)
    resale_vat:          Decimal = Decimal(0)
    markup:              Decimal = Decimal(0)
    seller: Optional[Counterparty] = None
    items:  List[TransactionItemSchema] = []
    class Config: from_attributes = True


# ── Exit items ─────────────────────────────────────────────────────────────

class ExitItemCreate(BaseModel):
    product_id: int
    total_sale:    Decimal
    vat_amount:    Decimal

class ExitItemSchema(ExitItemCreate):
    id:               int
    exit_id:          int
    total_sale_no_vat: Decimal
    product:          Optional[Product] = None
    class Config: from_attributes = True


# ── Exit (header) ──────────────────────────────────────────────────────────

class ExitCreate(BaseModel):
    buyer_id:        int
    document_number: Optional[str] = None

class ExitSchema(ExitCreate):
    id:   int
    date: date
    # Aggregated totals
    total_sale:       Decimal = Decimal(0)
    vat_amount:       Decimal = Decimal(0)
    total_sale_no_vat: Decimal = Decimal(0)
    buyer: Optional[Counterparty] = None
    items: List[ExitItemSchema] = []
    class Config: from_attributes = True


# ── Stock split helper ─────────────────────────────────────────────────────

class StockTriple(BaseModel):
    no_vat: Decimal
    vat:    Decimal
    total:  Decimal


# ── Period totals ──────────────────────────────────────────────────────────

class PeriodTotals(BaseModel):
    purchase_no_tax: Decimal; purchase_vat: Decimal; total_purchase: Decimal
    exit_no_vat:     Decimal; exit_vat:     Decimal; total_exit:     Decimal


# ── Daily report ───────────────────────────────────────────────────────────

class DailyReport(BaseModel):
    date:         date
    transactions: List[Transaction]
    exits:        List[ExitSchema]
    # Entry totals
    total_purchase_no_tax: Decimal; total_purchase_vat: Decimal; total_purchase: Decimal
    total_resale_no_tax:   Decimal; total_resale_vat:   Decimal; total_resale:   Decimal
    total_markup:          Decimal
    # Exit totals
    total_exit_no_vat: Decimal; total_exit_vat: Decimal; total_exit: Decimal
    # Stock (split)
    previous_stock: StockTriple
    stock_end_of_day: StockTriple
    prev_totals: PeriodTotals


# ── Summary schemas ────────────────────────────────────────────────────────

class DaySummary(BaseModel):
    date: str
    total_purchase_no_tax: Decimal; total_purchase_vat: Decimal; total_purchase: Decimal
    total_resale_no_tax:   Decimal; total_resale_vat:   Decimal; total_resale:   Decimal
    total_markup: Decimal
    total_exit_no_vat: Decimal; total_exit_vat: Decimal; total_exit: Decimal
    net_change_no_vat: Decimal; net_change_vat: Decimal; net_change: Decimal
    stock_no_vat: Decimal; stock_vat: Decimal; stock_total: Decimal


class MonthSummary(BaseModel):
    month: int; year: int
    total_purchase_no_tax: Decimal; total_purchase_vat: Decimal; total_purchase: Decimal
    total_resale_no_tax:   Decimal; total_resale_vat:   Decimal; total_resale:   Decimal
    total_markup: Decimal
    total_exit_no_vat: Decimal; total_exit_vat: Decimal; total_exit: Decimal
    net_change_no_vat: Decimal; net_change_vat: Decimal; net_change: Decimal
    stock_no_vat: Decimal; stock_vat: Decimal; stock_total: Decimal


class SummaryTotalsRow(BaseModel):
    purchase_no_tax: Decimal; purchase_vat: Decimal; total_purchase: Decimal
    resale_no_tax:   Decimal; resale_vat:   Decimal; total_resale:   Decimal
    exit_no_vat:     Decimal; exit_vat:     Decimal; total_exit:     Decimal
    stock_start_no_vat: Decimal; stock_start_vat: Decimal; stock_start: Decimal
    stock_end_no_vat:   Decimal; stock_end_vat:   Decimal; stock_end:   Decimal


class MonthlySummaryResponse(BaseModel):
    rows:           List[DaySummary]
    period_totals:  SummaryTotalsRow
    prev_totals:    SummaryTotalsRow


class YearlySummaryResponse(BaseModel):
    rows:           List[MonthSummary]
    period_totals:  SummaryTotalsRow
    prev_totals:    SummaryTotalsRow
