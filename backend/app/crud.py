# backend/app/crud.py
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from . import models, schemas
from datetime import date, timedelta
from decimal import Decimal
from fastapi import HTTPException


# ── Counterparty ──────────────────────────────────────────────────────────

def get_or_create_counterparty(db: Session, name: str, tax_id: str) -> models.Counterparty:
    cp = db.query(models.Counterparty).filter(models.Counterparty.tax_id == tax_id).first()
    if not cp:
        cp = models.Counterparty(name=name, tax_id=tax_id)
        db.add(cp)
        db.commit()
        db.refresh(cp)
    return cp

# Backward-compat alias
def get_or_create_seller(db, name, tax_id):
    return get_or_create_counterparty(db, name, tax_id)


# ── Transaction (entry) ───────────────────────────────────────────────────

def _compute_entry_fields(trans: schemas.TransactionCreate):
    if trans.purchase_no_tax == 0:
        raise HTTPException(422, "purchase_no_tax cannot be zero.")
    total_purchase = trans.purchase_no_tax + trans.purchase_tax_amount
    tax_factor = float(1 + trans.purchase_tax_amount / trans.purchase_no_tax)
    resale_no_tax = trans.total_resale / Decimal(tax_factor)
    resale_vat = trans.total_resale - resale_no_tax
    markup = resale_no_tax - trans.purchase_no_tax
    return total_purchase, tax_factor, resale_no_tax, resale_vat, markup


def create_transaction(db: Session, company_id: int, date_val: date, trans: schemas.TransactionCreate):
    tp, tf, rnt, rv, mu = _compute_entry_fields(trans)
    t = models.Transaction(
        company_id=company_id, date=date_val,
        seller_id=trans.seller_id,
        invoice_number=trans.invoice_number,
        register_entry_number=trans.register_entry_number,
        purchase_no_tax=trans.purchase_no_tax,
        purchase_tax_amount=trans.purchase_tax_amount,
        total_purchase=tp, tax_factor=tf,
        total_resale=trans.total_resale,
        resale_no_tax=rnt, resale_vat=rv, markup=mu,
    )
    db.add(t); db.commit(); db.refresh(t)
    return t


def update_transaction(db: Session, db_trans: models.Transaction, trans: schemas.TransactionCreate):
    tp, tf, rnt, rv, mu = _compute_entry_fields(trans)
    db_trans.seller_id = trans.seller_id
    db_trans.invoice_number = trans.invoice_number
    db_trans.register_entry_number = trans.register_entry_number
    db_trans.purchase_no_tax = trans.purchase_no_tax
    db_trans.purchase_tax_amount = trans.purchase_tax_amount
    db_trans.total_purchase = tp
    db_trans.tax_factor = tf
    db_trans.total_resale = trans.total_resale
    db_trans.resale_no_tax = rnt
    db_trans.resale_vat = rv
    db_trans.markup = mu
    db.commit(); db.refresh(db_trans)
    return db_trans


# ── Exit ──────────────────────────────────────────────────────────────────

def create_exit(db: Session, company_id: int, date_val: date, ex: schemas.ExitCreate):
    no_vat = ex.total_sale - ex.vat_amount
    e = models.Exit(
        company_id=company_id, date=date_val,
        buyer_id=ex.buyer_id,
        document_number=ex.document_number,
        total_sale=ex.total_sale,
        vat_amount=ex.vat_amount,
        total_sale_no_vat=no_vat,
    )
    db.add(e); db.commit(); db.refresh(e)
    return e


def update_exit(db: Session, db_exit: models.Exit, ex: schemas.ExitCreate):
    db_exit.buyer_id = ex.buyer_id
    db_exit.document_number = ex.document_number
    db_exit.total_sale = ex.total_sale
    db_exit.vat_amount = ex.vat_amount
    db_exit.total_sale_no_vat = ex.total_sale - ex.vat_amount
    db.commit(); db.refresh(db_exit)
    return db_exit


# ── Helpers ───────────────────────────────────────────────────────────────

D0 = Decimal(0)


def _entry_totals_for_period(db: Session, company_id: int, start: date, end: date):
    """Sum entry columns for date range [start, end] inclusive."""
    r = db.query(
        func.coalesce(func.sum(models.Transaction.purchase_no_tax), D0).label("pnt"),
        func.coalesce(func.sum(models.Transaction.purchase_tax_amount), D0).label("pvat"),
        func.coalesce(func.sum(models.Transaction.total_purchase), D0).label("tp"),
        func.coalesce(func.sum(models.Transaction.resale_no_tax), D0).label("rnt"),
        func.coalesce(func.sum(models.Transaction.resale_vat), D0).label("rvat"),
        func.coalesce(func.sum(models.Transaction.total_resale), D0).label("tr"),
        func.coalesce(func.sum(models.Transaction.markup), D0).label("mu"),
    ).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date >= start,
        models.Transaction.date <= end,
    ).first()
    return r


