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
		response = RunResponse(**result)
		self.assertTrue(response.mamdo.feasible)


if __name__ == "__main__":
	unittest.main()
