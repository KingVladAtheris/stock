# backend/app/crud.py
from sqlalchemy.orm import Session
from sqlalchemy import func, extract
from . import models, schemas
from datetime import date, timedelta
from decimal import Decimal
from fastapi import HTTPException

D0 = Decimal(0)


# ── Counterparty ───────────────────────────────────────────────────────────

def get_or_create_counterparty(db: Session, name: str, tax_id: str) -> models.Counterparty:
    cp = db.query(models.Counterparty).filter(models.Counterparty.tax_id == tax_id).first()
    if not cp:
        cp = models.Counterparty(name=name, tax_id=tax_id)
        db.add(cp); db.commit(); db.refresh(cp)
    return cp

get_or_create_seller = get_or_create_counterparty


# ── Products ───────────────────────────────────────────────────────────────

def get_or_create_product(db: Session, company_id: int, name: str) -> models.Product:
    p = db.query(models.Product).filter(
        models.Product.company_id == company_id,
        func.lower(models.Product.name) == name.strip().lower(),
    ).first()
    if not p:
        p = models.Product(company_id=company_id, name=name.strip())
        db.add(p); db.commit(); db.refresh(p)
    return p


def get_products(db: Session, company_id: int):
    return db.query(models.Product).filter(models.Product.company_id == company_id).order_by(models.Product.name).all()


# ── Inventory helpers ──────────────────────────────────────────────────────

def _get_or_create_inventory(db: Session, company_id: int, product_id: int) -> models.Inventory:
    inv = db.query(models.Inventory).filter(
        models.Inventory.company_id == company_id,
        models.Inventory.product_id == product_id,
    ).first()
    if not inv:
        inv = models.Inventory(company_id=company_id, product_id=product_id,
                               stock_no_vat=D0, stock_vat=D0, stock_total=D0)
        db.add(inv); db.flush()
    return inv


def _adjust_inventory(db: Session, company_id: int, product_id: int,
                       delta_no_vat: Decimal, delta_vat: Decimal, delta_total: Decimal):
    inv = _get_or_create_inventory(db, company_id, product_id)
    inv.stock_no_vat += delta_no_vat
    inv.stock_vat    += delta_vat
    inv.stock_total  += delta_total


def get_inventory(db: Session, company_id: int):
    rows = db.query(models.Inventory, models.Product).join(
        models.Product, models.Inventory.product_id == models.Product.id
    ).filter(models.Inventory.company_id == company_id).all()
    return [schemas.InventoryItem(
        product_id=inv.product_id, product_name=prod.name,
        stock_no_vat=inv.stock_no_vat, stock_vat=inv.stock_vat, stock_total=inv.stock_total,
    ) for inv, prod in rows]


# ── TransactionItem compute ────────────────────────────────────────────────

def _compute_item_fields(item: schemas.TransactionItemCreate):
    if item.purchase_no_tax == 0:
        raise HTTPException(422, "purchase_no_tax cannot be zero.")
    tp  = item.purchase_no_tax + item.purchase_tax_amount
    tf  = float(1 + item.purchase_tax_amount / item.purchase_no_tax)
    rnt = item.total_resale / Decimal(tf)
    rv  = item.total_resale - rnt
    mu  = rnt - item.purchase_no_tax
    return tp, tf, rnt, rv, mu


# ── Transaction (entry) header ─────────────────────────────────────────────

def create_transaction(db: Session, company_id: int, date_val: date,
                       data: schemas.TransactionCreate) -> models.Transaction:
    t = models.Transaction(
        company_id=company_id, date=date_val,
        seller_id=data.seller_id,
        invoice_number=data.invoice_number,
        register_entry_number=data.register_entry_number,
    )
    db.add(t); db.commit(); db.refresh(t)
    return t


