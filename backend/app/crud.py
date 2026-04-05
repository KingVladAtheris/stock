# backend/app/crud.py
from sqlalchemy.orm import Session
from sqlalchemy import func
from . import models, schemas
from datetime import date
from decimal import Decimal
from fastapi import HTTPException


def get_or_create_seller(db: Session, name: str, tax_id: str):
    seller = db.query(models.Seller).filter(models.Seller.tax_id == tax_id).first()
    if not seller:
        seller = models.Seller(name=name, tax_id=tax_id)
        db.add(seller)
        db.commit()
        db.refresh(seller)
    return seller


def _compute_transaction_fields(trans: schemas.TransactionCreate):
    """Return derived fields from a TransactionCreate payload."""
    if trans.purchase_no_tax == 0:
        raise HTTPException(
            status_code=422,
            detail="purchase_no_tax cannot be zero — tax factor cannot be calculated."
        )
    total_purchase = trans.purchase_no_tax + trans.purchase_tax_amount
    tax_factor = float(1 + (trans.purchase_tax_amount / trans.purchase_no_tax))
    resale_no_tax = trans.total_resale / Decimal(tax_factor)
    markup = resale_no_tax - trans.purchase_no_tax
    return total_purchase, tax_factor, resale_no_tax, markup


def create_transaction(db: Session, company_id: int, date_val: date, trans: schemas.TransactionCreate):
    total_purchase, tax_factor, resale_no_tax, markup = _compute_transaction_fields(trans)

    db_trans = models.Transaction(
        company_id=company_id,
        date=date_val,
        seller_id=trans.seller_id,
        invoice_number=trans.invoice_number,
        register_entry_number=trans.register_entry_number,
        purchase_no_tax=trans.purchase_no_tax,
        purchase_tax_amount=trans.purchase_tax_amount,
        total_purchase=total_purchase,
        tax_factor=tax_factor,
        total_resale=trans.total_resale,
        resale_no_tax=resale_no_tax,
        markup=markup,
    )
    db.add(db_trans)
    db.commit()
    db.refresh(db_trans)
    return db_trans


def update_transaction(db: Session, db_trans: models.Transaction, trans: schemas.TransactionCreate):
    """Update an existing Transaction row with new values, recomputing derived fields."""
    total_purchase, tax_factor, resale_no_tax, markup = _compute_transaction_fields(trans)

    db_trans.seller_id = trans.seller_id
    db_trans.invoice_number = trans.invoice_number
    db_trans.register_entry_number = trans.register_entry_number
    db_trans.purchase_no_tax = trans.purchase_no_tax
    db_trans.purchase_tax_amount = trans.purchase_tax_amount
    db_trans.total_purchase = total_purchase
    db_trans.tax_factor = tax_factor
    db_trans.total_resale = trans.total_resale
    db_trans.resale_no_tax = resale_no_tax
    db_trans.markup = markup

    db.commit()
    db.refresh(db_trans)
    return db_trans


def set_total_sale(db: Session, company_id: int, day: date, total_sale: Decimal):
    """Create or update the Total Sale for a specific day."""
    existing = db.query(models.DailySalesInput).filter(
        models.DailySalesInput.company_id == company_id,
        models.DailySalesInput.date == day
    ).first()

    if existing:
        existing.total_sale = total_sale
    else:
        existing = models.DailySalesInput(
            company_id=company_id,
            date=day,
            total_sale=total_sale
        )
        db.add(existing)

    db.commit()
    db.refresh(existing)
    return existing


def get_daily_report(db: Session, company_id: int, target_date: date):
    """Get full daily report with stock calculation."""
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")

    transactions = db.query(models.Transaction).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date == target_date
    ).all()

    totals = db.query(
        func.sum(models.Transaction.total_purchase).label("total_purchase"),
        func.sum(models.Transaction.total_resale).label("total_resale"),
        func.sum(models.Transaction.markup).label("total_markup")
    ).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date == target_date
    ).first()

    total_purchase = totals.total_purchase or Decimal(0)
    total_resale = totals.total_resale or Decimal(0)
    total_markup = totals.total_markup or Decimal(0)

    sales_input = db.query(models.DailySalesInput).filter(
        models.DailySalesInput.company_id == company_id,
        models.DailySalesInput.date == target_date
    ).first()

    total_sale = sales_input.total_sale if sales_input else Decimal(0)
    net_change = total_resale - total_sale

    resale_by_date = db.query(
        models.Transaction.date,
        func.sum(models.Transaction.total_resale).label("total_resale")
    ).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date <= target_date
    ).group_by(models.Transaction.date).all()

    sales_by_date = db.query(
        models.DailySalesInput.date,
        models.DailySalesInput.total_sale
    ).filter(
        models.DailySalesInput.company_id == company_id,
        models.DailySalesInput.date <= target_date
    ).all()

    sales_dict = {s.date: s.total_sale for s in sales_by_date}

    stock = company.opening_stock or Decimal(0)
    for row in sorted(resale_by_date, key=lambda r: r.date):
        day_sale = sales_dict.get(row.date, Decimal(0))
        stock += row.total_resale - day_sale

    previous_stock = stock - net_change

    return {
        "date": target_date,
        "transactions": transactions,
        "total_purchase": total_purchase,
        "total_resale": total_resale,
        "total_markup": total_markup,
        "total_sale_input": total_sale,
        "net_inventory_change": net_change,
        "stock_end_of_day": stock,
        "previous_stock": previous_stock,
    }
