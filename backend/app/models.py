# backend/app/models.py
from sqlalchemy import Column, Integer, String, Date, Float, Numeric, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from .database import Base


class Company(Base):
    __tablename__ = "companies"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    tax_id = Column(String, unique=True, nullable=False)
    chamber_id = Column(String)
    opening_stock = Column(Numeric(12, 2), nullable=False, default=0)

    transactions = relationship("Transaction", back_populates="company")
    exits = relationship("Exit", back_populates="company")
    daily_sales = relationship("DailySalesInput", back_populates="company")


class Counterparty(Base):
    """Unified table for both suppliers (used in entries) and buyers (used in exits)."""
    __tablename__ = "counterparties"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    tax_id = Column(String, unique=True, nullable=False)


class Transaction(Base):
    """Entry — a purchase from a supplier."""
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    date = Column(Date, nullable=False)
    seller_id = Column(Integer, ForeignKey("counterparties.id"), nullable=False)
    invoice_number = Column(String)
    register_entry_number = Column(String)
    purchase_no_tax = Column(Numeric(12, 2), nullable=False)
    purchase_tax_amount = Column(Numeric(12, 2), nullable=False)
    total_purchase = Column(Numeric(12, 2), nullable=False)
    tax_factor = Column(Float, nullable=False)
    total_resale = Column(Numeric(12, 2), nullable=False)
    resale_no_tax = Column(Numeric(12, 2), nullable=False)
    resale_vat = Column(Numeric(12, 2), nullable=False)   # total_resale - resale_no_tax
    markup = Column(Numeric(12, 2), nullable=False)

    company = relationship("Company", back_populates="transactions")
    seller = relationship("Counterparty", foreign_keys=[seller_id])


class Exit(Base):
    """Exit — a sale to a buyer."""
    __tablename__ = "exits"
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    date = Column(Date, nullable=False)
    buyer_id = Column(Integer, ForeignKey("counterparties.id"), nullable=False)
    document_number = Column(String)
    total_sale = Column(Numeric(12, 2), nullable=False)       # user inputs this (with VAT)
    vat_amount = Column(Numeric(12, 2), nullable=False)        # user inputs this
    total_sale_no_vat = Column(Numeric(12, 2), nullable=False) # calculated: total_sale - vat_amount

    company = relationship("Company", back_populates="exits")
    buyer = relationship("Counterparty", foreign_keys=[buyer_id])


class DailySalesInput(Base):
    """Legacy — kept for migration compatibility but superseded by Exit rows."""
    __tablename__ = "daily_sales"
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    date = Column(Date, nullable=False)
    total_sale = Column(Numeric(12, 2), default=0)

    company = relationship("Company", back_populates="daily_sales")

    __table_args__ = (
        UniqueConstraint("company_id", "date", name="uix_company_date"),
    )
