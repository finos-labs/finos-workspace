# Deploying the Workspace Add-in for Excel in an organization

The add-in is a static web application plus a `manifest.xml` that tells Excel where to load it from
and how to show it. Deploying it takes two roles: the person who builds it, and the administrator of
the Microsoft 365 organization who hosts and distributes it.

## Building (developer)

| Step | Action | Details |
| :-- | :-- | :-- |
| 1 | Configure the environment | Copy `.env.example` to `.env`. Set `ADDIN_BASE_URL` and `VITE_ADDIN_BASE_URL` to the address where the organization will host the add-in, for example `https://addin.example.org`. The build writes `ADDIN_BASE_URL` into `manifest.xml`. |
| 2 | Point it at the Workspace | Set `VITE_BACKEND_URL` to the address of the organization's Workspace backend. It is compiled into the bundle: the add-in signs in there. |
| 3 | Set the identity of the add-in | Set `ADDIN_UUID` to a GUID that you generate for this deployment. Set `ADDIN_HELP_URL` and `VITE_HELP_URL` to the organization's documentation address. |
| 4 | Build | `npm run build` creates the bundle and the manifest in `dist/`. |
| 5 | Validate | `npm run validate` checks `dist/manifest.xml`. |
| 6 | Hand over | Give the administrator the contents of `dist/`. |

## Hosting and distribution (administrator)

**Prerequisites**

- A place to host the static bundle (HTML, JS and CSS files) under the address that was used in the build.
- A Workspace deployment that users can sign in to. One of their roles there has to have the Excel
  add-in setting turned on; the organization's Workspace administrator sets it under Roles and Access.

**Steps**

1. Host the contents of `dist/` at the address from the build.
2. Open the Microsoft 365 admin center and go to **Integrated apps**.
3. Choose **Upload custom apps** and upload `manifest.xml`.
4. Choose the users or groups to deploy the add-in to.

Excel then loads the add-in from the hosted address. When a new version changes `manifest.xml` (a
ribbon button or an icon, for example), upload the new manifest again.
