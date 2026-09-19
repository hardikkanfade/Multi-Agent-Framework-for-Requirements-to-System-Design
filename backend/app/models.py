from pydantic import BaseModel, Field

class Requirement(BaseModel):
	id: str
	text: str
	kind: str
	confidence: float

class Ambiguity(BaseModel):
	id: str
	description: str
	confidence: float
	related_requirement_ids: list[str]

class Requirements(BaseModel):
	functional: list[Requirement]
	non_functional: list[Requirement]
	ambiguities: list[Ambiguity]
	conflicts: list[str] = Field(default_factory=list)
	@property
	def all_requirements(self):
		return self.functional + self.non_functional

class Traceability(BaseModel):
	pass

class Architecture(BaseModel):
	style: str
	justification: str
	trade_offs: list[str]
	components: list[str]
	data_store: str
	data_store_justification: str
	traceability: dict[str, list[str]]

class Component(BaseModel):
	id: str
	name: str
	kind: str
	satisfies: list[str]

class Edge(BaseModel):
	source: str
	target: str
	label: str

class EntityField(BaseModel):
	name: str
	type: str
	required: bool = True

class Entity(BaseModel):
	name: str
	fields: list[EntityField]
	relationships: list[str]
	satisfies: list[str]

class Endpoint(BaseModel):
	method: str
	path: str
	component_id: str
	request_entity: str | None = None
	response_entity: str | None = None
	satisfies: list[str]

class Design(BaseModel):
	components: list[Component]
	edges: list[Edge]
	entities: list[Entity]
	endpoints: list[Endpoint]

class Issue(BaseModel):
	severity: str
	category: str
	message: str
	related_ids: list[str]

class RuleChecks(BaseModel):
	traceability_percent: float
	over_engineering_rate: float
	consistency_score: float
	checks: list[str]

class Critique(BaseModel):
	accepted: bool
	issues: list[Issue]
	rule_checks: RuleChecks
	summary: str

class GenerateRequest(BaseModel):
	requirements_text: str = Field(min_length=20)

class ChangeRequest(BaseModel):
	requirements_text: str = Field(min_length=20)
	change_request: str = Field(min_length=10)

class RunResponse(BaseModel):
	run_id: str
	requirements: Requirements
	architecture: Architecture
	design: Design
	critique: Critique
	revisions: int
	architecture_debate: dict[str, str] = Field(default_factory=dict)
	diagram_markdown: str
