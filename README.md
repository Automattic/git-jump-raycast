# Git Jump

Raycast extension to jump to any GitHub repository you have access to.

Lists repos across any number of configured GitHub organizations and users on github.com and/or a GitHub Enterprise host. Opens them in the browser with one keystroke.

## Requirements

- [Raycast](https://raycast.com/)
- [GitHub CLI (`gh`)](https://cli.github.com/) — **required**. The extension shells out to `gh` for every fetch. Install via Homebrew:
  ```bash
  brew install gh
  ```
  Then authenticate:
  - `gh auth login` for github.com
  - `gh auth login --hostname <enterprise-host>` for GitHub Enterprise

  The extension resolves `gh` from the inherited `PATH`.
- Node.js 18+ and npm

## How repositories are fetched

The extension uses `gh repo list <owner>` under the hood — no direct API calls, no personal tokens handled by the extension itself. Authentication is whatever `gh` already has on disk.

For each org or user listed in preferences, it runs:

```bash
gh repo list <owner> --limit 1000 --json name,url,description,isArchived,visibility
```

For Enterprise entries, the same command runs with `GH_HOST=<enterprise-host>` set in the environment so `gh` talks to the right instance.

All requests happen in parallel; results are filtered to drop archived repos, grouped by owner, and cached on disk via Raycast's `Cache` API. The **Refresh Repositories** action re-runs the same commands.

You can reproduce exactly what the extension sees by running the command above in your terminal.

## Install

1. Clone the repo with `git clone git@github.com:Automattic/git-jump-raycast.git`
1. Open Raycast (`⌘ Space`)
1. Search **Import Extension**
1. Select the `git-jump-raycast` folder
1. In your terminal, go to the `git-jump-raycast` folder and run `npm install && npm run build`

The command will be available as **Git Jump** (search "git", "gh", "repo", or "jump").

## Preferences

Open Raycast Settings (`⌘,`) → **Extensions** → find **Jump to a GitHub repo you have access to** → configure the fields below.

| Preference | Default | Purpose |
|---|---|---|
| github.com Orgs | `woocommerce` | Comma-separated list of orgs on github.com |
| github.com Users | `WordPress` | Comma-separated list of user accounts on github.com |
| Enterprise Orgs | *(empty)* | Comma-separated list of orgs on the Enterprise host |
| Enterprise Host | *(empty)* | Hostname of your GitHub Enterprise instance (e.g. `github.example.com`) |
| Enterprise HTTP Proxy | `socks5://127.0.0.1:8080` | Optional `HTTP_PROXY` applied when fetching from the Enterprise host |
| Enterprise HTTPS Proxy | `socks5://127.0.0.1:8080` | Optional `HTTPS_PROXY` applied when fetching from the Enterprise host |

Enterprise fetching only happens when both **Enterprise Host** and **Enterprise Orgs** are set. Proxy values only apply to Enterprise calls. If only one of the two proxy fields is filled in, the same value is used for both `HTTP_PROXY` and `HTTPS_PROXY`.

All fields accept multiple values separated by commas, e.g. `woocommerce, Automattic, WordPress`.

## Usage

- Open Raycast and type any of the following to surface the command: `git jump`, `git`, `gh`, `repo`, `jump`
- `↵` to open it
- Type to fuzzy-match repo names (hyphen-separated words match independently)
- `↵` opens the repo in the browser
- `⌘ K` → **Refresh Repositories** re-fetches from `gh` and updates the cache
- `⌘ .` → **Copy URL** copies the repo URL to the clipboard

Results are cached on disk. Refresh only when you expect new repos.

### Display tweaks

Repo names starting with `woocommerce-`, ending with `-woocommerce`, or containing `-woocommerce-` have that segment stripped from the displayed title to reduce visual noise in lists dominated by those repos. The full original name is still used for matching, keywords, and the opened URL — so searching `woocommerce` still finds everything.

## Development

```bash
npm run dev       # live-reload in Raycast
npm run build     # one-off build
npm run lint      # lint
npm run fix-lint  # autofix lint issues
```
