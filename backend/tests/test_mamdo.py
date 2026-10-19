import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.graph import _complete_json_with_retry, build_mamdo_report, run_pipeline
from app.models import (
	Architecture,
	Component,
	Critique,
	DesignChatRequest,
	Design,
	Edge,
	Endpoint,
	Requirement,
	Requirements,
	RunResponse,
)
from app.rules import evaluate_rules
from app.providers import DemoProvider, GeminiProvider, ProviderError, get_provider
from app.main import app, design_chat


class MamdoValidationTests(unittest.TestCase):
	def setUp(self):
		self.requirements = Requirements(
			functional=[
				Requirement(id="FR-1", text="Users can create items", kind="functional", confidence=1.0),
			],
			non_functional=[],
			ambiguities=[],
		)

	def test_dependency_cycle_fails_consistency_constraint(self):
		design = Design(
			components=[
				Component(id="api", name="API", kind="interface", satisfies=["FR-1"]),
				Component(id="service", name="Service", kind="service", satisfies=["FR-1"]),
			],
			edges=[
				Edge(source="api", target="service", label="calls"),
				Edge(source="service", target="api", label="calls"),
			],
			entities=[],
			endpoints=[Endpoint(method="POST", path="/items", component_id="api", satisfies=["FR-1"])],
		)

		checks = evaluate_rules(self.requirements, design)

		self.assertFalse(checks.dependency_graph_acyclic)
		self.assertEqual(checks.consistency_score, 0)

	def test_endpoint_with_unknown_component_fails_reference_constraint(self):
		design = Design(
			components=[
				Component(id="api", name="API", kind="interface", satisfies=["FR-1"]),
			],
			edges=[],
			entities=[],
			endpoints=[Endpoint(method="POST", path="/items", component_id="missing", satisfies=["FR-1"])],
		)

		checks = evaluate_rules(self.requirements, design)

		self.assertFalse(checks.entity_references_valid)
		self.assertEqual(checks.consistency_score, 0)

	def test_mamdo_report_exposes_measured_objectives_and_constraints(self):
		design = Design(
			components=[
				Component(id="api", name="API", kind="interface", satisfies=["FR-1"]),
				Component(id="service", name="Service", kind="service", satisfies=["FR-1"]),
			],
			edges=[Edge(source="api", target="service", label="calls")],
			entities=[],
			endpoints=[Endpoint(method="POST", path="/items", component_id="api", satisfies=["FR-1"])],
		)
		checks = evaluate_rules(self.requirements, design)
		state = {
			"requirements": self.requirements,
			"architecture": Architecture(
				style="modular_monolith",
				justification="A single deployable system is sufficient.",
				trade_offs=[],
				components=["api", "service"],
				data_store="relational",
				data_store_justification="",
				traceability={"FR-1": ["api", "service"]},
			),
			"design": design,
			"critique": Critique(
				accepted=True,
				issues=[],
				rule_checks=checks,
				summary="Valid",
			),
			"discipline_analyses": [],
			"revisions": 0,
		}

		report = build_mamdo_report(state)

		self.assertTrue(report.feasible)
		self.assertEqual(report.objectives[0].value, 100)
		self.assertTrue(all(constraint.satisfied for constraint in report.constraints))
		self.assertEqual(report.design_iterations, 1)


