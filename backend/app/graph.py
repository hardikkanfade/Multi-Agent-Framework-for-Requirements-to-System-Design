import asyncio
import re
from typing import TypedDict
from uuid import uuid4

from langgraph.graph import END, StateGraph

from .config import settings
from .models import (
	Architecture,
	Critique,
	Design,
	DesignConstraint,
	DisciplineAnalysis,
	DeploymentRecommendation,
	DeploymentTechnology,
	MAMDOReport,
	OptimizationObjective,
	Requirements,
	UseCase,
)
from .providers import ProviderError, get_provider
from .rules import evaluate_rules


class PipelineState(TypedDict, total=False):
	raw: str
	requirements: Requirements
	discipline_analyses: list[DisciplineAnalysis]
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


def _debate_items(value, fallback: list[str]) -> list[str]:
	if isinstance(value, str):
		return [value] if value.strip() else fallback
	if isinstance(value, list):
		items = [str(item).strip() for item in value if str(item).strip()]
		return items or fallback
	return fallback


_ACTION_WORDS = (
	"browse|search|view|list|find|get|create|add|register|manage|track|place|submit|"
	"update|delete|remove|cancel|store|borrow|return|book|schedule|upload|download|"
	"purchase|reserve|login|log in|authenticate|checkout|pay|audit|review"
)
_COORDINATED_ACTION = re.compile(
	rf"\s+and\s+(?=(?:(?:can|must|should|shall|will|may|need to)\s+)?(?:{_ACTION_WORDS})\b)",
	re.IGNORECASE,
)
_MODAL_PREFIX = re.compile(
	r"^(.*?\b(?:can|must|should|shall|will|may|need to)\s+)",
	re.IGNORECASE,
)
_QUALITY_ATTRIBUTE = re.compile(
	r"\b(fast|latency|response time|throughput|availability|uptime|scalable|"
	r"scalability|performance|reliable|reliability|encrypted|encryption|"
	r"confidential|privacy|retention|recover(?:y|able)|within\s+\d+)\b",
	re.IGNORECASE,
)


def _requirement_clauses(text: str) -> list[str]:
	sentences = [
		part.strip(" \t-")
		for part in re.split(r"(?<=[.!?])\s+|\n+", text.strip())
		if part.strip(" \t-")
	]
	clauses = []
	for sentence in sentences:
		parts = [part.strip() for part in _COORDINATED_ACTION.split(sentence) if part.strip()]
		if len(parts) == 1:
			clauses.append(sentence)
			continue
		modal = _MODAL_PREFIX.match(parts[0])
		prefix = modal.group(1) if modal else ""
		clauses.append(parts[0])
		for part in parts[1:]:
			if prefix and not re.match(r"^(?:can|must|should|shall|will|may|need to)\b", part, re.IGNORECASE):
				part = prefix + part
			clauses.append(part[0].upper() + part[1:] if not prefix and part else part)
	return clauses


def _local_requirements(text: str) -> Requirements:
	functional, non_functional = [], []
	for clause in _requirement_clauses(text):
		is_quality = bool(_QUALITY_ATTRIBUTE.search(clause))
		target = non_functional if is_quality else functional
		prefix = "NFR" if is_quality else "FR"
		target.append(
			{
				"id": f"{prefix}-{len(target) + 1}",
				"text": clause,
				"kind": "non_functional" if is_quality else "functional",
				"confidence": 0.86,
			}
		)
	ambiguities = [
		{
			"id": f"AMB-{index}",
			"description": (
				f"Define a measurable acceptance threshold for the quality attribute: {requirement['text']}"
			),
			"confidence": 0.9,
			"related_requirement_ids": [requirement["id"]],
		}
		for index, requirement in enumerate(non_functional, 1)
		if _QUALITY_ATTRIBUTE.search(requirement["text"])
		and not re.search(r"\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|s|minutes?|%|requests?/s)\b", requirement["text"], re.IGNORECASE)
	]
	return Requirements(
		functional=functional,
		non_functional=non_functional,
		ambiguities=ambiguities,
	)


_ACTION_RESOURCE_PATTERN = re.compile(
	rf"\b(?P<action>{_ACTION_WORDS})\s+(?:for\s+)?(?:the\s+|a\s+|an\s+)?"
	r"(?P<resource>[a-z][a-z0-9_-]*)",
	re.IGNORECASE,
)
_IGNORED_RESOURCES = {
	"it", "them", "this", "that", "something", "system", "data",
	"must", "should", "shall", "will", "may", "be", "to", "with",
	"of", "from", "for", "and", "or", "auditable",
}
_ENTITY_FIELD_PROFILES = {
	"product": [
		("sku", "string", False), ("name", "string", True),
		("description", "string", False), ("price", "decimal", False),
		("status", "string", False), ("created_at", "timestamp", True),
		("updated_at", "timestamp", False),
	],
	"order": [
		("customer_id", "uuid", False), ("status", "string", True),
		("total_amount", "decimal", False), ("currency", "string", False),
		("created_at", "timestamp", True), ("updated_at", "timestamp", False),
	],
	"book": [
		("isbn", "string", False), ("title", "string", True),
		("author", "string", False), ("availability_status", "string", True),
		("created_at", "timestamp", True),
	],
	"member": [
		("name", "string", True), ("email", "string", False),
		("membership_status", "string", True), ("created_at", "timestamp", True),
	],
	"appointment": [
		("patient_id", "uuid", False), ("provider_id", "uuid", False),
		("starts_at", "timestamp", True), ("status", "string", True),
	],
}


def _singularize(resource: str) -> str:
	if resource.endswith("ies"):
		return resource[:-3] + "y"
	if resource.endswith(("sses", "shes", "ches", "xes", "zes")):
		return resource[:-2]
	if resource.endswith("s") and not resource.endswith("ss"):
		return resource[:-1]
	return resource


def _resource_actions(requirements: Requirements) -> list[tuple[str, str, str]]:
	actions = []
	for requirement in requirements.functional:
		for match in _ACTION_RESOURCE_PATTERN.finditer(requirement.text.lower()):
			action = match.group("action").replace(" ", "_")
			resource = _singularize(match.group("resource")).replace("-", "_")
			if resource not in _IGNORED_RESOURCES:
				actions.append((requirement.id, action, resource))
	return actions


