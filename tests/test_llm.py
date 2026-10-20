"""Narrative providers stay offline unless configured, and fail closed."""

from otherpitch.llm import _foundry_request, _github_request, complete


def test_default_provider_does_not_call_out(monkeypatch):
    monkeypatch.setenv("OTHERPITCH_LLM", "deterministic")
    assert complete("system", "user") is None


def test_unknown_provider_returns_none(monkeypatch):
    monkeypatch.setenv("OTHERPITCH_LLM", "mystery")
    assert complete("system", "user") is None


def test_github_without_token_returns_none(monkeypatch):
    monkeypatch.setenv("OTHERPITCH_LLM", "github")
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    assert complete("system", "user") is None


def test_github_request_uses_the_models_endpoint(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    monkeypatch.delenv("GITHUB_MODELS_URL", raising=False)
    url, headers, body = _github_request("system", "user")
    assert url == "https://models.github.ai/inference/chat/completions"
    assert headers["Authorization"] == "Bearer test-token"
    assert body["messages"][0]["role"] == "system"


def test_foundry_request_documents_its_env(monkeypatch):
    monkeypatch.setenv("AZURE_AI_FOUNDRY_ENDPOINT", "https://example.openai.azure.com/openai/deployments/demo")
    monkeypatch.setenv("AZURE_AI_FOUNDRY_API_KEY", "key")
    monkeypatch.setenv("AZURE_AI_FOUNDRY_MODEL", "gpt-4o")
    monkeypatch.setenv("AZURE_AI_FOUNDRY_API_VERSION", "2024-05-01-preview")
    url, headers, body = _foundry_request("system", "user")
    assert url.startswith("https://example.openai.azure.com/")
    assert "api-version=2024-05-01-preview" in url
    assert headers["api-key"] == "key"
    assert body["model"] == "gpt-4o"


def test_foundry_missing_env_returns_none(monkeypatch):
    monkeypatch.setenv("OTHERPITCH_LLM", "foundry")
    monkeypatch.delenv("AZURE_AI_FOUNDRY_ENDPOINT", raising=False)
    monkeypatch.delenv("AZURE_AI_FOUNDRY_API_KEY", raising=False)
    monkeypatch.delenv("AZURE_AI_FOUNDRY_MODEL", raising=False)
    assert complete("system", "user") is None
