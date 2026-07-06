# Install Fluxer with Docker

Run your own Fluxer instance with Docker Compose. This guide takes you from a
fresh server to a working self-hosted instance with the web app, API, gateway,
admin dashboard, media uploads, search, storage, and voice signaling behind one
public hostname.

This guide covers the stack in this directory (`deploy/self-hosting`). It is
adapted from the upstream
[operator get-started guide](https://docs.fluxer.app/operator/get-started/).

## What you'll run

The self-hosted stack is one Docker Compose project defined in
[`docker-compose.yml`](./docker-compose.yml):

- **Caddy** terminates public HTTP(S) or receives traffic from a Cloudflare Tunnel.
- **App proxy** serves the Fluxer web client and injects instance bootstrap data.
- **API** handles accounts, auth, communities, messages, uploads, admin APIs, and instance discovery.
- **Worker** runs background jobs, the cron scheduler, and voice reconciliation.
- **Admin dashboard** is required and is served at `/admin`.
- **Gateway** handles WebSocket sessions, presence, dispatch, push fanout, and realtime events.
- **Messages, users, snowflakes, and unfurl services** provide sharded backend functionality over NATS.
- **Media proxy** handles attachment upload relay, media metadata, thumbnails, and object reads.
- **Static proxy** serves Fluxer fonts, icons, emoji, badges, default avatars, and voice client assets from the same hostname.
- **LiveKit** handles voice and video signaling and WebRTC media.
- **Postgres**, **Valkey**, **NATS**, **Meilisearch**, and **SeaweedFS** provide data, cache, events, search, and S3-compatible object storage.

Every Fluxer service in this stack is **built from source in this repository**
rather than pulled from a container registry, so you do not need registry access
or pre-published images to run it. The app bundle is served by the self-host
app-proxy container; shared static assets are served by the standalone
`static-proxy` container. The stack does not depend on Fluxer's public static
asset host.

## Requirements

- A Linux server or VM that can run Docker Engine.
- Docker Engine 24 or newer plus the Docker Compose v2 plugin (with BuildKit, which is the default in Compose v2).
- A `git` client and a local clone of this repository, since the images are built from source.
- A hostname for the instance, for example `chat.example.com`.
- Either public inbound `80/tcp` and `443/tcp`, or a Cloudflare Tunnel that routes the hostname to the Caddy container.
- For production voice and video media, a public path to `7881/tcp` and `7882/udp`.
- At least 2 vCPU, 4 GB RAM, and 20 GB disk to run the stack. Building the
  images is more demanding: plan for 4 vCPU, 8 GB RAM, and 30 GB of free disk so
  the Rust and frontend builds have room. Use 4 vCPU and 8 GB RAM or more at
  runtime for a small active community.

The stack idles around a few GB of memory. The first build is the heaviest step
because every Fluxer service is compiled from source; once images are built,
restarts and upgrades reuse the build cache.

## Step 1: Install Docker

Install Docker Engine from Docker's official instructions for your distribution:

- [Install Docker Engine](https://docs.docker.com/engine/install/)
- [Install the Compose plugin](https://docs.docker.com/compose/install/linux/)
- [Linux post-installation steps](https://docs.docker.com/engine/install/linux-postinstall/)

Confirm the versions:

```bash
docker --version
docker compose version
```

Use Docker Engine 24 or newer and the Compose v2 plugin.

## Step 2: Clone the repository

The stack builds every Fluxer service from source, so you need a full clone of
the repository rather than just the Compose files. The build context is the
repository root, and you run the stack from this directory.

```bash
git clone https://github.com/brexelon/zvln-fluxer.git
cd zvln-fluxer/deploy/self-hosting
cp .env.example .env
```

You should now have, in `deploy/self-hosting`:

```text
Caddyfile
docker-compose.yml
livekit.yaml
.env
```

All `docker compose` commands in this guide are run from
`deploy/self-hosting`, and they build images from the source tree two levels up
in the same clone.

## Step 3: Configure `.env`

Set the public hostname at the top of `.env`.

For a normal public server where Caddy obtains certificates directly:

```ini
FLUXER_DOMAIN=chat.example.com
FLUXER_PUBLIC_SCHEME=https
FLUXER_PUBLIC_PORT=443
FLUXER_CADDY_SITE_ADDRESS=chat.example.com
FLUXER_VAPID_EMAIL=admin@example.com
```

For a Cloudflare Tunnel where Cloudflare terminates HTTPS and forwards HTTP to Caddy:

```ini
FLUXER_DOMAIN=chat.example.com
FLUXER_PUBLIC_SCHEME=https
FLUXER_PUBLIC_PORT=443
FLUXER_CADDY_SITE_ADDRESS=:80
FLUXER_VAPID_EMAIL=admin@example.com
```

`FLUXER_PUBLIC_SCHEME` and `FLUXER_PUBLIC_PORT` describe what users see in their
browser. `FLUXER_CADDY_SITE_ADDRESS` describes what Caddy listens on inside the
stack.

Generate the required secrets:

```bash
for key in POSTGRES_PASSWORD MEILI_MASTER_KEY FLUXER_S3_SECRET_KEY \
  FLUXER_SUDO_MODE_SECRET FLUXER_CONNECTION_INITIATION_SECRET \
  FLUXER_GATEWAY_RPC_AUTH_TOKEN FLUXER_MEDIA_PROXY_SECRET_KEY \
  FLUXER_ADMIN_SECRET_KEY_BASE FLUXER_ADMIN_OAUTH_CLIENT_SECRET \
  LIVEKIT_API_SECRET; do
  sed -i "s|^$key=.*|$key=$(openssl rand -hex 32)|" .env
done

sed -i "s|^FLUXER_MEDIA_PROXY_UPLOAD_RELAY_SECRET_BASE64=.*|FLUXER_MEDIA_PROXY_UPLOAD_RELAY_SECRET_BASE64=$(openssl rand -base64 32)|" .env

VAPID=$(docker run --rm node:24-alpine npx --yes web-push generate-vapid-keys --json)
pub=$(printf '%s' "$VAPID" | grep -o '"publicKey":"[^"]*"' | cut -d'"' -f4)
priv=$(printf '%s' "$VAPID" | grep -o '"privateKey":"[^"]*"' | cut -d'"' -f4)
sed -i "s|^FLUXER_VAPID_PUBLIC_KEY=.*|FLUXER_VAPID_PUBLIC_KEY=$pub|" .env
sed -i "s|^FLUXER_VAPID_PRIVATE_KEY=.*|FLUXER_VAPID_PRIVATE_KEY=$priv|" .env
```

Keep these defaults unless you know you need to change them:

- `LIVEKIT_API_KEY=fluxer`; the secret is `LIVEKIT_API_SECRET`.
- `FLUXER_S3_ACCESS_KEY=fluxer`; the secret is `FLUXER_S3_SECRET_KEY`.
- Email starts disabled. Enable SMTP later from `.env` and the admin dashboard.

> [!WARNING]
> **Keep `.env` private.** It contains every secret for the instance. Do not
> commit it, paste it into support tickets, or put it in screenshots. The bundled
> [`.gitignore`](./.gitignore) already ignores `.env` and `.env.*`.

## Step 4: Publish the hostname

### Direct public server

Create DNS records for the hostname:

- `A` record from `chat.example.com` to the server IPv4 address.
- Optional `AAAA` record from `chat.example.com` to the server IPv6 address.

Leave `FLUXER_CADDY_SITE_ADDRESS=chat.example.com`. Caddy will request and renew
certificates automatically when `80/tcp` and `443/tcp` can reach the server.

### Cloudflare Tunnel

Use this when the server should not expose public web ports.

1. Set `FLUXER_CADDY_SITE_ADDRESS=:80`.
2. In Cloudflare, create a Tunnel public hostname for your Fluxer domain.
3. If `cloudflared` runs inside the Compose project, point the public hostname service to `http://caddy:80`.
4. If `cloudflared` runs directly on the host, point the public hostname service to `http://127.0.0.1:80`.

A temporary Compose override keeps the tunnel next to Caddy without saving the
token in your main stack:

```bash
cat > cloudflared.compose.yml <<'YAML'
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel run --token ${CLOUDFLARED_TOKEN:?set CLOUDFLARED_TOKEN}
    depends_on:
      - caddy
YAML

export CLOUDFLARED_TOKEN='paste-your-tunnel-token-here'
docker compose -f docker-compose.yml -f cloudflared.compose.yml up -d cloudflared
```

> [!WARNING]
> **Voice media is not carried by a normal public hostname tunnel.** The web app,
> API, admin dashboard, gateway WebSocket, media proxy HTTP routes, and LiveKit
> signaling can work through the tunnel. LiveKit WebRTC media still needs
> reachable `7881/tcp` and `7882/udp`, or a TURN deployment.

## Step 5: Open the firewall

If you are using a direct public server, allow inbound:

- `22/tcp` or your SSH port.
- `80/tcp` and `443/tcp` for Caddy.
- `7881/tcp` and `7882/udp` for LiveKit media.

If you are using a Cloudflare Tunnel for web traffic, you can block inbound
`80/tcp` and `443/tcp` at the provider firewall. Keep LiveKit media closed too
unless you are intentionally exposing voice/video media or using a TURN server.

> [!WARNING]
> **Provider firewall first.** Docker-published ports can bypass host firewalls
> such as UFW because Docker installs its own packet-filtering rules. Prefer your
> cloud provider's firewall or security group for internet-facing policy.

## Step 6: Build and start the stack

Build the Fluxer service images from source. The first build compiles the Rust
binaries and the web frontend, so it can take a while; later builds reuse the
cache and are much faster.

```bash
docker compose build
```

Start Fluxer:

```bash
docker compose up -d
```

You can also combine the two steps with `docker compose up -d --build`.

If you are using the Cloudflare override from above, start both files together:

```bash
docker compose -f docker-compose.yml -f cloudflared.compose.yml up -d
```

Watch the startup:

```bash
docker compose ps
docker compose logs -f api
```

The first build can take several minutes (or longer on a small server) while the
images compile, and the first start then needs a little more time while services
initialize. `seaweedfs-init` exits after creating object-storage buckets; that is
expected.

## Step 7: Verify the instance

Set your domain in the shell:

```bash
export FLUXER_DOMAIN=chat.example.com
```

Check every public HTTP entry point:

```bash
for path in /_health /api/_health /gateway/_health /media/_health /admin/_health; do
  curl -fsS -o /tmp/fluxer-check -w "$path %{http_code}\n" "https://$FLUXER_DOMAIN$path"
done
```

Expected result:

```text
/_health 200
/api/_health 200
/gateway/_health 200
/media/_health 200
/admin/_health 200
```

Check instance discovery:

```bash
curl -fsS "https://$FLUXER_DOMAIN/api/.well-known/fluxer" | jq '.features.self_hosted, .endpoints.admin, .endpoints.gateway, .endpoints.media, .endpoints.static_cdn'
```

You should see `true`, an admin URL ending in `/admin`, a gateway URL ending in
`/gateway`, a media URL ending in `/media`, and a static asset URL equal to the
instance origin.

If you are using Cloudflare Tunnel and see HTTP `530`, the tunnel connector is not
currently connected or the public hostname route points at the wrong service.

## Step 8: Create the owner account

Open the web app at `https://chat.example.com` and register the first account. On
a self-hosted instance, the first accepted registration receives wildcard admin
access. Use that account for the initial admin login at
`https://chat.example.com/admin`.

Complete the initial setup from the admin dashboard. At minimum, review:

- Branding and instance name.
- Registration mode: open, approval, or closed.
- Email delivery.
- Captcha policy if you open public registration.
- Voice regions and LiveKit reachability if you are enabling voice.

## Email

Email is disabled by default. To enable SMTP, set these in `.env` and restart
`api`, `worker`, and `admin`:

```ini
FLUXER_EMAIL_ENABLED=true
FLUXER_EMAIL_PROVIDER=smtp
FLUXER_EMAIL_FROM_EMAIL=noreply@example.com
FLUXER_EMAIL_FROM_NAME=Fluxer
FLUXER_EMAIL_SMTP_HOST=smtp.example.com
FLUXER_EMAIL_SMTP_PORT=587
FLUXER_EMAIL_SMTP_USERNAME=example
FLUXER_EMAIL_SMTP_PASSWORD=example-secret
FLUXER_EMAIL_SMTP_SECURE=true
```

```bash
docker compose restart api worker admin
```

Then test the SMTP configuration from `/admin/instance-config`.

## Voice and video

Fluxer uses LiveKit for voice and video. Caddy routes `/livekit` to LiveKit's
HTTP/WebSocket signaling port, but browser media flows over WebRTC:

- `7882/udp` is the normal media path.
- `7881/tcp` is the TCP fallback path.
- `7880/tcp` stays private behind Caddy for signaling.

On a VPS with `7881/tcp` and `7882/udp` open, LiveKit can usually auto-detect the
public IP. Behind NAT, Cloudflare Tunnel, or restrictive networks, add a TURN
server and configure LiveKit for it in [`livekit.yaml`](./livekit.yaml).

## Backups

Back up these items before upgrades and on a regular schedule:

- `.env`
- the `postgres-data` volume
- the `seaweedfs-data` volume

For a cold backup:

```bash
docker compose stop api worker gateway admin app-proxy media-proxy static-proxy livekit
docker run --rm -v fluxer_postgres-data:/data -v "$PWD/backups:/backup" alpine tar czf /backup/postgres-data.tgz -C /data .
docker run --rm -v fluxer_seaweedfs-data:/data -v "$PWD/backups:/backup" alpine tar czf /backup/seaweedfs-data.tgz -C /data .
docker compose up -d
```

For production, prefer a Postgres-native dump plus object-storage backup so you do
not need to stop the instance.

## Migrating an existing instance

Use this section to move an existing Fluxer instance onto this stack without
losing any data. The plan is the same whether the old instance ran an earlier
version of this Compose stack, a hand-rolled deployment, or managed services:
carry over the three things that hold state, then let the rebuildable services
re-derive themselves.

What holds state:

- **`.env` secrets.** Reuse the old secrets instead of generating new ones.
  Several of them sign data that already exists. Changing them breaks live
  sessions, push subscriptions, and previously signed media URLs even though the
  underlying rows survive.
- **Postgres** (`postgres-data`). Accounts, communities, messages, and all
  relational data.
- **Object storage** (`seaweedfs-data`). Uploaded attachments, avatars, and other
  media.

What you do not need to migrate:

- **Meilisearch** (`meilisearch-data`) is a search index rebuilt from Postgres.
- **Valkey** is a cache and runs with persistence disabled.
- **NATS** (`nats-data`) carries transient events.

> [!WARNING]
> **Take a backup first.** Snapshot the source instance (see [Backups](#backups))
> before you begin so you can roll back if a step goes wrong.

### Step 1: Set up the new stack but do not start it

Follow [Step 2](#step-2-clone-the-repository) to clone the repository into a new
directory. Stop before `docker compose build` and `docker compose up`. Do not run
the secret-generation commands in [Step 3](#step-3-configure-env) — you will reuse
the old secrets instead.

### Step 2: Carry over `.env`

Copy the secret values from the old instance into the new `.env`. The simplest
path is to start from the old `.env` and only update the hostname block
(`FLUXER_DOMAIN`, `FLUXER_PUBLIC_SCHEME`, `FLUXER_PUBLIC_PORT`,
`FLUXER_CADDY_SITE_ADDRESS`) if it is changing.

At minimum, the following must match the old instance so existing data stays
valid:

```ini
POSTGRES_PASSWORD=
MEILI_MASTER_KEY=
FLUXER_S3_ACCESS_KEY=
FLUXER_S3_SECRET_KEY=
FLUXER_SUDO_MODE_SECRET=
FLUXER_CONNECTION_INITIATION_SECRET=
FLUXER_GATEWAY_RPC_AUTH_TOKEN=
FLUXER_MEDIA_PROXY_SECRET_KEY=
FLUXER_MEDIA_PROXY_UPLOAD_RELAY_SECRET_BASE64=
FLUXER_ADMIN_SECRET_KEY_BASE=
FLUXER_ADMIN_OAUTH_CLIENT_SECRET=
FLUXER_VAPID_PUBLIC_KEY=
FLUXER_VAPID_PRIVATE_KEY=
LIVEKIT_API_SECRET=
```

If the old instance used a different `POSTGRES_PASSWORD` or S3 credentials and you
prefer to keep this stack's new values, that is fine — just make sure the database
and object storage you import in the next steps were created with whatever
credentials end up in `.env`.

### Step 3: Stop the source instance

Take the old instance offline so the data you copy is consistent and nothing
writes to it mid-migration.

```bash
# from the old instance directory
docker compose stop
```

For a managed/external Postgres and S3, put the application into maintenance (stop
`api`, `worker`, and `gateway`) so the dump and object copy are point-in-time
consistent.

### Step 4: Migrate Postgres

The new stack creates an empty `fluxer` database on first start. Replace it with
the data from the old instance.

**If the old instance also used this Compose stack**, the fastest path is to copy
the `postgres-data` volume directly. With both stacks stopped:

```bash
# OLD_PROJECT and NEW_PROJECT are the Compose project names (default: fluxer)
docker run --rm \
  -v OLD_PROJECT_postgres-data:/from \
  -v NEW_PROJECT_postgres-data:/to \
  alpine sh -c "rm -rf /to/* && cp -a /from/. /to/"
```

A raw volume copy only works when both sides run the same Postgres major version
(this stack uses `postgres:16-alpine`). If the versions differ, or the old
Postgres lives elsewhere, use a logical dump instead:

```bash
# Dump from the source (adjust host/user as needed)
pg_dump -Fc -U fluxer -d fluxer -f fluxer.dump

# Start only Postgres on the new stack
docker compose up -d postgres

# Restore into the new database
docker compose cp fluxer.dump postgres:/tmp/fluxer.dump
docker compose exec postgres pg_restore -U fluxer -d fluxer --clean --if-exists /tmp/fluxer.dump
```

### Step 5: Migrate object storage

Bring the uploaded media across so attachments and avatars keep resolving.

**If the old instance used this stack's bundled SeaweedFS**, copy the
`seaweedfs-data` volume the same way as Postgres, with both stacks stopped:

```bash
docker run --rm \
  -v OLD_PROJECT_seaweedfs-data:/from \
  -v NEW_PROJECT_seaweedfs-data:/to \
  alpine sh -c "rm -rf /to/* && cp -a /from/. /to/"
```

**If the old media lived in a different S3-compatible store**, sync each bucket
into the new SeaweedFS instead. Start the storage service and let
`seaweedfs-init` create the buckets first:

```bash
docker compose up -d seaweedfs seaweedfs-init
```

Then sync the buckets (`fluxer`, `fluxer-uploads`, `fluxer-downloads`,
`fluxer-reports`, `fluxer-harvests`) from the old store to the new one with a tool
such as `rclone` or the AWS CLI, pointing the destination endpoint at the
SeaweedFS S3 API on `http://localhost:8333` with the credentials from `.env`.

### Step 6: Start the new stack and reindex search

Build the images and bring the full stack up:

```bash
docker compose up -d --build
```

Meilisearch starts empty. Trigger a search reindex from the admin dashboard
(`/admin`) so message and community search reflects the imported data. Push,
sessions, and signed media URLs continue to work because you reused the
matching secrets.

### Step 7: Verify and cut over

Run the [Step 7 health checks](#step-7-verify-the-instance) against the new
instance, then confirm in the web app that:

- You can log in with an existing account (no re-registration needed).
- Existing messages, communities, and members are present.
- Old attachments, avatars, and other media load.
- Search returns results once the reindex completes.

Once verified, update DNS or your Cloudflare Tunnel to point the hostname at the
new instance. Keep the source instance's backups until you are confident the
migration is complete.

## Upgrading

Because the images are built from source, upgrading means pulling the latest
source and rebuilding:

```bash
git pull
docker compose build
docker compose up -d
```

The `fluxer-static` image is built as part of the same stack, so static asset
updates are picked up by the same rebuild-and-restart flow.

To run a specific release instead of the tip of `main`, check out that release
tag before rebuilding:

```bash
git fetch --tags
git checkout v1.2.3   # replace with the release tag you want
docker compose build
docker compose up -d
```

## Getting help

- File issues and follow development on [GitHub](https://github.com/brexelon/zvln-fluxer).
- See the upstream [operator documentation](https://docs.fluxer.app/operator/get-started/) for additional configuration topics.
