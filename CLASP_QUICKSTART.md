# clasp で「pushするだけ」にする手順（Claude Code 向け）

このフォルダは `clasp push` でそのまま Apps Script に同期できる構成です。
（コピペ不要。編集→pushの往復で開発できます）

## 0. 一度だけの準備
```bash
npm install -g @google/clasp     # clasp を入れる
clasp login                       # ブラウザで Google 認証
```
※ 加えて Apps Script API を ON にします → https://script.google.com/home/usersettings

## 1. プロジェクトを作る／つなぐ
```bash
cd gas   # このフォルダ

# 新規に作る場合
clasp create --type webapp --title "特定技能 面談管理"

# すでにApps Scriptプロジェクトがある場合はそれに紐づける
# clasp clone <スクリプトID>
```
`.clasp.json` が作られ、以降このフォルダと連携します。

## 2. コードを反映
```bash
clasp push        # 全ファイルをまとめてアップロード
```
※ 事前に `Code.gs` の `SPREADSHEET_ID` を設定しておくこと。

## 3. デプロイ（ここはWeb UIが確実）
`clasp open` でエディタを開き、「デプロイ」から2つ作成します。
- 施設用：実行=自分／アクセス=**全員**
- 管理用：実行=自分／アクセス=**Googleアカウントを持つ全員**

> マニフェスト（appsscript.json）は施設用（匿名アクセス）を既定にしてあります。
> 管理用デプロイは、作成時にアクセス権のプルダウンで「Googleアカウントを持つ全員」を選ぶだけです。

## 以降の開発
ファイルを編集 → `clasp push` → 動作確認、の繰り返し。
Claude Code に「このGASを直して push して」と頼めば、編集からpushまで任せられます。