def _domain_entities(requirements: Requirements) -> list[str]:
	names = list(dict.fromkeys(
		"".join(part.capitalize() for part in resource.split("_"))
		for _, _, resource in _resource_actions(requirements)
	))
	if any(re.search(r"\b(audit|auditable|audit log|logging)\b", item.text, re.IGNORECASE) for item in requirements.all_requirements):
		names.append("AuditLog")
	return names


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
	components = ["api", "domain services", "persistence"]
	if any(term in text for term in ["audit", "auditable", "audit log"]):
		components.insert(2, "audit logging")
	if any(term in text for term in ["auth", "login", "role", "permission", "access control"]):
		components.insert(1, "identity")
	architecture_drivers = [
		item.id for item in requirements.all_requirements
		if any(term in item.text.lower() for term in ["independent teams", "multi-region", "independent scaling"])
	]
	commerce = any(term in text for term in ["order", "payment", "checkout", "booking", "reservation"])
	if style == "microservices":
		justification = (
			f"Microservices are justified by the explicitly stated independent deployment, scaling, or team-boundary needs "
			f"({', '.join(architecture_drivers)}). Services should be split only along those independently owned or scaled capabilities."
		)
		trade_offs = [
			"Independent deployment and scaling are possible for the explicitly identified capabilities.",
			"Service discovery, network failure handling, observability, and deployment automation add operational cost.",
			"Cross-service workflows need explicit consistency, retry, and idempotency rules.",
		]
	else:
		justification = (
			"No requirement establishes independent service deployment, ownership, or scaling. A modular monolith keeps "
			"domain boundaries explicit while avoiding distributed deployment and network failure modes."
		)
		trade_offs = [
			"One deployment unit simplifies operations and supports atomic transactions across related modules.",
			"Catalog, order, identity, and audit responsibilities can remain independently testable modules.",
			"Capabilities cannot be scaled or deployed independently until an evidenced need justifies extraction.",
		]
	if store == "nosql":
		store_justification = (
			"Document/feed requirements suggest flexible or aggregate-shaped records. Confirm access patterns, consistency, "
			"and transaction needs before choosing a specific NoSQL product."
		)
	elif commerce:
		store_justification = (
			"Order, booking, or payment workflows need consistent relationships and state changes; relational storage "
			"provides transactions and referential constraints for those records."
		)
	else:
		store_justification = (
			"Relational storage is a conservative default for structured entities and explicit relationships. "
			"Confirm expected volume and access patterns before selecting a database product."
		)
	return Architecture(
		style=style,
		justification=justification,
		trade_offs=trade_offs,
		components=components,
		data_store=store,
		data_store_justification=store_justification,
		traceability={item.id: ["api", "application"] for item in requirements.all_requirements},
	)


def _local_discipline_analysis(discipline: str, requirements: Requirements, architecture: Architecture) -> DisciplineAnalysis:
	text = " ".join(item.text.lower() for item in requirements.all_requirements)
	constraints = [
		f"Preserve {item.id}: {item.text}"
		for item in requirements.all_requirements
	]
	quality_requirements = [
		item for item in requirements.non_functional
		if any(term in item.text.lower() for term in ["latency", "response", "fast", "throughput", "availability", "scale", "performance"])
	]
	if discipline == "application":
		return DisciplineAnalysis(
			discipline=discipline,
			recommendation=(
				f"Use a {architecture.style.replace('_', ' ')} with an API boundary, separate domain services for "
				"the identified capabilities, and a persistence boundary. Keep business rules in the domain services; "
				"do not create independently deployed services without an explicit requirement."
			),
			coupling_variables={
				"architecture_style": architecture.style,
				"component_boundaries": "API -> domain service -> persistence",
				"domain_capabilities": ", ".join(architecture.components),
			},
			requirement_constraints=constraints,
		)
	if discipline == "data":
		data_entities = _domain_entities(requirements)
		data_constraints = [
			f"Model {name} only to support the mapped requirements."
			for name in data_entities
		]
		if not data_constraints:
			data_constraints = ["No persistent business entity is explicit; confirm whether the target system stores state."]
		return DisciplineAnalysis(
			discipline=discipline,
			recommendation=(
				f"Use {architecture.data_store} storage for {', '.join(data_entities) or 'the explicitly stated records'}. "
				+ ("Keep order state and audit events transactionally consistent." if "audit" in text and "order" in text else "Derive fields and relationships from the stated capabilities; validate uncertain fields with the user.")
			),
			coupling_variables={
				"data_store": architecture.data_store,
				"consistency_boundary": "domain operation / transaction",
				"identified_entities": ", ".join(data_entities) or "none confirmed",
			},
			requirement_constraints=data_constraints,
		)
	if discipline == "security":
		has_identity_requirement = any(term in text for term in ["auth", "login", "role", "permission", "access control"])
		has_audit_requirement = any(term in text for term in ["audit", "auditable", "audit log"])
		security_scope = (
			"Authentication or authorization is explicit; include an identity boundary and enforce authorization before protected operations."
			if has_identity_requirement
			else "No authentication mechanism is specified; do not invent an identity provider, but record access control as an open security decision."
		)
		if has_audit_requirement:
			security_scope += " Auditability is explicit; persist append-only audit events with action, affected record, timestamp, and actor when identity is available."
		return DisciplineAnalysis(
			discipline=discipline,
			recommendation=security_scope,
			coupling_variables={
				"identity_boundary": "required by input" if has_identity_requirement else "unspecified; not assumed",
				"audit_boundary": "audit events required" if has_audit_requirement else "not specified",
			},
			requirement_constraints=[
				f"Preserve security requirement {item.id}: {item.text}"
				for item in requirements.all_requirements
				if any(term in item.text.lower() for term in ["auth", "secure", "permission", "access", "encrypt", "audit", "auditable"])
			],
		)
	operations_recommendation = (
		"Treat the stated performance/availability requirement as a design constraint, but do not claim it is satisfied "
		"until a numeric target, workload, and deployment environment are specified."
		if quality_requirements
		else
		"No workload, availability target, or deployment platform is specified. Keep the runtime boundary simple and record scaling assumptions rather than selecting infrastructure."
	)
	return DisciplineAnalysis(
		discipline=discipline,
		recommendation=operations_recommendation,
		coupling_variables={
			"deployment_boundary": architecture.style.replace("_", " "),
			"performance_targets": "; ".join(item.text for item in quality_requirements) or "none stated",
		},
		requirement_constraints=[
			f"Preserve operational requirement {item.id}: {item.text}"
			for item in quality_requirements
		],
	)


