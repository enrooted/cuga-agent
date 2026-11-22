"""Verify the public API route table assembled at process startup."""

import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.unit
@pytest.mark.parametrize("ui_enabled", [True, False], ids=["default-ui", "api-only"])
def test_public_server_routes(tmp_path, ui_enabled):
    # Import the application in a fresh process so both configurations exercise
    # the production route registration without disturbing other tests' routes.
    env = os.environ | {"CUGA_DBS_DIR": str(tmp_path), "DYNACONF_AUTH__ENABLED": "true"}
    env.pop("DYNACONF_UI__ENABLED", None)
    if not ui_enabled:
        env["DYNACONF_UI__ENABLED"] = "false"
    subprocess.run([sys.executable, __file__, str(tmp_path), str(ui_enabled)], env=env, check=True)


def check_routes(root, ui_enabled):
    from fastapi.testclient import TestClient
    from cuga.backend.server.main import app, app_state

    (root / "index.html").write_text("CUGA web page")
    (root / "bundle.js").write_text("CUGA asset")
    (root / "flow.html").write_text("CUGA flow")
    app_state.STATIC_DIR_HTML = app_state.STATIC_DIR_FLOWS = str(root)
    client = TestClient(app)
    for path in (
        "/",
        "/chat",
        "/manage",
        "/index.html",
        "/bundle.js",
        "/flows/flow.html",
        "/docs",
        "/redoc",
        "/docs/oauth2-redirect",
    ):
        response = client.get(path)
        assert response.status_code == (200 if ui_enabled else 404), path
        if not ui_enabled:
            assert response.json() == {"detail": "Not Found"}, path

    assert client.get("/health").status_code == 200
    schema = client.get("/openapi.json").json()["paths"]
    assert "/stream" in schema and "/api/manage/config" in schema
    assert ("/{full_path}" in schema) == ui_enabled
    assert client.post("/stream", json={"query": "hello"}).status_code == 401
    assert client.post("/auth/callback", json={}).status_code == 400


if __name__ == "__main__":
    check_routes(Path(sys.argv[1]), sys.argv[2] == "True")
