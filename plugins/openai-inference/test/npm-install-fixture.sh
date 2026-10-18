#!/usr/bin/env bash
# The npm-install check's fixture for OpenAI-compatible inference (see
# scripts/ci/npm-install-check.sh): starts the fake LiteLLM
# (test/fake-litellm.mjs) as the stub OpenAI-compatible server, saves one
# Endpoint pointing at it with a literal key the way the plugin's page does
# (through the server's RPC route, since the command takes no literal key), then
# requires bb to list that Endpoint as an AI service ready for
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

rpc() {
  local out code
  out=$(curl -sS -w '\n%{http_code}' -X POST -H 'Content-Type: application/json' -d "$2" "$BB_SERVER_URL/api/v1/plugins/$PLUGIN_ID/rpc/$1")
  code=${out##*$'\n'}
  echo "rpc $1 answered HTTP $code: ${out%$'\n'*}" >&2
  [[ $code == 200 ]] && echo "${out%$'\n'*}"
}
draft=$(jq -nc --arg id "$service" --arg url "$url" --arg model "$model" --arg key "$key" \
  '{draft: {id: $id, url: $url, model: $model, key: {kind: "literal", value: $key}}, create: true}')
saved=$(rpc saveEndpoint "$draft") || { echo "::error::the plugin's page could not save the Endpoint" >&2; exit 1; }
if [[ $(jq -r '.result.ok // .ok' <<< "$saved") != true ]]; then
  echo "::error::the plugin's page refused the Endpoint: $saved" >&2
  exit 1
fi
# The literal key is in one file under bb's data directory, readable by its owner alone.
data=$(cd "$FIXTURE_DIR/../bb" && pwd)
holders=$(grep -rlF -- "$key" "$data" 2>/dev/null || true)
keys_file=$data/plugins/$PLUGIN_ID/host-data/keys.json
if [[ $holders != "$keys_file" || $(stat -c %a "$keys_file") != 600 ]]; then
  echo "::error::the literal key is held by: ${holders:-no file} (mode $(stat -c %a "$keys_file" 2>/dev/null || echo none)), not only by $keys_file with mode 600" >&2
  exit 1
fi
bb openai-inference list | grep -q "^$service .*key literal (set)$" \
  || { echo "::error::bb openai-inference list does not show $service with a literal key set" >&2; bb openai-inference list >&2; exit 1; }

# Ready once the host entry has answered for the Endpoint.
tasks_json=$(printf '%s\n' "${tasks[@]}" | jq -Rn '[inputs]')
listed() {
  bb settings ai-services show --json | jq -c --arg id "$service" --arg plugin "$PLUGIN_ID" \
    '.services[] | select(.id == $id and .pluginId == $plugin) | {tasks, status}'
}
ready() {
  [[ $(jq -r --argjson tasks "$tasks_json" '.status.ready and (.tasks as $listed | $tasks | all(. as $t | $listed | index($t) != null))' <<< "${1:-null}") == true ]]
}
for _ in $(seq 30); do
  if ready "$(listed)"; then break; fi
  sleep 1
done
service_line=$(listed)
if ! ready "$service_line"; then
  echo "::error::bb does not list AI service $service as ready for ${tasks[*]}: ${service_line:-not listed}" >&2
  bb settings ai-services show --json >&2
  exit 1
fi
echo "AI service $service: $service_line"

requests() {
  curl -fsS "$admin" || { echo "::error::the stub OpenAI-compatible server stopped answering" >&2; return 1; }
}
for task in "${tasks[@]}"; do
  bb settings ai-services set "$task" "$service" > /dev/null
  before=$(requests | jq length)
  result=$(bb settings ai-services test "$task" --json) || true
  sent=$(requests | jq -c --argjson before "$before" '.[$before:]')
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
  answer=$(jq -r '.reply // empty' <<< "$request")
  if ! jq -e --arg id "$service" --arg answer "$answer" \
    '.ok == true and .serviceId == $id and .text == $answer and $answer != ""' <<< "$result" > /dev/null; then
    echo "::error::$task: bb did not answer with the stub's answer '$answer': $result" >&2
    exit 1
  fi
done
