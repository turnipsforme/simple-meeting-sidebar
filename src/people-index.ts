import { getAllTags, type App, type CachedMetadata, TFile } from "obsidian";
import type { PersonMatch } from "./models";
import { findLongestPersonKey, normalizePersonText, normalizeVaultFolder } from "./utils";

interface IndexedPerson {
  file: TFile;
  displayText: string;
  matchedByAlias: boolean;
}

export class PeopleIndex {
  private dirty = true;
  private lookup = new Map<string, IndexedPerson>();
  private maximumCandidateTokens = 1;

  constructor(
    private readonly app: App,
    private getFolder: () => string,
    private shouldUseAliases: () => boolean,
  ) {}

  invalidate(): void {
    this.dirty = true;
  }

  isPeoplePath(path: string): boolean {
    const folder = normalizeVaultFolder(this.getFolder(), "People");
    return path === folder || path.startsWith(`${folder}/`);
  }

  find(eventTitle: string): PersonMatch | null {
    if (this.dirty) this.rebuild();
    const key = findLongestPersonKey(eventTitle, this.lookup, this.maximumCandidateTokens);
    if (!key) return null;
    return this.lookup.get(key) ?? null;
  }

  private rebuild(): void {
    const folder = normalizeVaultFolder(this.getFolder(), "People");
    const people = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${folder}/`) && this.hasPersonTag(file))
      .sort((left, right) => left.path.localeCompare(right.path));

    const nextLookup = new Map<string, IndexedPerson>();
    let maximumTokens = 1;

    // Titles win deterministic collisions with aliases.
    for (const file of people) {
      maximumTokens = this.addCandidate(nextLookup, file.basename, file, false, maximumTokens);
    }
    if (this.shouldUseAliases()) {
      for (const file of people) {
        for (const alias of this.getAliases(file)) {
          maximumTokens = this.addCandidate(nextLookup, alias, file, true, maximumTokens);
        }
      }
    }

    this.lookup = nextLookup;
    this.maximumCandidateTokens = maximumTokens;
    this.dirty = false;
  }

  private hasPersonTag(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    return cache !== null
      && (getAllTags(cache) ?? []).some((tag) => tag.toLocaleLowerCase() === "#person");
  }

  private getAliases(file: TFile): string[] {
    const cache = this.app.metadataCache.getFileCache(file) as CachedMetadata | null;
    const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    const raw = frontmatter?.aliases ?? frontmatter?.alias;
    if (typeof raw === "string") return raw.trim() ? [raw.trim()] : [];
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }

  private addCandidate(
    lookup: Map<string, IndexedPerson>,
    candidate: string,
    file: TFile,
    matchedByAlias: boolean,
    maximumTokens: number,
  ): number {
    const key = normalizePersonText(candidate);
    if (!key || lookup.has(key)) return maximumTokens;
    lookup.set(key, { file, displayText: candidate, matchedByAlias });
    return Math.max(maximumTokens, key.split(" ").length);
  }
}