def update_transaction(db: Session, tx: models.Transaction,
                        data: schemas.TransactionCreate) -> models.Transaction:
    tx.seller_id             = data.seller_id
    tx.invoice_number        = data.invoice_number
    tx.register_entry_number = data.register_entry_number
    db.commit(); db.refresh(tx)
    return tx


# ── TransactionItem ────────────────────────────────────────────────────────

def create_transaction_item(db: Session, company_id: int,
                             transaction_id: int,
                             item: schemas.TransactionItemCreate) -> models.TransactionItem:
    tp, tf, rnt, rv, mu = _compute_item_fields(item)
    ti = models.TransactionItem(
        transaction_id=transaction_id, product_id=item.product_id,
        purchase_no_tax=item.purchase_no_tax,
        purchase_tax_amount=item.purchase_tax_amount,
        total_purchase=tp, tax_factor=tf,
        total_resale=item.total_resale,
        resale_no_tax=rnt, resale_vat=rv, markup=mu,
    )
    db.add(ti); db.flush()
    _adjust_inventory(db, company_id, item.product_id, rnt, rv, item.total_resale)
    db.commit(); db.refresh(ti)
    return ti


def update_transaction_item(db: Session, company_id: int,
                             ti: models.TransactionItem,
                             item: schemas.TransactionItemCreate) -> models.TransactionItem:
    # Reverse old inventory effect
    _adjust_inventory(db, company_id, ti.product_id,
                      -ti.resale_no_tax, -ti.resale_vat, -ti.total_resale)
    tp, tf, rnt, rv, mu = _compute_item_fields(item)
    ti.product_id          = item.product_id
    ti.purchase_no_tax     = item.purchase_no_tax
    ti.purchase_tax_amount = item.purchase_tax_amount
    ti.total_purchase      = tp; ti.tax_factor = tf
    ti.total_resale        = item.total_resale
    ti.resale_no_tax       = rnt; ti.resale_vat = rv; ti.markup = mu
    db.flush()
    _adjust_inventory(db, company_id, item.product_id, rnt, rv, item.total_resale)
    db.commit(); db.refresh(ti)
    return ti


def delete_transaction_item(db: Session, company_id: int, ti: models.TransactionItem):
    _adjust_inventory(db, company_id, ti.product_id,
                      -ti.resale_no_tax, -ti.resale_vat, -ti.total_resale)
    db.delete(ti); db.commit()


# ── Exit header ────────────────────────────────────────────────────────────

def create_exit(db: Session, company_id: int, date_val: date,
                data: schemas.ExitCreate) -> models.Exit:
    e = models.Exit(
        company_id=company_id, date=date_val,
        buyer_id=data.buyer_id,
        document_number=data.document_number,
    )
    db.add(e); db.commit(); db.refresh(e)
    return e


def update_exit(db: Session, ex: models.Exit, data: schemas.ExitCreate) -> models.Exit:
    ex.buyer_id        = data.buyer_id
    ex.document_number = data.document_number
    db.commit(); db.refresh(ex)
    return ex


# ── ExitItem ───────────────────────────────────────────────────────────────

def create_exit_item(db: Session, company_id: int, exit_id: int,
                     item: schemas.ExitItemCreate) -> models.ExitItem:
    no_vat = item.total_sale - item.vat_amount
    # Validate inventory
    inv = db.query(models.Inventory).filter(
        models.Inventory.company_id == company_id,
        models.Inventory.product_id == item.product_id,
    ).first()
    if not inv or inv.stock_total <= D0:
        prod = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        raise HTTPException(400, f"Produsul '{prod.name if prod else item.product_id}' nu există în inventar.")
    if item.total_sale > inv.stock_total:
        prod = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        raise HTTPException(400,
            f"Valoarea ieșirii ({item.total_sale}) depășește stocul disponibil "
            f"({inv.stock_total}) pentru '{prod.name if prod else item.product_id}'.")
    ei = models.ExitItem(
        exit_id=exit_id, product_id=item.product_id,
        total_sale=item.total_sale, vat_amount=item.vat_amount, total_sale_no_vat=no_vat,
    )
    db.add(ei); db.flush()
    _adjust_inventory(db, company_id, item.product_id, -no_vat, -item.vat_amount, -item.total_sale)
    db.commit(); db.refresh(ei)
    return ei


