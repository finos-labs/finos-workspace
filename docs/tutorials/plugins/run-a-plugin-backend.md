---
title: Run a plugin backend
sidebar_position: 2
---

# Run a plugin backend

Build the `backend/` directory of a plugin into an image, run it in isolation, and tell the API where it is. The repository ships no runner for plugin backends.

Before the API routes a call to a backend, it asks the backend for `GET /.workspace/identity`. It routes nothing while the answer does not match the id, the version and the digest of the active version. [Plugin backends](../../reference/plugins/backends.mdx) describes the protocol.

## What the isolation must achieve

A backend is code that the plugin's author wrote, and a deployment cannot assume that it is harmless. Your platform has to give each backend these properties:

- It runs as its own container or pod, as an unprivileged user, with a read-only root file system, no added capabilities, no privilege escalation, and limits on memory and processes.
- It has no mounts from the deployment, and no network route to the database, the cache, the storage or the API's other endpoints.
- The only way in is a gateway that forwards the API's calls.
- The only way to the API is `POST /internal/plugin-broker/...`, which the gateway passes through.
- The only way out to the internet is an egress proxy that allows exactly the hosts that the plugin's approved server network names.

## 1. Build the image

Build it from the package's `backend/` directory, from the same files that were approved. Then the identity answer carries the approved digest.

## 2. Deploy it with the isolation

On Kubernetes, set the container restrictions in the security context:

```yaml
containers:
  - name: plugin-<plugin-id>
    image: <the image built from the plugin's backend/>
    securityContext:
      runAsNonRoot: true
      runAsUser: <unprivileged uid>
      readOnlyRootFilesystem: true
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
    resources:
      limits:
        memory: <limit>
        cpu: <limit>
```

Then restrict the traffic with a network policy. This one lets only the gateway reach the backend, and lets the backend reach only the egress proxy and the DNS service:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: plugin-<plugin-id>
spec:
  podSelector:
    matchLabels:
      app: plugin-<plugin-id>
  policyTypes: ["Ingress", "Egress"]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: plugin-gateway
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: plugin-egress
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
```

The two parts around the backend:

- **The gateway** is a reverse proxy that you run next to the backends. It forwards the API's calls to each backend, and from the backends it passes only `POST /internal/plugin-broker/...` to the API.
- **The egress proxy** is a forward proxy that allows only the approved hosts.

Other platforms express the same rules in their own terms.

## 3. Tell the API where the backend is

Set this in the API's environment:

```
WIDGET_PLUGIN_BACKENDS={"<plugin-id>": "<internal URL>"}
```

The URL is an `http` or `https` URL, or `unix:<socket path>`. When you use the gateway, it is the gateway's address.

## 4. Give the backend the web app's origin

The backend sends the origin as its `Origin` header when it reads data through the broker. The API refuses requests from origins that are not allowed.

## 5. Check the backend

Ask a superuser to run **Check now** in the plugin's Backend section, or run:

```bash
plugin check-backend <plugin-id>
```

## Stop a backend

The API's own kill switch stops it from routing calls to a backend. Stopping the workload is the deployer's task. To allow a host that belongs to the deployment and not to the package, such as its database, a superuser adds it with an override of the server network.
