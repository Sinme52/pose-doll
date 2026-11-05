---
name: pose-doll
description: 人型キャラクタに特定のポーズを取らせた画像を作るときに使う。3Dのポーズ人形をJSONで操作してポーズ参照画像を描き、キャラ画像と一緒に画像生成（gpt-image スキルの edit）へ渡して「このキャラでこのポーズ」の画像を作る。「〇〇のポーズで」「走っている／ジャンプしている／座っている絵」「歩行フレーム」「アニメーションのコマ」「ポーズ違い」「この写真のポーズで」など、既存キャラのポーズ指定が絡む画像生成では gpt-image 単体よりこちらを優先する。「ポーズ人形を開いて」「ポーズエディタ」のように、人が手でポーズを作るGUIを求められたときや、ほかの画像生成ツール（Stable Diffusion／ComfyUI の ControlNet、Gemini、Flux など）向けのポーズ素材（OpenPose・深度・マスク・プロンプト）を求められたときにも使う。
---

# pose-doll：ポーズ人形でキャラにポーズを取らせる

文章だけでポーズを指定すると、画像モデルはキャラの左右を取り違えたり、手足の位置を読み違えたりする。
そこで、3Dのポーズ人形を JSON で動かして参照画像を作り、キャラ画像と2枚で渡す。

## 置き場所と準備

- 以下の `$SKILL` は、この SKILL.md があるフォルダ。スクリプトはすべて `$SKILL/scripts/` にある。
  - 例：`~/.claude/skills/pose-doll`、プロジェクトの `.claude/skills/pose-doll`。
- **出力は作業ディレクトリ（プロジェクト）側に作られる。** スキルのフォルダには書き込まない。
  - 画像など：`./pose-doll-out/`（環境変数 `POSE_DOLL_OUT` で変更可）
  - エディタで保存したポーズ：`./pose-doll-poses/`（`POSE_DOLL_POSES` で変更可）
  - プロジェクトの `.gitignore` に `pose-doll-out/` を入れるよう、必要ならユーザーに提案する。保存ポーズは残したいことが多いので無視しない。
- 必要なもの：
  - Node.js 20 以上（22 で動作確認。three.js は `scripts/node_modules/three` に同梱済み。`npm install` は不要）
  - 描画用のヘッドレス Chromium（Playwright）。無ければ最初に一度だけ入れる（スキルのフォルダの外、`~/.cache/pose-doll` に入る）：
    ```bash
    npm install --prefix ~/.cache/pose-doll playwright && npx --prefix ~/.cache/pose-doll playwright install chromium
    ```
    Playwright がグローバルや作業ディレクトリにあれば、それを使う。
    **`$SKILL/scripts` の中で `npm install` を実行しない。** 同梱の three.js が消える（消えたらスキルを入れ直す）。
  - Python 3（`pose2image.py` / `frames.py` / `photo2pose.py`。追加パッケージは Pillow のみ。写真から作るときだけ mediapipe）
- **描画できない環境**（ブラウザが動かない claude.ai のチャットなど）では、このスキルは使えない。その旨をユーザーに伝え、Claude Code（ローカルかクラウド）での利用を案内する。

## 手順

1. **キャラ画像を用意する**：全身が入り、背景が無地か透過のもの。欲しい向きに近い画像だと安定する。
2. **ポーズを決める**：
   - ユーザーがエディタで保存したポーズがあれば、名前で指定できる（`./pose-doll-poses/<名前>.json`）。
   - 無ければ `$SKILL/scripts/poses/` のプリセットから近いものを選び、書き換えたものを作業ディレクトリに保存する（形式は下記）。
   - `camera.view` を、仕上がりで欲しい向きに合わせる。
   - `build.headsTall`（頭身）をキャラに合わせる。リアル寄りなら 7〜7.5、デフォルメなら 3〜5。
   - `intent` に、ポーズの意図を英語で一文書く。プロンプトに入る。
3. **人形を描いて自分の目で確認する**（API を使う前に必ず行う）
   ```bash
   node $SKILL/scripts/render.mjs my-pose.json --out pose-doll-out/p.png   # 保存済みなら名前だけ: render.mjs akane-guard
   ```
   出力された PNG を Read で見て、意図どおりか確かめる。標準出力の `description` も読む。これは画像上の左右で書いた説明で、そのままプロンプトに入る。
   ずれていれば JSON を直して描き直す。人形が正しくなければ、生成結果も正しくならない。
