# Kaya Suites — Documentation

This directory contains the documentation for Kaya Suites. The project is Apache 2.0 throughout; there is no separate enterprise/BSL tier in this repository.

## Contents

| Document | Description |
|---|---|
| [Architecture](architecture.md) | System overview, crate map, two-build-system layout |
| [Agent architecture](agent/architecture.md) | Orchestrator / Researcher / Editor pipeline, tool isolation, SSE contract |
| [Storage adapter](storage-adapter.md) | `StorageAdapter` trait, domain types, SQLite / Postgres / MySQL backends |
| [Auth adapter](auth-adapter.md) | `AuthAdapter` trait and the current adapter scaffolds |
| [LLM provider](llm-provider.md) | `LlmProvider` trait, `ModelRouter`, routing config, adding providers |
| [API codegen](api-codegen.md) | OpenAPI schema → TypeScript client pipeline |
| [Packages](packages.md) | Frontend workspace packages (`@kaya/*`) |
| [Building](building.md) | Build commands for frontend, backend, and the embedded OSS binary |
| [License](license.md) | Licensing notes |
