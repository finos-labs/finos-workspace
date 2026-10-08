#!/bin/bash

# This bash function should be added to `~/.zschr` or `~/.bashrc`
# so that it can be called from anywhere in the shell.

# Description:
    # Build, tag and push docker images to AWS ECR
# Usage:
    # dockerbackend -v|--version version -d|--dev|-p|--prod
# Options:
    # -v|--version: version of the docker image
    # -d|--dev: build and push to the dev ECR repository ($DOCKERBACKEND_DEV_REPO)
    # -p|--prod: build and push to the prod ECR repository ($DOCKERBACKEND_PROD_REPO)
# Environment:
    # DOCKERBACKEND_DEV_REPO, DOCKERBACKEND_PROD_REPO: full repository URIs,
    # e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com/workspace-backend

# Example: DOCKERBACKEND_DEV_REPO=... dockerbackend -v 0.1.0 -d

function dockerbackend () {
    local version aws tag repo dev_repo prod_repo

    dev_repo="${DOCKERBACKEND_DEV_REPO}"
    prod_repo="${DOCKERBACKEND_PROD_REPO}"

    while [[ $# -gt 0 ]]; do
        key="$1"
        case $key in
            -v|--version)
                version="$2"
                shift
                shift
                ;;
            -d|--dev)
                aws="dev"
                shift
                ;;
            -p|--prod)
                aws="prod"
                shift
                ;;
            *)
                shift
                ;;
        esac
    done

    if [[ -z "$version" ]] || [[ -z "$aws" ]]; then
        echo "Missing arguments. Options are -v|--version, -d|--dev, and -p|--prod"
        return 1
    fi

    if [[ $aws == "dev" ]]; then
        repo=$dev_repo
    elif [[ $aws == "prod" ]]; then
        repo=$prod_repo
    fi
    if [[ -z "$repo" ]]; then
        echo "Set DOCKERBACKEND_DEV_REPO or DOCKERBACKEND_PROD_REPO to the ECR repository URI"
        return 1
    fi
    tag="${repo##*/}"
    echo "Building payments_backend:${version} and payments_worker-${version}"

    docker build -t $tag:payments_backend-$version -f fastapi.Dockerfile .
    docker build -t $tag:payments_worker-$version -f rqworker.Dockerfile .

    docker tag $tag:payments_backend-$version $repo:payments_backend-$version
    docker tag $tag:payments_worker-$version $repo:payments_worker-$version

    docker push $repo:payments_backend-$version
    docker push $repo:payments_worker-$version
}