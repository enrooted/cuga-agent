"""Deploy an Enrooted UI and CUGA API demo with Podman on Linux or macOS."""

import argparse
import fcntl
import os
from pathlib import Path
import platform
import re
import secrets
import subprocess
import sys
from urllib.parse import urlsplit

try:
    import yaml
    from demo_secrets import provision
except ImportError as exc:
    sys.exit(f"Missing {exc.name}. Install PyYAML, certifi and cryptography in your demo Python environment.")

HERE = Path(__file__).resolve().parent
UI_DIR = HERE.parents[1] / "apps/enrooted-ui"
SCENARIOS = ("basic", "keycloak", "enterprise-rag")


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scenario", choices=SCENARIOS)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--stop", action="store_true", help="Stop this demo pod and keep its data")
    actions.add_argument(
        "--cleanup", action="store_true", help="Remove this deployment, credentials and all its volumes"
    )
    actions.add_argument(
        "--render-only", action="store_true", help="Write preview.yaml without contacting Podman"
    )
    parser.add_argument(
        "--build", action="store_true", help="Build and deploy the API and UI from this checkout"
    )
    parser.add_argument("--state-dir", type=Path, default=HERE / ".demo", help="Private local state parent")
    parser.add_argument("--vllm-uri", help="OpenAI-compatible API base URL including /v1")
    parser.add_argument("--model", help="Served model ID (default Qwen3.8-27B-NVFP4)")
    parser.add_argument(
        "--verify-ssl", choices=("true", "false"), default="true", help="Verify vLLM TLS (default true)"
    )
    parser.add_argument("--vllm-ca", type=Path, help="Additional trusted PEM roots for vLLM")
    images = parser.add_mutually_exclusive_group()
    images.add_argument(
        "--platform",
        choices=("linux/amd64", "linux/arm64"),
        help="Build or pull both CUGA images for this platform",
    )
    parser.add_argument("--api-image", help="Override the API image reference")
    parser.add_argument("--ui-image", help="Override the UI image reference")
    images.add_argument(
        "--pull-policy",
        choices=("Always", "IfNotPresent", "Never"),
        help="Pull policy for both application images",
    )
    parser.add_argument("--ui-origin", help="Browser HTTPS origin for a signed-in demo")
    parser.add_argument("--ui-port", type=int, help="Published loopback port for Chat and Manage")
    parser.add_argument("--cert", type=Path, help="UI TLS certificate chain in PEM format")
    parser.add_argument("--key", type=Path, help="UI TLS private key in PEM format")
    parser.add_argument("--keycloak-port", type=int, help="Bundled Keycloak HTTPS port (default 8543)")
    rag = parser.add_argument_group("enterprise RAG with existing Enrooted Context, MCP and Keycloak")
    rag.add_argument("--issuer", help="Full HTTPS Keycloak realm issuer")
    rag.add_argument("--client-id", help="Confidential CUGA client registered in Keycloak")
    rag.add_argument("--mcp-url", help="Full HTTPS Enrooted Context MCP endpoint")
    rag.add_argument("--mcp-audience", help="Target audience used by Keycloak token exchange")
    rag.add_argument("--mcp-scope", action="append", help="Requested MCP scope (repeat for multiple scopes)")
    rag.add_argument("--tenant-claim", help="JWT tenant claim used by a multi-tenant installation")
    rag.add_argument("--ca", type=Path, help="Additional trusted PEM roots for the issuer and MCP")
    rag.add_argument("--network", help="Existing Podman network with access to external services")
    args = parser.parse_args()
    if args.cleanup or args.stop:
        return args
    if args.build and (args.api_image or args.ui_image or args.pull_policy not in (None, "Never")):
        parser.error("--build supplies both local images and uses pull policy Never")
    if not args.vllm_uri:
        parser.error("--vllm-uri is required")
    if args.vllm_ca and args.verify_ssl == "false":
        parser.error("--vllm-ca requires --verify-ssl true")
    if args.scenario != "enterprise-rag" and any(
        (
            args.issuer,
            args.client_id,
            args.mcp_url,
            args.mcp_audience,
            args.mcp_scope,
            args.tenant_claim,
            args.ca,
            args.network,
        )
    ):
        parser.error("External issuer, MCP and network options apply only to enterprise-rag")
    if args.scenario == "enterprise-rag":
        if not all((args.issuer, args.client_id, args.mcp_url, args.mcp_audience, args.mcp_scope)):
            parser.error("Supply --issuer, --client-id, --mcp-url, --mcp-audience and --mcp-scope")
        if any(not s or any(c.isspace() for c in s) for s in args.mcp_scope):
            parser.error("Supply one token per --mcp-scope")
        if not args.render_only and not os.environ.get("OIDC_CLIENT_SECRET"):
            parser.error("Set OIDC_CLIENT_SECRET for the registered confidential client")
    if args.keycloak_port is not None and args.scenario != "keycloak":
        parser.error("--keycloak-port applies only to keycloak")
    if args.scenario == "basic" and any((args.cert, args.key, args.ui_origin)):
        parser.error("basic uses HTTP on localhost. Set its port with --ui-port.")
    if bool(args.cert) != bool(args.key):
        parser.error("Supply both --cert and --key")
    if args.ui_port is not None and not 1 <= args.ui_port <= 65535:
        parser.error("--ui-port must be between 1 and 65535")
    if not args.ui_origin:
        scheme = "http" if args.scenario == "basic" else "https"
        port = args.ui_port or {"basic": 7860, "keycloak": 8444, "enterprise-rag": 8445}[args.scenario]
        args.ui_origin = f"{scheme}://localhost:{port}"
    for field in ("vllm_uri", "ui_origin", "issuer", "mcp_url"):
        raw = getattr(args, field)
        if not raw:
            continue
        url = urlsplit(raw)
        schemes = ("http", "https") if field == "vllm_uri" or args.scenario == "basic" else ("https",)
        if (
            url.scheme not in schemes
            or not url.hostname
            or url.username is not None
            or url.query
            or url.fragment
            or any(c.isspace() for c in raw)
            or "\\" in raw
            or url.port == 0
        ):
            parser.error(f"Invalid {field} URL")
        if field == "ui_origin" and url.path:
            parser.error("--ui-origin must be an origin without a path or trailing slash")
        if field == "mcp_url" and not url.path:
            parser.error("--mcp-url must include the MCP path")
        if not args.render_only and (
            url.hostname == "replaceme.example.com" or url.hostname.endswith(".replaceme.example.com")
        ):
            parser.error(f"Replace the example hostname for {field} before deploying")
    ui = urlsplit(args.ui_origin)
    if args.ui_port is not None:
        if ui.port is not None and ui.port != args.ui_port:
            parser.error("--ui-port must match the port in --ui-origin")
        if ui.port is None:
            args.ui_origin += f":{args.ui_port}"
    else:
        args.ui_port = ui.port or (80 if ui.scheme == "http" else 443)
    if args.scenario == "basic" and (args.ui_port < 1024 or args.ui_port in (5432, 7870, 8001, 8201)):
        parser.error("Choose an unprivileged basic UI port distinct from the pod's internal services")
    if args.scenario == "keycloak" and ui.hostname != "localhost":
        parser.error("The bundled Keycloak scenario uses https://localhost for browser and pod access")
    if ui.hostname not in ("localhost", "127.0.0.1") and not args.cert:
        parser.error("Supply --cert and --key for the public UI hostname")
    if args.keycloak_port is None:
        args.keycloak_port = 8543
    if args.scenario == "keycloak" and (
        not 1024 <= args.keycloak_port <= 65535
        or args.keycloak_port in (5432, 7860, 7870, 8001, 8201, 8444, args.ui_port)
    ):
        parser.error("Choose an unused unprivileged Keycloak port distinct from the UI and internal services")
    for path in (args.ca, args.vllm_ca, args.cert, args.key):
        if path and not path.is_file():
            parser.error(f"Cannot read {path}")
    return args


