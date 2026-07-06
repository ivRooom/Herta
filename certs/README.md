# 証明書配置

Cloudflare Origin Certificate をこのディレクトリに配置します。

- `origin.pem` : 証明書 PEM
- `origin-key.pem` : 秘密鍵 PEM

`docker-compose.prod.yml` では `./certs` が Caddy に **読み取り専用** で
`/certs` としてマウントされます。

**実際の `.pem` / `.key` ファイルは絶対にコミットしないでください。**
