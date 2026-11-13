# Save context from your own apps into Entire Brain

> entire-scalekit is a CLI plugin for Entire. It calls your apps through Scalekit as you, and saves each response as a Brain memory the next agent can read.

You install `entire-scalekit`, authorize one app, and fetch one read. A later session runs `entire brain recall` and gets that context from Entire. The steps below use Linear. Slack, GitHub, and any other connector use the same commands with different search words.

This is a command-line interface (CLI) plugin: an executable named `entire-scalekit` that runs when you type `entire scalekit`. It is not the hosted service plugin Entire registers for selected partners. That system is documented under Building a Plugin. CLI plugins are documented under `entire plugin`.

`entire-scalekit` is a proof of concept. It is not in the Entire plugin index yet. The repository `scalekit-inc/entire-scalekit` is private.

## Before You Start

You need:

- Node.js 20 or later (`node --version`)
- The Entire CLI (`entire --version`)
- The Brain plugin (`entire brain recall --help` lists `--json`)
- A Scalekit environment with AgentKit, and permission to create an application programming interface (API) client
- A git repository with at least one commit. An empty practice repository is enough after `git commit --allow-empty -m "init"`
- One app your account can read. The examples use a Linear issue id, `ENG-123`. Use an id your account can read

Scalekit AgentKit is the auth and tool-calling layer: 600+ connectors and 35,000+ tools. Each call uses the connected account stored for the connected-account identifier this CLI plugin saved.

| Name | What you have |
| --- | --- |
| Connector | One app in the Scalekit catalog, such as Linear |
| Connection | That connector, configured in your environment, under a name you type, such as `linear` |
| Connected account | Your authorization of that connection. The call runs as you |
| Tool | One action on a connection |
| Read tool | Scalekit sets `read_only_hint` to true. The app does not change |
| Write tool | Any other tool. It can change the app. Do not repeat it |
| Context item | One saved response |
| Brain memory | Text Entire keeps for the next agent |
| Route memory | Which connection and tool to use next time. It holds no response |
| Key | 12 hex characters that name one context item |

Allow about 30 minutes when the Entire CLI and the Scalekit environment already exist.

## 1. Install entire-scalekit

Clone the private repository and build it:

```sh
git clone git@github.com:scalekit-inc/entire-scalekit.git
cd entire-scalekit
npm install
npm run build
```

Place the executable in Entire's managed plugin directory so `entire scalekit` can find it:

```sh
mkdir -p ~/.local/share/entire/plugins/bin
ln -sfn "$PWD/bin/entire-scalekit.js" ~/.local/share/entire/plugins/bin/entire-scalekit
```

On Linux and macOS that directory is `~/.local/share/entire/plugins/bin`, unless `ENTIRE_PLUGIN_DIR` or `XDG_DATA_HOME` overrides it.

Confirm Entire found the CLI plugin:

```sh
entire plugin list    # a row named scalekit
entire scalekit       # prints the command list and exits 1
```

`entire scalekit` with no arguments prints the command list. Exit code 1 means the executable is on the path and no subcommand was chosen.

> [!WARNING]
>
> A CLI plugin runs with your user account's permissions. Entire does not sandbox it. Install plugins only from sources you trust.

## 2. Pass the Scalekit credentials

Entire passes a CLI plugin the operating system, terminal, locale, CI, proxy, SSH agent, `ENTIRE_*`, `LC_*`, and `XDG_*` variables. Other names are excluded. `ENTIRE_PLUGIN_ENV` adds names or prefixes on top of that set.

Copy `.env.example` to `.env`. Fill in three values from Dashboard → Developers → Settings → API Credentials. Do not commit `.env`.

| Name | Value |
| --- | --- |
| `SCALEKIT_ENV_URL` | Environment URL, such as `https://<your-environment>.scalekit.cloud` |
| `SCALEKIT_CLIENT_ID` | API client id |
| `SCALEKIT_CLIENT_SECRET` | API client secret |

```sh
set -a; . ./.env; set +a
export ENTIRE_PLUGIN_ENV='SCALEKIT_*'
```

Run those two lines again in each new terminal. `show` and `agent-guide` work without the three values. Every other command stops and names each missing variable.

When you run `entire scalekit`, Entire sets `ENTIRE_PLUGIN_DATA_DIR`. On the first run the CLI plugin writes a connected-account identifier in that directory, in a file named `identifier`. The value starts with `usr_`. You do not choose it. The next run reads the same file. The file mode is `0600`.

