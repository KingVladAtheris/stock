# backend/app/main.py
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from datetime import date
from typing import List

from .database import engine, get_db, Base
from . import models, schemas, crud
from .auth import (
    verify_password, create_access_token,
    get_current_user, hash_password,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Accounting Assistant API")
app.add_middleware(CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


# ── Auth ───────────────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=schemas.Token, status_code=201)
def register(data: schemas.UserCreate, db: Session = Depends(get_db)):
    if len(data.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters.")
    if crud.get_user_by_email(db, data.email):
        raise HTTPException(409, "An account with this email already exists.")
    user = crud.create_user(db, data.email, data.password)
    return schemas.Token(access_token=create_access_token(user.id))

@app.post("/auth/login", response_model=schemas.Token)
def login(data: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = crud.get_user_by_email(db, data.email)
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password.")
    return schemas.Token(access_token=create_access_token(user.id))

@app.get("/auth/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(get_current_user)):
    return current_user

@app.post("/auth/change-password", status_code=204)
def change_password(
    data: schemas.LoginRequest,         # re-sends email + new password
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if len(data.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters.")
    current_user.hashed_password = hash_password(data.password)
    db.commit()


# ── Companies (user-scoped) ────────────────────────────────────────────────

@app.post("/companies", response_model=schemas.Company, status_code=201)
def create_company(data: schemas.CompanyCreate,
                   db: Session = Depends(get_db),
                   user: models.User = Depends(get_current_user)):
    if db.query(models.Company).filter(
        models.Company.user_id == user.id, models.Company.tax_id == data.tax_id
    ).first():
        raise HTTPException(409, "A company with this tax ID already exists.")
    c = models.Company(user_id=user.id, name=data.name, tax_id=data.tax_id,
                       chamber_id=data.chamber_id,
                       opening_stock_no_vat=data.opening_stock_no_vat,
                       opening_stock_vat=data.opening_stock_vat,
                       opening_stock_total=data.opening_stock_total)
    db.add(c); db.commit(); db.refresh(c); return c

@app.get("/companies", response_model=List[schemas.Company])
def get_companies(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return db.query(models.Company).filter(models.Company.user_id == user.id).all()

@app.get("/companies/{cid}", response_model=schemas.Company)
def get_company(cid: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return crud._get_company(db, cid, user.id)

@app.put("/companies/{cid}", response_model=schemas.Company)
def update_company(cid: int, data: schemas.CompanyCreate,
                   db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    c = crud._get_company(db, cid, user.id)
    if data.tax_id != c.tax_id:
        if db.query(models.Company).filter(models.Company.user_id==user.id, models.Company.tax_id==data.tax_id).first():
            raise HTTPException(409, "Tax ID already exists.")
    c.name=data.name; c.tax_id=data.tax_id; c.chamber_id=data.chamber_id
    c.opening_stock_no_vat=data.opening_stock_no_vat; c.opening_stock_vat=data.opening_stock_vat; c.opening_stock_total=data.opening_stock_total
    db.commit(); db.refresh(c); return c

@app.delete("/companies/{cid}", status_code=204)
def delete_company(cid: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    c = crud._get_company(db, cid, user.id)
    db.delete(c); db.commit()

@app.put("/companies/{cid}/close-ledger", response_model=schemas.Company)
def close_ledger(cid: int, data: schemas.CloseLedgerRequest,
                 db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    c = crud._get_company(db, cid, user.id)
    c.ledger_closed_date = data.closed_date
    db.commit(); db.refresh(c); return c

@app.delete("/companies/{cid}/close-ledger", response_model=schemas.Company)
def reopen_ledger(cid: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    c = crud._get_company(db, cid, user.id)
    c.ledger_closed_date = None
    db.commit(); db.refresh(c); return c


# ── Counterparties ─────────────────────────────────────────────────────────

@app.post("/counterparties", response_model=schemas.Counterparty)
def create_counterparty(data: schemas.CounterpartyCreate,
                        db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    return crud.get_or_create_counterparty(db, data.name, data.tax_id)

@app.get("/counterparties", response_model=List[schemas.Counterparty])
def get_counterparties(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    return db.query(models.Counterparty).all()

@app.post("/sellers", response_model=schemas.Counterparty)
def create_seller(data: schemas.CounterpartyCreate,
                  db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    return crud.get_or_create_counterparty(db, data.name, data.tax_id)

@app.get("/sellers", response_model=List[schemas.Counterparty])
def get_sellers(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    return db.query(models.Counterparty).all()


# ── Products ───────────────────────────────────────────────────────────────

@app.post("/companies/{cid}/products", response_model=schemas.Product)
def create_product(cid: int, data: schemas.ProductCreate,
                   db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)   # ownership check
    return crud.get_or_create_product(db, cid, data.name)

@app.get("/companies/{cid}/products", response_model=List[schemas.Product])
def get_products(cid: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    return crud.get_products(db, cid)


# ── Inventory ──────────────────────────────────────────────────────────────

@app.get("/companies/{cid}/inventory", response_model=List[schemas.InventoryItem])
def get_inventory(cid: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    return crud.get_inventory(db, cid)


# ── Transactions ───────────────────────────────────────────────────────────

@app.post("/companies/{cid}/days/{day}/transactions", response_model=schemas.Transaction)
def add_transaction(cid: int, day: date, data: schemas.TransactionCreate,
                    db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    return crud.create_transaction(db, cid, day, data)

@app.get("/companies/{cid}/days/{day}/transactions", response_model=List[schemas.Transaction])
def get_transactions(cid: int, day: date, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    txs = db.query(models.Transaction).filter(models.Transaction.company_id==cid, models.Transaction.date==day).order_by(models.Transaction.id).all()
    return [crud._enrich_transaction(t) for t in txs]

@app.put("/companies/{cid}/transactions/{tid}", response_model=schemas.Transaction)
def update_transaction(cid: int, tid: int, data: schemas.TransactionCreate,
                       db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    tx = db.query(models.Transaction).filter(models.Transaction.id==tid, models.Transaction.company_id==cid).first()
    if not tx: raise HTTPException(404, "Not found.")
    return crud._enrich_transaction(crud.update_transaction(db, tx, data))

@app.delete("/companies/{cid}/transactions/{tid}", status_code=204)
def delete_transaction(cid: int, tid: int,
                       db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    tx = db.query(models.Transaction).filter(models.Transaction.id==tid, models.Transaction.company_id==cid).first()
    if not tx: raise HTTPException(404, "Not found.")
    db.delete(tx); db.commit()


# ── Transaction items ──────────────────────────────────────────────────────

@app.post("/companies/{cid}/transactions/{tid}/items", response_model=schemas.TransactionItemSchema)
def add_transaction_item(cid: int, tid: int, data: schemas.TransactionItemCreate,
                         db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    tx = db.query(models.Transaction).filter(models.Transaction.id==tid, models.Transaction.company_id==cid).first()
    if not tx: raise HTTPException(404, "Not found.")
    return crud.create_transaction_item(db, cid, tid, data)

@app.put("/companies/{cid}/transaction-items/{item_id}", response_model=schemas.TransactionItemSchema)
def update_transaction_item(cid: int, item_id: int, data: schemas.TransactionItemCreate,
                            db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    ti = db.query(models.TransactionItem).join(models.Transaction).filter(models.TransactionItem.id==item_id, models.Transaction.company_id==cid).first()
    if not ti: raise HTTPException(404, "Not found.")
    return crud.update_transaction_item(db, cid, ti, data)

@app.delete("/companies/{cid}/transaction-items/{item_id}", status_code=204)
def delete_transaction_item(cid: int, item_id: int,
                            db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    ti = db.query(models.TransactionItem).join(models.Transaction).filter(models.TransactionItem.id==item_id, models.Transaction.company_id==cid).first()
    if not ti: raise HTTPException(404, "Not found.")
    crud.delete_transaction_item(db, cid, ti)


# ── Exits ──────────────────────────────────────────────────────────────────

@app.post("/companies/{cid}/days/{day}/exits", response_model=schemas.ExitSchema)
def add_exit(cid: int, day: date, data: schemas.ExitCreate,
             db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    return crud._enrich_exit(crud.create_exit(db, cid, day, data))

@app.get("/companies/{cid}/days/{day}/exits", response_model=List[schemas.ExitSchema])
def get_exits(cid: int, day: date, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    exs = db.query(models.Exit).filter(models.Exit.company_id==cid, models.Exit.date==day).order_by(models.Exit.id).all()
    return [crud._enrich_exit(e) for e in exs]

@app.put("/companies/{cid}/exits/{eid}", response_model=schemas.ExitSchema)
def update_exit(cid: int, eid: int, data: schemas.ExitCreate,
                db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    ex = db.query(models.Exit).filter(models.Exit.id==eid, models.Exit.company_id==cid).first()
    if not ex: raise HTTPException(404, "Not found.")
    return crud._enrich_exit(crud.update_exit(db, ex, data))

@app.delete("/companies/{cid}/exits/{eid}", status_code=204)
def delete_exit(cid: int, eid: int,
                db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    ex = db.query(models.Exit).filter(models.Exit.id==eid, models.Exit.company_id==cid).first()
    if not ex: raise HTTPException(404, "Not found.")
    db.delete(ex); db.commit()


# ── Exit items ─────────────────────────────────────────────────────────────

@app.post("/companies/{cid}/exits/{eid}/items", response_model=schemas.ExitItemSchema)
def add_exit_item(cid: int, eid: int, data: schemas.ExitItemCreate,
                  db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    ex = db.query(models.Exit).filter(models.Exit.id==eid, models.Exit.company_id==cid).first()
    if not ex: raise HTTPException(404, "Not found.")
    return crud.create_exit_item(db, cid, eid, data)

@app.put("/companies/{cid}/exit-items/{item_id}", response_model=schemas.ExitItemSchema)
def update_exit_item(cid: int, item_id: int, data: schemas.ExitItemCreate,
                     db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    ei = db.query(models.ExitItem).join(models.Exit).filter(models.ExitItem.id==item_id, models.Exit.company_id==cid).first()
    if not ei: raise HTTPException(404, "Not found.")
    return crud.update_exit_item(db, cid, ei, data)

@app.delete("/companies/{cid}/exit-items/{item_id}", status_code=204)
def delete_exit_item(cid: int, item_id: int,
                     db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    ei = db.query(models.ExitItem).join(models.Exit).filter(models.ExitItem.id==item_id, models.Exit.company_id==cid).first()
    if not ei: raise HTTPException(404, "Not found.")
    crud.delete_exit_item(db, cid, ei)


# ── Active days ────────────────────────────────────────────────────────────

@app.get("/companies/{cid}/active-days", response_model=List[str])
def get_active_days(cid: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    td={r[0].isoformat() for r in db.query(models.Transaction.date).filter(models.Transaction.company_id==cid).distinct()}
    xd={r[0].isoformat() for r in db.query(models.Exit.date).filter(models.Exit.company_id==cid).distinct()}
    return sorted(td|xd)


# ── Daily report ───────────────────────────────────────────────────────────

@app.get("/companies/{cid}/days/{day}", response_model=schemas.DailyReport)
def get_daily_report(cid: int, day: date, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    return crud.get_daily_report(db, cid, day)


# ── Summaries ──────────────────────────────────────────────────────────────

@app.get("/companies/{cid}/summary/month/{year}/{month}", response_model=schemas.MonthlySummaryResponse)
def monthly(cid: int, year: int, month: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    return crud.get_monthly_summary(db, cid, year, month)

@app.get("/companies/{cid}/summary/year/{year}", response_model=schemas.YearlySummaryResponse)
def yearly(cid: int, year: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    crud._get_company(db, cid, user.id)
    return crud.get_yearly_summary(db, cid, year)


@app.get("/")
def root(): return {"message": "OK"}
@app.get("/health")
def health(): return {"status": "healthy"}