4. **生成する**（まず **gpt-image スキルを Skill ツールで呼び出し**、API キーの扱い・品質・エラー時の案内などその決まりに従う）
   ```bash
   python3 $SKILL/scripts/pose2image.py --character <キャラ画像> --pose my-pose.json \
     [--heads 7.5] [--view facing-lower-left] [--background transparent] [--fill auto] \
     [--mirror legs] [--uncross] [--consistency <先に作ったコマ>] [--extra "She holds the rifle in both hands."] [--complexity high] [--model <モデルID>]
   ```
   - `--dry-run` を付けると、API を呼ばずにプロンプトだけ確認できる。
   - 結果は `./pose-doll-out/` に出る。一緒に `*.check.jpg`（キャラ／人形／結果の3枚並び）が出力される。これを Read で見て、ポーズとキャラの再現度を確認する。
   - 品質は既定で medium。「本番用」と言われたら、gpt-image スキルの `release` で xhigh に上げる。
   - モデルは gpt-image スキルの既定に従う。`--model` で変えられる（例：`gpt-image-2.5-sunburst`、`gpt-image-2.6-sunburst`）。前に作ったコマとそろえたいときは同じモデルを指定する。
   - `--complexity low|medium|high`：描く前にどれだけ構図を考えるか。省略時は gpt-image スキルの既定に従う。人形で構図が決まっているので、low で十分なことが多い（akane の dl で確認）。
5. **アニメーションのコマは `frames.py` でまとめて作る**（後述の「コマ一式」）。1枚ずつではなく、ゲームの再生順に並べて確認する。
6. **ずれたときの直し方**
   - 左右が逆：人形の JSON が意図どおりか見直す。
   - 手足の位置が甘い：関節角度をはっきりさせる（中途半端な角度は避ける）。あるいは `--extra` で要点を英語で補足する。
   - 人形の質感や色が混ざる：`--style plain` で試す。
   - 後ろ向き（ul）で持ち物が高く描かれる：見下ろし視点では、体の向こう側にある物が画面上で高く見えるため。説明文には自動で「NOT raised」の注記が入る。それでも高いときは `--extra` で高さを明記する。

## 人が手でポーズを作る：エディタ（GUI）

「ポーズ人形を開いて」「エディタで作りたい」と言われたら、**作業ディレクトリ（プロジェクト）で**サーバーをバックグラウンドで起動し、URL を伝える。

```bash
node $SKILL/scripts/server.mjs --port 5178      # Bash の run_in_background で起動する
```

- ユーザーには `http://localhost:5178` を開いてもらう。部位をクリックして選び、スライダーで動かす。
- 画面の「**プロジェクトに保存**」で名前を付けると、`./pose-doll-poses/<名前>.json` に保存される。
  - ユーザーは「〇〇のポーズで」と言うだけでよい。Claude はその名前を `render.mjs` / `pose2image.py --pose` / `frames.py --frames` にそのまま渡せる。
  - 保存済みのポーズは、エディタのプリセット一覧の先頭にも出る。
- 「JSON を保存」ボタン（ダウンロード）もある。そのファイルも `--pose` に渡せる。
- サーバーは 127.0.0.1 にだけ待ち受ける。**クラウドのセッションでは、ユーザーのブラウザから開けない。** ローカルの Claude Code で使ってもらうか、ダウンロードした JSON を渡してもらう。
- 作業が終わったら、起動したサーバーを止める。

## 注意（実際の作業で起きた失敗から）

- **物を持つポーズで `--mirror`（全身反転）を使わない。** 全身反転では、持ち物も反対の手に移る。歩行の b コマは `--mirror legs`（脚だけ反転）で作るか、別ファイルにする。プリセットの `walk-ready-b` は脚だけ反転で作ったもの。
- **`--extra` は元絵の持ち方に合わせる。** 変えたい場合は、変える点をはっきり書く。
  - 例：元絵が片手持ちなのに「元絵のとおり両手で」と書くと、指示が食い違う。ツールはこの食い違いを検出できない。
  - 持ち方を変えるときは、ポーズ JSON の `props` で持ち物を描き、`--extra` でも「両手で構える」と明記する。
- **コマはゲームの再生順に並べて確認する。** 1枚ずつの check.jpg では、コマ間の持ち替えや大きさのずれに気づけない。
  - `frames.py` の GIF（256px と 64px）と比較シートで確認する。
  - ゲームで立ち絵を使い回す場合は、`@既存画像` をコマに入れて、実際の並びで確認する。
