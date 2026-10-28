---
title: How to connect FINOS Workspace to its database and cache
sidebar_position: 3
---

# How to connect FINOS Workspace to its database and cache

The API keeps its data in a relational database, and it keeps what is short-lived, such as tokens, rate limits and job queues, in Valkey or Redis. This guide chooses the database engine, sets the connection of the API and its worker to both, and lists what must be shared when you run several replicas. [Backend settings](../../reference/configuration/backend.mdx) lists every setting with its description.

## Choose the database engine

`DATABASE_TYPE` selects the engine, and the API and the worker must use the same one.

| `DATABASE_TYPE` | Use it for | What it needs |
|---|---|---|
| `mysql` | The default. It suits a deployment. | `DB_HOST`, `DB_PORT`, `DB_NAME`, and two accounts: `WRITE_DB_USER` with `WRITE_DB_PASSWORD`, and `READ_DB_USER` with `READ_DB_PASSWORD`. |
| `postgresql` | A deployment that runs on PostgreSQL. | The same settings as `mysql`. |
| `sqlite` | One machine, such as a trial or a development setup. | `DB_PATH`, the path of the database file, which is `local.db` unless you give another. The API and the worker need the same file. |

The two accounts of `mysql` and `postgresql` may be one and the same. The write account runs the migrations and every query that changes data, and the read account runs queries that only read, so a deployment can give the read account fewer rights. The settings name one server for both. The database itself has to exist and the write account has to be able to create tables in it, because the first start creates the tables, as [How to run database migrations](run-database-migrations.mdx) describes.

Set `SSL_CA`, `SSL_CERT` or `SSL_KEY` to make the connection to the database use TLS. `SSL_CA` is the certificate authority file with which the API checks the server's certificate, and `SSL_CERT` and `SSL_KEY`, which you give together, are the certificate and the key that the API presents to the server. Mount the files into the API's container and into the worker's.

`WORKERS` is the number of processes that serve requests in one API container, three unless you change it. The API sizes its pools of database connections so that all of its processes together stay under the limit of the engine, so a larger `WORKERS` does not need a bigger database, but several replicas each add their own connections: add the numbers of all containers when you check the server's limit.

## Connect Valkey or Redis

FINOS Workspace uses Valkey, and any Redis-compatible server works. Set `REDIS_HOST` and `REDIS_PORT`, which is 6379. Set `REDIS_PASS` as well, and leave it empty when the server has no password: the variable has to exist. `REDIS_USER` names the user when the server has users.

The API keeps two kinds of data in two databases of the server:

- `REDIS_DB_APP`, which is 1, holds what the API keeps for a short time: the tokens of the agent, the links that reset a password, the nonces of sign-in, the state of the sign-in to MCP servers, the counts of usage, pending uploads, signed file links, the rate limits and the lock of the migrations.
- `REDIS_DB_BOT`, which is 0, holds the job queues and the workers of the queue library RQ.

Both settings are ignored when you use a Redis Cluster.

For a connection with TLS, set `REDIS_SSL_CA`, or `REDIS_SSL_CERT` and `REDIS_SSL_KEY`. The API then connects to `REDIS_SSL_PORT`, which is 6380, and `REDIS_SSL_CERT_REQ` decides how strictly it checks the server's certificate: with `none` the connection uses TLS without verifying the certificate. For a Redis Cluster, set `REDIS_CLUSTER_MODE` to `true`, and set `REDIS_RQ_HASH_TAGS` to `true` for a sharded server that does not expose cluster endpoints.

The agent and its MCP server use the same server through `REDIS_URL`, as [How to run the agent on several replicas](run-the-agent-on-several-replicas.mdx) describes.

## What to share when you run several replicas

Every replica of the API, and the worker, must use the same database, the same Valkey and the same secrets. The secrets that matter are `JWT_SECRET`, which signs the service tokens, and `WORKSPACE_AES_KEY`, which encrypts what the API stores: the keys of providers, the headers of connections and of MCP servers, and the secrets of authenticators. The API does not start without either of them. Changing `WORKSPACE_AES_KEY` after the database holds data makes that data unreadable, and changing `JWT_SECRET` ends every token that it signed, so treat both as part of the database's backup.

## Check it

When the API's container starts, it runs the migrations first, and a database that it cannot reach or write to stops the start with the message "Database migrations failed" and the reason above it in the log. Once the API is up, its path `/health` answers 200, which is the path that a platform's health check should use. The path does not touch the database, so it tells you that the process runs and not that the database is healthy.
