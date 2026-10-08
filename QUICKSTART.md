# DesignForge – Quick Start & Testing Guide

## ✅ System Status: FULLY OPERATIONAL

All components running and validated. The multi-agent design synthesis system is working end-to-end.

---

## Quick Start (5 minutes)

### 1. Start Backend
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8003 --reload
```

**Verify:** 
```bash
curl http://127.0.0.1:8003/health
# Expected: {"status":"ok","provider_mode":"demo"}
```

### 2. Start Frontend
```bash
cd frontend
npm install
npm run dev
```

**Access:** http://127.0.0.1:5173

---

## Testing the System (End-to-End)

### Test Case 1: Product Browsing & Orders (Pre-loaded)

1. Open http://127.0.0.1:5173
2. Sample requirement is pre-filled: *"Customers can browse products and place orders. Orders must be auditable. The system should respond fast."*
3. Click **"Generate system design"** button
4. Watch UI state change: `READY` → `ORCHESTRATING` → `COMPLETE`

**Expected Output:**
- ✅ Requirements extracted (FR-1, FR-2, NFR-1, NFR-2)
- ✅ Entities generated (Item, AuditLog)
- ✅ Endpoints created (GET/POST /items)
- ✅ Traceability: 100% (4/4 requirements mapped)
- ✅ Design passes rule checks
- ✅ Critic report: FEASIBLE

### Test Case 2: Custom Requirements

1. Clear the requirement field
2. Enter your own requirement, e.g.:
   ```
   Users can search for items. Each search is logged for analytics. Response time must be under 200ms.
   ```
3. Click **"Generate system design"**
4. Review the generated architecture

### Test Case 3: Multi-Tab Navigation

After generating a design:

- **Workbench Tab** – Review requirements, architecture, components, critique
- **System Design Tab** – View Mermaid diagrams (architecture, components, data lineage)
- **SRS Document Tab** – Read generated requirements specification
- **Request Change Tab** – (Advanced) Submit design change requests

---

## Understanding the Output

### Workbench Tab

**Section 1: Raw Requirements**
- Lists all functional (FR) and non-functional (NFR) requirements extracted
- Shows ambiguities that need clarification

**Section 2: Agent Pipeline**
- Visual representation of the 6-agent workflow
- Shows how requirements flow through the system

**Section 3: Ambiguities to Resolve**
- Lists any unclear terms or edge cases
- These are noted but do not block design generation

**Section 4: Architecture Proposal**
- Generated architecture style (e.g., "Modular monolith")
- Justification for the choice
- Design rationale

**Section 5: Agent Debate**
- Advocate perspective: Why this architecture works
- Challenger perspective: Potential concerns
- Adjudicator resolution: Optimizer's decision

**Section 6: Measured Objectives**
- Requirement traceability %
- Structural consistency score
- Untraceable component rate

**Section 7: Feasibility Constraints**
- ✅/❌ All requirements are traceable
- ✅/❌ Component edges are valid
- ✅/❌ API references are valid
- ✅/❌ Dependency graph is acyclic

**Section 8: Component Graph**
- Visual diagram showing system components and their relationships
- Shows data flow directions (invokes, reads/writes)

**Section 9: Data Model**
- Entities generated (e.g., Item, AuditLog)
- Fields per entity
- Requirement tags each entity satisfies

**Section 10: REST Contract & Traceability**
- API endpoints (GET, POST, PUT, DELETE, etc.)
- Which requirement each endpoint satisfies
- Request/response entity schemas

**Section 11: Critic Report**
- Design feasibility assessment
- Number of issues found (ideally 0)
- Acceptance status

---

## Architecture Overview

### MDF Pattern (Multidisciplinary Design)

The system applies **parallel discipline analysis** to software architecture:

```
Requirements
    ↓
[Analyst] – Extract FR/NFR
    ↓
[Parallel Disciplines]
├─ Application Discipline
├─ Data Discipline
├─ Security Discipline
└─ Operations Discipline
    ↓
[Advocate vs Challenger] – Debate architecture styles
    ↓
[MDF System-Level Optimizer] – Reconcile coupled decisions
    ↓
[Component Designer] – Create traceable contracts
    ↓
[Deterministic Rule Evaluator] – Check for cycles, references, traceability
    ↓
[Critic] – Accept or revise
    ↓
