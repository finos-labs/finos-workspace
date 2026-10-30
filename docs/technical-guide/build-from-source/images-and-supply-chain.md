---
title: About the container images and the supply chain
sidebar_position: 3
---

# About the container images and the supply chain

FINOS Workspace ships its services as container images, and the images have an unusual shape: each one is built `FROM scratch` and holds only what its service runs. There is no shell in them, no package manager and no operating system that is not needed. This page explains how that is done, why, and what it changes for the people who run and audit a deployment. [Run FINOS Workspace on your machine](run-the-stack-from-source.md) starts the images, and [How to serve FINOS Workspace over HTTPS and set the addresses](../deploy/serve-over-https-and-cors.mdx) says what a deployment has to provide around them.

## What an image holds

A common image starts from a Linux distribution and adds the program to it, and the distribution brings a shell, a package manager, many libraries and many tools that the service never uses. Each of them is something to patch, something to audit and something for an attacker to use. The images of FINOS Workspace work the other way round. A build stage assembles exactly what the service needs into a directory, and the final stage starts from nothing and copies that directory in.

- **The API and the worker** run from one image. It holds a pinned CPython from a standalone build for musl, which the build checks against a hash, the Python packages from the lock file, and the few system libraries that those packages link. Packages that ship compiled wheels are built from source with clang, so that the result links the same libraries as the rest of the image. The build stops when any file in the image needs the runtime libraries of GCC.
- **The web app** holds nginx, compiled in the build into one static binary with its modules and its libraries, and the built app. Nothing else is in the image.
- **Ines and its MCP server** hold Node and their packages. Node is compiled from source against musl and LLVM's C++ library, and it links no glibc and no GCC runtime.

The services run as an ordinary user, with the identifier 1000 for the backend image, which the API and the worker share, and for the agent images, and 101 for the web app, and they listen on ports above 1024.

## Node is built once and released

All of the Node-based images start from the same Node, so FINOS Workspace builds it once and publishes it as a release called `finos-node`. A release is made by pushing a tag of the form `finos-node-v<Node version>-<build>`, such as `finos-node-v26.12.1-1`. The workflow checks that the tag names the Node version that the agent's Dockerfile builds, and it refuses to replace a release that exists. It then publishes the image to the container registry, and it attaches to a GitHub release the image's file system as a tarball, a file of checksums and the image's software bill of materials. The release is attested, so that `gh attestation verify` can confirm where the image and the tarball came from. The notes of each release list every component in the image with its version and its licence, and the same list is in the image as `/usr/share/sbom/runtime.cdx.json`. The builds of the other images and the tests of the web app and the agent take Node from that release, by its tag or its digest, so that what is tested is what is shipped.

## Licences

A project of the FINOS Foundation may depend only on software whose licence the Foundation accepts. Its policy sorts licences into categories. Category A holds permissive licences such as Apache-2.0, MIT and BSD. Category B holds licences that carry conditions on how a component is used or distributed. Category X holds the licences that are not accepted. FINOS Workspace holds itself to the policy in every part of the repository, including the images, so the release notes of the Node image state that every component in it is under a Category A or Category B licence, and the build of the API image writes the licence of each of its runtime components into the image's list.

Some packages offer a choice of licences, and some state none in their metadata. The file `NOTICE` at the root records each such case, with the licence that FINOS Workspace selects for a package that is offered under several, and the licence that a package's own file states when its metadata does not.

## Bills of materials

A bill of materials, or SBOM, lists what a piece of software is made of. FINOS Workspace keeps two kinds. The image of the API and the image of Node carry a list of their runtime components, with versions and licences, in CycloneDX format. The folder `sbom` of the repository holds the list of the packages of each project, one file for the web app, one for the agent and one for the backend. A workflow regenerates those files after every change to a dependency file on the integration branch, and it opens a pull request with the files that changed, so that the lists always match the lock files.

## Where the images are built

A pull request that changes the backend, the web app or their image workflows builds the images to prove that they build, and it pushes nothing. That is the work of `backend-image.yml` and `frontend-image.yml`. A tag of the form `backend-vX.Y.Z` or `frontend-vX.Y.Z` on a commit of `main` pushes the release image to Amazon ECR, and attests its bill of materials and its build provenance. When a change to the backend, the web app or the agent reaches `develop`, `deploy-dev.yml` builds every image, pushes it with the tag `dev-` followed by the commit hash, and deploys the images to the dev environment. The application's settings are defaults in its code, and the values that the dev environment sets differently are in the infrastructure repository that the workflow names.

The workflows read the repository variables `AWS_REGION` and `AWS_IMAGE_PUSH_ROLE_ARN`. `deploy-dev.yml` also reads `ECR_REGISTRY`, `INFRA_APP_ID`, `INFRA_REPO` and `DEV_VALUES_FILE`, and the secret `INFRA_APP_PRIVATE_KEY`.

## What this means for the people who run it

Because the images have no shell, `docker exec` into a container gives a command, not a prompt: you can run the program that the image holds, such as `python -m scripts.workspace_admin` in the API's container or `node -e` in the agent's, and nothing else. A tool that you would normally install into a container is not there, so debugging uses the logs, the metrics and the health checks, which [How to ship logs and metrics](../deploy/ship-logs-and-metrics.mdx) describes. Files that a service writes go to the few folders that the image makes writable for its user, such as the folder for uploaded files, and a platform can mount the rest read-only. The cost of all this is paid once, in the build. The result is that the number of things that a deployment has to patch, scan and explain is small, and that every one of them is on a list.