def _exit_totals_for_period(db: Session, company_id: int, start: date, end: date):
    r = db.query(
        func.coalesce(func.sum(models.Exit.total_sale_no_vat), D0).label("nv"),
        func.coalesce(func.sum(models.Exit.vat_amount), D0).label("vat"),
        func.coalesce(func.sum(models.Exit.total_sale), D0).label("ts"),
    ).filter(
        models.Exit.company_id == company_id,
        models.Exit.date >= start,
        models.Exit.date <= end,
    ).first()
    return r


def _stock_before(db: Session, company_id: int, before_date: date, opening_stock: Decimal) -> Decimal:
    """Cumulative stock at end of day before `before_date`."""
    resale_rows = db.query(
        models.Transaction.date,
        func.sum(models.Transaction.total_resale).label("tr"),
    ).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date < before_date,
    ).group_by(models.Transaction.date).all()

    exit_rows = db.query(
        models.Exit.date,
        func.sum(models.Exit.total_sale).label("ts"),
    ).filter(
        models.Exit.company_id == company_id,
        models.Exit.date < before_date,
    ).group_by(models.Exit.date).all()

    exit_dict = {r.date: r.ts for r in exit_rows}

    stock = opening_stock
    for row in sorted(resale_rows, key=lambda r: r.date):
        stock += row.tr - exit_dict.get(row.date, D0)
    return stock


# ── Daily report ──────────────────────────────────────────────────────────

def get_daily_report(db: Session, company_id: int, target_date: date):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(404, "Company not found.")

    opening = company.opening_stock or D0

    transactions = db.query(models.Transaction).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date == target_date,
    ).order_by(models.Transaction.id).all()

    exits = db.query(models.Exit).filter(
        models.Exit.company_id == company_id,
        models.Exit.date == target_date,
    ).order_by(models.Exit.id).all()

    # Today's entry totals
    et = _entry_totals_for_period(db, company_id, target_date, target_date)
    # Today's exit totals
    xt = _exit_totals_for_period(db, company_id, target_date, target_date)

    net_change = (et.tr or D0) - (xt.ts or D0)

    # Stock calculation: cumulative up to and including today
    stock_before_today = _stock_before(db, company_id, target_date, opening)
    stock_eod = stock_before_today + net_change
    prev_stock = stock_before_today  # stock at end of previous day

    # Previous day (may be any prior date with data)
    prev_date = target_date - timedelta(days=1)
    # We define "previous day totals" as the calendar day before target_date
    pet = _entry_totals_for_period(db, company_id, prev_date, prev_date)
    pxt = _exit_totals_for_period(db, company_id, prev_date, prev_date)

    prev_totals = schemas.PeriodTotals(
        purchase_no_tax=pet.pnt, purchase_vat=pet.pvat, total_purchase=pet.tp,
        exit_no_vat=pxt.nv, exit_vat=pxt.vat, total_exit=pxt.ts,
    )

    return {
        "date": target_date,
        "transactions": transactions,
        "exits": exits,
        "total_purchase_no_tax": et.pnt,
        "total_purchase_vat": et.pvat,
        "total_purchase": et.tp,
        "total_resale_no_tax": et.rnt,
        "total_resale_vat": et.rvat,
        "total_resale": et.tr,
        "total_markup": et.mu,
        "total_exit_no_vat": xt.nv,
        "total_exit_vat": xt.vat,
        "total_exit": xt.ts,
        "net_inventory_change": net_change,
        "stock_end_of_day": stock_eod,
        "previous_stock": prev_stock,
        "prev_totals": prev_totals,
    }


# ── Monthly summary ───────────────────────────────────────────────────────