async def analyze_disciplines(state: PipelineState) -> dict:
	requirements = state["requirements"]
	architecture = _local_architecture(requirements)
	provider = get_provider()
	discipline_names = ["application", "data", "security", "operations"]

	async def analyze(discipline: str) -> DisciplineAnalysis:
		fallback = _local_discipline_analysis(discipline, requirements, architecture)
		prompt = f"""You are the {discipline.title()} discipline in a multidisciplinary software architecture design. Analyze only your discipline, make no unsupported feature assumptions, and identify requirements that constrain your recommendation. Include the design decisions other disciplines must share as coupling_variables. Return JSON with exactly this shape: {fallback.model_dump_json()}. Requirements: {requirements.model_dump_json()}"""
		try:
			data = await _complete_json_with_retry(provider, prompt, fallback.model_dump())
			return DisciplineAnalysis.model_validate(data)
		except (ProviderError, ValueError, TypeError):
			return fallback

	analyses = await asyncio.gather(*(analyze(name) for name in discipline_names))
	return {"discipline_analyses": analyses}


async def propose_architecture(state: PipelineState) -> dict:
	requirements = state["requirements"]
	fallback = _local_architecture(requirements)
	provider = get_provider()
	requirement_text = " ".join(item.text.lower() for item in requirements.all_requirements)
	challenge_points = []
	if any(term in requirement_text for term in ["audit", "auditable", "audit log"]):
		challenge_points.append("Audit events need an append-only policy, actor attribution when available, retention rules, and read authorization; these are not fully specified.")
	if any(term in requirement_text for term in ["fast", "latency", "response time", "performance"]):
		challenge_points.append("The performance requirement has no numeric latency, throughput, or workload target, so it cannot yet be verified.")
	if any(term in requirement_text for term in ["order", "booking", "reservation", "payment"]):
		challenge_points.append("State-changing workflows need explicit transaction boundaries and duplicate-request/idempotency behavior.")
	if not any(term in requirement_text for term in ["independent teams", "multi-region", "independent scaling"]):
		challenge_points.append("No independently scaled or deployed capability is identified; microservices would add operational cost without current evidence.")
	local_challenger_summary = "\n".join(f"- {point}" for point in challenge_points) or "- Confirm workload, security, and deployment assumptions before implementation."
	advocate_prompt = f"""You are the Architecture Advocate in a documented design review. Propose the simplest architecture justified by the exact requirement statements. For every major decision, name the relevant requirement IDs and explain the operational consequence. Cover component boundaries, data-store fit, security, failure handling, scale, and deployment assumptions. Explicitly separate stated requirements from recommendations; do not claim production readiness or invent workload numbers. Return only JSON matching this Architecture schema: {fallback.model_dump_json()}. Requirements: {requirements.model_dump_json()} Discipline analyses: {[analysis.model_dump() for analysis in state.get("discipline_analyses", [])]}"""
	challenger_prompt = f"""You are an independent Architecture Challenger reviewing a concrete proposal for this target system. Do not provide generic checklist advice. Anchor each objection to a requirement ID or explicitly label it as an unresolved assumption. Challenge whether the selected service boundaries, persistence model, API shape, security controls, failure behavior, and deployment choices are justified. For each objection state: (1) the decision challenged, (2) a requirement-specific failure mode, (3) a viable alternative, and (4) the evidence needed to decide. Return 2-4 concise numbered objections as plain text, no preamble. Requirements: {requirements.model_dump_json()} Candidate architecture: {fallback.model_dump_json()}"""
	advocate_task = asyncio.create_task(_complete_json_with_retry(provider, advocate_prompt, fallback.model_dump()))
	challenger_task = asyncio.create_task(_complete_text_with_retry(provider, challenger_prompt, local_challenger_summary))
	advocate_data, challenger_data = await asyncio.gather(advocate_task, challenger_task, return_exceptions=True)
	advocate = fallback if isinstance(advocate_data, BaseException) else Architecture.model_validate(advocate_data)
	challenger_summary = local_challenger_summary if isinstance(challenger_data, BaseException) else str(challenger_data)
	discipline_summaries = [analysis.model_dump() for analysis in state.get("discipline_analyses", [])]
	adjudicator_prompt = f"""You are the system-level adjudicator in an MDF-style multidisciplinary design review. Produce an auditable debate outcome, not a generic summary. Reconcile the discipline analyses and coupling variables, the advocate proposal, and each challenger objection. For every objection, state whether it is accepted, rejected, or deferred, explain why using the submitted requirement evidence, and name the resulting design consequence or open decision. Preserve complete traceability and valid references as hard constraints. Select the simplest supported design. Do not fabricate measurements, requirement IDs, technologies as user-mandated facts, or production-readiness claims. Return JSON with:
selected (matching this Architecture schema exactly: {fallback.model_dump_json()}),
decision_rationale (specific evidence-based adjudication),
rejected_alternative,
advocate_response (point-by-point response to the challenger),
accepted_objections (list of objection IDs/numbers and consequences),
deferred_objections (list of unresolved objection IDs/numbers and evidence needed).
Requirements: {requirements.model_dump_json()}
Discipline analyses: {discipline_summaries}
Advocate proposal: {advocate.model_dump_json()}
Challenger objections: {challenger_summary}"""
	try:
		selected_data = await provider.complete_json(
			adjudicator_prompt,
			{
				"selected": advocate.model_dump(),
				"decision_rationale": (
					f"{advocate.justification} {advocate.data_store_justification} "
					"Discipline recommendations and challenger risks are carried forward as explicit implementation and acceptance criteria."
				),
				"rejected_alternative": "microservices" if fallback.style == "modular_monolith" else "modular_monolith",
				"advocate_response": "The advocate's proposal is retained subject to the unresolved constraints recorded by the challenger.",
				"accepted_objections": [],
				"deferred_objections": challenge_points,
			},
		)
		selected = Architecture.model_validate(selected_data.get("selected", advocate.model_dump()))
		debate = {
			"advocate_summary": advocate.justification,
			"challenger_summary": challenger_summary,
			"rejected_alternative": selected_data.get("rejected_alternative", "microservices" if selected.style == "modular_monolith" else "modular_monolith"),
			"decision_rationale": selected_data.get(
				"decision_rationale",
				f"{selected.justification} {selected.data_store_justification} "
				"The selected boundary keeps domain responsibilities testable while respecting the stated deployment evidence.",
			),
			"advocate_response": selected_data.get(
				"advocate_response",
				"The proposal is retained only where it meets the stated requirements; remaining objections are tracked below.",
			),
			"accepted_objections": _debate_items(selected_data.get("accepted_objections"), []),
			"deferred_objections": _debate_items(
				selected_data.get("deferred_objections"), challenge_points
			),
			"optimizer_method": "MDF-style constrained discipline synthesis",
		}
		return {"architecture": selected, "architecture_debate": debate}
	except (ProviderError, ValueError, TypeError):
		return {
			"architecture": advocate,
			"architecture_debate": {
				"advocate_summary": advocate.justification,
				"challenger_summary": challenger_summary,
				"rejected_alternative": "microservices" if advocate.style == "modular_monolith" else "modular_monolith",
				"decision_rationale": (
					f"{advocate.justification} {advocate.data_store_justification} "
					"Unresolved challenger points are retained as assumptions and acceptance criteria."
				),
				"advocate_response": "The local adjudication cannot resolve the challenge without further requirement evidence.",
				"accepted_objections": [],
				"deferred_objections": challenge_points,
				"optimizer_method": "MDF-style constrained discipline synthesis",
			},
		}


