# start.ps1
.\venv\Scripts\Activate.ps1
Write-Host "🚀 Starting Accounting Assistant Backend..." -ForegroundColor Green
uvicorn app.main:app --reload --port 8000