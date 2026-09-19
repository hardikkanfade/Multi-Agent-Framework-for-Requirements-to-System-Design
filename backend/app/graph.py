import asyncio
from typing import TypedDict
from uuid import uuid4

from langgraph.graph import END, StateGraph

from .config import settings
from .models import Architecture, Critique, Design, Requirements
from .providers import ProviderError, get_provider
from .rules import evaluate_rules


class PipelineState(TypedDict, total=False):
	raw: str
	requirements: Requirements
	architecture: Architecture
	architecture_debate: dict
	design: Design
	critique: Critique
	critique_feedback: str
	revisions: int


async def _complete_json_with_retry(provider, prompt: str, fallback: dict) -> dict:
	for attempt in range(2):
		try:
			return await provider.complete_json(prompt, fallback)
		except ProviderError:
			if attempt == 1:
				raise
			await asyncio.sleep(0.2)


async def _complete_text_with_retry(provider, prompt: str, fallback: str) -> str:
	for attempt in range(2):
		try:
			return await provider.complete_text(prompt, fallback)
		except ProviderError:
			if attempt == 1:
				raise
			await asyncio.sleep(0.2)


def _local_requirements(text: str) -> Requirements:
	sentences = [part.strip() for part in text.replace("\n", ".").split(".") if part.strip()]
	functional, non_functional = [], []
	for index, sentence in enumerate(sentences, 1):
		item = {"id": f"FR-{index}", "text": sentence, "kind": "functional", "confidence": 0.86}
		if any(word in sentence.lower() for word in ["must", "latency", "secure", "availability", "within", "encrypted", "performance"]):
			item["kind"] = "non_functional"
			non_functional.append(item)
		else:
			functional.append(item)
	ambiguities = []
	for index, sentence in enumerate(sentences, 1):
		if any(word in sentence.lower() for word in ["fast", "secure", "scalable", "user-friendly", "soon"]):
			ambiguities.append({"id": f"AMB-{index}", "description": f"Define measurable acceptance criteria for: {sentence}", "confidence": 0.9, "related_requirement_ids": [f"FR-{index}"]})
	return Requirements(functional=functional, non_functional=non_functional, ambiguities=ambiguities)


async def analyze_requirements(state: PipelineState) -> dict:
	text = state["raw"].strip()
	fallback = _local_requirements(text)
	prompt = f"""You are the Requirements Analyst agent. Extract a precise, complete requirements model from the user's text. Separate functional and non-functional requirements, identify ambiguity, and never invent domain features. Return JSON with exactly this shape: {{"functional":[{{"id":"FR-1","text":"...","kind":"functional","confidence":0.0}}],"non_functional":[{{"id":"NFR-1","text":"...","kind":"non_functional","confidence":0.0}}],"ambiguities":[{{"id":"AMB-1","description":"...","confidence":0.0,"related_requirement_ids":["FR-1"]}}],"conflicts":[]}}. User text: {text}"""
	try:
		data = await get_provider().complete_json(prompt, fallback.model_dump())
		return {"requirements": Requirements.model_validate(data)}
	except (ProviderError, ValueError, TypeError):
		return {"requirements": fallback}


def _local_architecture(requirements: Requirements) -> Architecture:
	text = " ".join(item.text.lower() for item in requirements.all_requirements)
	style = "microservices" if any(term in text for term in ["independent teams", "multi-region", "independent scaling"]) else "modular_monolith"
	store = "nosql" if "document" in text or "feed" in text else "relational"
	return Architecture(style=style, justification="A modular monolith keeps deployment and consistency simple for a small team while preserving component boundaries; microservices are reserved for explicit independent-scaling or team-boundary evidence.", trade_offs=["Lower operational overhead and simpler transactions", "Module boundaries can later be extracted", "A single deployable unit limits independent scaling"], components=["api", "identity", "application", "persistence"], data_store=store, data_store_justification="Relational storage supports explicit relationships and transactional workflows in the scoped backend domain.", traceability={item.id: ["api", "application"] for item in requirements.all_requirements})


