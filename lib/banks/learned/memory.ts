import type { LearnedTemplateStore, StoredTemplate } from '@/lib/banks/learned/store';

/**
 * Per-process store, used when no Redis credentials are configured.
 *
 * Learned templates survive within one server process but not across deploys or
 * across serverless instances. That makes the datastore optional infrastructure
 * rather than a hard dependency: local development and the test suite work with
 * no setup, and a misconfigured deployment degrades to re-inferring a layout
 * rather than failing.
 */
export class InMemoryTemplateStore implements LearnedTemplateStore {
  private readonly templates = new Map<string, StoredTemplate>();

  async get(key: string): Promise<StoredTemplate | null> {
    return this.templates.get(key) ?? null;
  }

  async put(template: StoredTemplate): Promise<void> {
    this.templates.set(template.key, template);
  }

  async delete(key: string): Promise<void> {
    this.templates.delete(key);
  }

  async list(limit = 100): Promise<StoredTemplate[]> {
    return [...this.templates.values()]
      .sort((a, b) => b.learnedAt.localeCompare(a.learnedAt))
      .slice(0, limit);
  }

  /** Test helper — the store is a module singleton in normal use. */
  clear(): void {
    this.templates.clear();
  }
}
