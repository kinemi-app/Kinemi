# Command line

`bin/kinemi.mjs` is the command-line client for a running Kinemi server. It plans a campaign, runs the shots and keeps schedules. This page lists every command.

Run it as `node bin/kinemi.mjs <command>`, or as `kinemi` once the package is linked.

## The server address

The CLI needs a running server, except for `schedule add`, `list`, `print` and `remove`, which only touch a file.

- Every command that talks to a server takes `--base <url>`.
- Without it, the CLI reads `KINEMI_BASE`. Without that, it uses `http://localhost:4321`.
- Against `npm run start`, pass `--base http://localhost:3000`.

## Commands

| Command | What it does |
| --- | --- |
| `kinemi plan --brief "text" [--out plan.json] [--base url]` | Sends the brief to `/api/studio/plan` and prints the shots. `--out` writes them to a file. |
| `kinemi batch --plan plan.json [--concurrency 2] [--base url] [--dry-run]` | Runs the shots in parallel, one status line each. |
| `kinemi run plan.json [--base url]` | Runs the shots one after another and prints the file URL of each. |
| `kinemi status <jobId> [--base url]` | Prints a job's status and its result URL or error. |
| `kinemi schedule add --cron "0 9 * * *" --plan plan.json [--name text] [--base url]` | Saves a schedule and prints its crontab line. |
| `kinemi schedule list` | Lists saved schedules. |
| `kinemi schedule print` | Prints the crontab line of every schedule. |
| `kinemi schedule remove --id <id>` | Removes one schedule. |
| `kinemi schedule run-due [--notify slack,notion,drive]` | Runs every schedule that is due now. |

Run `kinemi help` to print the usage.

## Plans

A plan is a JSON array of shots. `plan --out` writes one. A file of the form `{ "shots": [...] }` also works. Each shot needs a `mode`, a `modelId` and a `prompt`. It may also carry `index`, `title` and `durationS`.

The brief for `plan` must be at least 12 characters.

## Batch and run

- `batch` runs up to `--concurrency` shots at once. The default is 2, and the cap is 8.
- `--dry-run` checks the plan file and prints the modes. It does not contact a server.
- `run` takes the plan as an argument and works through the shots in order.
- A failed shot does not stop the others.
- A job that is not done after 120 seconds is reported as timed out.
- Both commands exit with code 1 if any shot failed or timed out.
- `status` exits with code 1 when the job failed.

## Schedules

Schedules live in `~/.kinemi/schedules.json`. Each one has an id, a five-field cron expression, the absolute path of its plan, a base URL and an optional name.

Kinemi does not install anything into your crontab. `schedule add` and `schedule print` show the line, and you add it yourself. The line runs `batch` and appends its output to `~/.kinemi/<id>.log`.

`schedule run-due` is the other route. Call it from cron once a minute. It runs every schedule whose cron expression matches the current time, using each schedule's own base URL.

With `--notify`, it then posts the finished jobs to the targets you name: `slack`, `notion` or `drive`. A target that is not configured is skipped with a message. Notify needs Node.js 22.18 or newer.

## Examples

Plan a campaign and check the file:

```bash
node bin/kinemi.mjs plan --brief "a night drive through Tokyo in the rain" --out plan.json
node bin/kinemi.mjs batch --plan plan.json --dry-run
```

Render it against a production start, two shots at a time:

```bash
node bin/kinemi.mjs batch --plan plan.json --concurrency 2 --base http://localhost:3000
```

Check one job:

```bash
node bin/kinemi.mjs status 3f9c1d0e-0000-4000-8000-000000000000 --base http://localhost:3000
```

Run a plan every morning at 9:

```bash
node bin/kinemi.mjs schedule add --cron "0 9 * * *" --plan plan.json --name morning --base http://localhost:3000
node bin/kinemi.mjs schedule list
node bin/kinemi.mjs schedule remove --id 1a2b3c4d
```

## Related

- [Getting started](getting-started.md)
- [Studio guide](studio.md)
- [Architecture](architecture.md)
- [Development](development.md)
- [Back to the README](../README.md)
