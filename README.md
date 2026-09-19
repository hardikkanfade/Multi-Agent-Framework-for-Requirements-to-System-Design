# DesignForge

DesignForge is an AI-driven requirements-to-system-design workbench. It turns natural-language requirements into a traceable architecture, component graph, API contract, data model, Mermaid diagrams, and generated SRS document.

The system uses hosted LLM reasoning and keeps local execution focused on orchestration, schema validation, deterministic evaluation, and the UI. No local large model or GPU is required.

## Agent workflow

```text
Requirements Analyst
	|
	+--> Architecture Advocate --+
	|                             +--> Architecture Adjudicator
	+--> Architecture Challenger-+
				      |
			 Component/API Designer
				      |
			  Independent Red-Team Critic
				      |
			   Revision Controller loop
				      |
			 Deterministic acceptance rules
```

The advocate and challenger run concurrently. The adjudicator selects the simplest architecture that addresses the challenger findings. The rule engine independently checks requirement traceability, API/entity references, component edges, and dependency consistency.

## Requirements

- Python 3.13+
- Node.js 20+
- A Gemini API key for hosted mode

## Run locally

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Edit `backend/.env`:

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
MAX_REVISIONS=2
```

Start the API:

```powershell
uvicorn app.main:app --host 127.0.0.1 --port 8003
```

For reproducible offline/demo mode, use `LLM_PROVIDER=demo`. The deterministic fallbacks still produce a complete design package.

### Frontend

```powershell
cd frontend
npm install
$env:VITE_API_URL="http://127.0.0.1:8003"
npm run dev
```

Open `http://127.0.0.1:5173`.

## API

- `GET /health` checks service availability.
- `POST /generate` accepts `{ "requirements_text": "..." }`.
- `POST /change` accepts the current requirements and a natural-language change request, then regenerates the full design.
- `POST /stages/analyze` returns the extracted requirements model.

## Validation

Backend compile check:

```powershell
cd backend
python -m compileall -q .
```

Frontend production build:

```powershell
cd frontend
npm run build
```

The acceptance scores are calculated locally and deterministically. Hosted LLM agents propose, challenge, adjudicate, design, and critique; they do not replace the rule-based quality gate.

## Documentation

- [Software Requirements Specification](docs/SRS.md)
- [System Design Report](docs/SYSTEM_DESIGN_REPORT.md)

Never commit `backend/.env` or API keys. Use `.env.example` as the configuration template.