def render(args, prefix, arch):
    base = f"cuga-{args.scenario}-demo"
    source = (HERE / f"demo-{args.scenario}.yaml").read_text()
    docs = list(yaml.safe_load_all(source.replace(base, prefix)))
    maps = {d["metadata"]["name"]: d["data"] for d in docs if d["kind"] == "ConfigMap"}
    settings = maps[prefix + "-settings"]
    settings.update(OPENAI_BASE_URL=args.vllm_uri, OPENAI_SSL_VERIFY=args.verify_ssl)
    if args.model:
        settings["MODEL_NAME"] = args.model
    if args.vllm_ca:
        settings["CUGA_SSL_CA_BUNDLE"] = "/run/enrooted/model.pem"
    pod = next(d for d in docs if d["kind"] == "Pod")
    containers = {c["name"]: c for c in pod["spec"]["containers"]}
    for name, image in (("api", args.api_image), ("ui", args.ui_image)):
        if args.build:
            containers[name]["image"] = f"localhost/enrooted/cuga-{name}:{prefix}"
        elif image:
            containers[name]["image"] = image
        elif (
            arch in ("arm64", "aarch64") and containers[name]["image"] == f"quay.io/enrooted/cuga-{name}:demo"
        ):
            containers[name]["image"] += "-mac"
        if args.build or args.platform:
            containers[name]["imagePullPolicy"] = "Never"
        elif args.pull_policy:
            containers[name]["imagePullPolicy"] = args.pull_policy
    ui_port = containers["ui"]["ports"][0]
    ui_port["hostPort"] = args.ui_port
    if args.scenario == "basic" and args.ui_port != 7860:
        # CUGA checks the configured API port when authorizing local browser origins.
        # Give the proxy the original port inside the pod and move its upstream.
        settings["DYNACONF_SERVER_PORTS__DEMO"] = str(args.ui_port)
        nginx = maps[prefix + "-nginx"]
        listener = nginx.pop("local.conf").replace("listen 8080;", "listen 7860;")
        server = (UI_DIR / "nginx.conf").read_text()
        nginx["default.conf"] = server.replace("include /etc/nginx/enrooted/*.conf;", listener).replace(
            "proxy_pass http://127.0.0.1:7860;", f"proxy_pass http://127.0.0.1:{args.ui_port};"
        )
        containers["ui"]["volumeMounts"][0]["mountPath"] = "/etc/nginx/conf.d"
        ui_port["containerPort"] = 7860
    if args.scenario != "basic":
        settings["OIDC_REDIRECT_URI"] = args.ui_origin + "/manage"
    if args.scenario == "keycloak":
        origin = f"https://localhost:{args.keycloak_port}"
        issuer = origin + "/realms/enrooted"
        kc = containers["keycloak"]
        kc["ports"][0].update(containerPort=args.keycloak_port, hostPort=args.keycloak_port)
        options = {"--hostname": origin, "--https-port": str(args.keycloak_port)}
        for i, arg in enumerate(kc["args"]):
            option = arg.partition("=")[0]
            if option in options:
                kc["args"][i] = f"{option}={options[option]}"
    if args.scenario == "enterprise-rag":
        issuer = args.issuer.rstrip("/")
        settings["OIDC_CLIENT_ID"] = args.client_id
        connector = maps[prefix + "-connector"]
        config = yaml.safe_load(connector["connector.yaml"])
        profile = config["delegation_profiles"]["enrooted"]
        profile.update(resource_url=args.mcp_url, audience=args.mcp_audience, scopes=args.mcp_scope)
        if args.tenant_claim:
            profile["tenant_claim"] = args.tenant_claim
        connector["connector.yaml"] = yaml.safe_dump(config, sort_keys=False)
    if args.scenario != "basic":
        settings["OIDC_DISCOVERY_URL"] = issuer + "/.well-known/openid-configuration"
    return docs, containers


