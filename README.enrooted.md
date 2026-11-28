# Enrooted additions to CUGA

This index tracks custom functionality in the Enrooted fork. For general CUGA setup and usage, see the [project README](README.md).

| Feature | Status | What it enables | Details |
| --- | --- | --- | --- |
| Enrooted Context connector | Implemented on the connector branch | Employees can search, expand and read enterprise evidence through CUGA using their own Enrooted permissions. | [Setup and two-user test](deployment/enrooted/README.md) |
| API-only serving | Opt-in | Serve the CUGA backend without the bundled web pages or interactive API docs. | [Configuration and authentication](deployment/enrooted/README.md#serve-only-the-cuga-api) |
| [Hummingbird API backend](deployment/enrooted/Containerfile.api) | Demo | Run the CUGA API, private registry and Evolve memory in a shell-free Python runtime. | [Build and run the backend](deployment/enrooted/demo-podman.md#build-and-publish-the-images) |
| [Enrooted UI](apps/enrooted-ui/) | Demo | Run Chat and Manage on a chosen local port with basic CUGA, bundled Keycloak, or enterprise RAG through Enrooted Context MCP. | [Deploy with published images](deployment/enrooted/demo-podman.md), [build your checkout](deployment/enrooted/demo-podman.md#build-and-deploy-your-checkout), or [stop and resume a demo](deployment/enrooted/demo-podman.md#preview-stop-and-clean-up) |
| AI interaction disclosure | Implemented | Chat, Manage draft chat and Studio Concierge identify the AI assistant before users send a message. The tool guard generation button also identifies AI use. Notices are available in English and Swedish. | [EU AI Act, Article 50(1) and (5)](https://eur-lex.europa.eu/eli/reg/2024/1689/oj/eng#art_50) |

## Updating the index

Add or update one row in the same pull request that adds, changes, or retires an Enrooted feature. Describe what users can do. When the feature ships, mark it **Available** and link to its setup instructions and a check that demonstrates it works. Run that check when an upstream update touches code the feature depends on.
