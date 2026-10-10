# BOE FLOW Web

A production-oriented web application replacing the Streamlit UI while preserving the existing Python BOE/HSN business logic.

## Stack
- Frontend: React + Vite
- Backend: FastAPI + Python
- BOE parsing: migrated from `Customs-boe-portal`
- HSN lookup: ICEGATE Trade Guide integration
- Excel export: migrated existing exporter
- Frontend hosting: Vercel
- Backend hosting: Render or another FastAPI host

## Local development

Frontend:
```bash
npm install
npm run dev
```

Backend:
```bash
cd backend
python -m venv .venv
pip install -r requirements-render.txt
uvicorn main:app --reload --port 8000
```

Set `VITE_API_URL=http://localhost:8000` for the frontend when the API is not on the default URL.

## Production deployment

**Deploy the frontend and backend separately.** The FastAPI backend includes PDF-processing dependencies that can exceed Vercel's serverless function bundle limit.

### 1. Deploy the backend to Render
Create a Render Web Service from this repository. Render uses the root `render.yaml`, which sets `rootDir: backend` and installs `requirements-render.txt`. Set `FRONTEND_ORIGINS` to the Vercel website origin (and any custom-domain origins), comma separated.

Confirm the backend health endpoint responds successfully at:
`https://YOUR-RENDER-SERVICE.onrender.com/api/health`

### 2. Configure Vercel
Deploy the repository root as a Vite project:
- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `VITE_API_URL=https://YOUR-RENDER-SERVICE.onrender.com`

Replace the example URL with the actual Render service URL. Redeploy Vercel after setting the environment variable. Vercel is configured for the frontend only; it does not bundle or host the Python API.

### 3. Verify
Test `/api/health` on Render, then test BOE PDF upload, HSN lookup, and Excel download from the live Vercel website.

## Migration status
- Responsive React shell: complete
- BOE PDF upload and processing API: connected
- Existing BOE parser: migrated unchanged
- Existing Excel exporter: migrated
- ICEGATE HSN search: connected
- BCD/SWS/IGST values: sourced from the migrated BOE parser's printed ICEGATE item-duty fields
- E-Way Bill grouped summary: connected
- Authentication/database: not yet added
- Production domain/hosting: configure using the steps above

The original Streamlit repository is intentionally left unchanged.