def podman(*args):
    subprocess.run(["podman", *args], check=True)


def build_images(containers, arch):
    root = HERE.parents[1]
    ui = UI_DIR / "Containerfile"
    options = ["build", "--platform", "linux/" + arch]
    podman(*options, "-t", containers["api"]["image"], "-f", HERE / "Containerfile.api", root)
    podman(
        *options,
        "-t",
        containers["ui"]["image"],
        "--ignorefile",
        str(ui) + ".containerignore",
        "-f",
        ui,
        root,
    )


def untag_source_images(containers, prefix):
    for container in containers:
        image = container["image"]
        if image == f"localhost/enrooted/cuga-{container['name']}:{prefix}" and exists("image", image):
            podman("untag", image, image)


def exists(kind, name):
    result = subprocess.run(["podman", kind, "exists", name])
    if result.returncode not in (0, 1):
        result.check_returncode()
    return result.returncode == 0


def remove_local_files(directory):
    for name in (
        "manifest.yaml",
        "manifest.tmp",
        "prefix",
        "private-network",
        "localhost.pem",
        "owner-password",
        "preview.yaml",
        "preview.tmp",
    ):
        (directory / name).unlink(missing_ok=True)
    if not any(directory.iterdir()):
        directory.rmdir()


def manage_existing_deployment(directory, manifest, scenario, *, stop_only):
    prefix = (directory / "prefix").read_text()
    if not re.fullmatch(rf"cuga-{scenario}-[a-f0-9]{{8}}", prefix):
        sys.exit("Unrecognized local demo identity")
    docs = list(yaml.safe_load_all(manifest.read_text()))
    pod = next(d for d in docs if d["kind"] == "Pod")
    if pod["metadata"]["name"] != prefix + "-pod" or any(
        not d["metadata"]["name"].startswith(prefix + "-") for d in docs
    ):
        sys.exit("The saved manifest contains resources outside this demo.")
    pod_name = pod["metadata"]["name"]
    pod_exists = exists("pod", pod_name)
    if pod_exists:
        podman("pod", "stop", pod_name)
    if stop_only:
        if pod_exists:
            print(f"Stopped {pod_name}. Resume with: podman pod start {pod_name}")
        else:
            print(f"Pod {pod_name} does not exist. Saved deployment files are in {directory}.")
        return
    if pod_exists:
        podman("pod", "rm", pod_name)
    # Also cover interrupted kube play/down and a pod that was manually removed.
    for doc in docs:
        name = doc["metadata"]["name"]
        if doc["kind"] in ("ConfigMap", "PersistentVolumeClaim") and exists("volume", name):
            podman("volume", "rm", name)
    for suffix in ("tls", "trust", "realm", "api-credentials", "db-credentials"):
        name = prefix + "-" + suffix
        if exists("volume", name):
            podman("volume", "rm", name)
        if exists("secret", name):
            podman("secret", "rm", name)
    if (directory / "private-network").exists() and exists("network", prefix):
        podman("network", "rm", prefix)
    untag_source_images(pod["spec"]["containers"], prefix)
    remove_local_files(directory)
    print("Removed this demo's pod, volumes, credentials and local files.")


