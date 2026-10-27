---
title: Ask the Copilot about a dashboard
sidebar_position: 3
---

# Ask the Copilot about a dashboard

In this lesson you ask the Copilot a question about the data on a dashboard and follow how it answers. You choose which widget the Copilot looks at, read the steps that it took, check the source of its answer and ask a follow-up question. When you finish, you will know how to put data in front of the Copilot, how to see where an answer came from, and where its settings are.

## What you need

You need the dashboard from [Connect a backend and build a dashboard](connect-a-backend-and-build-a-dashboard.md), or any dashboard that has a widget with data. You also need an AI model for the agent to use. If you did not set one in the first lesson, open `agent/.env` in your clone, set `DEFAULT_MODEL` to a model in the form `<provider>:<model>`, and set the key of that provider in the same file. Then recreate the agent's containers, which reads the file again:

```bash
docker compose up -d
```

Your account also has to be allowed to use the model. A new organization has a role named Agent User that grants every model of the agent, and every new user receives it, so an account that you created with the first lesson already qualifies. [How to choose the models and tools of a role](../how-to/administer/choose-the-models-and-tools-of-a-role.md) explains how to limit it.

## Open the Copilot

The Copilot is the panel on the right side of the web app. When the panel is closed, a blue tab on the right edge of the window opens it. The panel names the agent, which is Ines, and lists three hints: click the speech bubble on a widget to add it as context, use the `@` button or type `@` and a widget's name to pick widgets, and type `/` to browse the skills and MCP servers that you can use.

Ask a question that needs no data, to see an answer at all. Select the box that says "Ask a question...", type `What can you do?` and press Enter. The answer appears under the heading Agent. Below it, the panel offers one or more follow-up questions, which you can select instead of typing.

## Choose what the Copilot looks at

On a page that is not a dashboard, the panel says that widget context is available on dashboards only. Open your dashboard from the sidebar. The panel now says "Using all widgets available", which means that the Copilot may use every widget that you can see, and that it also knows about the widgets of your connections that are not on the dashboard. It finds the one it needs by name and description.

To point the Copilot at one widget, select the speech bubble in the widget's header. The bubble lights up, and the widget's name appears as a chip next to the `@` button in the panel. The Copilot treats a widget that you added this way as the one that your question is about. Select the cross on the chip to remove it again. You can also select the `@` button, or type `@` in the question box, and pick a widget by name.

## Ask about the data

With the Revenue by region widget added as context, type `Which region has the highest revenue?` and press Enter. While the Copilot works, its steps appear in the panel. The Copilot asked for the widget's data, and your browser fetched it from the backend with the widget's current parameters, so the answer reflects the year that is set in the widget's header. When the Copilot has finished, it writes the answer and shows the widget as its source.

Your answer's wording depends on the model that you configured, so it will not match any text in this lesson. What stays the same is the structure: the steps that the Copilot took, then the answer, then the sources, then the follow-up questions.

## Read the steps

Above the answer, the line Step-by-step reasoning folds the work of the Copilot. Select it to see each step in order. You see a line for each thing that the Copilot did, such as loading the widget's data, and you can open a step to see its details, which include the tool that ran and the widget with the parameters that it used. A model that reasons in words between its steps shows those sentences here as well. The steps are the progress messages that the agent sends to your browser, as the [agent query protocol](../reference/protocols/ines-query.mdx) describes.

## Check the source

Under the answer, a chip carries the name of the widget that the answer came from. Select it. A small panel lists the parameter values that were in effect when the Copilot loaded the data, for example `year 2024`, and a button, Scroll to widget, takes you to the widget on the dashboard and highlights it. Because the values are recorded, you can tell which version of the data an answer describes even after you change the widget.

## Ask a follow-up question

Select a follow-up question under the answer, or type your own. The Copilot continues the same chat. It does not read all earlier messages again on every question. It reads the one you ask and what has happened since, and it looks at earlier messages only when your question refers to them, so a long chat does not make each answer slower.

## Change the Copilot's settings

Select the gear at the left of the panel's toolbar. The popover lists the settings that the agent offers. Follow-up Suggestions switches the follow-up questions on and off, and Model chooses the model that answers your questions, among the models that your roles allow. The control with the number next to the gear shows the MCP servers whose tools the Copilot may use. A fresh deployment lists one server, Ines Tools, which gives the Copilot web search and the ability to read web pages.

## Where to go next

You asked the Copilot a question, chose its data, and traced its answer. To change which models and tools your organization's people may use, read [How to choose the models and tools of a role](../how-to/administer/choose-the-models-and-tools-of-a-role.md). To learn what happens inside the agent, read [About how the Copilot answers a question](../explanation/how-the-copilot-answers.md).
