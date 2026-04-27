import {
  ActionPanel,
  Action,
  List,
  Cache,
  Icon,
  showToast,
  Toast,
  getPreferenceValues,
  LocalStorage,
} from "@raycast/api";
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
  enterpriseHttpProxy: string;
  enterpriseHttpsProxy: string;
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
const FAVORITES_KEY = "favorites";

// Strips `woocommerce-` / `-woocommerce-` / `-woocommerce` from repo names so the list reads less noisily when most repos share that prefix.
function stripWoo(name: string): string {
  const stripped = name
    .replace(/^woocommerce-/i, "")
    .replace(/-woocommerce-/gi, "-")
    .replace(/-woocommerce$/i, "");
  return stripped || name;
}
const GH = "gh";
const EXEC_ENV = process.env;
const USER_SHELL = process.env.SHELL || "/bin/zsh";

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

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
  proxy?: { http: string; https: string },
  onDone?: Progress,
): Promise<OrgRepos> {
  const envAssignments: string[] = [];
  if (hostname) {
    envAssignments.push(`GH_HOST=${shellQuote(hostname)}`);
    const httpProxy = proxy?.http || proxy?.https || "";
    const httpsProxy = proxy?.https || proxy?.http || "";
    if (httpProxy) envAssignments.push(`HTTP_PROXY=${shellQuote(httpProxy)}`);
    if (httpsProxy) envAssignments.push(`HTTPS_PROXY=${shellQuote(httpsProxy)}`);
  }
  const prefix = envAssignments.length > 0 ? `${envAssignments.join(" ")} ` : "";
  const inner = `${prefix}${GH} repo list ${shellQuote(org)} --limit 1000 --json name,url,description,isArchived,visibility`;
  const command = `${USER_SHELL} -lc ${shellQuote(inner)}`;
  try {
    console.log(`[git-jump] Fetching ${org}${hostname ? ` on ${hostname}` : ""}...`);
    const { stdout } = await execAsync(command, {
      encoding: "utf-8",
      timeout: 30000,
      env: EXEC_ENV,
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
  const enterpriseProxy = {
    http: (prefs.enterpriseHttpProxy || "").trim(),
    https: (prefs.enterpriseHttpsProxy || "").trim(),
  };

  const enterpriseEnabled = enterpriseHost.length > 0 && enterpriseOrgs.length > 0;
  const specs: {
    org: string;
    sectionTitle: string;
    key: string;
    hostname?: string;
    proxy?: { http: string; https: string };
  }[] = [
    ...githubOrgs.map((o) => ({ org: o, sectionTitle: o, key: `github.com:${o}` })),
    ...githubUsers.map((u) => ({ org: u, sectionTitle: u, key: `github.com:${u}` })),
    ...(enterpriseEnabled
      ? enterpriseOrgs.map((o) => ({
          org: o,
          sectionTitle: `${o} (Enterprise)`,
          key: `${enterpriseHost}:${o}`,
          hostname: enterpriseHost,
          proxy: enterpriseProxy,
        }))
      : []),
  ];

  const seen = new Set<string>();
  const dedupedSpecs = specs.filter((s) => {
    const dedupeKey = s.key.toLowerCase();
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  });

  const total = dedupedSpecs.length;
  let done = 0;
  const cb: Progress = (org) => {
    done++;
    onProgress?.(done, total, org);
  };

  const results = await Promise.all(
    dedupedSpecs.map(({ org, sectionTitle, key, hostname, proxy }) =>
      fetchOrg(org, sectionTitle, key, hostname, proxy, cb),
    ),
  );
  return results.sort((a, b) => b.repos.length - a.repos.length);
}

export default function Command() {
  const [orgRepos, setOrgRepos] = useState<OrgRepos[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  async function loadFavorites() {
    const raw = await LocalStorage.getItem<string>(FAVORITES_KEY);
    if (raw) {
      try {
        const arr: string[] = JSON.parse(raw);
        setFavorites(new Set(arr));
      } catch {
        setFavorites(new Set());
      }
    }
  }

  async function toggleFavorite(url: string) {
    const next = new Set(favorites);
    if (next.has(url)) {
      next.delete(url);
      showToast({ style: Toast.Style.Success, title: "Removed from favorites" });
    } else {
      next.add(url);
      showToast({ style: Toast.Style.Success, title: "Added to favorites" });
    }
    setFavorites(next);
    await LocalStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(next)));
  }

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
    loadFavorites();
  }, []);

  const favoriteRepos: { repo: Repo; orgKey: string; sectionTitle: string }[] = [];
  for (const org of orgRepos) {
    for (const repo of org.repos) {
      if (favorites.has(repo.url)) {
        favoriteRepos.push({ repo, orgKey: org.org, sectionTitle: org.sectionTitle });
      }
    }
  }
  favoriteRepos.sort((a, b) => a.repo.name.localeCompare(b.repo.name));

  function renderItem(repo: Repo, orgKey: string, keyPrefix: string) {
    const isFav = favorites.has(repo.url);
    const accessories: List.Item.Accessory[] = [];
    if (isFav) accessories.push({ icon: Icon.Star, tooltip: "Favorite" });
    accessories.push({ text: repo.visibility });
    return (
      <List.Item
        key={`${keyPrefix}:${orgKey}/${repo.name}`}
        title={stripWoo(repo.name)}
        subtitle={repo.description}
        keywords={[...repo.name.split("-"), orgKey]}
        accessories={accessories}
        actions={
          <ActionPanel>
            <Action.OpenInBrowser url={repo.url} />
            <Action
              title={isFav ? "Remove from Favorites" : "Add to Favorites"}
              icon={isFav ? Icon.StarDisabled : Icon.Star}
              shortcut={{ modifiers: ["cmd"], key: "f" }}
              onAction={() => toggleFavorite(repo.url)}
            />
            <Action title="Refresh Repositories" icon={Icon.ArrowClockwise} onAction={refresh} />
            <Action.CopyToClipboard title="Copy URL" content={repo.url} />
          </ActionPanel>
        }
      />
    );
  }

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
      {favoriteRepos.length > 0 && (
        <List.Section title="Favorites" subtitle={`${favoriteRepos.length}`}>
          {favoriteRepos.map(({ repo, orgKey }) => renderItem(repo, orgKey, "fav"))}
        </List.Section>
      )}
      {orgRepos.map((org) => {
        const nonFav = org.repos.filter((r) => !favorites.has(r.url));
        if (nonFav.length === 0) return null;
        return (
          <List.Section key={org.org} title={org.sectionTitle} subtitle={`${nonFav.length} repos`}>
            {nonFav.map((repo) => renderItem(repo, org.org, "main"))}
          </List.Section>
        );
      })}
    </List>
  );
}
