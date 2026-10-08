import React, { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8003";
const API_BASE_URL = (
  (import.meta.env.VITE_API_URL && import.meta.env.VITE_API_URL.trim()) ||
  DEFAULT_API_BASE_URL
).replace(/\/$/, "");

const sample =
  "Customers can browse products and place orders. Orders must be auditable. The system should respond fast.";
const agents = [
  ["01", "Requirement analyst", "Extract FR/NFR + ambiguities"],
  ["02", "Parallel disciplines", "Application · data · security · operations"],
  ["03", "MDF system optimizer", "Reconcile coupled decisions and constraints"],
  ["04", "Component/API designer", "Create traceable contracts"],
  ["05", "Critic + deterministic rules", "Measure feasibility and design quality"],
  ["06", "Revision controller", "Revise until feasible or bounded limit"],
];
const srsSections = [
  ["01", "Document purpose"],
  ["02", "Product scope"],
  ["03", "Definitions"],
  ["04", "Stakeholders"],
  ["05", "Assumptions"],
  ["06", "System context"],
  ["07", "Functional requirements"],
  ["08", "Non-functional requirements"],
  ["09", "Use cases"],
  ["10", "Interfaces and data"],
  ["11", "Security and privacy"],
  ["12", "Verification and acceptance"],
  ["13", "Status and approval"],
];

let mermaidLoader;

function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        themeVariables: {
          primaryColor: "#dfe5a5",
          primaryTextColor: "#17211d",
          lineColor: "#84902d",
          secondaryColor: "#e5e5da",
          tertiaryColor: "#f2f0e9",
        },
      });
      return mermaid;
    });
  }
  return mermaidLoader;
}

function systemRequirements(result) {
  return [
    ...result.requirements.functional,
    ...result.requirements.non_functional,
  ];
}

