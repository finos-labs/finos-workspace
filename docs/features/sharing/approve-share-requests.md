---
title: Approve share requests
sidebar_position: 7
---

# Approve share requests

When a Developer shares a dashboard or an app, the share does not take effect at once. It becomes a request that waits for an admin. This guide approves or declines the requests of your organization. You need an account of type Admin.

## Review the requests

Open the admin area at `/admin`, select Roles and Access and open the tab Share requests. Each request is a row. The row shows who asked, the item, which is a dashboard or an app with its name, who it would be shared with, and the date of the request. A share with the whole organization reads "Everyone in the organization" under Shared with.

When there are no requests, the page says "No share requests" and explains that a share waits there when a developer shares a dashboard or an app, until an admin approves it.

## Approve or decline

Select Approve to let the share take effect. The recipients then see the dashboard or app in their sidebar under Shared with me. Select Decline to remove the request without sharing. The person who asked is not told, because FINOS Workspace sends no messages, so tell them yourself when you decline.

## Who needs approval

Only Developers' shares wait for approval. An Admin or a User whose roles give the sharing level Can share shares directly. A person whose roles give Receive only or None cannot share at all, and the Share option does not appear in their menus.

## What happens when roles change

Requests depend on the requester's right to share and on the recipient's right to receive. When a change of roles takes either right away, FINOS Workspace removes the requests that depended on it, so the list never shows a request that could not be approved.
