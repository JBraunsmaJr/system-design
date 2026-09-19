# Self Hosted Compose

```yaml
<!--@include: @/files/deployment.compose.yml -->
```

::: details Nginx Sample Configuration
`nginx.conf`
```conf
<!--@include: @/files/nginx.conf -->
```
:::


::: details Air Gapped Deployment
Air-gapped networks will need a TURN server. This is required for WebRTC to function in such an environment.
Use the snippets below to add the TURN service. 

```yaml
<!--@include: @/files/turnserver.compose.yml -->
```

`turnserver.conf`
```conf
<!--@include: @/files/turnserver.conf -->
```
:::
