# worker-kit

Shared helpers for Cloudflare Workers, so every Worker handles Cloudflare's
own transient failures the same way.

- **`retryD1(run, options?)`**: run a D1 statement or batch and retry it on a
  transient D1 error (4 tries, full-jitter backoff capped at 200, 400, 800 ms).
  Only wrap reads and writes that are safe to replay.
- **`isTransientD1Error(error)`**: the one list of D1 messages that clear on
  their own ("Network connection lost", "storage caused object to be reset",
  "internal error; reference = ...", and so on). A new variant gets added here
  once, then every Worker picks it up on the next version bump.
- **`retryDurableObject(run, options?)`** / **`isRetryableDOError(error)`**:
  the same for Durable Object calls, honouring the runtime's `retryable` and
  `overloaded` flags.
- **`retryTransient(run, options)`**: the generic retry loop under both, for
  anything else that is safe to replay (an upstream API, a token mint).
- **`groupCloudflareErrors(event, hint)`**: a Sentry `beforeSend` step. It
  strips Cloudflare's per-occurrence `reference = ...` from the message (kept
  as the `cf_reference` tag) and fingerprints any transient error that survived
  the retries as `cloudflare-transient`. Without it, GlitchTip opened one issue
  per failed request, since every message was unique.

## Install

Public on purpose: no token is needed for `npm ci` in GitHub Actions or
Workers Builds. Pin a tag:

```zsh
npm install github:dryan-org/worker-kit#v0.1.0
```

The package ships TypeScript source (`src/*.ts`). Wrangler's bundler, `tsc`
with `moduleResolution: "Bundler"` and Vitest all read it directly; there is
no build step.

## Use

```ts
import * as Sentry from "@sentry/cloudflare";
import { groupCloudflareErrors, retryD1 } from "@dryan/worker-kit";

const row = await retryD1(() =>
  env.DB.prepare("SELECT * FROM t WHERE id = ?").bind(id).first(),
);

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    beforeSend: groupCloudflareErrors,
  }),
  handler,
);
```

Prepare the statement inside the callback: each retry calls it again, and a
statement from a reset connection is not guaranteed to be reusable.

## Release

Bump `version` in `package.json`, merge, tag `v<version>` on `main`, then
bump the tag in each consumer.

## Develop

```zsh
npm install
npm test
```

## License

[Hippocratic License 3.0](LICENSE.md).
