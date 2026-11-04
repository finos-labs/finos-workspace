#!/bin/bash

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
    echo "Building payments_backend-${version}"

    docker build -t $tag:payments_backend-$version -f fastapi.Dockerfile .

    docker tag $tag:payments_backend-$version $repo:payments_backend-$version

    docker push $repo:payments_backend-$version
}