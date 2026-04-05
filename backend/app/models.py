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
    daily_sales = relationship("DailySalesInput", back_populates="company")


class Seller(Base):
    __tablename__ = "sellers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    tax_id = Column(String, unique=True, nullable=False)


class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    date = Column(Date, nullable=False)
    seller_id = Column(Integer, ForeignKey("sellers.id"), nullable=False)
    invoice_number = Column(String)
    register_entry_number = Column(String)
    purchase_no_tax = Column(Numeric(12, 2), nullable=False)
    purchase_tax_amount = Column(Numeric(12, 2), nullable=False)
    total_purchase = Column(Numeric(12, 2), nullable=False)       # auto-computed
    tax_factor = Column(Float, nullable=False)                    # e.g. 1.19
    total_resale = Column(Numeric(12, 2), nullable=False)
    resale_no_tax = Column(Numeric(12, 2), nullable=False)        # auto-computed
    markup = Column(Numeric(12, 2), nullable=False)               # auto-computed

    company = relationship("Company", back_populates="transactions")
    seller = relationship("Seller")


class DailySalesInput(Base):
    __tablename__ = "daily_sales"
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    date = Column(Date, nullable=False)
    total_sale = Column(Numeric(12, 2), default=0)

    company = relationship("Company", back_populates="daily_sales")

    __table_args__ = (
        UniqueConstraint("company_id", "date", name="uix_company_date"),
    )