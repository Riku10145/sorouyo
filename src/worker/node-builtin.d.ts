// vitest 用: tsconfig.worker は types:[] なので必要最小限だけ宣言する。
interface ImportMeta { url: string }

declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding?: string): string;
}

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...args: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
      get(...args: unknown[]): unknown;
      all(...args: unknown[]): unknown[];
    };
  }
}
