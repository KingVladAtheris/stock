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
    # Split opening stock
    opening_stock_no_vat = Column(Numeric(14, 2), nullable=False, default=0)
    opening_stock_vat    = Column(Numeric(14, 2), nullable=False, default=0)
    opening_stock_total  = Column(Numeric(14, 2), nullable=False, default=0)

    transactions = relationship("Transaction", back_populates="company", cascade="all, delete-orphan")
    exits        = relationship("Exit",        back_populates="company", cascade="all, delete-orphan")
    products     = relationship("Product",     back_populates="company", cascade="all, delete-orphan")
    inventory    = relationship("Inventory",   back_populates="company", cascade="all, delete-orphan")


class Counterparty(Base):
    """Unified table for suppliers (entries) and buyers (exits)."""
    __tablename__ = "counterparties"
    id     = Column(Integer, primary_key=True, index=True)
    name   = Column(String, nullable=False)
    tax_id = Column(String, unique=True, nullable=False)


class Product(Base):
    """Company-scoped product / item catalogue."""
    __tablename__ = "products"
    id         = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    name       = Column(String, nullable=False)

    company         = relationship("Company", back_populates="products")
    transaction_items = relationship("TransactionItem", back_populates="product")
    exit_items        = relationship("ExitItem",        back_populates="product")
    inventory         = relationship("Inventory",        back_populates="product", uselist=False)

    __table_args__ = (UniqueConstraint("company_id", "name", name="uix_product_company_name"),)


class Inventory(Base):
    """Running stock per product per company (in resale/sale price terms)."""
    __tablename__ = "inventory"
    id         = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"),  nullable=False)
    stock_no_vat = Column(Numeric(14, 2), nullable=False, default=0)
    stock_vat    = Column(Numeric(14, 2), nullable=False, default=0)
    stock_total  = Column(Numeric(14, 2), nullable=False, default=0)

    company = relationship("Company",  back_populates="inventory")
    product = relationship("Product",  back_populates="inventory")

    __table_args__ = (UniqueConstraint("company_id", "product_id", name="uix_inv_company_product"),)


class Transaction(Base):
    """Entry header — one row per counterparty per document."""
    __tablename__ = "transactions"
    id                     = Column(Integer, primary_key=True, index=True)
    company_id             = Column(Integer, ForeignKey("companies.id"), nullable=False)
    date                   = Column(Date, nullable=False)
    seller_id              = Column(Integer, ForeignKey("counterparties.id"), nullable=False)
    invoice_number         = Column(String)
    register_entry_number  = Column(String)

    company = relationship("Company",      back_populates="transactions")
    seller  = relationship("Counterparty", foreign_keys=[seller_id])
    items   = relationship("TransactionItem", back_populates="transaction", cascade="all, delete-orphan")


class TransactionItem(Base):
    """One line item inside an entry (Transaction)."""
    __tablename__ = "transaction_items"
    id             = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False)
    product_id     = Column(Integer, ForeignKey("products.id"),     nullable=False)
    # Purchase side
    purchase_no_tax    = Column(Numeric(14, 2), nullable=False)
    purchase_tax_amount = Column(Numeric(14, 2), nullable=False)
    total_purchase     = Column(Numeric(14, 2), nullable=False)  # computed
    tax_factor         = Column(Float,          nullable=False)   # computed
    # Resale side (at acquisition price)
    total_resale   = Column(Numeric(14, 2), nullable=False)
    resale_no_tax  = Column(Numeric(14, 2), nullable=False)  # computed
    resale_vat     = Column(Numeric(14, 2), nullable=False)  # computed
    markup         = Column(Numeric(14, 2), nullable=False)  # computed

    transaction = relationship("Transaction",   back_populates="items")
    product     = relationship("Product",       back_populates="transaction_items")


class Exit(Base):
    """Exit header — one row per counterparty per document."""
    __tablename__ = "exits"
    id              = Column(Integer, primary_key=True, index=True)
    company_id      = Column(Integer, ForeignKey("companies.id"),      nullable=False)
    date            = Column(Date,    nullable=False)
    buyer_id        = Column(Integer, ForeignKey("counterparties.id"), nullable=False)
    document_number = Column(String)

    company = relationship("Company",      back_populates="exits")
    buyer   = relationship("Counterparty", foreign_keys=[buyer_id])
    items   = relationship("ExitItem", back_populates="exit", cascade="all, delete-orphan")


class ExitItem(Base):
    """One line item inside an exit (Exit)."""
    __tablename__ = "exit_items"
    id          = Column(Integer, primary_key=True, index=True)
    exit_id     = Column(Integer, ForeignKey("exits.id"),     nullable=False)
    product_id  = Column(Integer, ForeignKey("products.id"),  nullable=False)
    total_sale     = Column(Numeric(14, 2), nullable=False)  # user input (with VAT)
    vat_amount     = Column(Numeric(14, 2), nullable=False)  # user input
    total_sale_no_vat = Column(Numeric(14, 2), nullable=False)  # computed

    exit    = relationship("Exit",    back_populates="items")
    product = relationship("Product", back_populates="exit_items")
