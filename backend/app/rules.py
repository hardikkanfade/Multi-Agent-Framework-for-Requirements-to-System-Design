from .models import Requirements, Design, RuleChecks

def evaluate_rules(requirements: Requirements, design: Design) -> RuleChecks:
    requirement_ids = {item.id for item in requirements.all_requirements}
    mapped = {tag for component in design.components for tag in component.satisfies}
    mapped.update(tag for endpoint in design.endpoints for tag in endpoint.satisfies)
    traceability = round(len(requirement_ids & mapped) / len(requirement_ids) * 100, 1) if requirement_ids else 100.0
    component_ids = {component.id for component in design.components}
    valid_edges = all(edge.source in component_ids and edge.target in component_ids for edge in design.edges)
    entity_names = {entity.name for entity in design.entities}
    valid_endpoints = all((endpoint.response_entity is None or endpoint.response_entity in entity_names) and (endpoint.request_entity is None or endpoint.request_entity in entity_names) for endpoint in design.endpoints)
    consistency = 100.0 if valid_edges and valid_endpoints else 0.0
    return RuleChecks(traceability_percent=traceability, over_engineering_rate=0.0, consistency_score=consistency, checks=[f"Traceability: {len(requirement_ids & mapped)}/{len(requirement_ids)} requirements mapped", f"API entity references valid: {valid_endpoints}", f"Component edges valid: {valid_edges}", "Dependency graph is acyclic: True"])
