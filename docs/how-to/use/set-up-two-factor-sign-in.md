---
title: How to set up two-factor sign-in
sidebar_position: 13
---

# How to set up two-factor sign-in

Two-factor sign-in asks for a six-digit code from an authenticator app on your phone, in addition to your password, so that a stolen password is not enough to get into your account. This guide switches it on, shows how you sign in afterwards, and switches it off again where that is allowed.

## What you need

You need an authenticator app on your phone, for example Google Authenticator, which makes codes from a shared secret that changes every thirty seconds. When your organization requires two-factor sign-in, you also see the setup the first time that you sign in, and the steps are the same.

## Switch it on

1. Select the menu icon next to the logo at the top of the sidebar, which has the tooltip Settings Menu, choose Settings, and then open the tab Security. The tab has the heading Two-Factor Authentication (2FA), and an information icon explains that an organization that has 2FA enabled makes it compulsory, and that otherwise you can still enable it for your account.
2. Tick Enable 2FA. The dialog Two-Factor Authentication Configuration asks whether you want to turn on 2FA for your account.
3. Select Yes, turn on 2FA. The dialog Enter 2FA Code opens with a QR code.
4. In the authenticator app, add an account by scanning the QR code. When your app cannot scan, the dialog also shows the secret in text, so that you can type it into the app.
5. Type the six-digit code that the app shows into the six boxes. FINOS Workspace checks it as soon as you have typed the last digit, or when you select Submit.

A message says "2FA enabled successfully." When you select Cancel in the dialog instead, 2FA stays off, and the message says "2FA setup cancelled". When the code is wrong, the dialog says "Invalid totp token submitted." and clears the boxes. Codes change every thirty seconds, so type a fresh one.

## Sign in with the code

After you have entered your email address and password, or have signed in through your identity provider, FINOS Workspace asks for a code in the dialog Enter 2FA Code. Type the six digits that the app shows now. When your organization requires two-factor sign-in and you have not set it up yet, FINOS Workspace first shows a page that explains that your company requires two-factor authentication, and its button Generate Token starts the same steps as above.

Keep the authenticator app. When you lose the phone, you cannot sign in, and an admin has to reset the second factor of your account, as [How to reset a password or two-factor sign-in](../administer/reset-a-password-or-two-factor.mdx) describes.

## Switch it off

Untick Enable 2FA in the tab Security and confirm the dialog with Yes, turn off 2FA. A message says "2FA configuration updated". The checkbox is disabled, and its tooltip says "Your organization has 2FA enabled.", when your organization requires 2FA, because only an admin can change that for the organization.

[About sessions and tokens](../../explanation/sessions-and-tokens.mdx) explains how FINOS Workspace signs you in and keeps you signed in.