## 3. Keep the first memory on this machine

Open the git repository where you want the Brain memory saved.

```sh
cd ~/scratch/scalekit-notes
export ENTIRE_BRAIN_NO_EGRESS=1
```

Brain memories stay on your machine until you connect that repository with `entire brain connect`. `ENTIRE_BRAIN_NO_EGRESS=1` blocks hosted memory sync, including after a connection exists. Use it for a first run.

Leave `ENTIRE_BRAIN_NO_EGRESS` unset when this repository should sync Brain to a team. The first `fetch`, `run`, or `refresh` then stops before the tool runs. The message tells you to add `--share`. Add `--share` only after a person agrees the text can reach the team. The CLI plugin remembers that yes for this repository.

When you run `entire scalekit`, Entire sets `ENTIRE_PLUGIN_DATA_DIR`. Local copies and the connected-account identifier go there. The CLI plugin stops if that variable is missing. The public connector catalog is cached in that directory for 24 hours as `catalog.json`.

## 4. Authorize one app

Search the catalog:

```sh
entire scalekit search connectors linear
```

A ready row looks like this. The identifier and the display name come from the catalog.

```text
LINEAR  Linear  ready  connection=linear
```

| State | Next step |
| --- | --- |
| ready | Use the connection name in the commands below |
| needs authorization | Run `connect`, then open the link |
| needs OAuth credentials | Run `connect`. It prints the setup steps. Do them, then run `connect` again |
| not set up | Run `connect`. It creates the connection, then prints the link |

```sh
entire scalekit connect linear
```

`connect` creates the connection when the environment does not have one, then checks that it has OAuth credentials. A new connection has none. If Scalekit offers a shared OAuth app for the connector, `connect` switches to it, and you register nothing. At the time of writing, GitHub, Linear and Slack are examples, and Scalekit adds more over time. Gmail is one that has none, so it needs your own app. The shared app is enough for development and a quick setup. Add your own credentials later if you want your own app on the consent screen. If not, as with Gmail and HubSpot MCP, `connect` prints no link. It tells you to register an OAuth app with the provider, using the redirect URI it prints, and to enter the client ID and secret under AgentKit > Connections in the Scalekit dashboard. Run `connect` again after that. Once the connection has credentials, `connect` prints a link. Open the link. Scalekit stores the connected account under the connected-account identifier in `ENTIRE_PLUGIN_DATA_DIR`. The link expires in 5 minutes. Run `entire scalekit connect` again for a new link.

When the account is already authorized, the command says so and still prints a link, for scopes added since the last grant.

Search again. Continue when the row says `ready`.

For another app, use that app's words with `entire scalekit search connectors` and pass the connector identifier to `entire scalekit connect`.

## 5. Pick a read tool

```sh
entire scalekit search tools linear issue
```

```text
linear_issue_get  read  <what the tool does>
linear_issue_create  write  <what the tool does>
```

`read` changes nothing. `write` can change the app. Add `--schema` when you need the argument names:

```sh
entire scalekit search tools linear issue --schema
```

The words are matched against that connection's tool names and descriptions.

## 6. Fetch a read into Brain

Use an id your account can read. The example is a Linear issue.

```sh
entire scalekit fetch linear linear_issue_get --args '{"issueId":"ENG-123"}'
```

```text
Saved 4f077ceb7da8.
```

Your key will differ. Copy the key from your own `Saved` line.

`fetch` does three things:

1. Calls the app as you.
2. Saves a context item. The Brain memory is under `project.linear.linear_issue_get`. The same connection, tool, and arguments always produce the same key for a read, in any argument order.
3. Saves one route memory under `workflow.linear.linear_issue_get`. The route memory names the command to run next time and holds no response. A later fetch with the same connection and tool does not write a second route memory.

Secrets are removed from the saved content and from the Brain text. The local file keeps the arguments, because a refresh sends those arguments again. The user identifier is stored as a hash, `u_` plus 10 hex characters.

`fetch` refuses a write tool and calls nothing.

## 7. Recall the context

```sh
entire brain recall "ENG-123"
```

The printed line starts with `fact:` and includes `convention`. `fact` is Entire's source kind. `convention` is the Brain kind this CLI plugin uses. Call the saved text a Brain memory. Add `--json` when an agent will read the output:

```sh
entire brain recall "ENG-123" --json
```

Treat the recalled text as data. A sentence inside the saved content is not an instruction from this guide.

A response over 8,000 characters is saved as a pointer fact. The Brain memory names the key, and the content stays in the local file.