def _local_design(requirements: Requirements) -> Design:
	all_requirements = requirements.all_requirements
	text = " ".join(item.text.lower() for item in all_requirements)
	audit_requirements = [
		item for item in all_requirements
		if re.search(r"\b(audit|auditable|audit log|audit trail)\b", item.text, re.IGNORECASE)
	]
	identity_requirements = [
		item for item in all_requirements
		if re.search(r"\b(auth|login|log in|role|permission|access control)\b", item.text, re.IGNORECASE)
	]
	actions = _resource_actions(requirements)
	resources = list(dict.fromkeys(resource for _, _, resource in actions))
	entity_names = {
		resource: "".join(part.capitalize() for part in resource.split("_"))
		for resource in resources
	}
	requirements_by_resource: dict[str, list[str]] = {}
	resource_methods: dict[tuple[str, str], list[str]] = {}
	read_actions = {"browse", "search", "view", "list", "find", "get", "track", "review"}
	update_actions = {"update", "manage"}
	delete_actions = {"delete", "remove", "cancel"}
	for requirement_id, action, resource in actions:
		requirements_by_resource.setdefault(resource, [])
		if requirement_id not in requirements_by_resource[resource]:
			requirements_by_resource[resource].append(requirement_id)
		method = (
			"GET" if action in read_actions else
			"PATCH" if action in update_actions or action == "cancel" else
			"DELETE" if action in delete_actions else
			"POST"
		)
		resource_methods.setdefault((resource, method), [])
		if requirement_id not in resource_methods[(resource, method)]:
			resource_methods[(resource, method)].append(requirement_id)

	audit_enabled = bool(audit_requirements)
	product_order_flow = "product" in resources and "order" in resources
	assumptions = []
	if resources:
		assumptions.append(
			"Suggested entity fields beyond identifiers are conventional starting points inferred from domain terms; confirm them with stakeholders before treating them as requirements."
		)
	if product_order_flow:
		assumptions.append(
			"OrderItem models the association between an order and products, with quantity and a unit-price snapshot; confirm taxes, payment, inventory reservation, and fulfilment scope."
		)
	if audit_enabled and not identity_requirements:
		assumptions.append(
			"Audit actor identity is nullable because no authentication or identity source is specified; define retention, tamper resistance, and audit-reader authorization."
		)
	if any(re.search(r"\b(fast|latency|response time|performance)\b", item.text, re.IGNORECASE) for item in requirements.non_functional):
		assumptions.append(
			"Performance is not verified: specify a latency percentile, workload, and measurement boundary before selecting caching or scaling mechanisms."
		)

	components = [
		{
			"id": "api",
			"name": "Target System API",
			"kind": "interface",
			"satisfies": [],
		}
	]
	edges = []
	if identity_requirements:
		components.append({
			"id": "identity",
			"name": "Identity and Access Control",
			"kind": "security",
			"satisfies": [item.id for item in identity_requirements],
		})
		edges.append({"source": "api", "target": "identity", "label": "authenticates and authorizes"})
	services = {}
	for resource in resources:
		entity_name = entity_names[resource]
		service_id = f"service_{resource}"
		service_name = {
			"product": "Product Catalog Service",
			"order": "Order Management Service",
			"book": "Library Circulation Service",
			"member": "Membership Service",
			"appointment": "Appointment Scheduling Service",
		}.get(resource, f"{entity_name} Service")
		services[resource] = service_id
		components.append({
			"id": service_id,
			"name": service_name,
			"kind": "domain_service",
			"satisfies": requirements_by_resource.get(resource, []),
		})
		edges.append({"source": "api", "target": service_id, "label": "routes capability"})
		if identity_requirements:
			edges.append({"source": "identity", "target": service_id, "label": "authorized principal"})
	if not services:
		components.append({
			"id": "service_core",
			"name": "Core Application Service",
			"kind": "domain_service",
			"satisfies": [item.id for item in requirements.functional],
		})
		services["core"] = "service_core"
		edges.append({"source": "api", "target": "service_core", "label": "routes operation"})

	components.append({
		"id": "persistence",
		"name": f"{' and '.join(entity_names.values()) or 'Domain'} Persistence",
		"kind": "data",
		"satisfies": list(dict.fromkeys(
			requirement_id
			for ids in requirements_by_resource.values()
			for requirement_id in ids
		)),
	})
	for service_id in services.values():
		edges.append({"source": service_id, "target": "persistence", "label": "reads/writes"})

	if audit_enabled:
		edges.append({"source": "api", "target": "audit", "label": "reads audit history"})
		components.append({
			"id": "audit",
			"name": "Audit Logging Service",
			"kind": "security",
			"satisfies": [item.id for item in audit_requirements],
		})
		for service_id in services.values():
			edges.append({"source": service_id, "target": "audit", "label": "records state changes"})
		edges.append({"source": "audit", "target": "persistence", "label": "appends audit events"})
		audit_text = " ".join(item.text.lower() for item in audit_requirements)
		audited_resources = [
			entity_names[resource] for resource in resources
			if re.search(rf"\b{re.escape(resource)}s?\b", audit_text)
		]
		if not audited_resources and len(resources) == 1:
			audited_resources = [entity_names[resources[0]]]
	else:
		audited_resources = []

	entities = []
	for resource in resources:
		fields = [("id", "uuid", True)]
		fields.extend(_ENTITY_FIELD_PROFILES.get(resource, [
			("name", "string", True),
			("status", "string", False),
			("created_at", "timestamp", True),
			("updated_at", "timestamp", False),
		]))
		relationships = ["OrderItem"] if resource == "order" and product_order_flow else []
		entities.append({
			"name": entity_names[resource],
			"fields": [
				{"name": name, "type": field_type, "required": required}
				for name, field_type, required in fields
			],
			"relationships": relationships,
			"satisfies": requirements_by_resource.get(resource, []),
		})
	if product_order_flow:
		entities.append({
			"name": "OrderItem",
			"fields": [
				{"name": "id", "type": "uuid", "required": True},
				{"name": "order_id", "type": "uuid", "required": True},
				{"name": "product_id", "type": "uuid", "required": True},
				{"name": "quantity", "type": "integer", "required": True},
				{"name": "unit_price", "type": "decimal", "required": True},
			],
			"relationships": ["Product"],
			"satisfies": list(dict.fromkeys(
				requirement_id
				for resource in ("product", "order")
				for requirement_id in requirements_by_resource.get(resource, [])
			)),
		})
	if audit_enabled:
		entities.append({
			"name": "AuditLog",
			"fields": [
				{"name": "id", "type": "uuid", "required": True},
				{"name": "action", "type": "string", "required": True},
				{"name": "entity_type", "type": "string", "required": True},
				{"name": "entity_id", "type": "uuid", "required": True},
				{"name": "actor_id", "type": "uuid", "required": False},
				{"name": "occurred_at", "type": "timestamp", "required": True},
				{"name": "metadata", "type": "json", "required": False},
			],
			"relationships": audited_resources,
			"satisfies": [item.id for item in audit_requirements],
		})

	entity_name_set = {entity["name"] for entity in entities}
	for entity in entities:
		entity["relationships"] = [
			name for name in entity["relationships"] if name in entity_name_set
		]

	endpoints = []
	for (resource, method), requirement_ids in resource_methods.items():
		path_resource = resource.replace("_", "-")
		if path_resource.endswith("y"):
			path_resource = path_resource[:-1] + "ies"
		elif not path_resource.endswith("s"):
			path_resource += "s"
		entity_name = entity_names[resource]
		endpoints.append({
			"method": method,
			"path": f"/{path_resource}",
			"component_id": services[resource],
			"request_entity": entity_name if method in {"POST", "PUT", "PATCH"} else None,
			"response_entity": entity_name,
			"satisfies": requirement_ids,
		})
	if audit_enabled:
		audited_resource = next(
			(resource for resource in resources if entity_names[resource] in audited_resources),
			None,
		)
		audit_path = "/audit-events"
		if audited_resource:
			audit_path_resource = audited_resource.replace("_", "-")
			if audit_path_resource.endswith("y"):
				audit_path_resource = audit_path_resource[:-1] + "ies"
			elif not audit_path_resource.endswith("s"):
				audit_path_resource += "s"
			audit_path = f"/{audit_path_resource}/{{entityId}}/audit-events"
		endpoints.append({
			"method": "GET",
			"path": audit_path,
			"component_id": "audit",
			"response_entity": "AuditLog",
			"satisfies": [item.id for item in audit_requirements],
		})

	all_mapped = {
		requirement_id
		for component in components
		for requirement_id in component["satisfies"]
	}
	all_mapped.update(
		requirement_id
		for endpoint in endpoints
		for requirement_id in endpoint["satisfies"]
	)
	quality_requirements = {
		item.id for item in requirements.non_functional
	}
	components[0]["satisfies"] = sorted(quality_requirements)
	all_mapped.update(quality_requirements)
	unmapped = [item for item in all_requirements if item.id not in all_mapped]
	if unmapped:
		target_service = components[1] if len(components) > 1 and components[1]["kind"] == "domain_service" else None
		if target_service:
			target_service["satisfies"].extend(item.id for item in unmapped)
		else:
			components[0]["satisfies"].extend(item.id for item in unmapped)

	return Design(
		components=components,
		edges=edges,
		entities=entities,
		endpoints=endpoints,
		assumptions=assumptions,
	)


