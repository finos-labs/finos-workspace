---
title: How to choose where files are stored
sidebar_position: 1
---

# How to choose where files are stored

The API keeps the files that people upload, such as documents on a dashboard and the files that they attach to a question, in one place that you choose with the setting `STORAGE_PROVIDER`. This guide lists the providers, what each one needs, and what to check so that every replica of the API sees the same files. Backend settings come from the environment of the API's container and the worker's, and [Backend settings](../../reference/configuration/backend.mdx) lists each one with its description.

## Choose the provider

| `STORAGE_PROVIDER` | Where the files go | What it needs |
|---|---|---|
| `folder` | A folder on a disk that the API reads and writes. This is the default. | `FOLDER_STORAGE_PATH`, the folder, which is `local_storage` next to the API unless you give another path. `LOCAL_STORAGE_SECRET_KEY`, a secret of at least 32 bytes, which signs the temporary links to files and which the API requires with this provider. |
| `aws` | An S3 bucket, or an S3-compatible service. | `S3_FILE_BUCKET`, the bucket for uploaded files. The access keys `S3_ACCESS_KEY` and `S3_SECRET_KEY`, or none when the container gets AWS credentials from its environment, the way AWS clients find them. `S3_REGION`. For a service other than AWS, `S3_ENDPOINT_URL`. |
| `azure` | A container of an Azure storage account. | `AZURE_STORAGE_CONTAINER` and `AZURE_STORAGE_ACCOUNT`, and either `AZURE_CONNECTION_STRING`, or `AZURE_USE_CLI_AUTH` set to `true` so that the API uses the Azure credentials of its environment. |
| `gcp` | Not available. | The setting accepts the value and `GCP_STORAGE_BUCKET` exists, but the provider is not implemented: every operation on a file fails. Use another provider. |

Two more S3 settings are rarely needed. `S3_SIGNATURE_VERSION` is `s3v4` unless a service demands the other value, and `S3_VERIFY_SSL` set to `false` stops the client from verifying the endpoint's TLS certificate, which you should do only for a test.

The setting is read when the API starts, so restart the API and the worker after you change it. Files that were uploaded before the change stay where they are, and the API looks for a file only in the provider that is configured now. Copy the files to the new place before you switch, or accept that older uploads cannot be opened.

## Share the files between the replicas

With `aws` and `azure`, every replica of the API and the worker talk to the same service, so nothing more is needed.

With `folder`, every replica and the worker must see the same folder. Run the API and the worker with the same volume at `FOLDER_STORAGE_PATH`, and give the volume a storage class that several containers can write to at once. The API writes the files, and the worker removes the files that were never confirmed, so a folder that only one of them can write to breaks uploads or the clean-up. When you run one replica on one machine, a plain local volume is enough. Back up the folder together with the database, because a restored database that points at missing files leaves dashboards with widgets that have nothing to show.

## Links to files

The browser opens an uploaded file through a link that carries a signature and an expiry time, so that a link works for a short while and cannot be guessed. The API builds these links from `SELFURL`, the address at which clients reach the API, so set it to the public address of the API, as [How to serve Workspace over HTTPS](serve-over-https-and-cors.mdx) describes. With the `folder` provider, the signature uses `LOCAL_STORAGE_SECRET_KEY`: changing the secret makes every link that was handed out stop working, and it does not harm the files.

## Limit what people upload

The storage provider does not limit the size of what a person uploads. A role does that with its upload limit in gigabytes, which [How to create a role](../administer/create-a-role.md) describes, and the web app refuses a single file above the size that [How to add files to a dashboard](../use/add-files-to-a-dashboard.mdx) names.
