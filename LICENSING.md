# Licensing

ZwoSocial is dual-licensed. You choose which of the two applies to you.

| | AGPL-3.0 | Commercial |
|---|---|---|
| Price | Free | Negotiated |
| Read, study, modify | Yes | Yes |
| Self-host for yourself | Yes | Yes |
| Sell it, charge for it | **Yes** | Yes |
| Keep your changes private | **No** | Yes |
| Run a modified server as a service | Only if you publish the source | Yes |

## The AGPL option

The full text is in [LICENSE](./LICENSE). The short version:

You can do almost anything, including **charging money for it**. This surprises
people, so it is worth being plain: the AGPL does not restrict commercial use.
You may build a business on ZwoSocial, sell it, run it for paying customers, and never
pay us anything.

What it asks in return is that the source stays open. Specifically:

- If you distribute ZwoSocial, or anything derived from it, you distribute the source
  under the AGPL too.
- **If you run a modified version as a network service, that counts as
  distribution.** Anyone using your service can ask for your source, and you
  have to give it to them. This is section 13, and it is the reason this
  project uses AGPL rather than plain GPL — a messenger is mostly used over a
  network, and under GPL a company could fork the server, change it, host it
  for millions of people, and owe nothing to anyone.

If you are fine with that, you are done. You do not need to contact us, ask
permission, or tell us what you are building.

## The commercial option

The commercial license exists for exactly one situation: **you want to use ZwoSocial
in something whose source you keep closed.**

That includes:

- Shipping a product built on ZwoSocial without publishing your changes.
- Running a modified ZwoSocial server as a service without offering the source to
  your users.
- Taking parts of ZwoSocial — the encryption layer, the call stack, the design
  system — into a proprietary codebase.
- Selling a fork, or pieces of one, under terms other than the AGPL.

If any of those describe you, the AGPL does not permit it and you need a
commercial license.

### How to ask

There is no email address yet. Until there is, **open a GitHub issue** titled
`Commercial licence enquiry` describing what you want to build. We will reply
there and take the details private from that point.

Terms and price are set case by case. They depend on what you are building, at
what scale, and whether you want support along with the licence.

## Why dual licensing works here

Dual licensing only works if one party owns the rights to all of the code.
That is why every contributor signs a [CLA](./CONTRIBUTING.md#the-cla) granting
Alexandre Landa the right to license their contribution under both licences.
Without it, one accepted pull request would make the commercial licence
unofferable — the project could not sell rights it no longer solely held.

The CLA does not take your rights away. You keep the copyright to what you
wrote and can use it anywhere else you like. You are granting a licence, not
signing your work over.

## History

Two things were true here before 2026-08-12, and they contradicted each other.

The README carried an **MIT** badge. Meanwhile `LICENSE`, `LICENSE-GPL.txt` and
`LICENSE-COMMERCIAL.md` described a **GPL + commercial** dual licence for a
different product entirely — "Weavox", with a `skylinetechone.com` contact.
They arrived in a single automated commit on 2026-05-23 and were never about
this project. Someone reading the repository had no way to know which of the
two applied.

Those three files are gone. What replaces them is the same dual model the
Weavox files described — that part was the right idea — but written for ZwoSocial,
and with **AGPL instead of GPL**, because ZwoSocial has a server and plain GPL leaves
that hole open.

The relicense happened while Alexandre Landa was the sole rights holder. The
only other committer in the history is an automated agent operating on his
behalf, and no outside pull request had been merged. Nobody's work was
relicensed without consent, because there was none in the tree to relicense.

---

Nothing on this page is legal advice, and it was not written by a lawyer. If
money is going to change hands over a commercial licence, have one read the
agreement first.