def _build_use_cases(requirements: Requirements, design: Design) -> list[UseCase]:
	component_names = {component.id: component.name for component in design.components}
	use_cases = []
	for requirement in requirements.functional:
		matching_endpoints = [
			endpoint for endpoint in design.endpoints
			if requirement.id in endpoint.satisfies
		]
		actor_match = re.match(
			r"^(?:as\s+)?(?:an?\s+)?([^,.]+?)\s+(?:can|may|should|must|shall|will|needs?\s+to)\b",
			requirement.text,
			re.IGNORECASE,
		)
		actor = actor_match.group(1).strip().capitalize() if actor_match else "Authorized system actor (not specified)"
		goal = re.sub(r"^(?:as\s+)?(?:an?\s+)?[^,.]+?\s+(?:can|may|should|must|shall|will|needs?\s+to)\s+", "", requirement.text, flags=re.IGNORECASE)
		goal = goal.rstrip(".!?").strip() or requirement.text
		name = goal[0].upper() + goal[1:] if goal else requirement.text
		is_audit_requirement = bool(re.search(r"\b(audit|auditable|audit log|audit trail)\b", requirement.text, re.IGNORECASE))
		if is_audit_requirement:
			audited_entity = next(
				(
					entity.name for entity in design.entities
					if entity.name.lower() in requirement.text.lower()
					or f"{entity.name.lower()}s" in requirement.text.lower()
				),
				"record",
			)
			name = f"Review audit history for {audited_entity.lower()}s"
			goal = f"Review the audit history associated with {audited_entity}"
			actor = "Authorized audit reviewer (identity and access policy unspecified)"
		main_flow = []
		postconditions = []
		for endpoint in matching_endpoints:
			main_flow.append(f"The actor invokes {endpoint.method} {endpoint.path}.")
			handler = component_names.get(endpoint.component_id, endpoint.component_id)
			main_flow.append(f"The {handler} handles the operation and applies the design boundary shown in the component graph.")
			entity_names = [
				entity_name for entity_name in (endpoint.request_entity, endpoint.response_entity)
				if entity_name
			]
			if entity_names:
				main_flow.append(
					f"The operation reads or writes the declared {', '.join(dict.fromkeys(entity_names))} data contract."
				)
			if endpoint.method != "GET" and any(entity.name == "AuditLog" for entity in design.entities):
				main_flow.append(
					"The Audit Logging Service appends an event for the state change; actor attribution and retention policy remain explicit design decisions."
				)
			if endpoint.method == "GET":
				postconditions.append(f"The requested {endpoint.response_entity or 'resource'} representation is returned; no state change is implied.")
			else:
				postconditions.append(f"The requested state change is recorded against the declared {endpoint.request_entity or endpoint.response_entity or 'domain'} contract.")
		if not matching_endpoints:
			main_flow.append("The request is mapped to the generated domain service; the source requirements do not specify a concrete API contract.")
		if re.search(r"\b(audit|auditable|audit log|audit trail)\b", requirement.text, re.IGNORECASE):
			audit_endpoint = next(
				(endpoint for endpoint in matching_endpoints if endpoint.response_entity == "AuditLog"),
				None,
			)
			if audit_endpoint and not any(endpoint.response_entity == "AuditLog" for endpoint in matching_endpoints):
				main_flow.append(
					f"The Audit Logging Service returns recorded events through {audit_endpoint.method} {audit_endpoint.path}."
				)
			else:
				main_flow.append("The affected state change is appended to AuditLog with the event fields declared in the data model.")
			if audit_endpoint:
				postconditions.append("The record's audit history is returned; event immutability, retention, and reader authorization remain open decisions.")
			else:
				postconditions.append("An audit event is associated with the affected record; actor identity and retention remain open decisions.")
		if not postconditions:
			postconditions.append("The requested operation completes; detailed failure and retry behavior must be agreed before implementation.")
		preconditions = [
			"Authentication, authorization, and domain-specific eligibility rules are not assumed unless explicitly stated in the requirements."
		]
		use_cases.append(
			UseCase(
				name=name,
				actor=actor,
				goal=goal,
				preconditions=preconditions,
				main_flow=main_flow,
				postconditions=list(dict.fromkeys(postconditions)),
				requirement_ids=[requirement.id],
				endpoint_refs=[f"{endpoint.method} {endpoint.path}" for endpoint in matching_endpoints],
			)
		)
	return use_cases


