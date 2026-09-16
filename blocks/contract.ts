/** Persisted block data. This module must stay independent of the DOM and BlockSuite views. */
export type BlockData = {
  id: string;
  flavour: string;
  version: number;
  props: Record<string, unknown>;
  children: string[];
};

/** Explicit reference slots survive even when a block implementation is unavailable. */
export type BlockReferences = {
  pages?: Record<string, string>;
  assets?: Record<string, string>;
};

export type BlockProjection = {
  text: string;
  outline?: { title: string; level: number };
};

export type BlockDefinition = {
  flavour: `${string}:${string}`;
  label: string;
  version: number;
  parents?: string[];
  children?: string[];
  defaults: () => Record<string, unknown>;
  validate: (props: Readonly<Record<string, unknown>>) => boolean;
  project: (block: BlockData) => BlockProjection;
  /** Key is the source version; each migration advances exactly one version. */
  migrations?: Readonly<
    Record<number, (props: Record<string, unknown>) => Record<string, unknown>>
  >;
  insertion?: { description: string; aliases: string[]; icon?: string };
};
