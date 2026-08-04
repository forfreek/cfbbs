# CFBBS outbound email gateway

This is a small outbound-only SMTP submission gateway. It does not accept
incoming mail, host mailboxes, expose MX/IMAP, or act as an open relay.

## lukeserver setup

```sh
sudo useradd --system --home /opt/cfbbs-email-gateway cfbbs-mail
sudo install -d -o cfbbs-mail -g cfbbs-mail /opt/cfbbs-email-gateway /var/lib/cfbbs-email-gateway /etc/cfbbs
sudo install -m 0755 app.py /opt/cfbbs-email-gateway/app.py
sudo install -m 0600 /dev/stdin /etc/cfbbs/email-gateway.env <<'EOF'
LISTEN_HOST=127.0.0.1
LISTEN_PORT=8788
STATE_DB=/var/lib/cfbbs-email-gateway/state.sqlite3
GATEWAY_TOKEN=replace-with-a-long-random-token
SMTP_HOST=smtp.feishu.cn
SMTP_PORT=465
SMTP_SECURITY=ssl
SMTP_USERNAME=cfbbs-test@lukelzlz.top
SMTP_PASSWORD=fill-after-secure-handoff
SMTP_FROM=cfbbs-test@lukelzlz.top
EOF
sudo install -m 0644 cfbbs-email-gateway.service /etc/systemd/system/cfbbs-email-gateway.service
sudo systemctl daemon-reload
sudo systemctl enable --now cfbbs-email-gateway
curl -fsS http://127.0.0.1:8788/healthz
```

Put the `nginx.location.conf` locations in the selected HTTPS virtual host,
then run `nginx -t` and reload nginx. The public Worker URL should be a base
ending in `/email-gateway/`, for example `https://mail-gateway.example/email-gateway/`.

The SMTP password and gateway token must never be committed or printed. The
gateway enforces one recipient per request, fixed transaction kinds, a fixed
From address, 200 requests per 100 seconds, and 100 messages per day.