class ManifestDumper(yaml.SafeDumper):
    """Keep embedded SQL, nginx configuration and SKILL.md readable."""


ManifestDumper.add_representer(
    str, lambda d, s: d.represent_scalar("tag:yaml.org,2002:str", s, style="|" if "\n" in s else None)
)


def run(args):
    root = args.state_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    directory = root / args.scenario
    manifest = directory / "manifest.yaml"
    # Concurrent CLI invocations for different scenarios may proceed independently.
    with (root / (args.scenario + ".lock")).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.cleanup or args.stop:
            if manifest.exists():
                manage_existing_deployment(directory, manifest, args.scenario, stop_only=args.stop)
            elif args.stop:
                print(f"No deployed {args.scenario} demo in {directory}.")
            elif (directory / "preview.yaml").exists():
                (directory / "preview.yaml").unlink()
                if not any(directory.iterdir()):
                    directory.rmdir()
            return
        if manifest.exists() and not args.render_only:
            sys.exit(
                f"A local deployment already exists. Use demo.sh {args.scenario} --cleanup before creating a fresh demo."
            )
        directory.mkdir(exist_ok=True)
        prefix = f"cuga-{args.scenario}-{secrets.token_hex(4)}"
        arch = (
            platform.machine()
            if args.render_only
            else subprocess.check_output(["podman", "info", "--format", "{{.Host.Arch}}"], text=True).strip()
        )
        if args.platform:
            arch = args.platform.split("/")[1]
        docs, containers = render(args, prefix, arch)
        path = directory / ("preview.yaml" if args.render_only else "manifest.yaml")
        content = yaml.dump_all(docs, Dumper=ManifestDumper, sort_keys=False)
        if not args.render_only:
            if args.network and not exists("network", args.network):
                sys.exit(f"Podman network {args.network} does not exist")
            (directory / "prefix").write_text(prefix)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(content)
        tmp.replace(path)
        print(f"Manifest: {path}", flush=True)
        if args.render_only:
            return
        if args.build:
            try:
                build_images(containers, arch)
            except subprocess.CalledProcessError:
                untag_source_images(containers.values(), prefix)
                remove_local_files(directory)
                raise
        elif args.platform:
            for name in ("api", "ui"):
                podman("pull", "--platform", args.platform, containers[name]["image"])
        network = args.network
        if not network:
            network = prefix
            (directory / "private-network").touch()
            podman("network", "create", network)
        provision(args, directory, prefix, args.ui_origin + "/manage")
        podman("kube", "play", "--network", network, str(manifest))
        print(
            f"Chat: {args.ui_origin}/chat\nManage: {args.ui_origin}/manage\nLogs: podman logs -f {prefix}-pod-api"
        )
        if args.scenario == "keycloak":
            print(f"Sign in as owner with the password in {directory / 'owner-password'}")
        if (directory / "localhost.pem").exists():
            print(f"Local HTTPS certificate: {directory / 'localhost.pem'}")
        if args.scenario == "enterprise-rag":
            print(
                f"In Manage add a Streamable HTTP MCP tool at {args.mcp_url} with no static credential, then publish."
            )


if __name__ == "__main__":
    os.umask(0o077)
    try:
        run(arguments())
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))