function markdownLabel(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/["`<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDesignViews(result) {
  const requirements = systemRequirements(result);
  const { architecture, design } = result;
  const safe = (value) =>
    markdownLabel(value).replace(/[\[\]{}|#;]/g, " ").replace(/\s+/g, " ");
  const entities = design.entities;
  const components = design.components;
  const endpoints = design.endpoints;
  const useCases = result.use_cases || [];
  const technologies = result.deployment?.technologies || [];
  const requirementsById = new Map(requirements.map((item) => [item.id, item]));
  const componentById = new Map(components.map((item) => [item.id, item]));
  const entityByName = new Map(entities.map((item) => [item.name, item]));
  const componentKey = (component) => `C${components.indexOf(component) + 1}`;
  const entityKey = (entity) => `D${entities.indexOf(entity) + 1}`;
  const requirementKey = (requirement) =>
    `R${requirements.indexOf(requirement) + 1}`;
  const endpointKey = (endpoint) => `API${endpoints.indexOf(endpoint) + 1}`;
  const lines = (items, render, fallback) =>
    items.length ? items.map(render).join("\n") : `  EMPTY["${fallback}"]`;
  const requirementNodes = lines(
    requirements,
    (item) =>
      `  ${requirementKey(item)}["${safe(item.id)}: ${safe(item.text)}"]`,
    "No requirements extracted",
  );
  const componentNodes = lines(
    components,
    (item) =>
      `  ${componentKey(item)}["${safe(item.name)} / ${safe(item.kind)} / ${safe(item.satisfies.join(", "))}"]`,
    "No components generated",
  );
  const endpointNodes = lines(
    endpoints,
    (item) =>
      `  ${endpointKey(item)}["${safe(item.method)} ${safe(item.path)} / ${safe(item.satisfies.join(", "))}"]`,
    "No API contracts generated",
  );
  const entityNodes = lines(
    entities,
    (item) =>
      `  ${entityKey(item)}["${safe(item.name)}: ${safe(item.fields.map((field) => `${field.name} (${field.type}${field.required ? ", required" : ""})`).join(", "))}"]`,
    "No domain entities generated",
  );
  const componentEdges = design.edges
    .filter((edge) => componentById.has(edge.source) && componentById.has(edge.target))
    .map(
      (edge) =>
        `  ${componentKey(componentById.get(edge.source))} -->|${safe(edge.label)}| ${componentKey(componentById.get(edge.target))}`,
    );
  const apiEdges = endpoints.flatMap((endpoint) => {
    const edges = [];
    if (componentById.has(endpoint.component_id)) {
      edges.push(`  ${endpointKey(endpoint)} -->|handled by| ${componentKey(componentById.get(endpoint.component_id))}`);
    }
    for (const [label, name] of [["request", endpoint.request_entity], ["response", endpoint.response_entity]]) {
      if (entityByName.has(name)) {
        edges.push(`  ${endpointKey(endpoint)} -->|${label}| ${entityKey(entityByName.get(name))}`);
      }
    }
    return edges;
  });
  const traceabilityEdges = requirements.flatMap((requirement) => {
    const targets = [
      ...components.filter((item) => item.satisfies.includes(requirement.id)).map(componentKey),
      ...endpoints.filter((item) => item.satisfies.includes(requirement.id)).map(endpointKey),
    ];
    return [...new Set(targets)].map(
      (target) => `  ${requirementKey(requirement)} --> ${target}`,
    );
  });
  const entityRelationships = entities.flatMap((entity) =>
    (entity.relationships || [])
      .filter((name) => entityByName.has(name))
      .map((name) => `  ${entityKey(entity)} -->|relationship declared; cardinality unspecified| ${entityKey(entityByName.get(name))}`),
  );
  const erEntities = entities.map((entity) => {
    const fields = entity.fields.map(
      (field) => `    ${safe(field.type).replace(/\W/g, "_")} ${safe(field.name).replace(/\W/g, "_")}`,
    );
    return `  ${entity.name.replace(/\W/g, "_")} {\n${fields.join("\n")}\n  }`;
  });
  const erRelationships = entities.flatMap((entity) =>
    (entity.relationships || [])
      .filter((name) => entityByName.has(name))
      .map((name) => `  ${entity.name.replace(/\W/g, "_")} ||--o{ ${name.replace(/\W/g, "_")} : "relationship; cardinality to confirm"`),
  );
  const sequenceDiagram = (useCase) => {
    const actorName = safe(useCase?.actor || "User").replace(/\W/g, "_") || "User";
    const flow = useCase?.main_flow?.length
      ? useCase.main_flow
      : endpoints.map((item) => `${item.method} ${item.path}`);
    const endpoint = endpoints.find((item) =>
      (useCase?.endpoint_refs || []).includes(`${item.method} ${item.path}`),
    );
    const service = endpoint && componentById.get(endpoint.component_id);
    return [
      "sequenceDiagram",
      `  actor ${actorName} as ${safe(useCase?.actor || "User")}`,
      "  participant API as Target API",
      ...(service ? [`  participant SVC as ${safe(service.name)}`] : []),
      ...(entities.length ? [`  participant DB as ${safe(architecture.data_store)} persistence`] : []),
      ...flow.flatMap((step, index) => {
        const operation = index === 0 ? (endpoint ? `${endpoint.method} ${endpoint.path}` : "Initiate requested workflow") : safe(step);
        const messages = [`  ${actorName}->>API: ${operation}`];
        if (service) messages.push(`  API->>SVC: ${safe(step)}`);
        if (entities.length && /(save|record|store|create|update|persist|audit)/i.test(step)) {
          messages.push(`  SVC->>DB: Persist ${safe(entities.map((item) => item.name).join(", "))}`);
        }
        if (index === flow.length - 1) messages.push(`  API-->>${actorName}: ${safe(useCase?.postconditions?.[0] || "Return operation outcome")}`);
        return messages;
      }),
    ].join("\n");
  };
  const activityDiagram = (useCase) => {
    const steps = useCase?.main_flow || [];
    return [
      "flowchart TD",
      "  START([Start])",
      ...steps.map((step, index) => `  ACT${index + 1}["${safe(step)}"]`),
      `  DONE([${safe(useCase?.postconditions?.[0] || "Outcome requires confirmation")}])`,
      `  START --> ${steps.length ? "ACT1" : "DONE"}`,
      ...steps.slice(1).map((_, index) => `  ACT${index + 1} --> ACT${index + 2}`),
      ...(steps.length ? [`  ACT${steps.length} --> DONE`] : []),
    ].join("\n");
  };
  const sequence = sequenceDiagram(useCases[0]);
  const activity = activityDiagram(useCases[0]);
  const technologyNodes = technologies.map(
    (item, index) => `    TECH${index}["${safe(item.role)}: ${safe(item.technology)} (${safe(item.status)})"]`,
  );
  const useCaseFlow = [
    "flowchart LR",
    ...useCases.flatMap((item, index) => [
      `  ACTOR${index}(["${safe(item.actor)}"]) --> UC${index}["${safe(item.name)}: ${safe(item.goal)}"]`,
      ...(item.endpoint_refs || []).map((reference) => `  UC${index} -->|"${safe(item.requirement_ids.join(", "))}"| ${`EP${Math.max(0, endpoints.findIndex((endpoint) => `${endpoint.method} ${endpoint.path}` === reference))}`}`),
    ]),
    ...endpoints.map((endpoint, index) => `  EP${index}["${safe(endpoint.method)} ${safe(endpoint.path)}"]`),
  ].join("\n");
  const deployment = [
    "flowchart TB",
    '  subgraph EDGE["External access"]',
    '    CLIENT["Requirement-derived user / client"] --> HTTPS["HTTPS ingress / managed TLS (recommendation)"]',
    "  end",
    '  subgraph APP["Application hosting: managed container platform (provider not specified)"]',
    '    IMAGE["Docker-compatible OCI image recommendation"]',
    ...components.map((item) => `    ${componentKey(item)}["${safe(item.name)} / ${safe(item.kind)}"]`),
    "  end",
    '  subgraph STACK["Recommended deployment technologies / unconfirmed choices"]',
    ...technologyNodes,
    "  end",
    `  STORE[("${safe(architecture.data_store)} / vendor and tier open")]`,
    "  HTTPS --> IMAGE",
    ...components.map((item) => `  IMAGE --> ${componentKey(item)}`),
    ...componentEdges,
    ...components.filter((item) => ["data", "repository", "persistence"].includes(item.kind.toLowerCase())).map((item) => `  ${componentKey(item)} --> STORE`),
    ...technologies.map((_, index) => `  IMAGE -.deployment stack.-> TECH${index}`),
  ].join("\n");
  const packageDiagram = [
    "flowchart TB",
    '  subgraph API_PACKAGE["API / contracts"]',
    ...endpoints.map((item) => `    ${endpointKey(item)}["${safe(item.method)} ${safe(item.path)}"]`),
    "  end",
    '  subgraph DOMAIN_PACKAGE["Domain capabilities"]',
    ...components.map((item) => `    ${componentKey(item)}["${safe(item.name)}"]`),
    "  end",
    '  subgraph DATA_PACKAGE["Domain data"]',
    ...entities.map((item) => `    ${entityKey(item)}["${safe(item.name)}"]`),
    "  end",
    ...apiEdges,
    ...componentEdges,
  ].join("\n");
  const classDiagram = [
    "classDiagram",
    ...components.map((item) => {
      const methods = endpoints.filter((endpoint) => endpoint.component_id === item.id)
        .map((endpoint) => `    +${safe(endpoint.method.toLowerCase())}_${safe(endpoint.path).replace(/\W/g, "_")}()`);
      return `  class ${componentKey(item)}["${safe(item.name)}"] {\n    <<${safe(item.kind)}>>\n${methods.join("\n")}\n  }`;
    }),
    ...entities.map((item) =>
      `  class ${entityKey(item)}["${safe(item.name)}"] {\n${item.fields.map((field) => `    ${safe(field.type)} ${safe(field.name)}`).join("\n")}\n  }`,
    ),
    ...componentEdges.map((edge) => edge.replace(/^  (\w+) -->\|([^|]+)\| (\w+)$/, "  $1 --> $3 : $2")),
    ...entities.flatMap((entity) =>
      (entity.relationships || []).filter((name) => entityByName.has(name))
        .map((name) => `  ${entityKey(entity)} --> ${entityKey(entityByName.get(name))} : relationship (cardinality open)`),
    ),
  ].join("\n");
  const stateDiagram = [
    "stateDiagram-v2",
    "  [*] --> StateNotSpecified",
    '  StateNotSpecified : Lifecycle states are not fully specified by the requirements',
    ...(entities.some((item) => item.fields.some((field) => field.name.toLowerCase() === "status"))
      ? ["  StateNotSpecified --> StateFieldPresent : status field exists; valid values and transitions require confirmation"]
      : []),
    "  StateNotSpecified --> [*]",
  ].join("\n");
  const schemaDiagram = [
    "erDiagram",
    ...erEntities,
    ...erRelationships,
    ...(entities.length ? [] : ["  NO_DOMAIN_DATA { string no_data }"]),
  ].join("\n");
  const dataFlow = [
    "flowchart LR",
    '  USER(["Requirement actor"])',
    ...endpoints.map((item, index) => `  API${index}["${safe(item.method)} ${safe(item.path)} / ${safe(item.satisfies.join(", "))}"]`),
    ...components.map((item) => `  ${componentKey(item)}["${safe(item.name)}"]`),
    ...entities.map((item) => `  ${entityKey(item)}[("${safe(item.name)}")]`),
    ...endpoints.map((item, index) => `  USER --> API${index}`),
    ...apiEdges,
    ...entityRelationships,
  ].join("\n");
  const network = [
    "flowchart LR",
    '  CLIENT(["Users / clients identified from requirements"])',
    '  TLS["HTTPS ingress and TLS termination recommendation"]',
    '  APP["Private application service boundary"]',
    `  DB[("${safe(architecture.data_store)} persistence boundary")]`,
    "  CLIENT -->|HTTPS| TLS --> APP -->|restricted data access| DB",
    '  UNDECIDED["VNet, subnets, firewall, DNS, region and private endpoint: not specified"]',
    "  UNDECIDED -.confirm before deployment.-> APP",
  ].join("\n");
  const baseFlow = `flowchart LR\n${componentNodes}\n${componentEdges.join("\n")}`;
  const endpointFlow = `flowchart LR\n${endpointNodes}\n${componentNodes}\n${entityNodes}\n${apiEdges.join("\n")}`;
  const contextDiagram = [
    "flowchart LR",
    ...new Set(useCases.map((item, index) => `  ACTOR${index}(["${safe(item.actor)}"])`)),
    '  SYSTEM[["Target system derived from requirements"]]',
    ...endpoints.map((item, index) => `  API${index}["${safe(item.method)} ${safe(item.path)}"]`),
    ...useCases.map((item, index) => `  ACTOR${index} -->|"${safe(item.requirement_ids.join(", "))}: ${safe(item.goal)}"| SYSTEM`),
    ...endpoints.map((item, index) => `  SYSTEM --> API${index}`),
  ].join("\n");
  const contextBody = contextDiagram.replace(/^flowchart LR\n/, "");
  const deploymentBody = deployment.replace(/^flowchart TB\n/, "");
  const persistenceComponent = components.find((item) =>
    ["data", "repository", "persistence"].includes(item.kind.toLowerCase()),
  );
  const architectureDiagram = [
    "flowchart TB",
    ...useCases.map((item, index) => `  ACTOR${index}(["${safe(item.actor)}"]) -->|${safe(item.requirement_ids.join(", "))}| GOAL${index}["${safe(item.goal)}"]`),
    ...useCases.map((_, index) => `  GOAL${index} --> SYSTEM[["Target system"]]`),
    ...components.map((item) => `  SYSTEM --> ${componentKey(item)}["${safe(item.name)} / ${safe(item.kind)}"]`),
    ...componentEdges,
    ...entities.map((item) => `  ${persistenceComponent ? componentKey(persistenceComponent) : "SYSTEM"} --> ${entityKey(item)}[("${safe(item.name)}")]`),
    `  STORE[("${safe(architecture.data_store)} store category")]`,
    ...entities.map((item) => `  ${entityKey(item)} --> STORE`),
  ].join("\n");
  const primaryUseCase = useCases[0];
  const primaryEndpoint =
    endpoints.find((item) =>
      (primaryUseCase?.endpoint_refs || []).includes(`${item.method} ${item.path}`),
    ) || endpoints[0];
  const algorithmIsWrite =
    primaryEndpoint && !["GET", "HEAD"].includes(primaryEndpoint.method.toUpperCase());
  const algorithmDataStep = algorithmIsWrite
    ? `PERSIST["Persist ${safe([primaryEndpoint.request_entity, primaryEndpoint.response_entity].filter(Boolean).join(", ") || entities.map((item) => item.name).join(", ") || "domain result")}"]`
    : `READ["Read data needed for ${safe(primaryUseCase?.goal || "the requested goal")}"]`;
  const menu = [
    ["HLD", [
      ["Architecture Diagram", architectureDiagram, "Connects actual actor goals and requirement IDs to generated components, named domain entities, and the selected data-store category.", "A generic cloud reference architecture would add unrequested products and hide the requirement-to-service mapping."],
      ["System Context Diagram", contextDiagram, "Places each extracted actor goal and generated endpoint across the target-system boundary.", "A broad enterprise context map would invent external systems and stakeholders not stated in the requirements."],
      ["Component Diagram", baseFlow, "Uses the generated component responsibilities and labeled dependency edges, including component requirement tags.", "A class diagram would be too implementation-specific for an HLD component-boundary decision."],
      ["Deployment Diagram", deployment, "Maps logical services and persistence to explicit, labeled deployment technology recommendations; unchosen provider, region, and capacity remain visible as open decisions.", "A provider-specific topology would falsely imply the user selected a cloud vendor or operational tier."],
      ["Data Flow Diagram (DFD)", dataFlow, "Traces actor-to-endpoint-to-handler-to-entity data paths for this run's actual API and domain model.", "A sequence diagram emphasizes time order rather than the system's data stores and requirement-linked flows."],
      ["ER Diagram", schemaDiagram, "Uses the generated entity names, fields, and declared relationships; relationship cardinality is explicitly left for confirmation.", "A class diagram mixes domain persistence structure with methods and service behavior."],
      ["Database Schema Diagram", schemaDiagram, "Shows the generated fields and relationships without inventing a vendor, indexes, keys, or migration strategy.", "A vendor-specific schema requires primary-key, index, constraint, and storage-engine decisions not established by the input."],
      ["Sequence Diagram", sequence, "Orders the selected actor use case through its matched API and responsible component; persistence appears only when the flow implies a write.", "A static component view cannot explain the user interaction order or request handling path."],
      ["Activity Diagram", activity, "Turns an extracted use case's actual main-flow steps and stated outcome into an ordered workflow.", "A state diagram models persistent lifecycle state, not the sequence of actions in one actor goal."],
      ["Use Case Diagram", useCaseFlow, "Connects extracted actor goals to API operations and their source requirement IDs.", "A screen-navigation diagram would invent UI screens that were not required."],
      ["State Diagram", stateDiagram, "Highlights whether the generated domain model contains an explicit status field while keeping unsupported lifecycle transitions unasserted.", "A detailed state machine would invent legal states and transitions absent from the requirements."],
      ["Network Architecture Diagram", network, "Shows the externally reachable API boundary, recommended TLS path, data access boundary, and deployment network questions.", "A subnet/IP diagram would fabricate address ranges, regions, and firewall rules."],
      ["API Architecture Diagram", endpointFlow, "Connects each concrete method/path to its handling component, request/response entity, and requirement IDs.", "An OpenAPI document alone describes syntax but not which generated component owns each operation."],
      ["Data Architecture Diagram", `flowchart TB\n${entityNodes}\n${entityRelationships.join("\n")}\n  STORE[("${safe(architecture.data_store)} / vendor open")]\n${entities.map((item) => `  ${entityKey(item)} --> STORE`).join("\n")}`, "Shows the generated domain entities and their persistence destination, keeping the selected store category distinct from an unspecified vendor.", "A data-lake/warehouse topology would introduce analytics workloads not present in the stated goals."],
      ["Infrastructure Diagram", `flowchart TB\n${deploymentBody}\n  OBS["Observability, backup, secrets and recovery targets: confirm"]\n  IMAGE -.configure.-> OBS`, "Shows runtime, delivery, ingress, persistence, and the operations decisions that must be confirmed for the target.", "A fully provisioned infrastructure-as-code diagram would claim subscription, region, SKU, and recovery choices not supplied."],
      ["Scalability Architecture Diagram", `flowchart LR\n${contextBody}\n  SCALE["Horizontal scaling is a candidate; workload and SLO not supplied"]\n  SYSTEM --> SCALE`, "Relates user-facing capabilities to a scale-out candidate without asserting replica counts or thresholds.", "A capacity plan would need workload, traffic shape, latency SLO, and cost constraints that are not stated."],
      ["Load Balancing Diagram", `flowchart LR\n  CLIENT(["Clients"]) --> INGRESS["Managed HTTPS ingress / load balancing recommendation"]\n  INGRESS --> APP["Target API service"]\n  APP --> DATA[("${safe(architecture.data_store)}")]\n  CAPACITY["Health probes, zone count and balancing policy: open"] -.configure.-> INGRESS`, "Makes the ingress-to-service path explicit and marks health and availability policy as undecided.", "A detailed L4/L7 rule set would invent routing, health checks, and failover objectives."],
      ["Caching Architecture Diagram", `flowchart LR\n  CLIENT(["Client"]) --> API["Requirement-derived API"] --> DB[("${safe(architecture.data_store)}")]\n  CACHE["No cache selected: measure access pattern and latency target first"] -.not enabled.-> API`, "Shows the actual source-of-truth path and makes cache absence a deliberate, evidence-based decision.", "A cache-aside topology would imply freshness, invalidation, and consistency guarantees that requirements do not define."],
      ["Message Queue Architecture Diagram", `flowchart LR\n  PRODUCER["Requirement-derived operation"] --> SERVICE["Target component"] --> DB[("${safe(architecture.data_store)}")]\n  QUEUE["No broker selected: no asynchronous consumer is specified"] -.candidate only.-> SERVICE`, "Shows the synchronous path currently supported by the generated contracts and identifies the evidence needed before adding messaging.", "A broker topology would invent asynchronous semantics, delivery guarantees, and consumer workloads."],
    ]],
    ["LLD", [
      ["Class Diagram", classDiagram, "Combines generated domain fields with service classes and the concrete API operations assigned to each service.", "A conceptual entity map omits the operations that implement the requested behaviors."],
      ["Object Diagram", `flowchart LR\n${entities.map((item, index) => `  OBJ${index}["${safe(item.name)} instance / values intentionally omitted"]`).join("\n") || '  EMPTY["No entities"]'}\n${entities.flatMap((entity, index) => (entity.relationships || []).filter((name) => entityByName.has(name)).map((name) => `  OBJ${index} -->|relationship cardinality unspecified| OBJ${entities.indexOf(entityByName.get(name))}`)).join("\n")}`, "Shows the object-instance relationships implied by the generated domain entities without fabricating sample customer or business data.", "Example JSON payloads could imply values or identifiers not supplied by the user."],
      ["Sequence Diagram", sequence, "Details an actual actor flow with its endpoint and responsible component rather than a generic request lifecycle.", "A communication diagram would de-emphasize message ordering and the selected use case."],
      ["Communication Diagram", `flowchart LR\n${useCases.flatMap((item, index) => [`  ACTOR${index}(["${safe(item.actor)}"])`, `  ACTOR${index} -->|"1. ${safe(item.goal)}"| API${index}`]).join("\n")}\n${endpoints.map((item, index) => `  API${index}["${safe(item.method)} ${safe(item.path)}"] -->|"${safe(componentById.get(item.component_id)?.name || "handler")}"| ${componentById.has(item.component_id) ? componentKey(componentById.get(item.component_id)) : `API${index}`}`).join("\n")}\n${componentEdges.join("\n")}`, "Emphasizes the actual named participants and their links for generated operations.", "Sequence notation makes message order clearer but obscures the structural collaboration network."],
      ["Activity Diagram", activity, "Expands the selected use-case main flow into ordered activity nodes with its generated outcome.", "Pseudocode would prematurely choose a programming language and error-handling behavior."],
      ["State Machine Diagram", stateDiagram, "Shows only lifecycle evidence present in generated fields and flags unmodeled transitions instead of fabricating them.", "A detailed state machine without explicit status policy could be mistaken for a business rule."],
      ["Component Diagram", baseFlow, "Provides an implementation-oriented view of generated component IDs, kinds, trace tags, and dependencies.", "A deployment diagram focuses on hosting units rather than logical code responsibilities."],
      ["Package Diagram", packageDiagram, "Groups this design's APIs, service capabilities, and domain entities into explicit logical packages.", "A source-folder diagram would invent implementation paths and package names."],
      ["Entity Relationship Diagram", schemaDiagram, "Uses generated fields and entity relationships while marking cardinality as unresolved.", "An object/class model includes methods that are irrelevant to relational persistence."],
      ["Database Schema Diagram", schemaDiagram, "Exposes the generated data attributes and relationships as a schema candidate, not a vendor migration.", "SQL DDL would overstate types, constraints, key strategy, and indexes not specified."],
      ["API Class/Interface Diagram", `classDiagram\n  class TargetAPI {\n${endpoints.map((item) => `    +${safe(item.method.toLowerCase())}_${safe(item.path).replace(/\W/g, "_")}()`).join("\n")}\n  }\n${components.map((item) => `  class ${componentKey(item)}["${safe(item.name)}"] {\n    <<${safe(item.kind)}>>\n  }\n  TargetAPI ..> ${componentKey(item)} : delegates to`).join("\n")}`, "Maps the concrete API contract surface to its generated owning component.", "A full framework-specific controller interface would invent language and framework choices."],
      ["Design Pattern Diagram", `flowchart LR\n${componentNodes}\n  PATTERN["${safe(architecture.style.replace(/_/g, " "))}: selected architecture style"]\n  DATA_PATTERN["Repository/persistence abstraction is a candidate only where data components exist"]\n${componentEdges.join("\n")}\n${components.length ? "  PATTERN --> C1" : ""}`, "Explains the selected architecture pattern and labels lower-level repository abstraction as a candidate rather than a committed implementation.", "A catalog of GoF patterns would add design patterns without evidence from the use cases."],
      ["Flowchart", activity, "Follows the selected requirement-derived use case from trigger to its generated postcondition.", "A dependency graph cannot show the action order visible to the actor."],
      ["Pseudocode/Algorithm Flow Diagram", `flowchart TD\n  START([Start ${safe(primaryUseCase?.name || "requested operation")}])\n  VALIDATE["Validate only stated input and eligibility rules"]\n  EXECUTE["Execute matched API operation: ${safe(primaryUseCase?.endpoint_refs?.[0] || primaryEndpoint?.path || "not specified")}"]\n  ${algorithmDataStep}\n  RESULT["Return outcome: ${safe(primaryUseCase?.postconditions?.[0] || "define acceptance outcome")}"]\n  OPEN["Unspecified validation, errors, retry and idempotency policies remain design questions"]\n  START --> VALIDATE --> EXECUTE --> ${algorithmIsWrite ? "PERSIST" : "READ"} --> RESULT\n  VALIDATE -.policy not specified.-> OPEN`, "Provides language-neutral algorithm stages grounded in the generated operation while exposing missing rules.", "Source-code pseudocode would falsely settle validation, retry, and error semantics not specified by the user."],
      ["Interaction Diagram", sequence, "Shows the selected user's messages through the API and target capability in their actual order.", "A static collaboration view omits ordering and response behavior."],
      ["State Transition Diagram", stateDiagram, "Marks lifecycle transitions as open where requirements provide no valid state set or transition rules.", "A fabricated transition table could be mistaken for approved business behavior."],
      ["CRC Diagram", `flowchart LR\n${components.map((item, index) => `  CLASS${index}["Class / responsibility: ${safe(item.name)} (${safe(item.kind)})"]`).join("\n")}\n${componentEdges.map((edge) => edge.replace(/C(\d+)/g, "CLASS$1")).join("\n")}\n${entities.map((item, index) => `  DATA${index}["Collaborator data: ${safe(item.name)}"]`).join("\n")}`, "Pairs generated capability responsibilities with their collaborating components and domain records.", "A class hierarchy diagram focuses on inheritance, which the requirements do not establish."],
      ["Dependency Diagram", `flowchart LR\n${componentNodes}\n${componentEdges.join("\n")}\n${entities.map((item) => `  ${entityKey(item)}[("${safe(item.name)}")]`).join("\n")}\n${components.filter((item) => ["data", "repository", "persistence"].includes(item.kind.toLowerCase())).flatMap((item) => entities.map((entity) => `  ${componentKey(item)} --> ${entityKey(entity)}`)).join("\n")}`, "Exposes only declared component edges and generated domain dependencies.", "A package-manager dependency tree would describe implementation libraries that the requirements have not chosen."],
      ["Interface Diagram", `classDiagram\n  class ITargetAPI {\n    <<interface>>\n${endpoints.map((item) => `    +${safe(item.method.toLowerCase())}_${safe(item.path).replace(/\W/g, "_")}()`).join("\n")}\n  }\n${components.map((item) => `  class ${componentKey(item)}["${safe(item.name)}"]\n  ITargetAPI --> ${componentKey(item)} : handled by`).join("\n")}`, "Shows externally visible operation signatures and the generated service that handles each one.", "A language-specific interface declaration would prematurely choose a programming language and type system."],
    ]],
  ];
  return menu.flatMap(([level, entries]) =>
    entries.map(([title, diagram, why, alternative]) => ({
      level,
      title,
      why,
      alternative,
      diagram: diagram.replace(/\n{3,}/g, "\n\n"),
    })),
  );
}

function buildSystemDesignMarkdown(result) {
  const sections = buildDesignViews(result);
  const useCases = result.use_cases?.length
    ? result.use_cases.flatMap((useCase, index) => [
        `### ${index + 1}. ${markdownLabel(useCase.name)}`,
        "",
        `**Actor:** ${markdownLabel(useCase.actor)}  `,
        `**Requirement IDs:** ${useCase.requirement_ids.join(", ")}  `,
        `**API operations:** ${useCase.endpoint_refs.map(markdownLabel).join(", ") || "Not specified"}`,
        "",
        ...useCase.main_flow.map((step) => `- ${markdownLabel(step)}`),
        "",
        `**Outcome:** ${useCase.postconditions.map(markdownLabel).join(" ")}`,
        "",
      ])
    : ["No functional use cases were extracted.", ""];
  const assumptions = result.design.assumptions?.length
    ? result.design.assumptions.map((assumption) => `- ${markdownLabel(assumption)}`)
    : ["- Confirm security, workload, data-retention, and deployment expectations before implementation."];
  return [
    `# System design for ${systemRequirements(result).length} requirements`,
    "",
    `**Architecture:** ${result.architecture.style.replace(/_/g, " ")}  `,
    `**Data store:** ${result.architecture.data_store}  `,
    `**Decision rationale:** ${result.architecture.justification}`,
    "",
    "## Architecture adjudication",
    "",
    result.architecture_debate?.decision_rationale || result.architecture.justification,
    "",
    `**Alternative considered:** ${markdownLabel(result.architecture_debate?.rejected_alternative || "Not recorded")}`,
    "",
    `**Challenger findings:** ${result.architecture_debate?.challenger_summary || "No separate challenge was recorded."}`,
    "",
    `**Advocate response:** ${markdownLabel(result.architecture_debate?.advocate_response || "No point-by-point response was recorded.")}`,
    "",
    `**Accepted objections:** ${(result.architecture_debate?.accepted_objections || []).map(markdownLabel).join("; ") || "None explicitly recorded."}`,
    "",
    `**Deferred objections / evidence needed:** ${(result.architecture_debate?.deferred_objections || []).map(markdownLabel).join("; ") || "No deferred objections recorded."}`,
    "",
    "## Deployment technology recommendations",
    "",
    ...(result.deployment?.technologies || []).flatMap((item) => [
      `- **${markdownLabel(item.role)} — ${markdownLabel(item.technology)} (${markdownLabel(item.status)}):** ${markdownLabel(item.rationale)}`,
    ]),
    ...(result.deployment?.assumptions || []).map((item) => `- Assumption: ${markdownLabel(item)}`),
    "",
    "## Use-case walkthroughs",
    "",
    ...useCases,
    "## Assumptions and open decisions",
    "",
    ...assumptions,
    "",
    "## Deterministic design evidence",
    "",
    `- Structural constraints: ${result.mamdo?.feasible ? "pass" : "not all pass"}`,
    `- Requirement traceability: ${result.critique.rule_checks.traceability_percent}%`,
    `- Structural consistency: ${result.critique.rule_checks.consistency_score}%`,
    `- Untraceable component rate: ${result.critique.rule_checks.over_engineering_rate}%`,
    `- Review note: ${markdownLabel(result.critique.summary)}`,
    "",
    ...sections.flatMap((section, index) => [
      ...(index === 0 || sections[index - 1].level !== section.level
        ? [`## ${section.level === "HLD" ? "High-Level System Design (HLD)" : "Low-Level System Design (LLD)"}`, ""]
        : []),
      `### ${section.title}`,
      "",
      "```mermaid",
      section.diagram,
      "```",
      "",
      `**Why this view:** ${section.why}`,
      "",
      `**Why not an alternative:** ${section.alternative}`,
      "",
    ]),
  ].join("\n");
}

function buildSrsMarkdown(result) {
  const requirements = systemRequirements(result);
  const functional = result.requirements.functional;
  const nonFunctional = result.requirements.non_functional;
  const sections = buildDesignViews(result);
  const architecture = result.architecture;
  const alternativeFromDebate =
    result.architecture_debate?.rejected_alternative?.replace(/_/g, " ");
  const normalizeStyle = (style) => style.toLowerCase().replace(/[\s_-]/g, "");
  const architectureAlternative =
    alternativeFromDebate &&
    normalizeStyle(alternativeFromDebate) !== normalizeStyle(architecture.style)
      ? alternativeFromDebate
      : architecture.style.toLowerCase().includes("micro")
        ? "modular monolith"
        : "microservices";
  const requirementText = requirements
    .map((requirement) => requirement.text)
    .join(" ")
    .toLowerCase();
  const selectedNoSql = architecture.data_store.toLowerCase().includes("no");
  const alternativeStore = selectedNoSql ? "relational" : "document-oriented / NoSQL";
  const dataStoreAlternativeRationale = selectedNoSql
    ? "A relational store was not selected because the generated decision treats the records as document/feed-oriented. Confirm transaction boundaries and cross-record consistency before implementation."
    : /order|booking|reservation|payment|audit|relationship/.test(requirementText)
      ? "A document-oriented store was not selected because the requirements imply related records or state changes that benefit from transactions and referential constraints."
      : "A document-oriented store was not selected because the requirements do not state a need for flexible nested documents, and no access-pattern evidence justifies its additional modeling trade-offs.";
  const architectureAlternativeRationale = architecture.style
    .toLowerCase()
    .includes("micro")
    ? "A modular monolith reduces deployment and coordination overhead; the selected design instead favors independent service boundaries."
    : /independent scaling|multi[- ]region|independent teams/.test(requirementText)
      ? "The requirements mention independent scaling, multiple regions, or team boundaries; review whether the selected modular boundary is sufficient."
      : "No independent service scaling, multi-region deployment, or independent team ownership is explicitly required, so the extra distributed-system overhead is not justified.";
  const table = (headers, rows) =>
    [
      `| ${headers.join(" | ")} |`,
      `| ${headers.map(() => "---").join(" | ")} |`,
      ...rows.map((row) => `| ${row.map(markdownLabel).join(" | ")} |`),
    ].join("\n");
  const requirementsTable = table(
    ["ID", "Type", "Requirement"],
    requirements.map((item) => [item.id, item.kind.replace("_", "-"), item.text]),
  );
  const componentsTable = table(
    ["Component", "Kind", "Satisfies"],
    result.design.components.map((component) => [
      component.name,
      component.kind,
      component.satisfies.join(", ") || "Not mapped",
    ]),
  );
  const endpointTable = table(
    ["Method", "Path", "Request", "Response", "Requirement IDs"],
    result.design.endpoints.map((endpoint) => [
      endpoint.method,
      endpoint.path,
      endpoint.request_entity || "—",
      endpoint.response_entity || "—",
      endpoint.satisfies.join(", "),
    ]),
  );
  const entitySections = result.design.entities.length
    ? result.design.entities
        .map(
          (entity) =>
            `### ${entity.name}\n\n${table(
              ["Field", "Type", "Required"],
              entity.fields.map((field) => [
                field.name,
                field.type,
                field.required ? "Yes" : "No",
              ]),
            )}\n\nRelationships: ${entity.relationships.join(", ") || "None declared"}`,
        )
        .join("\n\n")
    : "No data entities were generated.";
  const useCaseSections = result.use_cases?.length
    ? result.use_cases
        .map(
          (useCase, index) =>
            `### ${index + 1}. ${markdownLabel(useCase.name)}\n\n` +
            `**Primary actor:** ${markdownLabel(useCase.actor)}  \n` +
            `**Goal:** ${markdownLabel(useCase.goal)}  \n` +
            `**Requirement IDs:** ${useCase.requirement_ids.join(", ") || "Not mapped"}  \n` +
            `**API operations:** ${useCase.endpoint_refs.map(markdownLabel).join(", ") || "No concrete endpoint specified"}\n\n` +
            `**Preconditions / open decisions**\n\n${useCase.preconditions.map((item) => `- ${markdownLabel(item)}`).join("\n")}\n\n` +
            `**Main flow**\n\n${useCase.main_flow.map((item) => `- ${markdownLabel(item)}`).join("\n")}\n\n` +
            `**Postconditions**\n\n${useCase.postconditions.map((item) => `- ${markdownLabel(item)}`).join("\n")}`,
        )
        .join("\n\n")
    : "No functional use cases were extracted. Add explicit actor goals to the requirements.";
  const traceabilityTable = table(
    ["Requirement", "Components", "API operations", "Data entities"],
    requirements.map((requirement) => [
      `${requirement.id}: ${requirement.text}`,
      result.design.components
        .filter((component) => component.satisfies.includes(requirement.id))
        .map((component) => component.name)
        .join(", ") || "Not mapped",
      result.design.endpoints
        .filter((endpoint) => endpoint.satisfies.includes(requirement.id))
        .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
        .join(", ") || "No direct API contract",
      result.design.entities
        .filter((entity) => entity.satisfies.includes(requirement.id))
        .map((entity) => entity.name)
        .join(", ") || "No direct data entity",
    ]),
  );
  const assumptions = result.design.assumptions?.length
    ? result.design.assumptions.map((item) => `- ${markdownLabel(item)}`).join("\n")
    : "- No additional design assumptions were recorded.";
  const tradeoffs = result.architecture.trade_offs.length
    ? result.architecture.trade_offs.map((item) => `- ${item}`).join("\n")
    : "- No architecture trade-offs were returned.";
  const ambiguities = result.requirements.ambiguities.length
    ? result.requirements.ambiguities
        .map((item) => `- **${item.id}:** ${item.description}`)
        .join("\n")
    : "No ambiguities were identified.";
  const metrics = table(
    ["Check", "Result"],
    [
      ["Critic decision", result.critique.accepted ? "Accepted" : "Requires revision"],
      ["Requirement traceability", `${result.critique.rule_checks.traceability_percent}%`],
      ["Structural consistency", `${result.critique.rule_checks.consistency_score}%`],
      ["Untraceable component rate", `${result.critique.rule_checks.over_engineering_rate}%`],
    ],
  );
  const deploymentTable = table(
    ["Deployment concern", "Technology / decision", "Status", "Why this choice"],
    (result.deployment?.technologies || []).map((item) => [
      item.role,
      item.technology,
      item.status,
      item.rationale,
    ]),
  );

  return [
    `# Software Requirements Specification: ${requirements[0]?.text?.split(/\s+/).slice(0, 7).join(" ") || "Generated system"}`,
    "",
    `**Run:** ${result.run_id}  `,
    `**Architecture:** ${result.architecture.style.replace(/_/g, " ")}  `,
    `**Data store:** ${result.architecture.data_store}`,
    "",
    "## 1. Purpose and scope",
    "",
    "This run-specific SRS describes the system requested by the submitted requirements. Its components, interfaces, data entities, and diagrams are taken from this run's extracted requirements and generated design—not from the design workbench implementation.",
    "",
    "## 2. User requirements",
    "",
    requirementsTable,
    "",
    `Functional requirements: ${functional.length}. Non-functional requirements: ${nonFunctional.length}.`,
    "",
    "### Ambiguities to clarify",
    "",
    ambiguities,
    "",
    "## 3. Use cases",
    "",
    "The flows below are derived from the extracted functional requirements and generated API contracts. Preconditions and unspecified policies are called out rather than silently assumed.",
    "",
    useCaseSections,
    "",
    "## 4. Architecture decision",
    "",
    `**Selected:** ${result.architecture.style.replace(/_/g, " ")}`,
    "",
    result.architecture.justification,
    "",
    `**Data store:** ${result.architecture.data_store}. ${result.architecture.data_store_justification}`,
    "",
    "### Alternative considered",
    "",
    `**${architectureAlternative}:** ${architectureAlternativeRationale}`,
    "",
    `**Alternative data store not selected: ${alternativeStore}.** ${dataStoreAlternativeRationale}`,
    "",
    `**Adjudication:** ${result.architecture_debate?.decision_rationale || result.architecture.justification}`,
    "",
    `**Challenger findings:** ${result.architecture_debate?.challenger_summary || "No separate architecture challenge was returned for this run."}`,
    "",
    `**Advocate response:** ${result.architecture_debate?.advocate_response || "No point-by-point response was recorded."}`,
    "",
    `**Accepted objections:** ${(result.architecture_debate?.accepted_objections || []).join("; ") || "None explicitly recorded."}`,
    "",
    `**Deferred objections / evidence needed:** ${(result.architecture_debate?.deferred_objections || []).join("; ") || "No deferred objections recorded."}`,
    "",
    "### Trade-offs",
    "",
    tradeoffs,
    "",
    "### Design assumptions and unresolved decisions",
    "",
    assumptions,
    "",
    "## 5. Generated components",
    "",
    componentsTable,
    "",
    "## 6. API contracts",
    "",
    endpointTable,
    "",
    "## 7. Data model",
    "",
    entitySections,
    "",
    "## 8. Requirement traceability matrix",
    "",
    "Each row links source text to the generated component, endpoint, and entity mappings. A missing API or entity mapping is shown explicitly rather than treated as an automatic failure for requirements that do not imply those artifacts.",
    "",
    traceabilityTable,
    "",
    "## 9. Requirement-derived system diagrams",
    "",
    "The following Mermaid diagrams model the requested target system using only this run's requirements, architecture decision, component graph, API contracts, and data entities.",
    "",
    "The catalog below includes the requested HLD and LLD views. Each view is generated from this run's requirements, use cases, API contracts, components, entities, debate, and deployment recommendations. Unsupported details are marked as assumptions or open decisions, not silently invented.",
    "",
    "## Deployment technology recommendations",
    "",
    "These are candidate technologies for the target system, not technologies mandated by the requirement text. Confirm the cloud provider, runtime, region, security, and operations constraints before treating recommendations as implementation decisions.",
    "",
    deploymentTable,
    "",
    ...(result.deployment?.assumptions || []).map((item) => `- ${markdownLabel(item)}`),
    "",
    ...sections.flatMap((section, index) => [
      ...(index === 0 || sections[index - 1].level !== section.level
        ? [`## ${section.level === "HLD" ? "High-Level System Design (HLD)" : "Low-Level System Design (LLD)"}`, ""]
        : []),
      `### ${section.title}`,
      "",
      "```mermaid",
      section.diagram,
      "```",
      "",
      `**Why this view:** ${section.why}`,
      "",
      `**Why not an alternative:** ${section.alternative}`,
      "",
    ]),
    "## 10. Validation",
    "",
    metrics,
    "",
    result.critique.summary,
    "",
  ].join("\n");
}

function renderInlineMarkdown(text, keyPrefix) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${keyPrefix}-${index}`}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function MermaidDiagram({ source }) {
  const targetRef = useRef(null);
  const containerRef = useRef(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const [error, setError] = useState("");
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  useEffect(() => {
    if (!containerRef.current || !("IntersectionObserver" in window)) {
      setIsNearViewport(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!isNearViewport) return undefined;
    let active = true;
    setError("");
    if (!targetRef.current) return undefined;
    targetRef.current.replaceChildren();
    loadMermaid()
      .then((mermaid) => mermaid.render(`srs-mermaid-${id}`, source))
      .then(({ svg }) => {
        if (active && targetRef.current) targetRef.current.innerHTML = svg;
      })
      .catch((cause) => {
        if (active) setError(`Mermaid diagram could not be rendered: ${cause.message}`);
      });
    return () => {
      active = false;
    };
  }, [id, isNearViewport, source]);
  return (
    <div className="md-mermaid" ref={containerRef}>
      {error ? <p className="error">{error}</p> : <div ref={targetRef} />}
      <details>
        <summary>View Mermaid source</summary>
        <pre><code>{source}</code></pre>
      </details>
    </div>
  );
}

function MarkdownDocument({ markdown }) {
  const segments = markdown.split(/(```(?:mermaid)?\s*\n[\s\S]*?```)/g);
  let key = 0;
  return (
    <div className="rendered-markdown">
      {segments.map((segment) => {
        const blockKey = `md-${key++}`;
        const mermaidBlock = segment.match(/^```mermaid\s*\n([\s\S]*?)```$/);
        if (mermaidBlock) {
          return <MermaidDiagram key={blockKey} source={mermaidBlock[1].trim()} />;
        }
        if (segment.startsWith("```")) {
          return <pre key={blockKey}><code>{segment.replace(/^```[^\n]*\n|```$/g, "")}</code></pre>;
        }
        return segment
          .split(/\n\s*\n/)
          .filter((block) => block.trim())
          .map((block) => {
            const contentKey = `md-${key++}`;
            const lines = block.trim().split("\n");
            const heading = lines[0].match(/^(#{1,6})\s+(.+)$/);
            if (heading) {
              const Heading = `h${heading[1].length}`;
              return (
                <Heading key={`${contentKey}-heading`}>
                  {renderInlineMarkdown(heading[2], contentKey)}
                </Heading>
              );
            }
            if (lines.every((line) => /^\|.*\|$/.test(line.trim()))) {
              const rows = lines
                .map((line) => line.trim().slice(1, -1).split("|").map((cell) => cell.trim()))
                .filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
              const [header, ...body] = rows;
              return (
                <div className="md-table-scroll" key={`${contentKey}-table`}>
                  <table>
                    <thead><tr>{header.map((cell, index) => <th key={index}>{renderInlineMarkdown(cell, contentKey)}</th>)}</tr></thead>
                    <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index}>{renderInlineMarkdown(cell, contentKey)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              );
            }
            if (lines.every((line) => /^\s*-\s+/.test(line))) {
              return (
                <ul key={`${contentKey}-list`}>
                  {lines.map((line, index) => <li key={index}>{renderInlineMarkdown(line.replace(/^\s*-\s+/, ""), contentKey)}</li>)}
                </ul>
              );
            }
            return (
              <p key={`${contentKey}-paragraph`}>
                {renderInlineMarkdown(lines.join(" ").replace(/\s{2,}/g, " "), contentKey)}
              </p>
            );
          });
      })}
    </div>
  );
}

