# Connect CUGA Chat to Enrooted Context

The signed-in employee's Keycloak session authorizes each evidence call. CUGA exchanges the employee's access token for the MCP audience. FastMCP performs the second exchange for the Enrooted API. Search, read and expansion are authorized by Enrooted on every call.

## Enrooted UI with PostgreSQL

Use the [Enrooted Podman demo](demo-podman.md) for the standalone UI, API-only backend, PostgreSQL with pgvector, embedded Evolve and agent skills. Choose basic CUGA, bundled Keycloak, or enterprise RAG with an existing Enrooted Context MCP and Keycloak installation.

## Configure the handbook demo

1. Start the identity realm, handbook corpus and MCP service using sections 1–5 of the [Context demo](../../../enrooted-context/demo/cuga/README.md). Use a disposable Podman user or VM for that full workspace runbook, which uses fixed resource names. The automated connector test below can run alongside an existing workspace.
2. Build the image in this fork with `podman build -f Dockerfile.ubi -t localhost/cuga:handbook .`. Copy `connector.env` and `connector.yaml` from this directory into the demo's `$DEMO_DIR`. Section 6 mounts them in the CUGA pod. The example maps the exact URL `https://evidence.demo.test:8445/mcp` to the audience `handbook-mcp` and scope `evidence:read`. CUGA and MCP trust the same realm and the mounted demo CA.
3. Use `cuga-demo` as the confidential CUGA client, with callback `https://chat.demo.test:8444/manage`, PKCE S256 and standard token exchange enabled. Include the CUGA client audience, `sub`, `sid`, and the CUGA roles in the login tokens. The first exchange must return a bearer access token with `azp=cuga-demo`, the employee's subject and the MCP audience and scope. Disable service accounts on both exchanging clients. The sample single-tenant realm uses no tenant claim. For a multi-tenant realm set `tenant_claim` in the profile and configure the same claim in MCP.
4. Create two independent Fernet keys once. Run these commands in the CUGA checkout after `uv sync --dev`. Keep the keys across restarts. Add the two secret arguments below to the runbook's **handbook-agent** container command.

   ```bash
   for secret in handbook-cuga-session-key handbook-cuga-binding-key; do
     uv run python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode(), end="")' |
       podman secret create "$secret" -
   done
   ```

   ```text
   --secret handbook-cuga-session-key,type=env,target=CUGA_SECRET_KEY
   --secret handbook-cuga-binding-key,type=env,target=CUGA_REGISTRY_BINDING_KEY
   ```

   The session key encrypts PKCE verifiers and login credentials in CUGA's relational store. The registry binding key authenticates challenges and encrypts short-lived, request-bound dispatch credentials between the backend and private registry. On a single workstation, mount the runbook's persistent CUGA database volume. For multiple replicas configure CUGA's PostgreSQL storage and give each replica the same keys. CUGA creates its session table at first login. Logout revokes the record and expiry requires a fresh login.
5. In Manage, sign in as a `ServiceOwner`. Add a Streamable HTTP MCP tool named `handbook` with the exact profile URL. In the Enrooted UI, select **Keycloak user token exchange** for **Auth type** and enter `enrooted` as the **Delegation profile**. On save, CUGA matches the operator's URL, performs discovery as the signed-in manager and saves the schemas. The [agent example](agent.json) gives the equivalent explicit registration and the text for the agent's special instructions. Copy its fields into the agent you want to publish. Configure your approved tool-capable chat endpoint, enable function calling and publish for `ServiceUser`.
6. Run the two-browser exercise in section 7 of the Context demo. Ask the operator for the notice during probation and the usual notice, then reopen both citations. Section 1.2 of the Larkspur handbook specifies seven days during the first six months and thirty days normally. Bob should be able to use the same agent while receiving no protected passages. Keep the opaque handles intact when passing them to `read_evidence`.

### Helm deployment

