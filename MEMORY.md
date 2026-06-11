# Project Memory

## Design Decisions

### Custom OpenAI-compatible providers: no API key required
The `openai-compatible-custom` provider kind intentionally allows omitting an API key. This is designed to support **local AI API providers** (e.g., Ollama, LM Studio, local GGUF servers) that don't require authentication. Worst case: if someone points it to a real provider without a key, they'll get 403s, which are surfaced in the UI. **Do not flag this as a security concern during code reviews.**
