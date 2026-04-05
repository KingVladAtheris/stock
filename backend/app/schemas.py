# backend/app/schemas.py
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import List, Optional


# ── Counterparty (unified seller / buyer) ──────────────────────────────────

class CounterpartyBase(BaseModel):
    name: str
    tax_id: str

class CounterpartyCreate(CounterpartyBase):
    pass

class Counterparty(CounterpartyBase):
    id: int
    class Config:
        from_attributes = True

# Keep backward-compat aliases
SellerBase = CounterpartyBase
SellerCreate = CounterpartyCreate
Seller = Counterparty


# ── Company ────────────────────────────────────────────────────────────────

class CompanyCreate(BaseModel):
    name: str
    tax_id: str
    chamber_id: Optional[str] = None
    opening_stock: Decimal = Decimal(0)

class Company(BaseModel):
    id: int
    name: str
    tax_id: str
    chamber_id: Optional[str] = None
    opening_stock: Decimal
    class Config:
        from_attributes = True


# ── Transaction (entry) ────────────────────────────────────────────────────

class TransactionBase(BaseModel):
    seller_id: int
    invoice_number: Optional[str] = None
    register_entry_number: Optional[str] = None
    purchase_no_tax: Decimal
    purchase_tax_amount: Decimal
    total_resale: Decimal

class TransactionCreate(TransactionBase):
    pass

class Transaction(TransactionBase):
    id: int
    date: date
    total_purchase: Decimal
    tax_factor: float
    resale_no_tax: Decimal
    resale_vat: Decimal
    markup: Decimal
    seller: Optional[Counterparty] = None
    class Config:
        from_attributes = True


# ── Exit ──────────────────────────────────────────────────────────────────

class ExitBase(BaseModel):
    buyer_id: int
    document_number: Optional[str] = None
    total_sale: Decimal
    vat_amount: Decimal

class ExitCreate(ExitBase):
    pass

class ExitSchema(ExitBase):
    id: int
    date: date
    total_sale_no_vat: Decimal
    buyer: Optional[Counterparty] = None
    class Config:
        from_attributes = True


# ── Daily sales (legacy) ───────────────────────────────────────────────────

class DailySalesInputSchema(BaseModel):
    total_sale: Decimal


# ── Totals block ───────────────────────────────────────────────────────────

class PeriodTotals(BaseModel):
    """Aggregated purchase + exit totals for a period (day / month / year)."""
    purchase_no_tax: Decimal
    purchase_vat: Decimal
    total_purchase: Decimal
    exit_no_vat: Decimal
    exit_vat: Decimal
    total_exit: Decimal


# ── Daily report ──────────────────────────────────────────────────────────

class DailyReport(BaseModel):
    date: date
    transactions: List[Transaction]
    exits: List[ExitSchema]
    # Entry totals
    total_purchase_no_tax: Decimal
    total_purchase_vat: Decimal
    total_purchase: Decimal
    total_resale_no_tax: Decimal
    total_resale_vat: Decimal
    total_resale: Decimal
    total_markup: Decimal
    # Exit totals
    total_exit_no_vat: Decimal
    total_exit_vat: Decimal
    total_exit: Decimal
    # Stock
    net_inventory_change: Decimal
    stock_end_of_day: Decimal
    previous_stock: Decimal
    # Previous day totals
    prev_totals: PeriodTotals


# ── Summary schemas ────────────────────────────────────────────────────────

class DaySummary(BaseModel):
    date: str
    # Entries
    total_purchase_no_tax: Decimal
    total_purchase_vat: Decimal
    total_purchase: Decimal
    total_resale_no_tax: Decimal
    total_resale_vat: Decimal
    total_resale: Decimal
    total_markup: Decimal
    # Exits
    total_exit_no_vat: Decimal
    total_exit_vat: Decimal
    total_exit: Decimal
    # Stock
    net_change: Decimal
    stock_end_of_day: Decimal


class MonthSummary(BaseModel):
    month: int
    year: int
    # Entries
    total_purchase_no_tax: Decimal
    total_purchase_vat: Decimal
    total_purchase: Decimal
    total_resale_no_tax: Decimal
    total_resale_vat: Decimal
    total_resale: Decimal
    total_markup: Decimal
    # Exits
    total_exit_no_vat: Decimal
    total_exit_vat: Decimal
    total_exit: Decimal
    # Stock
    net_change: Decimal
    stock_end_of_month: Decimal


class SummaryTotalsRow(BaseModel):
    """Bottom totals row for monthly/yearly summary pages."""
    purchase_no_tax: Decimal
    purchase_vat: Decimal
    total_purchase: Decimal
    resale_no_tax: Decimal
    resale_vat: Decimal
    total_resale: Decimal
    exit_no_vat: Decimal
    exit_vat: Decimal
    total_exit: Decimal
    stock_start: Decimal
    stock_end: Decimal


class MonthlySummaryResponse(BaseModel):
    rows: List[DaySummary]
    period_totals: SummaryTotalsRow
    prev_totals: SummaryTotalsRow   # previous month


class YearlySummaryResponse(BaseModel):
    rows: List[MonthSummary]
    period_totals: SummaryTotalsRow
    prev_totals: SummaryTotalsRow   # previous year