def update_exit_item(db: Session, company_id: int,
                     ei: models.ExitItem, item: schemas.ExitItemCreate) -> models.ExitItem:
    # Restore old inventory
    _adjust_inventory(db, company_id, ei.product_id,
                      ei.total_sale_no_vat, ei.vat_amount, ei.total_sale)
    no_vat = item.total_sale - item.vat_amount
    # Validate new amount
    inv = db.query(models.Inventory).filter(
        models.Inventory.company_id == company_id,
        models.Inventory.product_id == item.product_id,
    ).first()
    if not inv or item.total_sale > inv.stock_total:
        prod = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        raise HTTPException(400,
            f"Valoarea depășește stocul disponibil pentru '{prod.name if prod else item.product_id}'.")
    ei.product_id = item.product_id
    ei.total_sale = item.total_sale; ei.vat_amount = item.vat_amount; ei.total_sale_no_vat = no_vat
    db.flush()
    _adjust_inventory(db, company_id, item.product_id, -no_vat, -item.vat_amount, -item.total_sale)
    db.commit(); db.refresh(ei)
    return ei


def delete_exit_item(db: Session, company_id: int, ei: models.ExitItem):
    _adjust_inventory(db, company_id, ei.product_id,
                      ei.total_sale_no_vat, ei.vat_amount, ei.total_sale)
    db.delete(ei); db.commit()


# ── Transaction aggregation ────────────────────────────────────────────────

def _tx_aggregate(items) -> dict:
    pnt = pvat = tp = tr = rnt = rv = mu = D0
    for i in items:
        pnt  += i.purchase_no_tax
        pvat += i.purchase_tax_amount
        tp   += i.total_purchase
        tr   += i.total_resale
        rnt  += i.resale_no_tax
        rv   += i.resale_vat
        mu   += i.markup
    return dict(purchase_no_tax=pnt, purchase_tax_amount=pvat, total_purchase=tp,
                total_resale=tr, resale_no_tax=rnt, resale_vat=rv, markup=mu)


def _ex_aggregate(items) -> dict:
    ts = vat = nv = D0
    for i in items:
        ts  += i.total_sale
        vat += i.vat_amount
        nv  += i.total_sale_no_vat
    return dict(total_sale=ts, vat_amount=vat, total_sale_no_vat=nv)


def _enrich_transaction(tx: models.Transaction) -> schemas.Transaction:
    agg = _tx_aggregate(tx.items)
    return schemas.Transaction(
        id=tx.id, date=tx.date,
        seller_id=tx.seller_id,
        invoice_number=tx.invoice_number,
        register_entry_number=tx.register_entry_number,
        seller=tx.seller,
        items=tx.items,
        **agg,
    )


def _enrich_exit(ex: models.Exit) -> schemas.ExitSchema:
    agg = _ex_aggregate(ex.items)
    return schemas.ExitSchema(
        id=ex.id, date=ex.date,
        buyer_id=ex.buyer_id,
        document_number=ex.document_number,
        buyer=ex.buyer,
        items=ex.items,
        **agg,
    )


# ── Stock helpers ──────────────────────────────────────────────────────────

def _opening(company: models.Company):
    return (company.opening_stock_no_vat or D0,
            company.opening_stock_vat    or D0,
            company.opening_stock_total  or D0)


