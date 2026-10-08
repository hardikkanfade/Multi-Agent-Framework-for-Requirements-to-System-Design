from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .graph import run_pipeline
from .models import ChangeRequest, GenerateRequest, RunResponse

app = FastAPI(title="DesignForge API", version="0.1.0")
app.add_middleware(
	CORSMiddleware,
	allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"],
	allow_origin_regex=r"http://(localhost|127\.0\.0\.1):517[0-9]",
	allow_methods=["*"],
	allow_headers=["*"],
)

@app.get("/health")
def health():
    from .config import settings
    return {"status": "ok", "provider_mode": settings.llm_provider}

@app.post("/generate", response_model=RunResponse)
async def generate(request: GenerateRequest):
	return RunResponse(**(await run_pipeline(request.requirements_text)))

@app.post("/change", response_model=RunResponse)
async def change_design(request: ChangeRequest):
	updated = f"{request.requirements_text.strip()}\nChange requested by reviewer: {request.change_request.strip()}"
	return RunResponse(**(await run_pipeline(updated)))

@app.post("/stages/analyze")
async def analyze_stage(request: GenerateRequest):
	result = await run_pipeline(request.requirements_text)
	return result["requirements"]