- **プリセットの腕を流用するときは、左右の役割を人形で確認する。** 説明文の「Hands: …further forward」で、どちらの手が前かを確かめる。
- **3/4 前向き（dl）の歩行の a/b は、シルエットが似やすい。** 64px の GIF で交互に見えるか確認し、見えにくければ歩幅を広げる。
- **後ろ向き（ul・ur・back）の歩行の b は、交差したまま作る（通常の `walk-*-b`）。**
  - 後ろ向きの b（本人の右足が前）では、手前にある後ろの左脚が、前に出た右脚のほとんどを隠す。右足は靴だけがのぞく。これが自然な見え方。
  - 説明文には「back leg … HIDES MOST of the forward leg … Draw only one fully visible leg」が自動で入る。この文で、画像モデルが交差を解かずに描くようになった。
  - 試運転で「legs cross in the picture in a back view」の WARNING が出るが、これは「交差を解いて描かれることがある」という注意。生成後の CHECK で前後が逆と出たら、候補から選び直すか作り直す。
  - 代わりの手：
    - `walk-ready-a~picture`：絵の上で a を左右反転した b。`--view-frames 'ul=…'` で ul だけに使える。
    - `--uncross`：股関節を開いて交差をなくす。a と形が変わるので、優先度は低い。
- **後ろ向きでは、靴底が見えるのは後ろ足だけ。** 説明文には「Only one boot shows its sole …」が自動で入る。モデルが前後を判断する一番強い手がかりなので、`--extra` で打ち消さない。
- **後ろ向きで `--chain` を使わない。** 後のコマが、最初のコマの脚までまねることがある。代わりに `--chain-from stand-ready`（立ちのコマを先に作って3枚目の画像にする）を使う。
- **生成後の自動確認（CHECK）を読む。**
  - 結果ごとに、一番低い足（カメラに一番近い足）が左右どちらにあるかを人形と比べている。
  - 「the stride may be reversed」「probably show the same stride」が出たら、そのコマは前後が逆か、a と b が同じ形になっている可能性が高い。作り直すか、候補から選び直す。
- **ユーザーの既存画像は上書きしない。** 出力は `./pose-doll-out/` に出る。採用するかはユーザーが決める。

## gpt-image スキルとの関係

- キャラ画像の生成（`pose2image.py` と、`--dry-run` なしの `frames.py`）だけが gpt-image スキルを使う。人形の描画・エディタ・`--export` は単独で動く。
- 生成は、gpt-image スキルの公開コマンド `gpt_image.py edit` を呼ぶ。
  - キャラ画像・人形画像・3枚目の画像を、1回のリクエストで送る。
  - モデルと complexity は、指定しない限りスキルの既定になる。`--model` / `--complexity` を付けたときだけ、そのまま渡す。
  - GPT Image 2.6 の透過背景では、キャラの周りに透明度 1/255 の見えないもやが残ることがある。見た目は透明だが、自動トリミングや当たり判定が画像全体を拾うので、スプライトに使うときは透明度の低い画素（例：8 以下）を 0 にそろえる。
  - 結果の JSON の `via` に、どのスキルで生成したかが残る（例：`gpt-image skill (edit command)`）。
- スクリプトの場所は自動で探す。
  - 探す順：`GPT_IMAGE_SCRIPT` → `gpt-image` → 旧版の `gpt-image-2-5`。それぞれ、このスキルと同じフォルダ、`~/.claude/skills/` の下などを探す。
  - 旧版の `gpt-image-2-5` しか無い環境でも、そのまま動く。`edit` を持たないさらに古い版では、スクリプトの関数を直接使う方式に切り替わる。
  - 違う版を使うときは `GPT_IMAGE_SCRIPT=/path/to/gpt_image.py` を指定する。
- 本番用（xhigh）への仕上げは、gpt-image スキルの `release` で行う。
  - ポーズツールの結果には `release_prompt`（入力画像に触れない説明文）が記録されているので、`release --image <結果>` だけでよい。
- gpt-image スキルが見つからないときは、下の `--export` を案内する。

## gpt-image スキルがない環境・ほかの画像生成ツールを使うとき：`--export`

素材を書き出して、ユーザーが使うツール（Stable Diffusion／ComfyUI、Gemini、Flux など）に渡す。API は呼ばない。

