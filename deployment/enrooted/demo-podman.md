# Run an Enrooted CUGA demo with Podman

Choose a scenario and pass your model endpoint to the [launcher](demo.sh). All three run the Enrooted Chat and Manage UI, API-only CUGA, a private Evolve memory worker, an installed skill and PostgreSQL with pgvector. The launcher uses the `quay.io/enrooted/cuga-api` and `quay.io/enrooted/cuga-ui` repositories. Only browser-facing ports are published, on workstation loopback.

| Scenario | Sign-in | Skill and data | Default Chat URL |
| --- | --- | --- | --- |
| [basic](demo-basic.yaml) | Local, anonymous | Summarize meeting notes. Chat history and memory preferences persist. Evolve requires a signed-in identity for personal memory inventory and management. | `http://localhost:7860/chat` |
| [keycloak](demo-keycloak.yaml) | Starts its own HTTPS Keycloak and imports a demo owner | Same meeting skill, plus personal memory tied to the signed-in user. Keycloak stores the realm in this demo's PostgreSQL. | `https://localhost:8444/chat` |
| [enterprise-rag](demo-enterprise-rag.yaml) | Uses your existing Keycloak | Search, expand and read permitted content from your running Enrooted Context installation through its MCP server. | `https://localhost:8445/chat` |

The earlier handbook example used employee handbooks as its test corpus. The enterprise RAG deployment works with the documents and access policies in your installation.

## Prepare Linux or macOS

