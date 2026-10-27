---
title: How to run a plugin backend
---

# How to run a plugin backend

The repository ships no runner for plugin backends. When a plugin package contains a `backend/` directory, you build an image from it, run that image in isolation, and list it in `WIDGET_PLUGIN_BACKENDS`. Before the API routes a call to a backend, it asks the backend for `GET /.workspace/identity`, and it routes nothing while the answer does not match the id, the version and the digest of the active version. [Plugin backends](../../reference/plugins/backends.md) describes the protocol.

## What the isolation must achieve

A backend is code that the plugin's author wrote, and the deployment cannot assume that it is harmless. Your platform therefore has to give each backend these properties:

- The backend runs as its own container or pod, as an unprivileged user, with a read-only root file system, no added capabilities, no privilege escalation, and limits on memory and processes.
- The backend has no mounts from the deployment and no network route to the database, the cache, the storage or the API's other endpoints.
- The only way into the backend is a gateway that forwards the API's calls. The only way from the backend to the API is `POST /internal/plugin-broker/...`, which the gateway passes through.
- The only way out of the backend to the internet is an egress proxy that allows exactly the hosts that the plugin's approved server network names.

## Run the backend

1. Build an image from the package's `backend/` directory. Build it from the same files that were approved, so that the identity answer carries the approved digest.

2. Deploy the image with the isolation above. On Kubernetes, the workload carries the container restrictions in its security context:

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

   A network policy then restricts the traffic. This policy lets only the gateway reach the backend, and lets the backend reach only the egress proxy and the DNS service:

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

   The gateway is a reverse proxy that you run next to the backends. It forwards the API's calls to each backend, and from the backends it passes only `POST /internal/plugin-broker/...` to the API. The egress proxy is a forward proxy that allows only the approved hosts. Other platforms express the same rules in their own terms.

3. Name the backend in the API's environment with `WIDGET_PLUGIN_BACKENDS={"<plugin-id>": "<internal URL>"}`. The URL is an `http` or `https` URL, or `unix:<socket path>`. When you use the gateway, the URL is the gateway's address.

4. Give the backend the web app's origin, so that it can send it as its `Origin` header when it reads data through the broker. Every caller of the API must send an allowed origin, and the API refuses requests from other origins.

5. Ask a superuser to check the backend. The plugin's Backend section has a Check now action, and the command `plugin check-backend <plugin-id>` does the same.

The API's own kill switch is to stop routing calls to a backend. Stopping the workload is the deployer's task. A host that belongs to the deployment and not to the package, such as its database, is added by a superuser's override of the server network.
