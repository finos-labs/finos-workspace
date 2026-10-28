---
title: How to save and reuse prompts
sidebar_position: 4
---

# How to save and reuse prompts

A prompt is a question that you ask the Copilot again and again. This guide keeps such questions in your library, so that you pick them from a menu instead of typing them, and it shows where the other prompts of the menu come from.

## Save a prompt

1. Select AI in the sidebar, and then the tab Prompts.
2. Select Add Prompt. The dialog Add new prompt opens.
3. Type the question in the box Prompt, as you would ask it, for example "Summarize Walmart's management guidance in a table format." The prompt is required.
4. Select Add Prompt. A message says "Prompt added successfully".

The tab shows your prompts in a group of their own. The list has a search box and a filter with the choices All, My Prompts, Backend and Shared. Point at one of your prompts to see its buttons. You can edit a prompt, which gives the message "Prompt updated successfully", and delete it after you confirm the dialog Delete Prompt. The buttons Move up and Move down change the order of your prompts, which is also the order of the menu in the Copilot, and they work while the search box is empty. Tick several prompts to delete them together, which asks for a confirmation in the dialog Delete Prompt(s).

## Ask a saved prompt

1. Open the Copilot and select the light bulb in the bottom row of the question box, which has the tooltip Prompt suggestions. The menu Prompts opens.
2. Choose a prompt. FINOS Workspace puts its text in the question box and does not send it, so you can change it before you ask.
3. Press Enter to send the question.

The menu has up to three sections, which you open and close with their arrows:

- **Backend Prompts** are the questions that the backend suggests for the app that the dashboard was created from. They also include the follow-up questions that the Copilot suggested in the current chat.
- **My Prompts** are the prompts that you saved.
- **Shared with me** are prompts that your roles give you access to. Copy one into your library from its row on the tab Prompts, and FINOS Workspace says "Prompt duplicated to your library".

When the menu has no prompt to offer, it says that no suggestions are available for this dashboard, and it links to the page where you create your own. The gear in the header of the menu opens the tab Prompts.

## Let the Copilot write or improve a prompt

The button with sparks next to the light bulb changes with the question box. With an empty box, it is Generate prompt: the Copilot proposes a question that fits the widgets, tools or web search that it may use right now. With text in the box, it is Prompt enhancement: the Copilot rewrites your question so that it is clearer and more specific. Both need something to work with, so when the Copilot has no widget, no MCP tool and no web search to use, the message says "Not enough context for prompt suggestion". The proposal replaces the text in the box, and you decide whether to ask it.

## Give prompts to everyone who uses an app

A backend can attach prompts to an app in its `apps.json`, so that every user of the app sees them under Backend Prompts. You can also add them when you save a dashboard as an app, as [How to save a dashboard as an app](../apps/save-a-dashboard-as-an-app.mdx#add-prompts) describes.