class MamdoPipelineTests(unittest.IsolatedAsyncioTestCase):
	def test_gemini_mode_requires_an_api_key(self):
		with patch("app.providers.settings.llm_provider", "gemini"), patch(
			"app.providers.settings.gemini_api_key", ""
		):
			with self.assertRaisesRegex(ProviderError, "GEMINI_API_KEY is required"):
				get_provider()

	def test_unknown_provider_mode_is_rejected(self):
		with patch("app.providers.settings.llm_provider", "unknown"):
			with self.assertRaisesRegex(ProviderError, "Unsupported LLM_PROVIDER"):
				get_provider()

	async def test_gemini_rejects_invalid_json_instead_of_using_fallback(self):
		provider = GeminiProvider()
		with patch.object(provider, "_request", new=AsyncMock(return_value="not JSON")):
			with self.assertRaisesRegex(ProviderError, "Gemini returned invalid JSON"):
				await provider.complete_json("test prompt", {"fallback": True})

	async def test_quota_errors_are_not_retried(self):
		provider = DemoProvider()
		with patch.object(
			provider,
			"complete_json",
			new=AsyncMock(side_effect=ProviderError("Gemini API request failed with HTTP 429", 429)),
		) as complete_json:
			with self.assertRaisesRegex(ProviderError, "HTTP 429"):
				await _complete_json_with_retry(provider, "test prompt", {})
		complete_json.assert_awaited_once()

	async def test_demo_chat_returns_a_grounded_context_only_response(self):
		request = DesignChatRequest(
			message="Which requirement does GET /products satisfy?",
			design_context={
				"summary": "A modular monolith was selected for the order system.",
				"requirements": [
					{"id": "FR-1", "text": "Customers can place orders."},
					{"id": "FR-2", "text": "Customers can browse products."},
				],
				"components": [{"id": "orders", "name": "Order Management Service"}],
				"endpoints": [{
					"method": "GET",
					"path": "/products",
					"component_id": "catalog",
					"satisfies": ["FR-2"],
				}],
			},
		)
		with patch("app.main.get_provider", return_value=DemoProvider()):
			response = await design_chat(request)

		self.assertIn("modular monolith", response["reply"])
		self.assertIn("FR-2: Customers can browse products", response["reply"])
		self.assertEqual(response["provider_mode"], "demo")

	async def test_chat_surfaces_error_when_provider_is_unavailable(self):
		request = DesignChatRequest(
			message="Which requirement does GET /products satisfy?",
			design_context={
				"summary": "A catalog API serves product browsing.",
				"requirements": [{"id": "FR-1", "text": "Customers can browse products."}],
				"endpoints": [{
					"method": "GET",
					"path": "/products",
					"component_id": "catalog",
					"satisfies": ["FR-1"],
				}],
				"components": [{"id": "catalog", "name": "Product Catalog Service"}],
			},
		)
		provider = DemoProvider()
		with patch("app.main.get_provider", return_value=provider), patch.object(
			provider,
			"complete_text",
			side_effect=ProviderError("Hosted provider request failed with HTTP 429"),
		):
			with self.assertRaisesRegex(ProviderError, "HTTP 429"):
				await design_chat(request)

	async def test_pipeline_surfaces_provider_errors_instead_of_returning_local_design(self):
		provider = DemoProvider()
		with patch(
			"app.graph.get_provider",
			return_value=provider,
		), patch.object(
			provider,
			"complete_json",
			side_effect=ProviderError("Gemini request failed with HTTP 401"),
		):
			with self.assertRaisesRegex(
				ProviderError, "Requirements analysis failed.*HTTP 401"
			):
				await run_pipeline("Customers can browse the product catalog.")

	def test_generate_endpoint_returns_provider_errors_as_http_502(self):
		with patch(
			"app.graph.get_provider",
			side_effect=ProviderError("GEMINI_API_KEY is required"),
		):
			with TestClient(app) as client:
				response = client.post(
					"/generate",
					json={"requirements_text": "Customers can browse the product catalog."},
				)

		self.assertEqual(response.status_code, 502)
		self.assertIn("GEMINI_API_KEY is required", response.json()["detail"])

	async def test_demo_pipeline_returns_feasible_mamdo_report(self):
		with patch("app.graph.get_provider", return_value=DemoProvider()):
			result = await run_pipeline(
				"Customers can browse products and place orders. Orders must be auditable."
			)

		self.assertTrue(result["mamdo"]["feasible"])
		self.assertEqual(
			[item["discipline"] for item in result["mamdo"]["disciplines"]],
			["application", "data", "security", "operations"],
		)
		self.assertEqual(len(result["mamdo"]["objectives"]), 3)
		self.assertIn("Generated target-system design", result["diagram_markdown"])
		self.assertIn("POST /orders", result["diagram_markdown"])
		self.assertIn("Product", result["diagram_markdown"])
		self.assertIn("Order", result["diagram_markdown"])
		self.assertNotIn("LangGraph", result["diagram_markdown"])
		self.assertNotIn("React workbench", result["diagram_markdown"])
		self.assertIn("advocate_response", result["architecture_debate"])
		self.assertIn("accepted_objections", result["architecture_debate"])
		self.assertIn("deferred_objections", result["architecture_debate"])
		deployment_roles = {
			item["role"] for item in result["deployment"]["technologies"]
		}
		self.assertIn("Container packaging", deployment_roles)
		self.assertIn("Application hosting", deployment_roles)
		self.assertIn("Persistence", deployment_roles)
		response = RunResponse(**result)
		self.assertTrue(response.mamdo.feasible)
		self.assertTrue(response.deployment.technologies)
		self.assertIsInstance(response.architecture_debate["deferred_objections"], list)

	async def test_demo_design_uses_resources_from_custom_requirements(self):
		with patch("app.graph.get_provider", return_value=DemoProvider()):
			result = await run_pipeline(
				"Library members can search books and borrow books. Every checkout must be auditable."
			)

		entity_names = {entity.name for entity in result["design"].entities}
		endpoint_paths = {endpoint.path for endpoint in result["design"].endpoints}
		self.assertIn("Book", entity_names)
		self.assertIn("AuditLog", entity_names)
		self.assertIn("/books", endpoint_paths)
		self.assertIn("/books/{entityId}/audit-events", endpoint_paths)
		self.assertNotIn("/must", endpoint_paths)
		self.assertNotIn("Item", entity_names)
		self.assertNotIn("LangGraph", result["diagram_markdown"])

	async def test_demo_result_has_atomic_requirements_use_cases_and_domain_detail(self):
		with patch("app.graph.get_provider", return_value=DemoProvider()):
			result = await run_pipeline(
				"Customers can browse products and place orders. "
				"Orders must be auditable. The system should respond fast."
			)

		functional_ids = [item.id for item in result["requirements"].functional]
		nonfunctional_ids = [item.id for item in result["requirements"].non_functional]
		self.assertEqual(functional_ids, ["FR-1", "FR-2", "FR-3"])
		self.assertEqual(nonfunctional_ids, ["NFR-1"])
		self.assertTrue(any("browse products" in item.text.lower() for item in result["requirements"].functional))
		self.assertTrue(any("place orders" in item.text.lower() for item in result["requirements"].functional))

		endpoint_pairs = {(item.method, item.path) for item in result["design"].endpoints}
		self.assertIn(("GET", "/products"), endpoint_pairs)
		self.assertIn(("POST", "/orders"), endpoint_pairs)
		self.assertIn(("GET", "/orders/{entityId}/audit-events"), endpoint_pairs)
		entity_fields = {
			entity.name: {field.name for field in entity.fields}
			for entity in result["design"].entities
		}
		self.assertTrue({"name", "price"} <= entity_fields["Product"])
		self.assertTrue({"status", "total_amount"} <= entity_fields["Order"])
		self.assertTrue({"action", "entity_type", "entity_id", "occurred_at"} <= entity_fields["AuditLog"])
		self.assertIn("OrderItem", entity_fields)

		self.assertEqual(len(result["use_cases"]), 3)
		order_flow = next(item for item in result["use_cases"] if "place orders" in item["goal"].lower())
		self.assertTrue(any("Audit Logging Service" in step for step in order_flow["main_flow"]))
		self.assertTrue(result["design"].assumptions)
		self.assertTrue(any(issue.category == "open_acceptance_criteria" for issue in result["critique"].issues))
		self.assertIn("not proof of production readiness", result["critique"].summary.lower())
		self.assertTrue(result["mamdo"]["feasible"])


if __name__ == "__main__":
	unittest.main()