1. Install Podman and run `podman info`. On macOS, Podman Desktop can set up and start the Linux VM used by the CLI. If `podman info` succeeds against your local machine, continue to step 2. Otherwise check `podman machine list`. Use `podman machine start` for an existing stopped machine. If the list is empty, run `podman machine init` and then `podman machine start`. Allow enough VM disk and memory for the API image, its embedding weights, PostgreSQL and, in scenario two, Keycloak. [Podman Machine documentation](https://docs.podman.io/en/latest/markdown/podman-machine.1.html)
2. From the fork root, use the project Python environment (`uv sync --dev`) or create a smaller one. The launcher accepts a Python 3.9+ interpreter through `DEMO_PYTHON`.

   ```sh
   cd deployment/enrooted
   python3 -m venv .demo/venv
   .demo/venv/bin/python -m pip install PyYAML cryptography certifi
   export DEMO_PYTHON="$PWD/.demo/venv/bin/python"
   ```

   With the project environment already installed, simply `cd deployment/enrooted`. The launcher finds the checkout's `.venv`.
3. Set the model endpoint as reachable **from the pod**, and use the served model ID. For a service running on the workstation itself, use a host address reachable from Podman, such as `host.containers.internal`. In a pod, `localhost` refers to the pod. Set `OPENAI_API_KEY` through your secret store if vLLM requires a key.

   ```sh
   export VLLM_URI='https://vllm.replaceme.example.com/v1'
   export MODEL='Qwen3.8-27B-NVFP4'
   ```

   Replace the example host before deploying. TLS verification defaults to `--verify-ssl true`. Pass `--vllm-ca /path/to/model-ca.pem` for a private model CA or `--verify-ssl false` for a lab model. The switch configures the CUGA model client. Identity and MCP connections verify TLS independently.
4. The launcher selects `:demo` on an amd64 Podman engine and `:demo-mac` on arm64, including Apple Silicon. An offline preview uses the workstation architecture. Pass `--platform` to select another target explicitly.

### Build and deploy your checkout

Add `--build` to any scenario to build the API and UI from your current checkout, including uncommitted edits. For example, from `deployment/enrooted`:

```sh
./demo.sh basic --build --ui-port 9080 --vllm-uri "$VLLM_URI" --model "$MODEL"
```

Open `http://localhost:9080/chat`. Both application images build for the Podman engine's architecture and stay in its local image store. The build can download base images, dependencies and model weights, and Podman can pull PostgreSQL or Keycloak. Each deployment gets its own local image tags. Run `./demo.sh basic --cleanup` to remove the deployment and those tags before rebuilding. Cleanup deletes the demo data volumes.

`--ui-port` also works with published images. The launcher prints the Chat and Manage URLs. For the signed-in scenarios it uses the selected port in the public callback. If you also supply a port in `--ui-origin`, the two values must match. For the basic demo, choose a free port of 1024 or higher outside the pod's internal service ports (5432, 7870, 8001 and 8201).

## 1. Basic CUGA

```sh
./demo.sh basic --vllm-uri "$VLLM_URI" --model "$MODEL"
```

Open `http://localhost:7860/chat` and ask CUGA to summarize meeting notes. In Manage, the installed skill is `meeting-summary`. Use the Keycloak demo to inspect a user's stored Evolve entities.

## 2. CUGA with bundled Keycloak

```sh
./demo.sh keycloak --vllm-uri "$VLLM_URI" --model "$MODEL" --verify-ssl true
cat .demo/keycloak/owner-password
```

Open `https://localhost:8444/chat` and sign in as `owner` with the generated password. The launcher generates a localhost certificate valid for 30 days. Trust `.demo/keycloak/localhost.pem` in your test browser for the UI and Keycloak, or supply a trusted localhost certificate with `--cert` and `--key`. Keycloak listens on `https://localhost:8543`. To change the ports, pass `--ui-port 9444` and `--keycloak-port 9543` as needed. The realm import registers the exact public callback at `<ui-origin>/manage`.

Send a chat message, toggle the personal memory setting, and reopen the conversation. The demo has its own user, database, volumes and network. It can run independently of Enrooted Context.

## 3. CUGA with Enrooted Context enterprise RAG

Start with an existing Enrooted Context installation, a reachable Enrooted Context MCP endpoint, and a Keycloak realm configured for the CUGA → MCP → Context token exchanges. CUGA connects to the MCP endpoint. The MCP deployment owns its connection to the Context API.

Register CUGA's confidential client with standard flow, PKCE S256, the CUGA client audience, the required roles and the exact callback `<ui-origin>/manage`. The browser and the pod must reach the same HTTPS issuer. Supply `OIDC_CLIENT_SECRET` through your secret store. The connector guide includes an example of the required claims, audience and user roles. [Keycloak token exchange setup](README.md#configure-the-handbook-demo)

```sh
./demo.sh enterprise-rag \
  --vllm-uri "$VLLM_URI" --model "$MODEL" --verify-ssl true \
  --ui-origin https://chat.replaceme.example.com:8445 \
  --cert /path/to/chat-chain.pem --key /path/to/chat-key.pem \
  --issuer https://sso.replaceme.example.com/realms/enrooted \
  --client-id cuga-demo \
  --mcp-url https://mcp.replaceme.example.com/mcp \
  --mcp-audience enrooted-context-mcp --mcp-scope evidence:read \
  --ca /path/to/enterprise-ca.pem
```

Replace the hostnames and client values with your installation's settings. Resolve the UI name to loopback on the browser workstation. For the default localhost UI, omit `--ui-origin`, `--cert` and `--key`, register `https://localhost:8445/manage`, and trust the generated `.demo/enterprise-rag/localhost.pem` in your test browser. Omit `--ca` for publicly trusted issuer and MCP certificates. Repeat `--mcp-scope` for each required scope. Set `--tenant-claim` if MCP uses a tenant claim, and `--network` when the external services require an existing Podman network.

Sign in to Manage as a `ServiceOwner`. Register a Streamable HTTP MCP tool at the **exact** `--mcp-url`, leave static credentials empty, save and publish the agent. This step discovers tools with the owner's authorization. In Chat, ask about a document the signed-in user can access and reopen a returned citation. Repeat as a user without access to that document. The installed `enterprise-evidence` skill guides the agent to cite returned evidence.

## Preview, stop and clean up

Add `--render-only` to a launch command to inspect `.demo/<scenario>/preview.yaml` without starting Podman. A real launch saves `manifest.yaml` in the same directory. It sends database credentials, encryption keys, OIDC credentials and private TLS material to Podman's secret store. Local deployment files are excluded from Git and image build contexts.

To stop the demo temporarily and retain both volumes, stop and start its pod. For example:

```sh
prefix=$(cat .demo/keycloak/prefix)
podman pod stop "$prefix-pod"
podman pod start "$prefix-pod"
podman logs -f "$prefix-pod-api"
```

Cleanup permanently removes the selected pod, PostgreSQL and CUGA data volumes, generated configuration volumes, local credentials, and the network created by the launcher. An operator-supplied network and external services retain their data. Keep the local deployment directory until cleanup finishes. Repeat the same launch command to create a fresh demo.

```sh
./demo.sh basic --cleanup
./demo.sh keycloak --cleanup
./demo.sh enterprise-rag --cleanup
```

## Build and publish the images

Run the following commands from the fork root.

```sh
podman build --pull=always --ignorefile apps/enrooted-ui/Containerfile.containerignore \
  -f apps/enrooted-ui/Containerfile -t localhost/enrooted-ui:demo .
podman build --pull=always -f deployment/enrooted/Containerfile.api \
  -t localhost/enrooted-cuga-api:hummingbird-demo .
```

Both application images use Red Hat Hummingbird runtimes. The [API Containerfile](Containerfile.api) installs the locked Python and Evolve dependencies in a Python 3.12 builder and preloads the model weights. It checks the bundled models offline in the final Python 3.12 image. The UI uses the Node 26 builder and nginx 1.30 runtime.

A Python entrypoint prepares PostgreSQL and starts CUGA’s existing supervisor as PID 1. The backend runs as UID 1001 to reuse the demo data volume. It supports the embedded Evolve worker, the private registry, agent skills and HTTP MCP services. Skills and tools that execute shell scripts need a separate execution environment. Chromium for the browser test runs on the workstation.

### Publish both images to Quay

From a checkout of this fork on the computer you want to build for, run:

```sh
podman login quay.io
./deployment/enrooted/publish-images.sh
```

| Build machine | API | UI |
| --- | --- | --- |
| amd64 Linux or Intel Mac | `quay.io/enrooted/cuga-api:demo` | `quay.io/enrooted/cuga-ui:demo` |
| Apple Silicon or arm64 Linux | `quay.io/enrooted/cuga-api:demo-mac` | `quay.io/enrooted/cuga-ui:demo-mac` |

Each machine builds both images from its own checkout, runs a startup check on each and pushes its two tags directly. Run the command whenever you want to refresh that platform. The two platforms can use different revisions. Set `IMAGE_PREFIX` to change registries or pass `--tag` to publish a custom tag.

For a full Keycloak sign-in and chat test before upload, use:

```sh
uv sync --dev
.venv/bin/playwright install chromium --only-shell
export CUGA_TEST_CHAT_URL="$VLLM_URI"
export CUGA_TEST_CHAT_MODEL="$MODEL"
./deployment/enrooted/publish-images.sh --test
```

Set `CUGA_TEST_CHAT_CA` to a private model CA if needed. For a lab model, `CUGA_TEST_CHAT_SKIP_VERIFY=1` turns off TLS verification for the model connection during the test.

### If the Mac build exits with status 137

Check the Linux VM's memory and kernel log before retrying:

```sh
podman machine ssh "free -h; sudo journalctl -k -b --grep='Out of memory|Killed process|oom-kill' --no-pager -n 8"
podman stats --no-stream
```

An out-of-memory entry naming Python in a Buildah cgroup confirms that the kernel killed the build. The API build warms one model at a time and checks the bundled assets offline. If the VM is still short of memory, temporarily stop an idle workload you recognize or allocate more memory to the build VM. Rerun `./deployment/enrooted/publish-images.sh` to reuse completed layers.

## Image scan

On 2026-11-21, Grype 0.117.0 using its 2026-11-19 database reported the following package–advisory matches on the workstation’s amd64 images. Multiple packages can match a single advisory.

| Image | Critical | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: |
| Hummingbird Python 3.12 runtime base | 0 | 4 | 11 | 3 |
| Built Enrooted CUGA API | 2 | 78 | 125 | 14 |

The two critical matches are in Playwright’s bundled Node binary and the FFmpeg libraries bundled with the OpenCV wheel. The scanned API image ID was `e0ad9e9f51dc350fd737b41399da81d04c8d6c9789e53f23ecce64fdb829148a`. To scan your own build:

```sh
scan_dir=$(mktemp -d)
podman save --format oci-dir -o "$scan_dir/api" localhost/enrooted-cuga-api:hummingbird-demo
grype "oci-dir:$scan_dir/api"
```