def get_monthly_summary(db: Session, company_id: int, year: int, month: int):
    from calendar import monthrange
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(404, "Company not found.")
    opening = company.opening_stock or D0

    month_start = date(year, month, 1)
    month_end = date(year, month, monthrange(year, month)[1])

    # Per-day entry aggregates
    entry_days = db.query(
        models.Transaction.date,
        func.coalesce(func.sum(models.Transaction.purchase_no_tax), D0).label("pnt"),
        func.coalesce(func.sum(models.Transaction.purchase_tax_amount), D0).label("pvat"),
        func.coalesce(func.sum(models.Transaction.total_purchase), D0).label("tp"),
        func.coalesce(func.sum(models.Transaction.resale_no_tax), D0).label("rnt"),
        func.coalesce(func.sum(models.Transaction.resale_vat), D0).label("rvat"),
        func.coalesce(func.sum(models.Transaction.total_resale), D0).label("tr"),
        func.coalesce(func.sum(models.Transaction.markup), D0).label("mu"),
    ).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date >= month_start,
        models.Transaction.date <= month_end,
    ).group_by(models.Transaction.date).all()

    exit_days = db.query(
        models.Exit.date,
        func.coalesce(func.sum(models.Exit.total_sale_no_vat), D0).label("nv"),
        func.coalesce(func.sum(models.Exit.vat_amount), D0).label("vat"),
        func.coalesce(func.sum(models.Exit.total_sale), D0).label("ts"),
    ).filter(
        models.Exit.company_id == company_id,
        models.Exit.date >= month_start,
        models.Exit.date <= month_end,
    ).group_by(models.Exit.date).all()

    entry_dict = {r.date: r for r in entry_days}
    exit_dict = {r.date: r for r in exit_days}
    all_days = sorted(set(list(entry_dict.keys()) + list(exit_dict.keys())))

    stock = _stock_before(db, company_id, month_start, opening)

    rows = []
    for d in all_days:
        e = entry_dict.get(d)
        x = exit_dict.get(d)
        tr = e.tr if e else D0
        ts = x.ts if x else D0
        nc = tr - ts
        stock += nc
        rows.append(schemas.DaySummary(
            date=d.isoformat(),
            total_purchase_no_tax=e.pnt if e else D0,
            total_purchase_vat=e.pvat if e else D0,
            total_purchase=e.tp if e else D0,
            total_resale_no_tax=e.rnt if e else D0,
            total_resale_vat=e.rvat if e else D0,
            total_resale=tr,
            total_markup=e.mu if e else D0,
            total_exit_no_vat=x.nv if x else D0,
            total_exit_vat=x.vat if x else D0,
            total_exit=ts,
            net_change=nc,
            stock_end_of_day=stock,
        ))

    # Period totals
    pet = _entry_totals_for_period(db, company_id, month_start, month_end)
    pxt = _exit_totals_for_period(db, company_id, month_start, month_end)
    stock_start = _stock_before(db, company_id, month_start, opening)
    period_totals = schemas.SummaryTotalsRow(
        purchase_no_tax=pet.pnt, purchase_vat=pet.pvat, total_purchase=pet.tp,
        resale_no_tax=pet.rnt, resale_vat=pet.rvat, total_resale=pet.tr,
        exit_no_vat=pxt.nv, exit_vat=pxt.vat, total_exit=pxt.ts,
        stock_start=stock_start, stock_end=stock,
    )

    # Previous month totals
    if month == 1:
        pm, py = 12, year - 1
    else:
        pm, py = month - 1, year
    from calendar import monthrange as mr
    pm_start = date(py, pm, 1)
    pm_end = date(py, pm, mr(py, pm)[1])
    prev_et = _entry_totals_for_period(db, company_id, pm_start, pm_end)
    prev_xt = _exit_totals_for_period(db, company_id, pm_start, pm_end)
    prev_stock_start = _stock_before(db, company_id, pm_start, opening)
    prev_stock_end = _stock_before(db, company_id, month_start, opening)
    prev_totals = schemas.SummaryTotalsRow(
        purchase_no_tax=prev_et.pnt, purchase_vat=prev_et.pvat, total_purchase=prev_et.tp,
        resale_no_tax=prev_et.rnt, resale_vat=prev_et.rvat, total_resale=prev_et.tr,
        exit_no_vat=prev_xt.nv, exit_vat=prev_xt.vat, total_exit=prev_xt.ts,
        stock_start=prev_stock_start, stock_end=prev_stock_end,
    )

    return schemas.MonthlySummaryResponse(rows=rows, period_totals=period_totals, prev_totals=prev_totals)


# ── Yearly summary ────────────────────────────────────────────────────────

