"""Pluggable explanation providers with a deterministic fallback.

``deterministic`` (default) never touches the network. ``foundry`` calls an Azure AI
Foundry OpenAI-compatible chat endpoint. ``openai_compatible`` calls any
OpenAI-compatible chat endpoint. Missing config, errors or unknown providers return
None, so callers keep the template text. GitHub Models is not supported: the service
was retired on 2026-07-30. Keys are read from the environment and never logged.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

OFFLINE = {"deterministic", "template", "offline", ""}


def provider_name() -> str:
    return os.environ.get("OTHERPITCH_LLM", "deterministic").strip().lower() or "deterministic"


def model_id() -> str:
    name = provider_name()
    if name == "foundry":
        return os.environ.get("AZURE_AI_FOUNDRY_MODEL", "").strip() or "unset"
    if name == "openai_compatible":
        return os.environ.get("OTHERPITCH_LLM_MODEL", "").strip() or "unset"
    return "deterministic-template"


def last_error() -> str:
    return _LAST_ERROR[0]


_LAST_ERROR = [""]


def complete(system: str, user: str, timeout: float = 12.0) -> str | None:
    name = provider_name()
    _LAST_ERROR[0] = ""
    if name in OFFLINE:
        return None
    try:
        if name == "foundry":
            return _post_chat(_foundry_request(system, user), timeout)
        if name == "openai_compatible":
            return _post_chat(_openai_request(system, user), timeout)
        _LAST_ERROR[0] = f"unknown provider {name!r}"
    except KeyError as exc:
        _LAST_ERROR[0] = f"missing configuration: {exc.args[0]}"
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError, OSError) as exc:
        _LAST_ERROR[0] = f"{type(exc).__name__}"
    return None


def _foundry_request(system: str, user: str) -> tuple[str, dict, dict]:
    endpoint = os.environ.get("AZURE_AI_FOUNDRY_ENDPOINT", "").strip().rstrip("/")
    key = os.environ.get("AZURE_AI_FOUNDRY_API_KEY", "").strip()
    model = os.environ.get("AZURE_AI_FOUNDRY_MODEL", "").strip()
    if not endpoint or not key or not model:
        raise KeyError("AZURE_AI_FOUNDRY_ENDPOINT, AZURE_AI_FOUNDRY_API_KEY, AZURE_AI_FOUNDRY_MODEL")
    version = os.environ.get("AZURE_AI_FOUNDRY_API_VERSION", "2024-05-01-preview").strip()
    url = endpoint if endpoint.endswith("/chat/completions") else f"{endpoint}/chat/completions"
    if "api-version=" not in url:
        url = f"{url}{'&' if '?' in url else '?'}api-version={version}"
    headers = {"api-key": key, "Content-Type": "application/json", "Accept": "application/json"}
    return url, headers, {"model": model, "temperature": 0.2, "messages": _messages(system, user)}


def _openai_request(system: str, user: str) -> tuple[str, dict, dict]:
    base = os.environ.get("OTHERPITCH_LLM_BASE_URL", "").strip().rstrip("/")
    key = os.environ.get("OTHERPITCH_LLM_API_KEY", "").strip()
    model = os.environ.get("OTHERPITCH_LLM_MODEL", "").strip()
    if not base or not key or not model:
        raise KeyError("OTHERPITCH_LLM_BASE_URL, OTHERPITCH_LLM_API_KEY, OTHERPITCH_LLM_MODEL")
    url = base if base.endswith("/chat/completions") else f"{base}/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", "Accept": "application/json"}
    return url, headers, {"model": model, "temperature": 0.2, "messages": _messages(system, user)}


def _messages(system: str, user: str) -> list[dict[str, str]]:
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _post_chat(spec: tuple[str, dict, dict], timeout: float) -> str | None:
    url, headers, body = spec
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    choices = payload.get("choices") or []
    if not choices:
        return None
    text = (choices[0].get("message") or {}).get("content")
    return text.strip() if isinstance(text, str) and text.strip() else None
