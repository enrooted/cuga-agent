#!/bin/sh
# Build both images on this Podman engine and push its own demo tag to Quay.
set -eu

usage() {
    echo "Usage: publish-images.sh [--test] [--tag TAG]"
    echo "Defaults: amd64 -> :demo, arm64 -> :demo-mac. Set IMAGE_PREFIX to change quay.io/enrooted."
    echo "--test (also --demo) runs the browser test before pushing; set CUGA_TEST_CHAT_URL."
}

tag=
browser_test=false
while [ "$#" -gt 0 ]; do
    case "$1" in
        --test|--demo) browser_test=true ;;
        --tag) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; tag=$2; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
    shift
done

cd "$(dirname "$0")/../.."
arch=$(podman info --format '{{.Host.Arch}}')
case "$arch" in
    amd64) native_tag=demo ;;
    arm64) native_tag=demo-mac ;;
    *) echo "Unsupported Podman architecture: $arch" >&2; exit 2 ;;
esac
tag=${tag:-$native_tag}
case "$tag" in
    demo|demo-mac) [ "$tag" = "$native_tag" ] || { echo "Use :$native_tag on $arch." >&2; exit 2; } ;;
esac
if [ "$browser_test" = true ] && [ -z "${CUGA_TEST_CHAT_URL:-}" ]; then
    echo "Set CUGA_TEST_CHAT_URL to your vLLM API base URL for --test." >&2
    exit 2
fi

prefix=${IMAGE_PREFIX:-quay.io/enrooted}
api=${prefix%/}/cuga-api:$tag
ui=${prefix%/}/cuga-ui:$tag
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf 'Building %s and %s for linux/%s\n' "$api" "$ui" "$arch"
podman build --platform "linux/$arch" --pull=always --iidfile "$work/api" -t "$api" -f deployment/enrooted/Containerfile.api .
podman build --platform "linux/$arch" --pull=always --iidfile "$work/ui" -t "$ui" \
    --ignorefile apps/enrooted-ui/Containerfile.containerignore -f apps/enrooted-ui/Containerfile .
api_id=$(cat "$work/api")
ui_id=$(cat "$work/ui")
podman run --rm --network=none --entrypoint /app/.venv/bin/python "$api_id" -c 'import cuga, psycopg, onnxruntime'
podman run --rm --network=none "$ui_id" -v
if [ "$browser_test" = true ]; then
    api_digest=$(podman image inspect --format '{{.Digest}}' "$api_id")
    ui_digest=$(podman image inspect --format '{{.Digest}}' "$ui_id")
    CUGA_TEST_API_IMAGE="${api%:*}@$api_digest" CUGA_TEST_UI_IMAGE="${ui%:*}@$ui_digest" \
        .venv/bin/python -m pytest -q -m manual tests/integration/test_enrooted_ui_demo.py
fi
podman push --digestfile "$work/api.digest" "$api_id" "docker://$api"
printf 'Published %s (%s)\n' "$api" "$(cat "$work/api.digest")"
podman push --digestfile "$work/ui.digest" "$ui_id" "docker://$ui"
printf 'Published %s (%s)\n' "$ui" "$(cat "$work/ui.digest")"