async def propose_architecture(state: PipelineState) -> dict:
	requirements = state["requirements"]
	fallback = _local_architecture(requirements)
	provider = get_provider()
	advocate_prompt = f"You are the Architecture Advocate. Propose the simplest production-ready architecture for these requirements. Return only JSON matching this Architecture schema: {fallback.model_dump_json()}. Requirements: {requirements.model_dump_json()}"
	challenger_prompt = f"You are the independent Architecture Challenger. Attack the likely simplest architecture for these requirements. Identify concrete risks, missing boundaries, security concerns, scaling concerns, and unnecessary complexity. Return 2-4 concise objection bullets as plain text, with no JSON and no preamble. Requirements: {requirements.model_dump_json()}"
	advocate_task = asyncio.create_task(_complete_json_with_retry(provider, advocate_prompt, fallback.model_dump()))
	challenger_task = asyncio.create_task(_complete_text_with_retry(provider, challenger_prompt, "No hosted challenger available."))
	advocate_data, challenger_data = await asyncio.gather(advocate_task, challenger_task, return_exceptions=True)
	advocate = fallback if isinstance(advocate_data, BaseException) else Architecture.model_validate(advocate_data)
	challenger_summary = "No hosted challenger available." if isinstance(challenger_data, BaseException) else str(challenger_data)
	adjudicator_prompt = f"You are the Architecture Adjudicator. Evaluate the advocate proposal against the challenger's objections. Select the simplest architecture that addresses real risks, remove unnecessary complexity, and return JSON with selected matching this schema: {fallback.model_dump_json()}, decision_rationale, rejected_alternative. Requirements: {requirements.model_dump_json()} Advocate: {advocate.model_dump_json()} Challenger objections: {challenger_summary}"
	try:
		selected_data = await provider.complete_json(adjudicator_prompt, {"selected": advocate.model_dump(), "decision_rationale": advocate.justification, "rejected_alternative": fallback.style})
		selected = Architecture.model_validate(selected_data.get("selected", advocate.model_dump()))
		debate = {"advocate_summary": advocate.justification, "challenger_summary": challenger_summary, "rejected_alternative": selected_data.get("rejected_alternative", fallback.style), "decision_rationale": selected_data.get("decision_rationale", selected.justification)}
		return {"architecture": selected, "architecture_debate": debate}
	except (ProviderError, ValueError, TypeError):
		return {"architecture": advocate, "architecture_debate": {"advocate_summary": advocate.justification, "challenger_summary": challenger_summary, "rejected_alternative": fallback.style, "decision_rationale": advocate.justification}}


def _local_design(requirements: Requirements) -> Design:
	tags = [item.id for item in requirements.all_requirements]
	text = " ".join(item.text.lower() for item in requirements.all_requirements)
	components = [{"id": "api", "name": "REST API", "kind": "interface", "satisfies": tags[:]}, {"id": "application", "name": "Application Service", "kind": "service", "satisfies": tags[:]}, {"id": "persistence", "name": "Relational Repository", "kind": "data", "satisfies": [tag for tag in tags if tag.startswith("FR-")]}]
	edges = [{"source": "api", "target": "application", "label": "invokes"}, {"source": "application", "target": "persistence", "label": "reads/writes"}]
	if any(word in text for word in ["auth", "administrator", "role", "login"]):
		components.insert(1, {"id": "identity", "name": "Identity and Access", "kind": "security", "satisfies": tags[:]})
		edges.extend([{ "source": "api", "target": "identity", "label": "authorizes"}, {"source": "identity", "target": "application", "label": "passes principal"}])
	entities = [{"name": "Item", "fields": [{"name": "id", "type": "uuid"}, {"name": "created_at", "type": "timestamp"}], "relationships": [], "satisfies": tags}]
	if "audit" in text:
		entities.append({"name": "AuditLog", "fields": [{"name": "id", "type": "uuid"}, {"name": "action", "type": "string"}, {"name": "created_at", "type": "timestamp"}], "relationships": ["Item"], "satisfies": tags})
	return Design(components=components, edges=edges, entities=entities, endpoints=[{"method": "GET", "path": "/items", "component_id": "api", "response_entity": "Item", "satisfies": tags[:1] or tags}, {"method": "POST", "path": "/items", "component_id": "api", "request_entity": "Item", "response_entity": "Item", "satisfies": tags[:1] or tags}])


async def design_components(state: PipelineState) -> dict:
	requirements = state["requirements"]
	fallback = _local_design(requirements)
	prompt = f"""You are the Component and API Designer agent. Produce a minimal but complete implementation design from the requirements and selected architecture. Preserve traceability: every requirement ID must appear on at least one component and endpoint. Do not add speculative features. Correct the prior critic feedback if present. Return JSON matching this schema exactly: {fallback.model_dump_json()}. Requirements: {requirements.model_dump_json()} Architecture: {state['architecture'].model_dump_json()} Architecture debate: {state.get('architecture_debate', {})} Prior critic feedback: {state.get('critique_feedback', '')}"""
	try:
		data = await get_provider().complete_json(prompt, fallback.model_dump())
		return {"design": Design.model_validate(data)}
	except (ProviderError, ValueError, TypeError):
		return {"design": fallback}


