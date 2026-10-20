"""Pluggable narrative providers.

``deterministic`` (the default) never touches the network. ``github`` calls
GitHub Models. ``foundry`` calls an Azure AI Foundry OpenAI-compatible
endpoint. Any error, missing variable, or unknown provider returns None so
the caller can keep the template.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

GITHUB_URL = "https://models.github.ai/inference/chat/completions"
DEFAULT_GITHUB_MODEL = "openai/gpt-4o-mini"


def provider_name() -> str:
    name = os.environ.get("OTHERPITCH_LLM", "deterministic").strip().lower()
    return name or "deterministic"


def complete(system: str, user: str, timeout: float = 12.0) -> str | None:
    name = provider_name()
    if name in {"deterministic", "template", "offline"}:
        return None
    try:
        if name == "github":
            return _post_chat(_github_request(system, user), timeout)
        if name == "foundry":
            return _post_chat(_foundry_request(system, user), timeout)
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError, json.JSONDecodeError, OSError):
        return None
    return None


def _github_request(system: str, user: str) -> tuple[str, dict, dict]:
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        raise KeyError("GITHUB_TOKEN")
    model = os.environ.get("GITHUB_MODEL", DEFAULT_GITHUB_MODEL).strip() or DEFAULT_GITHUB_MODEL
    url = os.environ.get("GITHUB_MODELS_URL", GITHUB_URL).strip() or GITHUB_URL
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = {"model": model, "temperature": 0.2, "messages": _messages(system, user)}
    return url, headers, body


def _foundry_request(system: str, user: str) -> tuple[str, dict, dict]:
    endpoint = os.environ.get("AZURE_AI_FOUNDRY_ENDPOINT", "").strip().rstrip("/")
    key = os.environ.get("AZURE_AI_FOUNDRY_API_KEY", "").strip()
    model = os.environ.get("AZURE_AI_FOUNDRY_MODEL", "").strip()
    if not endpoint or not key or not model:
        raise KeyError("AZURE_AI_FOUNDRY_ENDPOINT, AZURE_AI_FOUNDRY_API_KEY, AZURE_AI_FOUNDRY_MODEL")
    version = os.environ.get("AZURE_AI_FOUNDRY_API_VERSION", "2024-05-01-preview").strip()
    if endpoint.endswith("/chat/completions"):
        url = endpoint
    else:
        url = f"{endpoint}/chat/completions"
    if "api-version=" not in url:
        join = "&" if "?" in url else "?"
        url = f"{url}{join}api-version={version}"
    headers = {"api-key": key, "Content-Type": "application/json", "Accept": "application/json"}
    body = {"model": model, "temperature": 0.2, "messages": _messages(system, user)}
    return url, headers, body


def _messages(system: str, user: str) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _post_chat(spec: tuple[str, dict, dict], timeout: float) -> str | None:
    url, headers, body = spec
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    choices = payload.get("choices") or []
    if not choices:
        return None
    message = choices[0].get("message") or {}
    text = message.get("content")
    if isinstance(text, str) and text.strip():
        return text.strip()
    return None
