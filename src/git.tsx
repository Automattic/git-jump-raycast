import { ActionPanel, Action, List, Cache, Icon, showToast, Toast, getPreferenceValues } from "@raycast/api";
import { exec } from "child_process";
import { promisify } from "util";
import { useEffect, useState } from "react";

const execAsync = promisify(exec);

interface Repo {
  name: string;
  url: string;
  description: string;
  isArchived: boolean;
  visibility: string;
  owner: string;
}

interface OrgRepos {
  org: string;
  sectionTitle: string;
  repos: Repo[];
}

interface Preferences {
  githubOrgs: string;
  githubUsers: string;
  enterpriseOrgs: string;
  enterpriseHost: string;
}

interface GhRepo {
  name: string;
  url: string;
  description: string;
  isArchived: boolean;
  visibility: string;
}

const cache = new Cache();
const CACHE_KEY = "repos";

function stripWoo(name: string): string {
  const stripped = name
    .replace(/^woocommerce-/i, "")
    .replace(/-woocommerce-/gi, "-")
    .replace(/-woocommerce$/i, "");
  return stripped || name;
}
const GH = "/opt/homebrew/bin/gh";
const EXEC_ENV = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`,
  HTTPS_PROXY: "socks5://127.0.0.1:8080",
  HTTP_PROXY: "socks5://127.0.0.1:8080",
};

function parseOrgs(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type Progress = (org: string) => void;

async function fetchOrg(
  org: string,
  sectionTitle: string,
  key: string,
  hostname?: string,
  onDone?: Progress,
): Promise<OrgRepos> {
  const env = hostname ? { ...EXEC_ENV, GH_HOST: hostname } : EXEC_ENV;
  const command = `${GH} repo list ${org} --limit 1000 --json name,url,description,isArchived,visibility`;
  try {
    console.log(`[git-jump] Fetching ${org}${hostname ? ` on ${hostname}` : ""}...`);
    const { stdout } = await execAsync(command, {
      encoding: "utf-8",
      timeout: 30000,
      env,
      maxBuffer: 20 * 1024 * 1024,
    });
    const raw: GhRepo[] = JSON.parse(stdout);
    const repos: Repo[] = raw
      .filter((r) => !r.isArchived)
      .map((r) => ({ ...r, owner: org }))
      .sort((a, b) => a.name.localeCompare(b.name));
    console.log(`[git-jump] ${org}: ${repos.length} repos`);
    onDone?.(org);
    return { org: key, sectionTitle, repos };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[git-jump] Failed ${org}: ${message}`);
    showToast({ style: Toast.Style.Failure, title: `Failed: ${org}`, message });
    onDone?.(org);
    return { org: key, sectionTitle, repos: [] };
  }
}

async function fetchRepos(onProgress?: (done: number, total: number, org: string) => void): Promise<OrgRepos[]> {
  const prefs = getPreferenceValues<Preferences>();
  const githubOrgs = parseOrgs(prefs.githubOrgs || "");
  const githubUsers = parseOrgs(prefs.githubUsers || "");
  const enterpriseOrgs = parseOrgs(prefs.enterpriseOrgs || "");
  const enterpriseHost = (prefs.enterpriseHost || "").trim();

  const enterpriseEnabled = enterpriseHost.length > 0 && enterpriseOrgs.length > 0;
  const specs: { org: string; sectionTitle: string; key: string; hostname?: string }[] = [
    ...githubOrgs.map((o) => ({ org: o, sectionTitle: o, key: `github.com:${o}` })),
    ...githubUsers.map((u) => ({ org: u, sectionTitle: u, key: `github.com:${u}` })),
    ...(enterpriseEnabled
      ? enterpriseOrgs.map((o) => ({
          org: o,
          sectionTitle: `${o} (Enterprise)`,
          key: `${enterpriseHost}:${o}`,
          hostname: enterpriseHost,
        }))
      : []),
  ];

  const total = specs.length;
  let done = 0;
  const cb: Progress = (org) => {
    done++;
    onProgress?.(done, total, org);
  };

  const results = await Promise.all(
    specs.map(({ org, sectionTitle, key, hostname }) => fetchOrg(org, sectionTitle, key, hostname, cb)),
  );
  return results.sort((a, b) => b.repos.length - a.repos.length);
}

export default function Command() {
  const [orgRepos, setOrgRepos] = useState<OrgRepos[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  async function loadRepos(useCache: boolean) {
    setIsLoading(true);

    if (useCache) {
      const cached = cache.get(CACHE_KEY);
      if (cached) {
        const parsed: OrgRepos[] = JSON.parse(cached);
        const totalRepos = parsed.reduce((sum, o) => sum + o.repos.length, 0);
        if (totalRepos > 0) {
          console.log(`[git-jump] Loaded from cache: ${parsed.map((o) => `${o.org}(${o.repos.length})`).join(", ")}`);
          setOrgRepos(parsed);
          setIsLoading(false);
          return;
        }
        console.log("[git-jump] Cache has 0 repos, ignoring stale cache");
        cache.remove(CACHE_KEY);
      } else {
        console.log("[git-jump] Cache empty, fetching from gh CLI...");
      }
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: "Fetching repositories...", message: "" });
    try {
      const repos = await fetchRepos((done, total, org) => {
        toast.message = `${done}/${total} — ${org}`;
      });
      cache.set(CACHE_KEY, JSON.stringify(repos));
      setOrgRepos(repos);
      const totalRepos = repos.reduce((sum, o) => sum + o.repos.length, 0);
      toast.style = Toast.Style.Success;
      toast.title = "Repositories loaded";
      toast.message = `${totalRepos} repos across ${repos.length} sources`;
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to fetch repositories";
      toast.message = String(error);
    } finally {
      setIsLoading(false);
    }
  }

  async function refresh() {
    await loadRepos(false);
  }

  useEffect(() => {
    loadRepos(true);
  }, []);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search repositories..."
      actions={
        <ActionPanel>
          <Action title="Refresh Repositories" icon={Icon.ArrowClockwise} onAction={refresh} />
        </ActionPanel>
      }
    >
      {orgRepos.map((org) => (
        <List.Section key={org.org} title={org.sectionTitle} subtitle={`${org.repos.length} repos`}>
          {org.repos.map((repo) => (
            <List.Item
              key={`${org.org}/${repo.name}`}
              title={stripWoo(repo.name)}
              subtitle={repo.description}
              keywords={[...repo.name.split("-"), org.org]}
              accessories={[{ text: repo.visibility }]}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser url={repo.url} />
                  <Action title="Refresh Repositories" icon={Icon.ArrowClockwise} onAction={refresh} />
                  <Action.CopyToClipboard title="Copy URL" content={repo.url} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}
