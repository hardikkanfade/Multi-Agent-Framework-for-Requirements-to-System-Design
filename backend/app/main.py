import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .config import settings
from .graph import run_pipeline
from .models import ChangeRequest, DesignChatRequest, GenerateRequest, RunResponse
from .providers import DemoProvider, ProviderError, get_provider
from prometheus_fastapi_instrumentator import Instrumentator

allowed_origins = [
	origin.strip()
	for origin in os.getenv(
		"ALLOWED_ORIGINS",
		"http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
	).split(",")
	if origin.strip()
]

app = FastAPI(title="DesignForge API", version="0.1.0")


@app.exception_handler(ProviderError)
async def provider_error_handler(request: Request, error: ProviderError):
	return JSONResponse(status_code=502, content={"detail": str(error)})


app.add_middleware(
	CORSMiddleware,
	allow_origins=allowed_origins,
	allow_origin_regex=r"http://(localhost|127\.0\.0\.1):517[0-9]",
	allow_methods=["*"],
	allow_headers=["*"],
)
Instrumentator().instrument(app).expose(app, endpoint="/metrics")

@app.get("/health")
def health():
	provider_mode = settings.llm_provider.strip().lower()
	provider_configured = provider_mode == "demo" or (
		provider_mode == "gemini" and bool(settings.gemini_api_key)
	)
	return {
		"status": "ok",
		"provider_mode": provider_mode,
		"provider_configured": provider_configured,
	}

@app.post("/generate", response_model=RunResponse)
async def generate(request: GenerateRequest):
	return RunResponse(**(await run_pipeline(request.requirements_text)))

@app.post("/change", response_model=RunResponse)
async def change_design(request: ChangeRequest):
	updated = f"{request.requirements_text.strip()}\nChange requested by reviewer: {request.change_request.strip()}"
	return RunResponse(**(await run_pipeline(updated)))

@app.post("/chat")
async def design_chat(request: DesignChatRequest):
	context = request.design_context
	message = request.message.casefold()
	matched_endpoints = [
		item for item in context.get("endpoints", [])
		if item.get("path", "").casefold() in message
	]
	matched_requirement_ids = {
		requirement_id
		for endpoint in matched_endpoints
		for requirement_id in endpoint.get("satisfies", [])
	}
	matched_requirements = [
		item for item in context.get("requirements", [])
		if item.get("id") in matched_requirement_ids or item.get("id", "").casefold() in message
	]
	matched_components = [
		item for item in context.get("components", [])
		if item.get("id") in {endpoint.get("component_id") for endpoint in matched_endpoints}
		or item.get("name", "").casefold() in message
	]
	matched_entities = [
		item for item in context.get("entities", [])
		if item.get("name", "").casefold() in message
	]
	details = []
	if matched_endpoints:
		details.append("API operations: " + ", ".join(
			f'{item.get("method", "")} {item.get("path", "")}' for item in matched_endpoints
		))
	if matched_requirements:
		details.append("Requirements: " + "; ".join(
			f'{item.get("id")}: {item.get("text")}' for item in matched_requirements
		))
	if matched_components:
		details.append("Components: " + ", ".join(item.get("name", "") for item in matched_components))
	if matched_entities:
		details.append("Entities: " + ", ".join(item.get("name", "") for item in matched_entities))
	context_only_reply = (
		"Context-only answer; this response uses only facts in the current generated design. "
		+ (context.get("summary") or "No generated design context is available.")
		+ ("\n" + "\n".join(details) if details else "")
	)
	prompt = f"""You are the design-review assistant inside DesignForge. Answer the user's question using only the supplied current-run design context and recent messages. Be concise, concrete, and name relevant requirement IDs, components, API operations, entities, diagram views, or recorded architecture-debate decisions. Clearly say when a detail is absent or an assumption; never invent a requirement, technology decision, metric, or implementation fact. If the user is asking to change the design, explain that they can switch to Request a change mode so the complete design is regenerated. Do not claim a change has been applied.
Current design context (JSON): {context}
Recent conversation (JSON): {[item.model_dump() for item in request.history]}
User message: {request.message}"""
	provider = get_provider()
	reply = await provider.complete_text(prompt, context_only_reply)
	return {
		"reply": reply,
		"provider_mode": "demo" if isinstance(provider, DemoProvider) else "gemini",
	}

@app.post("/stages/analyze")
async def analyze_stage(request: GenerateRequest):
	result = await run_pipeline(request.requirements_text)
	return result["requirements"]
