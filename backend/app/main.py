# backend/app/main.py
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import date
from typing import List

from .database import engine, get_db, Base
from . import models, schemas, crud

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Accounting Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Companies ─────────────────────────────────────────────────────────────

@app.post("/companies", response_model=schemas.Company)
def create_company(data: schemas.CompanyCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Company).filter(models.Company.tax_id == data.tax_id).first()
    if existing:
        raise HTTPException(409, "A company with this tax ID already exists.")
    company = models.Company(name=data.name, tax_id=data.tax_id,
                              chamber_id=data.chamber_id, opening_stock=data.opening_stock)
    db.add(company); db.commit(); db.refresh(company)
    return company

@app.get("/companies", response_model=List[schemas.Company])
def get_companies(db: Session = Depends(get_db)):
    return db.query(models.Company).all()

@app.get("/companies/{company_id}", response_model=schemas.Company)
def get_company(company_id: int, db: Session = Depends(get_db)):
    c = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not c: raise HTTPException(404, "Company not found.")
    return c

@app.put("/companies/{company_id}", response_model=schemas.Company)
def update_company(company_id: int, data: schemas.CompanyCreate, db: Session = Depends(get_db)):
    c = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not c: raise HTTPException(404, "Company not found.")
    if data.tax_id != c.tax_id:
        conflict = db.query(models.Company).filter(models.Company.tax_id == data.tax_id).first()
        if conflict: raise HTTPException(409, "Tax ID already exists.")
    c.name = data.name; c.tax_id = data.tax_id
    c.chamber_id = data.chamber_id; c.opening_stock = data.opening_stock
    db.commit(); db.refresh(c)
    return c

@app.delete("/companies/{company_id}", status_code=204)
def delete_company(company_id: int, db: Session = Depends(get_db)):
    c = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not c: raise HTTPException(404, "Company not found.")
    db.query(models.Transaction).filter(models.Transaction.company_id == company_id).delete()
    db.query(models.Exit).filter(models.Exit.company_id == company_id).delete()
    db.query(models.DailySalesInput).filter(models.DailySalesInput.company_id == company_id).delete()
    db.delete(c); db.commit()


# ── Counterparties (sellers + buyers) ────────────────────────────────────

@app.post("/counterparties", response_model=schemas.Counterparty)
def create_counterparty(data: schemas.CounterpartyCreate, db: Session = Depends(get_db)):
    return crud.get_or_create_counterparty(db, data.name, data.tax_id)

@app.get("/counterparties", response_model=List[schemas.Counterparty])
def get_counterparties(db: Session = Depends(get_db)):
    return db.query(models.Counterparty).all()

# Legacy seller endpoints (backward compat)
@app.post("/sellers", response_model=schemas.Counterparty)
def create_seller(data: schemas.CounterpartyCreate, db: Session = Depends(get_db)):
    return crud.get_or_create_counterparty(db, data.name, data.tax_id)

@app.get("/sellers", response_model=List[schemas.Counterparty])
def get_sellers(db: Session = Depends(get_db)):
    return db.query(models.Counterparty).all()


# ── Transactions (entries) ────────────────────────────────────────────────

@app.post("/companies/{company_id}/days/{day}/transactions", response_model=schemas.Transaction)
def add_transaction(company_id: int, day: date, data: schemas.TransactionCreate, db: Session = Depends(get_db)):
    return crud.create_transaction(db, company_id, day, data)

@app.get("/companies/{company_id}/days/{day}/transactions", response_model=List[schemas.Transaction])
def get_transactions(company_id: int, day: date, db: Session = Depends(get_db)):
    return db.query(models.Transaction).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date == day,
    ).order_by(models.Transaction.id).all()

