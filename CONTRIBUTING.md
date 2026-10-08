# Contributing to ZwoSocial

ZwoSocial exists because modded messengers gave people features the official apps
refused to, and charged for it in privacy — closed-source APKs from strangers,
some with spyware in them, all of them unreadable.

That is the whole point of this project, and it is why the rules below are
strict about a narrow set of things. ZwoSocial has to be the app people can install
*instead of* the sketchy APK. It only earns that by being readable, and by
never shipping the thing the mods shipped.

## Branches

```
your-branch  →  dev  →  main
```

- **`dev`** is where contributions land. Open every pull request against `dev`.
- **`main`** is release state. Only Alexandre Landa, or someone he names,
  pushes or merges there. Pull requests to `main` from anyone else are closed
  without review — not as a judgement on the code, just the wrong door.

Branch names: `feat/…`, `fix/…`, `docs/…`, `chore/…`.

## Before you write code

**Open an issue first, or claim one.** A pull request that arrives with no
issue behind it is hard to accept even when the code is good, because there is
no record of why the change is wanted.

Issues labelled [`good first issue`][gfi] are picked so that the answer already
exists somewhere in the codebase. Say so in a comment before you start, so two
people do not build the same thing.

[gfi]: https://github.com/CreadorLanda/yo/labels/good%20first%20issue

## One issue, one pull request

Each pull request closes one issue and does one thing. A pull request that
fixes a bug and also renames some files and also adds a feature will be asked
to split, because there is no way to accept part of it.

## What a pull request needs

- **It builds and the tests pass.** `bun test`, `bunx tsc --noEmit` and
  `bun run lint` for mobile; `go test ./...`, `go vet ./...` and `gofmt` for
  the server.
- **A test for the behaviour you changed**, where the behaviour is testable.
  Bug fixes especially: a test that fails before your fix and passes after is
  the difference between "fixed" and "fixed for now".
- **A description that says what was wrong**, not just what you did. The commit
  history here explains causes. Match it.
- English, in commits and pull requests.

## The CLA

ZwoSocial is [dual-licensed](./LICENSING.md): AGPL-3.0 for everyone, with a commercial
licence for people who want to keep their source closed.

That model only holds if one party can license the whole codebase. So by
opening a pull request you confirm:

1. You wrote the contribution, or have the right to submit it.
2. You grant Alexandre Landa a perpetual, worldwide, irrevocable right to use,
   modify, and license your contribution **under both the AGPL and the
   commercial licence**.
3. You keep your own copyright. You can use your contribution anywhere else,
   for anything, forever. You are granting a licence, not signing your work
   over.

If you cannot agree to that, do not open a pull request — but do open an issue.
A described bug is worth a lot, and it carries no licensing question.

Contributions from an employer's time may belong to the employer. If that
might be you, check before submitting.

## Security rules

These are not guidelines. Breaking them gets the pull request closed and the
account blocked from the repository, without discussion.

**Never submit:**

- Code that exfiltrates data — sending user content, keys, tokens, contacts,
  location or telemetry anywhere the user did not ask for.
- Spyware, analytics or tracking of any kind, including "anonymous" metrics.
  Not "none that identifies people" — none. This is the exact thing ZwoSocial exists
  to be an alternative to, and a pull request adding it misunderstands the
  project badly enough that it will not be discussed.
- Backdoors, hidden accounts, debug flags that bypass authentication, or
  anything that weakens encryption "temporarily".
- Obfuscated or minified code, encoded blobs, or anything whose behaviour is
  not readable in the diff.
- Dependencies added quietly. A new package in a lockfile is a new party with
  access to everything the app touches — name it in the pull request and say
  why.
- Build scripts, CI steps, or `postinstall` hooks that reach the network.
- Credentials, keys or tokens, including ones you believe are expired or fake.

**Extra scrutiny applies to** anything under `mobile/data/crypto/`,
`server/internal/modules/auth/`, `server/internal/modules/keys/`, and the
notification path. Changes there get read line by line and may take a while.
That is not distrust; it is the only responsible way to review code that
decides who can read a message.

### Reporting a vulnerability

Do not open a public issue. See [SECURITY.md](./SECURITY.md).

## Conduct

Be straight with people. Disagree about the code as much as you like.

Not tolerated: harassment, personal attacks, discrimination, or bringing
someone's private life into a technical discussion. One warning, then removal.

## Review

Alexandre Landa reviews everything that touches `main`. Expect questions, and
expect some pull requests to be rejected even when they work — a feature can be
well built and still not belong in the project.

If a review goes quiet for more than a week, comment on the thread. That is a
lapse, not a verdict.