def _stock_before(db: Session, company_id: int, before_date: date,
                  opening_no_vat: Decimal, opening_vat: Decimal, opening_total: Decimal):
    # Resale sums per day < before_date
    entry_rows = db.query(
        models.TransactionItem.transaction_id,
        func.sum(models.TransactionItem.resale_no_tax).label("rnt"),
        func.sum(models.TransactionItem.resale_vat).label("rv"),
        func.sum(models.TransactionItem.total_resale).label("tr"),
    ).join(models.Transaction).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date < before_date,
    ).group_by(models.TransactionItem.transaction_id).all()

    # We need per-date aggregation
    tx_dates = db.query(
        models.Transaction.date,
        func.sum(models.TransactionItem.resale_no_tax).label("rnt"),
        func.sum(models.TransactionItem.resale_vat).label("rv"),
        func.sum(models.TransactionItem.total_resale).label("tr"),
    ).join(models.TransactionItem).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date < before_date,
    ).group_by(models.Transaction.date).all()

    exit_dates = db.query(
        models.Exit.date,
        func.sum(models.ExitItem.total_sale_no_vat).label("nv"),
        func.sum(models.ExitItem.vat_amount).label("vat"),
        func.sum(models.ExitItem.total_sale).label("ts"),
    ).join(models.ExitItem).filter(
        models.Exit.company_id == company_id,
        models.Exit.date < before_date,
    ).group_by(models.Exit.date).all()

    exit_dict = {r.date: r for r in exit_dates}

    nv, vat, total = opening_no_vat, opening_vat, opening_total
    for row in sorted(tx_dates, key=lambda r: r.date):
        ed = exit_dict.get(row.date)
        nv    += row.rnt  - (ed.nv  if ed else D0)
        vat   += row.rv   - (ed.vat if ed else D0)
        total += row.tr   - (ed.ts  if ed else D0)
    return nv, vat, total


def _period_entry_totals(db, company_id, start, end):
    r = db.query(
        func.coalesce(func.sum(models.TransactionItem.purchase_no_tax),    D0).label("pnt"),
        func.coalesce(func.sum(models.TransactionItem.purchase_tax_amount), D0).label("pvat"),
        func.coalesce(func.sum(models.TransactionItem.total_purchase),      D0).label("tp"),
        func.coalesce(func.sum(models.TransactionItem.resale_no_tax),       D0).label("rnt"),
        func.coalesce(func.sum(models.TransactionItem.resale_vat),          D0).label("rv"),
        func.coalesce(func.sum(models.TransactionItem.total_resale),        D0).label("tr"),
        func.coalesce(func.sum(models.TransactionItem.markup),              D0).label("mu"),
    ).join(models.Transaction).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date >= start,
        models.Transaction.date <= end,
    ).first()
    return r


def _period_exit_totals(db, company_id, start, end):
    r = db.query(
        func.coalesce(func.sum(models.ExitItem.total_sale_no_vat), D0).label("nv"),
        func.coalesce(func.sum(models.ExitItem.vat_amount),        D0).label("vat"),
        func.coalesce(func.sum(models.ExitItem.total_sale),        D0).label("ts"),
    ).join(models.Exit).filter(
        models.Exit.company_id == company_id,
        models.Exit.date >= start,
        models.Exit.date <= end,
    ).first()
    return r


# ── Daily report ───────────────────────────────────────────────────────────