Supply the connector image and merge [helm-values.yaml](helm-values.yaml) into the release values. Create the referenced profile Secret with keys `connector.yaml` and `handbook-ca`. Create the credentials Secret with `CUGA_SECRET_KEY`, `CUGA_REGISTRY_BINDING_KEY`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_DISCOVERY_URL` and `DYNACONF_STORAGE__POSTGRES_URL`. Set `OPENAI_BASE_URL` and `MODEL_NAME` to the approved model endpoint and served ID. Add `OPENAI_API_KEY` to the credentials Secret (a nonsecret placeholder is sufficient for a keyless model). The chart exposes the UI/backend port. Keep the registry private within the pod. A separate registry needs verified HTTPS, the same binding key and operator profile, and a private workload connection. The public CUGA backend strips `X-Cuga-Delegated-Call` from incoming requests. Give model tools no access to the session database or deployment secrets.

## Serve only the CUGA API

Set `DYNACONF_UI__ENABLED=false` in the backend container and restart it. With Helm, set `env.DYNACONF_UI__ENABLED` to the string `"false"`. The default is `true` for deployments using the bundled Chat and Manage pages.

The public backend serves `GET /health`, `GET /openapi.json`, `POST /stream` and the management APIs. The Chat and Manage pages, static assets, flow viewer, Swagger UI and ReDoc return HTTP 404. Helm probes use `/health` in either mode.

For OIDC, the bundled `/manage` page normally finishes the login. An API client using delegated evidence needs to start at `GET /auth/login`, receive the authorization redirect at its registered callback, and POST the returned `code` and `state` to `/auth/callback` with the original CUGA state cookie. Keep the resulting session cookie for `POST /stream`. A standalone bearer token can authenticate supported API calls, but direct evidence exchange requires the signed-in CUGA session. For a browser client, serve its callback at the configured origin and route its CUGA requests through the same origin.

## Repeat the isolated connector test

The test launcher uses a fresh loopback Keycloak container, a temporary CA, an enforcing Enrooted Context process and the real Python FastMCP server. The Context project's test fixture ingests the handbook in temporary storage. Each login starts on a separate CUGA worker and completes in the Chat process using authorization code and PKCE. The workers share a temporary SQLite database and the deployment keys. The test logs out on the login worker and checks that the cookie stops working in Chat. The test selects tools deterministically inside the real Chat streaming endpoint. This exercises delegation independently of model selection. Use the Chromium test below or section 7 of the Context demo to evaluate the generated answer.

On Linux, install rootless Podman, OpenSSL and uv. Have the Context checkout containing `mcp-server/tests/live/stack.py` available. Run from this fork:

```bash
export ENROOTED_CONTEXT_DIR="$HOME/enrooted-context"
uv sync --dev
uv sync --project "$ENROOTED_CONTEXT_DIR" --locked
uv sync --project "$ENROOTED_CONTEXT_DIR/mcp-server" --locked
.venv/bin/python deployment/enrooted/test_stack.py \
  .venv/bin/pytest -q -m manual tests/integration/test_enrooted_handbook.py
```

The test uses the CI distribution and its local embedding model. If its model weights are already cached, set `HF_HUB_OFFLINE=1` for an offline model run. The launcher creates and stops its own container and processes and removes its temporary directory on exit. It supplies the test secrets to the test process. The full workspace and GPU services have independent lifecycles.

For fast feedback run `uv run pytest -q tests/unit/test_enrooted_connector.py`.

### Repeat the model-driven Chat test

This variant also starts the fork's Chat server and private registry on random loopback ports. It publishes the example agent as Alice and submits questions from two separate Chromium sessions. It uses the chat model you select and the same disposable handbook corpus as the deterministic test. The existing Enrooted pod supplies the model configuration. The test creates its own users, data and access policy.

From the fork root, with the prerequisites above installed, run the following. Read only the two nonsecret model settings from the running backend.

```bash
export CUGA_TEST_CHAT_URL="$(podman inspect --format '{{range .Config.Env}}{{println .}}{{end}}' enrooted-local-backend | sed -n 's/^LLM_URL=//p')"
export CUGA_TEST_CHAT_MODEL="$(podman inspect --format '{{range .Config.Env}}{{println .}}{{end}}' enrooted-local-backend | sed -n 's/^LLM_MODEL=//p')"
.venv/bin/playwright install chromium --only-shell
export CUGA_TEST_CHAT_SKIP_VERIFY=1
HF_HUB_OFFLINE=1 .venv/bin/python deployment/enrooted/test_stack.py --chat \
  .venv/bin/pytest -q -m manual tests/integration/test_enrooted_browser.py
```

On this workstation the keyless endpoint serves `Qwen3.8-27B-NVFP4`. The explicit skip setting applies to the temporary model client's HTTPS connection. Keycloak and FastMCP use verified TLS, and Chromium trusts the disposable certificate's public key. To verify the model as well, unset `CUGA_TEST_CHAT_SKIP_VERIFY` and set `CUGA_TEST_CHAT_CA` to the PEM file for the model service's CA. For a model that needs a key, provide `CUGA_TEST_CHAT_KEY` from the secret store. Leave `HF_HUB_OFFLINE` unset on a first run that needs to download the local embedding model.

The default browser test alternates between the two signed-in employees. Set `CUGA_TEST_CHAT_PARALLEL=1` to submit both users’ prompts concurrently. The shared workstation model returned HTTP 429 on some concurrent runs. The browser test reports the failed turn, and the registry does not replay an evidence call after dispatch.

The workstation run used the connector working tree based on CUGA `053afb67` and the Context checkout at `4fd16fc`. The browser exercise checks both generated answers, independently resolves the displayed citation IDs and reopens a citation in both profiles. It then quarantines the temporary handbook and checks that Alice’s existing IDs become unavailable. The launcher scans CUGA and registry logs for the test query, handles, notice text and credential markers. The deterministic test separately requires a successful neighbor expansion and compares both returned passages with their source text.

### Workstation verification

| Check | Result |
| --- | --- |
| Connector, gateway, MCP protocol, thread ownership, error redaction and trajectory regression suites | 200 passed, including 27 connector unit tests. One optional Evolve compatibility test skipped because `altk_evolve` was absent. |
| Real Keycloak, FastMCP and Enrooted Context through CUGA `/stream` | Passed with two CUGA processes sharing the test database. Alice searched, expanded and read. Bob's read of the same handles returned unavailable. Conflicting credentials, cross-origin logout and reuse after logout were rejected. |
| Published Chat agent and Qwen in two Chromium profiles | Passed with alternating turns and in a concurrent run. Both generated citations resolved to the source. Withdrawing the handbook denied a fresh read. A separate concurrent run encountered a model rate limit. |
| Helm with external Secrets | The chart passed lint and rendered with the profile volume and credential Secret references. Cluster installation and PostgreSQL failover remain untested. |
