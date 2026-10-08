# DesignForge

DesignForge is an AI-driven requirements-to-system-design workbench. It turns natural-language requirements into a traceable architecture, component graph, API contract, data model, Mermaid diagrams, and generated SRS document.

The system uses hosted LLM reasoning and keeps local execution focused on orchestration, schema validation, deterministic evaluation, and the UI. No local large model or GPU is required.

## Agent workflow

```text
Requirements Analyst
	|
	+--> Application / Data / Security / Operations disciplines (parallel)
	|							|
	+--> Architecture Advocate + Challenger (parallel)	|
				\				/
				 MDF System Optimizer
					|
			 Component/API Designer
					|
	 Independent Red-Team Critic + Deterministic rule checks
					|
			 Bounded revision loop
```

The discipline analyses run concurrently and exchange explicit coupling variables. The system-level optimizer reconciles those analyses with the advocate/challenger debate under hard structural constraints. The returned MAMDO report records design variables, measured objectives, constraint evidence, and feasibility. Rule checks independently verify requirement traceability, API/entity references, and acyclic component edges; the share of untraceable components is reported as a soft objective. This adapts the paper's MDF coordination pattern to software design; it does not implement its UAV search simulation or image-map NCC reuse.

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
python -m unittest discover -s tests -v
```

Frontend production build:

```powershell
cd frontend
npm run build
```

The acceptance metrics and constraints are calculated locally and deterministically. Hosted LLM agents analyze disciplines, propose, challenge, adjudicate, design, and critique; they do not replace the rule-based feasibility gate.

## Documentation

- [Project technical explanation](docs/PROJECT_TECHNICAL_EXPLANATION.md)

Never commit `backend/.env` or API keys. Use `.env.example` as the configuration template.
