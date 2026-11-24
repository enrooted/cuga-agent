"""Exercise the public, offline launcher entry point on all three manifests."""

import json
import os
import platform
from pathlib import Path
import subprocess
import sys

import pytest
import yaml


@pytest.mark.unit
@pytest.mark.skipif(os.name != "posix", reason="The Podman launcher targets Linux and macOS")
@pytest.mark.parametrize("scenario", ["basic", "keycloak", "enterprise-rag"])
@pytest.mark.parametrize("build", [False, True])
def test_demo_preview(tmp_path, scenario, build):
    script = Path(__file__).resolve().parents[2] / "deployment/enrooted/demo.sh"
    args = [
        script,
        scenario,
        "--state-dir",
        tmp_path,
        "--render-only",
        "--vllm-uri",
        "https://model.test/v1",
        "--model",
        "served: test",
        "--verify-ssl",
        "false",
    ]
    if build:
        args += ["--build", "--ui-port", "9444"]
    if scenario == "keycloak":
        args += ["--ui-origin", "https://localhost:9444", "--keycloak-port", "9543"]
    if scenario == "enterprise-rag":
        if build:
            args += ["--ui-origin", "https://localhost"]
        args += [
            "--issuer",
            "https://issuer.test/realms/my-realm",
            "--client-id",
            "enterprise-chat",
            "--mcp-url",
            "https://context.test/mcp",
            "--mcp-audience",
            "enterprise-mcp",
            "--mcp-scope",
            "evidence:read",
            "--mcp-scope",
            "extra",
            "--tenant-claim",
            "org",
        ]
    env = dict(os.environ, DEMO_PYTHON=sys.executable, OIDC_CLIENT_SECRET="test-secret-marker")
    subprocess.run(args, check=True, cwd=tmp_path, env=env)
    preview = tmp_path / scenario / "preview.yaml"
    source = preview.read_text()
    assert "test-secret-marker" not in source and "replaceme.example.com" not in source
    assert preview.stat().st_mode & 0o077 == 0
    docs = list(yaml.safe_load_all(source))
    assert len([d for d in docs if d["kind"] == "PersistentVolumeClaim"]) == 2
    settings = next(d["data"] for d in docs if d["metadata"]["name"].endswith("-settings"))
    assert settings["OPENAI_BASE_URL"] == "https://model.test/v1"
    assert settings["MODEL_NAME"] == "served: test"
    assert settings["OPENAI_SSL_VERIFY"] == "false"
    assert settings["DYNACONF_EVOLVE__ENABLED"] == settings["DYNACONF_SKILLS__ENABLED"] == "true"
    assert settings["DYNACONF_STORAGE__MODE"] == "prod"
    # Manage needs the registry to offer "Create agent".
    assert settings["DYNACONF_SUPERVISOR__REGISTRY_ENABLED"] == "true"
    pod = next(d for d in docs if d["kind"] == "Pod")
    containers = {c["name"]: c for c in pod["spec"]["containers"]}
    tag = "demo-mac" if platform.machine().lower() in ("aarch64", "arm64") else "demo"
    for name in ("api", "ui"):
        if build:
            prefix = settings["DYNACONF_SERVICE__INSTANCE_ID"]
            assert containers[name]["image"] == f"localhost/enrooted/cuga-{name}:{prefix}"
            assert containers[name]["imagePullPolicy"] == "Never"
        else:
            assert containers[name]["image"] == f"quay.io/enrooted/cuga-{name}:{tag}"
            assert containers[name]["imagePullPolicy"] == "Always"
    if build:
        assert containers["ui"]["ports"][0]["hostPort"] == 9444
        if scenario != "basic":
            assert settings["OIDC_REDIRECT_URI"] == "https://localhost:9444/manage"
    for c in containers.values():
        assert all(port["hostIP"] == "127.0.0.1" for port in c.get("ports", []))
    assert ("keycloak" in containers) == (scenario == "keycloak")
    assert ("CUGA_DELEGATION_CONFIG" in settings) == (scenario == "enterprise-rag")
    if scenario == "enterprise-rag":
        data = next(d["data"]["connector.yaml"] for d in docs if d["metadata"]["name"].endswith("-connector"))
        profile = yaml.safe_load(data)["delegation_profiles"]["enrooted"]
        assert profile == {
            "resource_url": "https://context.test/mcp",
            "audience": "enterprise-mcp",
            "scopes": ["evidence:read", "extra"],
            "tenant_claim": "org",
            "ca_bundle": "/run/enrooted/ca.pem",
        }
        assert settings["OIDC_CLIENT_ID"] == "enterprise-chat"
        assert settings["OIDC_DISCOVERY_URL"].startswith("https://issuer.test/realms/my-realm/")
    elif scenario == "keycloak":
        assert settings["OIDC_REDIRECT_URI"] == "https://localhost:9444/manage"
        assert settings["OIDC_DISCOVERY_URL"].startswith("https://localhost:9543/")
        assert "--https-port=9543" in containers["keycloak"]["args"]
        assert containers["ui"]["ports"][0]["hostPort"] == 9444
    else:
        assert settings["DYNACONF_AUTH__ENABLED"] == "false"
        if build:
            assert settings["DYNACONF_SERVER_PORTS__DEMO"] == "9444"
            nginx = next(d["data"]["default.conf"] for d in docs if d["metadata"]["name"].endswith("-nginx"))
            assert "proxy_pass http://127.0.0.1:9444;" in nginx
            assert f"listen {containers['ui']['ports'][0]['containerPort']};" in nginx
    subprocess.run([script, scenario, "--state-dir", tmp_path, "--cleanup"], check=True, env=env)
    assert not preview.exists()


