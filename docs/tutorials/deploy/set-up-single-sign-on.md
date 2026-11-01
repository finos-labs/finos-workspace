---
title: Set up single sign-on
sidebar_position: 10
---

# Set up single sign-on

Single sign-on lets people sign in to FINOS Workspace with the account that they already use at Google, Microsoft or Okta, so that they need no separate password. This guide turns on one or more of the three providers, says what each needs, and explains who is allowed in. You need to be able to change the environment of the API's container, and to register an application with the identity provider.

## How sign-in with a provider works

The sign-in page shows a button for each provider that you switch on: Sign in with Google, Sign in with Microsoft and Sign in with Okta. When a person selects Google, the browser signs them in at Google and sends Google's token to the API, which checks that Google issued it for your application and takes the email address from it. Microsoft and Okta sign in on the server: the API sends the browser to the provider, and the provider sends it back to a callback address of the API, which takes the email address from the answer. In both cases the API signs the person in as the account with that address, and the browser never holds a secret of a provider.

Google needs its client id in the web app, which starts the sign-in, and in the API, which checks the token. Microsoft and Okta need their values in the API alone, which reads them at startup.

## Choose the providers

Set `AUTHENTICATION_IDENTITY_PROVIDERS` to a comma-separated list of `google`, `microsoft` and `okta`, for example `google,okta`: in the web app, which shows a button for each provider it names, and in the API, which refuses every provider that it does not name. Then set what each provider needs, as the next section lists. When people should sign in only through a provider, also set `AUTHENTICATION_ALLOW_EMAIL_LOGIN` to `false`, which removes the email and password form from the sign-in page.

## Set the values of each provider

Register an application with the provider first, as the provider's documentation describes. For Microsoft and Okta, register the callback addresses of the API as redirect addresses of the application; the table lists them.

| Provider | In the web app | In the API |
|---|---|---|
| Google | `GOOGLE_OAUTH_CLIENT_ID`, the OAuth client id. | `GOOGLE_OAUTH_CLIENT_ID`, the same value. Without it, the API refuses every Google sign-in. |
| Microsoft | — | `AZURE_CLIENT_ID`, the application id of the Microsoft Entra app registration; `AZURE_TENANT_ID`, the id or domain of the tenant, or `organizations` for every work or school tenant or `common`, which adds personal Microsoft accounts; and `AZURE_CLIENT_SECRET`, a client secret of the application. The callback address is `<SELFURL>/app/sign-in/microsoft/callback`. |
| Okta | — | `OKTA_CLIENT_ID`; `OKTA_DOMAIN`, the issuer of the authorization server, such as `https://example.okta.com/oauth2/default`; and `OKTA_CLIENT_SECRET`, a client secret of the application. The callback address is `<SELFURL>/app/sign-in/okta/callback`. |

`SELFURL` is the address at which clients reach the API, as [Serve FINOS Workspace over HTTPS](serve-over-https-and-cors.mdx) describes.

The registration with Microsoft has to send the optional claims `email` and `xms_edov` in the ID token. The claim `xms_edov` says that Microsoft verified the email address. Without it, a person who signs in with Microsoft gets the message "Microsoft has not verified the email address of this account", and has to use a password or ask an admin to change the registration. [Backend settings](../../reference/configuration/backend.mdx) lists every setting of the API with its description.

## Who may sign in

FINOS Workspace trusts the identity provider to decide who may sign in. When a person signs in with a provider:

- If an account with the verified email address exists, the person signs in to that account. A Microsoft account is then linked to the Microsoft identity, so a later change of the email address at Microsoft does not take the account over.
- If no such account exists, FINOS Workspace creates one, with the first name and last name from the provider, in the organization and with the user type that the setting `DEFAULT_USER_MAPPING` names. The init step of a deployment writes this value into `user_create.json`. The new person receives the role Agent User, and an admin gives them more roles later.

So anyone whom your identity provider lets in, and whose address it has verified, gets an account in that default organization as soon as they sign in. Restrict who can reach the application in the identity provider, for example by assigning the application to a group, and not in FINOS Workspace.

To close the door instead, set `DISABLE_REGISTRATION` to `true` in the API. Existing accounts can still sign in, and every path that creates a user answers "Registration is disabled", which includes the first sign-in of a new person through a provider and the invitations of an admin. You then create the organization's people from the command line, as [Provision an organization from a file](provision-an-organization.mdx) describes.

To give a person a place in a particular organization or role before their first sign-in, invite them, as [Add a user](../../features/administration/add-a-user.mdx) describes.

## Pass the provider's token to a data backend

A backend may need to know who the user is. Set `AUTHENTICATION_SEND_MICROSOFT_IDTOKEN` or `AUTHENTICATION_SEND_OKTA_IDTOKEN` to `true`, and the API sends the signed-in user's ID token to data backends in the header `X-Microsoft-Id-Token` or `X-Okta-Id-Token`. The API keeps the token and its refresh token encrypted, renews the token before it expires, and never gives either to the browser. `AUTHENTICATION_SEND_USER_EMAIL_AS_HEADER` sends the email address in the header `X-Workspace-User`. [Widget requests](../../reference/protocols/widget-requests.mdx) describes these headers.

## Check it

Open the sign-in page in a private window. It should show a button for each provider that you switched on, and no form when you turned the email sign-in off. Sign in with a test account of the provider, and check that the account appears in the admin area, under Users, with the roles that you expect. The API limits sign-ins through a provider to five a minute from one network address.
