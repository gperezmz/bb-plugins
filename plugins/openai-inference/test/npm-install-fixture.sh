#!/usr/bin/env bash
# The npm-install check's fixture for OpenAI-compatible inference (see
# scripts/ci/npm-install-check.sh): starts the fake LiteLLM as a stub
# OpenAI-compatible server, sets `endpoints` to one Endpoint pointing at it,
# then requires bb to list that Endpoint as an AI service ready for
# thread-title and commit-message, and to answer each AI task with the text
# the stub sent back for the prompt bb sent it.
set -euo pipefail

service=ci-stub
model=gpt-6-luna
key=sk-ci-stub
tasks=(thread-title commit-message)

node test/fake-litellm.mjs --port 0 --key "$key" > "$FIXTURE_DIR/stub.log" 2>&1 &
stub_pid=$!
trap 'kill "$stub_pid" 2>/dev/null || true' EXIT
url=
for _ in $(seq 30); do
  url=$(sed -n 's/^fake LiteLLM on \(http[^ ]*\) .*/\1/p' "$FIXTURE_DIR/stub.log")
  if [[ -n $url ]]; then break; fi
  sleep 1
done
if [[ -z $url ]]; then
  echo "::error::the stub OpenAI-compatible server did not start" >&2
  cat "$FIXTURE_DIR/stub.log" >&2
  exit 1
fi
admin=${url%/v1}/__admin/requests
echo "Stub OpenAI-compatible server at $url"

bb plugin config "$PLUGIN_ID" set keys "{\"$service\": \"$key\"}" > /dev/null
bb plugin config "$PLUGIN_ID" set endpoints \
  "[{\"id\": \"$service\", \"url\": \"$url\", \"model\": \"$model\"}]" > /dev/null

# Ready once the host entry has answered for the Endpoint.
listed() {
  bb settings ai-services show --json | jq -c --arg id "$service" --arg plugin "$PLUGIN_ID" \
    '.services[] | select(.id == $id and .pluginId == $plugin) | {tasks, status}'
}
for _ in $(seq 30); do
  if [[ $(listed | jq -r '.status.ready and (.tasks | index("thread-title") and index("commit-message"))') == true ]]; then
    break
  fi
  sleep 1
done
service_line=$(listed)
if [[ $(jq -r '.status.ready and (.tasks | index("thread-title") and index("commit-message"))' <<< "${service_line:-null}") != true ]]; then
  echo "::error::bb does not list AI service $service as ready for ${tasks[*]}: ${service_line:-not listed}" >&2
  bb settings ai-services show --json >&2
  exit 1
fi
echo "AI service $service: $service_line"

for task in "${tasks[@]}"; do
  bb settings ai-services set "$task" "$service" > /dev/null
  before=$(curl -fsS "$admin" | jq length)
  result=$(bb settings ai-services test "$task" --json) || true
  sent=$(curl -fsS "$admin" | jq -c --argjson before "$before" '.[$before:]')
  echo "$task: bb answered $(jq -c '{ok, serviceId, text}' <<< "$result")"
  if [[ $(jq length <<< "$sent") -ne 1 ]]; then
    echo "::error::$task: the stub received $(jq length <<< "$sent") requests, not 1: $sent" >&2
    exit 1
  fi
  request=$(jq -c '.[0]' <<< "$sent")
  if ! jq -e --arg model "$model" \
    '.path == "/v1/chat/completions" and .authorized and .body.model == $model
      and (.body.messages[0].content | type == "string" and length > 0)' <<< "$request" > /dev/null; then
    echo "::error::$task: the stub did not receive bb's prompt as a POST /chat/completions for $model: $request" >&2
    exit 1
  fi
  answer=$(jq -r '.answer // empty' <<< "$request")
  if ! jq -e --arg id "$service" --arg answer "$answer" \
    '.ok == true and .serviceId == $id and .text == $answer and $answer != ""' <<< "$result" > /dev/null; then
    echo "::error::$task: bb did not answer with the stub's answer '$answer': $result" >&2
    exit 1
  fi
done
