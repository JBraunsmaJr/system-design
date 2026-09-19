# Self Hosted Compose

```yaml
services:
  
  editor:
    image: ghcr.io/jbraunsmajr/system-design:${EDITOR_VERSION:-latest}
    environment:
      VITE_SIGNALING_URL: ${RELAY_URL:-wss://relay.example.com}
      
      # The DNS entry that points to the host this editor is running on.
      APP_URL: ${EDITOR_URL:-https://editor.example.com}
    container_name: system-design-editor
    hostname: editor
    restart: unless-stopped
  
  relay:
    image: ghcr.io/jbraunsmajr/system-design-relay:${RELAY_VERSION:-latest}
    container_name: system-design-relay
    hostname: relay
    restart: unless-stopped
  
  proxy:
    image: nginx:alpine
    container_name: system-design-proxy
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - "./nginx.conf:/etc/nginx/conf.d/default.conf:ro"
      - "./certs:/etc/nginx/certs:ro"
    restart: unless-stopped
    depends_on:
      - relay
      - editor
```

`nginx.conf`
```conf
server {
    listen 443 ssl;
    server_name design.internal;
    
    ssl_certificate /etc/nginx/certs/design.crt;
    ssl_certificate_key /etc/nginx/certs/design.key;
    
    location /relay {
        proxy_pass http://relay:4444/;
        proxy_http_version: 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
    
    location / {
        proxy_pass http//editor
        proxy_set_header Host $host;
    }
}
```

If you are in an air-gapped environment, you will need to deploy a `TURN` server, unless one is provided for you. Add
the following to the above compose configuration to add the TURN service.

```compose
coturn:
    image: coturn/coturn:latest
    container_name: coturn
    network_mode: host
    volumes:
        - "./turnserver.conf:/etc/coturn/turnserver.conf:ro"
    restart: unless-stopped
```

`turnserver.conf`
```conf
listening-port=3478
fingerprint
lt-cred-mech
realm=editor.internal
user=webtrc:CHANGEME-long-random-string
min-port=49160
max-port=49200
no-tls
no-dtls
verbose
log-file=stdout
no-stdout-log=false
```

