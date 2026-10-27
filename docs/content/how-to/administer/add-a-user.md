---
title: How to add a user
sidebar_position: 1
---

# How to add a user

You add people to your organization from the admin area. This guide creates an account that the person can use at once, invites a person who signs in with a single sign-on provider, imports a list of people from a file, and changes what kind of user someone is. You need an account of type Admin.

## Create an account

1. Open the admin area at `/admin` and select Users in the sidebar.
2. Select Add users, and stay on the tab Add a single user.
3. Fill in First name, Last name and Email address. In Role, you may choose one role to give the person. Every new user also receives the role Agent User, whatever you choose.
4. Leave Bypass invitation selected, and select Add.

Workspace creates the account and shows a link: "Give them this link to set their password. It works once, until" and the time, which is 24 hours from now. Copy the link with the button at its right end and send it to the person yourself, because Workspace sends no email. When the person opens the link, they choose a password and can sign in. The link works once, and the person's password stays unknown to you.

A new account has the type User. A User works with what the organization provides and cannot add connections of their own, as [About roles and access](../../explanation/roles-and-access.md) explains.

## Invite a person who signs in with single sign-on

If your deployment lets people sign in with a provider such as Google, Microsoft or Okta, you can invite them instead of creating an account. Clear Bypass invitation. The button then reads Invite. Workspace records an invitation for the email address, and the account is created when the person first signs in through the provider. The role that you choose in the dialog is not recorded for an invitation, so give the person their role after they have signed in.

A deployment that turned registration off with `DISABLE_REGISTRATION` refuses invitations with "Registration is disabled".

## Import many people from a file

Select Add users and open the tab Import users. Drop a CSV file on the box or choose one, up to 5 MB. The file needs a header row with the columns `first_name`, `last_name` and `email`, and Workspace skips every row whose email address has no `@`. Select Download sample file to get a file of the right shape. Importing sends an invitation to each address, the same as the Invite button, so it suits deployments with single sign-on. When some addresses cannot be invited, a message names the ones that were skipped.

## Change a person's type

Select the Edit user button at the end of the person's row, which opens the User Profile. Choose another value in Type, which offers Admin, Developer and User, and select Save. A Developer can add their own connections and has no usage limits, and a Developer's shares wait for an admin's approval, as [How to approve share requests](approve-share-requests.md) describes.

## Where to go next

To give the person access to data and to the Copilot, put them in a role: [How to create a role](create-a-role.md) and [How to give a role access to data](give-a-role-access-to-data.md). To help someone who has forgotten a password, read [How to reset a password or two-factor sign-in](reset-a-password-or-two-factor.md).
