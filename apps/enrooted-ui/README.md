# Enrooted UI

Enrooted’s standalone React frontend serves Chat at `/chat` and agent administration at `/manage`. nginx serves the Vite bundle and streams requests to the API-only CUGA backend over the pod’s loopback interface. The browser signs in through CUGA and never receives the model API key or the OIDC client secret.

## Build and deploy

Follow the [Podman demo instructions](../../deployment/enrooted/demo-podman.md) to build the Hummingbird image, enable HTTPS, register the public sign-in callback and start the stack.

## Local frontend development

With Node 22.12+ or a supported newer version and a local CUGA API listening on port 7860, run:

```sh
cd apps/enrooted-ui
npm ci
npm run dev -- --host 127.0.0.1 --port 3002
```

Set `CUGA_URL` to change the development proxy target. Open `http://localhost:3002/chat`. Port 3002 is a trusted local development origin for CUGA. Use the HTTPS demo for sign-in and delegated evidence. Run `npm run build` to type-check and produce `dist/`.

The production image uses the Hummingbird Node builder and nginx runtime streams. Its default HTTP listener is pod-local on 7870. The demo mounts an additional HTTPS listener on 8444. Only the UI port is published.
