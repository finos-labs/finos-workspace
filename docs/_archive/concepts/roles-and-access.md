---
title: Roles and access
sidebar_position: 4
---

# Roles and access

Two things decide who may do what in FINOS Workspace. A user's type says what kind of user the person is, and the roles that an admin assigns say what the person is granted. Nothing is allowed unless a role grants it. This page explains the pieces, how several roles combine, and why the system works this way. The steps for an admin are in the guides, and the exact fields are in the [FINOS Workspace API reference](../reference/http-api/workspace-api.mdx).

## Organizations, user types and roles

An **organization** is the unit that an admin manages. Every user belongs to exactly one organization, and every role belongs to one as well, so a role never reaches users of another organization. A user who moves to another organization loses the roles of the old one.

A **user type** is one of three: Admin, Developer or User. The type does not grant data. It decides which capabilities exist for the person at all.

- An **Admin** manages the organization: its users, roles, apps and settings, and the approvals that this page describes. Admins can also add connections.
- A **Developer** can add connections: their own data backends, MCP servers, file widgets and custom agents, and they can upload files. A Developer has no usage limits, because their work is to build and test. Whatever a Developer shares waits for an admin's approval.
- A **User** works with what the organization provides. A User cannot add connections of their own, so they see only the backends that one of their roles grants, and the MCP servers that every user has by default.

A **role** is a named bundle of grants that an admin gives to some of the organization's users. A role can grant several kinds of thing:

- Access to data: which backends a user may use, within each backend which widgets and which apps, and which of the organization's files and prompts.
- Access to the Agent: which models a user may choose, and which tools of which MCP servers the Agent may call for the user.
- Limits: how many Agent questions and tokens a user may use in a day, and how much a user may upload. A role may leave a limit unset, which means the role imposes no limit.
- Sharing: whether the role's users may share dashboards and apps, may only receive what others share, or may do neither.
- Web access for the Agent: whether it may search the web and whether it may fetch web pages.

## The roles that every organization starts with

A new organization comes with two roles, so that a fresh deployment works before anyone has designed an access model. The role **Agent User** grants every model that the default agent offers and every tool of the deployment's default MCP servers. It sets no limits, and it gives no sharing. The role **Sharer** lets its users share dashboards and apps, and it takes away everything else: its Agent limits and its upload limit are zero, and web search and page fetching are off. Every new user receives Agent User in addition to any role that the admin chose when creating the person. The first administrator of a deployment receives both roles. An admin can change or delete these roles like any other, and a user who has neither role and no other grants can do nothing with the Agent.

## How roles combine

A user can have several roles, and the grants add up. A user may use a backend, a model or a tool if any one of the user's roles allows it. The backend may be one that an admin connected or one that an admin added for the organization. A user that has no role gets no shared data and no models, and the Agent answers each question with a notice that the user's roles do not allow the model, because the Agent's rule is the same strict one: a model and the tools of an MCP server work for a user only if a role names them. A grant of "all models" or "all tools" of a server exists for the roles that want it, but nobody gets it by default.

The other kinds of grant combine in the way that suits them. The highest limit wins, and a role with no limit beats any role with one, so that adding a role never takes a user's allowance away. A user with no role at all gets a limit of zero. The highest sharing level wins, in the order none, receive and share. The web capabilities are on when any role turns them on, and a deployment's administrator can therefore switch web search off for a user only by making sure that none of the user's roles allows it.

## Sharing

A user shares a dashboard or an app with named colleagues, or with the whole organization. The user's roles must give the sharing level `share`, and each recipient needs `receive` or `share`. An organization also has a master switch, which a superuser controls, and when it is off nobody in the organization can share or receive.

A Developer's share does not take effect at once. It becomes a request that waits in the admin's list of share requests, and an admin approves or declines it. The recipient sees the item after approval.

Changing roles can take sharing away. When a change leaves a user unable to share, the shares that the user made are withdrawn and the user's pending requests are removed. When it leaves a user unable to receive, the shares that the user had received are withdrawn. The change happens when the role changes, so nobody keeps access to a dashboard because a share was made earlier.

## Why access is strict

The alternative to this design is to allow everything by default and let an admin switch things off. That is simpler to start with, but it makes every new capability a hole until someone closes it, and it makes the question "what can this person do?" hard to answer, because the answer is everything minus a list. With strict grants, the answer is the sum of the person's roles. An admin can read a role and know what it allows, and a new tool or a backend that someone connected is invisible to everyone else until a role names it. The same rule covers the Agent, whose tools run as the user and are checked against the user's roles when the browser sends a call and again when the agent asks whether a request is allowed.

A limit is a ceiling, not a floor, so having a role never makes a user worse off. The highest limit among a user's roles applies. A Developer has no limits.

## When a change takes effect

A role change takes effect on the user's next request to the API, and the usage totals that the app shows refresh within a few minutes. For the Agent it takes effect on the next question, because the agent asks the API what a user may do on every request. A change to a role's grants never needs the user to sign in again.
