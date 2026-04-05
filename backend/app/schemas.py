# backend/app/schemas.py
from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import List, Optional


class SellerBase(BaseModel):
    name: str
    tax_id: str

class SellerCreate(SellerBase):
    pass

class Seller(SellerBase):
    id: int
    class Config:
        from_attributes = True


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
    markup: Decimal
    seller: Optional[Seller] = None
    class Config:
        from_attributes = True


class DailySalesInputSchema(BaseModel):
    total_sale: Decimal


class DailyReport(BaseModel):
    date: date
    transactions: List[Transaction]
    total_purchase: Decimal
    total_resale: Decimal
    total_markup: Decimal
    total_sale_input: Decimal
    net_inventory_change: Decimal
    stock_end_of_day: Decimal
    previous_stock: Decimal