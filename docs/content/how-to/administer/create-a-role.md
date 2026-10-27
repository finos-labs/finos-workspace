---
title: How to create a role
sidebar_position: 3
---

# How to create a role

A role is a named set of grants that you give to some of your organization's people. This guide creates a role with a daily allowance for the Copilot, a sharing level and a list of members. The role does not yet grant access to data or choose models, and the next two guides do that. You need an account of type Admin.

## Create the role

1. Open the admin area at `/admin` and select Roles and Access. The page opens on the tab Roles and Permissions, which lists the roles of your organization.
2. Select Create new role. The dialog opens.
3. Type a Name. Add a Description if you like, which helps the next admin to see what the role is for.
4. Choose Sharing. None means that the role's members neither share nor receive dashboards and apps. Receive only means that they can be given dashboards and apps by others. Can share means that they may share and receive.
5. Set the limits. Agent calls per day is the number of questions that a member may ask the Copilot in a day, Agent tokens per day is the number of model tokens that a member may use in a day, and Upload size (GB) is the amount of storage that a member may use for uploads. Each limit has a No limit checkbox, which is selected at first. Clear it to type a number.
6. Under the limits, two checkboxes decide whether the Copilot may search the web, "Copilot may search the web (SEARCH_WEB)", and whether it may read pages from the web, "Copilot may read pages from the web (FETCH_FROM_WEB)". Both are selected at first.
7. Open Add members and select the people who should have the role. The list offers the users of your organization and has a search box and a Select all checkbox. Close the list when you are done.
8. Select Create role.

A message says "Role created", and the role appears in the table with its members.

## What the limits mean

A limit counts for each person and each day, and the counts reset at midnight UTC. When a person's next question would exceed the daily number of questions, the Copilot answers `Cannot increment usage beyond the maximum limit of` followed by the limit. When the person has already used the daily number of tokens, it answers that the daily token limit of that number has been reached. A question that is under way when the token limit is crossed finishes, and the next question is the one that is refused. A limit of 0 refuses every question.

A person with several roles gets the highest limit of their roles, and a role with No limit beats any number, so adding a role never takes allowance away. A person with no role at all gets 0. [About roles and access](../../explanation/roles-and-access.md) explains this rule and the others.

## Change or delete the role

Hover the role's row. Five icons appear at its right end. In the order that they appear, they are Edit permissions, Agent models and tools, Widget plugins, Edit role and Delete role. Edit role opens the same dialog that you used to create the role, with its values filled in, and it lets you add and remove members. Delete role asks you to confirm. Deleting a role removes its grants from its members, and shares that depended on it are withdrawn if a member can no longer share.

## Where to go next

A new role grants nothing beyond what you set here. Choose its models and tools with [How to choose the models and tools of a role](choose-the-models-and-tools-of-a-role.md), and give it access to data with [How to give a role access to data](give-a-role-access-to-data.md).
