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

## System design and SRS diagrams

After generating a design, the **System design** view and SRS render requirement-derived Mermaid diagrams directly in the webpage; no Markdown file is downloaded. HLD and LLD views are explored progressively: select a level, use-case flow, and one diagram at a time. Each view includes the matched requirement text and mapped components, API operations, entities, and flow steps, plus its rationale and alternative. An architecture review records the advocate proposal, challenger objections, advocate response, accepted/deferred issues, and adjudication. Deployment choices distinguish recommendations from user-mandated decisions; cloud provider, region, scale, broker, and cache remain open unless requirements establish them. The bottom-right design chat answers questions from the current run and can regenerate the design from a change request. If the hosted model is unavailable, chat reports that condition and returns any directly matched facts from the current design. Deterministic feasibility is a structural check, not proof of production readiness; missing acceptance thresholds and assumptions are reported for review.

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
GEMINI_MODEL=gemini-3.5-flash
MAX_REVISIONS=2
```

Start the API:

```powershell
uvicorn app.main:app --host 127.0.0.1 --port 8004
```

The backend defaults to `LLM_PROVIDER=gemini` and requires `GEMINI_API_KEY`. Set `LLM_PROVIDER=demo` explicitly to run with deterministic, non-AI demo responses. Gemini configuration, API, and response-format errors are returned as HTTP 502 errors instead of being hidden by generated fallback designs.
Each generated design uses several Gemini requests for the analysis, discipline, architecture, design, and critique stages. Gemini rate limits (HTTP 429) are reported as errors and are not silently retried or replaced with demo output. Rule checks, Mermaid diagram assembly, use-case formatting, and deployment recommendations remain deterministic application logic rather than LLM calls.

### Frontend

```powershell
cd frontend
npm install
$env:VITE_API_URL="http://127.0.0.1:8004"
npm run dev
```

Open `http://127.0.0.1:5173`.

## Deploy for free with Render

The repository includes a Render Blueprint at [`render.yaml`](./render.yaml) that deploys the API and frontend as separate services. The frontend is a free static site; the API uses Render's free Python web-service tier. Free API instances can sleep when idle, so the first request after a quiet period may take longer. Free-tier limits and availability can change.

1. Push this repository to GitHub. Do not commit `backend/.env` or any API key.
2. Sign in to [Render](https://render.com), choose **New** → **Blueprint**, and connect this repository.
3. Review the services from `render.yaml` and select **Apply**. Render will ask for the `GEMINI_API_KEY` secret; enter your Google AI Studio Gemini API key. Wait for both services to finish their initial deploy.
4. Open `https://designforge-frontend.onrender.com`. The API health endpoint is `https://designforge-api.onrender.com/health`.
5. The API is configured for Gemini and will return an explicit error if the key is missing or the provider request fails. The `/health` endpoint reports whether a key is configured (`provider_configured`); only a real provider request confirms that the key and model are valid.

To deploy without Gemini, set `LLM_PROVIDER=demo` in the `designforge-api` environment settings. Demo mode is deterministic and does not call an AI model.

The Blueprint configures the API's CORS allowlist for the frontend's default Render URL. If Render reports either service name is already taken, change the corresponding `name` in `render.yaml`, update the frontend's `VITE_API_URL` to the API's actual `https://<service-name>.onrender.com` URL, and update the API's `ALLOWED_ORIGINS` to the frontend's actual URL. Apply the Blueprint again after editing.

The `VITE_API_URL` setting is embedded into the frontend at build time. If changing it from the Render dashboard rather than the Blueprint, trigger a new frontend deploy after changing the variable. Prometheus in `docker-compose.yml` is optional and is not needed for the hosted application.

## API

- `GET /health` checks service availability.
- `POST /generate` accepts `{ "requirements_text": "..." }`.
- `POST /change` accepts the current requirements and a natural-language change request, then regenerates the full design.
- `POST /chat` accepts a message, recent conversation, and current design context for grounded design Q&A.
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