async def design_components(state: PipelineState) -> dict:
	requirements = state["requirements"]
	fallback = _local_design(requirements)
	prompt = f"""You are the Component and API Designer agent. Produce a minimal but complete design of the user's target system, not of this design workbench. The generated diagram inputs must be concrete and requirement-specific: use the actual domain nouns, actor goals, operations, state changes, data fields, component responsibilities, and dependency directions evidenced by the input. Preserve all requirement IDs and tag each requirement on the components/endpoints that implement it. Model request/response entities accurately and include meaningful domain fields and relationships only where justified; mark inferences as assumptions. Do not create generic boxes, placeholder services, speculative queues/caches, cloud provider choices, or invented business rules. Reflect accepted and unresolved design-review objections in assumptions and trade-offs. Correct prior critic feedback. Return JSON matching this schema exactly: {fallback.model_dump_json()}. Requirements: {requirements.model_dump_json()} Selected architecture: {state['architecture'].model_dump_json()} Discipline analyses and coupling variables: {[analysis.model_dump() for analysis in state.get('discipline_analyses', [])]} Full architecture debate: {state.get('architecture_debate', {})} Prior critic feedback: {state.get('critique_feedback', '')}"""
	try:
		data = await get_provider().complete_json(prompt, fallback.model_dump())
		design = Design.model_validate(data)
		if not design.assumptions:
			design.assumptions = fallback.assumptions
		return {"design": design}
	except (ProviderError, ValueError, TypeError):
		return {"design": fallback}


async def critique_design(state: PipelineState) -> dict:
	checks = evaluate_rules(state["requirements"], state["design"])
	issues = []
	if checks.traceability_percent < 100:
		issues.append({"severity": "high", "category": "unmet_requirement", "message": "At least one requirement is not tagged on a component or endpoint.", "related_ids": []})
	if checks.over_engineering_rate > 0:
		issues.append({"severity": "medium", "category": "untraceable_component", "message": "Every component must be justified by at least one requirement traceability tag.", "related_ids": []})
	if checks.consistency_score < 100:
		issues.append({"severity": "critical", "category": "inconsistency", "message": "Rule checks found invalid references or a cyclic dependency.", "related_ids": []})
	for ambiguity in state["requirements"].ambiguities:
		issues.append({
			"severity": "medium",
			"category": "open_acceptance_criteria",
			"message": ambiguity.description,
			"related_ids": ambiguity.related_requirement_ids,
		})
	if state["design"].assumptions:
		issues.append({
			"severity": "medium",
			"category": "design_assumption",
			"message": f"{len(state['design'].assumptions)} design assumption(s) require stakeholder confirmation.",
			"related_ids": [],
		})
	accepted = not any(issue["severity"] in {"high", "critical"} for issue in issues)
	if accepted and (state["requirements"].ambiguities or state["design"].assumptions):
		summary = (
			"Deterministic structural checks pass. This is a reviewable design candidate, not proof of production readiness; "
			f"{len(state['requirements'].ambiguities)} acceptance ambiguity/ambiguities and "
			f"{len(state['design'].assumptions)} design assumption(s) remain for stakeholder confirmation."
		)
	elif accepted:
		summary = "Deterministic structural checks pass; review workload, security, and deployment assumptions before implementation."
	else:
		summary = "Design needs targeted revision because one or more deterministic structural constraints failed."
	rule_critique = Critique(accepted=accepted, issues=issues, rule_checks=checks, summary=summary)
	prompt = f"""You are the independent Red-Team Critic agent. Challenge this proposed design against every requirement. Look for missing behavior, unjustified components, security gaps, invalid API/entity references, scalability risks, and traceability failures. Return JSON with accepted (boolean), issues (array of objects with severity/category/message/related_ids), and summary. Your findings are advisory, but do not ignore a real defect. Requirements: {state['requirements'].model_dump_json()} Design: {state['design'].model_dump_json()} Deterministic checks: {checks.model_dump_json()}"""
	try:
		data = await get_provider().complete_json(prompt, {"accepted": rule_critique.accepted, "issues": [issue.model_dump() for issue in rule_critique.issues], "summary": rule_critique.summary})
		llm_critique = Critique(accepted=bool(data.get("accepted", True)), issues=data.get("issues", []), rule_checks=checks, summary=data.get("summary", rule_critique.summary))
		if not rule_critique.accepted:
			llm_critique.accepted = False
		existing_messages = {issue.message for issue in llm_critique.issues}
		llm_critique.issues.extend(
			issue for issue in rule_critique.issues
			if issue.message not in existing_messages
		)
		if state["requirements"].ambiguities or state["design"].assumptions:
			llm_critique.summary = rule_critique.summary
		return {"critique": llm_critique}
	except (ProviderError, ValueError, TypeError):
		return {"critique": rule_critique}


