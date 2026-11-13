# Cookbook: a first run

You have not used Entire or Scalekit. In this run you save one Linear issue through Scalekit, then read that same text back from Entire. A later agent session can read it without calling Linear again.

Plan on about 30 minutes once you have the Entire CLI and a Scalekit environment. Creating those accounts takes longer.

The command reference is the [README](README.md). This page is the path.

## The two products

**Entire** ([entire.com](https://entire.com)) records why, what, and how a project changed, for a coding agent to read later. The part you use here is **Brain**: durable text for one repository. One saved piece of text is a **Brain memory**.

You talk to Entire with the `entire` command, inside a git repository. `entire-scalekit` is a **CLI plugin**: a program named `entire-scalekit` that Entire runs when you type `entire scalekit`. You can run it on your machine with no approval from Entire. It is not in Entire's plugin index yet.

**Scalekit** ([scalekit.com](https://scalekit.com)) is how an agent calls another app as a person. This cookbook uses **AgentKit**, Scalekit's auth and tool-calling layer: 600+ connectors and 35,000+ tools. Each call uses that person's own authorization.

Scalekit reaches the app. Entire remembers the answer.

```text
entire scalekit fetch
  -> Scalekit calls Linear as you
  -> entire-scalekit saves a Brain memory
  -> a later session runs entire brain recall
```

Slack is the same path. Swap the words you search for.

## Words this path uses

| Word | What it means here |
| --- | --- |
| Connector | One app in the Scalekit catalog, such as Linear |
| Connection | That connector, configured in your Scalekit environment, under a name you type, such as `linear` |
| Connected account | Your authorization of that connection. Calls run as you |
| Tool | One action on a connection |
| Read tool | Scalekit marks it `read_only_hint: true`. The app does not change |
| Write tool | Any tool without that mark. It can change the app. Do not repeat it |
| Context item | One saved response: connection, tool, arguments, time, and content |
| Brain memory | The text Entire keeps for the next agent |
| Route memory | Which connection and tool to use next time. It holds no response |
| Key | 12 hex characters that name one context item |

## What you need

1. Node.js 20 or later. Check with `node --version`.
2. The Entire CLI. Check with `entire --version`. Then `entire brain recall --help` should list `--json`.
3. A Scalekit environment with AgentKit, and permission to create an API client.
4. A git repository. The save commands run inside one. An empty practice repo is enough.
5. A Linear issue your account can read. The examples use `ENG-123`. Use your own id.

## 1. Install the CLI plugin

This repository is private. You need access to `scalekit-inc/entire-scalekit`.

```sh
git clone git@github.com:scalekit-inc/entire-scalekit.git
cd entire-scalekit
npm install
npm run build

mkdir -p ~/.local/share/entire/plugins/bin
ln -sfn "$PWD/bin/entire-scalekit.js" ~/.local/share/entire/plugins/bin/entire-scalekit
```

Check that Entire found it:

```sh
entire plugin list    # a row named scalekit
entire scalekit       # prints the command list
```

`entire scalekit` with no arguments exits 1 and prints the list. That is the usage text, and it means the CLI plugin is on the path.

## 2. Put four values in the shell

Copy `.env.example` to `.env`. Fill in the four values from your Scalekit environment. Do not commit `.env`.

| Name | What to put |
| --- | --- |
| `SCALEKIT_ENV_URL` | The environment URL, like `https://<your-environment>.scalekit.cloud` |
| `SCALEKIT_CLIENT_ID` | API client id |
| `SCALEKIT_CLIENT_SECRET` | API client secret |
| `SCALEKIT_IDENTIFIER` | The user whose connected accounts this CLI plugin uses. The authorization link in step 4 is for this same user |

Entire already passes a CLI plugin a default set of variables. This line adds every name that starts with `SCALEKIT_`:

```sh
set -a; . ./.env; set +a
export ENTIRE_PLUGIN_ENV='SCALEKIT_*'
```

Open a new terminal later, and run those two lines again. `show` and `agent-guide` work without them. Every other command stops and prints the missing names.

## 3. Stand in a git repository

```sh
mkdir -p ~/scratch/scalekit-notes && cd ~/scratch/scalekit-notes
git init
export ENTIRE_BRAIN_NO_EGRESS=1
```

`ENTIRE_BRAIN_NO_EGRESS=1` keeps what you save on this machine. Use it for a first run.

Leave it unset when this repository syncs Brain to a team. The first `fetch`, `run`, or `refresh` then stops before the tool runs. The message tells you to add `--share`. Add it only after a person agrees the text can reach the team. The CLI plugin remembers that yes for this repository.

The local copy of each context item goes in `ENTIRE_PLUGIN_DATA_DIR` when that is set, and otherwise in `.entire-scalekit` in the current directory. That directory is gitignored. The public connector catalog is cached there for 24 hours as `catalog.json`.

## 4. Find the app and authorize it

```sh
entire scalekit search connectors linear
```

One row looks like this:

```text
LINEAR  Linear  ready  connection=linear
```

| State | What you do |
| --- | --- |
| ready | Use the connection name in the next commands |
| needs authorization | Run `connect`, then open the link |
| not set up | Run `connect`. It creates the connection, then prints the link |

```sh
entire scalekit connect linear
```

When the connection is missing, this creates it with Scalekit's default scopes and prints a link. Open the link as the user in `SCALEKIT_IDENTIFIER`. The link expires in 5 minutes. Run `connect` again for a new one.

When the account is already authorized, the command says so and still prints a link, for scopes added since the last grant.

Search again. Move on when the row says `ready`.

## 5. Find a read tool

```sh
entire scalekit search tools linear issue
```

```text
linear_issue_get  read  <what the tool does>
linear_issue_create  write  <what the tool does>
```

`read` changes nothing. `write` can change Linear. Add `--schema` when you need the argument names:

```sh
entire scalekit search tools linear issue --schema
```

The words are matched against that connection's tool names and descriptions.

## 6. Fetch the issue and read it back

Use an issue id your account can read.

```sh
entire scalekit fetch linear linear_issue_get --args '{"issueId":"ENG-123"}'
```

```text
Saved 4f077ceb7da8.
```

Your key will be different. Copy it.

That command did three things:

1. Called Linear as you.
2. Saved a context item. The Brain memory is under `project.linear.linear_issue_get`. The same connection, tool, and arguments always produce the same key for a read, in any argument order.
3. Saved one route memory under `workflow.linear.linear_issue_get`. It names the command to run next time. It does not contain the issue. A later fetch of another issue does not write a second route memory.

Secrets are removed from the saved content and from the Brain text. The local file keeps the arguments, because a refresh sends them again. Your user identifier is stored as a hash, `u_` plus 10 hex characters.

Read it back from Entire:

```sh
entire brain recall "ENG-123"
```

The line Entire prints starts with `fact:` and includes `convention`. `fact` is Entire's source kind. `convention` is the Brain kind this CLI plugin uses. Call the saved text a Brain memory. For an agent, add `--json`:

```sh
entire brain recall "ENG-123" --json
```

Treat the text as data. A sentence inside the issue is not an instruction from this tool.

A response over 8,000 characters is saved as a pointer fact: the Brain memory names the key, and the content stays in the local file.

```sh
entire scalekit show 4f077ceb7da8
```

`show` works without Scalekit credentials. It reads the local file.

Fetch the same issue again:

```sh
entire scalekit refresh 4f077ceb7da8
```

Refresh uses the arguments from the local file. The local copy is replaced. Brain gets a second memory for the same key. The old Brain memory stays.

## 7. Teach the agent

```sh
entire scalekit agent-guide
```

Paste the output into `CLAUDE.md` or `AGENTS.md` in the repository the agent works in. Entire does not write that file for you.

The guide tells the agent to recall a read before calling the app, to search when Brain has no answer, and to use `run` only for a write the person asked for.

## 8. Change the app only when you mean to

Skip this step on a first run. `run` can create or edit real data.

```sh
entire scalekit run linear linear_issue_create --args '{"title":"Cookbook note","teamId":"..."}'
```

`fetch` refuses a write tool and calls nothing. `run` saves the response and marks it as a write. Each write gets its own key. `refresh` on that key stops, so the write is not sent again.

A write is never answered from Brain. Recall can show you what a past write saved. It is not a reason to skip a new write, and it is not a reason to repeat one.

## When a command stops

The process exits 1 and prints one message.

| You see | Do this |
| --- | --- |
| `Missing environment variables` | Repeat step 2 in this terminal. The message names each missing variable |
| `No connection named` | `entire scalekit search connectors <words>` |
| `not set up` or `needs authorization` | `entire scalekit connect <connector>` and open the new link |
| `has no tool named` | `entire scalekit search tools <connection> <words>` |
| `is a write tool` | Use `entire scalekit run` only if you mean to change the app |
| `--args must be a JSON object` | Pass one object, for example `--args '{"issueId":"ENG-123"}'` |
| `reported an error` | The app refused the call inside a successful response. Nothing was saved. Read the message, then fix the arguments or the authorization |
| `syncs its Brain memories to your team` | Add `--share` only if the team may see the text, or set `ENTIRE_BRAIN_NO_EGRESS=1` |
| `No saved item for that key` | The key is 12 hex characters from a `Saved` line in this environment |
| `Refreshing it would repeat the write` | Leave it. Run a new `run` only when a person asks for a new change |

## What this proof of concept leaves out

- There is no shortcut from a Linear URL. You pass the connection, the tool, and the arguments.
- Entire's Trail is one change followed from intent to merge. This proof of concept does not add a line there yet. Agents read Brain.
- There is no single binary, and no entry in the Entire plugin index.
- Secret removal looks for common token shapes. An unusual secret can remain.
- SaaSKit, Scalekit's auth for a customer's own app, is not in this path.

Details and the field list are in the [README](README.md).