@pytest.mark.unit
@pytest.mark.skipif(os.name != "posix", reason="The Podman launcher targets Linux and macOS")
def test_arm64_preview_keeps_explicit_image_override(tmp_path):
    script = Path(__file__).resolve().parents[2] / "deployment/enrooted/demo.sh"
    subprocess.run(
        [
            script,
            "basic",
            "--state-dir",
            tmp_path,
            "--render-only",
            "--platform",
            "linux/arm64",
            "--vllm-uri",
            "https://model.test/v1",
            "--ui-image",
            "localhost/custom:dev",
        ],
        check=True,
        env=dict(os.environ, DEMO_PYTHON=sys.executable),
    )
    docs = yaml.safe_load_all((tmp_path / "basic/preview.yaml").read_text())
    pod = next(d for d in docs if d["kind"] == "Pod")
    images = {c["name"]: c["image"] for c in pod["spec"]["containers"]}
    assert images["api"] == "quay.io/enrooted/cuga-api:demo-mac"
    assert images["ui"] == "localhost/custom:dev"


@pytest.mark.unit
@pytest.mark.skipif(os.name != "posix", reason="The Podman launcher targets Linux and macOS")
def test_source_deploy_builds_both_images_before_play(tmp_path):
    root = Path(__file__).resolve().parents[2]
    demo = [root / "deployment/enrooted/demo.sh", "basic", "--state-dir", tmp_path]
    calls = tmp_path / "calls"
    stub = tmp_path / "podman"
    stub.write_text(
        f"#!{sys.executable}\n"
        "import json, os, sys\n"
        "args = sys.argv[1:]\n"
        "with open(os.environ['TEST_CALLS'], 'a') as log: print(json.dumps(args), file=log)\n"
        "if args[0] == 'info': print('arm64')\n"
        "if args[:2] == ['image', 'exists']: sys.exit(0)\n"
        "if args[1:2] == ['exists']: sys.exit(1)\n"
        "if args[0] == 'build' and 'cuga-ui:' in args[args.index('-t') + 1] and os.getenv('FAIL_BUILD'): sys.exit(1)\n"
    )
    stub.chmod(0o755)
    env = dict(
        os.environ,
        PATH=str(tmp_path) + os.pathsep + os.environ["PATH"],
        DEMO_PYTHON=sys.executable,
        TEST_CALLS=str(calls),
    )
    args = demo + [
        "--build",
        "--platform",
        "linux/arm64",
        "--ui-port",
        "8080",
        "--vllm-uri",
        "http://localhost:9000/v1",
    ]
    failed = subprocess.run(args, cwd=tmp_path, env=dict(env, FAIL_BUILD="1"))
    assert failed.returncode != 0
    manifest = tmp_path / "basic/manifest.yaml"
    assert not manifest.exists()
    assert all(json.loads(line)[0] != "kube" for line in calls.read_text().splitlines())
    calls.unlink()
    subprocess.run(args, check=True, cwd=tmp_path, env=env)
    docs = yaml.safe_load_all(manifest.read_text())
    pod = next(d for d in docs if d["kind"] == "Pod")
    images = {c["name"]: c["image"] for c in pod["spec"]["containers"]}
    commands = [json.loads(line) for line in calls.read_text().splitlines()]
    assert [cmd[0] for cmd in commands] == ["info", "build", "build", "network", "kube", "kube"]
    for cmd, name, file in zip(
        commands[1:3],
        ("api", "ui"),
        ("deployment/enrooted/Containerfile.api", "apps/enrooted-ui/Containerfile"),
    ):
        assert cmd[cmd.index("--platform") + 1] == "linux/arm64"
        assert cmd[cmd.index("-f") + 1] == str(root / file)
        assert cmd[cmd.index("-t") + 1] == images[name]
        assert cmd[-1] == str(root)
    assert commands[2][commands[2].index("--ignorefile") + 1] == str(
        root / "apps/enrooted-ui/Containerfile.containerignore"
    )
    assert commands[-1][-1] == str(manifest)
    subprocess.run(demo + ["--cleanup"], check=True, env=env)
    untags = [cmd for cmd in map(json.loads, calls.read_text().splitlines()) if cmd[0] == "untag"]
    assert untags == [["untag", images[name], images[name]] for name in ("api", "ui")]