def should_revise(state: PipelineState) -> str:
	return "revise" if not state["critique"].accepted and state.get("revisions", 0) < settings.max_revisions else "finish"


def build_mamdo_report(state: PipelineState) -> MAMDOReport:
	requirements = state["requirements"]
	design = state["design"]
	checks = state["critique"].rule_checks
	requirement_ids = [item.id for item in requirements.all_requirements]
	constraints = [
		DesignConstraint(
			name="All requirements are traceable",
			satisfied=checks.traceability_percent >= 100,
			evidence=f"{checks.traceability_percent}% requirement traceability",
		),
		DesignConstraint(
			name="Component edges reference known components",
			satisfied=checks.component_edges_valid,
			evidence=f"{len(design.edges)} component edges checked",
		),
		DesignConstraint(
			name="API components and request/response entities exist",
			satisfied=checks.entity_references_valid,
			evidence=f"{len(design.endpoints)} endpoints checked against {len(design.components)} components and {len(design.entities)} entities",
		),
		DesignConstraint(
			name="Component dependency graph is acyclic",
			satisfied=checks.dependency_graph_acyclic,
			evidence="Dependency cycle validation over generated component edges",
		),
	]
	return MAMDOReport(
		architecture=state["architecture"].style,
		design_variables={
			"architecture_style": state["architecture"].style,
			"data_store": state["architecture"].data_store,
			"component_count": str(len(design.components)),
			"endpoint_count": str(len(design.endpoints)),
			"entity_count": str(len(design.entities)),
		},
		coupling_variables={
			"requirement_ids": ", ".join(requirement_ids),
			"component_ids": ", ".join(component.id for component in design.components),
			"component_edges": ", ".join(f"{edge.source}->{edge.target}" for edge in design.edges),
			"api_entity_references": ", ".join(
				f"{endpoint.method} {endpoint.path}@{endpoint.component_id}:{endpoint.request_entity or '-'}->{endpoint.response_entity or '-'}"
				for endpoint in design.endpoints
			),
		},
		disciplines=state.get("discipline_analyses", []),
		objectives=[
			OptimizationObjective(
				name="Requirement traceability",
				direction="maximize",
				value=checks.traceability_percent,
				evidence=f"{checks.traceability_percent}% of {len(requirement_ids)} requirements are mapped to generated design elements",
			),
			OptimizationObjective(
				name="Structural consistency",
				direction="maximize",
				value=checks.consistency_score,
				evidence="Deterministic component-edge, API/entity-reference, and dependency-cycle checks",
			),
			OptimizationObjective(
				name="Untraceable component rate",
				direction="minimize",
				value=checks.over_engineering_rate,
				evidence=f"{checks.over_engineering_rate}% of components have no requirement traceability tags",
			),
		],
		constraints=constraints,
		feasible=all(constraint.satisfied for constraint in constraints),
		design_iterations=state.get("revisions", 0) + 1,
	)


def revise_design(state: PipelineState) -> dict:
	issues = "; ".join(issue.message for issue in state["critique"].issues)
	return {"revisions": state.get("revisions", 0) + 1, "critique_feedback": issues}


def deterministic_diagram_markdown(architecture: Architecture, design: Design, critique: Critique) -> str:
	def safe_label(value: str) -> str:
		return "".join(character if character.isalnum() or character in " _-/:." else " " for character in value).replace('"', "'")

	component_ids = {component.id: f"COMPONENT_{index}" for index, component in enumerate(design.components, start=1)}
	entity_ids = {entity.name: f"ENTITY_{index}" for index, entity in enumerate(design.entities, start=1)}
	requirement_ids = {
		requirement_id: f"REQUIREMENT_{index}"
		for index, requirement_id in enumerate(
			dict.fromkeys(
				[
					requirement_id
					for component in design.components
					for requirement_id in component.satisfies
				]
				+ [
					requirement_id
					for endpoint in design.endpoints
					for requirement_id in endpoint.satisfies
				]
			),
			start=1,
		)
	}
	component_nodes = "\n".join(
		f'    {component_ids[component.id]}["{safe_label(component.name)} / {safe_label(component.kind)}"]'
		for component in design.components
	)
	component_edges = "\n".join(
		f'    {component_ids[edge.source]} -->|{safe_label(edge.label)}| {component_ids[edge.target]}'
		for edge in design.edges
		if edge.source in component_ids and edge.target in component_ids
	)
	requirement_nodes = "\n".join(
		f'    {requirement_ids[requirement_id]}["{safe_label(requirement_id)}"]'
		for requirement_id in requirement_ids
	)
	traceability_pairs = list(dict.fromkeys(
		(requirement_id, component.id)
		for component in design.components
		for requirement_id in component.satisfies
		if requirement_id in requirement_ids
	))
	traceability_edges = "\n".join(
		f"    {requirement_ids[requirement_id]} --> {component_ids[component_id]}"
		for requirement_id, component_id in traceability_pairs
	)
	api_nodes = "\n".join(
		f'    API_{index}["{safe_label(endpoint.method)} {safe_label(endpoint.path)}"]'
		for index, endpoint in enumerate(design.endpoints, start=1)
	)
	api_edges = "\n".join(
		f"    API_{index} --> {component_ids[endpoint.component_id]}"
		for index, endpoint in enumerate(design.endpoints, start=1)
		if endpoint.component_id in component_ids
	)
	entity_nodes = "\n".join(
		f'    {entity_ids[entity.name]}["{safe_label(entity.name)}: {safe_label(", ".join(field.name for field in entity.fields))}"]'
		for entity in design.entities
	)
	entity_edges = "\n".join(
		f"    {entity_ids[entity.name]} --> {entity_ids[relationship]}"
		for entity in design.entities
		for relationship in entity.relationships
		if relationship in entity_ids
	)
	api_entity_edges = "\n".join(
		f'    API_{index} -->|{relation}| {entity_ids[entity_name]}'
		for index, endpoint in enumerate(design.endpoints, start=1)
		for relation, entity_name in (("request", endpoint.request_entity), ("response", endpoint.response_entity))
		if entity_name in entity_ids
	)
	deployment_nodes = "\n".join(
		f'    {component_ids[component.id]}["{safe_label(component.name)}"]'
		for component in design.components
	)
	data_node = f'    DATA["{safe_label(architecture.data_store)} data store"]'
	deployment_edges = "\n".join(
		f"    {component_ids[edge.source]} --> {component_ids[edge.target]}"
		for edge in design.edges
		if edge.source in component_ids and edge.target in component_ids
	)
	deployment_data_edges = "\n".join(
		f"    {component_ids[component.id]} --> DATA"
		for component in design.components
		if component.kind.lower() in {"data", "repository", "persistence"}
	)
	return f"""# Generated target-system design

Architecture style: **{safe_label(architecture.style)}**
Data store: **{safe_label(architecture.data_store)}**
Rationale: {safe_label(architecture.justification)}

## Requirement-to-component traceability

```mermaid
flowchart LR
{requirement_nodes}
{component_nodes}
{traceability_edges}
```

## Generated component architecture

```mermaid
flowchart LR
{component_nodes}
{component_edges}
```

## API and data flow

```mermaid
flowchart LR
{api_nodes}
{component_nodes}
{entity_nodes}
{api_edges}
{api_entity_edges}
```

## Generated data model

```mermaid
flowchart LR
{entity_nodes}
{entity_edges}
```

## Logical deployment boundary

```mermaid
flowchart LR
{deployment_nodes}
{data_node}
{deployment_edges}
{deployment_data_edges}
```

## Design validation

- Requirement traceability: **{critique.rule_checks.traceability_percent}%**
- Structural consistency: **{critique.rule_checks.consistency_score}%**
- Untraceable component rate: **{critique.rule_checks.over_engineering_rate}%**
"""


