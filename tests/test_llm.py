"""Explanation providers stay offline unless configured, and fail closed."""

from otherpitch import llm
from otherpitch.llm import _foundry_request, _openai_request, complete


def test_default_provider_does_not_call_out(monkeypatch):
    monkeypatch.setenv("OTHERPITCH_LLM", "deterministic")
    assert complete("system", "user") is None
    assert llm.model_id() == "deterministic-template"


def test_unknown_provider_returns_none(monkeypatch):
    monkeypatch.setenv("OTHERPITCH_LLM", "mystery")
    assert complete("system", "user") is None
    assert "unknown provider" in llm.last_error()


def test_github_models_is_not_a_provider(monkeypatch):
    monkeypatch.setenv("OTHERPITCH_LLM", "github")
    monkeypatch.setenv("GITHUB_TOKEN", "x")
    assert complete("system", "user") is None
    assert not hasattr(llm, "_github_request")


def test_foundry_missing_config_is_clear_and_keyless(monkeypatch):
    monkeypatch.setenv("OTHERPITCH_LLM", "foundry")
    for k in ("AZURE_AI_FOUNDRY_ENDPOINT", "AZURE_AI_FOUNDRY_API_KEY", "AZURE_AI_FOUNDRY_MODEL"):
        monkeypatch.delenv(k, raising=False)
    assert complete("s", "u") is None
    assert "missing configuration" in llm.last_error()


def test_foundry_request_shape(monkeypatch):
    monkeypatch.setenv("AZURE_AI_FOUNDRY_ENDPOINT", "https://example.services.ai.azure.com/models")
    monkeypatch.setenv("AZURE_AI_FOUNDRY_API_KEY", "k")
    monkeypatch.setenv("AZURE_AI_FOUNDRY_MODEL", "m")
    url, headers, body = _foundry_request("s", "u")
    assert url.startswith("https://example.services.ai.azure.com/models/chat/completions?api-version=")
    assert headers["api-key"] == "k" and body["model"] == "m"


def test_openai_compatible_request_shape(monkeypatch):
    monkeypatch.setenv("OTHERPITCH_LLM_BASE_URL", "https://api.example.com/v1")
    monkeypatch.setenv("OTHERPITCH_LLM_API_KEY", "k")
    monkeypatch.setenv("OTHERPITCH_LLM_MODEL", "m")
    url, headers, _ = _openai_request("s", "u")
    assert url == "https://api.example.com/v1/chat/completions" and headers["Authorization"] == "Bearer k"