@pytest.mark.unit
@pytest.mark.skipif(os.name != "posix", reason="The Podman launcher targets Linux and macOS")
@pytest.mark.parametrize(
    "options",
    [
        ["--ui-port", "0"],
        ["--ui-port", "65536"],
        ["--ui-port", "9443", "--ui-origin", "https://localhost:9444"],
        ["--ui-port", "8543"],
        ["--build", "--api-image", "localhost/custom:dev"],
        ["--build", "--pull-policy", "Always"],
    ],
)
def test_demo_rejects_conflicting_options(tmp_path, options):
    script = Path(__file__).resolve().parents[2] / "deployment/enrooted/demo.sh"
    result = subprocess.run(
        [
            script,
            "keycloak",
            "--render-only",
            "--state-dir",
            tmp_path,
            "--vllm-uri",
            "http://localhost:9000/v1",
            *options,
        ],
        env=dict(os.environ, DEMO_PYTHON=sys.executable),
    )
    assert result.returncode == 2
    assert not (tmp_path / "keycloak/preview.yaml").exists()


@pytest.mark.unit
@pytest.mark.skipif(os.name != "posix", reason="The Podman publisher targets Linux and macOS")
@pytest.mark.parametrize(("arch", "tag"), [("arm64", "demo-mac"), ("amd64", "demo")])
def test_native_publisher_pushes_only_its_two_tags(tmp_path, arch, tag):
    script = Path(__file__).resolve().parents[2] / "deployment/enrooted/publish-images.sh"
    stub = tmp_path / "podman"
    stub.write_text(
        """#!/bin/sh
case "$1" in
    info) echo "$TEST_ARCH" ;;
    build|push)
        printf '%s\\n' "$*" >> "$TEST_CALLS"
        while [ "$#" -gt 0 ]; do
            case "$1" in --iidfile|--digestfile) echo fixture-id > "$2"; break ;; esac
            shift
        done ;;
    run) exit 0 ;;
    *) exit 1 ;;
esac
"""
    )
    stub.chmod(0o755)
    calls = tmp_path / "calls"
    env = dict(
        os.environ,
        PATH=str(tmp_path) + os.pathsep + os.environ["PATH"],
        TEST_ARCH=arch,
        TEST_CALLS=str(calls),
        IMAGE_PREFIX="quay.io/enrooted",
    )
    subprocess.run([script], check=True, env=env)
    commands = [line.split() for line in calls.read_text().splitlines()]
    assert [cmd[0] for cmd in commands] == ["build", "build", "push", "push"]
    assert [cmd[-1] for cmd in commands[2:]] == [
        f"docker://quay.io/enrooted/cuga-{name}:{tag}" for name in ("api", "ui")
    ]
    for cmd in commands[:2]:
        assert cmd[cmd.index("--platform") + 1] == "linux/" + arch