def get_yearly_summary(db: Session, company_id: int, year: int):
    from calendar import monthrange
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(404, "Company not found.")
    opening = company.opening_stock or D0

    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)

    entry_months = db.query(
        extract('month', models.Transaction.date).label("m"),
        func.coalesce(func.sum(models.Transaction.purchase_no_tax), D0).label("pnt"),
        func.coalesce(func.sum(models.Transaction.purchase_tax_amount), D0).label("pvat"),
        func.coalesce(func.sum(models.Transaction.total_purchase), D0).label("tp"),
        func.coalesce(func.sum(models.Transaction.resale_no_tax), D0).label("rnt"),
        func.coalesce(func.sum(models.Transaction.resale_vat), D0).label("rvat"),
        func.coalesce(func.sum(models.Transaction.total_resale), D0).label("tr"),
        func.coalesce(func.sum(models.Transaction.markup), D0).label("mu"),
    ).filter(
        models.Transaction.company_id == company_id,
        extract('year', models.Transaction.date) == year,
    ).group_by(extract('month', models.Transaction.date)).all()

    exit_months = db.query(
        extract('month', models.Exit.date).label("m"),
        func.coalesce(func.sum(models.Exit.total_sale_no_vat), D0).label("nv"),
        func.coalesce(func.sum(models.Exit.vat_amount), D0).label("vat"),
        func.coalesce(func.sum(models.Exit.total_sale), D0).label("ts"),
    ).filter(
        models.Exit.company_id == company_id,
        extract('year', models.Exit.date) == year,
    ).group_by(extract('month', models.Exit.date)).all()

    entry_dict = {int(r.m): r for r in entry_months}
    exit_dict = {int(r.m): r for r in exit_months}
    all_months = sorted(set(list(entry_dict.keys()) + list(exit_dict.keys())))

    stock = _stock_before(db, company_id, year_start, opening)

    rows = []
    for m in all_months:
        e = entry_dict.get(m)
        x = exit_dict.get(m)
        tr = e.tr if e else D0
        ts = x.ts if x else D0
        nc = tr - ts
        stock += nc
        rows.append(schemas.MonthSummary(
            month=m, year=year,
            total_purchase_no_tax=e.pnt if e else D0,
            total_purchase_vat=e.pvat if e else D0,
            total_purchase=e.tp if e else D0,
            total_resale_no_tax=e.rnt if e else D0,
            total_resale_vat=e.rvat if e else D0,
            total_resale=tr,
            total_markup=e.mu if e else D0,
            total_exit_no_vat=x.nv if x else D0,
            total_exit_vat=x.vat if x else D0,
            total_exit=ts,
            net_change=nc,
            stock_end_of_month=stock,
        ))

    # Period totals
    pet = _entry_totals_for_period(db, company_id, year_start, year_end)
    pxt = _exit_totals_for_period(db, company_id, year_start, year_end)
    stock_start = _stock_before(db, company_id, year_start, opening)
    period_totals = schemas.SummaryTotalsRow(
        purchase_no_tax=pet.pnt, purchase_vat=pet.pvat, total_purchase=pet.tp,
        resale_no_tax=pet.rnt, resale_vat=pet.rvat, total_resale=pet.tr,
        exit_no_vat=pxt.nv, exit_vat=pxt.vat, total_exit=pxt.ts,
        stock_start=stock_start, stock_end=stock,
    )

    # Previous year
    py_start = date(year - 1, 1, 1)
    py_end = date(year - 1, 12, 31)
    prev_et = _entry_totals_for_period(db, company_id, py_start, py_end)
    prev_xt = _exit_totals_for_period(db, company_id, py_start, py_end)
    prev_stock_start = _stock_before(db, company_id, py_start, opening)
    prev_stock_end = _stock_before(db, company_id, year_start, opening)
    prev_totals = schemas.SummaryTotalsRow(
        purchase_no_tax=prev_et.pnt, purchase_vat=prev_et.pvat, total_purchase=prev_et.tp,
        resale_no_tax=prev_et.rnt, resale_vat=prev_et.rvat, total_resale=prev_et.tr,
        exit_no_vat=prev_xt.nv, exit_vat=prev_xt.vat, total_exit=prev_xt.ts,
        stock_start=prev_stock_start, stock_end=prev_stock_end,
    )

    return schemas.YearlySummaryResponse(rows=rows, period_totals=period_totals, prev_totals=prev_totals)


# ── Legacy daily sales (kept for compat) ──────────────────────────────────

def set_total_sale(db: Session, company_id: int, day: date, total_sale: Decimal):
    existing = db.query(models.DailySalesInput).filter(
        models.DailySalesInput.company_id == company_id,
        models.DailySalesInput.date == day,
    ).first()
    if existing:
        existing.total_sale = total_sale
    else:
        existing = models.DailySalesInput(company_id=company_id, date=day, total_sale=total_sale)
        db.add(existing)
    db.commit(); db.refresh(existing)
    return existing