@app.put("/companies/{company_id}/transactions/{tx_id}", response_model=schemas.Transaction)
def update_transaction(company_id: int, tx_id: int, data: schemas.TransactionCreate, db: Session = Depends(get_db)):
    tx = db.query(models.Transaction).filter(
        models.Transaction.id == tx_id, models.Transaction.company_id == company_id).first()
    if not tx: raise HTTPException(404, "Transaction not found.")
    return crud.update_transaction(db, tx, data)

@app.delete("/companies/{company_id}/transactions/{tx_id}", status_code=204)
def delete_transaction(company_id: int, tx_id: int, db: Session = Depends(get_db)):
    tx = db.query(models.Transaction).filter(
        models.Transaction.id == tx_id, models.Transaction.company_id == company_id).first()
    if not tx: raise HTTPException(404, "Transaction not found.")
    db.delete(tx); db.commit()


# ── Exits ─────────────────────────────────────────────────────────────────

@app.post("/companies/{company_id}/days/{day}/exits", response_model=schemas.ExitSchema)
def add_exit(company_id: int, day: date, data: schemas.ExitCreate, db: Session = Depends(get_db)):
    return crud.create_exit(db, company_id, day, data)

@app.get("/companies/{company_id}/days/{day}/exits", response_model=List[schemas.ExitSchema])
def get_exits(company_id: int, day: date, db: Session = Depends(get_db)):
    return db.query(models.Exit).filter(
        models.Exit.company_id == company_id,
        models.Exit.date == day,
    ).order_by(models.Exit.id).all()

@app.put("/companies/{company_id}/exits/{exit_id}", response_model=schemas.ExitSchema)
def update_exit(company_id: int, exit_id: int, data: schemas.ExitCreate, db: Session = Depends(get_db)):
    ex = db.query(models.Exit).filter(
        models.Exit.id == exit_id, models.Exit.company_id == company_id).first()
    if not ex: raise HTTPException(404, "Exit not found.")
    return crud.update_exit(db, ex, data)

@app.delete("/companies/{company_id}/exits/{exit_id}", status_code=204)
def delete_exit(company_id: int, exit_id: int, db: Session = Depends(get_db)):
    ex = db.query(models.Exit).filter(
        models.Exit.id == exit_id, models.Exit.company_id == company_id).first()
    if not ex: raise HTTPException(404, "Exit not found.")
    db.delete(ex); db.commit()


# ── Active days ───────────────────────────────────────────────────────────

@app.get("/companies/{company_id}/active-days", response_model=List[str])
def get_active_days(company_id: int, db: Session = Depends(get_db)):
    tx_dates = db.query(models.Transaction.date).filter(
        models.Transaction.company_id == company_id).distinct()
    ex_dates = db.query(models.Exit.date).filter(
        models.Exit.company_id == company_id).distinct()
    all_dates = set()
    for r in tx_dates: all_dates.add(r[0].isoformat())
    for r in ex_dates: all_dates.add(r[0].isoformat())
    return sorted(all_dates)


# ── Daily report ──────────────────────────────────────────────────────────

@app.get("/companies/{company_id}/days/{day}", response_model=schemas.DailyReport)
def get_daily_report(company_id: int, day: date, db: Session = Depends(get_db)):
    return crud.get_daily_report(db, company_id, day)


# ── Summaries ─────────────────────────────────────────────────────────────

@app.get("/companies/{company_id}/summary/month/{year}/{month}",
         response_model=schemas.MonthlySummaryResponse)
def get_monthly_summary(company_id: int, year: int, month: int, db: Session = Depends(get_db)):
    return crud.get_monthly_summary(db, company_id, year, month)

@app.get("/companies/{company_id}/summary/year/{year}",
         response_model=schemas.YearlySummaryResponse)
def get_yearly_summary(company_id: int, year: int, db: Session = Depends(get_db)):
    return crud.get_yearly_summary(db, company_id, year)


# ── Utility ───────────────────────────────────────────────────────────────

@app.get("/")
def root(): return {"message": "Accounting Assistant API is running"}

@app.get("/health")
def health(): return {"status": "healthy"}
