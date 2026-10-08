import re

from .models import Requirements, Design, RuleChecks

GENERIC_COMPONENT_NAMES = {
    "api",
    "application",
    "service",
    "persistence",
    "repository",
    "backend",
    "interface",
    "logic",
    "gateway",
}
GENERIC_ENDPOINT_PATHS = {"/items", "/orders", "/api", "/resources", "/v1", "/"}


def _has_dependency_cycle(edges) -> bool:
    adjacency: dict[str, list[str]] = {}
    for edge in edges:
        adjacency.setdefault(edge.source, []).append(edge.target)

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> bool:
        if node in visiting:
            return True
        if node in visited:
            return False
        visiting.add(node)
        if any(visit(target) for target in adjacency.get(node, [])):
            return True
        visiting.remove(node)
        visited.add(node)
        return False

    return any(visit(node) for node in adjacency)


def _looks_placeholder_value(value: str | None) -> bool:
    if not value:
        return True
    normalized = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    if not normalized:
        return True
    tokens = normalized.split()
    if not tokens:
        return True
    return all(token in GENERIC_COMPONENT_NAMES or token in {"entity", "resource", "model", "record", "system"} for token in tokens)


def _has_meaningful_domain_design(requirements: Requirements, design: Design) -> bool:
    if not design.components or not design.endpoints or not design.entities:
        return False

    requirement_text = " ".join(item.text.lower() for item in requirements.all_requirements)
    requirement_terms = {
        term for term in re.findall(r"[a-z][a-z0-9_-]{2,}", requirement_text)
        if term not in {"system", "users", "must", "should", "using", "available", "during"}
    }

    names = " ".join(
        [component.name.lower() for component in design.components]
        + [entity.name.lower() for entity in design.entities]
        + [endpoint.path.lower() for endpoint in design.endpoints]
    )

    generic_names_count = sum(
        1 for component in design.components if _looks_placeholder_value(component.name)
    )
    if generic_names_count == len(design.components):
        return False

    endpoints_are_meaningful = any(
        endpoint.path.lower() not in GENERIC_ENDPOINT_PATHS and endpoint.path.lower() != "/"
        for endpoint in design.endpoints
    )
    if not endpoints_are_meaningful:
        return False

    domain_match = any(term in names for term in requirement_terms)
    if not domain_match and not any(
        token in names
        for token in [
            "patient",
            "appointment",
            "record",
            "vital",
            "medication",
            "order",
            "product",
            "customer",
            "inventory",
            "audit",
            "payment",
            "report",
            "event",
            "ticket",
        ]
    ):
        return False

    return True


def evaluate_rules(requirements: Requirements, design: Design) -> RuleChecks:
    requirement_ids = {item.id for item in requirements.all_requirements}
    mapped = {tag for component in design.components for tag in component.satisfies}
    mapped.update(tag for endpoint in design.endpoints for tag in endpoint.satisfies)
    traceability = round(len(requirement_ids & mapped) / len(requirement_ids) * 100, 1) if requirement_ids else 100.0
    component_ids = {component.id for component in design.components}
    valid_edges = all(edge.source in component_ids and edge.target in component_ids for edge in design.edges)
    entity_names = {entity.name for entity in design.entities}
    valid_endpoints = all(
        endpoint.component_id in component_ids
        and (endpoint.response_entity is None or endpoint.response_entity in entity_names)
        and (endpoint.request_entity is None or endpoint.request_entity in entity_names)
        for endpoint in design.endpoints
    )
    acyclic = valid_edges and not _has_dependency_cycle(design.edges)
    meaningful = _has_meaningful_domain_design(requirements, design)
    consistency = 100.0 if valid_edges and valid_endpoints and acyclic and meaningful else 0.0
    untraceable = sum(not component.satisfies for component in design.components)
    over_engineering = round(untraceable / len(design.components) * 100, 1) if design.components else 0.0
    return RuleChecks(
        traceability_percent=traceability,
        over_engineering_rate=over_engineering,
        consistency_score=consistency,
        component_edges_valid=valid_edges,
        entity_references_valid=valid_endpoints,
        dependency_graph_acyclic=acyclic,
        meaningful_design=meaningful,
        checks=[
            f"Traceability: {len(requirement_ids & mapped)}/{len(requirement_ids)} requirements mapped",
            f"API component and entity references valid: {valid_endpoints}",
            f"Component edges valid: {valid_edges}",
            f"Dependency graph is acyclic: {acyclic}",
            f"Design is domain-specific and meaningful: {meaningful}",
            f"Untraceable components: {untraceable}/{len(design.components)}",
        ],
    )
