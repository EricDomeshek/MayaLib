# MayaLib

A lightweight, portable reading assistant for academic research: capture what to read, build bibliographic references, take notes while reading, and file and search everything by keywords, notes and full text.

**Status:** design phase. See [`docs/design.md`](docs/design.md).

## Principles

- **Your data is plain files** (Markdown + YAML, plus original PDFs, EPUBs and web snapshots) in cloud storage you already own. It stays usable without MayaLib.
- **No server.** MayaLib is a static web app (PWA). Each device talks directly to your storage provider; the host only serves the app's code.
- **Swappable storage and services.** Google Drive is the first storage provider, behind an interface designed so it can be replaced.
- **Targets:** Mac, iPhone, and Android e-ink readers (Boox).

## No secrets in this repository

This repository is public. It must never contain account credentials, tokens, library folder IDs, or personal data. The only Google identifier the app ships with is its OAuth *client ID*, which is public by design for browser apps. Each user signs in with Google at first launch, and per-device settings stay on the device.
