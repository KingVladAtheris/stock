# backend/app/crud.py
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from . import models, schemas
from datetime import date
from decimal import Decimal
from fastapi import HTTPException
import calendar


def get_or_create_seller(db: Session, name: str, tax_id: str):
    seller = db.query(models.Seller).filter(models.Seller.tax_id == tax_id).first()
    if not seller:
        seller = models.Seller(name=name, tax_id=tax_id)
        db.add(seller)
        db.commit()
        db.refresh(seller)
    return seller


def _compute_transaction_fields(trans: schemas.TransactionCreate):
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
        company_id=company_id, date=date_val,
        seller_id=trans.seller_id,
        invoice_number=trans.invoice_number,
        register_entry_number=trans.register_entry_number,
        purchase_no_tax=trans.purchase_no_tax,
        purchase_tax_amount=trans.purchase_tax_amount,
        total_purchase=total_purchase, tax_factor=tax_factor,
        total_resale=trans.total_resale,
        resale_no_tax=resale_no_tax, markup=markup,
    )
    db.add(db_trans)
    db.commit()
    db.refresh(db_trans)
    return db_trans


def update_transaction(db: Session, db_trans: models.Transaction, trans: schemas.TransactionCreate):
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
    existing = db.query(models.DailySalesInput).filter(
        models.DailySalesInput.company_id == company_id,
        models.DailySalesInput.date == day
    ).first()
    if existing:
        existing.total_sale = total_sale
    else:
        existing = models.DailySalesInput(
            company_id=company_id, date=day, total_sale=total_sale
        )
        db.add(existing)
    db.commit()
    db.refresh(existing)
    return existing


def get_daily_report(db: Session, company_id: int, target_date: date):
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


def get_monthly_summary(db: Session, company_id: int, year: int, month: int):
    """
    Returns one row per calendar day that has either transactions or a sales input.
    Each row contains daily totals and the end-of-day stock for that day.
    """
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")

    # All days in the month that have any transaction data
    tx_days = db.query(
        models.Transaction.date,
        func.sum(models.Transaction.total_purchase).label("total_purchase"),
        func.sum(models.Transaction.total_resale).label("total_resale"),
        func.sum(models.Transaction.markup).label("total_markup"),
    ).filter(
        models.Transaction.company_id == company_id,
        extract('year', models.Transaction.date) == year,
        extract('month', models.Transaction.date) == month,
    ).group_by(models.Transaction.date).all()

    tx_dict = {r.date: r for r in tx_days}

    # All sales inputs for the month
    sale_days = db.query(models.DailySalesInput).filter(
        models.DailySalesInput.company_id == company_id,
        extract('year', models.DailySalesInput.date) == year,
        extract('month', models.DailySalesInput.date) == month,
    ).all()
    sale_dict = {s.date: s.total_sale for s in sale_days}

    all_days = sorted(set(list(tx_dict.keys()) + list(sale_dict.keys())))

    # Build cumulative stock up to end of previous month
    # (reuse get_daily_report logic for each day would be N+1 — instead compute inline)
    # Stock up to day before month start
    month_start = date(year, month, 1)
    prev_resale_by_date = db.query(
        models.Transaction.date,
        func.sum(models.Transaction.total_resale).label("total_resale")
    ).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date < month_start,
    ).group_by(models.Transaction.date).all()

    prev_sales = db.query(
        models.DailySalesInput.date,
        models.DailySalesInput.total_sale,
    ).filter(
        models.DailySalesInput.company_id == company_id,
        models.DailySalesInput.date < month_start,
    ).all()
    prev_sales_dict = {s.date: s.total_sale for s in prev_sales}

    stock = company.opening_stock or Decimal(0)
    for row in sorted(prev_resale_by_date, key=lambda r: r.date):
        day_sale = prev_sales_dict.get(row.date, Decimal(0))
        stock += row.total_resale - day_sale

    results = []
    for d in all_days:
        tx = tx_dict.get(d)
        total_purchase = tx.total_purchase if tx else Decimal(0)
        total_resale = tx.total_resale if tx else Decimal(0)
        total_markup = tx.total_markup if tx else Decimal(0)
        total_sale = sale_dict.get(d, Decimal(0))
        net_change = total_resale - total_sale
        stock += net_change
        results.append({
            "date": d.isoformat(),
            "total_purchase": total_purchase or Decimal(0),
            "total_resale": total_resale or Decimal(0),
            "total_markup": total_markup or Decimal(0),
            "total_sale": total_sale,
            "net_change": net_change,
            "stock_end_of_day": stock,
        })

    return results


def get_yearly_summary(db: Session, company_id: int, year: int):
    """
    Returns one row per month that has data, with month totals and end-of-month stock.
    """
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")

    tx_months = db.query(
        extract('month', models.Transaction.date).label("month"),
        func.sum(models.Transaction.total_purchase).label("total_purchase"),
        func.sum(models.Transaction.total_resale).label("total_resale"),
        func.sum(models.Transaction.markup).label("total_markup"),
    ).filter(
        models.Transaction.company_id == company_id,
        extract('year', models.Transaction.date) == year,
    ).group_by(extract('month', models.Transaction.date)).all()

    tx_dict = {int(r.month): r for r in tx_months}

    sale_months = db.query(
        extract('month', models.DailySalesInput.date).label("month"),
        func.sum(models.DailySalesInput.total_sale).label("total_sale"),
    ).filter(
        models.DailySalesInput.company_id == company_id,
        extract('year', models.DailySalesInput.date) == year,
    ).group_by(extract('month', models.DailySalesInput.date)).all()
    sale_dict = {int(r.month): r.total_sale for r in sale_months}

    all_months = sorted(set(list(tx_dict.keys()) + list(sale_dict.keys())))

    # Stock at end of previous year
    year_start = date(year, 1, 1)
    prev_resale = db.query(
        models.Transaction.date,
        func.sum(models.Transaction.total_resale).label("total_resale")
    ).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date < year_start,
    ).group_by(models.Transaction.date).all()

    prev_sales = db.query(
        models.DailySalesInput.date,
        models.DailySalesInput.total_sale,
    ).filter(
        models.DailySalesInput.company_id == company_id,
        models.DailySalesInput.date < year_start,
    ).all()
    prev_sales_dict = {s.date: s.total_sale for s in prev_sales}

    stock = company.opening_stock or Decimal(0)
    for row in sorted(prev_resale, key=lambda r: r.date):
        day_sale = prev_sales_dict.get(row.date, Decimal(0))
        stock += row.total_resale - day_sale

    results = []
    for m in all_months:
        tx = tx_dict.get(m)
        total_purchase = tx.total_purchase if tx else Decimal(0)
        total_resale = tx.total_resale if tx else Decimal(0)
        total_markup = tx.total_markup if tx else Decimal(0)
        total_sale = sale_dict.get(m, Decimal(0))
        net_change = total_resale - total_sale
        stock += net_change
        results.append({
            "month": m,
            "year": year,
            "total_purchase": total_purchase or Decimal(0),
            "total_resale": total_resale or Decimal(0),
            "total_markup": total_markup or Decimal(0),
            "total_sale": total_sale,
            "net_change": net_change,
            "stock_end_of_month": stock,
        })

    return results