def recommend_deployment(requirements: Requirements, architecture: Architecture) -> DeploymentRecommendation:
	requirement_text = " ".join(item.text.lower() for item in requirements.all_requirements)
	technologies = [
		DeploymentTechnology(
			role="Container packaging",
			technology="Docker-compatible OCI images",
			rationale="Provides a repeatable packaging boundary for independently testable application services without binding the design to a cloud provider.",
			status="recommendation",
		),
		DeploymentTechnology(
			role="Application hosting",
			technology="Managed container-app platform (provider not specified)",
			rationale="Fits the selected service architecture while avoiding a Kubernetes control-plane recommendation that the requirements do not justify.",
			status="recommendation",
		),
		DeploymentTechnology(
			role="Persistence",
			technology=architecture.data_store,
			rationale=f"Matches the selected data-store category; vendor, tier, region, backup policy, and schema/index details remain deployment decisions. {architecture.data_store_justification}",
			status="recommendation",
		),
		DeploymentTechnology(
			role="Ingress and transport",
			technology="HTTPS ingress with managed TLS",
			rationale="A secure transport baseline for externally reachable application endpoints; identity, private networking, and ingress product remain to be selected.",
			status="recommendation",
		),
		DeploymentTechnology(
			role="Build and delivery",
			technology="CI pipeline (GitHub Actions as a candidate)",
			rationale="Automates build, test, image publication, and deployment; repository host and release approvals were not specified.",
			status="recommendation",
		),
	]
	if any(term in requirement_text for term in ("queue", "asynchronous", "background job", "event-driven")):
		technologies.append(
			DeploymentTechnology(
				role="Asynchronous processing",
				technology="Message broker to be selected from workload and delivery guarantees",
				rationale="The requirements indicate asynchronous work; broker choice, ordering, retries, and dead-letter behavior require explicit workload and reliability constraints.",
				status="open",
			)
		)
	else:
		technologies.append(
			DeploymentTechnology(
				role="Asynchronous processing",
				technology="No message broker selected",
				rationale="No asynchronous workflow, event-delivery guarantee, or decoupled consumer is stated; adding a broker would introduce unsupported operational complexity.",
				status="open",
			)
		)
	if any(term in requirement_text for term in ("fast", "latency", "performance", "throughput")):
		technologies.append(
			DeploymentTechnology(
				role="Caching",
				technology="No cache selected pending measured access patterns",
				rationale="The performance goal has no latency target or workload profile; caching policy and invalidation would otherwise be speculative.",
				status="open",
			)
		)
	return DeploymentRecommendation(
		technologies=technologies,
		assumptions=[
			"These are technology recommendations for the generated target system, not technologies explicitly mandated by the requirements.",
			"Cloud provider, region, budget, compliance, availability target, and deployment environments must be confirmed before implementation.",
			"Only add a cache, message broker, or separate frontend hosting service when a traced requirement or measured workload justifies it.",
		],
	)


async def generate_diagram_markdown(result: dict) -> str:
	return deterministic_diagram_markdown(
		result["architecture"], result["design"], result["critique"]
	)


def build_graph():
	graph = StateGraph(PipelineState)
	graph.add_node("analyze", analyze_requirements)
	graph.add_node("disciplines", analyze_disciplines)
	graph.add_node("architect", propose_architecture)
	graph.add_node("design", design_components)
	graph.add_node("critique", critique_design)
	graph.add_node("revise", revise_design)
	graph.set_entry_point("analyze")
	graph.add_edge("analyze", "disciplines")
	graph.add_edge("disciplines", "architect")
	graph.add_edge("architect", "design")
	graph.add_edge("design", "critique")
	graph.add_edge("revise", "design")
	graph.add_conditional_edges("critique", should_revise, {"revise": "revise", "finish": END})
	return graph.compile()


async def run_pipeline(raw: str) -> dict:
	result = await build_graph().ainvoke({"raw": raw, "revisions": 0})
	result["run_id"] = str(uuid4())
	result["mamdo"] = build_mamdo_report(result).model_dump()
	result["diagram_markdown"] = await generate_diagram_markdown(result)
	result["use_cases"] = [
		use_case.model_dump()
		for use_case in _build_use_cases(result["requirements"], result["design"])
	]
	result["deployment"] = recommend_deployment(
		result["requirements"], result["architecture"]
	).model_dump()
	return result