```bash
python3 $SKILL/scripts/frames.py --character '<キャラ画像（{view} 可）>' --frames <コマ> --views <向き> --heads <頭身> \
  --export --name <名前> [--character-desc "<キャラの外見の文章>"] [--extra "<補足>"]
# 1ポーズなら: node $SKILL/scripts/render.mjs <ポーズ> --view <向き> --export --out-dir pose-doll-out/<名前>
```

- 出力：人形画像、OpenPose 画像と関節 JSON（ControlNet 用）、深度画像、マスク、プロンプト文（`.prompts.txt`）、一覧（`EXPORT.md`）。
- 出力の sheet.jpg と人形を Read で見て確認してから、ユーザーに `EXPORT.md` の場所と使い方を伝える。
- 後ろ向きで脚が交差する WARNING が出たときは、そのまま渡してよい。ただし「生成結果で前後の脚が入れ替わっていないか確認して」とユーザーに伝える。

## 参考写真があるとき：`photo2pose.py`（任意）

ユーザーが「この写真のポーズで」と参考写真を渡したときは、写真からポーズ JSON を作ってから使う。

```bash
python3 $SKILL/scripts/photo2pose.py <写真> --heads 7.5      # 出力: ./pose-doll-out/photo/
```

- 必要なもの：`pip install mediapipe pillow`。初回にモデル（約30MB）を `~/.cache/pose-doll/` へ取得する。
- 確認：`<名前>.compare.jpg`（写真と人形の比較）を必ず Read で見る。ずれていれば JSON を直す。
  - 奥行き、肩の傾き、胴体のひねりは推定がずれやすい。
  - 握り、持ち物（`props`）、`intent` は推定されないので、自分で足す。
- 写真はユーザーのものか、ライセンスが許すものだけを使う。写真そのものはリポジトリに入れない。

## 自然な姿勢の目安

**上半身を直立にしない。** 人はほとんどの姿勢で、胴体を少し前に傾け、肘を軽く曲げている。新しいポーズを書くときも、次の値を目安にする。
- 胴体の前傾（`spine.bend` と `chest.bend` に分けて入れる）：立ち 2〜4°、歩き 約11°、走り 15〜20°、構え 10〜15°
- 前傾したぶんだけ、`head.nod` を少しマイナスにして視線を前に戻す。
- 肘は 15〜30°、走りでは約90° 曲げる。
- 立ち姿は片足重心にするとよい。`root.roll` と `spine.side` / `chest.side` を逆向きにし、遊脚の膝を 10〜15° 曲げる。

## 任意：キャラ本人の3Dモデルを使う（Meshy）

**標準は人形だけで進める。** Meshy は有料なので、次のどちらかのときだけ使う。
- ユーザーが Meshy や3Dモデルの利用を求めたとき
- リギング済みの GLB がすでにあるとき

GLB があれば、`render.mjs --model <glb>` / `pose2image.py --rig <glb>` で、人形と同じ JSON のままキャラ本人の3Dモデルを動かせる。
- 指の骨がないため、握りや指差しは `--extra` で文章で補う。
- 片膝立ちや座りなど床に接するポーズでは、描いた画像で接地しているか必ず確認する。

**新しく作るとき**は `$SKILL/scripts/meshy_rig.py` を使う（約40クレジット/体。meshy-cli が必要）。
1. まず `--yes` なしで実行する。ログイン状態、残高、見積もりが表示されるだけで、何も投入されない。
2. 表示された見積もりをユーザーに伝え、了承を得る。
3. 了承されたら `--yes` を付けて再実行する。
4. 出来上がった `./pose-doll-out/meshy/<name>/preview.png` を見て確認する。GLB は `./pose-doll-out/models/` に出る。

## コマ一式：`frames.py`

複数のポーズ × 向きを一括で作り、ゲームの再生順で確認する。

```bash
python3 $SKILL/scripts/frames.py --character 'sprites/hero-{view}.webp' \
  --frames walk-ready-a,stand-ready,walk-ready-b --views dl,ul --heads 7.5 --chain-from stand-ready --candidates 2 \
  --compare 'sprites/hero-{view}-walk-a.webp,sprites/hero-{view}.webp,sprites/hero-{view}-walk-b.webp' \
  --extra "She holds the pulse rifle at the ready in both hands ..." --name hero-walk-ready [--dry-run]
```