def get_daily_report(db: Session, company_id: int, target_date: date):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company: raise HTTPException(404, "Company not found.")
    op_nv, op_vat, op_tot = _opening(company)

    txs = (db.query(models.Transaction)
             .filter(models.Transaction.company_id == company_id,
                     models.Transaction.date == target_date)
             .order_by(models.Transaction.id).all())
    exs = (db.query(models.Exit)
             .filter(models.Exit.company_id == company_id,
                     models.Exit.date == target_date)
             .order_by(models.Exit.id).all())

    et = _period_entry_totals(db, company_id, target_date, target_date)
    xt = _period_exit_totals(db,  company_id, target_date, target_date)

    prev_nv, prev_vat, prev_tot = _stock_before(db, company_id, target_date, op_nv, op_vat, op_tot)
    eod_nv  = prev_nv  + et.rnt - xt.nv
    eod_vat = prev_vat + et.rv  - xt.vat
    eod_tot = prev_tot + et.tr  - xt.ts

    prev_date = target_date - timedelta(days=1)
    pet = _period_entry_totals(db, company_id, prev_date, prev_date)
    pxt = _period_exit_totals(db,  company_id, prev_date, prev_date)

    return schemas.DailyReport(
        date=target_date,
        transactions=[_enrich_transaction(t) for t in txs],
        exits=[_enrich_exit(e) for e in exs],
        total_purchase_no_tax=et.pnt, total_purchase_vat=et.pvat, total_purchase=et.tp,
        total_resale_no_tax=et.rnt,   total_resale_vat=et.rv,     total_resale=et.tr,
        total_markup=et.mu,
        total_exit_no_vat=xt.nv, total_exit_vat=xt.vat, total_exit=xt.ts,
        previous_stock=schemas.StockTriple(no_vat=prev_nv, vat=prev_vat, total=prev_tot),
        stock_end_of_day=schemas.StockTriple(no_vat=eod_nv, vat=eod_vat, total=eod_tot),
        prev_totals=schemas.PeriodTotals(
            purchase_no_tax=pet.pnt, purchase_vat=pet.pvat, total_purchase=pet.tp,
            exit_no_vat=pxt.nv,     exit_vat=pxt.vat,      total_exit=pxt.ts,
        ),
    )


# ── Monthly summary ────────────────────────────────────────────────────────

