# CMG MCP implementation plan

## Goal

Use MCP as the only AI execution channel while keeping provider selection in the UI:

```text
MCP mode:  Web App -> CMG Node API -> selected provider -> CMG MCP -> Firebase/model tools
```

The browser must never receive a provider API key, MCP secret, or Firebase
service-account credential.

## Delivery phases

### Phase 1 — Local foundation (implemented)

- [x] Route model creation and editing through `/api/mcp/trigger` only.
- [x] Remove the chat-mode selector; retain provider, model, and effort selectors.
- [x] Add a server-side MCP trigger endpoint that authenticates the Firebase user,
      verifies project membership, and starts a scoped provider MCP run.
- [x] Add a request status endpoint and a Firebase-backed request record so the
      browser can follow asynchronous MCP work after refresh.
- [x] Add an MCP Streamable HTTP endpoint with a small, safe tool surface.
- [x] Support OpenAI Responses MCP plus server-side MCP bridges for Anthropic and
      Google using the provider keys saved by Admin.

### Phase 2 — MCP tools

Read-only tools:

- `list_projects`
- `get_project_summary`
- `list_categories`
- `search_elements`
- `get_element_context`
- `list_project_files`
- `read_text_file` (CSV/DXF/IFC/JSON/text up to 256 KB)
- `get_schedule`
- `inspect_model`

Write tools:

- `apply_model_patch`
- `update_schedule`
- `save_project`
- `create_model_from_files` (later, asynchronous)
- `get_job_status`
- `cancel_job`

Every tool must validate the short-lived scope token, project membership, role,
payload size, model schema, revision, and geometry before writing.

### Phase 3 — Google Cloud runtime (configuration prepared; deployment still needs project credentials)

- [ ] Deploy the Node app or MCP service to Cloud Run with a dedicated service
      account and least-privilege Firestore/Storage access.
- [x] Serve the React build from Firebase Hosting and route `/api/**` and `/mcp`
      to Cloud Run, or use one Cloud Run service for both UI and API.
- [x] Add Secret Manager references for MCP secrets to `cloudbuild.yaml`.
- [ ] Set `GOOGLE_CLOUD_PROJECT`, `VITE_FIREBASE_PROJECT_ID`, and MCP URL as
      deployment configuration, never in source control.

### Phase 4 — Verification (local checks implemented; cloud checks pending)

- [x] Unit-test scope-token expiry and run the existing API/model validation suite.
- [x] Add an `npm run mcp:smoke` check for MCP initialize and tools/list.
- [ ] Test project isolation, read-only tools, patch
      validation, geometry validation, revision conflicts, and destructive-action
      approval boundaries.
- [ ] Run provider-MCP regression tests with all three provider bridges.
- [ ] Run an end-to-end MCP edit: locate an element, apply a patch, inspect the
      result, save it, and observe the update in the web app.
- [ ] Run Cloud Run/Firebase smoke tests with a non-admin user and an unauthorized
      project.
- [ ] Only call the system production-ready after all checks pass; until then the
      MCP selector remains clearly marked as experimental when configuration is
      incomplete.

## Initial security decisions

- MCP calls require a bearer secret plus a short-lived signed scope token.
- The scope token is limited to one Firebase user, one project, one request, and a
  short expiry. It cannot be used for another project or request.
- MCP will not expose raw Firestore writes, arbitrary code execution, API-key
  reads, user administration, or project deletion in the first release.
- `apply_model_patch` writes only validated model changes and uses the current
  project revision to prevent silent overwrites.

## Google Cloud prerequisites

- A Firebase/Google Cloud project with Firestore, Storage, Firebase Authentication,
  Cloud Run, Secret Manager, and Artifact Registry enabled.
- A Cloud Run service account with only the Firestore and Storage permissions needed
  by the MCP service.
- A public HTTPS MCP URL. Localhost and a static Firebase Hosting-only deployment
  are not sufficient for external provider MCP bridges to reach the MCP server.