- **必ず先に `--dry-run` を実行する。** 人形の比較シート（`sheet.jpg`）と、再生順の人形 GIF（`<view>-mannequin.gif`、64px 版もある）が出力され、API は呼ばれない。これを見てから本番を実行する。
- 指定のしかた：
  - `{view}` は dl / ul / dr / ur に置き換わる。
  - `~legs` / `~all` を付けると反転したコマになる（例：`walk-ready-a~legs`）。
  - `@パス` は既存画像をそのままコマとして使う。
  - コマ名には、プリセット名・保存済みポーズ名・JSON のパスが使える。
- 再生順は `--sequence` で指定する。3コマなら既定は 0,1,2,1（a → 立ち → b → 立ち）。
- `--chain-from <立ちのコマ>`：そのコマを先に作り、残りのコマに3枚目の画像として渡す。持ち物のデザインや体型がコマ間でそろう。
  - 決まった画像を渡すときは `--consistency <png>` を使う。
  - `--chain`（最初のコマを渡す）は、後ろ向きでは使わない。
- `--candidates 2`：各コマを2案作る。採用した案は sheet.jpg で緑の枠になる。
  - 選び直すときは `picks.json`（`{"ul": {"walk-ready-b": 1}}`、0始まり）を書き換え、同じコマンドをもう一度実行する。
  - 作成済みの画像は再利用されるので、API は呼ばれない（作り直すときは `--force`）。
- `--uncross`：後ろ向きで脚が交差・重なるコマだけ、股関節を開く。
- `~picture`（例：`walk-ready-a~picture`）：その向きの絵の上で、a の脚を左右反転した b を作る。
- `--view-frames 'ul=…'`：向きごとに違うコマを指定する（コマ数は `--frames` と同じ）。
- 人形が画面の端にかかると、その向きの全コマを少し引いた画角で描き直す（縮尺はそろったまま）。
- 縮尺：同じ向きのコマはカメラを固定するので、大きさと地面の高さがそろう。`--fill auto`（既定）は、キャラ画像の高さに合わせる。
- 出力先は `./pose-doll-out/frames/<name>/`：
  - `sheet.jpg`：人形・結果・既存コマの一覧
  - `<view>-anim.gif`、`<view>-anim-64px(-x4).gif`：結果を再生順に並べた GIF
  - `<view>-anim-compare.gif`：新旧を並べた GIF
  - 各コマの `.json`：外接矩形と足元の位置（`layout`）。スプライトを揃えるときに使う。

## ポーズ JSON

```json
{
  "name": "point-up",
  "intent": "pointing the right index finger up while explaining",
  "build": { "headsTall": 7.5 },
  "camera": { "view": "facing-lower-left" },
  "joints": {
    "rightShoulder": { "raise": 60, "dir": 35 },
    "rightElbow": { "bend": 105 },
    "rightWrist": { "grip": 100, "point": 1 },
    "head": { "tilt": 6 }
  }
}
```

- **左右（left / right）は常にキャラ自身の左右**。人形では、キャラ自身の左半身が青、右半身が赤で描かれる。
- 書かなかった関節は 0（ほぼ直立）になる。値は角度（度）。
- **持ち物**：`"props": [{ "type": "rifle", "hands": ["right", "left"] }]`（複数可。例：右手に剣、左腕に盾）
  - 種類は `$SKILL/scripts/src/prop-catalog.js` のカタログにある。
    - 銃：rifle、assault-rifle、carbine、smg、shotgun、sniper、lmg、launcher、pistol、revolver
    - 刃物：sword（= sword-1h、片手剣）、dagger、axe、greatsword（= sword-2h、両手剣）、katana
    - 盾：shield（= round-shield）、buckler、kite-shield、tower-shield、energy-shield
    - 長物：rod、staff、spear
  - `hands`：
    - 銃・長物・両手剣は、1つ目の手がグリップを握り、2つ目の手を通る線に沿って置かれる。
    - 両手剣は、1つ目の手が鍔のすぐ下、2つ目の手が柄頭寄り。剣先は1つ目の手の先へ伸びる。
    - 片手剣・短剣・斧は片手のみ。拳の親指側から刃が出る。
    - 盾は片手のみで、その前腕に固定され、表が腕の外側（手の甲側）を向く。
  - `angle`（度）：片手剣・盾を、手の甲の軸で回す。180 で逆手持ち。
  - `length` / `width`：大きさを変える（頭の高さ単位）。
  - 人形では、持ち物は灰色、刃は明るい灰色で描かれ、銃口・刃先・盾の表がオレンジの印になる。説明文には、持ち方・持つ高さ・向きが入る。
  - **盾の表を正面へ向けるには、前腕のひねり（肘の `twist`）が要る。** `sword-shield-ready` の左腕の値を流用すると早い。
