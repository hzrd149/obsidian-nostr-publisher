export type NostrFrontmatter = Partial<{
  pubkey: string;
  identifier: string;
  title: string;
  summary: string;
  image: string;
  tags: string[];
  published_at: number;
}>;
