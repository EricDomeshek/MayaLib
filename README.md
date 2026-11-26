# MayaLib

A lightweight, portable reading assistant for academic research: capture what to read, build bibliographic references, take notes while reading, and file and search everything by keywords, notes and full text.

**Status:** design phase. See [`docs/design.md`](docs/design.md).

## Principles

- **Your data is plain files** (Markdown + YAML, plus original PDFs, EPUBs and web snapshots) in cloud storage you already own. It stays usable without MayaLib.
- **No server.** MayaLib is a static web app (PWA). Each device talks directly to your storage provider; the host only serves the app's code.
- **Swappable storage and services.** Google Drive is the first storage provider, behind an interface designed so it can be replaced.
- **Targets:** Mac, iPhone, and Android e-ink readers (Boox).

## No secrets or account information in this repository

This repository is public. It must never contain credentials, tokens, OAuth client IDs, library folder IDs, or personal data.

- **Deployment configuration** (such as the Google OAuth client ID) is supplied at build time from GitHub Actions variables or an uncommitted `config.local.json`, never from committed files.
- **Each deployment uses its own Google Cloud project and OAuth client.** If you run your own copy of MayaLib, register your own client ID rather than signing in through someone else's deployment.
- **Each user signs in with Google** at first launch on each device. Per-device settings (account hint, library folder) stay on that device.

## License

Licensed under the [Apache License, Version 2.0](LICENSE). Copyright 2026 Eric Domeshek.

MayaLib is provided **"as is", without warranties or conditions of any kind**, and the authors accept no liability for damages arising from its use, including loss of data (see sections 7 and 8 of the license). Keep your own backups of your library.
