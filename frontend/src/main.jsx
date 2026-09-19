import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import mermaid from "mermaid";
import "./styles.css";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8003";

const sample =
  "Customers can browse products and place orders. Orders must be auditable. The system should respond fast.";
const agents = [
  ["01", "Requirement analyst", "Extract FR/NFR + ambiguity"],
  ["02", "Architecture proposer", "Choose style + data store"],
  ["03", "Component/API designer", "Create traceable contracts"],
  ["04", "Critic / rule engine", "Cross-check the design"],
  ["05", "Revision controller", "Loop until accepted"],
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

mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  themeVariables: {
    primaryColor: "#dfe5a5",
    primaryTextColor: "#17211d",
    lineColor: "#84902d",
    secondaryColor: "#e5e5da",
    tertiaryColor: "#f2f0e9",
  },
});

function MarkdownDiagram({ markdown }) {
  const previewRef = useRef(null);
  useEffect(() => {
    if (!markdown || !previewRef.current) return;
    const preview = previewRef.current;
    const blocks = [...markdown.matchAll(/```mermaid\s*([\s\S]*?)```/g)];
    preview.replaceChildren();
    blocks.forEach(async (block, index) => {
      const container = document.createElement("div");
      container.className = "mermaid-preview";
      const { svg } = await mermaid.render(
        `designforge-diagram-${Date.now()}-${index}`,
        block[1].trim(),
      );
      container.innerHTML = svg;
      if (preview.isConnected) preview.appendChild(container);
    });
  }, [markdown]);
  if (!markdown)
    return (
      <div className="markdown-empty">
        Generate a design to receive the LLM-authored Markdown diagram package.
      </div>
    );
  return (
    <div className="markdown-artifact">
      <div className="markdown-preview" ref={previewRef} />
      <details>
        <summary>View generated Markdown source</summary>
        <pre>{markdown}</pre>
      </details>
    </div>
  );
}

function Diagram({ type, result }) {
  if (type === "workflow")
    return (
      <div className="diagram workflow-diagram">
        {agents.map(([number, title], index) => (
          <React.Fragment key={number}>
            <div className="diagram-node">
              <b>{number}</b>
              <span>{title}</span>
              <small>
                {index === 3 ? "rules + LLM review" : "structured JSON"}
              </small>
            </div>
            {index < agents.length - 1 && (
              <span className="diagram-arrow"></span>
            )}
          </React.Fragment>
        ))}
        <div className="loop-label">
          critique severity above threshold design
        </div>
      </div>
    );
  if (type === "architecture")
    return (
      <div className="diagram architecture-diagram">
        <div className="diagram-layer">
          <div className="diagram-node">
            <b>USER</b>
            <span>React workbench</span>
            <small>input + review</small>
          </div>
        </div>
        <div className="diagram-connector"></div>
        <div className="diagram-layer">
          <div className="diagram-node">
            <b>API</b>
            <span>FastAPI service</span>
            <small>validation + routes</small>
          </div>
          <div className="diagram-node">
            <b>CTRL</b>
            <span>LangGraph</span>
            <small>state + routing</small>
          </div>
          <div className="diagram-node">
            <b>RULES</b>
            <span>Rule evaluator</span>
            <small>local CPU checks</small>
          </div>
        </div>
        <div className="diagram-connector"></div>
        <div className="diagram-layer">
          <div className="diagram-node">
            <b>LLM</b>
            <span>Hosted provider</span>
            <small>Gemini / Groq</small>
          </div>
          <div className="diagram-node">
            <b>DATA</b>
            <span>SQLite / Postgres</span>
            <small>run history</small>
          </div>
        </div>
      </div>
    );
  if (type === "data")
    return (
      <div className="diagram data-diagram">
        <div className="entity-node">
          <b>REQUIREMENTS</b>
          <span>FR / NFR / ambiguity</span>
        </div>
        <span className="diagram-arrow"></span>
        <div className="entity-node">
          <b>ARCHITECTURE</b>
          <span>style / store / decisions</span>
        </div>
        <span className="diagram-arrow"></span>
        <div className="entity-row">
          <div className="entity-node">
            <b>COMPONENTS</b>
            <span>nodes + edges</span>
          </div>
          <div className="entity-node">
            <b>ENTITIES</b>
            <span>fields + relations</span>
          </div>
          <div className="entity-node">
            <b>ENDPOINTS</b>
            <span>REST contracts</span>
          </div>
        </div>
        <span className="diagram-arrow"></span>
        <div className="entity-node">
          <b>CRITIQUE</b>
          <span>issues + metrics + acceptance</span>
        </div>
      </div>
    );
  if (type === "deployment")
    return (
      <div className="diagram deployment-diagram">
        <div className="deployment-box">
          <b>DEVELOPER MACHINE</b>
          <span>React + FastAPI + LangGraph</span>
          <small>CPU-only local execution</small>
        </div>
        <span className="diagram-arrow"></span>
        <div className="deployment-box hosted">
          <b>HOSTED API</b>
          <span>Gemini / Groq</span>
          <small>optional external reasoning</small>
        </div>
        <span className="diagram-arrow"></span>
        <div className="deployment-box">
          <b>PERSISTENCE</b>
          <span>SQLite / PostgreSQL</span>
          <small>runs + evaluation evidence</small>
        </div>
      </div>
    );
  const components = result?.design?.components || [
    { id: "api", name: "REST API", kind: "interface", satisfies: [] },
    {
      id: "application",
      name: "Application Service",
      kind: "service",
      satisfies: [],
    },
    { id: "persistence", name: "Repository", kind: "data", satisfies: [] },
  ];
  const edges = result?.design?.edges || [
    { source: "api", target: "application", label: "invokes" },
    { source: "application", target: "persistence", label: "reads/writes" },
  ];
  return (
    <div className="diagram component-diagram">
      {components.map((component) => (
        <div className="component-node" key={component.id}>
          <b>{component.name}</b>
          <small>
            {component.kind} {component.satisfies?.join(", ") || "FR/NFR tags"}
          </small>
        </div>
      ))}
      <div className="component-edges">
        {edges.map((edge) => (
          <span key={edge.source + edge.target}>
            {edge.source} {edge.target} {edge.label}
          </span>
        ))}
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
            considerations, and acceptance checks for the requested backend
            system.
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
                <td>Over-engineering</td>
                <td>{result.critique.rule_checks.over_engineering_rate}%</td>
                <td>Components without explicit requirement tags.</td>
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
          <p className="kicker">08 / GENERATED ARTIFACT</p>
          <h2>Diagram Markdown generated for this run</h2>
          <MarkdownDiagram markdown={result.diagram_markdown} />
        </section>
      </article>
    </section>
  );
}

