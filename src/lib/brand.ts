/**
 * サイト全体の一貫性を担保するブランド定数。
 * すべての記事生成プロンプトはここを参照する。
 */

export const BRAND = {
  /** noteでの表示名 */
  authorName: "主婦のミカタ。アリー",
  /** 肩書 / シリーズ総称 */
  tagline: "ママのためのエンジニア",
  /** 著者プロフィール固定文（記事末尾「この記事を書いた人」に毎回そのまま挿入される） */
  authorBio: `
**主婦のミカタ。アリー** ｜ ママのためのエンジニア

「めんどくさい」を技術で消すのが仕事です。
ご家庭の状況に合わせて、4つの形からご家庭にぴったりのしくみをオーダーメイドで作ります:

- 📱 **LINE bot**: スマホ中心・1メッセージで完結したい方に
- 💻 **Macローカルアプリ**: PC前にいる時間が長い・大量データ処理したい方に
- 📸 **軽量Webツール**: 写真アップロード・家族で共有したい方に
- ⚡ **iOSショートカット**: iPhoneでワンタップ完結したい方に

病院予約システムを開発した実績あり。技術の話は全部裏側に隠して、使う側は「いつもの操作だけ」で完結するように設計します。

> 「うちの場合はこういうことできない？」というご相談、コメント・DMでお気軽にどうぞ。
> 売り込みは一切しません。話を聞くだけ・相談だけでもOKです。
  `.trim(),
  /** 全記事に必ず付ける固定タグ */
  defaultTags: ["#主婦の味方", "#LINEbot", "#個人開発", "#時短家事", "#子育て便利"],
  /** テーマ別の追加タグ */
  themeTags: {
    renraku: ["#連絡帳", "#保育園", "#予約自動化"],
    schedule: ["#家族カレンダー", "#送迎", "#スケジュール管理"],
    paperwork: ["#プリント整理", "#PTA", "#お便り"],
    money: ["#家計簿", "#節約", "#ふるさと納税"],
  } as const,
  /** ツールを作る形のバリエーション */
  toolFormats: [
    "LINEに送るだけ／写真送るだけのLINE bot",
    "URLを開くだけで使える、ログイン不要の軽量Webツール",
    "Macに常駐して、必要な時に通知してくれるPC常駐ツール",
    "iPhoneのショートカットや、家族で共有するカレンダー連携",
  ],
} as const;

export type ThemeTagKey = keyof typeof BRAND.themeTags;

// =============================================================
// CTA 設定（受注ファネルのコンバージョン部分・最重要）
// =============================================================

/** LINE公式開設後にここを true + URL設定すれば、全記事のCTAが自動でLINE誘導に切り替わる */
const CTA_USE_LINE = false;
const CTA_LINE_URL = ""; // 例: "https://lin.ee/xxxxx"

export type CtaConfig = {
  channel: string;
  action: string;
  buttonMarkdown: string;
  howToFull: string;
  isLineReady: boolean;
};

export function getCtaConfig(): CtaConfig {
  if (CTA_USE_LINE && CTA_LINE_URL) {
    return {
      channel: "LINE公式アカウント",
      action: "LINEで「相談」と一言送るだけ",
      buttonMarkdown: `[👇 LINE公式アカウントを友だち追加](${CTA_LINE_URL})`,
      howToFull:
        "下のボタンから友だち追加 →「相談」と一言メッセージを送るだけ。あとは私が返信します。",
      isLineReady: true,
    };
  }
  return {
    channel: "noteのDM",
    action: "noteのDM、もしくは記事下のコメントで「相談」と一言",
    buttonMarkdown: "（※ LINE公式アカウント開設後は専用ボタンを設置予定です）",
    howToFull:
      "noteアプリ右上のDMボタンから「主婦のミカタ。アリー」を検索して、「相談」と一言メッセージを送るだけ。あとは私が返信します。コメント欄でも構いません。",
    isLineReady: false,
  };
}

/** ハードル下げ箇条書き（CTAブロックで毎回使用） */
export const HARD_LOWERING = [
  "**相談料は0円**",
  "**話を聞くだけ・愚痴ベースでもOK**",
  "**技術の知識は一切不要**（「こういうのできない？」レベルで大丈夫）",
  "**売り込みは一切しません**",
];

/** 中盤エンゲージCTA（記事中盤に挿入する読者問いかけ・見出し込みでそのまま使う） */
export const MID_ENGAGE_CTA = `
## 💭 ここまで読んでくれたあなたへ

> **「自分も同じ悩み、ある…」と感じた方、ぜひコメントで一言教えてください。**
> 同じ悩みを持っている方が多いことが分かるほど、より刺さるしくみが作れます。一文だけでも構いません。
`.trim();

