// ページ間ナビゲーション時のローディング表示を抑えるための軽量メモリキャッシュ。
// タブが生きている間はデータが残るので、同じページを再訪したときは
// 即座にキャッシュを表示し、裏側で最新データを取得して更新する。
// (Stale-while-revalidate パターン)
//
// データはタブ閉じ/リロードで消える。永続化はしない（DBが真実の場所）。

const caches = new Map<string, unknown>();

export function getCache<T>(key: string): T | undefined {
  return caches.get(key) as T | undefined;
}

export function setCache<T>(key: string, value: T): void {
  caches.set(key, value);
}

export function clearCache(key: string): void {
  caches.delete(key);
}
