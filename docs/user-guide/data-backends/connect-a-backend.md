---
title: How to connect a backend
sidebar_position: 3
---

# How to connect a backend

This guide adds a data backend to your own FINOS Workspace account, gives it a credential if it needs one, and refreshes, edits or removes it later. A backend is a web server that describes its widgets in `widgets.json`. To write one, follow the [first tutorial](../../technical-guide/build-a-backend/connect-a-backend-and-build-a-dashboard.md). To make a backend available to a whole organization, an admin follows [How to add a data backend for your organization](../administration/add-a-data-backend-for-your-organization.md).

## What you need

You need an account of type Admin or Developer, because a User cannot add connections and has no Connections page. The backend has to be running at an address that your browser can reach, and it has to allow the web app's address in its CORS headers, because the browser calls it directly. [Widget requests](../../technical-guide/reference/protocols/widget-requests.mdx#cors) lists what the backend must answer.

## Add the backend

1. Select Connections in the sidebar, and then Connect Backend. The dialog Connect backend opens.
2. In Name, type the name that the connection will have. People see it as the origin of the backend's widgets.
3. In Endpoint URL, type the base address of the backend, for example `http://localhost:9100`. FINOS Workspace removes any slashes from the end.
4. Leave Validate widgets at No, or choose Yes to make the test also send a plain `OPTIONS` request to every route that the widgets use, as [Widget requests](../../technical-guide/reference/protocols/widget-requests.mdx#other-requests) describes.
5. If the backend needs a credential, select Add Authentication, as the next section describes.
6. Select Test. Add stays disabled until a test has succeeded.
7. Select Add.

A successful test says "Test successful" and counts what it found, such as "2 Widgets found, 0 Apps found, 0 Prompts found". It adds the number of MCP servers when the backend's apps declare any, and it says how many widgets failed when Validate widgets is Yes. After Add, a message says "Backend added successfully" with the same counts, and the connection appears in the list.

A failed test shows an Error notice. A backend that cannot be reached gives "Server error occurred. Please try again later or check the console logs for more details. (Status: 500)". When the address is on `localhost` or `127.0.0.1`, the notice adds a section Troubleshooting localhost, which you open with its arrow. It lists three causes: a certificate that the browser does not trust, which you fix by opening the address in the browser and accepting it, a backend that does not allow the web app's origin in its CORS headers, and an address that answers with an HTML page instead of JSON.

## Give the backend a credential

Select Add Authentication and fill the row. Key and Value are the name and the value of the credential, and Location says where FINOS Workspace puts it, either Header or Query Parameter. Select Add Authentication again for another row, and the cross at the end of a row removes it. The credential belongs to the connection, and FINOS Workspace sends it only with the requests that go to the backend's own address. It is not part of a widget's parameters, so a dashboard that you share never contains it. [How to share a dashboard](../sharing/share-a-dashboard.md) explains what a recipient's requests carry instead.

## Refresh, edit or remove a connection

The Connections page lists each connection with the number of its widgets, apps, prompts and agents and the time of its last update. Point at a row to see its buttons.

- **Refresh backend** asks the backend for `widgets.json` again, so that a widget you added or changed on the backend shows up. The refresh button at the top of the page, Refresh all backends, does this for every connection and answers "Backends refreshed". Loading the page again does it too.
- **Edit backend** opens the same dialog with the connection's values. After you save, a message says "Backend updated successfully", or "Backend activated successfully" when the connection was inactive and works again.
- **Delete connection** asks for confirmation and removes the connection. You can also tick one or more rows and select Delete connection at the top of the list. A message says that the connection was deleted successfully.
- The copy button next to a connection's name copies its address.

When you open an active connection, select Test, and the test fails, closing the dialog marks the connection inactive. FINOS Workspace then says "Backend marked as inactive" and that the connection test failed.