def get_monthly_summary(db: Session, company_id: int, year: int, month: int):
    from calendar import monthrange
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company: raise HTTPException(404, "Company not found.")
    op_nv, op_vat, op_tot = _opening(company)

    ms = date(year, month, 1)
    me = date(year, month, monthrange(year, month)[1])

    entry_days = db.query(
        models.Transaction.date,
        func.coalesce(func.sum(models.TransactionItem.purchase_no_tax),    D0).label("pnt"),
        func.coalesce(func.sum(models.TransactionItem.purchase_tax_amount), D0).label("pvat"),
        func.coalesce(func.sum(models.TransactionItem.total_purchase),      D0).label("tp"),
        func.coalesce(func.sum(models.TransactionItem.resale_no_tax),       D0).label("rnt"),
        func.coalesce(func.sum(models.TransactionItem.resale_vat),          D0).label("rv"),
        func.coalesce(func.sum(models.TransactionItem.total_resale),        D0).label("tr"),
        func.coalesce(func.sum(models.TransactionItem.markup),              D0).label("mu"),
    ).join(models.TransactionItem).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date >= ms, models.Transaction.date <= me,
    ).group_by(models.Transaction.date).all()

    exit_days = db.query(
        models.Exit.date,
        func.coalesce(func.sum(models.ExitItem.total_sale_no_vat), D0).label("nv"),
        func.coalesce(func.sum(models.ExitItem.vat_amount),        D0).label("vat"),
        func.coalesce(func.sum(models.ExitItem.total_sale),        D0).label("ts"),
    ).join(models.ExitItem).filter(
        models.Exit.company_id == company_id,
        models.Exit.date >= ms, models.Exit.date <= me,
    ).group_by(models.Exit.date).all()

    ed = {r.date: r for r in entry_days}
    xd = {r.date: r for r in exit_days}
    all_days = sorted(set(list(ed.keys()) + list(xd.keys())))

    snv, sv, st = _stock_before(db, company_id, ms, op_nv, op_vat, op_tot)
    rows = []
    for d in all_days:
        e = ed.get(d); x = xd.get(d)
        rnt = e.rnt if e else D0; rv  = e.rv if e else D0; tr = e.tr if e else D0
        nv  = x.nv  if x else D0; vat = x.vat if x else D0; ts = x.ts if x else D0
        dnv = rnt - nv; dv = rv - vat; dt = tr - ts
        snv += dnv; sv += dv; st += dt
        rows.append(schemas.DaySummary(
            date=d.isoformat(),
            total_purchase_no_tax=e.pnt if e else D0,
            total_purchase_vat=e.pvat if e else D0,
            total_purchase=e.tp if e else D0,
            total_resale_no_tax=rnt, total_resale_vat=rv, total_resale=tr,
            total_markup=e.mu if e else D0,
            total_exit_no_vat=nv, total_exit_vat=vat, total_exit=ts,
            net_change_no_vat=dnv, net_change_vat=dv, net_change=dt,
            stock_no_vat=snv, stock_vat=sv, stock_total=st,
        ))

    et = _period_entry_totals(db, company_id, ms, me)
    xt = _period_exit_totals(db,  company_id, ms, me)
    s0nv, s0v, s0t = _stock_before(db, company_id, ms, op_nv, op_vat, op_tot)
    period = schemas.SummaryTotalsRow(
        purchase_no_tax=et.pnt, purchase_vat=et.pvat, total_purchase=et.tp,
        resale_no_tax=et.rnt,   resale_vat=et.rv,     total_resale=et.tr,
        exit_no_vat=xt.nv,      exit_vat=xt.vat,      total_exit=xt.ts,
        stock_start_no_vat=s0nv, stock_start_vat=s0v, stock_start=s0t,
        stock_end_no_vat=snv,    stock_end_vat=sv,     stock_end=st,
    )

    pm, py = (12, year-1) if month == 1 else (month-1, year)
    from calendar import monthrange as mr
    pm_s = date(py, pm, 1); pm_e = date(py, pm, mr(py, pm)[1])
    pet = _period_entry_totals(db, company_id, pm_s, pm_e)
    pxt = _period_exit_totals(db,  company_id, pm_s, pm_e)
    ps0nv, ps0v, ps0t = _stock_before(db, company_id, pm_s, op_nv, op_vat, op_tot)
    psnv,  psv,  pst  = _stock_before(db, company_id, ms,   op_nv, op_vat, op_tot)
    prev = schemas.SummaryTotalsRow(
        purchase_no_tax=pet.pnt, purchase_vat=pet.pvat, total_purchase=pet.tp,
        resale_no_tax=pet.rnt,   resale_vat=pet.rv,     total_resale=pet.tr,
        exit_no_vat=pxt.nv,      exit_vat=pxt.vat,      total_exit=pxt.ts,
        stock_start_no_vat=ps0nv, stock_start_vat=ps0v, stock_start=ps0t,
        stock_end_no_vat=psnv,    stock_end_vat=psv,     stock_end=pst,
    )
    return schemas.MonthlySummaryResponse(rows=rows, period_totals=period, prev_totals=prev)


# ── Yearly summary ─────────────────────────────────────────────────────────