function actorLabel(result) {
  const requirement = result.requirements.functional[0]?.text || "";
  const match = requirement.match(
    /^(?:as\s+)?(?:an?\s+)?([^,.]+?)\s+(?:can|must|should|may|will|needs?\s+to|is\s+able\s+to)\b/i,
  );
  return match?.[1]?.trim() || "External actor";
}

function ComponentGraph({ result }) {
  const components = result?.design?.components || [];
  const edges = result?.design?.edges || [];
  if (!components.length)
    return <p className="muted">No components were generated for this design.</p>;
  return (
    <div className="diagram component-diagram">
      {components.map((component) => (
        <div className="component-node" key={component.id}>
          <b>{component.name}</b>
          <small>{component.kind} · {component.satisfies.join(", ") || "no mapped requirement"}</small>
        </div>
      ))}
      <div className="component-edges">
        {edges.map((edge) => (
          <span key={edge.source + edge.target}>
            {components.find((component) => component.id === edge.source)?.name || edge.source}
            {" —"}{edge.label}{"→ "}
            {components.find((component) => component.id === edge.target)?.name || edge.target}
          </span>
        ))}
        {!edges.length && <span>No component dependencies were specified.</span>}
      </div>
    </div>
  );
}

function Diagram({ type, result }) {
  const requirements = systemRequirements(result);
  const endpoints = result.design.endpoints;
  const entities = result.design.entities;
  const components = result.design.components;
  const getEndpointEntity = (endpoint) =>
    endpoint.response_entity || endpoint.request_entity;

  if (type === "requirements")
    return (
      <div className="generated-flow">
        {requirements.map((requirement) => {
          const relatedEndpoints = endpoints.filter((endpoint) =>
            endpoint.satisfies.includes(requirement.id),
          );
          const relatedComponents = components.filter((component) =>
            component.satisfies.includes(requirement.id),
          );
          return (
            <div className="generated-flow-row" key={requirement.id}>
              <div className="entity-node">
                <b>{requirement.id} · {requirement.kind.replace("_", "-")}</b>
                <span>{requirement.text}</span>
              </div>
              <span className="flow-arrow">maps to</span>
              <div className="generated-flow-targets">
                {relatedEndpoints.length
                  ? relatedEndpoints.map((endpoint) => (
                      <div className="entity-node" key={endpoint.method + endpoint.path}>
                        <b>{endpoint.method} {endpoint.path}</b>
                        <span>
                          {components.find((component) => component.id === endpoint.component_id)?.name || endpoint.component_id}
                        </span>
                      </div>
                    ))
                  : relatedComponents.map((component) => (
                      <div className="entity-node" key={component.id}>
                        <b>{component.name}</b>
                        <span>design component</span>
                      </div>
                    ))}
                {!relatedEndpoints.length && !relatedComponents.length && (
                  <div className="entity-node"><b>Not mapped</b><span>No generated design element is tagged to this requirement.</span></div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  if (type === "architecture")
    return (
      <div className="generated-architecture">
        <div className="entity-node">
          <b>EXTERNAL ACTOR</b>
          <span>{actorLabel(result)}</span>
        </div>
        {endpoints.map((endpoint) => (
          <div className="generated-architecture-row" key={endpoint.method + endpoint.path}>
            <span className="flow-arrow">uses</span>
            <div className="entity-node">
              <b>{endpoint.method} {endpoint.path}</b>
              <span>{endpoint.satisfies.join(", ")}</span>
            </div>
            <span className="flow-arrow">handled by</span>
            <div className="entity-node">
              <b>{components.find((component) => component.id === endpoint.component_id)?.name || endpoint.component_id}</b>
              <span>{components.find((component) => component.id === endpoint.component_id)?.kind || "component"}</span>
            </div>
            {getEndpointEntity(endpoint) && (
              <>
                <span className="flow-arrow">uses</span>
                <div className="entity-node">
                  <b>{getEndpointEntity(endpoint)}</b>
                  <span>{result.architecture.data_store} data</span>
                </div>
              </>
            )}
          </div>
        ))}
        <p className="diagram-note">
          Logical architecture: {result.architecture.style.replace(/_/g, " ")} · {result.architecture.data_store} data store.
          Components and contracts shown are from this generated design; hosting products were not specified.
        </p>
      </div>
    );
  if (type === "data")
    return (
      <div className="data-model-diagram">
        {entities.map((entity) => (
          <div className="entity" key={entity.name}>
            <strong>{entity.name}</strong>
            <small>
              {entity.relationships?.length
                ? `references ${entity.relationships.join(", ")}`
                : "no declared relationships"}
            </small>
            <div>
              {entity.fields.map((field) => (
                <span key={field.name}><code>{field.name}</code> {field.type}</span>
              ))}
            </div>
          </div>
        ))}
        {!entities.length && (
          <p className="muted">No persistent data entities were specified by this design.</p>
        )}
      </div>
    );
  if (type === "api-flow")
    return (
      <div className="generated-flow">
        {endpoints.map((endpoint) => {
          const entityName = getEndpointEntity(endpoint);
          const entity = entities.find((item) => item.name === entityName);
          const component = components.find((item) => item.id === endpoint.component_id);
          return (
            <div className="api-flow-row" key={endpoint.method + endpoint.path}>
              <div className="entity-node">
                <b>{endpoint.method} {endpoint.path}</b>
                <span>{endpoint.satisfies.join(", ")}</span>
              </div>
              <span className="flow-arrow">handled by</span>
              <div className="entity-node">
                <b>{component?.name || endpoint.component_id}</b>
                <span>{component?.kind || "component"}</span>
              </div>
              {entity && (
                <>
                  <span className="flow-arrow">reads / writes</span>
                  <div className="entity-node">
                    <b>{entity.name}</b>
                    <span>{entity.fields.map((field) => field.name).join(", ")}</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
        {!endpoints.length && <p className="muted">No API endpoints were generated.</p>}
      </div>
    );
  if (type === "deployment")
    return (
      <div className="logical-boundary">
        <div className="entity-node">
          <b>{result.architecture.style.replace(/_/g, " ").toUpperCase()} BOUNDARY</b>
          <span>{components.map((component) => component.name).join(" · ") || "No components generated"}</span>
        </div>
        <span className="flow-arrow">uses</span>
        <div className="entity-node">
          <b>{result.architecture.data_store.toUpperCase()} DATA STORE</b>
          <span>{entities.map((entity) => entity.name).join(" · ") || "No data entities generated"}</span>
        </div>
        <p className="diagram-note">
          This is a logical deployment boundary derived from the selected architecture. No cloud provider, region, or infrastructure product is assumed.
        </p>
      </div>
    );
  return <ComponentGraph result={result} />;
}

function DesignDiagrams({ result }) {
  const sections = buildDesignViews(result);
  return (
    <div className="design-grid srs-design-grid">
      {sections.map((item) => (
        <article key={`${item.level}-${item.title}`}>
          <p className="kicker">{item.level} / TARGET-SYSTEM VIEW</p>
          <h2>{item.title}</h2>
          <MermaidDiagram source={item.diagram} />
          <div className="diagram-explanation">
            <p>
              <b>Why this view</b>
              {item.why}
            </p>
            <p>
              <b>Why not the alternative</b>
              {item.alternative}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

function ArchitectureRationale({ result }) {
  const architecture = result.architecture;
  const requirementsText = [
    ...result.requirements.functional,
    ...result.requirements.non_functional,
  ]
    .map((requirement) => requirement.text)
    .join(" ")
    .toLowerCase();
  const usesMicroservices = architecture.style.toLowerCase().includes("micro");
  const alternativeFromDebate =
    result.architecture_debate?.rejected_alternative?.replace(/_/g, " ");
  const normalizeStyle = (style) => style.toLowerCase().replace(/[\s_-]/g, "");
  const alternative = alternativeFromDebate &&
    normalizeStyle(alternativeFromDebate) !== normalizeStyle(architecture.style)
      ? alternativeFromDebate
      : usesMicroservices
        ? "modular monolith"
        : "microservices";
  const hasIndependentBoundaryNeed =
    /independent scaling|multi[- ]region|independent teams/.test(requirementsText);
  const alternativeExplanation = usesMicroservices
    ? "A modular monolith would reduce deployment and coordination overhead, but the selected rationale favors independently deployable or scalable boundaries."
    : hasIndependentBoundaryNeed
      ? "The requirements mention independent scaling, multiple regions, or team boundaries; because the selected design remains a modular monolith, its independent-scaling limitation should be reviewed."
      : "The submitted requirements do not explicitly require independent service scaling, multi-region deployment, or independent team ownership. Introducing distributed services now would add operational and observability overhead without a stated need.";
  const selectedStore = architecture.data_store.replace(/_/g, " ");
  const alternativeStore =
    architecture.data_store.toLowerCase().includes("no")
      ? "relational"
      : "document-oriented / NoSQL";
  const dataStoreAlternativeRationale =
    architecture.data_store.toLowerCase().includes("no")
      ? "The selected store is intended for document/feed-shaped records. Confirm transaction boundaries and cross-record consistency before implementation."
      : /order|booking|reservation|payment|audit|relationship/.test(requirementsText)
        ? "The requirements imply related records or state changes that benefit from transactions and referential constraints; no flexible-document access pattern is stated."
        : "The requirements do not establish a need for flexible nested documents, so a document store would add modeling trade-offs without current evidence.";

  return (
    <div className="architecture-rationale">
      <h3>Why this approach over the alternatives?</h3>
      <div className="rationale-choice">
        <b>Selected: {architecture.style.replace(/_/g, " ")}</b>
        <p>{architecture.justification}</p>
      </div>
      <div className="rationale-choice">
        <b>Alternative not selected: {alternative}</b>
        <p>{alternativeExplanation}</p>
      </div>
      <div className="rationale-choice">
        <b>Data store: {selectedStore} rather than {alternativeStore}</b>
        <p>{architecture.data_store_justification} {dataStoreAlternativeRationale}</p>
      </div>
    </div>
  );
}

function DynamicSrsDocument({ result }) {
  const requirements = [
    ...result.requirements.functional,
    ...result.requirements.non_functional,
  ];
  const title =
    requirements[0]?.text?.split(" ").slice(0, 6).join(" ") ||
    "Generated Backend System";
  return (
    <section className="document-shell">
      <aside className="document-nav">
        <p className="kicker">GENERATED DOCUMENT</p>
        <h2>SRS v1.0</h2>
        {srsSections.slice(0, 8).map(([number, section]) => (
          <a href={"#srs-" + number} key={number}>
            <b>{number}</b>
            <span>{section}</span>
          </a>
        ))}
      </aside>
      <article className="srs-paper">
        <div className="paper-cover">
          <p className="kicker">
            RUN-SPECIFIC SOFTWARE REQUIREMENTS SPECIFICATION
          </p>
          <h1>{title}</h1>
          <h2>
            Requirements-to-design specification generated from the submitted
            requirements
          </h2>
          <div className="cover-meta">
            <span>Run {result.run_id.slice(0, 8)}</span>
            <span>{requirements.length} extracted requirements</span>
            <span>Architecture: {result.architecture.style}</span>
          </div>
        </div>
        <section id="srs-01">
          <p className="kicker">01 / PURPOSE</p>
          <h2>Document purpose</h2>
          <p>
            This SRS was generated from the requirements submitted in the
            current run. It defines the observable scope, quality constraints,
            architecture assumptions, interfaces, data structures, security
            considerations, and acceptance checks for the requested system.
          </p>
          <div className="callout">
            <b>Source requirement set</b>
            <span>{requirements.map((item) => item.text).join(" ")}</span>
          </div>
        </section>
        <section id="srs-02">
          <p className="kicker">02 / SCOPE</p>
          <h2>System scope</h2>
          <p>
            The generated scope is limited to the behaviors and constraints
            represented by the extracted requirements below. Items not supported
            by the input are treated as assumptions and must be reviewed before
            implementation.
          </p>
          <div className="scope-columns">
            <div>
              <h3>Included behavior</h3>
              <ul>
                {result.requirements.functional.map((item) => (
                  <li key={item.id}>
                    {item.id}: {item.text}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Quality constraints</h3>
              <ul>
                {result.requirements.non_functional.map((item) => (
                  <li key={item.id}>
                    {item.id}: {item.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
        <section id="srs-03">
          <p className="kicker">03 / REQUIREMENTS</p>
          <h2>Functional and non-functional requirements</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Statement</th>
                <th>Type</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {requirements.map((item) => (
                <tr key={item.id}>
                  <td className="id-cell">{item.id}</td>
                  <td>{item.text}</td>
                  <td>{item.kind.replace("_", "-")}</td>
                  <td>{Math.round(item.confidence * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.requirements.ambiguities.length > 0 && (
            <>
              <h3>Ambiguities requiring clarification</h3>
              {result.requirements.ambiguities.map((item) => (
                <div className="ambiguity" key={item.id}>
                  <b>{item.id}</b>
                  <span>{item.description}</span>
                </div>
              ))}
            </>
          )}
        </section>
        <section id="srs-04">
          <p className="kicker">04 / ARCHITECTURE</p>
          <h2>Architecture decision</h2>
          <div className="decision">
            <span>{result.architecture.style.replace("_", " ")}</span>
            <span>{result.architecture.data_store}</span>
          </div>
          <p>{result.architecture.justification}</p>
          <ArchitectureRationale result={result} />
          <h3>Trade-offs</h3>
          <ul className="tradeoffs">
            {result.architecture.trade_offs.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section id="srs-05">
          <p className="kicker">05 / DESIGN</p>
          <h2>Components, data, and interfaces</h2>
          <h3>Components</h3>
          <div className="stakeholder-grid">
            {result.design.components.map((item) => (
              <div key={item.id}>
                <b>{item.name}</b>
                <span>
                  {item.kind} · satisfies{" "}
                  {item.satisfies.join(", ") || "unmapped"}
                </span>
              </div>
            ))}
          </div>
          <h3>Data entities</h3>
          {result.design.entities.map((entity) => (
            <div className="entity" key={entity.name}>
              <strong>{entity.name}</strong>
              <small>{entity.satisfies.join(", ")}</small>
              <div>
                {entity.fields.map((field) => (
                  <span key={field.name}>
                    <code>{field.name}</code> {field.type}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <h3>API contract</h3>
          {result.design.endpoints.map((endpoint) => (
            <div className="endpoint" key={endpoint.method + endpoint.path}>
              <b>{endpoint.method}</b>
              <code>{endpoint.path}</code>
              <small>
                {endpoint.response_entity || "response"} · satisfies{" "}
                {endpoint.satisfies.join(", ")}
              </small>
            </div>
          ))}
        </section>
        <section id="srs-06">
          <p className="kicker">06 / SECURITY AND ACCEPTANCE</p>
          <h2>Security, verification, and acceptance</h2>
          <div className="security-grid">
            <div>
              <span>✓</span>Validate every structured artifact before downstream
              use.
            </div>
            <div>
              <span>✓</span>Keep provider credentials outside the generated
              document and source repository.
            </div>
            <div>
              <span>✓</span>Review all ambiguities before implementation.
            </div>
            <div>
              <span>✓</span>Require API entity references and component edges to
              be valid.
            </div>
          </div>
          <div className="checks">
            {result.critique.rule_checks.checks.map((check) => (
              <div key={check}>✓ {check}</div>
            ))}
          </div>
        </section>
        <section id="srs-07">
          <p className="kicker">07 / TRACEABILITY</p>
          <h2>Requirement traceability and review</h2>
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Interpretation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Requirement coverage</td>
                <td>{result.critique.rule_checks.traceability_percent}%</td>
                <td>Extracted requirements mapped to design artifacts.</td>
              </tr>
              <tr>
                <td>Consistency</td>
                <td>{result.critique.rule_checks.consistency_score}%</td>
                <td>Entity references, edges, and dependency DAG checks.</td>
              </tr>
              <tr>
                <td>Untraceable components</td>
                <td>{result.critique.rule_checks.over_engineering_rate}%</td>
                <td>Share of components without explicit requirement tags.</td>
              </tr>
            </tbody>
          </table>
          <div className="gap-box">
            <b>
              Critic decision:{" "}
              {result.critique.accepted ? "ACCEPTED" : "REQUIRES REVISION"}
            </b>
            <span>{result.critique.summary}</span>
          </div>
        </section>
        <section id="srs-08">
          <p className="kicker">08 / SYSTEM DESIGN DIAGRAMS</p>
          <h2>Architecture and design views</h2>
          <p>
            These diagrams use the same views as the System Design page. Each
            caption explains what the view communicates and why a different
            representation was not chosen.
          </p>
          <DesignDiagrams result={result} />
        </section>
      </article>
    </section>
  );
}

function SrsDocument({ result }) {
  if (result) {
    const markdown = buildSrsMarkdown(result);
    return (
      <section className="document-shell">
        <aside className="document-nav">
          <p className="kicker">LIVE MARKDOWN RENDER</p>
          <h2>SRS document</h2>
        </aside>
        <article className="srs-paper markdown-paper">
          <MarkdownDocument markdown={markdown} />
        </article>
      </section>
    );
  }
  return (
    <section className="document-shell">
      <article className="srs-paper document-empty">
        <p className="kicker">RUN-SPECIFIC DOCUMENTATION</p>
        <h1>Generate a design first.</h1>
        <p>
          The SRS is created from the requirements you submit. Enter
          requirements in Workbench, run the pipeline, then return here to
          inspect the generated specification.
        </p>
        <button
          onClick={() => document.querySelector(".view-nav button")?.click()}
        >
          Open workbench
        </button>
      </article>
    </section>
  );
}

function LegacySrsDocument() {
  return (
    <section className="document-shell">
      <aside className="document-nav">
        <p className="kicker">DOCUMENT INDEX</p>
        <h2>SRS v1.0</h2>
        {srsSections.map(([number, title]) => (
          <a href={"#srs-" + number} key={number}>
            <b>{number}</b>
            <span>{title}</span>
          </a>
        ))}
      </aside>
      <article className="srs-paper">
        <div className="paper-cover">
          <p className="kicker">
            SOFTWARE REQUIREMENTS SPECIFICATION / SEPTEMBER 2026
          </p>
          <h1>DesignForge</h1>
          <h2>AI-Driven Multi-Agent Requirements-to-Design Generation</h2>
          <div className="cover-meta">
            <span>Final-year B.Tech capstone</span>
            <span>Computer Engineering Cybersecurity Honors</span>
            <span>Version 1.0 Academic baseline</span>
          </div>
        </div>
        <section id="srs-01">
          <p className="kicker">01 / PURPOSE</p>
          <h2>Document purpose</h2>
          <p>
            This specification defines the functional, non-functional,
            interface, data, security, evaluation, and deployment requirements
            for DesignForge. The system accepts informal requirements for web
            application backends and produces a structured, traceable system
            design through multiple cooperating agents.
          </p>
          <div className="callout">
            <b>Product statement</b>
            <span>
              DesignForge is an AI-assisted architecture workbench. It makes
              early design decisions explicit, traceable, and mechanically
              reviewable; it does not replace a software architect.
            </span>
          </div>
        </section>
        <section id="srs-02">
          <p className="kicker">02 / BOUNDARY</p>
          <h2>Product scope</h2>
          <div className="scope-columns">
            <div>
              <h3>In scope</h3>
              <ul>
                <li>REST or GraphQL backend designs</li>
                <li>Monolith versus microservice decisions</li>
                <li>Relational versus NoSQL recommendations</li>
                <li>Components, entities, dependencies, and API contracts</li>
                <li>Ambiguity, traceability, critique, and revision</li>
              </ul>
            </div>
            <div>
              <h3>Out of scope</h3>
              <ul>
                <li>Target application frontend generation</li>
                <li>Automatic cloud deployment</li>
                <li>Production correctness guarantees</li>
                <li>Local large-model hosting</li>
                <li>Replacement for human architecture review</li>
              </ul>
            </div>
          </div>
        </section>
        <section id="srs-03">
          <p className="kicker">03 / VOCABULARY</p>
          <h2>Definitions and acronyms</h2>
          <table>
            <thead>
              <tr>
                <th>Term</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  "FR / NFR",
                  "Functional requirement / non-functional requirement.",
                ],
                [
                  "Traceability",
                  "A link from a requirement ID to a component, entity, or endpoint.",
                ],
                [
                  "DAG",
                  "Directed acyclic graph used to validate component dependencies.",
                ],
                [
                  "Run / revision",
                  "One complete execution / one design regeneration after critique.",
                ],
              ].map((row) => (
                <tr key={row[0]}>
                  <td>{row[0]}</td>
                  <td>{row[1]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section id="srs-04">
          <p className="kicker">04 / USERS</p>
          <h2>Stakeholders and user classes</h2>
          <div className="stakeholder-grid">
            {[
              "Student developer",
              "Project guide",
              "Viva panel",
              "Junior developer",
              "Software architect",
              "Evaluation researcher",
            ].map((item) => (
              <div key={item}>
                <b>{item}</b>
                <span>
                  Reviews, builds, or evaluates the architecture workbench.
                </span>
              </div>
            ))}
          </div>
        </section>
        <section id="srs-05">
          <p className="kicker">05 / CONSTRAINTS</p>
          <h2>Assumptions and constraints</h2>
          <ol>
            <li>No GPU or locally hosted large model is required.</li>
            <li>
              Hosted API access is optional in demo mode and configured through
              environment variables.
            </li>
            <li>Every agent output is validated JSON before downstream use.</li>
            <li>
              The backend design domain is intentionally limited to web
              application architectures.
            </li>
            <li>
              Evaluation uses the same test cases for baseline and pipeline
              comparison.
            </li>
          </ol>
        </section>
        <section id="srs-06">
          <p className="kicker">06 / CONTEXT</p>
          <h2>System context</h2>
          <Diagram type="architecture" />
        </section>
        <section id="srs-07">
          <p className="kicker">07 / REQUIREMENTS</p>
          <h2>Functional requirements</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Requirement</th>
                <th>Priority</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  "FR-001",
                  "Accept free-form requirements text",
                  "M",
                  "Implemented",
                ],
                [
                  "FR-010",
                  "Classify functional and non-functional statements",
                  "M",
                  "Prototype",
                ],
                [
                  "FR-012",
                  "Identify ambiguous statements with confidence",
                  "M",
                  "Prototype",
                ],
                [
                  "FR-020",
                  "Recommend monolith or microservices with trade-offs",
                  "M",
                  "Prototype",
                ],
                [
                  "FR-030",
                  "Produce structured component nodes and edges",
                  "M",
                  "Implemented",
                ],
                [
                  "FR-033",
                  "Tag components with requirement IDs",
                  "M",
                  "Implemented",
                ],
                [
                  "FR-043",
                  "Check API references against schema entities",
                  "M",
                  "Implemented",
                ],
                [
                  "FR-046",
                  "Loop back when high or critical issues remain",
                  "M",
                  "Implemented",
                ],
                ["FR-050", "Run an 812 case benchmark", "M", "8 cases"],
              ].map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) => (
                    <td className={index === 0 ? "id-cell" : ""} key={cell}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Non-functional requirements</h3>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Quality attribute</th>
                <th>Acceptance measure</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  "NFR-001",
                  "CPU-only operation",
                  "No local large model or GPU required",
                ],
                [
                  "NFR-003",
                  "Structured output",
                  "Pydantic validation before every downstream stage",
                ],
                [
                  "NFR-007",
                  "Secrets",
                  "Environment variables and ignored .env",
                ],
                [
                  "NFR-010",
                  "Maintainability",
                  "Separate agents, schemas, rules, API, and UI",
                ],
                [
                  "NFR-011",
                  "Explainability",
                  "Decisions include trade-offs and requirement links",
                ],
              ].map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) => (
                    <td className={index === 0 ? "id-cell" : ""} key={cell}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section id="srs-08">
          <p className="kicker">08 / WORKFLOWS</p>
          <h2>Use cases and agent workflow</h2>
          <Diagram type="workflow" />
          <div className="usecase">
            <b>UC-01 Generate a backend design</b>
            <span>
              Enter requirements analyse propose architecture design
              components/API critique with rules revise or accept inspect the
              report.
            </span>
          </div>
          <div className="usecase">
            <b>UC-02 Review ambiguity</b>
            <span>
              Submit vague language such as fast inspect ambiguity record refine
              acceptance criteria rerun.
            </span>
          </div>
        </section>
        <section id="srs-09">
          <p className="kicker">09 / DATA</p>
          <h2>Data and interface requirements</h2>
          <Diagram type="data" />
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Purpose</th>
                <th>Response</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="id-cell">GET /health</td>
                <td>Service and provider status</td>
                <td>status, provider_mode</td>
              </tr>
              <tr>
                <td className="id-cell">POST /generate</td>
                <td>Execute complete graph</td>
                <td>requirements, architecture, design, critique</td>
              </tr>
              <tr>
                <td className="id-cell">POST /stages/analyze</td>
                <td>Inspect extraction stage</td>
                <td>structured requirements</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section id="srs-10">
          <p className="kicker">10 / SECURITY</p>
          <h2>Security and privacy</h2>
          <div className="security-grid">
            {[
              "Secrets remain in environment variables",
              "Hosted requests require explicit provider configuration",
              "Input size and rate limits prevent abuse",
              "Malformed model output cannot bypass schema validation",
              "Logs must redact keys and sensitive requirements",
              "Future multi-user deployment requires auth and tenant isolation",
            ].map((item) => (
              <div key={item}>
                <span></span>
                {item}
              </div>
            ))}
          </div>
        </section>
        <section id="srs-11">
          <p className="kicker">11 / VERIFICATION</p>
          <h2>Verification and acceptance</h2>
          <div className="verification-grid">
            {[
              [
                "Unit tests",
                "Models, classification, formulas, DAG and cycle checks",
              ],
              [
                "Integration tests",
                "Graph, provider adapter, routes, and revision edge",
              ],
              [
                "Acceptance tests",
                "Clear, ambiguous, invalid-reference, and cyclic inputs",
              ],
              [
                "Evaluation",
                "Baseline versus pipeline on identical benchmark cases",
              ],
            ].map(([title, text]) => (
              <div key={title}>
                <b>{title}</b>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </section>
        <section id="srs-12">
          <p className="kicker">12 / TRACEABILITY</p>
          <h2>Requirement traceability matrix</h2>
          <table>
            <thead>
              <tr>
                <th>Objective</th>
                <th>SRS requirements</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Structured extraction</td>
                <td>FR-010 to FR-015</td>
                <td>Requirement JSON schema and analyst output</td>
              </tr>
              <tr>
                <td>Traceable design</td>
                <td>FR-030 to FR-036</td>
                <td>Component, entity, endpoint tags</td>
              </tr>
              <tr>
                <td>Automated verification</td>
                <td>FR-040 to FR-048</td>
                <td>Critique issues and rule checks</td>
              </tr>
              <tr>
                <td>Honest evaluation</td>
                <td>FR-050 to FR-056</td>
                <td>Benchmark runner and raw metrics</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section id="srs-13">
          <p className="kicker">13 / APPROVAL</p>
          <h2>Status, gaps, and approval</h2>
          <div className="gap-box">
            <b>Implemented now</b>
            <span>
              Graph shape, Pydantic models, deterministic demo pipeline, rule
              checks, API, responsive workbench, and this report view.
            </span>
            <b>Next hardening</b>
            <span>
              Hosted prompts for every agent, strict retries, persistence, SSE
              streaming, baseline implementation, LLM judge, and automated test
              suite.
            </span>
          </div>
          <div className="signature-grid">
            <span>Student signature</span>
            <span>Project guide</span>
            <span>Department reviewer</span>
          </div>
        </section>
      </article>
    </section>
  );
}

function ChangeRequestPage({
  result,
  changeText,
  setChangeText,
  onApply,
  loading,
  error,
}) {
  return (
    <section className="change-page">
      <div className="design-heading">
        <p className="kicker">ITERATIVE DESIGN / CHANGE REQUEST</p>
        <h1>Ask for a change.</h1>
        <p>
          Describe what should be different. DesignForge regenerates the
          requirements, architecture, contracts, critique, SRS, and diagrams
          together.
        </p>
      </div>
      {result ? (
        <div className="change-context">
          <b>Current run {result.run_id.slice(0, 8)}</b>
          <span>
            {result.requirements.functional.length +
              result.requirements.non_functional.length}{" "}
            requirements · {result.architecture.style} ·{" "}
            {result.critique.rule_checks.consistency_score}% consistency
          </span>
        </div>
      ) : (
        <div className="change-context">
          <b>No design run yet</b>
          <span>
            Generate a first design from Workbench before requesting a change.
          </span>
        </div>
      )}
      <div className="change-form">
        <label htmlFor="change-request">Requested modification</label>
        <textarea
          id="change-request"
          value={changeText}
          onChange={(event) => setChangeText(event.target.value)}
          placeholder="Example: Add authentication and role-based access for administrators."
        />
        <button
          onClick={onApply}
          disabled={loading || !result || changeText.trim().length < 10}
        >
          {loading ? "Regenerating design..." : "Apply change and regenerate"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
      <div className="change-examples">
        <h2>Useful change requests</h2>
        <button
          onClick={() =>
            setChangeText(
              "Add authentication and role-based access for administrators.",
            )
          }
        >
          Add authentication
        </button>
        <button
          onClick={() =>
            setChangeText(
              "The system must support audit logs for every update.",
            )
          }
        >
          Require audit logs
        </button>
        <button
          onClick={() =>
            setChangeText(
              "The system must support independent scaling for notifications.",
            )
          }
        >
          Scale notifications separately
        </button>
      </div>
    </section>
  );
}

function App() {
  const [text, setText] = useState(sample);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("workbench");
  const [changeText, setChangeText] = useState("");
  async function generate() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements_text: text }),
      });
      if (!response.ok) throw new Error(await response.text());
      setResult(await response.json());
      setView("workbench");
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }
  async function applyChange() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirements_text: text,
          change_request: changeText,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const updated = await response.json();
      setResult(updated);
      setText(`${text}\n${changeText}`);
      setChangeText("");
      setView("workbench");
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }
  const critique = result?.critique;
  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="mark">D</span>
          <span>DESIGNFORGE</span>
        </div>
        <span className="eyebrow">REQUIREMENTS SYSTEM DESIGN</span>
        <nav className="view-nav">
          <button
            className={view === "workbench" ? "nav-active" : ""}
            onClick={() => setView("workbench")}
          >
            Workbench
          </button>
          <button
            className={view === "design" ? "nav-active" : ""}
            onClick={() => setView("design")}
          >
            System design
          </button>
          <button
            className={view === "srs" ? "nav-active" : ""}
            onClick={() => setView("srs")}
          >
            SRS document
          </button>
          <button
            className={view === "change" ? "nav-active" : ""}
            onClick={() => setView("change")}
          >
            Request change
          </button>
        </nav>
        <span className="status">
          <i /> CPU-friendly demo mode
        </span>
      </header>
      {view === "change" ? (
        <ChangeRequestPage
          result={result}
          changeText={changeText}
          setChangeText={setChangeText}
          onApply={applyChange}
          loading={loading}
          error={error}
        />
      ) : view === "srs" ? (
        <SrsDocument result={result} />
      ) : view === "design" ? (
        <section className="design-book">
          <div className="design-heading">
            <p className="kicker">GENERATED TARGET SYSTEM / VISUAL DESIGN</p>
            <h1>{result ? "System design for these requirements" : "System design"}</h1>
            <p>
              {result
                ? `Run ${result.run_id.slice(0, 8)} · ${result.architecture.style.replace(/_/g, " ")} · ${systemRequirements(result).length} user requirements`
                : "Generate a design to see diagrams derived from your requirements."}
            </p>
          </div>
          {result ? (
            <article className="design-markdown-paper">
              <MarkdownDocument markdown={buildSystemDesignMarkdown(result)} />
            </article>
          ) : (
            <div className="markdown-empty">
              Generate a design to create target-system architecture, feature,
              API, and data diagrams from your requirements.
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="hero">
            <div>
              <p className="kicker">Multi-agent design lab / 01</p>
              <h1>
                Turn loose ideas
                <br />
                <em>into buildable systems.</em>
              </h1>
              <p className="lede">
                A requirements analyst, architect, API designer, and critic
                collaborate in an explicit revision loop. Every decision keeps a
                thread back to the source.
              </p>
            </div>
            <div className="hero-note">
              <span>RUN STATE</span>
              <strong>
                {loading ? "ORCHESTRATING" : result ? "COMPLETE" : "READY"}
              </strong>
              <small>LangGraph controller hosted-ready</small>
            </div>
          </section>
          <section className="workspace">
            <div className="input-panel">
              <div className="section-head">
                <span className="index">01</span>
                <div>
                  <h2>Raw requirements</h2>
                  <p>Write naturally. The analyst will surface ambiguity.</p>
                </div>
              </div>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <button onClick={generate} disabled={loading || text.length < 20}>
                {loading ? "Running agents..." : "Generate system design "}
              </button>
              {error && <p className="error">{error}</p>}
            </div>
            <div className="pipeline">
              <div className="section-head">
                <span className="index">02</span>
                <div>
                  <h2>Agent pipeline</h2>
                  <p>MDF-style discipline coordination and one inspectable state.</p>
                </div>
              </div>
              <div className="agents">
                {agents.map(([number, title, detail], index) => (
                  <div
                    className={"agent " + (result || loading ? "active" : "")}
                    key={number}
                  >
                    <span>{number}</span>
                    <div>
                      <strong>{title}</strong>
                      <small>{detail}</small>
                    </div>
                    <b>{result ? "" : loading && index === 0 ? "" : ""}</b>
                  </div>
                ))}
              </div>
            </div>
          </section>
          {result && (
            <section className="results">
              <div className="results-header">
                <div>
                  <p className="kicker">Run {result.run_id.slice(0, 8)}</p>
                  <h2>Design review</h2>
                  <p className="result-subtitle">
                    A structured architecture package generated from your source
                    requirements.
                  </p>
                </div>
                <div className="score">
                  <strong>{critique.rule_checks.consistency_score}%</strong>
                  <span>consistency</span>
                </div>
                <div className="score">
                  <strong>{critique.rule_checks.traceability_percent}%</strong>
                  <span>traceability</span>
                </div>
                <div className="score">
                  <strong>{critique.rule_checks.over_engineering_rate}%</strong>
                  <span>untraceable components</span>
                </div>
              </div>
              <div className="result-grid">
                <article>
                  <h3>Requirement analysis</h3>
                  <p className="muted">
                    The analyst extracted these records before architecture
                    selection.
                  </p>
                  <div className="requirement-list">
                    {result.requirements.functional.map((requirement) => (
                      <div className="requirement" key={requirement.id}>
                        <b>{requirement.id}</b>
                        <span>{requirement.text}</span>
                        <small>
                          FUNCTIONAL {Math.round(requirement.confidence * 100)}%
                          confidence
                        </small>
                      </div>
                    ))}
                    {result.requirements.non_functional.map((requirement) => (
                      <div className="requirement nfr" key={requirement.id}>
                        <b>{requirement.id}</b>
                        <span>{requirement.text}</span>
                        <small>
                          NON-FUNCTIONAL{" "}
                          {Math.round(requirement.confidence * 100)}% confidence
                        </small>
                      </div>
                    ))}
                  </div>
                  {result.requirements.ambiguities.length > 0 && (
                    <>
                      <h3>Ambiguities to resolve</h3>
                      {result.requirements.ambiguities.map((ambiguity) => (
                        <div className="ambiguity" key={ambiguity.id}>
                          <b>{ambiguity.id}</b>
                          <span>{ambiguity.description}</span>
                        </div>
                      ))}
                    </>
                  )}
                </article>
                <article>
                  <h3>Architecture decision</h3>
                  <div className="decision">
                    <span>{result.architecture.style.replace("_", " ")}</span>
                    <span>{result.architecture.data_store}</span>
                  </div>
                  <p>{result.architecture.justification}</p>
                  <h3>Trade-offs recorded</h3>
                  <ul className="tradeoffs">
                    {result.architecture.trade_offs.map((tradeoff) => (
                      <li key={tradeoff}>{tradeoff}</li>
                    ))}
                  </ul>
                  <h3>Agent debate</h3>
                  <div className="debate-log">
                    <div><b>ADVOCATE</b><span>{result.architecture_debate?.advocate_summary || "Baseline proposal"}</span></div>
                    <div><b>CHALLENGER</b><span>{result.architecture_debate?.challenger_summary || "No challenge recorded"}</span></div>
                    <div><b>ADVOCATE RESPONSE</b><span>{result.architecture_debate?.advocate_response || "No point-by-point response recorded"}</span></div>
                    <div><b>ACCEPTED OBJECTIONS</b><span>{(result.architecture_debate?.accepted_objections || []).join("; ") || "None explicitly recorded"}</span></div>
                    <div><b>DEFERRED / EVIDENCE NEEDED</b><span>{(result.architecture_debate?.deferred_objections || []).join("; ") || "No deferred objections recorded"}</span></div>
                    <div><b>ADJUDICATOR</b><span>{result.architecture_debate?.decision_rationale || result.architecture.justification}</span></div>
                  </div>
                  <h3>Deployment technology recommendations</h3>
                  <div className="checks">
                    {(result.deployment?.technologies || []).map((technology, index) => (
                      <div key={`${technology.role}-${index}`}>
                        <b>{technology.role}:</b> {technology.technology} ({technology.status}) — {technology.rationale}
                      </div>
                    ))}
                    {(result.deployment?.assumptions || []).map((assumption, index) => (
                      <div key={`deployment-assumption-${index}`}>Open deployment assumption: {assumption}</div>
                    ))}
                  </div>
                  {result.mamdo && (
                    <>
                      <h3>MAMDO system synthesis</h3>
                      <p className={result.mamdo.feasible ? "pass" : "warn"}>
                        {result.mamdo.feasible
                          ? `Structural constraints pass after ${result.mamdo.design_iterations} design pass(es).`
                          : `Structural constraints remain unmet after ${result.mamdo.design_iterations} design pass(es).`}
                      </p>
                      <p className="muted">
                        Structural feasibility is not production-readiness proof. Review the open assumptions,
                        acceptance thresholds, security policies, and deployment workload below.
                      </p>
                      <div className="debate-log">
                        {result.mamdo.disciplines.map((discipline) => (
                          <div key={discipline.discipline}>
                            <b>{discipline.discipline.toUpperCase()}</b>
                            <span>{discipline.recommendation}</span>
                          </div>
                        ))}
                      </div>
                      <h3>Measured objectives</h3>
                      <div className="checks">
                        {result.mamdo.objectives.map((objective) => (
                          <div key={objective.name}>
                            {objective.direction} {objective.name}: {objective.value}
                            {objective.name === "Requirement traceability" ||
                            objective.name === "Structural consistency" ||
                            objective.name === "Untraceable component rate"
                              ? "%"
                              : ""}
                            {" — "}
                            {objective.evidence}
                          </div>
                        ))}
                      </div>
                      <h3>Feasibility constraints</h3>
                      <div className="checks">
                        {result.mamdo.constraints.map((constraint) => (
                          <div key={constraint.name}>
                            {constraint.satisfied ? "✓" : "✗"} {constraint.name}: {constraint.evidence}
                          </div>
                        ))}
                      </div>
                      <h3>Selected design variables</h3>
                      <div className="checks">
                        {Object.entries(result.mamdo.design_variables).map(([name, value]) => (
                          <div key={name}>{name.replaceAll("_", " ")}: {value}</div>
                        ))}
                      </div>
                      <h3>Coupled interfaces</h3>
                      <div className="checks">
                        {Object.entries(result.mamdo.coupling_variables).map(([name, value]) => (
                          <div key={name}>{name.replaceAll("_", " ")}: {value || "none"}</div>
                        ))}
                      </div>
                    </>
                  )}
                </article>
              </div>
              <div className="detail-grid">
                <article>
                  <h3>Use-case walkthroughs</h3>
                  {(result.use_cases || []).map((useCase) => (
                    <section className="use-case" key={useCase.name + useCase.requirement_ids.join("-")}>
                      <h4>{useCase.name}</h4>
                      <p><b>Actor:</b> {useCase.actor}</p>
                      <p><b>Goal:</b> {useCase.goal}</p>
                      <p><b>Requirements:</b> {useCase.requirement_ids.join(", ") || "Not mapped"}</p>
                      <p><b>API:</b> {useCase.endpoint_refs.join(", ") || "No explicit endpoint"}</p>
                      <ol>
                        {useCase.main_flow.map((step, index) => <li key={`${useCase.name}-${index}`}>{step}</li>)}
                      </ol>
                      <p><b>Outcome:</b> {useCase.postconditions.join(" ")}</p>
                    </section>
                  ))}
                  {!(result.use_cases || []).length && (
                    <p className="muted">No functional actor-goal flow was extracted. Add explicit user actions to the requirements.</p>
                  )}
                </article>
                <article>
                  <h3>Open decisions and assumptions</h3>
                  {result.requirements.ambiguities.map((ambiguity) => (
                    <div className="ambiguity" key={ambiguity.id}>
                      <b>{ambiguity.id}</b>
                      <span>{ambiguity.description}</span>
                    </div>
                  ))}
                  {(result.design.assumptions || []).map((assumption) => (
                    <div className="ambiguity" key={assumption}>
                      <b>ASSUMPTION</b>
                      <span>{assumption}</span>
                    </div>
                  ))}
                  {!result.requirements.ambiguities.length && !(result.design.assumptions || []).length && (
                    <p className="muted">No additional assumptions were recorded; still confirm security, workload, and deployment expectations.</p>
                  )}
                </article>
              </div>
              <div className="detail-grid">
                <article>
                  <h3>Component graph</h3>
                  <ComponentGraph result={result} />
                </article>
                <article>
                  <h3>Data model</h3>
                  {result.design.entities.map((entity) => (
                    <div className="entity" key={entity.name}>
                      <strong>{entity.name}</strong>
                      <small>{entity.satisfies.join(", ")}</small>
                      <div>
                        {entity.fields.map((field) => (
                          <span key={field.name}>
                            <code>{field.name}</code> {field.type}
                            {field.required ? " *" : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </article>
              </div>
              <div className="detail-grid">
                <article>
                  <h3>
                    Critic report{" "}
                    <span className={critique.accepted ? "pass" : "warn"}>
                      {critique.accepted ? "ACCEPTED" : "REVISE"}
                    </span>
                  </h3>
                  <p>{critique.summary}</p>
                  <div className="checks">
                    {critique.rule_checks.checks.map((check) => (
                      <div key={check}> {check}</div>
                    ))}
                  </div>
                  {critique.issues.map((issue) => (
                    <div className="issue" key={issue.message}>
                      <b>{issue.severity}</b>
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </article>
                <article>
                  <h3>REST contract and traceability</h3>
                  {result.design.endpoints.map((endpoint) => (
                    <div
                      className="endpoint"
                      key={endpoint.method + endpoint.path}
                    >
                      <b>{endpoint.method}</b>
                      <code>{endpoint.path}</code>
                      <small>
                        {endpoint.response_entity || "response"} satisfies{" "}
                        {endpoint.satisfies.join(", ")}
                      </small>
                    </div>
                  ))}
                  <div className="trace-note">
                    Every component and endpoint above is tagged with the
                    requirement IDs it satisfies. The scores are calculated from
                    those tags and deterministic structural checks.
                  </div>
                </article>
              </div>
            </section>
          )}
          <footer>
            <span>DESIGNFORGE / CAPSTONE PROTOTYPE</span>
            <span>Deterministic checks are objective; AI critique is advisory.</span>
          </footer>
        </>
      )}
    </main>
  );
}
const root =
  globalThis.__designforgeRoot ?? createRoot(document.getElementById("root"));
globalThis.__designforgeRoot = root;
root.render(<App />);
