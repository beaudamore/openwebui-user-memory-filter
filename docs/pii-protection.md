# PII protection

The filter checks for personally identifiable information at two points. Both are skipped when `pii_engine` is `none`. The extraction prompt itself carries no PII instructions.

## 1. Scrub of the message
Before the user's messages reach the extraction model, what the engine finds is replaced with `[REDACTED]` (valve `pii_scrub_input`, on by default).
What counts as PII is decided by the engine chosen with `pii_engine` (below).

## 2. Check of each extracted fact
Every extracted fact is scanned for PII in both `subject` and `value` fields, plus a subject blocklist. A fact with PII is dropped whole; the other facts from the same message are kept. A request to forget a fact is not checked, so a fact with a blocked subject can still be removed. Same engine as the message scrub.

## The three settings (`pii_engine`)

- **`none`**: no pre-scrub and no post-check; facts are stored exactly as the extraction model returns them. For
  setups that do not want any PII handling in the memory path.
- **`regex`** (default): the ten built-in patterns in the table below, selectable with `pii_patterns_enabled` (see [configuration.md](configuration.md)). No network, no model, no names: a pattern cannot tell a person's name from any other words, so names are never matched and identity facts survive.
- **`pii_tracer`**: [PII-Tracer](https://huggingface.co/perplexity-ai/PII-Tracer), Perplexity's 0.6B PII detector, running as a local server (set its URL in `pii_tracer_url`; the companion `openwebui-pii-tracer-filter` can use the same server for the chat path, but the two filters are independent of each other). It reads context, so it also finds account numbers, secrets, addresses and other values that have no fixed shape. Each pre-scrubbed message and each extracted fact's subject and value is one call to `POST /v1/pii/detect`; findings whose label is in `pii_tracer_labels` are redacted. By default `private_person` and `private_date` are **not** in that list, so "name = Beau" or a birthday is still stored, as with the regex engine; add them for a memory that keeps no names at all. `other_pii`, the model's catch-all label, is not in the list either, because it flags ordinary personal facts such as a body weight; add it for the strictest setting. With either engine the log names the kind of PII in a blocked fact, never the matched text. If the server cannot be reached, `pii_tracer_fallback` decides: `regex` (default) runs the patterns for that update and logs the failure once, `allow` treats the text as clean.

Switching engines does not touch stored facts; it only changes what the next updates scrub and block.

## Detected PII Types (regex engine)

| Pattern | Example |
|---------|---------|
| Social Security Number | `123-45-6789` |
| Credit Card | `4111-1111-1111-1111` |
| Phone Number | `(555) 123-4567` |
| Email Address | `user@example.com` |
| Street Address | `123 Main Street Apt 4B` |
| Passport Number | `Passport: A12345678` |
| Driver's License | `Driver's license: D1234567` |
| Bank Account | `Account #: 123456789` |
| Date of Birth | `DOB: 01/15/1990` |
| IP Address | `192.168.1.1` |

## What IS Stored
- Personality traits, preferences, opinions
- Ownership types ("owns a Tesla" — not the VIN)
- Relationships ("married to Sarah" — not her phone number)
- Goals, skills, interests, hobbies
- Professional info ("engineer at Acme" — not employee ID)