def get_yearly_summary(db: Session, company_id: int, year: int):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company: raise HTTPException(404, "Company not found.")
    op_nv, op_vat, op_tot = _opening(company)

    ys = date(year, 1, 1); ye = date(year, 12, 31)

    entry_months = db.query(
        extract('month', models.Transaction.date).label("m"),
        func.coalesce(func.sum(models.TransactionItem.purchase_no_tax),    D0).label("pnt"),
        func.coalesce(func.sum(models.TransactionItem.purchase_tax_amount), D0).label("pvat"),
        func.coalesce(func.sum(models.TransactionItem.total_purchase),      D0).label("tp"),
        func.coalesce(func.sum(models.TransactionItem.resale_no_tax),       D0).label("rnt"),
        func.coalesce(func.sum(models.TransactionItem.resale_vat),          D0).label("rv"),
        func.coalesce(func.sum(models.TransactionItem.total_resale),        D0).label("tr"),
        func.coalesce(func.sum(models.TransactionItem.markup),              D0).label("mu"),
    ).join(models.TransactionItem).filter(
        models.Transaction.company_id == company_id,
        extract('year', models.Transaction.date) == year,
    ).group_by(extract('month', models.Transaction.date)).all()

    exit_months = db.query(
        extract('month', models.Exit.date).label("m"),
        func.coalesce(func.sum(models.ExitItem.total_sale_no_vat), D0).label("nv"),
        func.coalesce(func.sum(models.ExitItem.vat_amount),        D0).label("vat"),
        func.coalesce(func.sum(models.ExitItem.total_sale),        D0).label("ts"),
    ).join(models.ExitItem).filter(
        models.Exit.company_id == company_id,
        extract('year', models.Exit.date) == year,
    ).group_by(extract('month', models.Exit.date)).all()

    em = {int(r.m): r for r in entry_months}
    xm = {int(r.m): r for r in exit_months}
    all_months = sorted(set(list(em.keys()) + list(xm.keys())))

    snv, sv, st = _stock_before(db, company_id, ys, op_nv, op_vat, op_tot)
    rows = []
    for m in all_months:
        e = em.get(m); x = xm.get(m)
        rnt = e.rnt if e else D0; rv  = e.rv  if e else D0; tr = e.tr if e else D0
        nv  = x.nv  if x else D0; vat = x.vat if x else D0; ts = x.ts if x else D0
        dnv = rnt - nv; dv = rv - vat; dt = tr - ts
        snv += dnv; sv += dv; st += dt
        rows.append(schemas.MonthSummary(
            month=m, year=year,
            total_purchase_no_tax=e.pnt if e else D0,
            total_purchase_vat=e.pvat if e else D0,
            total_purchase=e.tp if e else D0,
            total_resale_no_tax=rnt, total_resale_vat=rv, total_resale=tr,
            total_markup=e.mu if e else D0,
            total_exit_no_vat=nv, total_exit_vat=vat, total_exit=ts,
            net_change_no_vat=dnv, net_change_vat=dv, net_change=dt,
            stock_no_vat=snv, stock_vat=sv, stock_total=st,
        ))

    et = _period_entry_totals(db, company_id, ys, ye)
    xt = _period_exit_totals(db,  company_id, ys, ye)
    s0nv, s0v, s0t = _stock_before(db, company_id, ys, op_nv, op_vat, op_tot)
    period = schemas.SummaryTotalsRow(
        purchase_no_tax=et.pnt, purchase_vat=et.pvat, total_purchase=et.tp,
        resale_no_tax=et.rnt,   resale_vat=et.rv,     total_resale=et.tr,
        exit_no_vat=xt.nv,      exit_vat=xt.vat,      total_exit=xt.ts,
        stock_start_no_vat=s0nv, stock_start_vat=s0v, stock_start=s0t,
        stock_end_no_vat=snv,    stock_end_vat=sv,     stock_end=st,
    )
    py_s = date(year-1, 1, 1); py_e = date(year-1, 12, 31)
    pet = _period_entry_totals(db, company_id, py_s, py_e)
    pxt = _period_exit_totals(db,  company_id, py_s, py_e)
    ps0nv, ps0v, ps0t = _stock_before(db, company_id, py_s, op_nv, op_vat, op_tot)
    psnv,  psv,  pst  = _stock_before(db, company_id, ys,   op_nv, op_vat, op_tot)
    prev = schemas.SummaryTotalsRow(
        purchase_no_tax=pet.pnt, purchase_vat=pet.pvat, total_purchase=pet.tp,
        resale_no_tax=pet.rnt,   resale_vat=pet.rv,     total_resale=pet.tr,
        exit_no_vat=pxt.nv,      exit_vat=pxt.vat,      total_exit=pxt.ts,
        stock_start_no_vat=ps0nv, stock_start_vat=ps0v, stock_start=ps0t,
        stock_end_no_vat=psnv,    stock_end_vat=psv,     stock_end=pst,
    )
    return schemas.YearlySummaryResponse(rows=rows, period_totals=period, prev_totals=prev)
