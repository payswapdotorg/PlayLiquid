# RW-003 clean-profile fixture

The clean-profile "seed" is deliberately EMPTY: the harness creates fresh
`HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_RUNTIME_DIR`
and `TMPDIR` directories per run (see `src/harness/launcher.mjs`,
`makeCleanProfile`), and the packaged application creates its own first-run
state inside them.

No profile data is ever copied in — this is what makes every run a true
first-run/no-data test (RW-003 requirement). The `clean-profile-startup`
check verifies the app actually created its state in the fresh directories.

If a future scenario needs a seeded profile (e.g. "data present" state), it
must be added here as an explicit, documented fixture — never an ad-hoc copy
of a developer profile.
