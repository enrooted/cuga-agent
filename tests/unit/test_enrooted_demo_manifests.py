"""Exercise the public, offline launcher entry point on all three manifests."""

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
def test_demo_preview(tmp_path, scenario):
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
    if scenario == "keycloak":
        args += ["--ui-origin", "https://localhost:9444", "--keycloak-port", "9543"]
    if scenario == "enterprise-rag":
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
    pod = next(d for d in docs if d["kind"] == "Pod")
    containers = {c["name"]: c for c in pod["spec"]["containers"]}
    tag = "demo-mac" if platform.machine().lower() in ("aarch64", "arm64") else "demo"
    for name in ("api", "ui"):
        assert containers[name]["image"] == f"quay.io/enrooted/cuga-{name}:{tag}"
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
