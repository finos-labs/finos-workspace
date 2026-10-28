---
title: How to choose the models and tools of a role
sidebar_position: 5
---

# How to choose the models and tools of a role

The Copilot works for a person only with the models and tools that one of the person's roles grants. This guide chooses them for a role. You need an account of type Admin and a role, which [How to create a role](create-a-role.md) describes.

## Open the role's agent access

1. Open the admin area at `/admin` and select Roles and Access.
2. Hover the row of the role and select the icon whose tooltip reads Agent models and tools. The dialog Agent access opens with the role's name.

The dialog begins with this explanation: "Choose what the members of this role may use in the agent. They may use the models and tools that one of their roles grants, and nothing else."

## Choose the models

The section Models lists each agent by name, and under it the models that the agent offers. For Ines the models are the ones that the deployment names in `DEFAULT_MODEL` and `INES_MODELS`.

- Select All models to grant every model that the agent offers now and in the future. The individual choices are then switched off, because they are included.
- Select individual models to grant only those.

A role that grants no model of an agent does not let its members use that agent. A person whose roles grant no model gets a notice that their role does not allow the model when they ask a question.

## Choose the tools

The section MCP servers and tools lists the MCP servers that you know in your own workspace, such as the servers every user has by default. For each server you can select All tools, or select tools one by one.

A tool that no role grants is not offered to the Copilot, and the FINOS Workspace refuses a call to it. If the section says to add an MCP server to your own workspace to choose its tools here, the server has to be connected in your account before its tools appear in the list.

## Save

Select Save. The change takes effect on the members' next question, because the agent asks the API what a person may use on every request.

## The default role

A new organization starts with a role named Agent User that grants All models of the default agent and All tools of the deployment's default MCP servers. Every new user receives it. To limit the Copilot for an organization, either edit Agent User or remove it from the people who should have less, and grant the models and tools through other roles.

[Ines and its MCP server](../../technical-guide/reference/configuration/agent.mdx) lists the settings that decide which models exist, and [About roles and access](../../faq/roles-and-access.md) explains how the grants of several roles add up.