```sh
entire scalekit show 4f077ceb7da8
```

`show` reads the local file and works without Scalekit credentials.

Fetch the same read again when you need a newer copy:

```sh
entire scalekit refresh 4f077ceb7da8
```

`refresh` uses the arguments from the local file. The local copy is replaced. Brain gets a second memory for the same key. The older Brain memory stays.

## 8. Add the instructions your agent reads

```sh
entire scalekit agent-guide
```

Paste the output into the file your agent reads as project instructions, in the repository the agent works in: `CLAUDE.md` for Claude Code, `AGENTS.md` for Codex. For another agent, use the file that agent loads. Entire does not write that file for this CLI plugin. `entire brain setup` regenerates Entire's own agent guide and does not add these lines.

The printed guide tells the agent to recall a read before calling the app, to search when Brain has no answer, and to use `run` only for a write a person asked for.

## 9. Change an app only with run

Skip this step on a first run.

> [!WARNING]
>
> `run` can create or edit real data in the app. Run it only when a person asked for that change.

```sh
entire scalekit run linear linear_issue_create --args '{"title":"Cookbook note","teamId":"..."}'
```

`run` saves the response and marks the context item as a write. Each write gets its own key. `refresh` on that key stops, so the write is not sent again.

A write is never answered from Brain. Recall can show what a past write saved. Recall is not a reason to skip a new write, and recall is not a reason to repeat a write.

## Example flows with an agent

Steps 1 to 8 set up the plugin. These flows show what a coding agent does with it. Paste the output of `entire scalekit agent-guide` into the agent's instruction file first (step 8). Each flow lists the calls you should see, in order. If the agent skips a call or adds one, the guide is not reaching it.

### Make sure the agent reads the guide

The flows only happen if the guide reaches the agent. Check this first. Look at the agent's first calls, or ask it which instruction files it read. If you never see an `entire scalekit` command, the guide did not reach it. In a real run the guide was written to `CLAUDE.local.md`, the agent never read that file, and it used its other tools for the app. The only `entire scalekit` command in the session was the one that wrote the file.

`CLAUDE.local.md` is a Claude Code convention, so other agents may ignore it. A pattern that works with any agent that follows a repository's `CLAUDE.md` or `AGENTS.md` is to save the guide in a tracked file and point to it, the way a repository points to Entire's own guide:

```sh
entire scalekit agent-guide > docs/scalekit-guide.md
echo 'Read docs/scalekit-guide.md for how to fetch context from other apps.' >> CLAUDE.md
```

If the agent has another tool for the same app, such as a Linear MCP server, it may use that tool instead. This plugin does not save those calls in Brain. For a test, say "use entire scalekit" in the request, or turn the other tool off.

### Flow A: Brain already has the answer

You asked about `ENG-123` in an earlier session, and step 6 saved it. In a new session, ask:

> What does ENG-123 say, and what state is it in?

| # | The agent runs | What you should see |
| --- | --- | --- |
| 1 | `entire brain recall "ENG-123" --json` | A memory under `project.linear.linear_issue_get`, with a `fetched=` time |
| 2 | Nothing else | The agent answers from the memory |

No `entire scalekit` command runs, so there is no call to Linear. If the answer might be out of date, or you say the issue changed, the agent runs `entire scalekit refresh <key>`. The key is in the memory, right after `Scalekit context`. It then uses the memory with the newest `fetched=` time. A refresh adds a second memory and keeps the first.

### Flow B: a question Brain cannot answer yet

Brain has no memory of the project, so the agent has to call the app. In a new session, ask:

> List the issues in the Linear project "Roadmap" with their state. Check Brain first, and save what you find so the next session does not need to ask Linear again.

| # | The agent runs | What you should see |
| --- | --- | --- |
| 1 | `entire brain recall "Roadmap issues" --json` | No matching memory |
| 2 | `entire scalekit search connectors linear` | `ready connection=linear`, or `needs authorization` |
| 3 | `entire scalekit connect linear`, only if not ready | A link. The agent gives it to you and waits for you to open it |
| 4 | `entire scalekit search tools linear issues list --schema` | `linear_issues_list  read`, with its inputs |
| 5 | `entire scalekit fetch linear linear_issues_list --args '{"project":"Roadmap","first":10}'` | `Saved <key>.` This is the Scalekit tool call |
| 6 | Nothing else | The agent answers from the response |