async def critique_design(state: PipelineState) -> dict:
	checks = evaluate_rules(state["requirements"], state["design"])
	issues = []
	if checks.traceability_percent < 100:
		issues.append({"severity": "high", "category": "unmet_requirement", "message": "At least one requirement is not tagged on a component or endpoint.", "related_ids": []})
	if checks.over_engineering_rate > 0:
		issues.append({"severity": "medium", "category": "over_engineering", "message": "At least one component has no traceability tag.", "related_ids": []})
	if checks.consistency_score < 100:
		issues.append({"severity": "critical", "category": "inconsistency", "message": "Rule checks found invalid references or a cyclic dependency.", "related_ids": []})
	rule_critique = Critique(accepted=not any(issue["severity"] in {"high", "critical"} for issue in issues), issues=issues, rule_checks=checks, summary="Design passes automated structural checks." if not issues else "Design needs targeted revision based on automated checks.")
	prompt = f"""You are the independent Red-Team Critic agent. Challenge this proposed design against every requirement. Look for missing behavior, unjustified components, security gaps, invalid API/entity references, scalability risks, and traceability failures. Return JSON with accepted (boolean), issues (array of objects with severity/category/message/related_ids), and summary. Your findings are advisory, but do not ignore a real defect. Requirements: {state['requirements'].model_dump_json()} Design: {state['design'].model_dump_json()} Deterministic checks: {checks.model_dump_json()}"""
	try:
		data = await get_provider().complete_json(prompt, {"accepted": rule_critique.accepted, "issues": [issue.model_dump() for issue in rule_critique.issues], "summary": rule_critique.summary})
		llm_critique = Critique(accepted=bool(data.get("accepted", True)), issues=data.get("issues", []), rule_checks=checks, summary=data.get("summary", rule_critique.summary))
		if not rule_critique.accepted:
			llm_critique.accepted = False
		return {"critique": llm_critique}
	except (ProviderError, ValueError, TypeError):
		return {"critique": rule_critique}


def should_revise(state: PipelineState) -> str:
	return "revise" if not state["critique"].accepted and state.get("revisions", 0) < settings.max_revisions else "finish"


def revise_design(state: PipelineState) -> dict:
	issues = "; ".join(issue.message for issue in state["critique"].issues)
	return {"revisions": state.get("revisions", 0) + 1, "critique_feedback": issues}


def deterministic_diagram_markdown(architecture: Architecture, design: Design, critique: Critique) -> str:
	nodes = "\n".join(f"    {component.id}[{component.name}]" for component in design.components)
	edges = "\n".join(f"    {edge.source} -->|{edge.label}| {edge.target}" for edge in design.edges)
	entities = "\n".join(f"    {entity.name} {{\n      string id\n      string created_at\n    }}" for entity in design.entities)
	endpoints = "\n".join(f"- `{endpoint.method} {endpoint.path}` -> `{endpoint.response_entity or 'response'}`; satisfies `{', '.join(endpoint.satisfies)}`" for endpoint in design.endpoints)
	return f"""# DesignForge generated system design

## Architecture decision

- **Style:** {architecture.style}
- **Data store:** {architecture.data_store}
- **Justification:** {architecture.justification}

## Component graph

```mermaid
flowchart LR
{nodes}
{edges}
```

## System architecture

```mermaid
flowchart TB
	UI[React workbench] --> API[FastAPI service]
	API --> CTRL[LangGraph controller]
	CTRL --> AGENTS[Five specialized agents]
	CTRL --> RULES[Deterministic rule evaluator]
	AGENTS --> HOSTED[Hosted LLM API]
	CTRL --> STORE[(SQLite or PostgreSQL)]
```

## Data model

```mermaid
erDiagram
{entities}
```

## API contract

{endpoints}

## Deployment boundary

```mermaid
flowchart LR
	DEV[CPU-only developer machine] <-->|HTTPS| LLM[Gemini or Groq hosted API]
	DEV --> DB[(SQLite or PostgreSQL)]
```

## Evaluation loop

```mermaid
flowchart LR
	INPUT[Same benchmark requirements] --> BASELINE[Single-shot baseline]
	INPUT --> PIPELINE[Multi-agent pipeline]
	BASELINE --> RULES[Same deterministic evaluator]
	PIPELINE --> RULES
	RULES --> TABLE[Raw comparison table]
```

## Verification summary

- Traceability: **{critique.rule_checks.traceability_percent}%**
- Consistency: **{critique.rule_checks.consistency_score}%**
- Over-engineering: **{critique.rule_checks.over_engineering_rate}%**
"""


async def generate_diagram_markdown(result: dict) -> str:
	fallback = deterministic_diagram_markdown(result["architecture"], result["design"], result["critique"])
	if settings.llm_provider.lower() != "gemini":
		return fallback
	prompt = "You are the documentation renderer for a software architecture system. Return Markdown only with Mermaid blocks for component, architecture, data, deployment, and evaluation graphs. Preserve all supplied IDs and values."
	try:
		generated = await get_provider().complete_text(prompt, fallback)
		return generated if "```mermaid" in generated and len(generated) >= 100 else fallback
	except ProviderError:
		return fallback


def build_graph():
	graph = StateGraph(PipelineState)
	graph.add_node("analyze", analyze_requirements)
	graph.add_node("architect", propose_architecture)
	graph.add_node("design", design_components)
	graph.add_node("critique", critique_design)
	graph.add_node("revise", revise_design)
	graph.set_entry_point("analyze")
	graph.add_edge("analyze", "architect")
	graph.add_edge("architect", "design")
	graph.add_edge("design", "critique")
	graph.add_conditional_edges("critique", should_revise, {"revise": "design", "finish": END})
	return graph.compile()


async def run_pipeline(raw: str) -> dict:
	result = await build_graph().ainvoke({"raw": raw, "revisions": 0})
	result["run_id"] = str(uuid4())
	result["diagram_markdown"] = await generate_diagram_markdown(result)
	return result
