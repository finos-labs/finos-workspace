---
title: About how the Copilot answers a question
sidebar_position: 2
---

# About how the Copilot answers a question

The Copilot is Ines, an agent that wraps a language model in a loop of tool calls. The loop is deliberately thin. Ines decides what the model sees, which tools it may use and what to do with the results, but it does not plan the work for the model and it does not look at the content of data to decide a route. This page explains the choices that shape an answer: who runs the tools, what the model is shown, how Ines keeps a long chat cheap, and what it does to keep a user's data from leaking through the model's text.

## The browser does the work that touches the user

When the model decides to load a widget's data, call a tool on one of the user's MCP servers or change a dashboard, Ines cannot do it. It has no access to the user's backends, no session and no connection to the user's MCP servers. It ends its response with a request, and the browser carries out the request and sends the result back in a new request, as the [agent query protocol](../reference/protocols/ines-query.mdx) describes. A question that needs three tool calls is therefore four requests.

This looks like extra work, and it is, but it keeps the agent small and it keeps the user's authority where it belongs. A tool runs with the permissions of the signed-in user, in the user's browser, through the same API that the rest of the app uses, so the roles that an administrator set apply to the Copilot exactly as they apply to the user. The browser's request goes through the API's MCP proxy, which refuses a tool that the user's roles do not grant, and the API checks the same rules again when the agent asks whether a request is allowed. Ines cannot grant itself more than the user has, because it never holds anything of the user's.

The tools that Ines does run itself are the ones whose work is local and cheap or tied to the request: a search over the widgets that the browser listed, and SQL over the rows that the browser sent back. The SQL runs in a child process with an empty environment and a deadline, because the rows come from outside and the query comes from a model.

## The model sees one turn

A chat that has run for an hour holds far more text than a question needs, and a language model charges for every token that it reads. Ines therefore shows the model the current turn only: the user's last message and whatever has happened since, such as the tool results of this question. When earlier messages exist, the model gets one short note that says how many there are and what the last few questions were. If the new question refers to something that the model cannot see, the note tells it to read the earlier messages with a tool for that purpose, and it reads only the part it needs. A question that stands on its own costs the same in the tenth message as in the first.

The same thinking applies to the tools themselves. A model that is given every tool with its full description pays for them on every call, and most questions need none of them. Ines always gives the model a few core tools: searching the widgets, loading widget data, loading a skill, recalling the conversation and loading more tools. The other tools belong to groups, such as SQL, dashboard changes, documents and the web. The system prompt names each group in a line, and the model loads a group when it needs it. Once a widget's rows are loaded Ines offers the SQL group itself, because the state makes the need certain, and it does so without deciding what the model should do with the group. The tools that the Workspace supplies, which change dashboards, are always given in full, because a model that has only a one-line catalog entry for such a tool calls it blind and guesses its arguments.

## Data is searched or read in parts

The model is never handed a whole document or a whole web page. A PDF or Word file that a user attached stays out of the model's input. The agent sends the file's link to a search tool on its MCP server, which fetches the file, splits it into passages and returns the passages that match the model's question. The model reads only those passages, each with its page, and when it names a page in its answer Ines cites exactly that page. A web page is handled the same way: a fetch returns an overview and an identifier, and the model reads further parts with a second tool. This bounds what any one call costs, and it bounds what a hostile page can put in front of the model.

## Text from outside is data

A language model cannot tell the instructions of its operator from instructions that appear in the text it reads, so Ines treats everything that arrives from outside as data and limits what that text can cause. The system prompt says that tool results are data. Ines signs an address for the web-fetch tool only if the address was in what the model was given, such as the user's message or an earlier search result, and never if the model only wrote it. A tool that reads outside content returns only that content and never repeats the model's own words, so a hostile page cannot launder an address that the model chose into one that the agent trusts. When an answer contains Markdown image syntax, Ines turns it into a plain link, because a chat window loads an image on its own and the address could carry the user's data. The web app adds its own limits, so the chat shows no images, raw HTML or scripts from message text, and an HTML artifact is shown in a frame whose policy lets the browser load nothing by address.

## What counts as the answer

A model step that calls a tool also often writes a sentence about what it is going to do. Ines treats such text as reasoning and reports it as a status update, and it treats the text of the step that calls no tool as the answer. The answer reaches the browser in one piece when the step ends and never token by token. This is a choice and not a limitation. It means that a user never sees half an answer that the model later changes, that the text of a step can be cleaned of the markers that models sometimes write, and that a step's tool calls decide how its text is classified, with no guess about its content. A few models write their tool calls into their text, as a tagged block. A small layer at the model boundary turns those blocks into real tool calls before the loop sees them, so the loop has one path.

## Who limits the Copilot

An administrator limits the Copilot through roles, and Ines enforces the limits by asking the API. For every request it asks whether the user may use the chosen model and the offered tools, and which capabilities are switched off for the user, such as web search. It counts each new question against the user's daily share and reports the tokens that each request used. When a limit is reached, the answer in the chat says so. Ines keeps no copy of any of this. The API stays the one place that knows who may do what, so a change of a role takes effect on the user's next request. [About roles and access](roles-and-access.md) explains how those limits are chosen.
