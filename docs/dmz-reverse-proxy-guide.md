# DMZ 側リバースプロキシ（HTTPS終端）設定ガイド

本ドキュメントは、社内 DMZ に配置された共通リバースプロキシ（Nginx / Apache / Envoy / AWS ALB 等）を経由して、本内製サービス（Game QA Dashboard オンプレミス Docker Compose 環境）へリクエストを転送するための設定仕様書です。

---

## 1. 構成概要

```
[社内LAN / クライアント]
        │ HTTPS (ポート 443)
        ▼
[DMZ 既存リバースプロキシ]  ←★ 本ガイドの対象 (HTTPS 終端 / SSL証明書管理)
        │ HTTP (ポート 8080)
        ▼
[Game QA Dashboard サービス] (Docker Compose: Nginx + OAuth2-Proxy + Backend + Storage)
        │
        ├── アウトバウンド HTTPS (443) ──> Google OIDC (accounts.google.com)
        └── アウトバウンド HTTPS (443) ──> AWS DynamoDB (dynamodb.ap-northeast-1.amazonaws.com)
```

---

## 2. 必須設定項目

### (1) プロキシヘッダーの転送（Google OIDC 認証連携）

DMZ プロキシで HTTPS を終端し、本サービスへ HTTP で転送するため、**クライアントが HTTPS でアクセスしていることを後段の OAuth2-Proxy に伝える必要があります**。これが欠落すると、OAuth2-Proxy が Google へのリダイレクト URL を `http://` で組み立ててしまい、認証エラーとなります。

#### 必須ヘッダー

- `Host`: クライアントがリクエストしたドメイン名（例: `qa-dashboard.internal.example.com`）
- `X-Forwarded-Proto`: 固定値 `https`
- `X-Forwarded-For`: クライアント IP アドレス
- `X-Real-IP`: クライアント IP アドレス

---

### (2) 大容量ファイル（30GB超）対策

本サービスでは 30GB を超えるゲームプレイ動画（MP4）、プロファイルデータ、トレースログを扱います。プロキシ側でデフォルトのバッファリングやサイズ制限が有効になっていると、アップロード・ダウンロードが失敗します。

1. **リクエストボディサイズ制限の撤廃**:
   - アップロードサイズを無制限（または 100GB 以上）に設定。
2. **リクエスト・レスポンスバッファリングの無効化**:
   - **アップロード時**: クライアントからのデータストリームをプロキシのディスクに一時保存せず、直接後段サービスへパイプ転送。
   - **ダウンロード時**: 動画ストリーミング再生（Range リクエスト）時にプロキシ側でバッファリングせず、ゼロコピーで即時転送。
3. **タイムアウト値の延長**:
   - 巨大ファイルのアップロード・ダウンロード中にタイムアウトで切断されないよう、読み書きタイムアウトを十分な長さ（例: 3600秒 = 1時間）に設定。

---

### (3) DMZ からのアウトバウンド通信許可（ポート 443）

本サービスが稼働するサーバーから、インターネット上の以下のエンドポイントへ HTTPS (443) で接続できる必要があります。

| 接続先 | ポート | 用途 |
| --- | --- | --- |
| `accounts.google.com`<br/>`oauth2.googleapis.com` | 443 | Google OAuth 2.0 / OIDC ログイン認証、トークン検証 |
| `dynamodb.ap-northeast-1.amazonaws.com` | 443 | AWS DynamoDB 検索インデックスのクエリおよび書き込み |

> [!NOTE]
> DMZ 内から直接インターネットへ出られない場合は、社内のフォワードプロキシ（Squid 等）経由で通信可能です。本サービス（Docker Compose）の `.env` で `HTTPS_PROXY=http://proxy.internal:8080` を指定してください。

---

## 3. リバースプロキシ別 設定例

### A. Nginx の場合

```nginx
# /etc/nginx/conf.d/game_qa_dashboard.conf

upstream game_qa_dashboard_backend {
    server 192.168.10.50:8080; # 本サービスが稼働するホストの IP とポート
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name qa-dashboard.internal.example.com;

    # SSL 証明書設定
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # 1. 30GB超 大容量ファイル対応
    client_max_body_size 0;              # アップロードサイズ制限を無制限に
    client_body_timeout 3600s;
    proxy_read_timeout 3600s;            # 転送中のタイムアウト防止 (1時間)
    proxy_send_timeout 3600s;
    proxy_connect_timeout 60s;

    # 2. ストリーミング転送 (バッファリング無効化)
    proxy_request_buffering off;         # アップロード時、プロキシディスクへの書き込みをスキップ
    proxy_buffering off;                 # ダウンロード時、大容量動画のRangeシーク再生をスムーズに
    proxy_http_version 1.1;

    location / {
        proxy_pass http://game_qa_dashboard_backend;

        # 3. 必須プロキシヘッダー
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;  # 重要: Google OIDC 連携用
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port 443;

        # WebSocket / Keep-Alive 透過
        proxy_set_header Connection "";
    }
}
```

---

### B. Apache (httpd) の場合

```apache
<VirtualHost *:443>
    ServerName qa-dashboard.internal.example.com

    SSLEngine on
    SSLCertificateFile /path/to/cert.pem
    SSLCertificateKeyFile /path/to/privkey.pem

    # 必須プロキシヘッダー
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-Port "443"

    # 大容量ファイル・タイムアウト設定
    LimitRequestBody 0
    TimeOut 3600
    ProxyTimeout 3600

    ProxyPreserveHost On
    ProxyPass / http://192.168.10.50:8080/
    ProxyPassReverse / http://192.168.10.50:8080/
</VirtualHost>
```

---

### C. AWS Application Load Balancer (ALB) の場合

- **リスナー**: HTTPS:443（ACM 証明書をアタッチ）
- **ターゲットグループ**:
  - プロトコル: HTTP / ポート 8080
  - ヘルスチェックパス: `/oauth2/ping` または `/`
  - 属性:
    - **登録解除の遅延**: 300秒
    - **アイドルタイムアウト**: 3600秒（ロードバランサー属性）
- ALB はデフォルトで `X-Forwarded-Proto: https` を付与します。

---

## 4. 疎通確認・トラブルシューティング

### (1) プロキシヘッダーの疎通確認

クライアント端末から以下の curl コマンドを実行し、DMZ プロキシを経由して正しく Google ログイン画面へリダイレクトされるか確認します：

```sh
curl -I -k https://qa-dashboard.internal.example.com/
```

**期待されるレスポンス**:

```http
HTTP/2 302
location: https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=https%3A%2F%2Fqa-dashboard.internal.example.com%2Foauth2%2Fcallback...
```

> [!WARNING]
> `redirect_uri` が `http://`（HTTP）になっている場合、DMZ プロキシからの `X-Forwarded-Proto https` ヘッダーが後段に届いていません。プロキシヘッダー設定を再確認してください。

### (2) 413 Request Entity Too Large が発生する場合

- DMZ 側プロキシの `client_max_body_size` が 0（無制限）になっているか確認してください。

### (3) 504 Gateway Timeout が発生する場合

- 巨大ファイル（30GB 超）のアップロード中、または長時間動画の視聴中に切断される場合、DMZ 側プロキシの `proxy_read_timeout` / `proxy_send_timeout` を 3600 秒以上に延長してください。