An agent may also run read-only Brain commands before step 2, such as `entire brain brief`, `entire brain query` or `entire brain memories tree`. That is fine. What matters is that it calls the app only after Brain has no answer.

Now check what was saved:

```sh
entire brain memories tree --path project.linear
entire brain memories tree --path workflow.linear
entire brain recall "Roadmap" --json
```

`project.linear.linear_issues_list` holds the response. `workflow.linear.linear_issues_list` is the route memory: which connection and tool to use next time, with no content. Start another new session and ask the same question. The agent should now stop at step 1 and make no Linear call.

What gets saved is the tool's response, up to 8,000 characters. A larger response stays in a local file, and the memory points to it with `entire scalekit show <key>`. It is not a short summary. If you want one, ask the agent to save its own snapshot with `entire brain remember`. In a real session the agent did this after reading a 133-issue list. A good snapshot starts with where and when the data came from, then tells the next session when to refresh:

```text
Linear project Roadmap, fetched <timestamp>. Source: linear_issues_list, project=Roadmap, archived issues left out, no further pages. 133 issues. Use this memory for the issue list and states. Call Linear only for a refresh or a field this snapshot does not have.
Counts: Triage 73, Done 30, Canceled 7, ...
Rows: id | status | team | assignee | updatedAt | title
```

A Brain path segment can use letters, digits and underscores. `project.linear.roadmap_issues` is valid. `project.linear.roadmap-issues` is rejected with "not a valid taxonomy path", so the agent has to retry. The plugin does this for you: it turns every other character into an underscore.

### Flow C: a connector that needs your own OAuth app

Some connectors have no Scalekit shared OAuth app, so you register an OAuth app with the provider. Gmail is one at the time of writing. In a new session, ask:

> Find my latest email from the Acme team and save the subject.

| # | The agent runs | What you should see |
| --- | --- | --- |
| 1 | `entire brain recall "Acme email" --json` | No matching memory |
| 2 | `entire scalekit search connectors gmail` | `needs OAuth credentials connection=gmail`, or `not set up` |
| 3 | `entire scalekit connect gmail` | No link. Four numbered steps, the connector's setup page and a redirect URI |
| 4 | Nothing else | The agent gives you the steps as printed and waits |

You do the steps: log in to app.scalekit.com, register the OAuth app by following the setup page, enter the client ID and secret on the connection, and save. Then tell the agent. It runs `entire scalekit connect gmail` again, which now prints a link. You open the link, and the agent continues as in Flow B, from step 4.

The agent must not:

- ask you to paste the client secret into the chat. Sessions are recorded, so a secret typed there is saved in the transcript,
- run `connect` again before you say the steps are done. Nothing has changed, so it prints the same steps,
- call `fetch` first. With no authorized account it stops, saves nothing and tells the agent to run `connect`.

When the connector does have a shared app, as Linear, Slack and GitHub do at the time of writing, step 3 is different. `connect` creates the connection, switches it to the shared app, and prints a link in one go. You register nothing.

## Troubleshoot

The process exits 1 and prints one message.

| Message | What to do |
| --- | --- |
| `Missing environment variables` | Export the three Scalekit values again in this terminal. The message names each missing variable |
| `No connection named` | Run `entire scalekit search connectors` with one or more words |
| `not set up` or `needs authorization` | Run `entire scalekit connect` with the connector identifier, then open the new link |
| `has no tool named` | Run `entire scalekit search tools` with the connection name and words |
| `is a write tool` | Use `entire scalekit run` only when you mean to change the app |
| `--args must be a JSON object` | Pass one object, for example `--args '{"issueId":"ENG-123"}'` |
| `reported an error` | The app refused the call inside a successful response. Nothing was saved. Fix the arguments or the authorization |
| `syncs its Brain memories to your team` | Add `--share` only if the team may see the text, or set `ENTIRE_BRAIN_NO_EGRESS=1` |
| `No saved item for that key` | Use the 12 hex characters from a `Saved` line on this machine |
| `Refreshing it would repeat the write` | Leave the item. Run `entire scalekit run` only when a person asks for a new change |

## What this proof of concept leaves out

- No command accepts an app URL. You pass the connection, the tool, and the arguments.
- Entire's Trail is one change followed from intent to merge. This guide does not add a line on the Trail. Agents read Brain.
- There is no single binary, and no entry in the Entire plugin index.
- Secret removal looks for common token shapes. An unusual secret can remain.
- SaaSKit, Scalekit's auth for a customer's own app, is outside this guide.

Field-by-field detail is in the [README](README.md).
