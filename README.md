# BOE FLOW Web

A new production-oriented web application replacing the Streamlit UI while preserving the existing Python BOE/HSN business logic.

## Stack
- Frontend: React + Vite
- Backend: FastAPI + Python
- BOE parsing: migrated from `Customs-boe-portal`
- HSN lookup: ICEGATE Trade Guide integration
- Excel export: migrated existing exporter
- Frontend hosting: Cloudflare Pages or Vercel
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

Recommended: deploy the frontend to Vercel and the FastAPI service to Render.

1. Create a Render web service from this repository. Render will use the root
   `render.yaml`; set `FRONTEND_ORIGINS` to the final Vercel and custom-domain
   origins, comma separated.
2. In the Vercel project, set `VITE_API_URL` to the public HTTPS URL of the
   Render service (for example, `https://boe-flow-api.onrender.com`).
3. Deploy the frontend and confirm `/api/health` on the Render URL, BOE upload,
   HSN lookup, and Excel download from the live site.

For a single Vercel deployment, leave `VITE_API_URL` unset; `vercel.json`
routes `/api/*` to the bundled backend service.

## Migration status
- Responsive React shell: complete
- BOE PDF upload and processing API: connected
- Existing BOE parser: migrated unchanged
- Existing Excel exporter: migrated
- ICEGATE HSN search: connected
- BCD/SWS/IGST values: sourced from the migrated BOE parser's printed ICEGATE item-duty fields
- E-Way Bill grouped summary: connected
- Authentication/database: not yet added
- Production domain/hosting: not yet configured

The original Streamlit repository is intentionally left unchanged.
