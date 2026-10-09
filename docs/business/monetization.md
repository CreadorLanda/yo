# How ZwoSocial makes money

Written down because a messenger that has not decided how it pays for itself
decides later, under pressure, and the answer is usually ads.

## The constraint that comes first

ZwoSocial exists because modded messengers sold people's privacy for features. Every
revenue idea below is tested against one question:

> Does this require reading, profiling, or selling what people do in the app?

If yes, it does not happen here — no matter how much money it makes. That rules
out advertising, data brokerage, behavioural profiling, and "anonymised
analytics" sold to anyone. It is also why the technical rule in
[CONTRIBUTING](../../CONTRIBUTING.md#security-rules) is absolute: with no
telemetry in the codebase, an ad product cannot be built later without a very
visible change of direction.

What is left is honest, and smaller: **people pay for things, not with things.**

## 1. Commercial licences

The one already in place. ZwoSocial is [AGPL-3.0](../../LICENSING.md); anyone wanting
to ship it in a closed-source product buys a commercial licence instead.

Who pays: companies embedding ZwoSocial, white-label deployments, anyone taking parts
of the codebase into proprietary software.

This is the cleanest revenue the project has. It touches no user, reads no
message, and the people paying are getting genuine value — the right to not
publish their source.

## 2. Verification and badges

Already specified in [features/badges](../features/badges.md): verification
levels, a monthly or one-time paid badge, and activity badges that cannot be
bought.

Worth being careful about what is being sold. Two different things get called
verification:

- **Identity verification** — proof this account is who it says. Selling this
  is selling a check we perform, and the honest price covers doing the check
  properly. It must never mean "paid, therefore genuine", which is how a
  verification mark becomes worthless.
- **Cosmetic badges** — a colour, a crown, a rare mark. Selling these is
  selling decoration. Nobody is misled and nobody is excluded from anything
  that matters.

Both are fine. **Mixing them is not.** If the same badge means "we checked this
person" and "this person paid us", it means neither.

Activity badges — contributor, bug reporter, game creator — must stay
unpurchasable. Their entire value is that money cannot get them.

## 3. Theme marketplace

[Themes](https://github.com/CreadorLanda/yo/issues/114) are the most
requested customisation and the thing mod users cared about most. A marketplace
where creators sell themes and the platform takes a cut is a natural fit.

Conditions for it to be honest:

- Creators are real people who get paid, with the split stated up front.
- Free themes stay first-class. A store that quietly buries the free ones is an
  ad product wearing a hat.
- Nothing about which themes you install leaves your device beyond what a
  purchase requires.

Note that the current marketplace is [fiction](https://github.com/CreadorLanda/yo/issues/114)
— eight hardcoded packs with invented download counts. It cannot be monetised
until it is real, and inventing numbers on a store people pay into is a
different kind of problem from inventing them in a demo.

## 4. Hosting

ZwoSocial is self-hostable, and that stays true. But most people who want their own
instance do not want to run a VPS, apply migrations, or keep LiveKit alive.

Selling managed hosting to organisations that want a private instance is
straightforward, and it is what the AGPL was chosen to protect: a competitor
can offer the same service, but they have to publish their changes.

## 5. Optional paid capacity

Storage limits, longer media retention, larger file transfers. Ordinary,
understood, and priced against a real cost we actually pay.

The line: **paying must never buy privacy.** Encryption, ghost mode, chat lock
and the rest are not premium tiers. The moment "pay for real privacy" appears
in a pricing table, the project has become the thing it replaced.

## What we will not do

| Not doing | Why |
|---|---|
| Advertising | Requires knowing who you are and what you do |
| Selling data, aggregated or not | The entire premise, inverted |
| Analytics or telemetry SDKs | Banned in CONTRIBUTING, deliberately |
| Paywalling privacy features | Makes safety a class of customer |
| Charging to use the app | It is AGPL; someone would fork it free by Tuesday, correctly |
| Crypto tokens | No |

## Order this should happen in

1. **Commercial licences** — already possible, zero product work.
2. **Hosting** — needs no new code, only an offer and an operator.
3. **Badges** — needs the badges backend, which does not exist yet
   ([#26](https://github.com/CreadorLanda/yo/issues/26)).
4. **Theme marketplace** — needs themes to persist first
   ([#114](https://github.com/CreadorLanda/yo/issues/114)), then a real
   store, then payments.

None of it matters before there are users. This document exists so the answer
is already written when someone offers money for the wrong thing.

---

Not legal or tax advice. Selling licences and subscriptions across borders has
rules, and Angola has its own; talk to an accountant before the first invoice.
