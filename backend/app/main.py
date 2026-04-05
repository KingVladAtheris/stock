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


# ====================== COMPANIES ======================

@app.post("/companies", response_model=schemas.Company)
def create_company(data: schemas.CompanyCreate, db: Session = Depends(get_db)):
    existing = db.query(models.Company).filter(models.Company.tax_id == data.tax_id).first()
    if existing:
        raise HTTPException(status_code=409, detail="A company with this tax ID already exists.")
    company = models.Company(
        name=data.name, tax_id=data.tax_id,
        chamber_id=data.chamber_id, opening_stock=data.opening_stock,
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return company

@app.get("/companies", response_model=List[schemas.Company])
def get_companies(db: Session = Depends(get_db)):
    return db.query(models.Company).all()

@app.get("/companies/{company_id}", response_model=schemas.Company)
def get_company(company_id: int, db: Session = Depends(get_db)):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")
    return company

@app.put("/companies/{company_id}", response_model=schemas.Company)
def update_company(company_id: int, data: schemas.CompanyCreate, db: Session = Depends(get_db)):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")
    if data.tax_id != company.tax_id:
        conflict = db.query(models.Company).filter(models.Company.tax_id == data.tax_id).first()
        if conflict:
            raise HTTPException(status_code=409, detail="A company with this tax ID already exists.")
    company.name = data.name
    company.tax_id = data.tax_id
    company.chamber_id = data.chamber_id
    company.opening_stock = data.opening_stock
    db.commit()
    db.refresh(company)
    return company

@app.delete("/companies/{company_id}", status_code=204)
def delete_company(company_id: int, db: Session = Depends(get_db)):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found.")
    db.query(models.Transaction).filter(models.Transaction.company_id == company_id).delete()
    db.query(models.DailySalesInput).filter(models.DailySalesInput.company_id == company_id).delete()
    db.delete(company)
    db.commit()


# ====================== SELLERS ======================

@app.post("/sellers", response_model=schemas.Seller)
def create_seller(data: schemas.SellerCreate, db: Session = Depends(get_db)):
    return crud.get_or_create_seller(db, data.name, data.tax_id)

@app.get("/sellers", response_model=List[schemas.Seller])
def get_sellers(db: Session = Depends(get_db)):
    return db.query(models.Seller).all()


# ====================== TRANSACTIONS ======================

@app.post("/companies/{company_id}/days/{day}/transactions", response_model=schemas.Transaction)
def add_transaction(
    company_id: int, day: date,
    transaction: schemas.TransactionCreate,
    db: Session = Depends(get_db),
):
    return crud.create_transaction(db, company_id, day, transaction)

@app.get("/companies/{company_id}/days/{day}/transactions", response_model=List[schemas.Transaction])
def get_transactions(company_id: int, day: date, db: Session = Depends(get_db)):
    return db.query(models.Transaction).filter(
        models.Transaction.company_id == company_id,
        models.Transaction.date == day,
    ).all()

@app.put("/companies/{company_id}/transactions/{transaction_id}", response_model=schemas.Transaction)
def update_transaction(
    company_id: int, transaction_id: int,
    data: schemas.TransactionCreate,
    db: Session = Depends(get_db),
):
    tx = db.query(models.Transaction).filter(
        models.Transaction.id == transaction_id,
        models.Transaction.company_id == company_id,
    ).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    return crud.update_transaction(db, tx, data)

@app.delete("/companies/{company_id}/transactions/{transaction_id}", status_code=204)
def delete_transaction(
    company_id: int, transaction_id: int,
    db: Session = Depends(get_db),
):
    tx = db.query(models.Transaction).filter(
        models.Transaction.id == transaction_id,
        models.Transaction.company_id == company_id,
    ).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    db.delete(tx)
    db.commit()


# ====================== DAILY SALES ======================

@app.put("/companies/{company_id}/days/{day}/total-sale", response_model=schemas.DailySalesInputSchema)
def set_total_sale(
    company_id: int, day: date,
    data: schemas.DailySalesInputSchema,
    db: Session = Depends(get_db),
):
    return crud.set_total_sale(db, company_id, day, data.total_sale)


# ====================== ACTIVE DAYS ======================

@app.get("/companies/{company_id}/active-days", response_model=List[str])
def get_active_days(company_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(models.Transaction.date)
        .filter(models.Transaction.company_id == company_id)
        .distinct().all()
    )
    return [r[0].isoformat() for r in rows]


# ====================== DAILY REPORT ======================

@app.get("/companies/{company_id}/days/{day}", response_model=schemas.DailyReport)
def get_daily_report(company_id: int, day: date, db: Session = Depends(get_db)):
    return crud.get_daily_report(db, company_id, day)


# ====================== MONTHLY SUMMARY ======================

@app.get("/companies/{company_id}/summary/month/{year}/{month}", response_model=List[schemas.DaySummary])
def get_monthly_summary(
    company_id: int, year: int, month: int,
    db: Session = Depends(get_db),
):
    return crud.get_monthly_summary(db, company_id, year, month)


# ====================== YEARLY SUMMARY ======================

@app.get("/companies/{company_id}/summary/year/{year}", response_model=List[schemas.MonthSummary])
def get_yearly_summary(
    company_id: int, year: int,
    db: Session = Depends(get_db),
):
    return crud.get_yearly_summary(db, company_id, year)


# ====================== UTILITY ======================

@app.get("/")
def root():
    return {"message": "Accounting Assistant API is running"}

@app.get("/health")
def health():
    return {"status": "healthy"}