- **新しい持ち物**：`{ "base": "rifle", "label": "plasma rifle", "length": 4.4 }` のような定義を、ポーズ JSON の `"propDefs"` か `--props-file <json>`（render.mjs / pose2image.py / frames.py）で渡す。スキル内のカタログは書き換えない。
  - 足りない項目があれば、警告に「missing …」と出る。

| 関節 | パラメータ |
|---|---|
| `root`（全身） | `yaw` 自分の左へ回る(+)、`pitch` 前傾(+)、`roll` 自分の左へ傾く(+)、`lift` 地面からの高さ（頭の高さ単位。ジャンプ用） |
| `spine`（腰）/ `chest`（胸） | `bend` 前屈(+)/反る(-)、`side` 自分の左へ傾く(+)、`twist` 自分の左へひねる(+) |
| `head` | `nod` うつむく(+)、`turn` 自分の左を向く(+)、`tilt` 左肩側へ傾げる(+) |
| `leftShoulder` / `rightShoulder`、`leftHip` / `rightHip` | `raise` 真下からの上げ角（0=下、90=水平、180=真上）、`dir` 上げる方向（0=前、90=自分の外側、180=後ろ、マイナス=体の前を横切る）、`twist` 外旋(+)/内旋(-) |
| `leftElbow` / `rightElbow` | `bend` 曲げ（前へ）、`twist` 前腕のひねり（手のひらを上へ(+)／下へ(-)） |
| `leftKnee` / `rightKnee` | `bend` 曲げ（後ろへ） |
| `leftWrist` / `rightWrist` | `bend` 手のひら側へ(+)、`side` 親指側へ(+)、`grip` 0=開く〜100=握る、`point` 1=人差し指を伸ばす |
| `leftAnkle` / `rightAnkle` | `bend` つま先を上げる(+)/伸ばす(-) |

**カメラ**（`camera`）

- `view` の値：
  - `facing-lower-left` / `facing-lower-right`：斜め上から見下ろす3/4前向き（スプライトの `dl` / `dr`）。
  - `facing-upper-left` / `facing-upper-right`：3/4後ろ向き（スプライトの `ul` / `ur`）。
  - `front`、`back`、`left-profile`、`right-profile`、`three-quarter-left`、`three-quarter-right`
- `azimuth` / `elevation` で角度を直接指定することもできる。`azimuth` はキャラの正面から、キャラ自身の左へ回り込む方向が +。
- `fill`：立ち姿が画面の高さの何割を占めるか（既定 0.82）。`--fill auto` で、キャラ画像の大きさに合わせる。
- `frame`：既定は `auto`（立ちポーズと同じ縮尺で描き、はみ出すときだけ引く）。`fixed` は縮尺を常に固定（`frames.py` はこれを使う）、`fit` は毎回画面いっぱいに収める。

## 便利な使い方

- **素手の歩行・走行のコマ**：`walk-a` と、それを `--mirror` で反転したもの（= `walk-b`）を同じカメラで作る。
- **物を持った歩行のコマ**：`walk-ready-a` / `stand-ready` / `walk-ready-b`（ライフルを両手で低く構える）を使う。b は `--mirror legs` と同じ内容。
- **反転の種類**：`--mirror`（または `--mirror all`）は全身と持ち物を反転、`--mirror legs` は脚だけ反転する。脚だけの反転では腰のひねりも脚に合わせて反転し、胸で打ち消すので、上半身・腕・持ち物は動かない。
- **剣と盾**：`sword-shield-ready`（片手剣を立て、盾を胸の前に構える）と、その歩き `walk-sword-shield-a/b`（b は脚だけ反転）。両手剣は `greatsword-guard`（中段）。
- **プリセット一覧**：stand、stand-ready、walk-a、walk-b、walk-ready-a、walk-ready-b、sword-shield-ready、walk-sword-shield-a、walk-sword-shield-b、greatsword-guard、run、aim-rifle、hip-fire、wave、point-up、jump、crouch、kneel、hands-on-hips、punch、victory、sit、a-pose
- **テスト**（スキルを改修したとき）：`cd $SKILL/scripts && npm test`