MAMDO Report (Multidisciplinary Aggregated Design Output)
```

### Design Validation Rules

**Traceability:** Every requirement must appear on a component or endpoint.
- Example: If you write "Orders must be auditable," an AuditLog entity must exist, and an endpoint must tag it with that requirement.

**Entity Validity:** Endpoints' request/response entities must exist in the design.
- Example: If an endpoint says `POST /items[Item]`, the Item entity must be defined.

**Edge Validity:** Component dependencies must reference known components.
- Example: If Application Service depends on Repository, both must exist.

**Acyclicity:** No circular dependencies.
- Example: Component A cannot depend on B which depends on A.

**Meaningful Design:** Components must be justified by requirements, not generic filler.
- Example: "REST API component required by all FRs" ✅ vs. "Generic API layer" ❌

---

## Customization & Extension

### Change Ports

Edit `backend/app/main.py` and `frontend/vite.config.js` to use different ports.

### Use Hosted LLM (Gemini API)

Set environment variable before starting backend:
```bash
export LLM_PROVIDER=gemini
export GEMINI_API_KEY=your_api_key_here
```

Backend will query Gemini API instead of using deterministic fallback.

### Run Tests

```bash
cd backend
pytest tests/test_mamdo.py -v
```

All tests should pass. The tests validate:
- Cycle detection (rejects circular dependencies)
- Reference validation (rejects unknown entities)
- Feasible output (design passes rule checks)

---

## Troubleshooting

### Port Already in Use
If `8003` or `5173` are occupied:
- Change `--port 8003` in backend command
- Change `port: 5173` in `frontend/vite.config.js`
- Update `VITE_API_URL` to point to new backend port

### Backend Not Responding
```bash
# Check if service is running
curl http://127.0.0.1:8003/health

# If not, restart backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8003 --reload
```

### Frontend Shows Blank Page
- Check browser console (F12) for errors
- Ensure backend is running and accessible
- Clear browser cache: Ctrl+Shift+Delete

### Design Quality Issues

If generated design seems generic (e.g., components are just "API", "Service", "Storage"):
- Ensure your requirements are specific (name entities, describe workflows)
- The system rejects generic placeholders by design
- More detailed input → more meaningful output

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/app/graph.py` | Core agent orchestration pipeline |
| `backend/app/rules.py` | Deterministic feasibility gate |
| `backend/app/main.py` | FastAPI endpoints |
| `frontend/src/main.jsx` | React workbench UI |
| `frontend/src/styles.css` | Styling |
| `backend/tests/test_mamdo.py` | Unit tests |
| `README.md` | Full documentation |
| `FINAL_VALIDATION_REPORT.md` | Comprehensive validation results |

---

## API Reference

### POST /generate
Generate a new system design from requirements.

**Request:**
```json
{
  "requirements": "Customers can browse products and place orders...",
  "run_id": "optional-uuid"
}
```

**Response:**
```json
{
  "run_id": "uuid",
  "status": "complete",
  "requirements": {...},
  "architecture": {...},
  "design": {...},
  "critique": {...},
  "mamdo_report": {...}
}
```

### POST /change
Request a design change.

**Request:**
```json
{
  "run_id": "uuid",
  "change_request": "Add caching for fast responses"
}
```

**Response:**
```json
{
  "original_design": {...},
  "revised_design": {...},
  "change_rationale": "..."
}
```

### POST /stages/analyze
Analyze a specific pipeline stage (requires backend config).

### GET /health
Health check.

**Response:**
```json
{
  "status": "ok",
  "provider_mode": "demo"
}
```

---

## Next Steps

1. **Try the pre-loaded example** – Click "Generate system design" to see the full flow
2. **Test with custom requirements** – Modify the requirement text and re-generate
3. **Explore all tabs** – Review Workbench, System Design, SRS Document outputs
4. **Run tests** – Validate with `pytest tests/test_mamdo.py -v`
5. **Extend functionality** – Add new requirements, custom rule checks, or export formats

---

## Contact & Support

For issues, questions, or feature requests, refer to:
- `README.md` – Full technical documentation
- `FINAL_VALIDATION_REPORT.md` – Validation results and test evidence
- `backend/tests/test_mamdo.py` – Example usage and test cases

---

**Status:** ✅ System Fully Operational  
**Last Updated:** January 2025  
**Test Coverage:** End-to-end browser validation complete
