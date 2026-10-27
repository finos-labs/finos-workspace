---
title: How to reset a password or two-factor sign-in
sidebar_position: 2
---

# How to reset a password or two-factor sign-in

A person who has lost a password or the device for their authenticator cannot reset it alone: the sign-in page says "Ask your admin to reset your password". This guide shows how an admin helps, and how to end an account when someone leaves. You need an account of type Admin, and the person must belong to your organization.

## Reset a password

1. Open the admin area at `/admin` and select Users.
2. Select the Edit user button at the end of the person's row. The User Profile opens.
3. In the General information section, select the key icon, whose tooltip reads Reset password.
4. Confirm with Yes, reset password.

The dialog says that the password of the account no longer works and that every session of the account has ended. It shows a link that you copy and give to the person. The link works once and for 24 hours, and when the person opens it they choose a new password. Workspace sends no email, so you have to pass the link on yourself. The person never learns the old password and you never learn the new one.

The icons are not shown for your own account. Another admin can reset yours, or the person who operates the deployment can run the admin command `user reset-password` with your email address in the API container, as [Admin command line](../../reference/command-line/admin-cli.mdx) describes. That command works before anyone can sign in, which is how the first administrator of a deployment gets a password.

## Reset two-factor sign-in

When an organization requires an authenticator, each person sets one up. If a person loses their device, select the lock icon, whose tooltip reads Reset 2FA, in the same section of the User Profile. Confirm with Yes, reset 2FA. A message says that 2FA has been reset for the account. The person can then set up a new authenticator the next time they sign in.

## Remove or delete an account

The same section has two more icons.

- Delete account, the trash icon, removes the account. The dialog says that access to Workspace and all API keys will be revoked.
- Remove from organization, the slash icon, takes the account out of your organization. The dialog says that access to the organization and all API keys will be revoked. The icon appears only in deployments where the feature is turned on.

Deleting or removing an account ends the person's sessions at once. A removed person cannot sign in until a superuser moves the account into an organization again, with the action Move user in Entities, in the tab All users.

## What a reset does not do

A reset leaves the person's dashboards, roles and chats in place. It ends the sessions of the account, and with them the agent tokens that came from those sessions, as [About sessions and tokens](../../explanation/sessions-and-tokens.md) explains.
