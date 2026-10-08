import unittest
from unittest.mock import patch

from app.graph import build_mamdo_report, run_pipeline
from app.models import (
	Architecture,
	Component,
	Critique,
	Design,
	Edge,
	Endpoint,
	Requirement,
	Requirements,
	RunResponse,
)
from app.rules import evaluate_rules
from app.providers import DemoProvider


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
