# Third-party notices

Thread Usage bundles the packages below into `dist/`. The table is generated
by `scripts/third-party-notices.mjs` from the bundle inputs; rerun it after
changing dependencies. Packages bb provides at runtime (React, the Radix
portal families, sonner and others) are not bundled and are not listed.

| Package | Version | Licence | Copyright | Bundled into |
|---|---|---|---|---|
| @get-bb/plugin-sdk | 0.5.29 | MIT | Copyright (c) 2026 Michael Yong (LICENSE of github.com/get-bb/bb, the package's repository) | host |
| @radix-ui/primitive | 1.1.7 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-collection | 1.1.15 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-compose-refs | 1.1.5 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-context | 1.2.2 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-direction | 1.1.4 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-id | 1.1.4 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-primitive | 2.1.10 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-roving-focus | 1.1.19 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-slot | 1.3.3 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-toggle | 1.1.18 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-toggle-group | 1.1.19 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-use-callback-ref | 1.1.4 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-use-controllable-state | 1.2.6 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-use-effect-event | 0.0.5 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-use-is-hydrated | 0.1.3 | MIT | Copyright (c) 2022 WorkOS | app |
| @radix-ui/react-use-layout-effect | 1.1.4 | MIT | Copyright (c) 2022 WorkOS | app |
| cross-spawn | 7.0.6 | MIT | Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio> | host |
| isexe | 2.0.0 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors | host |
| path-key | 3.1.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) | host |
| shebang-command | 2.0.0 | MIT | Copyright (c) Kevin Mårtensson <kevinmartensson@gmail.com> (github.com/kevva) | host |
| shebang-regex | 3.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) | host |
| which | 2.0.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors | host |
| zod | 4.6.5 | MIT | Copyright (c) 2025 Colin McDonnell | host, server |

## Data

`prices/litellm-prices.json` is derived from `model_prices_and_context_window.json`
in [BerriAI/litellm](https://github.com/BerriAI/litellm), MIT licence,
Copyright (c) 2023 Berri AI. Its notice is in `prices/LICENSE-litellm.txt`.

The plugin also fetches [models.dev](https://models.dev)'s `api.json` at
runtime (MIT licence, Copyright (c) 2025 models.dev; the licence text is at
<https://github.com/sst/models.dev/blob/dev/LICENSE>). It is permissive, but
nothing from it is bundled: the data is downloaded to the bb server's plugin
database and is not part of the package.
