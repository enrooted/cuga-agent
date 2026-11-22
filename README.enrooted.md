# Enrooted additions to CUGA

This index tracks custom functionality in the Enrooted fork. For general CUGA setup and usage, see the [project README](README.md).

| Feature | Status | What it enables | Details |
| --- | --- | --- | --- |
| Enrooted Context connector | Implemented on the connector branch | Employees can search, expand and read enterprise evidence through CUGA using their own Enrooted permissions. | [Setup and two-user test](deployment/enrooted/README.md) |
| API-only serving | Opt-in | Serve the CUGA backend without the bundled web pages or interactive API docs. | [Configuration and authentication](deployment/enrooted/README.md#serve-only-the-cuga-api) |
| [Hummingbird API backend](deployment/enrooted/Containerfile.api) | Demo | Run the CUGA API, private registry and Evolve memory in a shell-free Python runtime. | [Build and run the backend](deployment/enrooted/demo-podman.md#build-and-publish-the-images) |
| [Enrooted UI](apps/enrooted-ui/) | Demo | Run Chat and Manage on Linux or macOS with basic CUGA, bundled Keycloak, or enterprise RAG through Enrooted Context MCP. | [Deploy and verify the Podman demo](deployment/enrooted/demo-podman.md) |

## Updating the index

Add or update one row in the same pull request that adds, changes, or retires an Enrooted feature. Describe what users can do. When the feature ships, mark it **Available** and link to its setup instructions and a check that demonstrates it works. Run that check when an upstream update touches code the feature depends on.