function SrsDocument({ result }) {
  if (result) return <DynamicSrsDocument result={result} />;
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
          <MarkdownDiagram markdown={result?.diagram_markdown} />
          <div className="design-heading">
            <p className="kicker">SYSTEM DESIGN REPORT / VISUAL INDEX</p>
            <h1>How DesignForge works</h1>
            <p>
              Five agents, explicit state, deterministic checks, and a bounded
              revision loop.
            </p>
          </div>
          <div className="design-grid">
            <article className="wide-panel">
              <h2>Complete agent workflow</h2>
              <p>
                LangGraph controls the order of work and decides whether the
                design must return to the designer.
              </p>
              <Diagram type="workflow" />
            </article>
            <article>
              <h2>System architecture</h2>
              <Diagram type="architecture" />
            </article>
            <article>
              <h2>Data lineage</h2>
              <Diagram type="data" />
            </article>
            <article className="wide-panel">
              <h2>Generated component graph</h2>
              <MarkdownDiagram markdown={result?.diagram_markdown} />
            </article>
            <article>
              <h2>Deployment boundary</h2>
              <Diagram type="deployment" />
            </article>
            <article>
              <h2>Evaluation loop</h2>
              <div className="metric-flow">
                <b>raw requirements</b>
                <span></span>
                <b>baseline + pipeline</b>
                <span></span>
                <b>same rule evaluator</b>
                <span></span>
                <b>raw table</b>
              </div>
            </article>
          </div>
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
                  <p>Five controlled steps, one inspectable state.</p>
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
                  <span>over-engineering</span>
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
                    <div><b>ADJUDICATOR</b><span>{result.architecture_debate?.decision_rationale || result.architecture.justification}</span></div>
                  </div>
                </article>
              </div>
              <div className="detail-grid">
                <article>
                  <h3>Component graph</h3>
                  <MarkdownDiagram markdown={result?.diagram_markdown} />
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
            <span>Rules are deterministic LLM judge remains secondary</span>
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
